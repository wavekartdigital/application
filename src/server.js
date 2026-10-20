const express = require('express');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, getSettings, setSetting, insert, update } = require('./db');
const { encrypt, decrypt } = require('./vault');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_MS = 7 * 24 * 3600 * 1000;
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';

// ---------- constants ----------
const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'];
const PERMS = ['all_websites', 'websites_edit', 'credentials_view', 'credentials_edit', 'finance_view', 'finance_edit', 'clients_manage', 'tasks_manage', 'users_manage'];
const ROLE_DEFAULTS = {
  manager: { all_websites: true, websites_edit: true, credentials_view: true, credentials_edit: true, finance_view: true, clients_manage: true, tasks_manage: true },
  member: { credentials_view: true },
  viewer: {},
};
const SITE_STATUS = ['onboarding', 'active', 'paused', 'exited'];
const CYCLES = ['one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const FREQ = ['once', 'daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const CRED_CATS = ['email', 'hosting', 'server', 'domain', 'cms', 'ftp', 'database', 'social', 'analytics', 'payment', 'api', 'other'];
const NOTE_TYPES = ['comment', 'commercial', 'approach', 'update', 'issue', 'meeting', 'task'];

// ---------- utils ----------
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const round2 = (n) => Math.round(n * 100) / 100;
const daysFromNow = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function addPeriod(dateStr, period) {
  const d = new Date((isDate(dateStr) ? dateStr : today()) + 'T00:00:00Z');
  if (period === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (period === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (CYCLE_MONTHS[period]) {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + CYCLE_MONTHS[period]);
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, dim));
  } else return null;
  return d.toISOString().slice(0, 10);
}
const monthlyValue = (price, cycle) => (CYCLE_MONTHS[cycle] ? (price || 0) / CYCLE_MONTHS[cycle] : 0);

// Whitelist + coerce request fields. Only keys present in the body are returned.
function clean(body, spec) {
  const out = {};
  for (const [k, t] of Object.entries(spec)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (t === 'num') { v = Number(v); if (!Number.isFinite(v)) throw bad(`${k} must be a number`); }
      else if (t === 'id') { v = parseInt(v, 10); if (!Number.isInteger(v)) throw bad(`${k} is invalid`); }
      else if (t === 'date') { if (!isDate(v)) throw bad(`${k} must be a date (YYYY-MM-DD)`); }
      else if (Array.isArray(t)) { if (!t.includes(v)) throw bad(`Invalid value for ${k}`); }
      else v = String(v).slice(0, t === 'text' ? 20000 : 500).trim();
    }
    out[k] = v;
  }
  return out;
}
function requireFields(obj, fields) {
  for (const f of fields) if (obj[f] === null || obj[f] === undefined || obj[f] === '') throw bad(`${f.replace(/_/g, ' ')} is required`);
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 200) throw bad('Password is too long');
}
function checkEmail(e) {
  if (typeof e !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('A valid email is required');
  return e.trim().toLowerCase();
}
const tempPassword = () => crypto.randomBytes(9).toString('base64url');

// ---------- middleware ----------
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});
// CSRF guard: state-changing API calls must carry a custom header, which browsers never send cross-site without CORS.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ error: 'Bad request origin' });
  res.set('Cache-Control', 'no-store');
  next();
});

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function effectivePerms(u) {
  if (u.role === 'owner' || u.role === 'admin') return Object.fromEntries(PERMS.map((p) => [p, true]));
  let p = {};
  try { p = JSON.parse(u.perms || '{}'); } catch {}
  return Object.fromEntries(PERMS.map((k) => [k, !!p[k]]));
}
const isAdmin = (u) => u.role === 'owner' || u.role === 'admin';

app.use('/api', (req, res, next) => {
  const token = parseCookies(req).sid;
  if (token) {
    const u = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`).get(sha(token), Date.now());
    if (u) { u.perms = effectivePerms(u); req.user = u; req.sessionHash = sha(token); }
  }
  next();
});

function auth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  if (req.user.must_change_password && !['/account/password', '/auth/logout', '/auth/me'].includes(req.path))
    return res.status(403).json({ error: 'You must change your password first', code: 'must_change' });
  next();
}
const perm = (...ps) => (req, res, next) => (ps.some((p) => req.user.perms[p]) ? next() : res.status(403).json({ error: 'You do not have access to this' }));
const adminOnly = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Admins only' }));

function audit(req, action, entity, entityId, details) {
  db.prepare('INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)')
    .run(req.user?.id ?? null, req.user?.name ?? 'public', action, entity ?? null, entityId ?? null, details ? String(details).slice(0, 1000) : null, req.ip);
}

// Simple in-memory rate limiter
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
  h.n++;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60000).unref();

// ---------- visibility ----------
function siteFilter(user, alias = 'w') {
  if (user.perms.all_websites) return { sql: '1=1', params: [] };
  return { sql: `(${alias}.handler_id = ? OR ${alias}.id IN (SELECT website_id FROM website_members WHERE user_id = ?))`, params: [user.id, user.id] };
}
function getSite(user, id) {
  const f = siteFilter(user);
  const w = db.prepare(`SELECT w.* FROM websites w WHERE w.id = ? AND ${f.sql}`).get(id, ...f.params);
  if (!w) throw new HttpError(404, 'Website not found');
  return w;
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, perms: u.perms, status: u.status, must_change_password: !!u.must_change_password, last_login_at: u.last_login_at, created_at: u.created_at };
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, Date.now() + SESSION_MS);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: SESSION_MS, path: '/' });
}

const api = express.Router();
app.use('/api', api);

// ---------- setup & auth ----------
api.get('/setup', (req, res) => {
  res.json({ needsSetup: db.prepare('SELECT COUNT(*) c FROM users').get().c === 0 });
});
api.post('/setup', (req, res) => {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) throw new HttpError(409, 'Setup already completed');
  const { name, password, company_name } = req.body;
  const email = checkEmail(req.body.email);
  if (!name) throw bad('Name is required');
  checkPassword(password);
  if (company_name) setSetting('company_name', String(company_name).slice(0, 200));
  const id = insert('users', { name: String(name).slice(0, 200), email, password_hash: bcrypt.hashSync(password, 11), role: 'owner', perms: '{}' });
  startSession(res, id);
  res.json({ ok: true });
});

api.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (limited('login:' + req.ip, 20, 15 * 60000) || limited('login:' + email, 8, 15 * 60000))
    throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    audit(req, 'login_failed', 'user', u?.id, email);
    throw new HttpError(401, 'Invalid email or password');
  }
  if (u.status !== 'active') throw new HttpError(403, 'This account is disabled. Contact your admin.');
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(u.id);
  startSession(res, u.id);
  req.user = u;
  audit(req, 'login', 'user', u.id);
  res.json({ ok: true });
});
api.post('/auth/logout', (req, res) => {
  if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});
api.get('/auth/me', auth, (req, res) => {
  const s = getSettings();
  res.json({ user: publicUser(req.user), settings: { company_name: s.company_name, currency: s.currency, tax_rate: s.tax_rate } });
});
api.post('/auth/forgot', (req, res) => {
  if (limited('forgot:' + req.ip, 5, 15 * 60000)) throw new HttpError(429, 'Too many requests');
  const u = db.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").get(String(req.body.email || '').trim().toLowerCase());
  if (u) {
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), u.id, Date.now() + 3600000);
    const link = `${req.protocol}://${req.get('host')}/#/reset/${token}`;
    // No mail server is configured by default: the link is printed to the server log and admins see a "reset requested" flag.
    console.log(`[password reset] ${u.email}: ${link}`);
    req.user = u;
    audit(req, 'password_reset_requested', 'user', u.id);
  }
  res.json({ ok: true, message: 'If that email exists, a reset was requested. Ask your admin for the link or a temporary password.' });
});
api.post('/auth/reset', (req, res) => {
  const { token, password } = req.body;
  checkPassword(password);
  const r = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?').get(sha(String(token || '')), Date.now());
  if (!r) throw bad('This reset link is invalid or has expired');
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(password, 11), r.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(r.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.user_id);
  })();
  res.json({ ok: true });
});

// ---------- own account ----------
api.put('/account/profile', auth, (req, res) => {
  const d = clean(req.body, { name: 'str', phone: 'str' });
  if ('name' in d) requireFields(d, ['name']);
  update('users', req.user.id, d);
  res.json({ ok: true });
});
api.put('/account/password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!bcrypt.compareSync(String(current_password || ''), req.user.password_hash)) throw bad('Current password is incorrect');
  checkPassword(new_password);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(new_password, 11), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
  audit(req, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
});
api.put('/account/email', auth, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.current_password || ''), req.user.password_hash)) throw bad('Current password is incorrect');
  const email = checkEmail(req.body.email);
  update('users', req.user.id, { email });
  audit(req, 'email_changed', 'user', req.user.id, `${req.user.email} -> ${email}`);
  res.json({ ok: true });
});
api.delete('/account', auth, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.current_password || ''), req.user.password_hash)) throw bad('Current password is incorrect');
  if (req.body.confirm !== 'DELETE') throw bad('Type DELETE to confirm');
  if (req.user.role === 'owner' && db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner'").get().c <= 1)
    throw bad('You are the only owner. Make another user an owner before deleting your account.');
  audit(req, 'account_deleted', 'user', req.user.id, req.user.email);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

// ---------- team / users ----------
function canManageUser(actor, target) {
  if (actor.role === 'owner') return true;
  return actor.perms.users_manage && !['owner', 'admin'].includes(target.role);
}
function canAssignRole(actor, role) {
  if (!ROLES.includes(role)) return false;
  if (actor.role === 'owner') return true;
  return !['owner', 'admin'].includes(role);
}
function normPerms(role, perms) {
  if (role === 'owner' || role === 'admin') return '{}';
  const src = perms && typeof perms === 'object' ? perms : ROLE_DEFAULTS[role] || {};
  return JSON.stringify(Object.fromEntries(PERMS.map((p) => [p, !!src[p]])));
}
const ownerCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner' AND status = 'active'").get().c;

api.get('/users/options', auth, (req, res) => {
  res.json(db.prepare("SELECT id, name, role FROM users WHERE status = 'active' ORDER BY name").all());
});
api.get('/users', auth, perm('users_manage'), (req, res) => {
  const rows = db.prepare(`SELECT u.*,
      (SELECT COUNT(*) FROM websites w WHERE w.handler_id = u.id AND w.status != 'exited') handling,
      (SELECT COUNT(*) FROM website_members m WHERE m.user_id = u.id) assigned,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.status != 'done') open_tasks,
      EXISTS(SELECT 1 FROM password_resets r WHERE r.user_id = u.id AND r.used = 0 AND r.expires_at > ?) reset_requested
    FROM users u ORDER BY u.created_at`).all(Date.now());
  res.json({ users: rows.map((u) => ({ ...publicUser({ ...u, perms: effectivePerms(u) }), handling: u.handling, assigned: u.assigned, open_tasks: u.open_tasks, reset_requested: !!u.reset_requested })), roleDefaults: ROLE_DEFAULTS, perms: PERMS });
});
api.post('/users', auth, perm('users_manage'), (req, res) => {
  const d = clean(req.body, { name: 'str', phone: 'str', role: ROLES });
  requireFields(d, ['name', 'role']);
  if (!canAssignRole(req.user, d.role)) throw new HttpError(403, 'You cannot assign that role');
  const email = checkEmail(req.body.email);
  const pw = req.body.password ? String(req.body.password) : tempPassword();
  checkPassword(pw);
  const id = insert('users', { ...d, email, perms: normPerms(d.role, req.body.perms), password_hash: bcrypt.hashSync(pw, 11), must_change_password: 1 });
  audit(req, 'user_created', 'user', id, `${email} (${d.role})`);
  res.json({ id, temp_password: pw });
});
api.put('/users/:id', auth, perm('users_manage'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  if (!canManageUser(req.user, target)) throw new HttpError(403, 'You cannot edit this user');
  const d = clean(req.body, { name: 'str', phone: 'str', role: ROLES, status: ['active', 'disabled'] });
  if ('email' in req.body) d.email = checkEmail(req.body.email);
  const role = d.role || target.role;
  if (d.role && !canAssignRole(req.user, d.role)) throw new HttpError(403, 'You cannot assign that role');
  if (target.id === req.user.id && ((d.role && d.role !== target.role) || d.status === 'disabled')) throw bad('You cannot change your own role or disable yourself');
  if (target.role === 'owner' && ((d.role && d.role !== 'owner') || d.status === 'disabled') && ownerCount() <= 1) throw bad('There must be at least one active owner');
  if ('perms' in req.body || d.role) d.perms = normPerms(role, req.body.perms);
  update('users', target.id, d);
  if (d.status === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  audit(req, 'user_updated', 'user', target.id, JSON.stringify({ ...d, perms: undefined }));
  res.json({ ok: true });
});
api.post('/users/:id/reset-password', auth, perm('users_manage'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  if (!canManageUser(req.user, target)) throw new HttpError(403, 'You cannot reset this user');
  const pw = tempPassword();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(bcrypt.hashSync(pw, 11), target.id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(target.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  })();
  audit(req, 'password_reset_by_admin', 'user', target.id);
  res.json({ temp_password: pw });
});
api.delete('/users/:id', auth, perm('users_manage'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.id === req.user.id) throw bad('Use My Account to delete your own account');
  if (!canManageUser(req.user, target)) throw new HttpError(403, 'You cannot delete this user');
  if (target.role === 'owner' && ownerCount() <= 1) throw bad('There must be at least one owner');
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  audit(req, 'user_deleted', 'user', target.id, target.email);
  res.json({ ok: true });
});

// ---------- settings & audit ----------
const SETTING_KEYS = ['company_name', 'company_email', 'company_phone', 'company_address', 'company_tax_id', 'currency', 'tax_rate', 'invoice_prefix', 'invoice_next', 'invoice_terms', 'payment_details'];
api.get('/settings', auth, (req, res) => res.json(getSettings()));
api.put('/settings', auth, adminOnly, (req, res) => {
  for (const k of SETTING_KEYS) if (k in req.body) setSetting(k, String(req.body[k] ?? '').slice(0, 5000));
  audit(req, 'settings_updated', 'settings');
  res.json({ ok: true });
});
api.get('/audit', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all());
});

// ---------- clients ----------
const CLIENT_SPEC = { name: 'str', company: 'str', email: 'str', phone: 'str', address: 'text', tax_id: 'str', billing_email: 'str', billing_address: 'text', status: ['lead', 'onboarding', 'active', 'inactive', 'exited'], source: 'str', notes: 'text' };
const canSeeClients = perm('clients_manage', 'finance_view');

api.get('/clients', auth, canSeeClients, (req, res) => {
  res.json(db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM websites w WHERE w.client_id = c.id AND w.status != 'exited') active_sites,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.client_id = c.id AND p.type = 'income') revenue,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.client_id = c.id AND i.status = 'sent') outstanding
    FROM clients c ORDER BY c.name COLLATE NOCASE`).all());
});
api.get('/clients/:id', auth, canSeeClients, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) throw new HttpError(404, 'Client not found');
  res.json({
    client: c,
    websites: db.prepare('SELECT w.*, u.name handler_name FROM websites w LEFT JOIN users u ON u.id = w.handler_id WHERE w.client_id = ? ORDER BY w.name').all(c.id),
    invoices: req.user.perms.finance_view ? db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY issue_date DESC').all(c.id) : [],
    payments: req.user.perms.finance_view ? db.prepare('SELECT * FROM payments WHERE client_id = ? ORDER BY date DESC').all(c.id) : [],
    followups: db.prepare('SELECT f.*, u.name assignee_name FROM followups f LEFT JOIN users u ON u.id = f.assigned_to WHERE f.client_id = ? ORDER BY f.status DESC, f.due_date').all(c.id),
    onboarding: db.prepare('SELECT id, token, website_id, status, created_at, submitted_at, expires_at FROM onboarding WHERE client_id = ? ORDER BY id DESC').all(c.id),
  });
});
api.post('/clients', auth, perm('clients_manage'), (req, res) => {
  const d = clean(req.body, CLIENT_SPEC);
  requireFields(d, ['name']);
  const id = insert('clients', d);
  audit(req, 'client_created', 'client', id, d.name);
  res.json({ id });
});
api.put('/clients/:id', auth, perm('clients_manage'), (req, res) => {
  const d = clean(req.body, CLIENT_SPEC);
  if ('name' in d) requireFields(d, ['name']);
  update('clients', req.params.id, { ...d, updated_at: new Date().toISOString() });
  audit(req, 'client_updated', 'client', +req.params.id);
  res.json({ ok: true });
});
api.delete('/clients/:id', auth, perm('clients_manage'), adminOnly, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  audit(req, 'client_deleted', 'client', +req.params.id);
  res.json({ ok: true });
});

// ---------- websites ----------
const SITE_SPEC = {
  client_id: 'id', name: 'str', domain: 'str', url: 'str', category: 'str', services: 'text', status: SITE_STATUS, handler_id: 'id',
  onboard_date: 'date', exit_date: 'date', exit_reason: 'text', billing_cycle: CYCLES, price: 'num', setup_fee: 'num', next_billing_date: 'date', special_comments: 'text',
};
const FINANCE_FIELDS = ['price', 'setup_fee', 'next_billing_date', 'billing_cycle', 'revenue', 'mrr'];
function siteOut(user, w) {
  const o = { ...w, social: safeJson(w.social, {}) };
  if (!user.perms.finance_view) for (const f of FINANCE_FIELDS) delete o[f];
  else o.mrr = round2(monthlyValue(w.price, w.billing_cycle));
  return o;
}
function safeJson(s, dflt) { try { return JSON.parse(s) ?? dflt; } catch { return dflt; } }
function siteBody(body) {
  const d = clean(body, SITE_SPEC);
  if ('price' in d && d.price === null) d.price = 0;
  if ('setup_fee' in d && d.setup_fee === null) d.setup_fee = 0;
  if ('billing_cycle' in d && d.billing_cycle === null) d.billing_cycle = 'monthly';
  if ('status' in d && d.status === null) d.status = 'active';
  if (body.social && typeof body.social === 'object') {
    const s = {};
    for (const [k, v] of Object.entries(body.social).slice(0, 30)) if (v) s[String(k).slice(0, 50)] = String(v).slice(0, 500);
    d.social = JSON.stringify(s);
  }
  if (d.domain) d.domain = d.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return d;
}

api.get('/websites', auth, (req, res) => {
  const f = siteFilter(req.user);
  const rows = db.prepare(`SELECT w.*, c.name client_name, u.name handler_name,
      (SELECT COUNT(*) FROM credentials x WHERE x.website_id = w.id) cred_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.website_id = w.id AND t.status != 'done') open_tasks,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.website_id = w.id AND p.type = 'income') revenue
    FROM websites w LEFT JOIN clients c ON c.id = w.client_id LEFT JOIN users u ON u.id = w.handler_id
    WHERE ${f.sql} ORDER BY w.name COLLATE NOCASE`).all(...f.params);
  res.json(rows.map((w) => siteOut(req.user, w)));
});
api.get('/websites/:id', auth, (req, res) => {
  const w = getSite(req.user, req.params.id);
  const P = req.user.perms;
  const site = siteOut(req.user, {
    ...w,
    revenue: db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE website_id = ? AND type = 'income'").get(w.id).v,
  });
  res.json({
    website: site,
    client: w.client_id ? db.prepare('SELECT id, name, company, email, phone FROM clients WHERE id = ?').get(w.client_id) : null,
    handler: w.handler_id ? db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(w.handler_id) : null,
    members: db.prepare('SELECT u.id, u.name, u.role FROM website_members m JOIN users u ON u.id = m.user_id WHERE m.website_id = ?').all(w.id),
    credentials: P.credentials_view
      ? db.prepare('SELECT id, category, label, provider, url, username, renewal_date, renewal_cost, updated_at, secret_enc IS NOT NULL has_secret, notes_enc IS NOT NULL has_notes FROM credentials WHERE website_id = ? ORDER BY category, label').all(w.id)
      : null,
    tasks: db.prepare('SELECT t.*, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.website_id = ? ORDER BY t.status = \'done\', t.due_date IS NULL, t.due_date').all(w.id),
    notes: db.prepare('SELECT n.*, u.name author_name FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.website_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 200').all(w.id)
      .map((n) => (P.finance_view ? n : { ...n, amount: null })),
    invoices: P.finance_view ? db.prepare('SELECT * FROM invoices WHERE website_id = ? ORDER BY issue_date DESC').all(w.id) : null,
    payments: P.finance_view ? db.prepare('SELECT * FROM payments WHERE website_id = ? ORDER BY date DESC').all(w.id) : null,
    onboarding: P.clients_manage ? db.prepare('SELECT id, token, status, created_at, submitted_at FROM onboarding WHERE website_id = ? ORDER BY id DESC').all(w.id) : null,
  });
});
api.post('/websites', auth, perm('websites_edit'), (req, res) => {
  const d = siteBody(req.body);
  requireFields(d, ['name']);
  if (!d.onboard_date) d.onboard_date = today();
  if (!req.user.perms.finance_edit) for (const f of ['price', 'setup_fee', 'next_billing_date', 'billing_cycle']) delete d[f];
  const id = insert('websites', d);
  if (!req.user.perms.all_websites) db.prepare('INSERT OR IGNORE INTO website_members (website_id, user_id) VALUES (?,?)').run(id, req.user.id);
  audit(req, 'website_created', 'website', id, d.name);
  res.json({ id });
});
api.put('/websites/:id', auth, perm('websites_edit'), (req, res) => {
  const w = getSite(req.user, req.params.id);
  const d = siteBody(req.body);
  if ('name' in d) requireFields(d, ['name']);
  if (!req.user.perms.finance_edit) for (const f of ['price', 'setup_fee', 'next_billing_date', 'billing_cycle']) delete d[f];
  if (d.status === 'exited' && !d.exit_date && !w.exit_date) d.exit_date = today();
  update('websites', w.id, { ...d, updated_at: new Date().toISOString() });
  audit(req, 'website_updated', 'website', w.id);
  res.json({ ok: true });
});
api.delete('/websites/:id', auth, adminOnly, (req, res) => {
  const w = getSite(req.user, req.params.id);
  db.prepare('DELETE FROM websites WHERE id = ?').run(w.id);
  audit(req, 'website_deleted', 'website', w.id, w.name);
  res.json({ ok: true });
});
api.put('/websites/:id/members', auth, perm('websites_edit'), (req, res) => {
  const w = getSite(req.user, req.params.id);
  const ids = (Array.isArray(req.body.user_ids) ? req.body.user_ids : []).map(Number).filter(Number.isInteger);
  db.transaction(() => {
    db.prepare('DELETE FROM website_members WHERE website_id = ?').run(w.id);
    const ins = db.prepare('INSERT OR IGNORE INTO website_members (website_id, user_id) SELECT ?, id FROM users WHERE id = ?');
    for (const uid of ids) ins.run(w.id, uid);
  })();
  audit(req, 'website_members_updated', 'website', w.id, ids.join(','));
  res.json({ ok: true });
});

// ---------- credentials (vault) ----------
const CRED_SPEC = { category: CRED_CATS, label: 'str', provider: 'str', url: 'str', username: 'str', renewal_date: 'date', renewal_cost: 'num' };
function credBody(body) {
  const d = clean(body, CRED_SPEC);
  if ('category' in d && !d.category) d.category = 'other';
  if ('password' in body) d.secret_enc = encrypt(body.password ? String(body.password).slice(0, 5000) : null);
  if ('notes' in body) d.notes_enc = encrypt(body.notes ? String(body.notes).slice(0, 20000) : null);
  return d;
}
function getCred(user, id) {
  const c = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Credential not found');
  getSite(user, c.website_id);
  return c;
}
api.post('/websites/:id/credentials', auth, perm('credentials_edit'), (req, res) => {
  const w = getSite(req.user, req.params.id);
  const d = credBody(req.body);
  requireFields(d, ['label']);
  const id = insert('credentials', { ...d, website_id: w.id, created_by: req.user.id });
  audit(req, 'credential_created', 'credential', id, `${w.name}: ${d.label}`);
  res.json({ id });
});
api.put('/credentials/:id', auth, perm('credentials_edit'), (req, res) => {
  const c = getCred(req.user, req.params.id);
  const d = credBody(req.body);
  if ('label' in d) requireFields(d, ['label']);
  // An omitted / empty password on edit keeps the existing one unless explicitly cleared.
  if ('secret_enc' in d && d.secret_enc === null && !req.body.clear_password) delete d.secret_enc;
  update('credentials', c.id, { ...d, updated_at: new Date().toISOString() });
  audit(req, 'credential_updated', 'credential', c.id, c.label);
  res.json({ ok: true });
});
api.delete('/credentials/:id', auth, perm('credentials_edit'), (req, res) => {
  const c = getCred(req.user, req.params.id);
  db.prepare('DELETE FROM credentials WHERE id = ?').run(c.id);
  audit(req, 'credential_deleted', 'credential', c.id, c.label);
  res.json({ ok: true });
});
api.post('/credentials/:id/reveal', auth, perm('credentials_view'), (req, res) => {
  const c = getCred(req.user, req.params.id);
  audit(req, 'credential_revealed', 'credential', c.id, c.label);
  res.json({ password: decrypt(c.secret_enc), notes: decrypt(c.notes_enc) });
});

// ---------- tasks ----------
const TASK_SPEC = { website_id: 'id', title: 'str', description: 'text', frequency: FREQ, priority: ['low', 'normal', 'high', 'urgent'], status: ['todo', 'in_progress', 'done'], assigned_to: 'id', due_date: 'date' };
function taskVisibility(user) {
  if (user.perms.all_websites) return { sql: '1=1', params: [] };
  const f = siteFilter(user);
  return { sql: `(t.assigned_to = ? OR t.created_by = ? OR (t.website_id IS NOT NULL AND ${f.sql}))`, params: [user.id, user.id, ...f.params] };
}
function getTask(user, id) {
  const v = taskVisibility(user);
  const t = db.prepare(`SELECT t.* FROM tasks t LEFT JOIN websites w ON w.id = t.website_id WHERE t.id = ? AND ${v.sql}`).get(id, ...v.params);
  if (!t) throw new HttpError(404, 'Task not found');
  return t;
}
api.get('/tasks', auth, (req, res) => {
  const v = taskVisibility(req.user);
  let sql = `SELECT t.*, w.name website_name, u.name assignee_name FROM tasks t LEFT JOIN websites w ON w.id = t.website_id LEFT JOIN users u ON u.id = t.assigned_to WHERE ${v.sql}`;
  const params = [...v.params];
  if (req.query.scope === 'mine') { sql += ' AND t.assigned_to = ?'; params.push(req.user.id); }
  if (req.query.status === 'open') sql += " AND t.status != 'done'";
  else if (req.query.status) { sql += ' AND t.status = ?'; params.push(String(req.query.status)); }
  if (req.query.frequency) { sql += ' AND t.frequency = ?'; params.push(String(req.query.frequency)); }
  sql += " ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.id DESC LIMIT 1000";
  res.json(db.prepare(sql).all(...params));
});
api.post('/tasks', auth, (req, res) => {
  const d = clean(req.body, TASK_SPEC);
  requireFields(d, ['title']);
  if (d.website_id) getSite(req.user, d.website_id);
  if (!req.user.perms.tasks_manage) {
    if (d.assigned_to && d.assigned_to !== req.user.id) throw new HttpError(403, 'You can only create tasks for yourself');
    d.assigned_to = req.user.id;
  }
  d.frequency ||= 'once'; d.priority ||= 'normal'; d.status ||= 'todo';
  const id = insert('tasks', { ...d, created_by: req.user.id });
  audit(req, 'task_created', 'task', id, d.title);
  res.json({ id });
});
api.put('/tasks/:id', auth, (req, res) => {
  const t = getTask(req.user, req.params.id);
  const d = clean(req.body, TASK_SPEC);
  if (!req.user.perms.tasks_manage) {
    if (t.assigned_to !== req.user.id && t.created_by !== req.user.id) throw new HttpError(403, 'You can only edit your own tasks');
    if ('assigned_to' in d && d.assigned_to !== req.user.id) throw new HttpError(403, 'You cannot reassign tasks');
  }
  if (d.website_id) getSite(req.user, d.website_id);
  if ('title' in d) requireFields(d, ['title']);
  update('tasks', t.id, d);
  res.json({ ok: true });
});
api.post('/tasks/:id/complete', auth, (req, res) => {
  const t = getTask(req.user, req.params.id);
  if (!req.user.perms.tasks_manage && t.assigned_to !== req.user.id && t.created_by !== req.user.id) throw new HttpError(403, 'Not your task');
  const now = new Date().toISOString();
  let next = null;
  if (t.frequency !== 'once') {
    next = addPeriod(t.due_date || today(), t.frequency);
    while (next <= today()) next = addPeriod(next, t.frequency);
    update('tasks', t.id, { status: 'todo', due_date: next, last_completed_at: now });
  } else update('tasks', t.id, { status: 'done', last_completed_at: now });
  if (t.website_id) insert('notes', { website_id: t.website_id, type: 'task', title: `Completed: ${t.title}`, body: next ? `Next due ${next}` : null, author_id: req.user.id });
  res.json({ ok: true, next_due: next });
});
api.delete('/tasks/:id', auth, (req, res) => {
  const t = getTask(req.user, req.params.id);
  if (!req.user.perms.tasks_manage && t.created_by !== req.user.id) throw new HttpError(403, 'You cannot delete this task');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  audit(req, 'task_deleted', 'task', t.id, t.title);
  res.json({ ok: true });
});

// ---------- notes / timeline ----------
api.post('/websites/:id/notes', auth, (req, res) => {
  const w = getSite(req.user, req.params.id);
  const d = clean(req.body, { type: NOTE_TYPES, title: 'str', body: 'text', amount: 'num' });
  if (!d.title && !d.body) throw bad('Write something first');
  d.type ||= 'comment';
  const id = insert('notes', { ...d, website_id: w.id, author_id: req.user.id });
  res.json({ id });
});
api.delete('/notes/:id', auth, (req, res) => {
  const n = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!n) throw new HttpError(404, 'Note not found');
  getSite(req.user, n.website_id);
  if (n.author_id !== req.user.id && !req.user.perms.websites_edit) throw new HttpError(403, 'You cannot delete this note');
  db.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

// ---------- invoices ----------
function computeInvoice(body) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((it) => ({
    description: String(it.description || '').slice(0, 500),
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
  })).filter((it) => it.description || it.rate);
  const subtotal = round2(items.reduce((s, it) => s + it.qty * it.rate, 0));
  const discount = Math.max(0, Number(body.discount) || 0);
  const tax_rate = Math.max(0, Number(body.tax_rate) || 0);
  const tax = round2((subtotal - discount) * tax_rate / 100);
  return { items: JSON.stringify(items), subtotal, discount, tax_rate, tax, total: round2(subtotal - discount + tax) };
}
function nextInvoiceNumber() {
  const s = getSettings();
  let n = parseInt(s.invoice_next, 10) || 1001;
  while (db.prepare('SELECT 1 FROM invoices WHERE number = ?').get(s.invoice_prefix + n)) n++;
  setSetting('invoice_next', n + 1);
  return s.invoice_prefix + n;
}
const INV_SPEC = { client_id: 'id', website_id: 'id', issue_date: 'date', due_date: 'date', status: ['draft', 'sent', 'paid', 'cancelled'], notes: 'text' };
function invoiceOut(i) {
  return { ...i, items: safeJson(i.items, []), status: i.status === 'sent' && i.due_date && i.due_date < today() ? 'overdue' : i.status };
}
function linkClientFromSite(d) {
  if (d.website_id && !d.client_id) d.client_id = db.prepare('SELECT client_id FROM websites WHERE id = ?').get(d.website_id)?.client_id ?? null;
}
const createInvoice = db.transaction((user, d, totals) => {
  const number = nextInvoiceNumber();
  const id = insert('invoices', { ...d, ...totals, number, created_by: user.id });
  return { id, number };
});

api.get('/invoices', auth, perm('finance_view'), (req, res) => {
  const rows = db.prepare(`SELECT i.*, c.name client_name, w.name website_name FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN websites w ON w.id = i.website_id ORDER BY i.issue_date DESC, i.id DESC`).all();
  res.json(rows.map(invoiceOut));
});
api.get('/invoices/:id', auth, perm('finance_view'), (req, res) => {
  const i = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!i) throw new HttpError(404, 'Invoice not found');
  res.json({
    invoice: invoiceOut(i),
    client: i.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(i.client_id) : null,
    website: i.website_id ? db.prepare('SELECT id, name, domain FROM websites WHERE id = ?').get(i.website_id) : null,
    settings: getSettings(),
  });
});
api.post('/invoices', auth, perm('finance_edit'), (req, res) => {
  const d = clean(req.body, INV_SPEC);
  d.issue_date ||= today();
  d.due_date ||= addPeriod(d.issue_date, 'weekly');
  d.status ||= 'draft';
  linkClientFromSite(d);
  const r = createInvoice(req.user, d, computeInvoice(req.body));
  audit(req, 'invoice_created', 'invoice', r.id, r.number);
  res.json(r);
});
api.put('/invoices/:id', auth, perm('finance_edit'), (req, res) => {
  const i = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!i) throw new HttpError(404, 'Invoice not found');
  const d = clean(req.body, INV_SPEC);
  linkClientFromSite(d);
  if ('issue_date' in d && !d.issue_date) d.issue_date = i.issue_date;
  if ('status' in d && !d.status) d.status = i.status;
  update('invoices', i.id, { ...d, ...('items' in req.body ? computeInvoice(req.body) : {}) });
  audit(req, 'invoice_updated', 'invoice', i.id, i.number);
  res.json({ ok: true });
});
api.post('/invoices/:id/send', auth, perm('finance_edit'), (req, res) => {
  const i = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!i) throw new HttpError(404, 'Invoice not found');
  update('invoices', i.id, { status: 'sent' });
  if (!db.prepare("SELECT 1 FROM followups WHERE invoice_id = ? AND status = 'pending'").get(i.id))
    insert('followups', { subject: `Payment follow-up: ${i.number}`, client_id: i.client_id, website_id: i.website_id, invoice_id: i.id, due_date: i.due_date || daysFromNow(7), channel: 'email', assigned_to: req.user.id });
  audit(req, 'invoice_sent', 'invoice', i.id, i.number);
  res.json({ ok: true });
});
api.post('/invoices/:id/pay', auth, perm('finance_edit'), (req, res) => {
  const i = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!i) throw new HttpError(404, 'Invoice not found');
  if (i.status === 'paid') throw bad('Invoice is already paid');
  const d = clean(req.body, { date: 'date', method: 'str' });
  const date = d.date || today();
  db.transaction(() => {
    update('invoices', i.id, { status: 'paid', paid_date: date });
    insert('payments', { type: 'income', amount: i.total, date, website_id: i.website_id, client_id: i.client_id, invoice_id: i.id, method: d.method, category: 'invoice', note: `Invoice ${i.number}`, created_by: req.user.id });
    db.prepare("UPDATE followups SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE invoice_id = ? AND status = 'pending'").run(i.id);
  })();
  audit(req, 'invoice_paid', 'invoice', i.id, `${i.number} ${i.total}`);
  res.json({ ok: true });
});
api.delete('/invoices/:id', auth, perm('finance_edit'), (req, res) => {
  const i = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!i) throw new HttpError(404, 'Invoice not found');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(i.id);
  audit(req, 'invoice_deleted', 'invoice', i.id, i.number);
  res.json({ ok: true });
});
// Create the next billing-cycle invoice from a website's plan and advance its next billing date.
api.post('/websites/:id/invoice', auth, perm('finance_edit'), (req, res) => {
  const w = getSite(req.user, req.params.id);
  if (!w.price && !w.setup_fee) throw bad('Set a price for this website first');
  const s = getSettings();
  const start = w.next_billing_date || today();
  const end = CYCLE_MONTHS[w.billing_cycle] ? addPeriod(start, w.billing_cycle) : null;
  const items = [];
  const cycleLabel = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' }[w.billing_cycle];
  if (req.body.include_setup && w.setup_fee) items.push({ description: `${w.name} — setup fee`, qty: 1, rate: w.setup_fee });
  const periodEnd = end && new Date(new Date(end + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
  if (w.price) items.push({ description: `${w.name}${w.domain ? ` (${w.domain})` : ''} — ${cycleLabel} plan${end ? ` (${start} to ${periodEnd})` : ''}`, qty: 1, rate: w.price });
  const issue = today();
  const r = db.transaction(() => {
    const out = createInvoice(req.user, { client_id: w.client_id, website_id: w.id, issue_date: issue, due_date: addPeriod(issue, 'weekly'), status: 'draft', notes: s.invoice_terms }, computeInvoice({ items, tax_rate: s.tax_rate }));
    if (end) update('websites', w.id, { next_billing_date: end });
    return out;
  })();
  audit(req, 'invoice_created', 'invoice', r.id, `${r.number} from plan`);
  res.json(r);
});

// ---------- payments / expenses ----------
api.get('/payments', auth, perm('finance_view'), (req, res) => {
  let sql = `SELECT p.*, c.name client_name, w.name website_name, i.number invoice_number FROM payments p
    LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN websites w ON w.id = p.website_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE 1=1`;
  const params = [];
  if (req.query.type) { sql += ' AND p.type = ?'; params.push(String(req.query.type)); }
  if (isDate(req.query.from)) { sql += ' AND p.date >= ?'; params.push(req.query.from); }
  if (isDate(req.query.to)) { sql += ' AND p.date <= ?'; params.push(req.query.to); }
  res.json(db.prepare(sql + ' ORDER BY p.date DESC, p.id DESC LIMIT 2000').all(...params));
});
api.post('/payments', auth, perm('finance_edit'), (req, res) => {
  const d = clean(req.body, { type: ['income', 'expense'], amount: 'num', date: 'date', website_id: 'id', client_id: 'id', method: 'str', category: 'str', note: 'text' });
  requireFields(d, ['amount']);
  d.type ||= 'income'; d.date ||= today();
  linkClientFromSite(d);
  const id = insert('payments', { ...d, created_by: req.user.id });
  audit(req, 'payment_recorded', 'payment', id, `${d.type} ${d.amount}`);
  res.json({ id });
});
api.delete('/payments/:id', auth, perm('finance_edit'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
    if (p.invoice_id) db.prepare("UPDATE invoices SET status = 'sent', paid_date = NULL WHERE id = ? AND status = 'paid'").run(p.invoice_id);
  })();
  audit(req, 'payment_deleted', 'payment', p.id, `${p.type} ${p.amount}`);
  res.json({ ok: true });
});

// ---------- follow-ups ----------
const FU_SPEC = { subject: 'str', client_id: 'id', website_id: 'id', invoice_id: 'id', due_date: 'date', channel: ['call', 'email', 'whatsapp', 'meeting', 'other'], status: ['pending', 'done'], assigned_to: 'id', notes: 'text' };
const canFollowups = perm('clients_manage', 'finance_edit');
api.get('/followups', auth, canFollowups, (req, res) => {
  let sql = `SELECT f.*, c.name client_name, w.name website_name, u.name assignee_name, i.number invoice_number FROM followups f
    LEFT JOIN clients c ON c.id = f.client_id LEFT JOIN websites w ON w.id = f.website_id LEFT JOIN users u ON u.id = f.assigned_to LEFT JOIN invoices i ON i.id = f.invoice_id`;
  const params = [];
  if (req.query.status) { sql += ' WHERE f.status = ?'; params.push(String(req.query.status)); }
  res.json(db.prepare(sql + " ORDER BY f.status = 'done', f.due_date IS NULL, f.due_date LIMIT 1000").all(...params));
});
api.post('/followups', auth, canFollowups, (req, res) => {
  const d = clean(req.body, FU_SPEC);
  requireFields(d, ['subject']);
  linkClientFromSite(d);
  d.status ||= 'pending'; d.assigned_to ||= req.user.id;
  res.json({ id: insert('followups', d) });
});
api.put('/followups/:id', auth, canFollowups, (req, res) => {
  const d = clean(req.body, FU_SPEC);
  if (d.status === 'done') d.completed_at = new Date().toISOString();
  if (d.status === 'pending') d.completed_at = null;
  update('followups', req.params.id, d);
  res.json({ ok: true });
});
api.delete('/followups/:id', auth, canFollowups, (req, res) => {
  db.prepare('DELETE FROM followups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- client onboarding ----------
api.get('/onboarding', auth, perm('clients_manage'), (req, res) => {
  const rows = db.prepare(`SELECT o.*, c.name client_name, w.name website_name FROM onboarding o
    LEFT JOIN clients c ON c.id = o.client_id LEFT JOIN websites w ON w.id = o.website_id ORDER BY o.id DESC`).all();
  res.json(rows.map((o) => ({ ...o, items: safeJson(o.items, []), submission: safeJson(o.submission, null) })));
});
api.post('/onboarding', auth, perm('clients_manage'), (req, res) => {
  const d = clean(req.body, { client_id: 'id', website_id: 'id', message: 'text', new_website_name: 'str', new_website_domain: 'str' });
  requireFields(d, ['client_id']);
  if (!db.prepare('SELECT 1 FROM clients WHERE id = ?').get(d.client_id)) throw bad('Client not found');
  const items = (Array.isArray(req.body.items) ? req.body.items : []).map((x) => String(x).slice(0, 100)).slice(0, 40);
  if (!items.length) throw bad('Select at least one item to request');
  const days = Math.min(Math.max(parseInt(req.body.expires_days, 10) || 14, 1), 90);
  const r = db.transaction(() => {
    let websiteId = d.website_id;
    if (!websiteId) {
      if (!d.new_website_name) throw bad('Choose a website or enter a new website name');
      websiteId = insert('websites', siteBody({ name: d.new_website_name, domain: d.new_website_domain, client_id: d.client_id, status: 'onboarding', onboard_date: today(), handler_id: req.user.id }));
    }
    db.prepare("UPDATE clients SET status = 'onboarding' WHERE id = ? AND status = 'lead'").run(d.client_id);
    const token = crypto.randomBytes(24).toString('base64url');
    const id = insert('onboarding', { token, client_id: d.client_id, website_id: websiteId, items: JSON.stringify(items), message: d.message, expires_at: daysFromNow(days), created_by: req.user.id });
    insert('followups', { subject: 'Onboarding: waiting for client access details', client_id: d.client_id, website_id: websiteId, due_date: daysFromNow(3), channel: 'whatsapp', assigned_to: req.user.id });
    return { id, token, website_id: websiteId };
  })();
  audit(req, 'onboarding_created', 'onboarding', r.id);
  res.json(r);
});
api.post('/onboarding/:id/complete', auth, perm('clients_manage'), (req, res) => {
  const o = db.prepare('SELECT * FROM onboarding WHERE id = ?').get(req.params.id);
  if (!o) throw new HttpError(404, 'Not found');
  db.transaction(() => {
    update('onboarding', o.id, { status: 'completed' });
    db.prepare("UPDATE websites SET status = 'active', onboard_date = COALESCE(onboard_date, ?) WHERE id = ? AND status = 'onboarding'").run(today(), o.website_id);
    db.prepare("UPDATE clients SET status = 'active' WHERE id = ? AND status IN ('lead','onboarding')").run(o.client_id);
    db.prepare("UPDATE followups SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE website_id = ? AND subject LIKE 'Onboarding:%' AND status = 'pending'").run(o.website_id);
  })();
  audit(req, 'onboarding_completed', 'onboarding', o.id);
  res.json({ ok: true });
});
api.delete('/onboarding/:id', auth, perm('clients_manage'), (req, res) => {
  db.prepare('DELETE FROM onboarding WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Public endpoints used by the client-facing onboarding form (no login, token-gated).
function getOpenOnboarding(token) {
  const o = db.prepare('SELECT * FROM onboarding WHERE token = ?').get(String(token || ''));
  if (!o || o.status === 'completed' || (o.expires_at && o.expires_at < today())) throw new HttpError(404, 'This onboarding link is invalid or has expired. Please contact us for a new one.');
  return o;
}
api.get('/public/onboard/:token', (req, res) => {
  if (limited('pub:' + req.ip, 60, 15 * 60000)) throw new HttpError(429, 'Too many requests');
  const o = getOpenOnboarding(req.params.token);
  const c = db.prepare('SELECT name, company, email, phone, billing_email, billing_address, tax_id FROM clients WHERE id = ?').get(o.client_id) || {};
  const w = db.prepare('SELECT name, domain FROM websites WHERE id = ?').get(o.website_id) || {};
  const s = getSettings();
  res.json({ company_name: s.company_name, company_email: s.company_email, client: c, website: w, message: o.message, items: safeJson(o.items, []), status: o.status });
});
api.post('/public/onboard/:token', (req, res) => {
  if (limited('pubpost:' + req.ip, 10, 15 * 60000)) throw new HttpError(429, 'Too many submissions. Please wait and try again.');
  const o = getOpenOnboarding(req.params.token);
  const access = (Array.isArray(req.body.access) ? req.body.access : []).slice(0, 40);
  const billing = clean(req.body.billing || {}, { company: 'str', phone: 'str', billing_email: 'str', billing_address: 'text', tax_id: 'str' });
  const comments = req.body.comments ? String(req.body.comments).slice(0, 5000) : null;
  let saved = 0;
  db.transaction(() => {
    for (const a of access) {
      const d = credBody({ category: CRED_CATS.includes(a.category) ? a.category : 'other', label: a.label, url: a.url, username: a.username, password: a.password, notes: a.notes });
      if (!d.label || (!d.username && !d.secret_enc && !d.url)) continue;
      insert('credentials', { ...d, website_id: o.website_id });
      saved++;
    }
    const b = Object.fromEntries(Object.entries(billing).filter(([, v]) => v));
    if (Object.keys(b).length) update('clients', o.client_id, b);
    update('onboarding', o.id, { status: 'submitted', submitted_at: new Date().toISOString(), submission: JSON.stringify({ billing: b, comments, credentials_saved: saved }) });
    insert('notes', { website_id: o.website_id, type: 'update', title: 'Client submitted onboarding details', body: `${saved} access item(s) saved to vault.${comments ? `\nClient comments: ${comments}` : ''}` });
    insert('followups', { subject: 'Review onboarding submission', client_id: o.client_id, website_id: o.website_id, due_date: today(), channel: 'other', assigned_to: o.created_by });
  })();
  audit(req, 'onboarding_submitted', 'onboarding', o.id, `${saved} credentials`);
  res.json({ ok: true, saved });
});

// ---------- dashboard ----------
api.get('/dashboard', auth, (req, res) => {
  const P = req.user.perms;
  const f = siteFilter(req.user);
  const t0 = today(), in7 = daysFromNow(7), in30 = daysFromNow(30);
  const sites = db.prepare(`SELECT w.*, u.name handler_name FROM websites w LEFT JOIN users u ON u.id = w.handler_id WHERE ${f.sql}`).all(...f.params);
  const live = sites.filter((s) => s.status === 'active' || s.status === 'onboarding');
  const counts = Object.fromEntries(SITE_STATUS.map((s) => [s, sites.filter((w) => w.status === s).length]));

  // last 12 months keys
  const months = [];
  const d = new Date();
  for (let k = 11; k >= 0; k--) months.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
  const growth = months.map((m) => ({ month: m, onboarded: sites.filter((s) => (s.onboard_date || '').startsWith(m)).length, exited: sites.filter((s) => (s.exit_date || '').startsWith(m)).length }));

  const out = { counts, total_sites: sites.length, growth };
  const v = taskVisibility(req.user);
  out.tasks = db.prepare(`SELECT t.*, w.name website_name, u.name assignee_name FROM tasks t LEFT JOIN websites w ON w.id = t.website_id LEFT JOIN users u ON u.id = t.assigned_to
    WHERE ${v.sql} AND t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY t.due_date LIMIT 25`).all(...v.params, in7);
  out.my_open_tasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to = ? AND status != 'done'").get(req.user.id).c;
  out.overdue_tasks = out.tasks.filter((t) => t.due_date < t0).length;
  out.recent_notes = db.prepare(`SELECT n.id, n.type, n.title, n.body, n.created_at, n.website_id, w.name website_name, u.name author_name FROM notes n
    JOIN websites w ON w.id = n.website_id LEFT JOIN users u ON u.id = n.author_id WHERE ${f.sql} AND n.type != 'task' ORDER BY n.created_at DESC, n.id DESC LIMIT 12`).all(...f.params);

  const byHandler = {};
  for (const s of live) {
    const k = s.handler_name || 'Unassigned';
    byHandler[k] ||= { name: k, sites: 0, mrr: 0 };
    byHandler[k].sites++;
    byHandler[k].mrr += monthlyValue(s.price, s.billing_cycle);
  }
  out.handlers = Object.values(byHandler).sort((a, b) => b.sites - a.sites);

  if (P.credentials_view) {
    out.renewals = db.prepare(`SELECT x.id, x.label, x.category, x.provider, x.renewal_date, x.renewal_cost, w.id website_id, w.name website_name FROM credentials x JOIN websites w ON w.id = x.website_id
      WHERE ${f.sql} AND x.renewal_date IS NOT NULL AND x.renewal_date <= ? AND w.status != 'exited' ORDER BY x.renewal_date LIMIT 20`).all(...f.params, in30);
  }
  if (P.finance_view) {
    const payFilter = P.all_websites ? { sql: '1=1', params: [] } : { sql: `p.website_id IN (SELECT w.id FROM websites w WHERE ${f.sql})`, params: f.params };
    const sum = (type, from, to) => db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments p WHERE ${payFilter.sql} AND p.type = ? AND p.date >= ? AND p.date < ?`).get(...payFilter.params, type, from, to).v;
    const ym = t0.slice(0, 7);
    const monthStart = ym + '-01';
    const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const lastMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const mrr = live.reduce((s, w) => s + monthlyValue(w.price, w.billing_cycle), 0);
    out.finance = {
      mrr: round2(mrr),
      arr: round2(mrr * 12),
      revenue_month: sum('income', monthStart, nextMonth),
      revenue_last_month: sum('income', lastMonth, monthStart),
      expense_month: sum('expense', monthStart, nextMonth),
      revenue_ytd: sum('income', t0.slice(0, 4) + '-01-01', nextMonth),
      revenue_all: sum('income', '0000-01-01', '9999-12-31'),
      outstanding: db.prepare("SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM invoices WHERE status = 'sent'").get(),
      overdue: db.prepare("SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM invoices WHERE status = 'sent' AND due_date < ?").get(t0),
    };
    out.monthly = months.map((m) => {
      const from = m + '-01';
      const [y, mo] = m.split('-').map(Number);
      const to = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
      return { month: m, income: sum('income', from, to), expense: sum('expense', from, to) };
    });
    out.top_sites = db.prepare(`SELECT w.id, w.name, COALESCE(SUM(p.amount),0) revenue FROM websites w JOIN payments p ON p.website_id = w.id AND p.type = 'income' AND p.date >= ?
      WHERE ${f.sql} GROUP BY w.id ORDER BY revenue DESC LIMIT 8`).all(months[0] + '-01', ...f.params);
    out.billing_due = live.filter((w) => w.billing_cycle !== 'one_time' && w.price > 0 && w.next_billing_date && w.next_billing_date <= in7)
      .map((w) => ({ id: w.id, name: w.name, price: w.price, billing_cycle: w.billing_cycle, next_billing_date: w.next_billing_date }))
      .sort((a, b) => a.next_billing_date.localeCompare(b.next_billing_date));
  }
  if (P.clients_manage || P.finance_edit) {
    out.followups = db.prepare(`SELECT f.*, c.name client_name, w.name website_name FROM followups f LEFT JOIN clients c ON c.id = f.client_id LEFT JOIN websites w ON w.id = f.website_id
      WHERE f.status = 'pending' AND (f.due_date IS NULL OR f.due_date <= ?) ORDER BY f.due_date LIMIT 15`).all(in7);
  }
  if (P.clients_manage) {
    out.onboarding_submitted = db.prepare("SELECT COUNT(*) c FROM onboarding WHERE status = 'submitted'").get().c;
    out.clients_active = db.prepare("SELECT COUNT(*) c FROM clients WHERE status = 'active'").get().c;
  }
  res.json(out);
});

// ---------- static & errors ----------
const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.get('/onboard/:token', (req, res) => res.sendFile(path.join(PUBLIC, 'onboard.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
    const msg = /UNIQUE.*email/.test(err.message) ? 'That email is already in use' : /FOREIGN KEY/.test(err.message) ? 'A linked record does not exist' : 'That value conflicts with an existing record';
    return res.status(409).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Agency Vault running at http://localhost:${PORT}`));
}
module.exports = app;
