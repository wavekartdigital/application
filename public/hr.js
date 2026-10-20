'use strict';
/* Employees, masked names, salary structures, benefits and payslips. Loaded after app.js. */

const EMP_TYPE = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Intern', freelancer: 'Freelancer' };
const EMP_STATUS = { active: 'Active', on_leave: 'On leave', exited: 'Exited' };
const BENEFIT = { health_insurance: 'Health insurance', life_insurance: 'Life insurance', provident_fund: 'Provident fund (PF)', gratuity: 'Gratuity', bonus: 'Bonus', allowance: 'Allowance', leave: 'Leave entitlement', equipment: 'Equipment (laptop, phone)', training: 'Training / courses', other: 'Other' };
const FREQ_B = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };
Object.assign(badgeClass, { on_leave: 'b-warn', full_time: 'b-accent', part_time: '', contract: 'b-info', intern: '', freelancer: 'b-info' });
const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const thisMonth = () => todayStr().slice(0, 7);

// ---------- earnings / deductions line editor ----------
function linesEditor(key, lines, title) {
  const row = (l = {}) => `<tr class="ln"><td><input data-n value="${h(l.name || '')}" placeholder="Component"></td><td style="width:150px"><input data-a type="number" step="any" value="${h(l.amount ?? '')}" placeholder="0"></td><td style="width:40px"><button type="button" class="sm" data-rmline>✕</button></td></tr>`;
  return `<div data-lines="${key}"><label>${h(title)}</label><table><tbody>${(lines.length ? lines : [{}]).map(row).join('')}</tbody></table>
    <p style="margin:6px 0"><button type="button" class="sm" data-addline>+ Add</button> <span class="muted small" data-total></span></p></div>`;
}
const readLines = (form, key) => $$(`[data-lines="${key}"] tr.ln`, form).map((tr) => ({ name: $('[data-n]', tr).value.trim(), amount: Number($('[data-a]', tr).value) || 0 })).filter((l) => l.name || l.amount);
function wireLines(form, cur) {
  const total = () => {
    const sums = {};
    $$('[data-lines]', form).forEach((box) => {
      const t = readLines(form, box.dataset.lines).reduce((s, l) => s + l.amount, 0);
      sums[box.dataset.lines] = t;
      $('[data-total]', box).textContent = 'Total ' + money(t, cur());
    });
    const net = $('#netPay', form);
    if (net) net.innerHTML = `Net pay: <b>${money((sums.earnings || 0) - (sums.deductions || 0), cur())}</b> per month`;
  };
  form.addEventListener('input', total);
  form.addEventListener('click', (e) => {
    if (e.target.matches('[data-addline]')) {
      const tb = $('tbody', e.target.closest('[data-lines]'));
      tb.insertAdjacentHTML('beforeend', `<tr class="ln"><td><input data-n placeholder="Component"></td><td style="width:150px"><input data-a type="number" step="any" placeholder="0"></td><td style="width:40px"><button type="button" class="sm" data-rmline>✕</button></td></tr>`);
    }
    if (e.target.matches('[data-rmline]')) { e.target.closest('tr').remove(); total(); }
  });
  total();
}

// ---------- employee form ----------
async function empForm(e = {}) {
  const users = await api('GET', '/users/options').catch(() => []);
  const st = e.salary_structure || { earnings: [{ name: 'Basic', amount: '' }, { name: 'HRA', amount: '' }, { name: 'Special allowance', amount: '' }], deductions: [{ name: 'Provident fund (PF)', amount: '' }, { name: 'Professional tax', amount: '' }] };
  return formHTML([
    { name: 'official_name', label: 'Official name (real / legal name)', required: true, help: 'Used on payslips and HR records only' },
    { name: 'display_name', label: 'Display name (masked / working name)', help: 'Shown to the team and clients instead of the real name' },
    { name: 'employee_code', label: 'Employee code', placeholder: 'EMP-001' },
    { name: 'designation', label: 'Designation', placeholder: 'SEO Executive, Web Developer…' },
    { name: 'department', label: 'Department' },
    { name: 'employment_type', label: 'Type', type: 'select', options: enumOpts(EMP_TYPE) },
    { name: 'status', label: 'Status', type: 'select', options: enumOpts(EMP_STATUS) },
    { name: 'user_id', label: 'App login (optional)', type: 'select', options: opts(users, '— No login linked —') },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'join_date', label: 'Joining date', type: 'date' },
    { name: 'exit_date', label: 'Exit date', type: 'date' },
    currencyField('currency', 'Salary currency'),
    { name: 'emergency_contact', label: 'Emergency contact' },
    { name: 'address', label: 'Address', type: 'textarea', full: true },
    { type: 'html', full: true, html: `<h3 style="margin-top:6px">Monthly salary structure</h3><div class="grid g2">${linesEditor('earnings', st.earnings, 'Earnings')}${linesEditor('deductions', st.deductions, 'Deductions')}</div><p id="netPay"></p>` },
    { type: 'html', full: true, html: '<h3 style="margin-top:6px">Private details (encrypted)</h3>' },
    { name: 'bank_details', label: 'Bank details', type: 'textarea', placeholder: e.has_bank ? '•••• saved — leave empty to keep' : 'Bank, account no., IFSC / SWIFT, UPI' },
    { name: 'id_docs', label: 'ID documents', type: 'textarea', placeholder: e.has_id_docs ? '•••• saved — leave empty to keep' : 'PAN, Aadhaar, passport, tax numbers' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true },
  ], { employment_type: 'full_time', status: 'active', currency: S.cur.base, join_date: todayStr(), ...e, bank_details: '', id_docs: '' });
}
const empPayload = (d, form) => ({ ...d, salary_structure: { earnings: readLines(form, 'earnings'), deductions: readLines(form, 'deductions') } });
const curOf = (form) => () => $('[name=currency]', form)?.value || undefined;
ACT.empNew = async () => openModal({
  title: 'Add employee / freelancer', wide: true, body: await empForm(), onOpen: (f) => wireLines(f, curOf(f)),
  onSubmit: async (d, form) => { const r = await api('POST', '/employees', empPayload(d, form)); location.hash = `#/employee/${r.id}`; },
});
ACT.empEdit = async (ds) => {
  const { employee } = await api('GET', `/employees/${ds.id}`);
  openModal({
    title: `Edit ${employee.official_name}`, wide: true, body: await empForm(employee), onOpen: (f) => wireLines(f, curOf(f)),
    onSubmit: async (d, form) => { await api('PUT', `/employees/${ds.id}`, empPayload(d, form)); toast('Saved'); refresh(); },
  });
};
ACT.empDelete = async (ds) => {
  if (!(await confirmBox('Delete employee?', 'This deletes the employee with their benefits and payslips. Salary payments already recorded stay in Finance. Consider marking them "Exited" instead.'))) return;
  await api('DELETE', `/employees/${ds.id}`); location.hash = '#/employees';
};
ACT.empReveal = async (ds) => {
  const r = await api('POST', `/employees/${ds.id}/reveal`);
  openModal({ title: 'Private details', body: `<label>Bank details</label><div class="secret-box pre">${h(r.bank_details || '—')}</div><label style="margin-top:12px">ID documents</label><div class="secret-box pre">${h(r.id_docs || '—')}</div><p class="muted small">This view was recorded in the activity log.</p>` });
};

// ---------- benefits ----------
const benefitFields = () => [
  { name: 'type', label: 'Benefit', type: 'select', options: enumOpts(BENEFIT) },
  { name: 'title', label: 'Title', required: true, placeholder: 'Family floater ₹5L, Diwali bonus, Laptop…' },
  { name: 'amount', label: 'Amount / value', type: 'number' },
  currencyField(),
  { name: 'frequency', label: 'Frequency', type: 'select', options: enumOpts(FREQ_B) },
  { name: 'provider', label: 'Provider', placeholder: 'Insurer, EPFO…' },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'end_date', label: 'End date', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];
let benefitCache = [];
ACT.benefitNew = (ds) => openModal({ title: 'Add benefit', wide: true, body: formHTML(benefitFields(), { type: 'health_insurance', frequency: 'yearly', start_date: todayStr(), currency: ds.cur || S.cur.base }), onSubmit: async (d) => { await api('POST', `/employees/${ds.id}/benefits`, d); refresh(); } });
ACT.benefitEdit = (ds) => {
  const b = benefitCache.find((x) => x.id === +ds.id);
  const m = openModal({ title: 'Edit benefit', wide: true, body: formHTML(benefitFields(), b) + '<p style="margin-top:14px"><button type="button" class="danger sm" data-act="benefitDelete">Delete</button></p>', onSubmit: async (d) => { await api('PUT', `/benefits/${b.id}`, d); refresh(); } });
  ACT.benefitDelete = async () => { if (await confirmBox('Delete benefit?', b.title)) { await api('DELETE', `/benefits/${b.id}`); m.close(); refresh(); } };
};

// ---------- payslips ----------
ACT.slipGenerate = (ds) => openModal({
  title: 'Generate payslips', submit: 'Generate',
  body: `<p class="muted">Creates draft payslips from each active employee's salary structure (freelancers are skipped, existing payslips are not touched). You can adjust paid days and amounts afterwards.</p>`
    + formHTML([{ name: 'month', label: 'Month', type: 'month', required: true }, { name: 'working_days', label: 'Working days in month', type: 'number', help: 'Leave empty to use calendar days' }], { month: ds.month || thisMonth() }),
  onSubmit: async (d) => { const r = await api('POST', '/payslips/generate', d); toast(`${r.created} payslip(s) created${r.skipped ? `, ${r.skipped} skipped` : ''}`); location.hash = `#/employees/payroll/${d.month}`; refresh(); },
});
ACT.slipNew = async (ds) => {
  const emps = (await api('GET', '/employees')).filter((e) => e.status !== 'exited');
  openModal({
    title: 'New payslip', submit: 'Create',
    body: formHTML([
      { name: 'employee_id', label: 'Employee', type: 'select', options: emps.map((e) => [e.id, e.official_name + (e.display_name ? ` (${e.display_name})` : '')]) },
      { name: 'month', label: 'Month', type: 'month', required: true },
      { name: 'working_days', label: 'Working days', type: 'number' },
      { name: 'paid_days', label: 'Paid days', type: 'number', help: 'Earnings are pro-rated by paid ÷ working days' },
    ], { employee_id: ds.emp || '', month: ds.month || thisMonth() }),
    onSubmit: async (d) => { const r = await api('POST', '/payslips', d); location.hash = `#/payslip/${r.id}`; },
  });
};
ACT.slipEdit = async (ds) => {
  const { payslip: s } = await api('GET', `/payslips/${ds.id}`);
  const m = openModal({
    title: `Edit payslip — ${monthName(s.month)}`, wide: true,
    body: formHTML([
      { name: 'working_days', label: 'Working days', type: 'number' },
      { name: 'paid_days', label: 'Paid days', type: 'number' },
      { type: 'html', full: true, html: `<div class="grid g2">${linesEditor('earnings', s.earnings, 'Earnings')}${linesEditor('deductions', s.deductions, 'Deductions')}</div><p id="netPay"></p>
        <p><button type="button" class="sm" id="recalc">Recalculate from salary structure using these days</button></p>` },
      { name: 'notes', label: 'Notes on payslip', type: 'textarea', full: true },
    ], s),
    onOpen: (f) => {
      wireLines(f, () => s.currency);
      $('#recalc', f).addEventListener('click', async () => {
        await api('PUT', `/payslips/${s.id}`, { working_days: $('[name=working_days]', f).value, paid_days: $('[name=paid_days]', f).value, recalculate: true });
        m.close(); toast('Recalculated'); refresh();
      });
    },
    onSubmit: async (d, form) => { await api('PUT', `/payslips/${s.id}`, { ...d, earnings: readLines(form, 'earnings'), deductions: readLines(form, 'deductions') }); toast('Saved'); refresh(); },
  });
};
ACT.slipPay = (ds) => openModal({
  title: 'Mark salary as paid', submit: 'Mark paid',
  body: '<p class="muted">Records the net pay as a "Salary" expense in Finance.</p>' + formHTML([{ name: 'date', label: 'Paid on', type: 'date' }, { name: 'method', label: 'Method', placeholder: 'Bank transfer, UPI, cash…' }], { date: todayStr() }),
  onSubmit: async (d) => { await api('POST', `/payslips/${ds.id}/pay`, d); toast('Salary marked as paid'); refresh(); },
});
ACT.slipDelete = async (ds) => {
  if (!(await confirmBox('Delete payslip?', 'If it was paid, the salary expense is removed too.'))) return;
  await api('DELETE', `/payslips/${ds.id}`);
  if (location.hash.startsWith('#/payslip/')) history.back(); else refresh();
};
function slipTable(rows, showEmp = true) {
  if (!rows.length) return '<div class="empty">No payslips.</div>';
  return `<div class="table-wrap"><table><thead><tr>${showEmp ? '<th>Employee</th>' : ''}<th>Month</th><th class="right">Paid days</th><th class="right">Gross</th><th class="right">Deductions</th><th class="right">Net pay</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr>${showEmp ? `<td><a href="#/employee/${s.employee_id}"><b>${h(s.official_name)}</b></a>${s.display_name ? `<div class="muted small">${h(s.display_name)}</div>` : ''}</td>` : ''}
      <td class="nowrap"><a href="#/payslip/${s.id}">${monthName(s.month)}</a></td><td class="right num">${s.paid_days ?? '—'} / ${s.working_days ?? '—'}</td>
      <td class="right num">${money(s.gross, s.currency)}</td><td class="right num">${money(s.total_deductions, s.currency)}</td><td class="right num"><b>${money(s.net, s.currency)}</b></td>
      <td>${s.status === 'paid' ? badge('paid', 'Paid ' + fmtDate(s.paid_date)) : badge('draft', 'Unpaid')}</td>
      <td class="right nowrap"><a class="btn sm" href="#/payslip/${s.id}">View</a>${s.status !== 'paid' ? ` <button class="sm" data-act="slipEdit" data-id="${s.id}">Edit</button> <button class="sm" data-act="slipPay" data-id="${s.id}">Pay</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- pages ----------
PAGES.employees = async (m, [tab = 'staff', month]) => {
  const tabs = `<div class="tabs">${[['staff', 'Employees & freelancers'], ['payroll', 'Payroll & payslips']].map(([k, l]) => `<button data-act="nav" data-href="#/employees/${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  if (tab === 'payroll') {
    month ||= thisMonth();
    const rows = await api('GET', `/payslips?month=${month}`);
    const tot = {};
    for (const s of rows) { tot[s.currency] ||= { gross: 0, net: 0, paid: 0 }; tot[s.currency].gross += s.gross; tot[s.currency].net += s.net; if (s.status === 'paid') tot[s.currency].paid += s.net; }
    m.innerHTML = pageHead('Employees & payroll', '<a class="btn" href="/api/export/payslips.csv">Export CSV</a><button data-act="slipNew" data-month="' + h(month) + '">+ Single payslip</button><button class="primary" data-act="slipGenerate" data-month="' + h(month) + '">Generate payslips</button>') + tabs
      + `<div class="toolbar"><label class="check">Month <input type="month" id="pm" value="${h(month)}"></label></div>
      <div class="kpis">${Object.entries(tot).map(([c, v]) => `<div class="kpi"><div class="label">Net payroll (${h(c)})</div><div class="value">${money(v.net, c)}</div><div class="sub">Gross ${money(v.gross, c)} · paid ${money(v.paid, c)}</div></div>`).join('') || `<div class="kpi"><div class="label">${monthName(month)}</div><div class="value">0</div><div class="sub">No payslips yet — click "Generate payslips"</div></div>`}</div>
      <div class="card">${slipTable(rows)}</div>`;
    $('#pm').addEventListener('change', (e) => { if (e.target.value) location.hash = `#/employees/payroll/${e.target.value}`; });
    return;
  }
  const rows = await api('GET', '/employees');
  const active = rows.filter((e) => e.status !== 'exited');
  const byCur = {};
  for (const e of active.filter((x) => x.employment_type !== 'freelancer')) byCur[e.currency] = (byCur[e.currency] || 0) + e.salary_structure.gross;
  m.innerHTML = pageHead('Employees & payroll', '<button class="primary" data-act="empNew">+ Add employee</button>', 'Real names stay here; the rest of the app shows display names') + tabs
    + `<div class="kpis"><div class="kpi"><div class="label">Active employees</div><div class="value">${active.filter((e) => e.employment_type !== 'freelancer').length}</div><div class="sub">${active.filter((e) => e.status === 'on_leave').length} on leave</div></div>
      <div class="kpi"><div class="label">Freelancers</div><div class="value">${active.filter((e) => e.employment_type === 'freelancer').length}</div></div>
      ${Object.entries(byCur).map(([c, v]) => `<div class="kpi"><div class="label">Monthly gross payroll (${h(c)})</div><div class="value">${money(v, c)}</div></div>`).join('')}</div>
    <div class="card"><div class="toolbar"><input type="search" id="eq" placeholder="Search name, code, designation…"><select id="es"><option value="current">Current</option><option value="">All</option><option value="exited">Exited</option></select></div>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Display name</th><th>Role</th><th>Type</th><th>Status</th><th class="right">Monthly gross</th><th class="right">Net</th><th>Joined</th><th>Last payslip</th></tr></thead><tbody id="eb"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('#eq').value.toLowerCase(), st = $('#es').value;
    const list = rows.filter((e) => (st === 'current' ? e.status !== 'exited' : !st || e.status === st) && (!q || [e.official_name, e.display_name, e.employee_code, e.designation, e.department].join(' ').toLowerCase().includes(q)));
    $('#eb').innerHTML = list.length ? list.map((e) => `<tr><td><a href="#/employee/${e.id}"><b>${h(e.official_name)}</b></a><div class="muted small">${h(e.employee_code || '')}</div></td><td>${h(e.display_name || '—')}</td>
      <td>${h(e.designation || '—')}<div class="muted small">${h(e.department || '')}</div></td><td>${badge(e.employment_type, EMP_TYPE[e.employment_type])}</td><td>${badge(e.status, EMP_STATUS[e.status])}</td>
      <td class="right num">${e.salary_structure.gross ? money(e.salary_structure.gross, e.currency) : '—'}</td><td class="right num">${e.salary_structure.gross ? money(e.salary_structure.net, e.currency) : '—'}</td>
      <td class="nowrap">${fmtDate(e.join_date)}</td><td class="nowrap">${e.last_payslip ? monthName(e.last_payslip) : '—'}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">No employees yet.</td></tr>';
  };
  $('#eq').addEventListener('input', draw); $('#es').addEventListener('input', draw);
  draw();
};

PAGES.employee = async (m, [id]) => {
  const d = await api('GET', `/employees/${id}`);
  const e = d.employee, st = e.salary_structure;
  benefitCache = d.benefits;
  flCache = d.freelance.map((j) => ({ ...j, freelancer: e.display_name || e.official_name, balance: Math.max(0, j.amount - j.paid) }));
  const lineTable = (rows) => rows.length ? `<table><tbody>${rows.map((l) => `<tr><td>${h(l.name)}</td><td class="right num">${money(l.amount, e.currency)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">None</div>';
  m.innerHTML = pageHead(`${h(e.official_name)} ${badge(e.status, EMP_STATUS[e.status])}`,
    `<button data-act="empReveal" data-id="${e.id}">Bank & ID details</button><button data-act="slipNew" data-emp="${e.id}">New payslip</button><button class="primary" data-act="empEdit" data-id="${e.id}">Edit</button>`,
    `${e.display_name ? `Known as <b>${h(e.display_name)}</b> · ` : ''}${h(e.designation || '')} · <a href="#/employees">All employees</a>`)
    + `<div class="grid g2"><div class="card"><h2>Details</h2><dl class="kv">
        <dt>Official name</dt><dd>${h(e.official_name)}</dd><dt>Display name</dt><dd>${h(e.display_name || '— (official name is shown)')}</dd>
        <dt>Employee code</dt><dd>${h(e.employee_code || '—')}</dd><dt>Designation</dt><dd>${h(e.designation || '—')}</dd><dt>Department</dt><dd>${h(e.department || '—')}</dd>
        <dt>Type</dt><dd>${EMP_TYPE[e.employment_type]}</dd><dt>Email</dt><dd>${h(e.email || '—')}</dd><dt>Phone</dt><dd>${h(e.phone || '—')}</dd>
        <dt>Joined</dt><dd>${fmtDate(e.join_date)}</dd><dt>Exit</dt><dd>${fmtDate(e.exit_date)}</dd><dt>App login</dt><dd>${d.user ? `${h(d.user.name)} <span class="muted small">${h(d.user.email)}</span>` : '—'}</dd>
        <dt>Emergency contact</dt><dd class="pre">${h(e.emergency_contact || '—')}</dd><dt>Address</dt><dd class="pre">${h(e.address || '—')}</dd>
        <dt>Bank / ID on file</dt><dd>${e.has_bank ? '✓ Bank' : '— Bank'} · ${e.has_id_docs ? '✓ ID docs' : '— ID docs'}</dd><dt>Notes</dt><dd class="pre">${h(e.notes || '—')}</dd></dl></div>
      <div class="grid"><div class="card"><h2>Monthly salary (${h(e.currency)})</h2><div class="grid g2"><div><h3>Earnings</h3>${lineTable(st.earnings)}</div><div><h3>Deductions</h3>${lineTable(st.deductions)}</div></div>
        <dl class="kv" style="margin-top:12px"><dt>Gross</dt><dd>${money(st.gross, e.currency)} / month · ${money(st.gross * 12, e.currency)} / year</dd><dt>Net (take-home)</dt><dd><b>${money(st.net, e.currency)}</b> / month</dd></dl></div>
      <div class="card"><div class="toolbar"><h2 style="margin:0">Benefits</h2><span style="margin-left:auto"></span><button class="sm" data-act="benefitNew" data-id="${e.id}" data-cur="${h(e.currency)}">+ Add benefit</button></div>
        ${d.benefits.length ? `<ul class="list">${d.benefits.map((b) => `<li><div class="grow"><b>${h(b.title)}</b> ${badge('', BENEFIT[b.type])}<div class="muted small">${b.amount ? money(b.amount, b.currency) + ' · ' : ''}${FREQ_B[b.frequency] || ''}${b.provider ? ' · ' + h(b.provider) : ''}${b.start_date ? ' · from ' + fmtDate(b.start_date) : ''}${b.end_date ? ' to ' + fmtDate(b.end_date) : ''}</div></div><button class="sm" data-act="benefitEdit" data-id="${b.id}">Edit</button></li>`).join('')}</ul>` : '<div class="empty">No benefits recorded.</div>'}</div></div></div>
    <div class="card" style="margin-top:16px"><h2>Payslips</h2>${slipTable(d.payslips.map((s) => ({ ...s, employee_id: e.id })), false)}</div>
    ${d.freelance.length || e.employment_type === 'freelancer' ? `<div class="card" style="margin-top:16px"><div class="toolbar"><h2 style="margin:0">Freelance jobs</h2></div>${flTable(flCache)}</div>` : ''}
    <p style="margin-top:24px"><button class="danger sm" data-act="empDelete" data-id="${e.id}">Delete employee</button></p>`;
};

PAGES.payslip = async (m, [id]) => {
  const { payslip: s, employee: e, settings: c } = await api('GET', `/payslips/${id}`);
  const cur = s.currency;
  const rows = (arr) => arr.map((l) => `<tr><td>${h(l.name)}</td><td class="right num">${money(l.amount, cur)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">—</td></tr>';
  m.innerHTML = pageHead(`Payslip · ${monthName(s.month)} ${s.status === 'paid' ? badge('paid') : badge('draft', 'Unpaid')}`,
    `<button data-act="print">Print / Save PDF</button>${s.status !== 'paid' ? `<button data-act="slipEdit" data-id="${s.id}">Edit</button><button class="primary" data-act="slipPay" data-id="${s.id}">Mark paid</button>` : ''}`,
    `<a href="#/employee/${e.id}">${h(e.official_name)}</a> · <a href="#/employees/payroll/${s.month}">Payroll</a>`)
    + `<div class="invoice"><div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap">
        <div><h1 style="font-size:20px">${h(c.company_name)}</h1><div class="muted pre small">${h([c.company_address, c.company_email, c.company_phone].filter(Boolean).join('\n'))}</div></div>
        <div style="text-align:right"><div style="font-size:22px;font-weight:700;letter-spacing:.04em">PAYSLIP</div><div><b>${monthName(s.month)}</b></div>${s.status === 'paid' ? `<div class="small">Paid on ${fmtDate(s.paid_date)}${s.method ? ' · ' + h(s.method) : ''}</div>` : ''}</div></div>
      <table style="margin:24px 0 18px"><tbody>
        <tr><td class="muted">Employee name</td><td><b>${h(e.official_name)}</b></td><td class="muted">Employee code</td><td>${h(e.employee_code || '—')}</td></tr>
        <tr><td class="muted">Designation</td><td>${h(e.designation || '—')}</td><td class="muted">Department</td><td>${h(e.department || '—')}</td></tr>
        <tr><td class="muted">Date of joining</td><td>${fmtDate(e.join_date)}</td><td class="muted">Paid days</td><td>${s.paid_days ?? '—'} of ${s.working_days ?? '—'}</td></tr></tbody></table>
      <div class="grid g2"><div><table><thead><tr><th>Earnings</th><th class="right">Amount</th></tr></thead><tbody>${rows(s.earnings)}<tr><td><b>Gross earnings</b></td><td class="right num"><b>${money(s.gross, cur)}</b></td></tr></tbody></table></div>
        <div><table><thead><tr><th>Deductions</th><th class="right">Amount</th></tr></thead><tbody>${rows(s.deductions)}<tr><td><b>Total deductions</b></td><td class="right num"><b>${money(s.total_deductions, cur)}</b></td></tr></tbody></table></div></div>
      <div class="totals" style="width:320px"><div class="grand"><span>Net pay (${h(cur)})</span><span class="num">${money(s.net, cur)}</span></div></div>
      ${s.notes ? `<div style="margin-top:18px"><div class="muted small">NOTES</div><div class="pre small">${h(s.notes)}</div></div>` : ''}
      <p class="muted small" style="margin-top:28px">This is a computer-generated payslip and does not need a signature.</p></div>
    <p class="no-print" style="margin-top:20px"><button class="danger sm" data-act="slipDelete" data-id="${s.id}">Delete payslip</button></p>`;
};
