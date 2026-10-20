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

    // CSRF header required
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(r.status, 403);

    console.log('✔ all smoke tests passed');
  } finally {
    server.close();
  }
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
