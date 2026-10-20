// End-to-end smoke test against a throwaway database: node test/smoke.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-vault-test-'));
const app = require('../src/server');

function client(base) {
  let cookie = '';
  return async (method, url, body, expect = 200) => {
    const r = await fetch(base + '/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await r.json().catch(() => ({}));
    assert.strictEqual(r.status, expect, `${method} ${url} -> ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
}

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = client(base);
  try {
    assert.ok((await owner('GET', '/setup')).needsSetup);
    await owner('POST', '/setup', { company_name: 'Test Co', name: 'Olivia Owner', email: 'owner@test.local', password: 'ownerpass1' });
    await owner('POST', '/setup', { name: 'x', email: 'x@y.z', password: 'whatever12' }, 409);

    const { id: clientId } = await owner('POST', '/clients', { name: 'Acme', email: 'acme@test.local' });
    const { id: siteId } = await owner('POST', '/websites', { name: 'Acme Store', domain: 'https://Acme.com/', client_id: clientId, price: 5000, billing_cycle: 'monthly', next_billing_date: '2026-01-31', social: { facebook: 'https://fb.com/acme' } });
    const site = (await owner('GET', `/websites/${siteId}`)).website;
    assert.strictEqual(site.domain, 'acme.com');
    assert.strictEqual(site.mrr, 5000);

    // vault
    const { id: credId } = await owner('POST', `/websites/${siteId}/credentials`, { category: 'hosting', label: 'cPanel', username: 'acme', password: 's3cret!', notes: '2FA codes' });
    assert.deepStrictEqual(await owner('POST', `/credentials/${credId}/reveal`), { password: 's3cret!', notes: '2FA codes' });
    await owner('PUT', `/credentials/${credId}`, { label: 'cPanel main', password: '' });
    assert.strictEqual((await owner('POST', `/credentials/${credId}/reveal`)).password, 's3cret!', 'empty password on edit keeps old one');

    // plan invoice: Jan 31 + 1 month clamps to Feb 28
    const inv = await owner('POST', `/websites/${siteId}/invoice`, {});
    assert.strictEqual((await owner('GET', `/websites/${siteId}`)).website.next_billing_date, '2026-02-28');
    const invDetail = await owner('GET', `/invoices/${inv.id}`);
    assert.strictEqual(invDetail.invoice.total, 5900); // 18% default tax
    await owner('POST', `/invoices/${inv.id}/send`);
    assert.strictEqual((await owner('GET', '/followups?status=pending')).length, 1);
    await owner('POST', `/invoices/${inv.id}/pay`, { method: 'UPI' });
    assert.strictEqual((await owner('GET', '/followups?status=pending')).length, 0);
    await owner('POST', '/payments', { type: 'expense', amount: 900, website_id: siteId });
    const dash = await owner('GET', '/dashboard');
    assert.strictEqual(dash.finance.revenue_month, 5900);
    assert.strictEqual(dash.finance.expense_month, 900);
    assert.strictEqual(dash.finance.mrr, 5000);

    // recurring task rolls forward past today
    const { id: taskId } = await owner('POST', '/tasks', { title: 'Weekly backup', website_id: siteId, frequency: 'weekly', due_date: '2020-01-01' });
    const done = await owner('POST', `/tasks/${taskId}/complete`);
    assert.ok(done.next_due > new Date().toISOString().slice(0, 10));

    // team member with limited access
    const created = await owner('POST', '/users', { name: 'Mia Member', email: 'mia@test.local', role: 'member' });
    const mia = client(base);
    await mia('POST', '/auth/login', { email: 'mia@test.local', password: created.temp_password });
    await mia('GET', '/websites', null, 403); // must change password first
    await mia('PUT', '/account/password', { current_password: created.temp_password, new_password: 'miapass123' });
    assert.strictEqual((await mia('GET', '/websites')).length, 0, 'member sees no unassigned sites');
    await mia('GET', `/websites/${siteId}`, null, 404);
    await mia('GET', '/invoices', null, 403);
    await owner('PUT', `/websites/${siteId}/members`, { user_ids: [created.id] });
    const miaSites = await mia('GET', '/websites');
    assert.strictEqual(miaSites.length, 1);
    assert.strictEqual(miaSites[0].price, undefined, 'finance hidden from member');
    assert.strictEqual((await mia('POST', `/credentials/${credId}/reveal`)).password, 's3cret!');
    await mia('POST', `/websites/${siteId}/credentials`, { label: 'x' }, 403);
    await mia('POST', '/users', { name: 'x', email: 'x@test.local', role: 'admin' }, 403);

    // admin password reset & disable
    const reset = await owner('POST', `/users/${created.id}/reset-password`);
    await mia('GET', '/auth/me', null, 401); // sessions revoked
    await mia('POST', '/auth/login', { email: 'mia@test.local', password: reset.temp_password });
    await owner('PUT', `/users/${created.id}`, { status: 'disabled' });
    await mia('POST', '/auth/login', { email: 'mia@test.local', password: reset.temp_password }, 403);

    // email change + last-owner protection
    await owner('PUT', '/account/email', { email: 'boss@test.local', current_password: 'ownerpass1' });
    await owner('DELETE', '/account', { current_password: 'ownerpass1', confirm: 'DELETE' }, 400);

    // public onboarding
    const onb = await owner('POST', '/onboarding', { client_id: clientId, new_website_name: 'Acme Blog', items: ['Hosting / cPanel login', 'Billing / invoice details'] });
    const pub = client(base);
    const info = await pub('GET', `/public/onboard/${onb.token}`);
    assert.strictEqual(info.website.name, 'Acme Blog');
    const sub = await pub('POST', `/public/onboard/${onb.token}`, { access: [{ category: 'hosting', label: 'Hosting', username: 'blog', password: 'pw' }], billing: { tax_id: 'GST123' } });
    assert.strictEqual(sub.saved, 1);
    assert.strictEqual((await owner('GET', `/clients/${clientId}`)).client.tax_id, 'GST123');
    await owner('POST', `/onboarding/${onb.id}/complete`);
    await pub('GET', `/public/onboard/${onb.token}`, null, 404);
    assert.strictEqual((await owner('GET', `/websites/${onb.website_id}`)).website.status, 'active');

    // ---- multi-currency ----
    await owner('PUT', '/currencies/USD', { rate: 83 });
    const { id: usClient } = await owner('POST', '/clients', { name: 'US Corp', currency: 'USD' });
    const usInv = await owner('POST', '/invoices', { client_id: usClient, items: [{ description: 'Retainer', qty: 1, rate: 100 }], tax_rate: 0 });
    const usInvD = (await owner('GET', `/invoices/${usInv.id}`)).invoice;
    assert.strictEqual(usInvD.currency, 'USD');
    assert.strictEqual(usInvD.exchange_rate, 83);
    await owner('POST', `/invoices/${usInv.id}/pay`, {});
    const usPay = (await owner('GET', '/payments')).find((p) => p.invoice_id === usInv.id);
    assert.strictEqual(usPay.amount, 100);
    assert.strictEqual(usPay.amount_base, 8300);
    await owner('POST', '/invoices', { currency: 'JPY', items: [] }, 400); // no rate set for JPY

    // ---- employees, masking, payslips ----
    const { id: empId } = await owner('POST', '/employees', {
      official_name: 'Rakesh Kumar Verma', display_name: 'Ricky', employment_type: 'full_time', bank_details: 'HDFC 1234',
      salary_structure: { earnings: [{ name: 'Basic', amount: 20000 }, { name: 'HRA', amount: 10000 }], deductions: [{ name: 'PF', amount: 1800 }] },
    });
    const emp = (await owner('GET', `/employees/${empId}`)).employee;
    assert.strictEqual(emp.salary_structure.net, 28200);
    assert.strictEqual(emp.bank_enc, undefined);
    assert.strictEqual((await owner('POST', `/employees/${empId}/reveal`)).bank_details, 'HDFC 1234');
    await owner('POST', `/employees/${empId}/benefits`, { type: 'health_insurance', title: 'Family floater', amount: 12000, frequency: 'yearly' });
    const gen = await owner('POST', '/payslips/generate', { month: '2026-09', working_days: 30 });
    assert.strictEqual(gen.created, 1);
    assert.strictEqual((await owner('POST', '/payslips/generate', { month: '2026-09' })).created, 0, 'no duplicates');
    const slip = (await owner('GET', '/payslips?month=2026-09'))[0];
    await owner('PUT', `/payslips/${slip.id}`, { paid_days: 15, recalculate: true });
    const slip2 = (await owner('GET', `/payslips/${slip.id}`)).payslip;
    assert.strictEqual(slip2.gross, 15000);
    assert.strictEqual(slip2.net, 13200);
    await owner('POST', `/payslips/${slip.id}/pay`, { method: 'Bank' });
    const salaryPay = (await owner('GET', '/payments?type=expense')).find((p) => p.source === 'payslip');
    assert.strictEqual(salaryPay.amount, 13200);
    await owner('PUT', `/payslips/${slip.id}`, { paid_days: 30 }, 400); // paid slips are locked

    const viewer = await owner('POST', '/users', { name: 'Val Viewer', email: 'val@test.local', role: 'viewer' });
    const val = client(base);
    await val('POST', '/auth/login', { email: 'val@test.local', password: viewer.temp_password });
    await val('PUT', '/account/password', { current_password: viewer.temp_password, new_password: 'valpass123' });
    await val('GET', '/employees', null, 403);
    const dir = await val('GET', '/employees/directory');
    assert.strictEqual(dir[0].name, 'Ricky');
    assert.strictEqual(dir[0].official_name, undefined, 'real name is masked for non-HR');
    await val('GET', '/export/payments.csv', null, 403);

    // ---- freelance ----
    const { id: flId } = await owner('POST', '/freelance', { freelancer_name: 'Asha (Fiverr)', title: 'Logo design', amount: 5000, website_id: siteId });
    await owner('POST', `/freelance/${flId}/pay`, { amount: 2000 });
    let job = (await owner('GET', '/freelance')).find((j) => j.id === flId);
    assert.strictEqual(job.balance, 3000);
    assert.notStrictEqual(job.status, 'paid');
    await owner('POST', `/freelance/${flId}/pay`, {});
    job = (await owner('GET', '/freelance')).find((j) => j.id === flId);
    assert.strictEqual(job.status, 'paid');

    // ---- procurement ----
    const proc = await owner('POST', '/procurements', { website_id: siteId, type: 'domain', item: 'acme.com', vendor: 'GoDaddy', billing_cycle: 'yearly', purchase_date: '2025-11-01', cost: 800, price: 1500, record_expense: true });
    assert.strictEqual((await owner('GET', `/procurements?website_id=${siteId}`)).items[0].expiry_date, '2026-11-01');
    const ren = await owner('POST', `/procurements/${proc.id}/renew`, { record_expense: true, create_invoice: true });
    assert.strictEqual(ren.expiry_date, '2027-11-01');
    assert.ok(ren.invoice.number);
    const dash2 = await owner('GET', '/dashboard');
    assert.strictEqual(dash2.procurement.active, 1);
    assert.strictEqual(dash2.procurement.annual_margin, 700);
    assert.strictEqual(dash2.hr.headcount, 1);
    assert.strictEqual(dash2.freelance.open_jobs, 0);
    assert.ok(dash2.expense_breakdown.some((e) => e.label === 'Salary'));

    // ---- catalog & export ----
    await owner('POST', '/catalog', { name: 'Wildcard SSL', category: 'ssl', price: 9000, cost: 6000, billing_cycle: 'yearly' });
    assert.strictEqual((await val('GET', '/catalog'))[0].cost, undefined);
    const csv = await fetch(base + '/api/export/payments.csv', { headers: { cookie: '' } });
    assert.strictEqual(csv.status, 401);

    // CSRF header required
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(r.status, 403);

    console.log('✔ all smoke tests passed');
  } finally {
    server.close();
  }
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
