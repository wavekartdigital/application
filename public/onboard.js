'use strict';
/* Public client onboarding form: clients share access details & billing info via a token link. */
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('root');
const token = location.pathname.split('/').pop();

const CATEGORY = [
  [/hosting|cpanel/i, 'hosting'], [/domain/i, 'domain'], [/email/i, 'email'], [/admin|wordpress|cms/i, 'cms'], [/ftp/i, 'ftp'],
  [/database/i, 'database'], [/analytics|search console/i, 'analytics'], [/facebook|instagram|linkedin|youtube|business profile/i, 'social'],
];
const catFor = (label) => (CATEGORY.find(([re]) => re.test(label)) || [null, 'other'])[1];

async function call(method, body) {
  const r = await fetch('/api/public/onboard/' + encodeURIComponent(token), {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function accessBlock(label, i) {
  return `<div class="acc" data-cat="${h(catFor(label))}"><h3>${h(label)}</h3><div class="form">
    <input type="hidden" data-k="label" value="${h(label)}">
    <div><label for="u${i}">Login URL</label><input id="u${i}" data-k="url" placeholder="https://…"></div>
    <div><label for="n${i}">Username / email</label><input id="n${i}" data-k="username" autocomplete="off"></div>
    <div><label for="p${i}">Password</label><input id="p${i}" data-k="password" type="password" autocomplete="new-password"></div>
    <div><label for="o${i}">Notes</label><input id="o${i}" data-k="notes" placeholder="2FA, provider name, anything else" autocomplete="off"></div>
  </div></div>`;
}

async function init() {
  let d;
  try { d = await call('GET'); }
  catch (e) { root.innerHTML = `<div class="card"><h1>Link unavailable</h1><p>${h(e.message)}</p></div>`; return; }
  document.title = `${d.company_name} · Onboarding`;
  const access = d.items.filter((x) => !/billing|brand/i.test(x));
  const wantsBilling = d.items.some((x) => /billing/i.test(x));
  const wantsBrand = d.items.some((x) => /brand/i.test(x));
  const c = d.client || {};
  root.innerHTML = `<div class="card" style="margin-bottom:16px"><h1>${h(d.company_name)}</h1>
      <p class="muted">Onboarding for <b>${h(d.website.name || '')}</b>${d.website.domain ? ' (' + h(d.website.domain) + ')' : ''}</p>
      <p class="pre">${h(d.message || '')}</p>
      <p class="small muted">🔒 Your details are sent over an encrypted connection and stored encrypted. Leave any field blank if it doesn't apply.</p></div>
    <form id="f">
      ${access.length ? `<h2>Access details</h2>${access.map(accessBlock).join('')}
        <p><button type="button" id="more">+ Add another login</button></p>` : ''}
      <div id="extra"></div>
      ${wantsBilling ? `<div class="card" style="margin:16px 0"><h2>Billing / invoice details</h2><div class="form">
        <div><label>Company / billing name</label><input name="company" value="${h(c.company || '')}"></div>
        <div><label>Phone</label><input name="phone" value="${h(c.phone || '')}"></div>
        <div><label>Billing email</label><input name="billing_email" type="email" value="${h(c.billing_email || c.email || '')}"></div>
        <div><label>GST / Tax ID</label><input name="tax_id" value="${h(c.tax_id || '')}"></div>
        <div class="full"><label>Billing address</label><textarea name="billing_address">${h(c.billing_address || '')}</textarea></div></div></div>` : ''}
      <div class="card" style="margin:16px 0"><h2>Anything else?</h2>
        <label>${wantsBrand ? 'Links to brand assets (logo, colours, fonts) and any comments' : 'Comments for our team'}</label><textarea name="comments"></textarea></div>
      <div id="err" class="err"></div>
      <button class="primary" type="submit">Submit securely</button>
    </form>`;
  let n = access.length;
  const more = document.getElementById('more');
  if (more) more.addEventListener('click', () => {
    const label = prompt('What is this login for? (e.g. Payment gateway, Mailchimp)');
    if (label) document.getElementById('extra').insertAdjacentHTML('beforeend', accessBlock(label.slice(0, 100), n++));
  });
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    const accessData = [...form.querySelectorAll('.acc')].map((b) => ({ category: b.dataset.cat, ...Object.fromEntries([...b.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()])) }));
    const billing = {};
    for (const k of ['company', 'phone', 'billing_email', 'tax_id', 'billing_address']) if (form.elements[k]) billing[k] = form.elements[k].value.trim();
    try {
      const r = await call('POST', { access: accessData, billing, comments: form.elements.comments.value.trim() });
      root.innerHTML = `<div class="card"><h1>Thank you! ✅</h1><p>We received your details${r.saved ? ` (${r.saved} login${r.saved === 1 ? '' : 's'})` : ''}. Our team at ${h(d.company_name)} will be in touch shortly.</p><p class="muted small">You can close this page. If you need to send more details, you can reopen the same link.</p></div>`;
    } catch (ex) {
      document.getElementById('err').textContent = ex.message;
      btn.disabled = false;
    }
  });
}
init();
