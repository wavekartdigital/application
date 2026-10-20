// Employees, benefits, salary structures and monthly payslips.
// Each employee has an official (legal) name used on payslips and HR records, and an optional
// display name — the masked / working name shown to the rest of the team and to clients.
module.exports = function hr(api, ctx) {
  const { db, insert, update, getSettings, clean, requireFields, HttpError, bad, auth, perm, audit, safeJson, round2, encrypt, decrypt, baseCurrency, toBase, recordPayment, dashboardExtensions } = ctx;
  const HR = [auth, perm('hr_manage')];

  const EMP_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'freelancer'];
  const EMP_SPEC = {
    user_id: 'id', employee_code: 'str', official_name: 'str', display_name: 'str', designation: 'str', department: 'str',
    employment_type: EMP_TYPES, email: 'str', phone: 'str', join_date: 'date', exit_date: 'date', status: ['active', 'on_leave', 'exited'],
    currency: 'cur', address: 'text', emergency_contact: 'text', notes: 'text',
  };
  const BENEFIT_SPEC = { type: ['health_insurance', 'life_insurance', 'provident_fund', 'gratuity', 'bonus', 'allowance', 'leave', 'equipment', 'training', 'other'], title: 'str', amount: 'num', currency: 'cur', frequency: ['one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly'], provider: 'str', start_date: 'date', end_date: 'date', notes: 'text' };

  const lines = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 30)
    .map((l) => ({ name: String(l?.name || '').trim().slice(0, 100), amount: round2(Number(l?.amount) || 0) }))
    .filter((l) => l.name || l.amount);
  const sumLines = (arr) => round2(arr.reduce((s, l) => s + l.amount, 0));
  function structure(e) {
    const s = safeJson(e.salary_structure, {});
    const earnings = lines(s.earnings), deductions = lines(s.deductions);
    return { earnings, deductions, gross: sumLines(earnings), net: round2(sumLines(earnings) - sumLines(deductions)) };
  }
  const publicName = (e) => e.display_name || e.official_name;
  function employeeOut(e) {
    const { bank_enc, id_docs_enc, salary_structure, ...rest } = e;
    return { ...rest, salary_structure: structure(e), has_bank: !!bank_enc, has_id_docs: !!id_docs_enc };
  }
  function empBody(body) {
    const d = clean(body, EMP_SPEC);
    if (body.salary_structure && typeof body.salary_structure === 'object')
      d.salary_structure = JSON.stringify({ earnings: lines(body.salary_structure.earnings), deductions: lines(body.salary_structure.deductions) });
    // Sensitive fields are write-only: an empty value keeps what is stored.
    if (body.bank_details) d.bank_enc = encrypt(String(body.bank_details).slice(0, 5000));
    if (body.id_docs) d.id_docs_enc = encrypt(String(body.id_docs).slice(0, 5000));
    if ('employment_type' in d && !d.employment_type) d.employment_type = 'full_time';
    if ('status' in d && !d.status) d.status = 'active';
    return d;
  }
  function getEmp(id) {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!e) throw new HttpError(404, 'Employee not found');
    return e;
  }

  // Masked directory: anyone signed in can see display names (never official names unless HR).
  api.get('/employees/directory', auth, (req, res) => {
    const rows = db.prepare("SELECT id, official_name, display_name, designation, department, employment_type FROM employees WHERE status != 'exited' ORDER BY COALESCE(display_name, official_name)").all();
    const hrUser = req.user.perms.hr_manage;
    res.json(rows.map((e) => ({ id: e.id, name: publicName(e), official_name: hrUser ? e.official_name : undefined, designation: e.designation, department: e.department, employment_type: e.employment_type })));
  });

  api.get('/employees', ...HR, (req, res) => {
    const rows = db.prepare(`SELECT e.*, u.name user_name,
        (SELECT COUNT(*) FROM employee_benefits b WHERE b.employee_id = e.id) benefits,
        (SELECT MAX(month) FROM payslips s WHERE s.employee_id = e.id) last_payslip
      FROM employees e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.status = 'exited', e.official_name COLLATE NOCASE`).all();
    res.json(rows.map(employeeOut));
  });
  api.get('/employees/:id', ...HR, (req, res) => {
    const e = getEmp(req.params.id);
    res.json({
      employee: employeeOut(e),
      user: e.user_id ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(e.user_id) : null,
      benefits: db.prepare('SELECT * FROM employee_benefits WHERE employee_id = ? ORDER BY start_date DESC, id DESC').all(e.id),
      payslips: db.prepare('SELECT id, month, gross, total_deductions, net, currency, status, paid_date FROM payslips WHERE employee_id = ? ORDER BY month DESC').all(e.id),
      freelance: db.prepare(`SELECT j.*, w.name website_name, (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.source = 'freelance' AND p.source_id = j.id) paid
        FROM freelance_jobs j LEFT JOIN websites w ON w.id = j.website_id WHERE j.employee_id = ? ORDER BY j.id DESC`).all(e.id),
    });
  });
  api.post('/employees', ...HR, (req, res) => {
    const d = empBody(req.body);
    requireFields(d, ['official_name']);
    d.currency ||= baseCurrency();
    const id = insert('employees', d);
    audit(req, 'employee_created', 'employee', id, d.official_name);
    res.json({ id });
  });
  api.put('/employees/:id', ...HR, (req, res) => {
    const e = getEmp(req.params.id);
    const d = empBody(req.body);
    if ('official_name' in d) requireFields(d, ['official_name']);
    if (req.body.clear_bank) d.bank_enc = null;
    if (req.body.clear_id_docs) d.id_docs_enc = null;
    if (d.status === 'exited' && !d.exit_date && !e.exit_date) d.exit_date = ctx.today();
    update('employees', e.id, { ...d, updated_at: new Date().toISOString() });
    audit(req, 'employee_updated', 'employee', e.id);
    res.json({ ok: true });
  });
  api.delete('/employees/:id', ...HR, (req, res) => {
    const e = getEmp(req.params.id);
    db.prepare('DELETE FROM employees WHERE id = ?').run(e.id);
    audit(req, 'employee_deleted', 'employee', e.id, e.official_name);
    res.json({ ok: true });
  });
  api.post('/employees/:id/reveal', ...HR, (req, res) => {
    const e = getEmp(req.params.id);
    audit(req, 'employee_sensitive_revealed', 'employee', e.id);
    res.json({ bank_details: decrypt(e.bank_enc), id_docs: decrypt(e.id_docs_enc) });
  });

  // ---- benefits ----
  api.post('/employees/:id/benefits', ...HR, (req, res) => {
    const e = getEmp(req.params.id);
    const d = clean(req.body, BENEFIT_SPEC);
    requireFields(d, ['title']);
    d.type ||= 'other';
    d.currency ||= e.currency || baseCurrency();
    res.json({ id: insert('employee_benefits', { ...d, employee_id: e.id }) });
  });
  api.put('/benefits/:id', ...HR, (req, res) => {
    const d = clean(req.body, BENEFIT_SPEC);
    if ('title' in d) requireFields(d, ['title']);
    update('employee_benefits', req.params.id, d);
    res.json({ ok: true });
  });
  api.delete('/benefits/:id', ...HR, (req, res) => {
    db.prepare('DELETE FROM employee_benefits WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- payslips ----
  const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  const daysIn = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
  function slipValues(earnings, deductions) {
    const gross = sumLines(earnings), total_deductions = sumLines(deductions);
    return { earnings: JSON.stringify(earnings), deductions: JSON.stringify(deductions), gross, total_deductions, net: round2(gross - total_deductions) };
  }
  // Earnings are pro-rated by paid days / working days; deductions are kept as set in the structure.
  function fromStructure(e, working, paid) {
    const s = structure(e);
    const ratio = working > 0 ? Math.min(Math.max(paid / working, 0), 1) : 1;
    return slipValues(s.earnings.map((l) => ({ name: l.name, amount: round2(l.amount * ratio) })), s.deductions);
  }
  function slipOut(s) { return { ...s, earnings: safeJson(s.earnings, []), deductions: safeJson(s.deductions, []) }; }
  function getSlip(id) {
    const s = db.prepare('SELECT * FROM payslips WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'Payslip not found');
    return s;
  }

  api.get('/payslips', ...HR, (req, res) => {
    let sql = `SELECT s.*, e.official_name, e.display_name, e.employee_code, e.designation FROM payslips s JOIN employees e ON e.id = s.employee_id`;
    const params = [];
    if (isMonth(req.query.month)) { sql += ' WHERE s.month = ?'; params.push(req.query.month); }
    res.json(db.prepare(sql + ' ORDER BY s.month DESC, e.official_name COLLATE NOCASE LIMIT 2000').all(...params).map(slipOut));
  });
  api.get('/payslips/:id', ...HR, (req, res) => {
    const s = getSlip(req.params.id);
    const e = getEmp(s.employee_id);
    res.json({ payslip: slipOut(s), employee: employeeOut(e), settings: getSettings() });
  });
  api.post('/payslips/generate', ...HR, (req, res) => {
    const month = req.body.month;
    if (!isMonth(month)) throw bad('Choose a month');
    const working = Number(req.body.working_days) || daysIn(month);
    const emps = db.prepare("SELECT * FROM employees WHERE status != 'exited' AND employment_type != 'freelancer'").all();
    const exists = db.prepare('SELECT 1 FROM payslips WHERE employee_id = ? AND month = ?');
    let created = 0, skipped = 0;
    db.transaction(() => {
      for (const e of emps) {
        if (exists.get(e.id, month) || structure(e).gross <= 0) { skipped++; continue; }
        insert('payslips', { employee_id: e.id, month, working_days: working, paid_days: working, currency: e.currency || baseCurrency(), created_by: req.user.id, ...fromStructure(e, working, working) });
        created++;
      }
    })();
    audit(req, 'payslips_generated', 'payslip', null, `${month}: ${created} created`);
    res.json({ created, skipped });
  });
  api.post('/payslips', ...HR, (req, res) => {
    const e = getEmp(req.body.employee_id);
    const month = req.body.month;
    if (!isMonth(month)) throw bad('Choose a month');
    const working = Number(req.body.working_days) || daysIn(month);
    const paid = req.body.paid_days === undefined || req.body.paid_days === '' ? working : Number(req.body.paid_days);
    const values = Array.isArray(req.body.earnings) ? slipValues(lines(req.body.earnings), lines(req.body.deductions)) : fromStructure(e, working, paid);
    const id = insert('payslips', { employee_id: e.id, month, working_days: working, paid_days: paid, currency: e.currency || baseCurrency(), notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null, created_by: req.user.id, ...values });
    audit(req, 'payslip_created', 'payslip', id, `${e.official_name} ${month}`);
    res.json({ id });
  });
  api.put('/payslips/:id', ...HR, (req, res) => {
    const s = getSlip(req.params.id);
    if (s.status === 'paid') throw bad('This payslip is already paid. Delete the salary payment first to edit it.');
    const d = {};
    if ('working_days' in req.body) d.working_days = Number(req.body.working_days) || s.working_days;
    if ('paid_days' in req.body) d.paid_days = Number(req.body.paid_days);
    if ('notes' in req.body) d.notes = req.body.notes ? String(req.body.notes).slice(0, 2000) : null;
    if (Array.isArray(req.body.earnings)) Object.assign(d, slipValues(lines(req.body.earnings), lines(req.body.deductions)));
    else if (req.body.recalculate) Object.assign(d, fromStructure(getEmp(s.employee_id), d.working_days ?? s.working_days, d.paid_days ?? s.paid_days));
    update('payslips', s.id, d);
    res.json({ ok: true });
  });
  api.post('/payslips/:id/pay', ...HR, (req, res) => {
    const s = getSlip(req.params.id);
    if (s.status === 'paid') throw bad('Already paid');
    const e = getEmp(s.employee_id);
    const d = clean(req.body, { date: 'date', method: 'str' });
    const date = d.date || ctx.today();
    db.transaction(() => {
      update('payslips', s.id, { status: 'paid', paid_date: date, method: d.method });
      if (s.net > 0) recordPayment({ type: 'expense', amount: s.net, currency: s.currency || baseCurrency(), date, method: d.method, category: 'Salary', note: `Salary ${s.month} — ${e.official_name}`, source: 'payslip', source_id: s.id, created_by: req.user.id });
    })();
    audit(req, 'payslip_paid', 'payslip', s.id, `${e.official_name} ${s.month} ${s.net}`);
    res.json({ ok: true });
  });
  api.delete('/payslips/:id', ...HR, (req, res) => {
    const s = getSlip(req.params.id);
    db.transaction(() => {
      db.prepare("DELETE FROM payments WHERE source = 'payslip' AND source_id = ?").run(s.id);
      db.prepare('DELETE FROM payslips WHERE id = ?').run(s.id);
    })();
    audit(req, 'payslip_deleted', 'payslip', s.id, s.month);
    res.json({ ok: true });
  });

  dashboardExtensions.push((user, { t0 }) => {
    if (!user.perms.hr_manage) return {};
    const month = t0.slice(0, 7);
    const emps = db.prepare("SELECT * FROM employees WHERE status != 'exited'").all();
    const staff = emps.filter((e) => e.employment_type !== 'freelancer');
    const paidIds = new Set(db.prepare("SELECT employee_id FROM payslips WHERE month = ? AND status = 'paid'").all(month).map((r) => r.employee_id));
    return {
      hr: {
        headcount: staff.length,
        freelancers: emps.length - staff.length,
        on_leave: emps.filter((e) => e.status === 'on_leave').length,
        payroll_monthly: round2(staff.reduce((s, e) => s + toBase(structure(e).gross, e.currency), 0)),
        payroll_paid_month: db.prepare("SELECT COALESCE(SUM(amount_base),0) v FROM payments WHERE source = 'payslip' AND substr(date, 1, 7) = ?").get(month).v,
        slips_pending: staff.filter((e) => structure(e).gross > 0 && !paidIds.has(e.id)).length,
        month,
      },
    };
  });
};
