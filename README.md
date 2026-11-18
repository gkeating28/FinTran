# Qula Plus

Qula Plus is the shell for defining and managing financial transactions separately for each organisation. The repository and the hosted Supabase project keep the name FinTran.

A tenant owns organisations. People sign in and are granted access to particular organisations inside that tenant. It records purchase and sales invoices, credit notes, orders and requisitions, applies receipts and payments to them, produces and checks EN 16931 e-invoices, and has an assistant, Ask Qula, that answers questions about the data. Start with `docs/QULA_PLUS_REFERENCE.md`, which says what each part does and how far it has got.

The screen layout follows the Trax QA metrics shell: a dark sidebar, a title bar, and a light work area. It uses Next.js, React, and TypeScript, and styles everything with CSS modules on one set of design tokens in `src/app/globals.css`. There is no Tailwind and no component library. See "UI principles" in `TECHNICAL.md`.

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

The schema is in `supabase/migrations` and is applied to the FinTran Supabase project. The first file is a baseline of the live project, and the files it replaced are in `supabase/migrations_archive`. Tables:

- `tenants`
- `organisations` — each belongs to one tenant
- `profiles` — one row per signed-in user
- `organisation_access` — which organisations a user can open, and whether they are an owner, admin, or member
- `gl_codes` — a code, description, and account type for one organisation. Account type is one of Fixed Asset, Current Liability, Current Asset, Income, or Expense. A code is unique inside that organisation.
- `departments` and `cost_centres` — a code and description for one organisation. A code is unique inside that organisation.
- `vat_rates` — a code, description, percentage rate, and type for one organisation. Type is Sales or Expense. A code is unique inside that organisation.
- `currencies` — a code, name, and exchange rate for one organisation. A code is unique inside that organisation.
- `transaction_types` — a code, description, type (Sales or Purchases), document kind (invoice, credit note, order, requisition, payment or receipt), a last reference number, and five optional flex labels for one organisation. Each type starts at 0, so its next number is 1. A blank flex label is hidden on the transaction. A code is unique inside that organisation.
- `transaction_headers` and `transaction_lines` — purchase documents. The header stores the Purchases transaction type, the next reference for that type, dates, supplier, currency, exchange rate, order number, the invoice a credit note applies to, foreign and home totals, paid amount, and five flex fields. Each line stores a product, description, unit, GL code, department, cost centre, Expense VAT code, quantity, price, discount, nett, and VAT. Home amounts are the foreign amounts divided by the exchange rate.
- `products` — a code of up to 30 letters or numbers, a description, a unit, a purchase price with an Expense GL code and an Expense VAT code, and a sales price with an Income GL code and a Sales VAT code. A code is unique inside that organisation.
- `customers` and `suppliers` — a code, name, currency, phone, email, website, address, contact details, and a free-text note for one organisation. The currency is one of that organisation's currencies. A code is unique inside that organisation.
- `organisation_defaults` — one row per organisation. It stores the home currency, logo, address, contact name, email, website, phone, VAT number, company number, and banking details. The logo is a PNG, JPEG, WebP, or GIF up to 2 MB, kept in a private storage bucket. These are edited from that organisation.
- `transaction_forms` — one printable layout for each transaction type in an organisation. It chooses the page size (A4 by default), and the organisation, supplier or customer, header, and line details shown on the page.

This list is the first set of tables and is not complete. It leaves out payments, allocations, bank accounts, e-documents and the Ask Qula tables. `CORE.md` describes every table.

Row level security is enabled. Creating tenants, organisations, and access grants goes through database functions that check the caller's role.

## Documentation

| Document | Read it for |
| --- | --- |
| `docs/QULA_PLUS_REFERENCE.md` | What the app does, how far each part has got, and where to go next |
| `CORE.md` | The rules: tables, columns, constraints and what each screen does |
| `TECHNICAL.md` | How it is built: screens, routes, server actions, database functions, tests, environment |
| `specs/QULAPLUS_PAYMENTS_SPEC.md` | The payments design and its acceptance boxes |
| `docs/payments-test-script.md` | The manual run for payments |
