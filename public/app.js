'use strict';
/* Agency Vault — single-page admin app (no build step). */

// ---------- basics ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toLocaleDateString('en-CA');
const S = { me: null, settings: {}, users: null };
const can = (p) => !!(S.me && S.me.perms[p]);
const isAdmin = () => ['owner', 'admin'].includes(S.me?.role);
let uid = 0;

async function api(method, url, body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && S.me) { S.me = null; route(); }
    if (data.code === 'must_change' && S.me) { S.me.must_change_password = true; location.hash = '#/account'; }
    throw new Error(data.error || `Request failed (${r.status})`);
  }
  return data;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { prompt('Copy this:', text); }
}

// ---------- formatting ----------
function money(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: S.settings.currency || 'INR', maximumFractionDigits: 2 }).format(n || 0);
  } catch { return (S.settings.currency || '') + ' ' + Number(n || 0).toFixed(2); }
}
const compact = (n) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
function fmtDate(d) {
  if (!d) return '—';
  const dt = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z');
  return isNaN(dt) ? h(d) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z');
  return dt.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function daysUntil(d) { return Math.round((new Date(d + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5); }
function dueBadge(d) {
  if (!d) return '<span class="muted">—</span>';
  const n = daysUntil(d);
  if (n < 0) return `<span class="badge b-bad" title="${fmtDate(d)}">Overdue ${-n}d</span>`;
  if (n === 0) return `<span class="badge b-warn">Today</span>`;
  if (n <= 7) return `<span class="badge b-warn" title="${fmtDate(d)}">In ${n}d</span>`;
  return `<span class="nowrap">${fmtDate(d)}</span>`;
}
function safeUrl(u) { if (!u) return ''; return /^https?:\/\//i.test(u) ? u : 'https://' + u; }
const extLink = (u, text) => (u ? `<a href="${h(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${h(text || u)}</a>` : '—');

const CYCLE = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };
const FREQ = { once: 'One-time', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };
const CRED = { email: 'Email', hosting: 'Hosting', server: 'Server / VPS', domain: 'Domain registrar', cms: 'CMS / Admin panel', ftp: 'FTP / SFTP', database: 'Database', social: 'Social media', analytics: 'Analytics / Search Console', payment: 'Payment gateway', api: 'API key', other: 'Other' };
const NOTE = { comment: 'Comment', commercial: 'Commercial / Deal', approach: 'New approach / Idea', update: 'Update', issue: 'Issue', meeting: 'Meeting', task: 'Task log' };
const SOCIAL = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X / Twitter', youtube: 'YouTube', pinterest: 'Pinterest', google_business: 'Google Business', whatsapp: 'WhatsApp', other: 'Other link' };
const PERM_LABEL = {
  all_websites: 'See all websites (otherwise only assigned ones)',
  websites_edit: 'Add & edit websites',
  credentials_view: 'View passwords in vault',
  credentials_edit: 'Add & edit passwords',
  finance_view: 'View pricing, revenue & invoices',
  finance_edit: 'Create invoices & record payments',
  clients_manage: 'Manage clients, onboarding & follow-ups',
  tasks_manage: "Assign & manage everyone's tasks",
  users_manage: 'Manage team members',
};
const ONBOARD_ITEMS = [
  ['Hosting / cPanel login', 'hosting'], ['Domain registrar login', 'domain'], ['Business email access', 'email'],
  ['Website admin (WordPress / CMS) login', 'cms'], ['FTP / SFTP access', 'ftp'], ['Database access', 'database'],
  ['Google Analytics access', 'analytics'], ['Google Search Console access', 'analytics'], ['Google Business Profile access', 'social'],
  ['Facebook page access', 'social'], ['Instagram access', 'social'], ['LinkedIn page access', 'social'], ['YouTube channel access', 'social'],
  ['Billing / invoice details', 'billing'], ['Brand assets (logo, colours, fonts)', 'other'],
];

const badgeClass = {
  onboarding: 'b-info', active: 'b-good', paused: 'b-warn', exited: 'b-bad', lead: 'b-info', inactive: 'b-warn',
  draft: '', sent: 'b-accent', overdue: 'b-bad', paid: 'b-good', cancelled: '',
  todo: '', in_progress: 'b-accent', done: 'b-good', pending: 'b-warn', submitted: 'b-info', completed: 'b-good',
  urgent: 'b-bad', high: 'b-warn', normal: '', low: '', income: 'b-good', expense: 'b-bad',
  owner: 'b-accent', admin: 'b-accent', manager: 'b-info', member: '', viewer: '', disabled: 'b-bad',
  commercial: 'b-good', approach: 'b-info', issue: 'b-bad', meeting: 'b-accent', update: 'b-warn', task: '', comment: '',
};
const badge = (v, label) => (v ? `<span class="badge ${badgeClass[v] || ''}">${h(label || String(v).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</span>` : '');

// ---------- data helpers ----------
async function userOptions() {
  if (!S.users) S.users = await api('GET', '/users/options');
  return S.users;
}
const opts = (rows, empty, val = 'id', lab = 'name') => [...(empty !== undefined ? [['', empty]] : []), ...rows.map((r) => [r[val], r[lab]])];
const enumOpts = (obj) => Object.entries(obj);
const canSeeClients = () => can('clients_manage') || can('finance_view');
async function clientOptions() { return canSeeClients() ? api('GET', '/clients') : []; }

// ---------- forms & modals ----------
function field(f, vals) {
  const v = vals[f.name] ?? f.value ?? '';
  const id = 'f' + ++uid;
  const wrap = (inner) => `<div class="${f.full ? 'full' : ''}">${inner}${f.help ? `<div class="help">${h(f.help)}</div>` : ''}</div>`;
  if (f.type === 'html') return `<div class="${f.full ? 'full' : ''}">${f.html}</div>`;
  if (f.type === 'checkbox') return wrap(`<label class="check"><input type="checkbox" name="${h(f.name)}" ${v ? 'checked' : ''}> ${h(f.label)}</label>`);
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${h(f.name)}" ${req} placeholder="${h(f.placeholder || '')}">${h(v)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${h(f.name)}" ${req}>${f.options.map(([ov, ol]) => `<option value="${h(ov)}" ${String(ov) === String(v ?? '') ? 'selected' : ''}>${h(ol)}</option>`).join('')}</select>`;
  else input = `<input id="${id}" type="${f.type || 'text'}" name="${h(f.name)}" value="${h(v)}" ${req} ${f.type === 'number' ? 'step="any"' : ''} placeholder="${h(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}">`;
  return wrap(`<label for="${id}">${h(f.label)}${f.required ? ' *' : ''}</label>${input}`);
}
const formHTML = (fields, vals = {}) => `<div class="form">${fields.filter(Boolean).map((f) => field(f, vals)).join('')}</div>`;

function readForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.name.endsWith('[]')) {
      const k = el.name.slice(0, -2);
      o[k] ||= [];
      if (el.checked) o[k].push(el.value);
      continue;
    }
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.name.includes('.')) { const [a, b] = el.name.split('.'); (o[a] ||= {})[b] = v; continue; }
    o[el.name] = v;
  }
  return o;
}

function openModal({ title, body, submit = 'Save', wide, onSubmit, onOpen, cancel = 'Cancel' }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate><h2>${h(title)}</h2><div class="mbody">${body}</div>
    <div class="err hidden"></div><div class="foot"><button type="button" data-close>${h(onSubmit ? cancel : 'Close')}</button>${onSubmit ? `<button class="primary" type="submit">${h(submit)}</button>` : ''}</div></form>`;
  document.body.appendChild(ov);
  const form = $('form', ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = $('[type=submit]', form);
    const err = $('.err', form);
    btn.disabled = true;
    err.classList.add('hidden');
    try {
      const keep = await onSubmit(readForm(form), form);
      if (keep !== true) close();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
  if (onOpen) onOpen(form);
  setTimeout(() => $('input:not([type=checkbox]),select,textarea', form)?.focus(), 0);
  return { close, form };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.overlay').pop()?.remove(); });

function confirmBox(title, message, submit = 'Delete') {
  return new Promise((resolve) => {
    const m = openModal({ title, body: `<p>${h(message)}</p>`, submit, onSubmit: async () => resolve(true) });
    $('[data-close]', m.form).addEventListener('click', () => resolve(false));
  });
}
function showSecret(title, text, note) {
  openModal({
    title,
    body: `<div class="secret-box">${h(text)}</div>${note ? `<p class="muted small">${h(note)}</p>` : ''}<p><button type="button" class="primary" data-act="copy" data-text="${h(text)}">Copy</button></p>`,
  });
}

// ---------- tooltip ----------
const tip = document.createElement('div');
tip.id = 'tip';
tip.className = 'hidden';
document.body.appendChild(tip);
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) return tip.classList.add('hidden');
  tip.textContent = el.dataset.tip;
  tip.classList.remove('hidden');
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + 'px';
  tip.style.top = Math.max(8, e.clientY - r.height - 12) + 'px';
});

// ---------- chart ----------
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function roundedTop(x, y, w, hgt, r) {
  r = Math.min(r, hgt, w / 2);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}
const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' });
function barChart(rows, series, fmt = (n) => n, integer = false) {
  const W = 480, H = 220, pl = 44, pr = 6, pt = 10, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
  let max = niceMax(Math.max(0, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0))));
  if (integer) max = Math.max(4, Math.ceil(max / 4) * 4);
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - (ih * i) / 4;
    svg += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text class="axis-text" x="${pl - 6}" y="${y + 4}" text-anchor="end">${h(compact((max * i) / 4))}</text>`;
  }
  const gw = iw / rows.length, n = series.length, gap = 2;
  const bw = Math.max(3, Math.min(16, (gw - 10 - gap * (n - 1)) / n));
  rows.forEach((r, i) => {
    const x0 = pl + i * gw + (gw - (bw * n + gap * (n - 1))) / 2;
    series.forEach((s, j) => {
      const v = r[s.key] || 0;
      const bh = (ih * v) / max;
      if (bh > 0) svg += `<path d="${roundedTop(x0 + j * (bw + gap), pt + ih - bh, bw, bh, 4)}" fill="var(${s.color})"/>`;
    });
    svg += `<text class="axis-text" x="${pl + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${h(r.label)}</text>`;
    const tipText = [r.full || r.label, ...series.map((s) => `${s.label}: ${fmt(r[s.key] || 0)}`)].join('\n');
    svg += `<rect class="hit" x="${pl + i * gw}" y="${pt}" width="${gw}" height="${ih}" rx="4" data-tip="${h(tipText)}"/>`;
  });
  const legend = series.length > 1 ? `<div class="chart-legend">${series.map((s) => `<span><i style="background:var(${s.color})"></i>${h(s.label)}</span>`).join('')}</div>` : '';
  const table = `<details><summary>View as table</summary><div class="table-wrap"><table><thead><tr><th>Period</th>${series.map((s) => `<th class="right">${h(s.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${h(r.full || r.label)}</td>${series.map((s) => `<td class="right num">${h(fmt(r[s.key] || 0))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  return `<div class="chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img">${svg}</svg>${table}</div>`;
}

// ---------- routing & shell ----------
const NAV = [
  ['dashboard', 'Dashboard', () => true],
  ['websites', 'Websites', () => true],
  ['tasks', 'Tasks', () => true],
  ['clients', 'Clients', canSeeClients],
  ['onboarding', 'Client onboarding', () => can('clients_manage')],
  ['followups', 'Follow-ups', () => can('clients_manage') || can('finance_edit')],
  ['finance', 'Finance & invoices', () => can('finance_view')],
  ['-'],
  ['team', 'Team & roles', () => can('users_manage')],
  ['settings', 'Company settings', isAdmin],
  ['audit', 'Activity log', isAdmin],
  ['account', 'My account', () => true],
];
const PAGES = {};

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const root = $('#root');
  if (parts[0] === 'reset') return renderReset(root, parts[1]);
  if (!S.me) {
    try {
      const r = await api('GET', '/auth/me');
      S.me = r.user; S.settings = r.settings;
    } catch {
      const st = await api('GET', '/setup').catch(() => ({}));
      return st.needsSetup ? renderSetup(root) : renderLogin(root);
    }
  }
  let page = parts[0] || 'dashboard';
  if (S.me.must_change_password) page = 'account';
  if (!PAGES[page]) page = 'dashboard';
  const navItem = NAV.find((n) => n[0] === page || (page === 'website' && n[0] === 'websites') || (page === 'client' && n[0] === 'clients') || (page === 'invoice' && n[0] === 'finance'));
  if (navItem && navItem[2] && !navItem[2]()) page = 'dashboard';
  renderShell(root, navItem ? navItem[0] : page);
  const main = $('#main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  try { await PAGES[page](main, parts.slice(1)); }
  catch (e) { main.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="err">${h(e.message)}</p></div>`; }
  document.title = `${S.settings.company_name || 'Agency'} · Agency Vault`;
}
const refresh = () => route();
window.addEventListener('hashchange', route);

function renderShell(root, active) {
  const initial = (S.settings.company_name || 'A').trim()[0].toUpperCase();
  root.innerHTML = `<div class="app">
    <aside class="side">
      <div class="brand"><div class="logo">${h(initial)}</div><span>${h(S.settings.company_name || 'Agency Vault')}</span></div>
      <nav class="nav">${NAV.map((n) => (n[0] === '-' ? '<div class="sep"></div>' : n[2]() ? `<a href="#/${n[0]}" class="${n[0] === active ? 'active' : ''}">${h(n[1])}</a>` : '')).join('')}</nav>
      <div class="me"><div><b>${h(S.me.name)}</b></div><div class="muted small">${h(S.me.email)} · ${h(S.me.role)}</div>
        <button class="sm" style="margin-top:8px" data-act="logout">Sign out</button></div>
    </aside>
    <main class="main" id="main"></main></div>`;
}
const pageHead = (title, actions = '', sub = '') => `<div class="head"><div><h1>${title}</h1>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><div class="actions">${actions}</div></div>`;

// ---------- actions (event delegation) ----------
const ACT = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el.dataset, el)).catch((err) => toast(err.message));
});
ACT.copy = (d) => copy(d.text);
ACT.logout = async () => { await api('POST', '/auth/logout'); S.me = null; S.users = null; location.hash = '#/'; route(); };
ACT.nav = (d) => { location.hash = d.href; };

// ---------- auth screens ----------
function authCard(root, inner) { root.innerHTML = `<div class="auth"><div class="card">${inner}</div></div>`; }
function bindAuthForm(root, handler) {
  const form = $('form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.err', form);
    err.classList.add('hidden');
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try { await handler(readForm(form)); }
    catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    finally { btn.disabled = false; }
  });
}
function renderLogin(root) {
  authCard(root, `<h1 style="margin-bottom:4px">Sign in</h1><p class="muted">Agency Vault — websites, passwords & revenue in one place.</p>
    <form><div><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
    <div><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <div class="err hidden"></div><button class="primary" type="submit" style="width:100%;justify-content:center">Sign in</button></form>
    <p class="small" style="margin-top:14px"><button class="link" data-act="forgot">Forgot password?</button></p>`);
  bindAuthForm(root, async (d) => { await api('POST', '/auth/login', d); S.me = null; location.hash = '#/dashboard'; route(); });
}
ACT.forgot = () => openModal({
  title: 'Reset your password',
  body: `<p class="muted">Enter your email. Your admin will be notified and can send you a reset link or a temporary password.</p>${formHTML([{ name: 'email', label: 'Email', type: 'email', required: true }])}`,
  submit: 'Request reset',
  onSubmit: async (d) => { const r = await api('POST', '/auth/forgot', d); toast(r.message); },
});
function renderSetup(root) {
  authCard(root, `<h1 style="margin-bottom:4px">Welcome 👋</h1><p class="muted">Create the owner account for your company. You can add team members after this.</p>
    <form><div><label>Company name</label><input name="company_name" required></div>
    <div><label>Your name</label><input name="name" required></div>
    <div><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
    <div><label>Password (min 8 characters)</label><input name="password" type="password" autocomplete="new-password" required></div>
    <div class="err hidden"></div><button class="primary" type="submit" style="width:100%;justify-content:center">Create owner account</button></form>`);
  bindAuthForm(root, async (d) => { await api('POST', '/setup', d); S.me = null; location.hash = '#/dashboard'; route(); });
}
function renderReset(root, token) {
  authCard(root, `<h1 style="margin-bottom:4px">Choose a new password</h1>
    <form><div><label>New password</label><input name="password" type="password" autocomplete="new-password" required></div>
    <div><label>Confirm password</label><input name="confirm" type="password" autocomplete="new-password" required></div>
    <div class="err hidden"></div><button class="primary" type="submit" style="width:100%;justify-content:center">Save password</button></form>`);
  bindAuthForm(root, async (d) => {
    if (d.password !== d.confirm) throw new Error('Passwords do not match');
    await api('POST', '/auth/reset', { token, password: d.password });
    toast('Password updated. Please sign in.');
    location.hash = '#/';
  });
}

// ---------- dashboard ----------
PAGES.dashboard = async (m) => {
  const d = await api('GET', '/dashboard');
  const F = d.finance;
  const kpi = (label, value, sub = '') => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  let change = '';
  if (F && F.revenue_last_month > 0) {
    const pct = ((F.revenue_month - F.revenue_last_month) / F.revenue_last_month) * 100;
    change = `<span class="${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span> vs last month`;
  }
  const kpis = [
    kpi('Active websites', d.counts.active, `${d.counts.onboarding} onboarding · ${d.counts.paused} paused · ${d.counts.exited} exited`),
    F && kpi('Monthly recurring (MRR)', money(F.mrr), `ARR ${money(F.arr)}`),
    F && kpi('Revenue this month', money(F.revenue_month), change || `Last month ${money(F.revenue_last_month)}`),
    F && kpi('Revenue this year', money(F.revenue_ytd), `Expenses this month ${money(F.expense_month)}`),
    F && kpi('Outstanding invoices', money(F.outstanding.v), F.overdue.c ? `<span class="down">${F.overdue.c} overdue · ${money(F.overdue.v)}</span>` : `${F.outstanding.c} unpaid`),
    kpi('Tasks due this week', d.tasks.length, d.overdue_tasks ? `<span class="down">${d.overdue_tasks} overdue</span> · ${d.my_open_tasks} assigned to you` : `${d.my_open_tasks} assigned to you`),
    d.clients_active !== undefined && kpi('Active clients', d.clients_active, d.onboarding_submitted ? `<a href="#/onboarding">${d.onboarding_submitted} onboarding submission(s) to review</a>` : ''),
  ].filter(Boolean).join('');

  const months = (rows, map) => rows.map((r) => ({ label: monthLabel(r.month), full: new Date(r.month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), ...map(r) }));
  const charts = `<div class="grid ${F ? 'g2' : ''}" style="margin-bottom:16px">
    ${F ? `<div class="card"><h2>Revenue vs expenses · last 12 months</h2>${barChart(months(d.monthly, (r) => r), [{ key: 'income', label: 'Revenue', color: '--series-1' }, { key: 'expense', label: 'Expenses', color: '--series-2' }], money)}</div>` : ''}
    <div class="card"><h2>Website growth · onboarded vs exited</h2>${barChart(months(d.growth, (r) => r), [{ key: 'onboarded', label: 'Onboarded', color: '--series-1' }, { key: 'exited', label: 'Exited', color: '--series-2' }], (n) => n, true)}</div></div>`;

  const list = (items, render, empty) => (items && items.length ? `<ul class="list">${items.map(render).join('')}</ul>` : `<div class="empty">${empty}</div>`);
  const cards = [];
  cards.push(`<div class="card"><h2>Tasks due (next 7 days)</h2>${list(d.tasks, (t) => `<li><div class="grow"><b>${h(t.title)}</b> ${t.frequency !== 'once' ? badge(t.frequency, FREQ[t.frequency]) : ''}<div class="muted small">${t.website_id ? `<a href="#/website/${t.website_id}/tasks">${h(t.website_name)}</a> · ` : ''}${h(t.assignee_name || 'Unassigned')}</div></div>${dueBadge(t.due_date)}<button class="sm" data-act="taskDone" data-id="${t.id}">Done</button></li>`, 'Nothing due. 🎉')}</div>`);
  if (F) cards.push(`<div class="card"><h2>Billing due (next 7 days)</h2>${list(d.billing_due, (w) => `<li><div class="grow"><a href="#/website/${w.id}/billing"><b>${h(w.name)}</b></a><div class="muted small">${money(w.price)} · ${CYCLE[w.billing_cycle]}</div></div>${dueBadge(w.next_billing_date)}${can('finance_edit') ? `<button class="sm" data-act="planInvoice" data-id="${w.id}">Invoice</button>` : ''}</li>`, 'No recurring bills due.')}</div>`);
  if (d.renewals) cards.push(`<div class="card"><h2>Renewals (domain, hosting… next 30 days)</h2>${list(d.renewals, (r) => `<li><div class="grow"><b>${h(r.label)}</b><div class="muted small"><a href="#/website/${r.website_id}/vault">${h(r.website_name)}</a> · ${h(CRED[r.category] || r.category)}${r.provider ? ' · ' + h(r.provider) : ''}${r.renewal_cost && F ? ' · ' + money(r.renewal_cost) : ''}</div></div>${dueBadge(r.renewal_date)}</li>`, 'No renewals coming up.')}</div>`);
  if (d.followups) cards.push(`<div class="card"><h2>Follow-ups</h2>${list(d.followups, (f) => `<li><div class="grow"><b>${h(f.subject)}</b><div class="muted small">${h(f.client_name || '')}${f.website_name ? ' · ' + h(f.website_name) : ''} · ${h(f.channel)}</div></div>${dueBadge(f.due_date)}<button class="sm" data-act="fuDone" data-id="${f.id}">Done</button></li>`, 'No pending follow-ups.')}</div>`);
  cards.push(`<div class="card"><h2>Latest updates, deals & ideas</h2>${list(d.recent_notes, (n) => `<li><div class="grow">${badge(n.type, NOTE[n.type])} <b>${h(n.title || '')}</b><div class="small pre">${h((n.body || '').slice(0, 160))}</div><div class="muted small"><a href="#/website/${n.website_id}/timeline">${h(n.website_name)}</a> · ${h(n.author_name || 'Client')} · ${fmtDate(n.created_at)}</div></div></li>`, 'No updates yet. Add comments, commercials or new approaches from a website’s Timeline tab.')}</div>`);
  const maxSites = Math.max(1, ...d.handlers.map((x) => x.sites));
  cards.push(`<div class="card"><h2>Who handles what</h2>${d.handlers.length ? d.handlers.map((x) => `<div class="bar-row"><div><div>${h(x.name)}</div><div class="bar-track"><div class="bar-fill" style="width:${(x.sites / maxSites) * 100}%"></div></div></div><div class="right small num">${x.sites} site${x.sites === 1 ? '' : 's'}${F ? `<br><span class="muted">${money(x.mrr)}/mo</span>` : ''}</div></div>`).join('') : '<div class="empty">No active websites yet.</div>'}</div>`);
  if (F) {
    const maxRev = Math.max(1, ...d.top_sites.map((x) => x.revenue));
    cards.push(`<div class="card"><h2>Top websites by revenue (12 months)</h2>${d.top_sites.length ? d.top_sites.map((x) => `<div class="bar-row"><div><a href="#/website/${x.id}">${h(x.name)}</a><div class="bar-track"><div class="bar-fill" style="width:${(x.revenue / maxRev) * 100}%"></div></div></div><div class="right small num">${money(x.revenue)}</div></div>`).join('') : '<div class="empty">No payments recorded yet.</div>'}</div>`);
  }
  m.innerHTML = pageHead(`Hello, ${h(S.me.name.split(' ')[0])}`, can('websites_edit') ? '<button class="primary" data-act="siteNew">+ Add website</button>' : '', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    + `<div class="kpis">${kpis}</div>${charts}<div class="grid g3">${cards.join('')}</div>`;
};

// ---------- websites ----------
async function siteFields(site = {}) {
  const [clients, users] = await Promise.all([clientOptions(), userOptions()]);
  const social = site.social || {};
  const fin = can('finance_edit');
  return {
    fields: [
      { name: 'name', label: 'Website / project name', required: true },
      { name: 'domain', label: 'Domain', placeholder: 'example.com' },
      { name: 'url', label: 'Website URL', placeholder: 'https://example.com' },
      { name: 'category', label: 'Category', placeholder: 'E-commerce, Blog, Corporate…' },
      canSeeClients() ? { name: 'client_id', label: 'Client', type: 'select', options: opts(clients, '— No client —') } : null,
      { name: 'handler_id', label: 'Handled by', type: 'select', options: opts(users, '— Unassigned —') },
      { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['onboarding', 'Onboarding'], ['paused', 'Paused'], ['exited', 'Exited']] },
      { name: 'onboard_date', label: 'Onboard date', type: 'date' },
      { name: 'exit_date', label: 'Exit date', type: 'date' },
      { name: 'exit_reason', label: 'Exit reason', placeholder: 'Only if exited' },
      fin ? { type: 'html', full: true, html: '<h3 style="margin-top:6px">Pricing & billing</h3>' } : null,
      fin ? { name: 'billing_cycle', label: 'Billing cycle', type: 'select', options: enumOpts(CYCLE) } : null,
      fin ? { name: 'price', label: 'Price per cycle', type: 'number' } : null,
      fin ? { name: 'setup_fee', label: 'One-time setup fee', type: 'number' } : null,
      fin ? { name: 'next_billing_date', label: 'Next billing date', type: 'date' } : null,
      { name: 'services', label: 'Services / type of work', type: 'textarea', full: true, placeholder: 'SEO (monthly), hosting, maintenance, social media posting (weekly)…' },
      { name: 'special_comments', label: 'Special comments', type: 'textarea', full: true },
      { type: 'html', full: true, html: `<h3 style="margin-top:6px">Social links</h3><div class="form">${Object.entries(SOCIAL).map(([k, l]) => field({ name: 'social.' + k, label: l, placeholder: 'https://…' }, { ['social.' + k]: social[k] })).join('')}</div>` },
    ],
    vals: { status: 'active', billing_cycle: 'monthly', onboard_date: todayStr(), ...site },
  };
}
ACT.siteNew = async () => {
  const { fields, vals } = await siteFields();
  openModal({ title: 'Add website', wide: true, body: formHTML(fields, vals), onSubmit: async (d) => { const r = await api('POST', '/websites', d); location.hash = `#/website/${r.id}`; } });
};
ACT.siteEdit = async (ds) => {
  const { website } = await api('GET', `/websites/${ds.id}`);
  const { fields, vals } = await siteFields(website);
  openModal({ title: `Edit ${website.name}`, wide: true, body: formHTML(fields, vals), onSubmit: async (d) => { await api('PUT', `/websites/${ds.id}`, d); toast('Saved'); refresh(); } });
};
ACT.siteDelete = async (ds) => {
  if (!(await confirmBox('Delete website?', 'This permanently deletes the website with all its passwords, tasks and timeline. Invoices and payments are kept.'))) return;
  await api('DELETE', `/websites/${ds.id}`);
  location.hash = '#/websites';
};
ACT.siteMembers = async (ds) => {
  const [users, detail] = await Promise.all([userOptions(), api('GET', `/websites/${ds.id}`)]);
  const ids = new Set(detail.members.map((x) => x.id));
  openModal({
    title: 'Team access for this website',
    body: `<p class="muted small">Members who don't have "See all websites" can only see websites they're assigned to (or handle).</p><div class="checks">${users.map((u) => `<label class="check"><input type="checkbox" name="user_ids[]" value="${u.id}" ${ids.has(u.id) ? 'checked' : ''}> ${h(u.name)} <span class="muted small">${h(u.role)}</span></label>`).join('')}</div>`,
    onSubmit: async (d) => { await api('PUT', `/websites/${ds.id}/members`, { user_ids: d.user_ids }); toast('Access updated'); refresh(); },
  });
};
ACT.planInvoice = async (ds) => {
  openModal({
    title: 'Generate invoice from plan',
    body: `<p>Creates a draft invoice for the next billing period and moves the next billing date forward.</p>${formHTML([{ name: 'include_setup', label: 'Include one-time setup fee', type: 'checkbox' }])}`,
    submit: 'Generate',
    onSubmit: async (d) => { const r = await api('POST', `/websites/${ds.id}/invoice`, d); toast(`Invoice ${r.number} created`); location.hash = `#/invoice/${r.id}`; },
  });
};

PAGES.websites = async (m) => {
  const rows = await api('GET', '/websites');
  const fin = can('finance_view');
  m.innerHTML = pageHead('Websites', can('websites_edit') ? '<button class="primary" data-act="siteNew">+ Add website</button>' : '', `${rows.length} total`)
    + `<div class="card"><div class="toolbar"><input type="search" id="q" placeholder="Search name, domain, client, handler…">
      <select id="fs"><option value="">All statuses</option><option value="active">Active</option><option value="onboarding">Onboarding</option><option value="paused">Paused</option><option value="exited">Exited</option></select>
      <select id="fc"><option value="">All billing cycles</option>${enumOpts(CYCLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="table-wrap"><table><thead><tr><th>Website</th><th>Client</th><th>Handled by</th><th>Status</th>${fin ? '<th>Plan</th><th class="right">Revenue</th>' : ''}<th class="right">Open tasks</th><th class="right">Vault</th><th>Onboarded</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), fs = $('#fs').value, fc = $('#fc').value;
    const list = rows.filter((w) => (!fs || w.status === fs) && (!fc || w.billing_cycle === fc) && (!q || [w.name, w.domain, w.client_name, w.handler_name, w.category].join(' ').toLowerCase().includes(q)));
    $('#tb').innerHTML = list.length ? list.map((w) => `<tr><td><a href="#/website/${w.id}"><b>${h(w.name)}</b></a><div class="muted small">${h(w.domain || '')}</div></td>
      <td>${w.client_id && canSeeClients() ? `<a href="#/client/${w.client_id}">${h(w.client_name)}</a>` : h(w.client_name || '—')}</td><td>${h(w.handler_name || '—')}</td><td>${badge(w.status)}</td>
      ${fin ? `<td class="nowrap">${w.price ? `${money(w.price)} <span class="muted small">${CYCLE[w.billing_cycle]}</span>` : '—'}</td><td class="right num">${money(w.revenue)}</td>` : ''}
      <td class="right num">${w.open_tasks}</td><td class="right num">${w.cred_count}</td><td class="nowrap">${fmtDate(w.onboard_date)}</td></tr>`).join('')
      : `<tr><td colspan="9" class="empty">${rows.length ? 'No websites match.' : 'No websites yet. Add your first one.'}</td></tr>`;
  };
  ['#q', '#fs', '#fc'].forEach((s) => $(s).addEventListener('input', draw));
  draw();
};

PAGES.website = async (m, [id, tab = 'overview']) => {
  const d = await api('GET', `/websites/${id}`);
  const w = d.website;
  const P = S.me.perms;
  const tabs = [['overview', 'Overview'], d.credentials && ['vault', `Passwords (${d.credentials.length})`], ['tasks', `Tasks (${d.tasks.filter((t) => t.status !== 'done').length})`], ['timeline', 'Timeline & comments'], d.invoices && ['billing', 'Billing'], d.onboarding && ['onboarding', 'Onboarding']].filter(Boolean);
  const actions = [
    P.websites_edit && `<button data-act="siteMembers" data-id="${w.id}">Team access</button>`,
    P.finance_edit && w.price > 0 && `<button data-act="planInvoice" data-id="${w.id}">Generate invoice</button>`,
    P.websites_edit && `<button class="primary" data-act="siteEdit" data-id="${w.id}">Edit</button>`,
  ].filter(Boolean).join('');
  let body = '';
  if (tab === 'overview') {
    const social = Object.entries(w.social || {}).filter(([, v]) => v);
    body = `<div class="grid g2"><div class="card"><h2>Details</h2><dl class="kv">
        <dt>Domain</dt><dd>${w.domain ? extLink(w.domain) : '—'}</dd>
        <dt>Website URL</dt><dd>${extLink(w.url)}</dd>
        <dt>Category</dt><dd>${h(w.category || '—')}</dd>
        <dt>Client</dt><dd>${d.client ? (canSeeClients() ? `<a href="#/client/${d.client.id}">${h(d.client.name)}</a>` : h(d.client.name)) + (d.client.company ? ` <span class="muted">· ${h(d.client.company)}</span>` : '') : '—'}</dd>
        <dt>Handled by</dt><dd>${h(d.handler?.name || 'Unassigned')}</dd>
        <dt>Team access</dt><dd>${d.members.length ? d.members.map((x) => h(x.name)).join(', ') : '<span class="muted">Only people who can see all websites</span>'}</dd>
        <dt>Onboarded</dt><dd>${fmtDate(w.onboard_date)}</dd>
        <dt>Exit</dt><dd>${w.exit_date ? `${fmtDate(w.exit_date)}${w.exit_reason ? ` — ${h(w.exit_reason)}` : ''}` : '—'}</dd>
        <dt>Services / work</dt><dd class="pre">${h(w.services || '—')}</dd></dl></div>
      <div class="grid">
      ${w.price !== undefined ? `<div class="card"><h2>Pricing & revenue</h2><dl class="kv">
        <dt>Plan</dt><dd>${money(w.price)} · ${CYCLE[w.billing_cycle]}</dd>
        <dt>Monthly value</dt><dd>${money(w.mrr)}</dd>
        <dt>Setup fee</dt><dd>${money(w.setup_fee)}</dd>
        <dt>Next billing</dt><dd>${w.billing_cycle === 'one_time' ? '—' : dueBadge(w.next_billing_date)}</dd>
        <dt>Total revenue</dt><dd><b>${money(w.revenue)}</b></dd></dl></div>` : ''}
      <div class="card"><h2>Special comments</h2><div class="pre">${h(w.special_comments || '') || '<span class="muted">None</span>'}</div></div>
      <div class="card"><h2>Social links</h2>${social.length ? `<dl class="kv">${social.map(([k, v]) => `<dt>${h(SOCIAL[k] || k)}</dt><dd>${extLink(v)}</dd>`).join('')}</dl>` : '<span class="muted">No social links added.</span>'}</div>
      </div></div>`;
  } else if (tab === 'vault') {
    const groups = {};
    for (const c of d.credentials) (groups[c.category] ||= []).push(c);
    body = `<div class="toolbar"><span class="muted small">Passwords are encrypted (AES-256). Every reveal is recorded in the activity log.</span><span style="margin-left:auto"></span>${P.credentials_edit ? `<button class="primary" data-act="credNew" data-site="${w.id}">+ Add login</button>` : ''}</div>`
      + (d.credentials.length ? Object.keys(CRED).filter((k) => groups[k]).map((k) => `<h3 style="margin:16px 0 8px">${h(CRED[k])}</h3><div class="creds">${groups[k].map(credCard).join('')}</div>`).join('')
        : '<div class="card empty">No logins stored yet. Add email, hosting, server, domain, CMS and social logins here.</div>');
  } else if (tab === 'tasks') {
    body = `<div class="toolbar"><span style="margin-left:auto"></span><button class="primary" data-act="taskNew" data-site="${w.id}">+ Add task</button></div><div class="card">${taskTable(d.tasks, false)}</div>`;
  } else if (tab === 'timeline') {
    body = `<div class="card" style="margin-bottom:16px"><h2>Add to timeline</h2><form id="noteForm">${formHTML([
      { name: 'type', label: 'Type', type: 'select', options: enumOpts(NOTE).filter(([k]) => k !== 'task') },
      { name: 'title', label: 'Title', placeholder: 'e.g. Upsold Google Ads package' },
      P.finance_view ? { name: 'amount', label: 'Deal value (optional)', type: 'number', help: 'For commercials / deals' } : null,
      { name: 'body', label: 'Details', type: 'textarea', full: true, placeholder: 'Special comment, new commercial, new approach, meeting notes…' },
    ])}<div class="err hidden"></div><p><button class="primary" type="submit">Add</button></p></form></div>
      <div class="card"><h2>Timeline</h2>${d.notes.length ? `<ul class="list tl">${d.notes.map((n) => `<li><div class="grow">${badge(n.type, NOTE[n.type])} <b>${h(n.title || '')}</b>${n.amount ? ` <span class="badge b-good">${money(n.amount)}</span>` : ''}
        <div class="pre">${h(n.body || '')}</div><div class="muted small">${h(n.author_name || 'Client')} · ${fmtDateTime(n.created_at)}</div></div>
        ${n.author_id === S.me.id || P.websites_edit ? `<button class="sm danger" data-act="noteDelete" data-id="${n.id}">Delete</button>` : ''}</li>`).join('')}</ul>` : '<div class="empty">Nothing yet.</div>'}</div>`;
  } else if (tab === 'billing') {
    const paid = d.payments.filter((p) => p.type === 'income').reduce((s, p) => s + p.amount, 0);
    const spent = d.payments.filter((p) => p.type === 'expense').reduce((s, p) => s + p.amount, 0);
    body = `<div class="kpis"><div class="kpi"><div class="label">Revenue received</div><div class="value">${money(paid)}</div></div><div class="kpi"><div class="label">Expenses</div><div class="value">${money(spent)}</div></div><div class="kpi"><div class="label">Profit</div><div class="value">${money(paid - spent)}</div></div></div>
      <div class="toolbar"><span style="margin-left:auto"></span>${P.finance_edit ? `<button data-act="payNew" data-site="${w.id}">Record payment / expense</button><button class="primary" data-act="invNew" data-site="${w.id}" data-client="${w.client_id || ''}">+ New invoice</button>` : ''}</div>
      <div class="grid g2"><div class="card"><h2>Invoices</h2>${invoiceTable(d.invoices, true)}</div><div class="card"><h2>Payments & expenses</h2>${paymentTable(d.payments, true)}</div></div>`;
  } else if (tab === 'onboarding') {
    body = `<div class="toolbar"><span style="margin-left:auto"></span>${w.client_id ? `<button class="primary" data-act="onbNew" data-client="${w.client_id}" data-site="${w.id}">+ Request access from client</button>` : '<span class="muted small">Link a client to this website to send an onboarding request.</span>'}</div>
      <div class="card">${d.onboarding.length ? `<table><thead><tr><th>Created</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>${d.onboarding.map((o) => `<tr><td>${fmtDate(o.created_at)}</td><td>${badge(o.status)}</td><td>${fmtDate(o.submitted_at)}</td><td class="right"><button class="sm" data-act="copy" data-text="${h(location.origin + '/onboard/' + o.token)}">Copy link</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No onboarding requests yet.</div>'}</div>`;
  }
  m.innerHTML = pageHead(`${h(w.name)} ${badge(w.status)}`, actions, `${w.domain ? h(w.domain) + ' · ' : ''}<a href="#/websites">All websites</a>`)
    + `<div class="tabs">${tabs.map(([k, l]) => `<button data-act="nav" data-href="#/website/${w.id}/${k}" class="${k === tab ? 'active' : ''}">${h(l)}</button>`).join('')}</div>${body}`
    + (P.websites_edit && isAdmin() && tab === 'overview' ? `<p style="margin-top:24px"><button class="danger sm" data-act="siteDelete" data-id="${w.id}">Delete website</button></p>` : '');
  const nf = $('#noteForm');
  if (nf) nf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/websites/${w.id}/notes`, readForm(nf)); refresh(); }
    catch (ex) { const er = $('.err', nf); er.textContent = ex.message; er.classList.remove('hidden'); }
  });
};

// ---------- vault ----------
function credCard(c) {
  const soon = c.renewal_date && daysUntil(c.renewal_date) <= 30;
  return `<div class="cred"><div style="display:flex;gap:8px;align-items:start"><div style="flex:1;min-width:0"><b>${h(c.label)}</b>${c.provider ? `<div class="muted small">${h(c.provider)}</div>` : ''}</div>
    ${can('credentials_edit') ? `<button class="sm" data-act="credEdit" data-id="${c.id}">Edit</button>` : ''}</div>
    ${c.url ? `<div class="row small">${extLink(c.url)}</div>` : ''}
    ${c.username ? `<div class="row"><span class="muted small">User</span><code>${h(c.username)}</code><button class="sm" data-act="copy" data-text="${h(c.username)}">Copy</button></div>` : ''}
    ${c.has_secret ? `<div class="row"><span class="muted small">Pass</span><code>••••••••</code><button class="sm" data-act="credCopy" data-id="${c.id}">Copy</button><button class="sm" data-act="credReveal" data-id="${c.id}">Show</button></div>` : ''}
    ${c.has_notes ? `<div class="row"><button class="sm link" data-act="credReveal" data-id="${c.id}">View secure notes</button></div>` : ''}
    ${c.renewal_date ? `<div class="row small"><span class="muted">Renews</span> ${soon ? dueBadge(c.renewal_date) : fmtDate(c.renewal_date)}${c.renewal_cost && can('finance_view') ? ` · ${money(c.renewal_cost)}` : ''}</div>` : ''}
    <div class="muted small" style="margin-top:6px">Updated ${fmtDate(c.updated_at)}</div></div>`;
}
const credFields = (isEdit) => [
  { name: 'category', label: 'Type', type: 'select', options: enumOpts(CRED) },
  { name: 'label', label: 'Label', required: true, placeholder: 'e.g. Hostinger cPanel' },
  { name: 'provider', label: 'Provider', placeholder: 'GoDaddy, Hostinger, Google…' },
  { name: 'url', label: 'Login URL' },
  { name: 'username', label: 'Username / email' },
  { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', help: isEdit ? 'Leave empty to keep the current password' : '' },
  { name: 'renewal_date', label: 'Renewal / expiry date', type: 'date' },
  can('finance_view') ? { name: 'renewal_cost', label: 'Renewal cost', type: 'number' } : null,
  { name: 'notes', label: 'Secure notes (encrypted)', type: 'textarea', full: true, placeholder: '2FA backup codes, security questions, SSH key info, PIN…', help: isEdit ? 'Leave empty to keep existing notes' : '' },
  { type: 'html', full: true, html: '<button type="button" class="sm" data-act="genPass">Generate strong password</button>' },
];
ACT.genPass = (d, el) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
  const arr = crypto.getRandomValues(new Uint32Array(20));
  const pw = [...arr].map((n) => chars[n % chars.length]).join('');
  const inp = $('input[name=password]', el.closest('form'));
  inp.value = pw;
  inp.type = 'text';
};
ACT.credNew = (ds) => openModal({ title: 'Add login', wide: true, body: formHTML(credFields(false), { category: 'hosting' }), onSubmit: async (d) => { await api('POST', `/websites/${ds.site}/credentials`, d); toast('Saved to vault'); refresh(); } });
ACT.credEdit = async (ds) => {
  const site = location.hash.split('/')[2];
  const { credentials } = await api('GET', `/websites/${site}`);
  const c = credentials.find((x) => x.id === +ds.id);
  const m = openModal({
    title: 'Edit login', wide: true, body: formHTML(credFields(true), c) + '<p style="margin-top:14px"><button type="button" class="danger sm" data-act="credDelete">Delete this login</button></p>',
    onSubmit: async (d) => {
      if (!d.password) delete d.password;
      if (!d.notes) delete d.notes;
      await api('PUT', `/credentials/${ds.id}`, d); toast('Saved'); refresh();
    },
  });
  ACT.credDelete = async () => {
    if (!(await confirmBox('Delete login?', `Permanently delete "${c.label}"?`))) return;
    await api('DELETE', `/credentials/${ds.id}`); m.close(); refresh();
  };
};
ACT.credReveal = async (ds) => {
  const r = await api('POST', `/credentials/${ds.id}/reveal`);
  openModal({
    title: 'Login details',
    body: `${r.password ? `<label>Password</label><div class="secret-box">${h(r.password)}</div><p><button type="button" class="sm" data-act="copy" data-text="${h(r.password)}">Copy password</button></p>` : ''}
      ${r.notes ? `<label>Secure notes</label><div class="secret-box pre">${h(r.notes)}</div>` : ''}${!r.password && !r.notes ? '<p class="muted">Nothing stored.</p>' : ''}`,
  });
};
ACT.credCopy = async (ds) => { const r = await api('POST', `/credentials/${ds.id}/reveal`); copy(r.password, 'Password copied'); };

// ---------- tasks ----------
function taskTable(tasks, showSite = true) {
  if (!tasks.length) return '<div class="empty">No tasks.</div>';
  return `<div class="table-wrap"><table><thead><tr><th></th><th>Task</th>${showSite ? '<th>Website</th>' : ''}<th>Repeats</th><th>Priority</th><th>Assigned</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${tasks.map((t) => `<tr><td>${t.status !== 'done' ? `<button class="sm" data-act="taskDone" data-id="${t.id}" title="Mark done${t.frequency !== 'once' ? ' and schedule the next one' : ''}">✓</button>` : ''}</td>
      <td><b>${h(t.title)}</b>${t.description ? `<div class="muted small pre">${h(t.description.slice(0, 200))}</div>` : ''}${t.last_completed_at ? `<div class="muted small">Last done ${fmtDate(t.last_completed_at)}</div>` : ''}</td>
      ${showSite ? `<td>${t.website_id ? `<a href="#/website/${t.website_id}/tasks">${h(t.website_name)}</a>` : '—'}</td>` : ''}
      <td>${badge(t.frequency === 'once' ? '' : 'normal', FREQ[t.frequency]) || '<span class="muted small">Once</span>'}</td><td>${badge(t.priority)}</td><td>${h(t.assignee_name || '—')}</td>
      <td>${t.status === 'done' ? fmtDate(t.due_date) : dueBadge(t.due_date)}</td><td>${badge(t.status, t.status === 'in_progress' ? 'In progress' : undefined)}</td>
      <td class="right nowrap"><button class="sm" data-act="taskEdit" data-id="${t.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function taskForm(task = {}) {
  const [sites, users] = await Promise.all([api('GET', '/websites'), userOptions()]);
  return [
    { name: 'title', label: 'Task', required: true, full: true },
    { name: 'website_id', label: 'Website', type: 'select', options: opts(sites, '— General / no website —') },
    can('tasks_manage') ? { name: 'assigned_to', label: 'Assign to', type: 'select', options: opts(users, '— Unassigned —') } : null,
    { name: 'frequency', label: 'Repeats', type: 'select', options: enumOpts(FREQ), help: 'Recurring tasks reschedule themselves when marked done' },
    { name: 'priority', label: 'Priority', type: 'select', options: [['normal', 'Normal'], ['low', 'Low'], ['high', 'High'], ['urgent', 'Urgent']] },
    { name: 'due_date', label: 'Due date', type: 'date' },
    task.id ? { name: 'status', label: 'Status', type: 'select', options: [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']] } : null,
    { name: 'description', label: 'Details', type: 'textarea', full: true },
  ];
}
ACT.taskNew = async (ds) => {
  const fields = await taskForm();
  openModal({ title: 'New task', wide: true, body: formHTML(fields, { website_id: ds.site || '', assigned_to: S.me.id, due_date: todayStr(), frequency: 'once' }), onSubmit: async (d) => { await api('POST', '/tasks', d); toast('Task added'); refresh(); } });
};
ACT.taskEdit = async (ds) => {
  const all = await api('GET', '/tasks');
  const t = all.find((x) => x.id === +ds.id);
  const fields = await taskForm(t);
  const m = openModal({
    title: 'Edit task', wide: true, body: formHTML(fields, t) + '<p style="margin-top:14px"><button type="button" class="danger sm" data-act="taskDelete">Delete task</button></p>',
    onSubmit: async (d) => { await api('PUT', `/tasks/${t.id}`, d); toast('Saved'); refresh(); },
  });
  ACT.taskDelete = async () => { if (await confirmBox('Delete task?', t.title)) { await api('DELETE', `/tasks/${t.id}`); m.close(); refresh(); } };
};
ACT.taskDone = async (ds) => {
  const r = await api('POST', `/tasks/${ds.id}/complete`);
  toast(r.next_due ? `Done — next due ${fmtDate(r.next_due)}` : 'Task completed');
  refresh();
};
PAGES.tasks = async (m) => {
  const q = new URLSearchParams(sessionStorage.getItem('taskFilter') || 'scope=mine&status=open');
  m.innerHTML = pageHead('Tasks', '<button class="primary" data-act="taskNew">+ New task</button>', 'Daily, weekly, monthly, quarterly & yearly work for every website')
    + `<div class="card"><div class="toolbar">
      <select id="tScope"><option value="mine">Assigned to me</option><option value="">Everything I can see</option></select>
      <select id="tStatus"><option value="open">Open</option><option value="done">Completed</option><option value="">All</option></select>
      <select id="tFreq"><option value="">Any frequency</option>${enumOpts(FREQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="tList"><p class="muted">Loading…</p></div></div>`;
  $('#tScope').value = q.get('scope') || ''; $('#tStatus').value = q.get('status') || ''; $('#tFreq').value = q.get('frequency') || '';
  const load = async () => {
    const p = new URLSearchParams({ scope: $('#tScope').value, status: $('#tStatus').value, frequency: $('#tFreq').value });
    try { sessionStorage.setItem('taskFilter', p.toString()); } catch {}
    $('#tList').innerHTML = taskTable(await api('GET', '/tasks?' + p));
  };
  ['#tScope', '#tStatus', '#tFreq'].forEach((s) => $(s).addEventListener('change', load));
  await load();
};

// ---------- notes ----------
ACT.noteDelete = async (ds) => { if (await confirmBox('Delete entry?', 'Remove this timeline entry?')) { await api('DELETE', `/notes/${ds.id}`); refresh(); } };

// ---------- clients ----------
const clientFields = [
  { name: 'name', label: 'Contact name', required: true },
  { name: 'company', label: 'Company' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone / WhatsApp' },
  { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['lead', 'Lead'], ['onboarding', 'Onboarding'], ['inactive', 'Inactive'], ['exited', 'Exited']] },
  { name: 'source', label: 'Source', placeholder: 'Referral, Google, Instagram…' },
  { name: 'address', label: 'Address', type: 'textarea', full: true },
  { type: 'html', full: true, html: '<h3 style="margin-top:6px">Billing</h3>' },
  { name: 'billing_email', label: 'Billing email', type: 'email' },
  { name: 'tax_id', label: 'GST / Tax ID' },
  { name: 'billing_address', label: 'Billing address', type: 'textarea', full: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];
ACT.clientNew = () => openModal({ title: 'Add client', wide: true, body: formHTML(clientFields, { status: 'active' }), onSubmit: async (d) => { const r = await api('POST', '/clients', d); location.hash = `#/client/${r.id}`; } });
ACT.clientEdit = async (ds) => {
  const { client } = await api('GET', `/clients/${ds.id}`);
  openModal({ title: 'Edit client', wide: true, body: formHTML(clientFields, client), onSubmit: async (d) => { await api('PUT', `/clients/${ds.id}`, d); toast('Saved'); refresh(); } });
};
ACT.clientDelete = async (ds) => {
  if (!(await confirmBox('Delete client?', 'Websites stay but are unlinked from this client. Follow-ups and onboarding requests for this client are deleted.'))) return;
  await api('DELETE', `/clients/${ds.id}`); location.hash = '#/clients';
};
PAGES.clients = async (m) => {
  const rows = await api('GET', '/clients');
  const fin = can('finance_view');
  m.innerHTML = pageHead('Clients', can('clients_manage') ? '<button class="primary" data-act="clientNew">+ Add client</button>' : '', `${rows.length} total`)
    + `<div class="card"><div class="toolbar"><input type="search" id="q" placeholder="Search clients…"><select id="fs"><option value="">All statuses</option>${['active', 'lead', 'onboarding', 'inactive', 'exited'].map((s) => `<option>${s}</option>`).join('')}</select></div>
    <div class="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Status</th><th class="right">Active sites</th>${fin ? '<th class="right">Revenue</th><th class="right">Outstanding</th>' : ''}<th>Since</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), fs = $('#fs').value;
    const list = rows.filter((c) => (!fs || c.status === fs) && (!q || [c.name, c.company, c.email, c.phone].join(' ').toLowerCase().includes(q)));
    $('#tb').innerHTML = list.length ? list.map((c) => `<tr><td><a href="#/client/${c.id}"><b>${h(c.name)}</b></a><div class="muted small">${h(c.company || '')}</div></td><td class="small">${h(c.email || '')}<br>${h(c.phone || '')}</td><td>${badge(c.status)}</td><td class="right num">${c.active_sites}</td>
      ${fin ? `<td class="right num">${money(c.revenue)}</td><td class="right num">${c.outstanding ? `<span class="down">${money(c.outstanding)}</span>` : '—'}</td>` : ''}<td class="nowrap">${fmtDate(c.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No clients.</td></tr>';
  };
  $('#q').addEventListener('input', draw); $('#fs').addEventListener('input', draw);
  draw();
};
PAGES.client = async (m, [id]) => {
  const d = await api('GET', `/clients/${id}`);
  const c = d.client;
  const CM = can('clients_manage');
  m.innerHTML = pageHead(`${h(c.name)} ${badge(c.status)}`, [
    CM && `<button data-act="onbNew" data-client="${c.id}">Request website access</button>`,
    can('finance_edit') && `<button data-act="invNew" data-client="${c.id}">New invoice</button>`,
    CM && `<button class="primary" data-act="clientEdit" data-id="${c.id}">Edit</button>`,
  ].filter(Boolean).join(''), `${h(c.company || '')} · <a href="#/clients">All clients</a>`)
    + `<div class="grid g2"><div class="card"><h2>Contact & billing</h2><dl class="kv">
      <dt>Email</dt><dd>${c.email ? `<a href="mailto:${h(c.email)}">${h(c.email)}</a>` : '—'}</dd><dt>Phone</dt><dd>${h(c.phone || '—')}</dd>
      <dt>Address</dt><dd class="pre">${h(c.address || '—')}</dd><dt>Billing email</dt><dd>${h(c.billing_email || '—')}</dd><dt>GST / Tax ID</dt><dd>${h(c.tax_id || '—')}</dd>
      <dt>Billing address</dt><dd class="pre">${h(c.billing_address || '—')}</dd><dt>Source</dt><dd>${h(c.source || '—')}</dd><dt>Client since</dt><dd>${fmtDate(c.created_at)}</dd>
      <dt>Notes</dt><dd class="pre">${h(c.notes || '—')}</dd></dl></div>
      <div class="card"><h2>Websites</h2>${d.websites.length ? `<ul class="list">${d.websites.map((w) => `<li><div class="grow"><a href="#/website/${w.id}"><b>${h(w.name)}</b></a><div class="muted small">${h(w.domain || '')} · ${h(w.handler_name || 'Unassigned')}</div></div>${badge(w.status)}</li>`).join('')}</ul>` : '<div class="empty">No websites linked.</div>'}</div>
      ${can('finance_view') ? `<div class="card"><h2>Invoices</h2>${invoiceTable(d.invoices.map((i) => ({ ...i, status: i.status === 'sent' && i.due_date && i.due_date < todayStr() ? 'overdue' : i.status })), true)}</div><div class="card"><h2>Payments</h2>${paymentTable(d.payments, true)}</div>` : ''}
      <div class="card"><h2>Follow-ups</h2>${d.followups.length ? `<ul class="list">${d.followups.map((f) => `<li><div class="grow"><b>${h(f.subject)}</b><div class="muted small">${h(f.channel)} · ${h(f.assignee_name || '')}${f.notes ? ' · ' + h(f.notes) : ''}</div></div>${f.status === 'pending' ? dueBadge(f.due_date) : badge('done')}</li>`).join('')}</ul>` : '<div class="empty">None.</div>'}</div>
      <div class="card"><h2>Onboarding requests</h2>${d.onboarding.length ? `<ul class="list">${d.onboarding.map((o) => `<li><div class="grow">Sent ${fmtDate(o.created_at)}${o.submitted_at ? ` · submitted ${fmtDate(o.submitted_at)}` : ''}</div>${badge(o.status)}<button class="sm" data-act="copy" data-text="${h(location.origin + '/onboard/' + o.token)}">Copy link</button></li>`).join('')}</ul>` : '<div class="empty">None.</div>'}</div></div>`
    + (isAdmin() && CM ? `<p style="margin-top:24px"><button class="danger sm" data-act="clientDelete" data-id="${c.id}">Delete client</button></p>` : '');
};

// ---------- finance ----------
function invoiceTable(rows, compactView) {
  if (!rows || !rows.length) return '<div class="empty">No invoices.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Invoice</th>${compactView ? '' : '<th>Client</th><th>Website</th>'}<th>Issued</th><th>Due</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>
    ${rows.map((i) => `<tr><td><a href="#/invoice/${i.id}"><b>${h(i.number)}</b></a></td>${compactView ? '' : `<td>${h(i.client_name || '—')}</td><td>${h(i.website_name || '—')}</td>`}
      <td class="nowrap">${fmtDate(i.issue_date)}</td><td class="nowrap">${fmtDate(i.due_date)}</td><td class="right num">${money(i.total)}</td><td>${badge(i.status)}</td></tr>`).join('')}</tbody></table></div>`;
}
function paymentTable(rows, compactView) {
  if (!rows || !rows.length) return '<div class="empty">No payments recorded.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th class="right">Amount</th>${compactView ? '' : '<th>Client / website</th>'}<th>Details</th>${can('finance_edit') ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map((p) => `<tr><td class="nowrap">${fmtDate(p.date)}</td><td>${badge(p.type)}</td><td class="right num">${money(p.amount)}</td>
      ${compactView ? '' : `<td class="small">${h(p.client_name || '')}${p.website_name ? `<br><a href="#/website/${p.website_id}/billing">${h(p.website_name)}</a>` : ''}</td>`}
      <td class="small">${h([p.category, p.method, p.note].filter(Boolean).join(' · '))}</td>${can('finance_edit') ? `<td class="right"><button class="sm danger" data-act="payDelete" data-id="${p.id}">Delete</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
ACT.payNew = async (ds) => {
  const [sites, clients] = await Promise.all([api('GET', '/websites'), clientOptions()]);
  openModal({
    title: 'Record payment or expense', wide: true,
    body: formHTML([
      { name: 'type', label: 'Type', type: 'select', options: [['income', 'Income (payment received)'], ['expense', 'Expense (money spent)']] },
      { name: 'amount', label: 'Amount', type: 'number', required: true },
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'method', label: 'Method', placeholder: 'UPI, bank transfer, card, cash…' },
      { name: 'website_id', label: 'Website', type: 'select', options: opts(sites, '— None —') },
      { name: 'client_id', label: 'Client', type: 'select', options: opts(clients, '— From website / none —') },
      { name: 'category', label: 'Category', placeholder: 'Retainer, ads spend, domain renewal, freelancer…' },
      { name: 'note', label: 'Note', type: 'textarea', full: true },
    ], { type: 'income', date: todayStr(), website_id: ds.site || '' }),
    onSubmit: async (d) => { await api('POST', '/payments', d); toast('Recorded'); refresh(); },
  });
};
ACT.payDelete = async (ds) => { if (await confirmBox('Delete payment?', 'If it came from an invoice, that invoice goes back to unpaid.')) { await api('DELETE', `/payments/${ds.id}`); refresh(); } };

async function invoiceEditor(inv) {
  const [sites, clients] = await Promise.all([api('GET', '/websites'), clientOptions()]);
  const items = inv.items && inv.items.length ? inv.items : [{ description: '', qty: 1, rate: 0 }];
  const fields = [
    { name: 'client_id', label: 'Client', type: 'select', options: opts(clients, '— Select client —') },
    { name: 'website_id', label: 'Website', type: 'select', options: opts(sites, '— None —') },
    { name: 'issue_date', label: 'Issue date', type: 'date' },
    { name: 'due_date', label: 'Due date', type: 'date' },
    inv.id ? { name: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['cancelled', 'Cancelled']] } : null,
    { name: 'tax_rate', label: 'Tax rate %', type: 'number' },
    { name: 'discount', label: 'Discount (amount)', type: 'number' },
  ];
  const row = (it) => `<tr class="item"><td><input data-k="description" value="${h(it.description)}" placeholder="Description"></td><td style="width:80px"><input data-k="qty" type="number" step="any" value="${h(it.qty)}"></td><td style="width:120px"><input data-k="rate" type="number" step="any" value="${h(it.rate)}"></td><td class="right num amt" style="width:110px"></td><td style="width:40px"><button type="button" class="sm" data-rm>✕</button></td></tr>`;
  const body = formHTML(fields, { tax_rate: S.settings.tax_rate, discount: 0, ...inv })
    + `<h3 style="margin-top:16px">Items</h3><div class="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th class="right">Amount</th><th></th></tr></thead><tbody id="items">${items.map(row).join('')}</tbody></table></div>
      <p><button type="button" class="sm" id="addItem">+ Add line</button></p><div class="right" id="invTotals"></div>`
    + formHTML([{ name: 'notes', label: 'Notes / terms (shown on invoice)', type: 'textarea', full: true }], { notes: inv.id ? inv.notes : S.settings.invoice_terms || '', ...(inv.id ? {} : {}) });
  return { body, row };
}
function readItems(form) { return $$('#items tr.item', form).map((tr) => Object.fromEntries($$('input', tr).map((i) => [i.dataset.k, i.value]))); }
function wireInvoiceEditor(form, row) {
  const recalc = () => {
    let sub = 0;
    $$('#items tr.item', form).forEach((tr) => {
      const q = +$('[data-k=qty]', tr).value || 0, r = +$('[data-k=rate]', tr).value || 0;
      $('.amt', tr).textContent = money(q * r); sub += q * r;
    });
    const disc = +$('[name=discount]', form).value || 0, tax = ((sub - disc) * (+$('[name=tax_rate]', form).value || 0)) / 100;
    $('#invTotals', form).innerHTML = `Subtotal ${money(sub)} · Discount ${money(disc)} · Tax ${money(tax)} · <b>Total ${money(sub - disc + tax)}</b>`;
  };
  form.addEventListener('input', recalc);
  form.addEventListener('click', (e) => {
    if (e.target.matches('[data-rm]')) { e.target.closest('tr').remove(); recalc(); }
    if (e.target.id === 'addItem') { $('#items', form).insertAdjacentHTML('beforeend', row({ description: '', qty: 1, rate: 0 })); recalc(); }
  });
  recalc();
}
ACT.invNew = async (ds) => {
  const { body, row } = await invoiceEditor({ client_id: ds.client || '', website_id: ds.site || '', issue_date: todayStr() });
  openModal({
    title: 'New invoice', wide: true, body, submit: 'Create invoice', onOpen: (f) => wireInvoiceEditor(f, row),
    onSubmit: async (d, form) => { const r = await api('POST', '/invoices', { ...d, items: readItems(form) }); location.hash = `#/invoice/${r.id}`; },
  });
};
ACT.invEdit = async (ds) => {
  const { invoice } = await api('GET', `/invoices/${ds.id}`);
  const { body, row } = await invoiceEditor({ ...invoice, status: invoice.status === 'overdue' ? 'sent' : invoice.status });
  openModal({
    title: `Edit ${invoice.number}`, wide: true, body, onOpen: (f) => wireInvoiceEditor(f, row),
    onSubmit: async (d, form) => { await api('PUT', `/invoices/${ds.id}`, { ...d, items: readItems(form) }); toast('Saved'); refresh(); },
  });
};
ACT.invSend = async (ds) => { await api('POST', `/invoices/${ds.id}/send`); toast('Marked as sent — a payment follow-up was scheduled'); refresh(); };
ACT.invPay = (ds) => openModal({
  title: 'Mark invoice as paid', body: formHTML([{ name: 'date', label: 'Payment date', type: 'date' }, { name: 'method', label: 'Method', placeholder: 'UPI, bank transfer…' }], { date: todayStr() }),
  submit: 'Mark paid', onSubmit: async (d) => { await api('POST', `/invoices/${ds.id}/pay`, d); toast('Payment recorded'); refresh(); },
});
ACT.invDelete = async (ds) => { if (await confirmBox('Delete invoice?', 'This cannot be undone. Recorded payments stay.')) { await api('DELETE', `/invoices/${ds.id}`); location.hash = '#/finance'; } };
ACT.print = () => window.print();

PAGES.finance = async (m, [tab = 'invoices']) => {
  const tabs = `<div class="tabs"><button data-act="nav" data-href="#/finance/invoices" class="${tab === 'invoices' ? 'active' : ''}">Invoices</button><button data-act="nav" data-href="#/finance/payments" class="${tab === 'payments' ? 'active' : ''}">Payments & expenses</button></div>`;
  const FE = can('finance_edit');
  if (tab === 'payments') {
    const rows = await api('GET', '/payments');
    m.innerHTML = pageHead('Finance', FE ? '<button class="primary" data-act="payNew">+ Record payment / expense</button>' : '') + tabs
      + `<div class="card"><div class="toolbar"><label class="check">From <input type="date" id="pf"></label><label class="check">To <input type="date" id="pt"></label><select id="ptype"><option value="">Income & expenses</option><option value="income">Income</option><option value="expense">Expenses</option></select></div>
      <div class="kpis" id="psum"></div><div id="plist"></div></div>`;
    const draw = () => {
      const f = $('#pf').value, t = $('#pt').value, ty = $('#ptype').value;
      const list = rows.filter((p) => (!f || p.date >= f) && (!t || p.date <= t) && (!ty || p.type === ty));
      const inc = list.filter((p) => p.type === 'income').reduce((s, p) => s + p.amount, 0), exp = list.filter((p) => p.type === 'expense').reduce((s, p) => s + p.amount, 0);
      $('#psum').innerHTML = `<div class="kpi"><div class="label">Income</div><div class="value">${money(inc)}</div></div><div class="kpi"><div class="label">Expenses</div><div class="value">${money(exp)}</div></div><div class="kpi"><div class="label">Net profit</div><div class="value ${inc - exp >= 0 ? '' : 'down'}">${money(inc - exp)}</div></div>`;
      $('#plist').innerHTML = paymentTable(list, false);
    };
    ['#pf', '#pt', '#ptype'].forEach((s) => $(s).addEventListener('input', draw));
    draw();
    return;
  }
  const rows = await api('GET', '/invoices');
  m.innerHTML = pageHead('Finance', FE ? '<button class="primary" data-act="invNew">+ New invoice</button>' : '') + tabs
    + `<div class="card"><div class="toolbar"><select id="is"><option value="">All invoices</option><option value="draft">Draft</option><option value="sent">Sent (unpaid)</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select><input type="search" id="iq" placeholder="Search number, client, website…"></div><div id="ilist"></div></div>`;
  const draw = () => {
    const s = $('#is').value, q = $('#iq').value.toLowerCase();
    $('#ilist').innerHTML = invoiceTable(rows.filter((i) => (!s || i.status === s) && (!q || [i.number, i.client_name, i.website_name].join(' ').toLowerCase().includes(q))), false);
  };
  $('#is').addEventListener('input', draw); $('#iq').addEventListener('input', draw);
  draw();
};

PAGES.invoice = async (m, [id]) => {
  const { invoice: i, client: c, website: w, settings: s } = await api('GET', `/invoices/${id}`);
  const FE = can('finance_edit');
  m.innerHTML = pageHead(`Invoice ${h(i.number)} ${badge(i.status)}`, [
    '<button data-act="print">Print / Save PDF</button>',
    FE && (i.status === 'draft') && `<button data-act="invSend" data-id="${i.id}">Mark as sent</button>`,
    FE && ['sent', 'overdue', 'draft'].includes(i.status) && `<button data-act="invPay" data-id="${i.id}">Mark paid</button>`,
    FE && `<button class="primary" data-act="invEdit" data-id="${i.id}">Edit</button>`,
  ].filter(Boolean).join(''), '<a href="#/finance">All invoices</a>')
    + `<div class="invoice"><div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap">
        <div><h1 style="font-size:20px">${h(s.company_name)}</h1><div class="muted pre small">${h([s.company_address, s.company_email, s.company_phone, s.company_tax_id && 'GST/Tax: ' + s.company_tax_id].filter(Boolean).join('\n'))}</div></div>
        <div style="text-align:right"><div style="font-size:26px;font-weight:700;letter-spacing:.04em">INVOICE</div><div><b>${h(i.number)}</b></div>
          <div class="small">Issued ${fmtDate(i.issue_date)}</div><div class="small">Due ${fmtDate(i.due_date)}</div>${i.status === 'paid' ? `<div class="small"><b>PAID</b> ${fmtDate(i.paid_date)}</div>` : ''}</div></div>
      <div style="margin:28px 0 18px"><div class="muted small">BILL TO</div><b>${h(c?.company || c?.name || '—')}</b>
        <div class="pre small">${h([c?.company ? c.name : '', c?.billing_address || c?.address, c?.billing_email || c?.email, c?.tax_id && 'GST/Tax: ' + c.tax_id].filter(Boolean).join('\n'))}</div>${w ? `<div class="small muted">Project: ${h(w.name)}${w.domain ? ' (' + h(w.domain) + ')' : ''}</div>` : ''}</div>
      <table><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead><tbody>
        ${i.items.map((it) => `<tr><td>${h(it.description)}</td><td class="right num">${h(it.qty)}</td><td class="right num">${money(it.rate)}</td><td class="right num">${money(it.qty * it.rate)}</td></tr>`).join('')}</tbody></table>
      <div class="totals"><div><span>Subtotal</span><span class="num">${money(i.subtotal)}</span></div>${i.discount ? `<div><span>Discount</span><span class="num">−${money(i.discount)}</span></div>` : ''}
        <div><span>Tax (${h(i.tax_rate)}%)</span><span class="num">${money(i.tax)}</span></div><div class="grand"><span>Total</span><span class="num">${money(i.total)}</span></div></div>
      ${s.payment_details ? `<div style="margin-top:24px"><div class="muted small">PAYMENT DETAILS</div><div class="pre small">${h(s.payment_details)}</div></div>` : ''}
      ${i.notes ? `<div style="margin-top:18px"><div class="muted small">NOTES</div><div class="pre small">${h(i.notes)}</div></div>` : ''}</div>`
    + (FE ? `<p class="no-print" style="margin-top:20px"><button class="danger sm" data-act="invDelete" data-id="${i.id}">Delete invoice</button></p>` : '');
};

// ---------- follow-ups ----------
async function fuFields() {
  const [clients, sites, users] = await Promise.all([clientOptions(), api('GET', '/websites'), userOptions()]);
  return [
    { name: 'subject', label: 'Subject', required: true, full: true, placeholder: 'Call about renewal, chase payment, send proposal…' },
    { name: 'client_id', label: 'Client', type: 'select', options: opts(clients, '— None —') },
    { name: 'website_id', label: 'Website', type: 'select', options: opts(sites, '— None —') },
    { name: 'due_date', label: 'Follow up on', type: 'date' },
    { name: 'channel', label: 'Channel', type: 'select', options: [['call', 'Call'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['meeting', 'Meeting'], ['other', 'Other']] },
    { name: 'assigned_to', label: 'Assigned to', type: 'select', options: opts(users) },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true },
  ];
}
ACT.fuNew = async () => openModal({ title: 'New follow-up', wide: true, body: formHTML(await fuFields(), { due_date: todayStr(), assigned_to: S.me.id }), onSubmit: async (d) => { await api('POST', '/followups', d); refresh(); } });
ACT.fuEdit = async (ds) => {
  const f = (await api('GET', '/followups')).find((x) => x.id === +ds.id);
  openModal({ title: 'Edit follow-up', wide: true, body: formHTML(await fuFields(), f), onSubmit: async (d) => { await api('PUT', `/followups/${ds.id}`, d); refresh(); } });
};
ACT.fuDone = async (ds) => { await api('PUT', `/followups/${ds.id}`, { status: 'done' }); toast('Follow-up done'); refresh(); };
ACT.fuReopen = async (ds) => { await api('PUT', `/followups/${ds.id}`, { status: 'pending' }); refresh(); };
ACT.fuDelete = async (ds) => { if (await confirmBox('Delete follow-up?', 'Remove this follow-up?')) { await api('DELETE', `/followups/${ds.id}`); refresh(); } };
PAGES.followups = async (m) => {
  m.innerHTML = pageHead('Follow-ups', '<button class="primary" data-act="fuNew">+ New follow-up</button>', 'Payment reminders, onboarding chases, renewals and sales follow-ups')
    + '<div class="card"><div class="toolbar"><select id="fst"><option value="pending">Pending</option><option value="done">Done</option><option value="">All</option></select></div><div id="flist"></div></div>';
  const load = async () => {
    const rows = await api('GET', '/followups?status=' + $('#fst').value);
    $('#flist').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Subject</th><th>Client / website</th><th>Channel</th><th>Assigned</th><th>Due</th><th></th></tr></thead><tbody>${rows.map((f) => `<tr>
      <td><b>${h(f.subject)}</b>${f.invoice_number ? ` <a href="#/invoice/${f.invoice_id}" class="small">${h(f.invoice_number)}</a>` : ''}${f.notes ? `<div class="muted small pre">${h(f.notes)}</div>` : ''}</td>
      <td class="small">${f.client_id ? `<a href="#/client/${f.client_id}">${h(f.client_name)}</a>` : ''}${f.website_id ? `<br><a href="#/website/${f.website_id}">${h(f.website_name)}</a>` : ''}</td>
      <td>${badge('x', f.channel)}</td><td>${h(f.assignee_name || '—')}</td><td>${f.status === 'pending' ? dueBadge(f.due_date) : badge('done', 'Done ' + fmtDate(f.completed_at))}</td>
      <td class="right nowrap">${f.status === 'pending' ? `<button class="sm" data-act="fuDone" data-id="${f.id}">Done</button>` : `<button class="sm" data-act="fuReopen" data-id="${f.id}">Reopen</button>`} <button class="sm" data-act="fuEdit" data-id="${f.id}">Edit</button> <button class="sm danger" data-act="fuDelete" data-id="${f.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No follow-ups.</div>';
  };
  $('#fst').addEventListener('change', load);
  await load();
};

// ---------- onboarding ----------
ACT.onbNew = async (ds) => {
  const [clients, sites] = await Promise.all([api('GET', '/clients'), api('GET', '/websites')]);
  if (!clients.length) return toast('Add a client first');
  const siteOpts = (cid) => [['', '— Create a new website —'], ...sites.filter((s) => !cid || String(s.client_id) === String(cid)).map((s) => [s.id, s.name])];
  const m = openModal({
    title: 'Request access & details from client', wide: true, submit: 'Create link',
    body: formHTML([
      { name: 'client_id', label: 'Client', type: 'select', options: opts(clients), required: true },
      { name: 'website_id', label: 'Website', type: 'select', options: siteOpts(ds.client || clients[0].id) },
      { name: 'new_website_name', label: 'New website name', placeholder: 'Only if creating a new website' },
      { name: 'new_website_domain', label: 'New website domain', placeholder: 'example.com' },
      { type: 'html', full: true, html: `<label>What do you need from the client?</label><div class="checks">${ONBOARD_ITEMS.map(([l], i) => `<label class="check"><input type="checkbox" name="items[]" value="${h(l)}" ${i < 4 || l.startsWith('Billing') ? 'checked' : ''}> ${h(l)}</label>`).join('')}</div>` },
      { name: 'message', label: 'Message to client', type: 'textarea', full: true },
      { name: 'expires_days', label: 'Link valid for (days)', type: 'number' },
    ], { client_id: ds.client || clients[0].id, website_id: ds.site || '', expires_days: 14, message: `Hi! To get started on your website, please share the access details below. Everything you submit is encrypted and only visible to our team.\n\nThanks,\n${S.settings.company_name}` }),
    onOpen: (f) => {
      const cs = $('[name=client_id]', f), ws = $('[name=website_id]', f);
      cs.addEventListener('change', () => { ws.innerHTML = siteOpts(cs.value).map(([v, l]) => `<option value="${h(v)}">${h(l)}</option>`).join(''); });
    },
    onSubmit: async (d) => {
      const r = await api('POST', '/onboarding', d);
      const link = location.origin + '/onboard/' + r.token;
      const msg = `Hi, please share your website access & billing details securely here: ${link}`;
      m.close();
      openModal({
        title: 'Onboarding link ready',
        body: `<p>Send this secure link to your client. When they submit, their logins are saved (encrypted) to the website's vault and you get a follow-up to review.</p>
          <div class="secret-box">${h(link)}</div><p><button type="button" class="primary" data-act="copy" data-text="${h(link)}">Copy link</button> <button type="button" data-act="copy" data-text="${h(msg)}">Copy message</button>
          <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Share on WhatsApp</a></p>`,
      });
      if (location.hash.startsWith('#/onboarding') || location.hash.includes('/onboarding')) refresh();
    },
  });
};
ACT.onbView = async (ds) => {
  const o = (await api('GET', '/onboarding')).find((x) => x.id === +ds.id);
  const s = o.submission || {};
  const b = s.billing || {};
  openModal({
    title: 'Client submission',
    body: `<dl class="kv"><dt>Submitted</dt><dd>${fmtDateTime(o.submitted_at)}</dd><dt>Logins saved</dt><dd>${s.credentials_saved ?? 0} → <a href="#/website/${o.website_id}/vault" data-close>open vault</a></dd>
      ${Object.entries(b).map(([k, v]) => `<dt>${h(k.replace(/_/g, ' '))}</dt><dd class="pre">${h(v)}</dd>`).join('')}<dt>Comments</dt><dd class="pre">${h(s.comments || '—')}</dd></dl>`,
  });
};
ACT.onbComplete = async (ds) => { await api('POST', `/onboarding/${ds.id}/complete`); toast('Onboarding completed — website marked active'); refresh(); };
ACT.onbDelete = async (ds) => { if (await confirmBox('Delete request?', 'The link will stop working.')) { await api('DELETE', `/onboarding/${ds.id}`); refresh(); } };
PAGES.onboarding = async (m) => {
  const rows = await api('GET', '/onboarding');
  m.innerHTML = pageHead('Client onboarding', '<button class="primary" data-act="onbNew">+ New onboarding request</button>', 'Send clients a secure link to share hosting, domain, email & social access plus billing details')
    + `<div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Website</th><th>Requested</th><th>Status</th><th>Created</th><th>Expires</th><th></th></tr></thead><tbody>${rows.map((o) => `<tr>
      <td><a href="#/client/${o.client_id}">${h(o.client_name)}</a></td><td><a href="#/website/${o.website_id}">${h(o.website_name)}</a></td><td class="small">${o.items.length} items</td><td>${badge(o.status)}</td>
      <td class="nowrap">${fmtDate(o.created_at)}</td><td class="nowrap">${o.status === 'completed' ? '—' : dueBadge(o.expires_at)}</td>
      <td class="right nowrap">${o.status !== 'completed' ? `<button class="sm" data-act="copy" data-text="${h(location.origin + '/onboard/' + o.token)}">Copy link</button> ` : ''}${o.submission ? `<button class="sm" data-act="onbView" data-id="${o.id}">View</button> ` : ''}${o.status !== 'completed' ? `<button class="sm" data-act="onbComplete" data-id="${o.id}">Complete</button> ` : ''}<button class="sm danger" data-act="onbDelete" data-id="${o.id}">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No onboarding requests yet. Create one to collect access details from a new client.</div>'}</div>`;
};

// ---------- team ----------
let teamMeta = null;
function userFormBody(u, isNew) {
  const roleOpts = [['manager', 'Manager'], ['member', 'Team member'], ['viewer', 'Viewer (read-only)'], ...(S.me.role === 'owner' ? [['admin', 'Admin (full access)'], ['owner', 'Owner']] : [])];
  return formHTML([
    { name: 'name', label: 'Name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'role', label: 'Role', type: 'select', options: roleOpts },
    isNew ? { name: 'password', label: 'Initial password (optional)', type: 'text', help: 'Leave blank to generate one. They must change it at first login.' } : null,
    { type: 'html', full: true, html: `<div id="permBox"><label>Access permissions</label><div class="checks">${teamMeta.perms.map((p) => `<label class="check"><input type="checkbox" name="perms[]" value="${p}" ${u.perms?.[p] ? 'checked' : ''}> ${h(PERM_LABEL[p])}</label>`).join('')}</div><div class="help">Website access is limited to assigned websites unless "See all websites" is on. Assign websites from a website's "Team access" button.</div></div><p id="fullNote" class="muted small hidden">Owners and admins have full access to everything.</p>` },
  ], { role: 'member', ...u });
}
function wireUserForm(form, applyDefaults) {
  const role = $('[name=role]', form);
  const sync = (setDefaults) => {
    const full = ['owner', 'admin'].includes(role.value);
    $('#permBox', form).classList.toggle('hidden', full);
    $('#fullNote', form).classList.toggle('hidden', !full);
    if (setDefaults && !full) { const def = teamMeta.roleDefaults[role.value] || {}; $$('[name="perms[]"]', form).forEach((c) => { c.checked = !!def[c.value]; }); }
  };
  role.addEventListener('change', () => sync(true));
  sync(applyDefaults);
}
const permsObj = (arr) => Object.fromEntries((arr || []).map((p) => [p, true]));
ACT.userNew = () => openModal({
  title: 'Add team member', wide: true, body: userFormBody({}, true), onOpen: (f) => wireUserForm(f, true),
  onSubmit: async (d) => {
    const r = await api('POST', '/users', { ...d, perms: permsObj(d.perms) });
    S.users = null;
    refresh();
    showSecret(`Account created for ${d.name}`, r.temp_password, `Share this password with ${d.email} privately. They will be asked to set their own password at first sign-in.`);
  },
});
ACT.userEdit = async (ds) => {
  const u = teamMeta.users.find((x) => x.id === +ds.id);
  openModal({
    title: `Edit ${u.name}`, wide: true, body: userFormBody(u, false), onOpen: (f) => wireUserForm(f, false),
    onSubmit: async (d) => { await api('PUT', `/users/${u.id}`, { ...d, perms: permsObj(d.perms) }); S.users = null; toast('Saved'); refresh(); },
  });
};
ACT.userReset = async (ds) => {
  const u = teamMeta.users.find((x) => x.id === +ds.id);
  if (!(await confirmBox('Reset password?', `Generate a new temporary password for ${u.name}? They will be signed out everywhere.`, 'Reset password'))) return;
  const r = await api('POST', `/users/${u.id}/reset-password`);
  refresh();
  showSecret(`New password for ${u.name}`, r.temp_password, 'Share it privately. They must change it at next sign-in.');
};
ACT.userToggle = async (ds) => {
  const u = teamMeta.users.find((x) => x.id === +ds.id);
  await api('PUT', `/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' });
  S.users = null; refresh();
};
ACT.userDelete = async (ds) => {
  const u = teamMeta.users.find((x) => x.id === +ds.id);
  if (!(await confirmBox('Delete account?', `Permanently delete ${u.name} (${u.email})? Their tasks become unassigned and websites they handle become unassigned.`))) return;
  await api('DELETE', `/users/${u.id}`); S.users = null; refresh();
};
PAGES.team = async (m) => {
  teamMeta = await api('GET', '/users');
  const manageable = (u) => u.id !== S.me.id && (S.me.role === 'owner' || !['owner', 'admin'].includes(u.role));
  m.innerHTML = pageHead('Team & roles', '<button class="primary" data-act="userNew">+ Add team member</button>', 'Create sub-users, assign roles and limit what each person can see')
    + `<div class="card"><div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Status</th><th class="right">Handling</th><th class="right">Assigned</th><th class="right">Open tasks</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${teamMeta.users.map((u) => `<tr><td><b>${h(u.name)}</b>${u.id === S.me.id ? ' <span class="muted small">(you)</span>' : ''}<div class="muted small">${h(u.email)}</div>${u.reset_requested ? '<span class="badge b-warn">Password reset requested</span>' : ''}${u.must_change_password ? ' <span class="badge">Must change password</span>' : ''}</td>
      <td>${badge(u.role)}</td><td>${badge(u.status === 'active' ? 'active' : 'disabled', u.status === 'active' ? 'Active' : 'Disabled')}</td>
      <td class="right num">${u.handling}</td><td class="right num">${u.assigned}</td><td class="right num">${u.open_tasks}</td><td class="nowrap small">${u.last_login_at ? fmtDateTime(u.last_login_at) : 'Never'}</td>
      <td class="right nowrap">${manageable(u) ? `<button class="sm" data-act="userEdit" data-id="${u.id}">Edit</button> <button class="sm" data-act="userReset" data-id="${u.id}">Reset password</button> <button class="sm" data-act="userToggle" data-id="${u.id}">${u.status === 'active' ? 'Disable' : 'Enable'}</button> <button class="sm danger" data-act="userDelete" data-id="${u.id}">Delete</button>` : u.id === S.me.id ? '<a href="#/account" class="small">My account</a>' : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h2>Role guide</h2><dl class="kv">
      <dt>Owner</dt><dd>Everything, including managing admins. There must always be one owner.</dd>
      <dt>Admin</dt><dd>Full access to all data and team management (cannot manage owners/admins).</dd>
      <dt>Manager</dt><dd>Default: all websites, passwords, clients, onboarding, tasks, view revenue. Customisable.</dd>
      <dt>Team member</dt><dd>Default: only assigned websites, can view their passwords, works on own tasks.</dd>
      <dt>Viewer</dt><dd>Default: only assigned websites, no passwords, no finance.</dd></dl></div>`;
};

// ---------- settings / audit ----------
PAGES.settings = async (m) => {
  const s = await api('GET', '/settings');
  m.innerHTML = pageHead('Company settings') + `<div class="card"><form id="sf">${formHTML([
    { name: 'company_name', label: 'Company name', required: true },
    { name: 'company_email', label: 'Company email', type: 'email' },
    { name: 'company_phone', label: 'Phone' },
    { name: 'company_tax_id', label: 'GST / Tax ID' },
    { name: 'company_address', label: 'Address', type: 'textarea', full: true },
    { name: 'currency', label: 'Currency code', help: 'e.g. INR, USD, EUR, GBP, AED' },
    { name: 'tax_rate', label: 'Default tax rate %', type: 'number' },
    { name: 'invoice_prefix', label: 'Invoice prefix' },
    { name: 'invoice_next', label: 'Next invoice number', type: 'number' },
    { name: 'payment_details', label: 'Payment details (shown on invoices)', type: 'textarea', full: true, placeholder: 'Bank name, account no., IFSC, UPI ID…' },
    { name: 'invoice_terms', label: 'Default invoice terms', type: 'textarea', full: true },
  ], s)}<div class="err hidden"></div><p><button class="primary" type="submit">Save settings</button></p></form></div>`;
  $('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const d = readForm(e.target);
      await api('PUT', '/settings', d);
      Object.assign(S.settings, { company_name: d.company_name, currency: d.currency, tax_rate: d.tax_rate, invoice_terms: d.invoice_terms });
      toast('Settings saved'); refresh();
    } catch (ex) { const er = $('.err', e.target); er.textContent = ex.message; er.classList.remove('hidden'); }
  });
};
PAGES.audit = async (m) => {
  const rows = await api('GET', '/audit');
  m.innerHTML = pageHead('Activity log', '', 'Sign-ins, password reveals, changes and deletions (latest 500)')
    + `<div class="card"><div class="toolbar"><input type="search" id="aq" placeholder="Filter…"></div><div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody id="ab"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('#aq').value.toLowerCase();
    $('#ab').innerHTML = rows.filter((r) => !q || [r.user_name, r.action, r.details, r.entity].join(' ').toLowerCase().includes(q)).map((r) => `<tr><td class="nowrap small">${fmtDateTime(r.created_at)}</td><td>${h(r.user_name || '')}</td>
      <td>${badge(/deleted|failed/.test(r.action) ? 'issue' : /revealed/.test(r.action) ? 'update' : 'comment', r.action.replace(/_/g, ' '))}</td><td class="small">${h(r.entity || '')}${r.entity_id ? ' #' + r.entity_id : ''} ${h(r.details || '')}</td><td class="small muted">${h(r.ip || '')}</td></tr>`).join('');
  };
  $('#aq').addEventListener('input', draw);
  draw();
};

// ---------- my account ----------
PAGES.account = async (m) => {
  const must = S.me.must_change_password;
  const section = (id, title, fields, btn, extra = '') => `<div class="card"><h2>${title}</h2>${extra}<form id="${id}">${formHTML(fields)}<div class="err hidden"></div><p><button class="primary" type="submit">${btn}</button></p></form></div>`;
  m.innerHTML = pageHead('My account', '', `${h(S.me.email)} · ${h(S.me.role)}`)
    + (must ? '<div class="card" style="margin-bottom:16px;border-color:var(--warn)"><b>Please set a new password to continue.</b> Your account is using a temporary password.</div>' : '')
    + `<div class="grid g2">
      ${section('pwForm', 'Change password', [{ name: 'current_password', label: must ? 'Temporary password' : 'Current password', type: 'password', autocomplete: 'current-password' }, { name: 'new_password', label: 'New password (min 8)', type: 'password', autocomplete: 'new-password' }, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' }], 'Update password')}
      ${must ? '' : section('profileForm', 'Profile', [{ name: 'name', label: 'Name', value: S.me.name }, { name: 'phone', label: 'Phone', value: S.me.phone || '' }], 'Save profile')}
      ${must ? '' : section('emailForm', 'Change email', [{ name: 'email', label: 'New email', type: 'email' }, { name: 'current_password', label: 'Current password', type: 'password', autocomplete: 'current-password' }], 'Change email')}
      ${must ? '' : section('delForm', 'Delete my account', [{ name: 'current_password', label: 'Current password', type: 'password', autocomplete: 'current-password' }, { name: 'confirm', label: 'Type DELETE to confirm' }], 'Delete my account', '<p class="muted small">This permanently removes your login. Websites and data you created stay with the company.</p>')}
    </div>`;
  const bind = (id, fn) => {
    const f = $('#' + id);
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const er = $('.err', f); er.classList.add('hidden');
      try { await fn(readForm(f)); } catch (ex) { er.textContent = ex.message; er.classList.remove('hidden'); }
    });
  };
  bind('pwForm', async (d) => {
    if (d.new_password !== d.confirm) throw new Error('New passwords do not match');
    await api('PUT', '/account/password', d);
    S.me.must_change_password = false;
    toast('Password updated');
    location.hash = '#/dashboard'; refresh();
  });
  bind('profileForm', async (d) => { await api('PUT', '/account/profile', d); Object.assign(S.me, d); toast('Profile saved'); refresh(); });
  bind('emailForm', async (d) => { await api('PUT', '/account/email', d); S.me.email = d.email.trim().toLowerCase(); toast('Email changed'); refresh(); });
  bind('delForm', async (d) => { await api('DELETE', '/account', d); S.me = null; location.hash = '#/'; route(); });
};

route();
