// Freelance jobs (work + payouts), procurement of domains / SSL / hosting / other services, and a services catalog.
module.exports = function ops(api, ctx) {
  const { db, insert, update, getSettings, clean, requireFields, HttpError, bad, auth, perm, audit, getSite, siteFilter, today, addPeriod, daysFromNow, round2, CYCLES, CYCLE_MONTHS,
    baseCurrency, rateOf, toBase, recordPayment, createInvoice, computeInvoice, billingCurrency, dashboardExtensions } = ctx;

  // ---------------- freelance work ----------------
  const FL = [auth, perm('hr_manage', 'finance_edit')];
  const FL_STATUS = ['assigned', 'in_progress', 'submitted', 'approved', 'paid', 'cancelled'];
  const FL_SPEC = { employee_id: 'id', freelancer_name: 'str', website_id: 'id', title: 'str', description: 'text', status: FL_STATUS, assigned_date: 'date', due_date: 'date', amount: 'num', currency: 'cur' };
  const paidSql = "(SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.source = 'freelance' AND p.source_id = j.id)";
  function getJob(id) {
    const j = db.prepare(`SELECT j.*, ${paidSql} paid FROM freelance_jobs j WHERE j.id = ?`).get(id);
    if (!j) throw new HttpError(404, 'Freelance job not found');
    return j;
  }
  function jobBody(body) {
    const d = clean(body, FL_SPEC);
    if ('amount' in d && d.amount === null) d.amount = 0;
    if ('status' in d && !d.status) d.status = 'assigned';
    if (d.employee_id && !db.prepare('SELECT 1 FROM employees WHERE id = ?').get(d.employee_id)) throw bad('Freelancer not found');
    return d;
  }

  api.get('/freelance', ...FL, (req, res) => {
    let sql = `SELECT j.*, ${paidSql} paid, COALESCE(e.display_name, e.official_name, j.freelancer_name) freelancer, w.name website_name
      FROM freelance_jobs j LEFT JOIN employees e ON e.id = j.employee_id LEFT JOIN websites w ON w.id = j.website_id WHERE 1=1`;
    const params = [];
    if (req.query.status === 'open') sql += " AND j.status NOT IN ('paid', 'cancelled')";
    else if (req.query.status) { sql += ' AND j.status = ?'; params.push(String(req.query.status)); }
    if (req.query.employee_id) { sql += ' AND j.employee_id = ?'; params.push(Number(req.query.employee_id)); }
    if (req.query.website_id) { sql += ' AND j.website_id = ?'; params.push(Number(req.query.website_id)); }
    const rows = db.prepare(sql + ' ORDER BY j.status IN (\'paid\', \'cancelled\'), j.due_date IS NULL, j.due_date, j.id DESC LIMIT 2000').all(...params);
    res.json(rows.map((j) => ({ ...j, balance: round2(Math.max(0, j.amount - j.paid)) })));
  });
  api.get('/freelance/:id/payments', ...FL, (req, res) => {
    res.json(db.prepare("SELECT id, amount, currency, date, method, note FROM payments WHERE source = 'freelance' AND source_id = ? ORDER BY date DESC").all(req.params.id));
  });
  api.post('/freelance', ...FL, (req, res) => {
    const d = jobBody(req.body);
    requireFields(d, ['title']);
    if (!d.employee_id && !d.freelancer_name) throw bad('Choose a freelancer or type their name');
    d.currency ||= (d.employee_id && db.prepare('SELECT currency FROM employees WHERE id = ?').get(d.employee_id)?.currency) || baseCurrency();
    d.assigned_date ||= today();
    d.status ||= 'assigned';
    const id = insert('freelance_jobs', { ...d, created_by: req.user.id });
    audit(req, 'freelance_job_created', 'freelance', id, `${d.title} ${d.amount || 0} ${d.currency}`);
    res.json({ id });
  });
  api.put('/freelance/:id', ...FL, (req, res) => {
    const j = getJob(req.params.id);
    const d = jobBody(req.body);
    if ('title' in d) requireFields(d, ['title']);
    update('freelance_jobs', j.id, d);
    res.json({ ok: true });
  });
  api.post('/freelance/:id/pay', auth, perm('finance_edit'), (req, res) => {
    const j = getJob(req.params.id);
    const d = clean(req.body, { amount: 'num', date: 'date', method: 'str', note: 'str' });
    const amount = d.amount ?? round2(j.amount - j.paid);
    if (!(amount > 0)) throw bad('Enter an amount to pay');
    const who = j.employee_id ? db.prepare('SELECT COALESCE(display_name, official_name) n FROM employees WHERE id = ?').get(j.employee_id)?.n : j.freelancer_name;
    db.transaction(() => {
      recordPayment({ type: 'expense', amount, currency: j.currency || baseCurrency(), date: d.date || today(), website_id: j.website_id, method: d.method, category: 'Freelancer', note: d.note || `${j.title} — ${who || 'freelancer'}`, source: 'freelance', source_id: j.id, created_by: req.user.id });
      if (round2(j.paid + amount) >= j.amount && j.amount > 0) update('freelance_jobs', j.id, { status: 'paid' });
    })();
    audit(req, 'freelance_paid', 'freelance', j.id, `${amount} ${j.currency}`);
    res.json({ ok: true });
  });
  api.delete('/freelance/:id', ...FL, (req, res) => {
    const j = getJob(req.params.id);
    if (j.paid > 0 && !req.user.perms.finance_edit) throw new HttpError(403, 'This job has payments; only finance can delete it');
    db.transaction(() => {
      db.prepare("DELETE FROM payments WHERE source = 'freelance' AND source_id = ?").run(j.id);
      db.prepare('DELETE FROM freelance_jobs WHERE id = ?').run(j.id);
    })();
    audit(req, 'freelance_job_deleted', 'freelance', j.id, j.title);
    res.json({ ok: true });
  });

  // ---------------- procurement: domains, SSL, hosting & more ----------------
  const PROC_TYPES = { domain: 'Domain', ssl: 'SSL certificate', hosting: 'Hosting', email: 'Email / Workspace', server: 'Server / VPS', cdn: 'CDN / DNS', theme_plugin: 'Theme / plugin licence', software: 'Software / SaaS', backup: 'Backup / security', maintenance: 'Maintenance plan', other: 'Other' };
  const PROC_SPEC = {
    website_id: 'id', client_id: 'id', type: Object.keys(PROC_TYPES), item: 'str', vendor: 'str', vendor_account: 'str', purchase_date: 'date', expiry_date: 'date',
    billing_cycle: CYCLES, cost: 'num', cost_currency: 'cur', price: 'num', price_currency: 'cur', auto_renew: 'bool', status: ['pending', 'active', 'expired', 'cancelled', 'transferred'], notes: 'text',
  };
  const MONEY = ['cost', 'cost_currency', 'price', 'price_currency'];
  const procView = perm('websites_edit', 'finance_view');
  function procVisibility(user) {
    if (user.perms.all_websites) return { sql: '1=1', params: [] };
    const f = siteFilter(user);
    return { sql: `(p.website_id IS NOT NULL AND ${f.sql})`, params: f.params };
  }
  const annualFactor = (cycle) => (CYCLE_MONTHS[cycle] ? 12 / CYCLE_MONTHS[cycle] : 0);
  function procOut(user, p) {
    const o = { ...p, type_label: PROC_TYPES[p.type] || p.type, days_left: p.expiry_date ? Math.round((new Date(p.expiry_date) - new Date(today())) / 864e5) : null };
    if (!user.perms.finance_view) for (const k of MONEY) delete o[k];
    else o.margin_base = round2(toBase(p.price, p.price_currency) - toBase(p.cost, p.cost_currency));
    return o;
  }
  function getProc(user, id) {
    const v = procVisibility(user);
    const p = db.prepare(`SELECT p.* FROM procurements p LEFT JOIN websites w ON w.id = p.website_id WHERE p.id = ? AND ${v.sql}`).get(id, ...v.params);
    if (!p) throw new HttpError(404, 'Item not found');
    return p;
  }
  function procBody(user, body) {
    const d = clean(body, PROC_SPEC);
    if (!user.perms.finance_edit) for (const k of MONEY) delete d[k];
    for (const k of ['cost', 'price']) if (k in d && d[k] === null) d[k] = 0;
    if ('billing_cycle' in d && !d.billing_cycle) d.billing_cycle = 'yearly';
    if ('status' in d && !d.status) d.status = 'active';
    if (d.website_id) {
      getSite(user, d.website_id);
      if (!d.client_id) d.client_id = db.prepare('SELECT client_id FROM websites WHERE id = ?').get(d.website_id)?.client_id ?? null;
    } else if ('website_id' in d && !user.perms.all_websites) throw bad('Choose a website');
    return d;
  }
  function procInvoice(user, p, description) {
    const s = getSettings();
    const client_id = p.client_id || (p.website_id && db.prepare('SELECT client_id FROM websites WHERE id = ?').get(p.website_id)?.client_id) || null;
    const currency = p.price_currency || billingCurrency({ website_id: p.website_id, client_id });
    return createInvoice(user, { client_id, website_id: p.website_id, issue_date: today(), due_date: daysFromNow(7), status: 'draft', notes: s.invoice_terms, currency, exchange_rate: rateOf(currency) },
      computeInvoice({ items: [{ description, qty: 1, rate: p.price }], tax_rate: s.tax_rate }));
  }

  api.get('/procurements', auth, procView, (req, res) => {
    const v = procVisibility(req.user);
    let sql = `SELECT p.*, w.name website_name, c.name client_name FROM procurements p LEFT JOIN websites w ON w.id = p.website_id LEFT JOIN clients c ON c.id = p.client_id WHERE ${v.sql}`;
    const params = [...v.params];
    if (req.query.website_id) { sql += ' AND p.website_id = ?'; params.push(Number(req.query.website_id)); }
    if (req.query.type) { sql += ' AND p.type = ?'; params.push(String(req.query.type)); }
    if (req.query.status) { sql += ' AND p.status = ?'; params.push(String(req.query.status)); }
    if (req.query.expiring) { sql += " AND p.status IN ('active','pending') AND p.expiry_date IS NOT NULL AND p.expiry_date <= ?"; params.push(daysFromNow(Number(req.query.expiring) || 30)); }
    res.json({ types: PROC_TYPES, items: db.prepare(sql + ' ORDER BY p.expiry_date IS NULL, p.expiry_date, p.id DESC LIMIT 2000').all(...params).map((p) => procOut(req.user, p)) });
  });
  api.post('/procurements', auth, perm('websites_edit'), (req, res) => {
    const d = procBody(req.user, req.body);
    requireFields(d, ['item']);
    if (!d.website_id && !req.user.perms.all_websites) throw bad('Choose a website');
    d.type ||= 'other';
    d.purchase_date ||= today();
    if (!d.expiry_date && CYCLE_MONTHS[d.billing_cycle || 'yearly']) d.expiry_date = addPeriod(d.purchase_date, d.billing_cycle || 'yearly');
    d.cost_currency ||= baseCurrency();
    d.price_currency ||= billingCurrency({ website_id: d.website_id, client_id: d.client_id });
    const out = db.transaction(() => {
      const id = insert('procurements', { ...d, created_by: req.user.id });
      const p = db.prepare('SELECT * FROM procurements WHERE id = ?').get(id);
      if (req.body.record_expense && req.user.perms.finance_edit && p.cost > 0)
        recordPayment({ type: 'expense', amount: p.cost, currency: p.cost_currency, date: p.purchase_date, website_id: p.website_id, client_id: p.client_id, category: PROC_TYPES[p.type], note: `Purchase: ${p.item}${p.vendor ? ` (${p.vendor})` : ''}`, source: 'procurement', source_id: id, created_by: req.user.id });
      const inv = req.body.create_invoice && req.user.perms.finance_edit && p.price > 0 ? procInvoice(req.user, p, `${PROC_TYPES[p.type]} — ${p.item}${p.expiry_date ? ` (valid until ${p.expiry_date})` : ''}`) : null;
      return { id, invoice: inv };
    })();
    audit(req, 'procurement_created', 'procurement', out.id, `${d.type}: ${d.item}`);
    res.json(out);
  });
  api.put('/procurements/:id', auth, perm('websites_edit'), (req, res) => {
    const p = getProc(req.user, req.params.id);
    const d = procBody(req.user, req.body);
    if ('item' in d) requireFields(d, ['item']);
    update('procurements', p.id, { ...d, updated_at: new Date().toISOString() });
    audit(req, 'procurement_updated', 'procurement', p.id, p.item);
    res.json({ ok: true });
  });
  api.delete('/procurements/:id', auth, perm('websites_edit'), (req, res) => {
    const p = getProc(req.user, req.params.id);
    db.prepare('DELETE FROM procurements WHERE id = ?').run(p.id);
    audit(req, 'procurement_deleted', 'procurement', p.id, p.item);
    res.json({ ok: true });
  });
  // Renew: push the expiry forward one billing cycle, optionally record the vendor cost and bill the client.
  api.post('/procurements/:id/renew', auth, perm('websites_edit'), (req, res) => {
    const p = getProc(req.user, req.params.id);
    if (!CYCLE_MONTHS[p.billing_cycle]) throw bad('Set a renewal cycle (monthly, yearly…) on this item first');
    if ((req.body.record_expense || req.body.create_invoice) && !req.user.perms.finance_edit) throw new HttpError(403, 'Recording costs or invoicing needs finance access');
    const oldExpiry = p.expiry_date || today();
    const newExpiry = addPeriod(oldExpiry, p.billing_cycle);
    const out = db.transaction(() => {
      update('procurements', p.id, { expiry_date: newExpiry, status: 'active', updated_at: new Date().toISOString() });
      if (req.body.record_expense && p.cost > 0)
        recordPayment({ type: 'expense', amount: p.cost, currency: p.cost_currency || baseCurrency(), date: today(), website_id: p.website_id, client_id: p.client_id, category: PROC_TYPES[p.type], note: `Renewal: ${p.item}${p.vendor ? ` (${p.vendor})` : ''}`, source: 'procurement', source_id: p.id, created_by: req.user.id });
      const inv = req.body.create_invoice && p.price > 0 ? procInvoice(req.user, p, `${PROC_TYPES[p.type]} renewal — ${p.item} (${oldExpiry} to ${newExpiry})`) : null;
      return { expiry_date: newExpiry, invoice: inv };
    })();
    audit(req, 'procurement_renewed', 'procurement', p.id, `${p.item} → ${newExpiry}`);
    res.json(out);
  });
  api.post('/procurements/:id/invoice', auth, perm('finance_edit'), (req, res) => {
    const p = getProc(req.user, req.params.id);
    if (!(p.price > 0)) throw bad('Set a selling price first');
    res.json(procInvoice(req.user, p, `${PROC_TYPES[p.type]} — ${p.item}${p.expiry_date ? ` (valid until ${p.expiry_date})` : ''}`));
  });

  // ---------------- services catalog ----------------
  const CAT_SPEC = { name: 'str', category: ['domain', 'ssl', 'hosting', 'email', 'seo', 'design', 'development', 'maintenance', 'marketing', 'content', 'social_media', 'other'], description: 'text', price: 'num', cost: 'num', currency: 'cur', billing_cycle: CYCLES, active: 'bool' };
  api.get('/catalog', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM service_catalog ORDER BY active DESC, category, name COLLATE NOCASE').all();
    res.json(req.user.perms.finance_view ? rows : rows.map(({ cost, ...r }) => r));
  });
  const catBody = (body) => {
    const d = clean(body, CAT_SPEC);
    for (const k of ['price', 'cost']) if (k in d && d[k] === null) d[k] = 0;
    if ('billing_cycle' in d && !d.billing_cycle) d.billing_cycle = 'one_time';
    if ('category' in d && !d.category) d.category = 'other';
    return d;
  };
  api.post('/catalog', auth, perm('finance_edit'), (req, res) => {
    const d = catBody(req.body);
    requireFields(d, ['name']);
    d.currency ||= baseCurrency();
    res.json({ id: insert('service_catalog', d) });
  });
  api.put('/catalog/:id', auth, perm('finance_edit'), (req, res) => {
    const d = catBody(req.body);
    if ('name' in d) requireFields(d, ['name']);
    update('service_catalog', req.params.id, d);
    res.json({ ok: true });
  });
  api.delete('/catalog/:id', auth, perm('finance_edit'), (req, res) => {
    db.prepare('DELETE FROM service_catalog WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------------- dashboard ----------------
  dashboardExtensions.push((user, { t0, in30 }) => {
    const out = {};
    const P = user.perms;
    if (P.websites_edit || P.finance_view) {
      const v = procVisibility(user);
      const active = db.prepare(`SELECT p.* FROM procurements p LEFT JOIN websites w ON w.id = p.website_id WHERE ${v.sql} AND p.status IN ('active','pending')`).all(...v.params);
      out.procurement = {
        active: active.length,
        expiring: active.filter((p) => p.expiry_date && p.expiry_date <= in30).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)).slice(0, 15)
          .map((p) => procOut(user, { ...p, website_name: p.website_id ? db.prepare('SELECT name FROM websites WHERE id = ?').get(p.website_id)?.name : null })),
      };
      if (P.finance_view) {
        out.procurement.annual_cost = round2(active.reduce((s, p) => s + toBase(p.cost, p.cost_currency) * annualFactor(p.billing_cycle), 0));
        out.procurement.annual_margin = round2(active.reduce((s, p) => s + (toBase(p.price, p.price_currency) - toBase(p.cost, p.cost_currency)) * annualFactor(p.billing_cycle), 0));
      }
    }
    if (P.hr_manage || P.finance_edit) {
      const open = db.prepare(`SELECT j.*, ${paidSql} paid FROM freelance_jobs j WHERE j.status NOT IN ('paid','cancelled')`).all();
      out.freelance = {
        open_jobs: open.length,
        outstanding: round2(open.reduce((s, j) => s + toBase(Math.max(0, j.amount - j.paid), j.currency), 0)),
        paid_month: db.prepare("SELECT COALESCE(SUM(amount_base),0) v FROM payments WHERE source = 'freelance' AND substr(date, 1, 7) = ?").get(t0.slice(0, 7)).v,
        overdue: open.filter((j) => j.due_date && j.due_date < t0).length,
      };
    }
    return out;
  });
};
