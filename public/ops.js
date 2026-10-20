'use strict';
/* Procurement (domains, SSL, hosting…), freelance work, services catalog and currency rates. Loaded after app.js. */

const PROC_STATUS = [['active', 'Active'], ['pending', 'Pending purchase'], ['expired', 'Expired'], ['cancelled', 'Cancelled'], ['transferred', 'Transferred out']];
let PROC_TYPES = { domain: 'Domain', ssl: 'SSL certificate', hosting: 'Hosting', email: 'Email / Workspace', server: 'Server / VPS', cdn: 'CDN / DNS', theme_plugin: 'Theme / plugin licence', software: 'Software / SaaS', backup: 'Backup / security', maintenance: 'Maintenance plan', other: 'Other' };
const FL_STATUS = { assigned: 'Assigned', in_progress: 'In progress', submitted: 'Submitted', approved: 'Approved', paid: 'Paid', cancelled: 'Cancelled' };
const CAT_CATS = { domain: 'Domain', ssl: 'SSL', hosting: 'Hosting', email: 'Email', seo: 'SEO', design: 'Design', development: 'Development', maintenance: 'Maintenance', marketing: 'Marketing / Ads', content: 'Content', social_media: 'Social media', other: 'Other' };
Object.assign(badgeClass, { expired: 'b-bad', transferred: '', assigned: '', submitted: 'b-info', approved: 'b-accent' });

// ---------------- currencies ----------------
ACT.curEdit = (ds) => openModal({
  title: ds.code ? `Update ${ds.code} rate` : 'Add currency',
  body: formHTML([
    { name: 'code', label: 'Currency code', required: true, placeholder: 'USD', help: 'Three letters: USD, EUR, GBP, AED, AUD, CAD, SGD…' },
    { name: 'rate', label: `1 unit equals how many ${S.cur.base}?`, type: 'number', required: true },
  ], { code: ds.code || '', rate: ds.rate || '' }),
  onOpen: (f) => { if (ds.code) $('[name=code]', f).readOnly = true; },
  onSubmit: async (d) => {
    await api('PUT', `/currencies/${encodeURIComponent(d.code.trim())}`, { rate: d.rate });
    S.cur = await api('GET', '/currencies');
    toast('Exchange rate saved'); refresh();
  },
});
ACT.curDelete = async (ds) => {
  if (!(await confirmBox('Remove currency?', `Remove ${ds.code}? Existing records keep their saved rates.`, 'Remove'))) return;
  await api('DELETE', `/currencies/${ds.code}`);
  S.cur = await api('GET', '/currencies'); refresh();
};

// ---------------- procurement ----------------
function procTable(items, showSite = true) {
  if (!items.length) return '<div class="empty">Nothing here yet.</div>';
  const fin = can('finance_view');
  return `<div class="table-wrap"><table><thead><tr><th>Item</th>${showSite ? '<th>Website / client</th>' : ''}<th>Vendor</th><th>Expires</th><th>Renews</th>${fin ? '<th class="right">Our cost</th><th class="right">Client price</th><th class="right">Margin</th>' : ''}<th>Status</th><th></th></tr></thead><tbody>
    ${items.map((p) => `<tr><td><b>${h(p.item)}</b><div>${badge('', p.type_label)}${p.auto_renew ? ' <span class="badge b-info">Auto-renew</span>' : ''}</div>${p.notes ? `<div class="muted small pre">${h(p.notes.slice(0, 120))}</div>` : ''}</td>
      ${showSite ? `<td class="small">${p.website_id ? `<a href="#/website/${p.website_id}/services">${h(p.website_name)}</a>` : '—'}${p.client_name ? `<br><span class="muted">${h(p.client_name)}</span>` : ''}</td>` : ''}
      <td class="small">${h(p.vendor || '—')}${p.vendor_account ? `<br><span class="muted">${h(p.vendor_account)}</span>` : ''}</td>
      <td>${p.expiry_date ? (['active', 'pending'].includes(p.status) ? dueBadge(p.expiry_date) : fmtDate(p.expiry_date)) : '—'}${p.days_left !== null && p.days_left > 7 && ['active', 'pending'].includes(p.status) ? `<div class="muted small">${p.days_left} days</div>` : ''}</td>
      <td class="small">${CYCLE[p.billing_cycle] || '—'}</td>
      ${fin ? `<td class="right num">${money(p.cost, p.cost_currency)}</td><td class="right num">${money(p.price, p.price_currency)}</td><td class="right num ${p.margin_base < 0 ? 'down' : ''}">${money(p.margin_base)}</td>` : ''}
      <td>${badge(p.status)}</td>
      <td class="right nowrap">${can('websites_edit') && CYCLE_MONTHS_UI[p.billing_cycle] ? `<button class="sm" data-act="procRenew" data-id="${p.id}">Renew</button> ` : ''}${can('finance_edit') && p.price > 0 ? `<button class="sm" data-act="procInvoice" data-id="${p.id}">Bill</button> ` : ''}${can('websites_edit') ? `<button class="sm" data-act="procEdit" data-id="${p.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
const CYCLE_MONTHS_UI = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
let procCache = [];
async function procForm(p = {}) {
  const sites = await api('GET', '/websites');
  const FE = can('finance_edit');
  const isNew = !p.id;
  return formHTML([
    { name: 'website_id', label: 'Website', type: 'select', options: opts(sites, can('all_websites') ? '— Not linked to a website —' : undefined) },
    { name: 'type', label: 'Type', type: 'select', options: enumOpts(PROC_TYPES) },
    { name: 'item', label: 'Item', required: true, placeholder: 'example.com · Wildcard SSL · Business hosting plan' },
    { name: 'vendor', label: 'Vendor / provider', placeholder: 'GoDaddy, Namecheap, Hostinger, Sectigo, AWS…' },
    { name: 'vendor_account', label: 'Vendor account', placeholder: 'Which login it was bought under' },
    { name: 'status', label: 'Status', type: 'select', options: PROC_STATUS },
    { name: 'purchase_date', label: 'Purchase date', type: 'date' },
    { name: 'expiry_date', label: 'Expiry / renewal date', type: 'date', help: isNew ? 'Leave empty to calculate from the renewal cycle' : '' },
    { name: 'billing_cycle', label: 'Renews every', type: 'select', options: enumOpts(CYCLE) },
    { name: 'auto_renew', label: 'Auto-renew is on at the vendor', type: 'checkbox' },
    FE ? { type: 'html', full: true, html: '<h3 style="margin-top:6px">Cost & price</h3>' } : null,
    FE ? { name: 'cost', label: 'Our cost (paid to vendor)', type: 'number' } : null,
    FE ? currencyField('cost_currency', 'Cost currency') : null,
    FE ? { name: 'price', label: 'Price charged to client', type: 'number' } : null,
    FE ? currencyField('price_currency', 'Price currency', '— Client billing currency —') : null,
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, placeholder: 'Nameservers, CSR details, plan limits, transfer codes (store passwords in the vault)…' },
    isNew && FE ? { name: 'record_expense', label: 'Record the purchase cost as an expense now', type: 'checkbox' } : null,
    isNew && FE ? { name: 'create_invoice', label: 'Create a draft invoice for the client price', type: 'checkbox' } : null,
  ], { type: 'domain', status: 'active', billing_cycle: 'yearly', purchase_date: todayStr(), cost_currency: S.cur.base, ...p, auto_renew: !!p.auto_renew });
}
ACT.procNew = async (ds) => openModal({
  title: 'Add domain / SSL / hosting / service', wide: true, body: await procForm({ website_id: ds.site || '', type: ds.type || 'domain' }),
  onSubmit: async (d) => {
    const r = await api('POST', '/procurements', d);
    toast(r.invoice ? `Saved — invoice ${r.invoice.number} created` : 'Saved');
    refresh();
  },
});
ACT.procEdit = async (ds) => {
  let p = procCache.find((x) => x.id === +ds.id);
  if (!p) { procCache = (await api('GET', '/procurements')).items; p = procCache.find((x) => x.id === +ds.id); }
  const m = openModal({
    title: `Edit ${p.item}`, wide: true, body: (await procForm(p)) + '<p style="margin-top:14px"><button type="button" class="danger sm" data-act="procDelete">Delete</button></p>',
    onSubmit: async (d) => { await api('PUT', `/procurements/${p.id}`, d); toast('Saved'); refresh(); },
  });
  ACT.procDelete = async () => { if (await confirmBox('Delete item?', `Delete ${p.item}? Recorded expenses stay.`)) { await api('DELETE', `/procurements/${p.id}`); m.close(); refresh(); } };
};
ACT.procRenew = async (ds) => {
  const p = procCache.find((x) => x.id === +ds.id) || (await api('GET', '/procurements')).items.find((x) => x.id === +ds.id);
  const FE = can('finance_edit');
  openModal({
    title: `Renew ${p.item}`, submit: 'Renew',
    body: `<p>Moves the expiry from <b>${fmtDate(p.expiry_date)}</b> forward by one ${h((CYCLE[p.billing_cycle] || '').toLowerCase())} cycle.</p>${FE ? formHTML([
      { name: 'record_expense', label: `Record the renewal cost as an expense${p.cost ? ` (${money(p.cost, p.cost_currency)})` : ''}`, type: 'checkbox', value: p.cost > 0, full: true },
      { name: 'create_invoice', label: `Create a draft invoice for the client${p.price ? ` (${money(p.price, p.price_currency)})` : ''}`, type: 'checkbox', value: p.price > 0, full: true },
    ]) : ''}`,
    onSubmit: async (d) => {
      const r = await api('POST', `/procurements/${p.id}/renew`, d);
      toast(`Renewed until ${fmtDate(r.expiry_date)}${r.invoice ? ` · invoice ${r.invoice.number}` : ''}`);
      refresh();
    },
  });
};
ACT.procInvoice = async (ds) => {
  const r = await api('POST', `/procurements/${ds.id}/invoice`);
  toast(`Invoice ${r.number} created`);
  location.hash = `#/invoice/${r.id}`;
};
PAGES.procurement = async (m) => {
  const r = await api('GET', '/procurements');
  PROC_TYPES = r.types;
  procCache = r.items;
  const live = r.items.filter((p) => ['active', 'pending'].includes(p.status));
  const exp30 = live.filter((p) => p.days_left !== null && p.days_left <= 30).length;
  const fin = can('finance_view');
  m.innerHTML = pageHead('Domains, SSL & hosting', `${fin ? '<a class="btn" href="/api/export/procurements.csv">Export CSV</a>' : ''}${can('websites_edit') ? '<button class="primary" data-act="procNew">+ Add item</button>' : ''}`, 'Everything you buy for clients: domains, SSL, hosting, email, servers, licences — with costs, prices and renewals')
    + `<div class="kpis"><div class="kpi"><div class="label">Active items</div><div class="value">${live.length}</div></div>
      <div class="kpi"><div class="label">Expiring in 30 days</div><div class="value ${exp30 ? 'down' : ''}">${exp30}</div></div>
      <div class="kpi"><div class="label">Expired / lapsed</div><div class="value">${r.items.filter((p) => p.status === 'expired' || (['active', 'pending'].includes(p.status) && p.days_left !== null && p.days_left < 0)).length}</div></div>
      ${fin ? `<div class="kpi"><div class="label">Margin on active items</div><div class="value">${money(live.reduce((s, p) => s + p.margin_base, 0))}</div><div class="sub">per renewal cycle</div></div>` : ''}</div>
    <div class="card"><div class="toolbar"><input type="search" id="pq" placeholder="Search item, vendor, website…">
      <select id="pt"><option value="">All types</option>${enumOpts(PROC_TYPES).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('')}</select>
      <select id="ps"><option value="live">Active & pending</option><option value="soon">Expiring in 30 days</option><option value="">All statuses</option>${PROC_STATUS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="plist"></div></div>`;
  const draw = () => {
    const q = $('#pq').value.toLowerCase(), t = $('#pt').value, st = $('#ps').value;
    $('#plist').innerHTML = procTable(r.items.filter((p) => (!t || p.type === t)
      && (st === 'live' ? ['active', 'pending'].includes(p.status) : st === 'soon' ? ['active', 'pending'].includes(p.status) && p.days_left !== null && p.days_left <= 30 : !st || p.status === st)
      && (!q || [p.item, p.vendor, p.website_name, p.client_name, p.type_label].join(' ').toLowerCase().includes(q))));
  };
  ['#pq', '#pt', '#ps'].forEach((s) => $(s).addEventListener('input', draw));
  draw();
};

// Website → "Domains & services" tab: procurements and freelance work for this website.
async function siteServicesTab(w) {
  const showFl = can('hr_manage') || can('finance_edit');
  const [pr, jobs] = await Promise.all([api('GET', `/procurements?website_id=${w.id}`), showFl ? api('GET', `/freelance?website_id=${w.id}`) : null]);
  procCache = pr.items;
  return `<div class="toolbar"><h2 style="margin:0">Domains, SSL, hosting & services</h2><span style="margin-left:auto"></span>${can('websites_edit') ? `<button class="primary" data-act="procNew" data-site="${w.id}">+ Add item</button>` : ''}</div>
    <div class="card" style="margin-bottom:16px">${procTable(pr.items, false)}</div>
    ${showFl ? `<div class="toolbar"><h2 style="margin:0">Freelance work on this website</h2><span style="margin-left:auto"></span><button data-act="flNew" data-site="${w.id}">+ Freelance job</button></div><div class="card">${flTable(jobs, false)}</div>` : ''}`;
}

// ---------------- freelance work ----------------
let flCache = [];
function flTable(rows, showSite = true) {
  flCache = rows;
  if (!rows.length) return '<div class="empty">No freelance jobs.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Job</th><th>Freelancer</th>${showSite ? '<th>Website</th>' : ''}<th>Due</th><th class="right">Agreed</th><th class="right">Paid</th><th class="right">Balance</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((j) => `<tr><td><b>${h(j.title)}</b>${j.description ? `<div class="muted small pre">${h(j.description.slice(0, 160))}</div>` : ''}<div class="muted small">Assigned ${fmtDate(j.assigned_date)}</div></td>
      <td>${j.employee_id && can('hr_manage') ? `<a href="#/employee/${j.employee_id}">${h(j.freelancer)}</a>` : h(j.freelancer || '—')}</td>
      ${showSite ? `<td>${j.website_id ? `<a href="#/website/${j.website_id}/services">${h(j.website_name)}</a>` : '—'}</td>` : ''}
      <td>${['paid', 'cancelled'].includes(j.status) ? fmtDate(j.due_date) : dueBadge(j.due_date)}</td>
      <td class="right num">${money(j.amount, j.currency)}</td><td class="right num">${j.paid ? `<button class="link" data-act="flHistory" data-id="${j.id}">${money(j.paid, j.currency)}</button>` : money(0, j.currency)}</td>
      <td class="right num ${j.balance > 0 && j.status === 'approved' ? 'down' : ''}">${money(j.balance, j.currency)}</td><td>${badge(j.status, FL_STATUS[j.status])}</td>
      <td class="right nowrap">${can('finance_edit') && j.balance > 0 && j.status !== 'cancelled' ? `<button class="sm" data-act="flPay" data-id="${j.id}">Pay</button> ` : ''}<button class="sm" data-act="flEdit" data-id="${j.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function flForm() {
  const [people, sites] = await Promise.all([api('GET', '/employees/directory'), api('GET', '/websites')]);
  const fl = people.filter((p) => p.employment_type === 'freelancer'), others = people.filter((p) => p.employment_type !== 'freelancer');
  const peopleOpts = [['', '— Not in employee list (type name below) —'], ...fl.map((p) => [p.id, `${p.name} (freelancer)`]), ...others.map((p) => [p.id, p.name])];
  return [
    { name: 'title', label: 'Job / task', required: true, full: true, placeholder: 'Logo design, 10 blog articles, landing page build…' },
    { name: 'employee_id', label: 'Freelancer', type: 'select', options: peopleOpts },
    { name: 'freelancer_name', label: 'Or freelancer name', placeholder: 'e.g. Asha (Fiverr)' },
    { name: 'website_id', label: 'Website / project', type: 'select', options: opts(sites, '— Internal / none —') },
    { name: 'status', label: 'Status', type: 'select', options: enumOpts(FL_STATUS) },
    { name: 'amount', label: 'Agreed amount', type: 'number' },
    currencyField(),
    { name: 'assigned_date', label: 'Assigned on', type: 'date' },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'description', label: 'Details / deliverables', type: 'textarea', full: true },
  ];
}
ACT.flNew = async (ds) => openModal({
  title: 'New freelance job', wide: true, body: formHTML(await flForm(), { website_id: ds.site || '', status: 'assigned', assigned_date: todayStr(), currency: S.cur.base }),
  onSubmit: async (d) => { await api('POST', '/freelance', d); toast('Freelance job added'); refresh(); },
});
ACT.flEdit = async (ds) => {
  const j = flCache.find((x) => x.id === +ds.id);
  const m = openModal({
    title: `Edit: ${j.title}`, wide: true, body: formHTML(await flForm(), j) + '<p style="margin-top:14px"><button type="button" class="danger sm" data-act="flDelete">Delete job</button></p>',
    onSubmit: async (d) => { await api('PUT', `/freelance/${j.id}`, d); toast('Saved'); refresh(); },
  });
  ACT.flDelete = async () => {
    if (await confirmBox('Delete job?', j.paid ? 'Its recorded payments will be deleted too.' : 'Delete this freelance job?')) { await api('DELETE', `/freelance/${j.id}`); m.close(); refresh(); }
  };
};
ACT.flPay = (ds) => {
  const j = flCache.find((x) => x.id === +ds.id);
  openModal({
    title: `Pay freelancer — ${j.title}`, submit: 'Record payment',
    body: `<p class="muted">Agreed ${money(j.amount, j.currency)} · already paid ${money(j.paid, j.currency)}. Recorded as an expense on ${j.website_name ? h(j.website_name) : 'the company'}.</p>` + formHTML([
      { name: 'amount', label: `Amount (${j.currency})`, type: 'number', required: true },
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'method', label: 'Method', placeholder: 'UPI, bank, PayPal, Fiverr…' },
      { name: 'note', label: 'Note' },
    ], { amount: j.balance, date: todayStr() }),
    onSubmit: async (d) => { await api('POST', `/freelance/${j.id}/pay`, d); toast('Payment recorded'); refresh(); },
  });
};
ACT.flHistory = async (ds) => {
  const rows = await api('GET', `/freelance/${ds.id}/payments`);
  openModal({ title: 'Payments made', body: rows.length ? `<ul class="list">${rows.map((p) => `<li><div class="grow">${fmtDate(p.date)}<div class="muted small">${h([p.method, p.note].filter(Boolean).join(' · '))}</div></div><b class="num">${money(p.amount, p.currency)}</b></li>`).join('')}</ul><p class="muted small">To undo a payment, delete it under Finance → Payments & expenses.</p>` : '<div class="empty">None</div>' });
};
PAGES.freelance = async (m) => {
  m.innerHTML = pageHead('Freelance work', `${can('finance_view') ? '<a class="btn" href="/api/export/freelance.csv">Export CSV</a>' : ''}<button class="primary" data-act="flNew">+ New freelance job</button>`, 'Jobs given to freelancers, agreed amounts and what has been paid')
    + '<div class="kpis" id="flk"></div><div class="card"><div class="toolbar"><select id="fls"><option value="open">Open (not fully paid)</option><option value="">All</option>' + enumOpts(FL_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('') + '</select><input type="search" id="flq" placeholder="Search job, freelancer, website…"></div><div id="fll"></div></div>';
  let rows = [];
  const draw = () => {
    const q = $('#flq').value.toLowerCase();
    $('#fll').innerHTML = flTable(rows.filter((j) => !q || [j.title, j.freelancer, j.website_name].join(' ').toLowerCase().includes(q)));
  };
  const load = async () => {
    rows = await api('GET', '/freelance?status=' + $('#fls').value);
    const byCur = {};
    for (const j of rows) if (j.status !== 'cancelled') { byCur[j.currency] ||= { agreed: 0, paid: 0, balance: 0 }; byCur[j.currency].agreed += j.amount; byCur[j.currency].paid += j.paid; byCur[j.currency].balance += j.balance; }
    $('#flk').innerHTML = `<div class="kpi"><div class="label">Jobs shown</div><div class="value">${rows.length}</div></div>` + Object.entries(byCur).map(([c, v]) => `<div class="kpi"><div class="label">Balance to pay (${h(c)})</div><div class="value">${money(v.balance, c)}</div><div class="sub">Agreed ${money(v.agreed, c)} · paid ${money(v.paid, c)}</div></div>`).join('');
    draw();
  };
  $('#fls').addEventListener('change', load);
  $('#flq').addEventListener('input', draw);
  await load();
};

// ---------------- services catalog ----------------
let catCache = [];
const catFields = () => [
  { name: 'name', label: 'Service name', required: true, placeholder: 'Wildcard SSL, SEO Starter, AMC, Google Ads management…' },
  { name: 'category', label: 'Category', type: 'select', options: enumOpts(CAT_CATS) },
  { name: 'price', label: 'Price to client', type: 'number' },
  can('finance_view') ? { name: 'cost', label: 'Our cost', type: 'number' } : null,
  currencyField(),
  { name: 'billing_cycle', label: 'Billing', type: 'select', options: enumOpts(CYCLE) },
  { name: 'active', label: 'Active (show in invoice editor)', type: 'checkbox' },
  { name: 'description', label: 'Description (added to invoice line)', type: 'textarea', full: true },
];
async function catalogPage(m, tabs) {
  catCache = await api('GET', '/catalog');
  const FE = can('finance_edit'), fin = can('finance_view');
  m.innerHTML = pageHead('Finance', FE ? '<button class="primary" data-act="catNew">+ Add service</button>' : '') + tabs
    + `<div class="card"><p class="muted small">Your price list of extra services: domains, SSL, hosting, SEO, maintenance and more. Pick them when creating invoices.</p>${catCache.length ? `<div class="table-wrap"><table><thead><tr><th>Service</th><th>Category</th><th>Billing</th><th class="right">Price</th>${fin ? '<th class="right">Cost</th><th class="right">Margin</th>' : ''}<th></th></tr></thead><tbody>
      ${catCache.map((c) => `<tr class="${c.active ? '' : 'muted'}"><td><b>${h(c.name)}</b>${c.active ? '' : ' <span class="badge">Inactive</span>'}${c.description ? `<div class="muted small">${h(c.description)}</div>` : ''}</td><td>${badge('', CAT_CATS[c.category])}</td><td>${CYCLE[c.billing_cycle]}</td>
        <td class="right num">${money(c.price, c.currency)}</td>${fin ? `<td class="right num">${money(c.cost, c.currency)}</td><td class="right num">${money(c.price - c.cost, c.currency)}</td>` : ''}
        <td class="right">${FE ? `<button class="sm" data-act="catEdit" data-id="${c.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No services yet. Add your standard packages and add-ons.</div>'}</div>`;
}
ACT.catNew = () => openModal({ title: 'Add service', wide: true, body: formHTML(catFields(), { category: 'other', billing_cycle: 'one_time', active: true, currency: S.cur.base }), onSubmit: async (d) => { await api('POST', '/catalog', d); refresh(); } });
ACT.catEdit = (ds) => {
  const c = catCache.find((x) => x.id === +ds.id);
  const m = openModal({
    title: `Edit ${c.name}`, wide: true, body: formHTML(catFields(), { ...c, active: !!c.active }) + '<p style="margin-top:14px"><button type="button" class="danger sm" data-act="catDelete">Delete</button></p>',
    onSubmit: async (d) => { await api('PUT', `/catalog/${c.id}`, d); refresh(); },
  });
  ACT.catDelete = async () => { if (await confirmBox('Delete service?', c.name)) { await api('DELETE', `/catalog/${c.id}`); m.close(); refresh(); } };
};
