const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  perms TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  billing_email TEXT,
  billing_address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS websites (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  domain TEXT,
  url TEXT,
  category TEXT,
  services TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  handler_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  onboard_date TEXT,
  exit_date TEXT,
  exit_reason TEXT,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  price REAL NOT NULL DEFAULT 0,
  setup_fee REAL NOT NULL DEFAULT 0,
  next_billing_date TEXT,
  social TEXT NOT NULL DEFAULT '{}',
  special_comments TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_members (
  website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (website_id, user_id)
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY,
  website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  label TEXT NOT NULL,
  provider TEXT,
  url TEXT,
  username TEXT,
  secret_enc TEXT,
  notes_enc TEXT,
  renewal_date TEXT,
  renewal_cost REAL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  website_id INTEGER REFERENCES websites(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL DEFAULT 'once',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'todo',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  last_completed_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  website_id INTEGER REFERENCES websites(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'comment',
  title TEXT,
  body TEXT,
  amount REAL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  website_id INTEGER REFERENCES websites(id) ON DELETE SET NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  paid_date TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'income',
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  website_id INTEGER REFERENCES websites(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  method TEXT,
  category TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  website_id INTEGER REFERENCES websites(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  due_date TEXT,
  channel TEXT DEFAULT 'call',
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS onboarding (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  website_id INTEGER REFERENCES websites(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  expires_at TEXT,
  submitted_at TEXT,
  submission TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cred_site ON credentials(website_id);
CREATE INDEX IF NOT EXISTS idx_task_site ON tasks(website_id);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_notes_site ON notes(website_id);
`);

// ---- v2: HR & payroll, freelance work, procurement, service catalog, multi-currency ----
db.exec(`
CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  employee_code TEXT,
  official_name TEXT NOT NULL,
  display_name TEXT,
  designation TEXT,
  department TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  email TEXT,
  phone TEXT,
  join_date TEXT,
  exit_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  currency TEXT,
  salary_structure TEXT NOT NULL DEFAULT '{"earnings":[],"deductions":[]}',
  bank_enc TEXT,
  id_docs_enc TEXT,
  address TEXT,
  emergency_contact TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_benefits (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  frequency TEXT,
  provider TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  working_days REAL,
  paid_days REAL,
  earnings TEXT NOT NULL DEFAULT '[]',
  deductions TEXT NOT NULL DEFAULT '[]',
  gross REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  paid_date TEXT,
  method TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS freelance_jobs (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  freelancer_name TEXT,
  website_id INTEGER REFERENCES websites(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'assigned',
  assigned_date TEXT,
  due_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS procurements (
  id INTEGER PRIMARY KEY,
  website_id INTEGER REFERENCES websites(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'other',
  item TEXT NOT NULL,
  vendor TEXT,
  vendor_account TEXT,
  purchase_date TEXT,
  expiry_date TEXT,
  billing_cycle TEXT NOT NULL DEFAULT 'yearly',
  cost REAL NOT NULL DEFAULT 0,
  cost_currency TEXT,
  price REAL NOT NULL DEFAULT 0,
  price_currency TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_catalog (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  currency TEXT,
  billing_cycle TEXT NOT NULL DEFAULT 'one_time',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proc_site ON procurements(website_id);
CREATE INDEX IF NOT EXISTS idx_proc_expiry ON procurements(expiry_date);
CREATE INDEX IF NOT EXISTS idx_slip_month ON payslips(month);
`);

function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('clients', 'currency', 'TEXT');
addColumn('websites', 'currency', 'TEXT');
addColumn('invoices', 'currency', 'TEXT');
addColumn('invoices', 'exchange_rate', 'REAL NOT NULL DEFAULT 1');
addColumn('payments', 'currency', 'TEXT');
addColumn('payments', 'exchange_rate', 'REAL NOT NULL DEFAULT 1');
addColumn('payments', 'amount_base', 'REAL');
addColumn('payments', 'source', 'TEXT');
addColumn('payments', 'source_id', 'INTEGER');
db.exec('UPDATE payments SET amount_base = amount * exchange_rate WHERE amount_base IS NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_pay_source ON payments(source, source_id)');

const DEFAULT_SETTINGS = {
  company_name: 'My Agency',
  company_email: '',
  company_phone: '',
  company_address: '',
  company_tax_id: '',
  currency: 'INR',
  tax_rate: '18',
  invoice_prefix: 'INV-',
  invoice_next: '1001',
  invoice_terms: 'Payment due within 7 days. Thank you for your business!',
  payment_details: '',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value ?? ''));
}

// Insert / update helpers. Column names always come from server-side whitelists, never from request keys.
function insert(table, obj) {
  const keys = Object.keys(obj);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return db.prepare(sql).run(...keys.map((k) => obj[k])).lastInsertRowid;
}
function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => obj[k]), id);
}

module.exports = { db, DATA_DIR, getSettings, setSetting, insert, update };
