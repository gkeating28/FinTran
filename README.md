# FinTran

FinTran is the shell for defining and managing financial transactions separately for each organisation.

A tenant owns organisations. People sign in and are granted access to particular organisations inside that tenant. Transaction definitions themselves come later; this version holds the account structure and the place those definitions will live.

The screen layout follows the Trax QA metrics shell: a dark sidebar, a title bar, and a light work area. It uses Next.js, React, TypeScript, and Tailwind CSS, with CSS modules for the shell.

## Run locally

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with the FinTran Supabase project URL and publishable key, then:

```bash
npm run dev -- --port 43123
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

Create an account, then create a tenant and its first organisation. Owners and admins can add further organisations in that tenant and grant access to people who already have an account.

## Database

The schema is in `supabase/migrations` and is applied to the FinTran Supabase project. Tables:

- `tenants`
- `organisations` — each belongs to one tenant
- `profiles` — one row per signed-in user
- `organisation_access` — which organisations a user can open, and whether they are an owner, admin, or member
- `gl_codes` — a code, description, and account type for one organisation. Account type is one of Fixed Asset, Current Liability, Current Asset, Income, or Expense. A code is unique inside that organisation.
- `departments` and `cost_centres` — a code and description for one organisation. A code is unique inside that organisation.
- `vat_rates` — a code, description, percentage rate, and type for one organisation. Type is Sales or Expense. A code is unique inside that organisation.
- `currencies` — a code, name, and exchange rate for one organisation. A code is unique inside that organisation.
- `customers` and `suppliers` — a code, name, currency, phone, email, website, address, contact details, and a free-text note for one organisation. The currency is one of that organisation's currencies. A code is unique inside that organisation.
- `organisation_defaults` — one row per organisation. Home currency is edited from that organisation. Further defaults belong on the same form.

Row level security is enabled. Creating tenants, organisations, and access grants goes through database functions that check the caller's role.
