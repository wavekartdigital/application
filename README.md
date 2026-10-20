# Agency Vault

A small, self-hosted admin app for agencies that manage many client websites. It keeps every website's logins, pricing, revenue, tasks, team and client details in one place.

## Features

**Websites (one page per website)**
- Domain, URL, client, who handles it, onboard date, exit date and reason, services, special comments, social links
- Pricing: one-time, monthly, quarterly, half-yearly or yearly plan, setup fee, next billing date, monthly value (MRR), total revenue
- **Password vault** grouped by type: email, hosting, server, domain, CMS, FTP, database, social, analytics, payment, API and other. Passwords and secure notes are encrypted with AES-256-GCM, and every reveal is recorded in the activity log. Renewal dates and costs show up on the dashboard.
- **Tasks** that repeat daily, weekly, monthly, quarterly, half-yearly or yearly. When you mark one done, the next one is scheduled automatically.
- **Timeline**: comments, commercials/deals (with value), new approaches/ideas, meetings, issues, updates
- Billing: invoices, payments and expenses, profit per website

**Owner dashboard**: MRR/ARR, revenue this month/year, expenses, outstanding and overdue invoices, a revenue vs expenses chart, a website growth chart (onboarded vs exited), billing due, renewals, tasks due, follow-ups, latest deals and ideas, team workload and top websites by revenue.

**Clients & onboarding**
- Client records with billing details, websites, invoices, payments and follow-ups
- **Onboarding links**: send a client a secure link (copy it or share it on WhatsApp) where they fill in hosting, domain, email, CMS and social access plus billing details. Their logins go straight into the encrypted vault and a review follow-up is created for you.

**Finance**: invoices with line items, tax and discount, auto numbering, print or save as PDF, "Generate invoice from plan" (moves the next billing date forward), mark as sent (creates a payment follow-up), mark as paid (records the payment), plus income and expense tracking.

**Team & roles**
- Roles: Owner, Admin, Manager, Team member, Viewer, each with permission toggles you can adjust per person (see all websites, edit websites, view and edit passwords, view and edit finance, manage clients, manage tasks, manage team)
- Members only see the websites they're assigned to (or handle)
- Admin actions: add a member (gets a temporary password), edit role and permissions, reset password, disable, delete
- Self-service (My account): change password, change email, edit profile, delete account. "Forgot password" flags the request for admins.
- Activity log: sign-ins, failed logins, password reveals, changes and deletions

## Run it

Requires Node.js 20+ (LTS recommended: https://nodejs.org).

```bash
npm install
npm start
```

Open http://localhost:3000. On the first visit you create the owner account.

```bash
npm test   # end-to-end smoke test on a throwaway database
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where `app.db` and `vault.key` live |
| `VAULT_KEY` | auto-generated in `DATA_DIR/vault.key` | 64-hex-char encryption key for stored passwords |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Set `true` behind Nginx or another reverse proxy |

## Security notes

- **Back up `data/vault.key` (or your `VAULT_KEY`) separately from the database.** Without it, stored passwords can't be decrypted. Anyone who has both the database and the key can read every password.
- In production, put the app behind HTTPS (for example Nginx + Let's Encrypt) and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- Back up the `data/` folder regularly.
- Password reset links are printed to the server log (no mail server is configured). The simplest path is for an admin to use **Team â†’ Reset password**.

## Tech

Node.js, Express, SQLite (better-sqlite3), and plain HTML, CSS and JS with no build step.
