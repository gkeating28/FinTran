# Qula Plus: functional reference

Written 18 November 2026 and revised the same day after a review against the original requirements. This is the one document that says what Qula Plus does, how far each part has got, and where it could go next. It is meant to be read start to finish once, and then used to find things.

It summarises. The detail lives in `CORE.md` (what the rules are), `TECHNICAL.md` (how the app is built) and `specs/QULAPLUS_PAYMENTS_SPEC.md` (the payments spec). Each section below says where to read more.

## How much to trust this document

On 18 November 2026 `CORE.md` and `TECHNICAL.md` were checked against the code and the migrations. The checks and what they found are in section 16. In short: every file path, database function and table the two documents name exists, and I fixed the eight places where they had drifted. I did not re-read every sentence of the 1,100 lines against the code, so a rule described in `CORE.md` is reliable but not proven. The name-level checks now run in CI (`npm run check:docs`), so they cannot drift unnoticed again.

Each area below carries one of these marks:

| Mark | Meaning |
| --- | --- |
| **Built, in CI** | The code exists and automated tests (SQL, unit or end to end) cover it and pass |
| **Built, in CI, not used by a person** | As above, but nobody has used it in a browser yet. This is every part of payments |
| **Partly built** | Some of it works and the rest is a stand-in or missing. Said in the text |
| **Not built** | Described as a possibility, nothing exists |

For everything except payments, I cannot say how much a person has used it. It was built in earlier sessions and the hosted project holds a small amount of real data.

## 1. What Qula Plus is

A multi-company accounts payable and receivable tool for businesses in Ireland and the EU. It records purchase and sales documents, applies payments to them, produces EN 16931 e-invoices (Peppol BIS Billing 3.0) and answers questions about the data through an assistant called Ask Qula.

It holds the rules in Postgres and not in the app. The app (Next.js, React, TypeScript) talks to Supabase as the signed-in person, with no service-role key, so row level security decides what anyone can see. The live database is the FinTran Supabase project. The product is called Qula Plus on screen. The repository, package and project keep the older name FinTran.

It does not keep a ledger. It does not move money. It does not yet send e-invoices over the Peppol network (section 9).

## 2. People, organisations and roles

**Built, in CI.** Read more: `CORE.md` "People, tenants, and organisations" and "Who can see a row".

- A **tenant** owns one or more **organisations** (companies). A person signs in once (email and password, Supabase Auth) and is granted access to particular organisations as an **owner**, **admin** or **member**. One person has one role per organisation.
- The organisation open on screen is chosen in the sidebar and kept in a cookie. A person who is not a member of it is moved to their first organisation.
- People are not created inside the app. Someone signs up, then an owner or admin grants them access by email. Granting needs the person to have an account already.
- Creating a tenant, an organisation or a grant goes through database functions that check the caller's role.

| Who | What they can do |
| --- | --- |
| **Member** | Read everything in the organisation. Create, edit and delete customers, suppliers and draft documents. Post documents. Record, post and delete payments, allocate them and remove allocations. Apply a credit note. Raise a credit note. Upload and import e-documents. Use Ask Qula |
| **Admin** | All of that, plus change setup (lists, forms, defaults, logo, lock date), void a payment or a posted purchase, reject an e-document, release a duplicate, download EN 16931 JSON, read the change history, set up Ask Qula and the Access Point, grant and remove members |
| **Owner** | All of that, plus grant owners and admins, create organisations and delete an organisation that has no documents. An organisation keeps at least one owner |

## 3. Where things are on screen

The shell is a navy sidebar, a navy title bar and a light work area. Ask Qula is the sparkle button at the right of the title bar, and its chat slides in from the right.

| Sidebar | Goes to |
| --- | --- |
| Home | The dashboard (section 11) |
| Transactions | One tile per transaction type, with draft, posted and void counts. Each opens that type's list |
| Customers, Suppliers | The party lists |
| E-documents | Received and sent e-invoices |
| Admin | The tiles below |

| Admin tile | What it is |
| --- | --- |
| GL codes, Departments, Cost centres, VAT rates, Currencies, Bank accounts, Products | Setup lists (section 5) |
| Transaction types | The kinds of document and payment, with their numbering |
| Forms | The printed layout of each type (section 10) |
| Organisations | The companies in the tenant, their defaults and logo, and the lock date |
| Access | Who can open the organisation, and as what |
| Change history | The audit log. Owners and admins |

Two more pages sit outside the tiles and are for owners and admins: **Ask Qula settings** (`/ask-qula`) and **Access Point** (`/access-point`). Members can see the Access Point status. A transaction's printed page is at `/print/{code}/{id}` and is outside the app shell.

## 4. Organisation setup

**Built, in CI.** Read more: `CORE.md` "Organisation defaults and currencies".

- **Defaults:** home currency (required, always at rate 1, cannot change once documents exist), structured postal address, contact details, VAT number, company number, Peppol scheme and ID (unique across all tenants), IBAN, BIC and bank account name, banking text for printed forms, and a logo (PNG, JPEG, WebP or GIF up to 2 MB in a private bucket).
- **Lock date:** documents dated on or before it cannot be created, edited, posted, voided or deleted. Orders and requisitions are exempt. Payments and allocations respect it.
- **Currencies:** each has a rate, how many units equal one unit of the home currency. A document stores its own rate (home amount = foreign amount ÷ rate).
- **Codes are fixed.** Every master code (GL code, department, cost centre, VAT rate, customer, supplier, product, currency, transaction type, bank account) is chosen when the row is created. After that the code is shown and cannot be changed, and Postgres rejects a change.
- **EN 16931 code lists** (countries, currencies, units, VAT categories, exemption reasons, payment means, electronic address schemes) are shared by every organisation, pinned to Peppol BIS Billing 3.0.21.

## 5. Setup lists, parties and transaction types

**Built, in CI.** Read more: `CORE.md` "Account structure" and "Transaction types".

| List | What matters |
| --- | --- |
| GL codes | Account type is Fixed Asset, Current Liability, Current Asset, Income or Expense. A product's purchase code must be Expense and its sales code Income |
| Departments, cost centres | Code and description. Optional on lines |
| VAT rates | Sales or Expense type, an EN 16931 category (`S`, `E`, `Z`, `AE`, `K`, `G`, `O`, `L`, `M`, `B`) with the zero-rate and exemption-reason rules the standard sets |
| Products | Purchase and sales prices with their GL and VAT codes and a unit. Choosing one on a line copies those |
| Bank accounts | The organisation's own accounts. IBAN checked and normalised, optional BIC, a currency, an optional Current Asset GL code, active flag and at most one default per currency |
| Customers, suppliers | Currency (the document takes it and it cannot be edited there), address, VAT and Peppol identifiers, payment terms in days (fills a sales draft's due date and terms), a default buyer reference for customers. A summary panel beside the form shows what they owe or are owed, money on account, and recent payments |
| Transaction types | A code, a description (the page title), a direction (Sales or Purchases), a kind, a number prefix and padding, and up to five optional "flex" labels that add custom fields to documents |

**Kinds of transaction type:** invoice, credit note, order, requisition, payment and receipt. The kind cannot change once something has been entered.

**Type codes** have three characters: `S` or `P` for the direction, then `RQ` requisition, `OR` order, `IN` invoice, `CN` credit note, `RC` receipt, `PY` payment or `RF` refund. The standard set is `PRQ`, `POR`, `PIN`, `PCN`, `SOR`, `SIN`, `SCN`, `SRC`, `PPY`, `SRF` and `PRF`. The app never reads a code to decide what a type is. Old links with the earlier codes are redirected.

## 6. Documents

**Built, in CI.** Read more: `CORE.md` "Purchase documents" and `TECHNICAL.md` "Transaction entry".

One entry screen serves every document, and the transaction type decides the direction. It has a status row, then Document, Notes and Payment terms tabs, with the header and totals on the left and the line grid on the right. A posted invoice or credit note has one more tab (section 8).

**Kinds and lifecycles**

| Document | Lifecycle |
| --- | --- |
| Invoice, credit note (purchase or sales) | Draft, posted, void |
| Order, requisition | Draft, active, closed, cancelled. A requisition is a purchase-only step before a purchase order |

**Numbering.** A purchase document is numbered when the draft is saved. A sales document, and any type set to number on posting, is numbered when posted, so deleting a sales draft uses no number. A failed post uses no number. A number is never reused.

**Posting.** Any member can post. It needs at least one line. For sales it also needs an Income GL code on every line, a date no later than tomorrow, and a passing readiness check (section 9). Posting copies the organisation and the party into the document, so later edits to either do not change it. A posted document cannot be edited except for what settles it.

**Voiding.** Owners and admins can void a posted **purchase** document, with a reason. A posted **sales** document cannot be voided: the correction is a credit note. A document with an effective allocation cannot be voided until its allocations are removed.

**Credit notes.** A credit note must name the invoice it applies to. A sales credit note raised from an invoice copies its lines. The credits posted against an invoice cannot exceed that invoice's total. Posting a credit note applies it to its invoice up to what is open on it. If the invoice is already paid, the credit note keeps its balance, which can be applied to another invoice or refunded.

**Save before acting.** A button that posts, activates, closes or creates another document saves any unsaved changes first and then acts, in one step. If the save fails the action does not run.

**Other rules.** The same supplier invoice number cannot be entered twice for a supplier unless the first is void. Line VAT must match the document's direction (Expense for purchases, Sales for sales). A line can carry a product, GL code, department, cost centre, unit, discount, note and flex fields. A document's VAT breakdown, nett, VAT and total are worked out by the database.

## 7. Orders and requisitions

**Built, in CI.** Read more: `TECHNICAL.md` "Orders and requisitions".

- A requisition becomes a purchase order, and an order becomes one or more invoices, with Create invoice and Create purchase order buttons. Each new line remembers the line it came from.
- An invoice can draw on several orders of one party ("Bring in from orders" lists each order's lines with tick boxes).
- Each order line shows **Invoiced**, **Reserved** (on draft invoices) and **Left**, so an order cannot be over-invoiced. The limit is by quantity.
- An order **closes by itself** when posted invoices cover every line, and reopens by itself if an invoice is voided or a credit note line marked Return to order gives quantity back. An order closed by hand stays closed.
- Orders and requisitions are not exported as e-invoices and are outside the period lock.

## 8. Payments, receipts, refunds and settlement

**Built, in CI, not used by a person.** This is the most recent work, built in November 2026. Read more: `CORE.md` "Payments and settlement" and the spec.

**The four kinds of money record**

| Type | Is | Applied to |
| --- | --- | --- |
| Customer receipt (`SRC`) | Money in from a customer | Sales invoices |
| Supplier payment (`PPY`) | Money out to a supplier | Purchase invoices |
| Customer refund (`SRF`) | Money out to a customer | Sales credit notes |
| Supplier refund (`PRF`) | Money in from a supplier | Purchase credit notes |

**Recording money.** Each is recorded on its own screen (Transactions, then the type). The screen has the header on the left (date, party, bank account, amount, currency, rate, payment means, bank reference, notes) and the party's open documents on the right, each with an Allocate box, plus Allocate oldest first and Clear. A double click on an open document allocates everything still open on it. With no amount entered it fills the amount in as well. Save and post makes it real. A draft holds planned allocations that only take effect on posting, when they are checked again.

**What an allocation does.** Allocations are the only thing that sets a document's paid amount and amount due. Nobody types a paid amount. An allocation never takes a document below zero, so any excess stays on account. A removed allocation is kept with who removed it and why. Any member can allocate and remove, owners and admins void a payment, and every change is audited.

**Money in other currencies.** An allocation records an exchange difference in the home currency. A payment's currency is its party's currency and its bank account must match. Payments across different currencies are not supported.

**On invoices and credit notes.** The tab on a posted document is **Receipts** (sales invoice), **Payments** (purchase invoice) or **Applied** (credit note). It lists what settled the document with a link to open each, shows what is open and names the screen that records one. It records nothing itself. A credit note's tab also has Apply to an invoice and removal of an application. Document lists have Paid and Amount due columns and a filter for unpaid, part paid and paid.

**Applied to the hosted project.** Yes. Every migration file after the baseline, from `20261112110728_revoke_private_function_execute` to `20261117150118_payment_form_layouts`, including all the release B payments migrations (`20261113123253_payment_kinds` to `20261113130201_allocate_lines`), the three-character type codes and the payment form layouts, has a matching record in the hosted FinTran project's migration history. I checked the history with the Supabase tools on 18 November 2026. The baseline file is recorded there under the name `order_quantity_rules`, as expected. The hosted project had no typed paid amounts to migrate.

**Migration of the old paid amount.** The earlier typed paid amount was removed. Existing figures became migrated payments under four hidden system types (`SMR`, `PMP`, `SMF`, `PMF`). The hosted project had none to migrate.

**Printing.** A payment prints as a remittance advice (money out) or a receipt (money in), listing the documents it settled (section 10).

**The spec has 67 acceptance boxes. 59 are ticked with the test that proves each. Eight are open** (section 15).

## 9. E-invoicing

**Partly built.** Read more: `CORE.md` "EN 16931 export and readiness" and `TECHNICAL.md` "E-documents".

**Built, in CI**
- **Business terms.** `en16931_document` returns a document as EN 16931 business terms in JSON. Purchases use the supplier invoice number, sales use the document number. Orders raise an error.
- **Readiness.** `en16931_readiness` lists gaps as errors or warnings. Sales errors stop posting. Purchase gaps are warnings, apart from the credit note's preceding invoice. A Readiness button on the document and the list is red, orange or green and opens the gaps, with plain-English fixes.
- **Export.** A posted sales invoice or credit note is turned into UBL 2.1 on the server, checked against the UBL XSD, then the CEN EN 16931 and Peppol BIS Billing 3.0.21 Schematron, and stored with its SHA-256. A fatal XSD error stops Schematron. It can be regenerated and downloaded.
- **Import.** A received UBL file is uploaded on the E-documents screen. It is stored only when the buyer's Peppol ID (or VAT number, if the organisation has no Peppol ID) matches. A valid file can be imported as a purchase draft, creating the supplier on the way if needed. Posting that draft is refused while its totals differ from the file. An identical file is not stored twice, and a different file with the same number is a duplicate an admin can release or reject.
- **Safety.** A file with a DOCTYPE, an external entity, a CII root or a root other than a UBL 2.1 Invoice or CreditNote is refused.
- **Supplier says part paid.** If a received invoice states an amount already paid, a notice shows on the import screen and on the posted invoice. Nothing is recorded from it.

**Context: the Irish Revenue mandate.** E-invoicing is moving from a nicety to a requirement in Ireland. Revenue has announced phased mandatory structured e-invoicing with real-time reporting. As summarised on 18 November 2026 by vendor and advisory sites (secondary sources, not Revenue's own pages): from 1 November 2028 large corporates must issue EN 16931 e-invoices for domestic B2B sales and report them to Revenue in real time, and every Irish business must be able to receive them. It extends to further businesses from 1 November 2029, and cross-border EU B2B follows from 1 July 2030. Peppol is expected to be the default exchange network, with Revenue the reporting channel. The sources disagree on how final the technical specifications are, and I found none that states penalties. Check Revenue's VAT Modernisation pages before relying on any date. What it means here: the format Qula Plus produces and checks (EN 16931 UBL, Peppol BIS Billing 3.0) is the right one. Sending, receiving and reporting all need an Access Point, which is the mock below, and real-time reporting to Revenue does not exist in the app at all. Receiving is the nearer pressure, because it applies to every business.

**Not built, a stand-in**
- **Sending and receiving over Peppol.** The Access Point screen exists (provider, environment, secret storage, test connection, look up and register a participant), but it only talks to a **mock** adapter that always succeeds. No e-invoice is sent to anyone, and received files arrive only by manual upload. The adapter interface has `send` and webhook methods ready for a real provider.

## 10. Printing, PDF and the form designer

**Built, in CI.** Read more: `CORE.md` "Printable forms".

- Every document prints through a saved layout for its transaction type, or a standard one. Print opens the browser dialog and PDF downloads the same page at the layout's size (A4, A5, Letter or Legal).
- The **form designer** (Admin, Forms) chooses the title, page size, logo, and which organisation, party, header and line fields appear and in what order, with a live preview from the latest document or a sample. The database checks a saved layout, and a sales form must keep the fields the standard requires (organisation name, address and VAT number, customer name and address, document number and date, description, quantity, price, tax, amount and the VAT summary).
- **Payments, receipts and refunds** have forms of their own with their own fields: party, number, date, method, bank reference, bank account, currency, and for each document settled its number, date, total and amount applied. The organisation name, party name, number, date, document and amount applied are always shown.
- A draft prints with DRAFT and a void document with VOID.

## 11. Home dashboard and "Worth a look"

**Built, in CI.** Read more: `TECHNICAL.md` "Screens" and `src/lib/insights.ts`.

The home page shows document counts, documents posted in each of the last six weeks, shortcuts, the five latest changes (owners and admins) and a **Worth a look** card that loads last. Worth a look uses fixed rules and no AI. Ask Qula reads the same list.

| Rule | Flags |
| --- | --- |
| Past due | Invoices past their due date with an amount still due |
| Part paid and past due | Invoices past due that have had something applied |
| Money on account | Posted payments, and credit notes with a balance, left unapplied for more than 7 days |
| Likely match | Unapplied money equal to what is open on exactly one invoice of that party and currency |
| Not ready | Drafts that cannot be sent as e-invoices yet (the newest 10 are checked) |
| Possible duplicates | Same party and amount, and the same supplier reference or date |
| Unusually large | A recent document more than three times the party's usual |
| Due soon | Invoices due within 7 days |
| Orders to invoice, orders to close | Active orders with something left, or fully invoiced and ready to close |
| Closed orders with quantity left | Orders closed by hand with quantity not invoiced |
| Drafts holding order quantity | Draft invoices over 14 days old drawing on an active order |

A credit note is never reported as overdue or due soon.

## 12. Grids, search and exports

**Built, in CI.** Read more: `TECHNICAL.md` "Grids".

- Every list is a grid with search, sorting, paging, a rows per page menu and a grid lines button (row, row and column, column or none, remembered per grid).
- **Excel and CSV export.** Every grid exports the rows that match the search, in the sort shown, across all pages, with a Fields menu for extra columns. A spreadsheet runs a cell as a formula if it starts with `=`, `+`, `-` or `@`, so every download goes through one helper that neutralises that, and a test searches the code for anything that bypasses it.
- Dates show as 18 Oct 2026 with the browser's region deciding the order. There is a British English spell checker in forms.

## 13. Ask Qula

**Built, in CI.** Read more: `TECHNICAL.md` "Ask Qula".

- **Two modes.** Until an owner or admin turns AI on, a question is matched by keyword and answered from the organisation's transactions, e-documents or overdue invoices. With AI on, the question goes to the organisation's chosen provider (Anthropic, an OpenAI-compatible service or Azure OpenAI, or a scripted mock for tests) with read-only tools, and the answer streams in. A limit, a missing key or a provider failure falls back to the keyword answer.
- **What it can look up.** Transactions and one transaction with its lines, ageing by party, totals by month or quarter, top parties (by value, count, or what is owed), VAT by rate, open orders and what is left to invoice, payments, receipts and refunds (including unapplied money), parties, products, change history (owners and admins), e-documents, readiness problems, what a rule means, and help text. Tables are built by the server, not written by the model. A table can be downloaded as CSV.
- **What it can do.** Write a payment reminder for an overdue sales document (copy or open in email, nothing is sent). **Actions** are off by default and need an owner or admin to switch them on: post a draft, or add a customer or supplier. The model only proposes. A confirmation card built from database figures appears, a person presses Confirm, and the confirmation works once, for ten minutes, and is refused if the document changed. A draft that is not ready cannot be confirmed.
- **Knows the page.** "This invoice" means the one open.
- **Ratings and privacy.** A thumbs rating is kept. The question and answer are kept with it only if an owner or admin switches that on and accepts a notice, for 30 days unless set between 1 and 365, then deleted automatically. Usage (tokens, tool calls, outcome) is logged without the text. Provider keys are stored encrypted (AES-256-GCM) and the API cannot read them back.
- **Limit.** The help it can search is one page, `docs/help/ask-qula.md`. It has no help text for payments, receipts or credit notes.

## 14. Change history, security and how the app is checked

**Built, in CI.** Read more: `CORE.md` "Who can see a row" and `TECHNICAL.md` "Testing and CI".

- **Audit log.** Changes to organisation defaults, access, parties, VAT rates, GL codes, currencies, transaction types, document headers, payments, bank accounts, Ask Qula settings, Access Point settings and secret changes are recorded with who and when. An update stores only the columns that changed. Owners and admins read it. Nobody can edit it.
- **Access.** Row level security on every business table limits rows to organisations the person can open. Writes that need more than that go through functions that check the role. The `private` schema is not on the API. The app uses no service-role key.
- **Other protections.** Locked periods, immutable codes, posted documents that cannot be edited, e-documents frozen after storage, signed single-use Ask Qula confirmation tokens, XML refused when it could load outside files, and the spreadsheet safety above.

| Check | What runs | Size on 18 November 2026 |
| --- | --- | --- |
| Documents | `npm run check:docs` | `CORE.md`, `TECHNICAL.md` and this file still match the code by name: paths, migrations, server actions, database functions, tables, form designer fields and the flows table |
| Unit tests | `npm test` | 161 tests in 30 files |
| SQL tests | `scripts/run-sql-tests.sh` against a local Supabase stack built from every migration | 38 test files and 2 two-session concurrency scripts |
| Types | `npm run db:types` | Fails if the generated types stop matching the migrations |
| End to end | Playwright in Chromium on the built app and a seeded stack | 19 flows and a smoke test of every main page for owner, admin and member |

CI runs all five on every pull request and every push to a `claude/` branch. Every pull request merged so far had a passing run on its branch.

**Ignored clicks: what the review found.** Flows 3, 5, 6 and 12 each had a click that did nothing (failing runs 44065657762 for flow 3, 44084432097 for flow 5, 44063750925 for flow 6, and 44278534407 and 44279765205 for flow 12). I read the app code behind each. I could not run the app here, because this environment has no Supabase stack and the CI traces are not reachable from it.

- **A real bug of this kind, found and fixed earlier:** a dialog drawn outside the document form sent its submit event to the form it sits inside, so Apply did nothing (flow 14).
- **Ruled out by reading:**
  - Clicking before the page has loaded. Flows 5, 6 and 12 click inside dialogs that client code opens after loading, and the dialog does not exist until then.
  - The supplier dialog in flow 5 is not inside the import form's component tree, so no submit can reach the import form.
  - Flow 12's open documents list: the rows only appear once it has loaded, and it loads again only when the party or a reload counter changes.
- **Flow 12 in detail:** Playwright's double click ran without error in every retry, and the screen showed no refusal message, yet nothing was allocated. The handler (`allocateWhole`) is a plain state update, and I found nothing that clears the boxes after it runs.
- **Not ruled out:**
  1. **A data refresh replacing the open document.** `DocumentManager` and `PaymentManager` open the draft again with the new row whenever the server sends a new set of rows. A redirect after an action that also revalidates the page can send two page payloads in quick succession, and flows 3 and 6 click right after such a redirect.
  2. **Layout shifting between mouse down and mouse up.** Flows 5 and 12 click straight after typing, when a field losing focus could move something under the pointer.
- **Verdict:** I found no confirmed loading race in the app, and I have not shown there is none. To settle it I need the `e2e-failures` artifact (trace, page snapshots and console) from one of the runs above, downloaded from the run's page on GitHub. A trace shows what the page did around the lost click.

**What the checks do not cover.** The end-to-end flows drive the app with a script, not a person. Payments has never been opened by a person.

## 15. Open items and where to go next

### 15.1 Open items in the payments spec (eight)

1. Allocating to a **void document** is refused by the same check as a draft, but no test tries it.
2. The **"has money on account" filter** on the payment list has no test. Its database half is tested.
3. **`en16931_readiness` and stored outbound e-documents** are not checked after a payment is allocated. `en16931_document` is, for one invoice.
4. The migrated types being **left out of the Transactions menu** and the type admin list has no test. The database protects them.
5. **"Who owes us the most?"** has never run against real data.
6. A **receipt eight days old** appearing in Worth a look is unit tested only.
7. An **imported e-invoice with an amount paid** has no end-to-end flow. The notice wording is unit tested and the stored figure is SQL tested.
8. The release B migration was never run against a **copy of the live project**, as the spec's "Done when" asks.

Items 1 to 4 can be closed with tests. Items 5 to 7 are best settled by a person using the app. Item 8 only matters if another project holds real typed paid amounts.

### 15.2 Do first

1. **The manual run of `docs/payments-test-script.md`.** Nothing in payments has been used by a person. It includes the double click that failed in flow 12.
2. **Fix what the run finds**, in small pull requests.
3. **Settle the ignored clicks.** Download the `e2e-failures` artifact from one of the failing runs listed in section 14 and I will read the trace (section 14 says what I need and why).

### 15.3 Gaps in what exists

These are my reading of the code and the documents, with the checks said. None has been decided as a roadmap.

| Gap | What is true now | Size |
| --- | --- | --- |
| **No real Peppol transmission** | The Access Point is a mock that always succeeds. E-invoices are built and validated but not sent, and received ones arrive by upload. **Blocked on an Access Point provider choice that has not been made** | Large: choose a provider, build the adapter, handle webhooks, status and failures |
| **Real-time reporting to Revenue** | Not built, and nothing in the app prepares for it. It depends on Revenue's final specifications (section 9) | Unknown until the specification is final |
| **Rejecting a received e-document needs an Invoice Response** | Reject only marks the e-document rejected, with a reason, inside Qula Plus. Nothing is sent back to the sender, because there is no Access Point. Telling the sender needs the Peppol Invoice Response, so this waits on the Access Point | Small to medium once the Access Point exists |
| **Import blocked by document-level allowances and charges (G7)** | Confirmed in the code. A received e-invoice with a document allowance, a document charge or a line charge is listed as "features Qula Plus cannot import yet", and the import is refused on the screen and in `import_e_document`. Such an invoice can be uploaded and validated but has to be keyed by hand. (G7 is your label. I have not seen the requirement it refers to) | Medium: a place for allowances and charges on a document, their VAT effect, totals, export |
| **Purchase approvals** | Not built. Searching the app and the database finds no approval, approver, threshold or pending state. Any member can activate an order or post an invoice, and Ask Qula's post action follows the same rule. Amount-based approval on orders and invoices would be new. Listed as out of scope in the hardening spec. Second in the agreed order, with price tolerance, as one spec. **A draft spec is written, with the review questions answered: `specs/QULAPLUS_APPROVALS_SPEC.md`**. Email notification is wanted, and needs a mail provider (next row) | Medium to large: thresholds by type or organisation, who approves, a pending state, notifications, audit, and Ask Qula must respect it |
| **Price tolerance on order matching** | Not built (confirmed: no tolerance anywhere). Matching an invoice to an order is by **quantity** only: each order line shows Invoiced, Reserved and Left. A price on an invoice line that differs from its order line is neither compared nor flagged | Small to medium: compare price on lines that came from an order, a tolerance setting, a warning on the line or at posting, possibly a Worth a look rule |
| **Aged debtors and creditors report** | First in the agreed order. Not built as a report. The only ageing is Ask Qula's lookup: by party, in bands (not yet due, 1 to 30, 31 to 60, 61 to 90, over 90 days), from posted documents with an amount due, with credit note balances coming off, in each document's own currency, showing at most 25 parties, from up to 5,000 documents, with an as-at date only by asking for it. There is no screen, no drill-down to documents, no home-currency total, and no export of it apart from the chat table's CSV | Medium |
| **No accounting integration or journal export** | There is no ledger, by design. Accounting stays in the customer's own system, so journal export is the route in. Exchange differences are already stored per allocation for it. **A priority, with payments and banking** (section 15.4) | Large, in steps |
| **Bank feeds and matching** | Receipts are typed. Worth a look suggests a likely match but nothing imports bank lines. **A priority, with payments** | Large |
| **Cross-currency payments** | A payment must be in its party's currency and its bank account's. The spec names this the first follow-up | Medium to large: it needs write-offs and bank charges to be usable |
| **No VAT return or reports** | Nothing for a VAT period apart from Ask Qula's VAT by rate and grid exports. `CORE.md` mentions "later VAT reporting" | Medium |
| **No statements or dunning** | Ask Qula can draft a reminder for one document. There are no customer statements or reminder runs | Medium |
| **No outbound email** | The app can send none: only `mailto` links, and Supabase's own sign-in emails. The approvals spec needs it for notifications. It is built behind an adapter with a mock, like the Access Point, and **real sending waits on a mail provider that has not been chosen** | Small for the adapter, then a provider decision |
| **Internal FinTran identifiers** | Names kept from the old product name: the cookie `fintran-organisation`, the browser storage keys (`fintran.*`), the Postgres settings `fintran.*` that triggers read, the readiness rule ids `FINTRAN-*`, the repository, package and project names, and the `@fintran.test` fixtures. A sweep needs a cookie migration (read the old name, write the new, drop the old), the storage keys moved, and the database triggers and the settings they read changed together in one migration. The risk is in the database settings | Small to medium |
| **Possible loading race in the app** | Not confirmed (section 14). Four flows lost a click once | Unknown until a trace is read |
| **Inviting people** | A person must sign up before they can be granted access | Small to medium |
| **Help is one page** | `docs/help` covers Ask Qula only, so Ask Qula's help search cannot answer how to record a receipt | Small |
| **Leftovers of the Purchase Invoice naming** | `DocumentManager` still defaults its title to "Purchase Invoices", and the document form's HTML id is `purchase-document` (also used by the end-to-end selectors) | Small |

### 15.4 Priorities and order

**Fixed points** (from you):

- Qula Plus has **no ledger** and will not have one. Accounting stays in the customer's accounting system.
- **Accounting integration is a priority alongside payments and banking.** A journal export comes first, then connectors to Xero, Sage and QuickBooks.
- **No Access Point provider has been chosen.** Everything that waits on a provider (Peppol transmission, live connectors, bank feeds) goes last.

**Agreed order, after the manual payments run.** Small jobs with no outside dependencies go first.

| Order | Item | Size | Why here |
| --- | --- | --- | --- |
| 1 | Aged debtors and creditors | Small | The data is ready now that allocations set the paid amount. No new rules, quick to show value, and statements and reminder runs build on it later |
| 2 | Approvals and price tolerance, as one spec (**draft written, awaiting review**: `specs/QULAPLUS_APPROVALS_SPEC.md`) | Medium | A price over tolerance is a natural reason to require approval, so they belong together. Both change what happens before posting, which is easier before real users and before anything is exported |
| 3 | Journal export (file) | Medium | CSV or import files for Xero, Sage and QuickBooks. GL codes, bank account GL codes and exchange differences already exist. No provider needed |
| 4 | Bank statement import (file) | Medium | Upload CSV or CAMT.053 statements and match lines to open documents. Most of the value of bank feeds without choosing an open banking provider |
| 5 | Live connectors and bank feeds | Large | Each needs a provider or partner decision, like the Access Point. Do these once the file versions show what customers actually use |

**Peppol transmission** sits with row 5: it is blocked on the provider decision. It brings the Invoice Response and receiving webhooks with it, and the Irish mandate (section 9) makes receiving a requirement for every business from November 2028, so the decision has a long lead even though nothing can start until it is made.

**Why approvals come before journal export.** Journal export sends out posted documents, and approvals decide what is allowed to post. If export comes first, the first exports will contain documents that skipped approval, and the posting rules will change under the integration later. Approvals also touch three things already built: Ask Qula's "post a draft" action, imported e-invoice drafts and the save-before-acting buttons. All three are cheaper to change now. This agrees with the code: each of them ends in `post_document`, so that is where an approval check would sit. The hardening spec listed approvals as out of scope, so this is new work with its own spec.

**When to swap 2 and 3.** If a pilot customer needs to get data into Xero or Sage before they need approvals, do the export first. Approvals matter most to the large corporates in the first phase of the mandate, and that deadline is further off than a pilot.

**Things the order does not place** (cheap, can be done at any point): closing payments spec items 1 to 4 with tests, payments help text for Ask Qula, the tolerance warning on its own if approvals slip, and the naming leftovers.

**Payment approvals** (approving payments or a payment run) reuse the approvals machinery. Confirmed: they are the spec after approvals and price tolerance, ahead of journal export.

**Not placed, and later:** cross-currency payments with write-offs, statements and dunning, VAT reports, allowances and charges on import, real-time reporting to Revenue (waiting on its final specification), inviting people, and the identifier sweep.

**What journal export can build on, and what it needs** (my reading). It has posted documents with a copy of the parties, GL and VAT codes on every line, the VAT breakdown, bank accounts with an optional Current Asset GL code, and payments with allocations that carry an exchange difference in the home currency. It needs decisions on the control accounts (receivables, payables, VAT, exchange gain and loss, bank), a mapping screen for them, a journal built for each posted document and each posted payment, voids and removed allocations as reversals, a batch record so nothing exports twice, how it respects the lock date, and a first format.

### 15.5 Answered and still open

1. **The hardening spec.** Answered: it is now in `specs/QULAPLUS_HARDENING_SPEC.md`, with a status section and its acceptance boxes ticked where a test proves them. All eight phases are built. 30 of its 36 boxes are ticked and six are open: two in phase 6 have no test, the phase 7 box and the "Done when" box that refer to a status document that does not exist, the live-project dry run, and the box that all acceptance tests pass, which waits on the others.
2. **Phase 8** (document screen split and the `PurchaseInvoice` rename): done. The screen is a shell and panels in `src/components/document/`, the largest file is 534 lines, the name is gone from `src` and `e2e`, and two small leftovers remain (the default title "Purchase Invoices" and the form id `purchase-document`).
3. **Access Point provider:** none chosen.
4. **Priorities:** agreed, in section 15.4.
5. **Still open:** what G7 refers to (I used your label), and a Revenue-sourced version of the e-invoicing mandate. My section 9 summary comes from vendor and advisory sites.

## 16. Documents and how they are kept right

| Document | Read it for |
| --- | --- |
| This file | What the app does and where to go next |
| `CORE.md` | The rules: tables, columns, constraints and what each screen does |
| `TECHNICAL.md` | How it is built: runtime, screens, routes, server actions, database functions, tests, environment |
| `specs/QULAPLUS_PAYMENTS_SPEC.md` | The payments design, its decisions and its 67 acceptance boxes |
| `specs/QULAPLUS_APPROVALS_SPEC.md` | Draft spec for purchase approvals and price tolerance, with seven questions for review at the top. Nothing in it is built |
| `specs/QULAPLUS_HARDENING_SPEC.md` | The November hardening work (export safety, Ask Qula actions, retention, order quantity rules, Peppol order references, save before acting, the end-to-end suite, the document screen split), with its status and 36 acceptance boxes |
| `HANDOVER_PAYMENTS_RELEASE_B.md` | The history and status of the payments build |
| `docs/payments-test-script.md` | The manual run for payments |
| `README.md` | Running it locally, and a pointer to this file |
| `scripts/check-docs.mjs` | The CI check that keeps `CORE.md`, `TECHNICAL.md` and this file matching the code by name |
| `AGENTS.md`, `CLAUDE.md` | Rules for anyone changing the code |

**The 18 November 2026 audit.** A script checked every file path, migration name, database function, table, server action, form layout field list and documented column named in `CORE.md` and `TECHNICAL.md` against the repository. Every path, function and table exists. It found, and I fixed:

1. `TECHNICAL.md` listed a server action `updatePaidAmount` that no longer exists, and left out `createFromOrder`, `setOrderStatus` and `loadPartySummary`.
2. `TECHNICAL.md` said a member cannot remove an allocation. Any member can, in the database and the screen.
3. `CORE.md` said the same, in its description of the payment screen.
4. `CORE.md` still described record and refund buttons on the invoice tab, which were removed on 18 November.
5. `CORE.md` and `TECHNICAL.md` still called the tab beside Notes "Payment". It is now "Payment terms".
6. `CORE.md` left `order` out of the form designer's allowed line columns.
7. `TECHNICAL.md` said Ask Qula cannot change records at all, which contradicted its own section on confirmed actions.
8. `README.md` still described a first version with purchase documents only, and listed none of payments, e-documents or Ask Qula.

The same checks now run in CI as `npm run check:docs` (`scripts/check-docs.mjs`), and they also check this file's paths, that every server action, public database function and table is described, that the form designer's field lists match, and that the flows table has every numbered flow. It checks names, not sentences, so a rule described wrongly in prose is still for a reader to catch.

## 17. Reference point, 18 November 2026

A fixed record of where Qula Plus stood when the payments work, the documents audit and the priorities were agreed. Later changes should be measured against it. The rest of this file is kept up to date, and this section is not.

| | |
| --- | --- |
| **Code** | `main` at commit `85a8915` (the merge of pull request 98, 18 November 2026, 14:08 UTC) |
| **Database** | Hosted FinTran project `hxueqzgdwlaschcvwdke`, migrations up to `20261117150118_payment_form_layouts`. Every migration file in the repository has a matching hosted record. 14 migration files after the squash to a baseline |
| **Built** | Documents and orders, payments and settlement, e-invoice export and import, printing and the form designer (documents and payments), Ask Qula, Worth a look, audit log, grids and exports |
| **Stand-in** | The Access Point is a mock. No e-invoice is sent or received over Peppol |
| **Checks** | 161 unit tests in 30 files, 38 SQL test files and 2 concurrency scripts, 19 end-to-end flows and a smoke test, the type check and the documents check. All passing in CI on this commit's branch |
| **Specs** | Payments: 59 of 67 acceptance boxes ticked, 8 open. Hardening: 30 of 36 ticked, 6 open. Both with the test beside each tick |
| **Never done by a person** | The manual payments run (`docs/payments-test-script.md`). Nothing in payments has been opened in a browser by a person |
| **Open questions** | The ignored clicks in flows 3, 5, 6 and 12 (needs a trace, section 14). What G7 refers to. A Revenue-sourced mandate summary |
| **Agreed next** | Aged debtors and creditors, then approvals with price tolerance as one spec, then journal export, then bank statement import, then live connectors and bank feeds (section 15.4) |

To find this exact state again, check out commit `85a8915`. A git tag could not be pushed from the working environment (the git server refused it), so if a tag is wanted it has to be made on GitHub, from that commit, for example `reference-2026-11-18`.
