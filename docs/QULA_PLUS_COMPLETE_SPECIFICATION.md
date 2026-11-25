# Qula Plus: complete specification and delivery review

Written 24 November 2026 from the code, the migrations and the project documents at commit `bb89b1d` on the branch `claude/intelligent-cerf-j32nz3`.

This document does two jobs. Part A reviews what was asked for in the original specs against what was delivered, including work done without a spec. Parts B to F describe the whole product as it stands: functions, design decisions, database and application structure. Part G lists the gaps and the corrections the project documents need.

## 0. How this was produced, and what it can and cannot claim

**Sources read in full:** the five specs you attached (hardening, EN 16931, sales, schema fixes, e-documents), the five specs in `specs/` (payments, hardening of 11 November, approvals, payment approvals, journal export), `CORE.md`, `TECHNICAL.md`, `docs/QULA_PLUS_REFERENCE.md`, `HANDOVER_PAYMENTS_RELEASE_B.md`, `einvoice/rules/3.0.21/CONFORMANCE.md` and the CI workflow.

**Checked directly against the repository:** table, enum, view and function names in the baseline and the 20 later migrations, the policies on `organisation_defaults`, the constraint names on `transaction_headers`, the `store_e_document` signature, the `XI` and `EL` country rows, the VAT category seed, the audit triggers, the Access Point and AI provider seeds, and the test, route and file inventories.

**Not done:** I could not run the app, the SQL tests, the unit tests or the end to end flows. This environment has no database. Every statement that a test passes comes from the project's own records of its CI runs. I did not re-read every migration line by line. Where a rule below comes only from `CORE.md` or `TECHNICAL.md` and I did not confirm it in SQL, it is a documented rule, not a proven one.

**A count discrepancy you should know about.** You described eight original specs and attached five. The repository holds five more in `specs/`. That makes ten, and I reviewed all ten. Two names collide: the attached `FINTRAN_HARDENING_SPEC` (security and access, nine phases, October) is a different document from `specs/QULAPLUS_HARDENING_SPEC.md` (eight phases, November). I call them "Hardening 1" and "Hardening 2". If your eight are a different selection, tell me which and I will cut the review to match.

---

# Part A. Delivery review

## A1. Scorecard

| # | Spec | Date or order | Delivered | Open or different |
| --- | --- | --- | --- | --- |
| 1 | Hardening 1 (attached): helpers, audit, roles, composite keys, status, snapshots, numbering, supplier fields, safe deletion, form validation | October 2026, nine phases | All nine phases built | Two behaviours differ from the text (A2.1). Test status is not recorded in a checklist |
| 2 | EN 16931 alignment (attached) | October 2026, six phases | All six phases built | Category `B` added. Orders, requisitions and payments share the document kind enum. Rule IDs and readiness extended |
| 3 | Sales documents (attached) | October 2026, six phases | All six phases built | Sales orders added beyond the spec. Sales documents cannot be voided, as S2 decided |
| 4 | Schema fixes (attached) | 22 October 2026, five phases | All five built | None found |
| 5 | E-document repository (attached) | 25 October 2026, phases 0 to 6 | Built and live | Conformance evidence is short of the spec (A2.5). Reject is owner and admin only, not any member. Access Point added beyond the spec |
| 6 | Payments and receipts | 13 to 18 November | Built. 59 of 67 acceptance boxes ticked | 8 open boxes. Never used by a person in a browser |
| 7 | Hardening 2 | 11 to 18 November | Built. 30 of 36 boxes ticked | 6 open, listed in A3.2 |
| 8 | Purchase approvals and price tolerance | 18 to 19 November | Built, applied to the hosted project. 36 boxes ticked, 6 open | A3.3 |
| 9 | Payment approvals, supplier bank details and payment runs | 19 November | Built (migrations, screens, flows 28 to 34) | The spec file still says "Nothing in it is built" and has 40 unticked boxes. The status is stale (A3.4) |
| 10 | Journal export | 19 to 20 November | Built. 32 boxes ticked, 10 open | A3.5 |

Overall: every phase of every spec has code, a migration and tests behind it. The gaps are in evidence and in documents, not in missing features. The largest real gaps are the conformance comparison for the validator, the manual run of payments that has never happened and the Access Point, which is still a mock.

## A2. The five attached specs, phase by phase

### A2.1 Hardening 1

| Phase | Asked for | Delivered | Notes |
| --- | --- | --- | --- |
| 1 | `private.org_role`, `private.has_org_role`, audit columns on every business table, `audit_log`, search path and revoke housekeeping, indexes | Done. `private.set_audit_columns`, `private.write_audit_log`, `audit_log` read by owners and admins only | Audit triggers cover the nine tables the spec named and many more: Access Point settings, Ask Qula settings, bank accounts, payments, allocations, approval rules, payment runs, accounting settings, supplier bank changes and journal batches |
| 2 | Role-based write rights, `private.issue_reference`, ownership rules in the access functions, `can_manage_tenant`, profile visibility, organisation check in the save function | Done. `organisation_defaults` has select and update policies only, with update for owner and admin. No insert or delete policy | See the gap in A2.6 about `CORE.md` |
| 3 | Same-organisation composite foreign keys | Done | Referenced by almost every later table |
| 4 | Status, posting, voiding, period lock | Done. `document_status` enum, `post_document`, `void_document`, `lock_date`. Status changes only through the functions, guarded by a transaction-local setting (`fintran.status_change`) | The enum was later extended with `open`, `closed` and `cancelled` for orders and requisitions |
| 5 | Line VAT percentage, snapshots, party VAT number, print from snapshots | Done | **Different:** the spec said that if the logo copy fails at posting, fall back to the live logo and log the error. The system does the opposite. It refuses to post if the copy fails (`CORE.md`, "Purchase documents") |
| 6 | Numbering on posting, `numbering` enum column | Done. Column `transaction_types.numbering` of type `numbering_rule`. Sales types forced to `on_post` | `TECHNICAL.md` names the column `numbering_rule`. The column is `numbering`. The enum is `numbering_rule` |
| 7 | Supplier reference, supply date, customer on header, code format (D6) | Done. Codes accept `A-Z`, `0-9`, `.` and `-` after the first character | `CORE.md` still shows the old `^[A-Z0-9]{1,20}$` pattern in one place |
| 8 | Safe organisation deletion | Done. `delete_organisation` for owners, no documents, not the last organisation. Logo cleanup by the app | None |
| 9 | Form layout validation, mandatory sales particulars | Done. `private.validate_form_layout`, later given a payment branch | None |

Decisions D1 to D7 were all implemented as stated.

### A2.2 EN 16931 alignment

| Phase | Delivered | Notes |
| --- | --- | --- |
| 1 Code lists | Seven `ref_*` tables, read-only, pinned to Peppol BIS Billing 3.0.21 (May 2026, lists dated 2026-03-06) | VAT categories include `B` (Italian split payment) as well as the nine the spec named. `EL` is a VAT-prefix-only country row. `XI` (Northern Ireland) is also present as VAT-prefix-only |
| 2 Parties and addresses | Structured address columns, VAT prefix check, company number, Peppol scheme and ID, IBAN with mod-97 check, BIC, `currencies.iso_code` | The migration of old free-text addresses and VAT numbers followed E6 and flagged `address_needs_review` |
| 3 VAT categories and breakdown | `vat_category`, exemption fields, `transaction_vat_breakdown`, header totals from the breakdown, 2-decimal rounding | Document VAT is the sum of breakdown VAT, not of line VAT (decision E1) |
| 4 Document kinds, credit notes, units | `document_kind`, preceding reference, units on products and lines | Enum later grew from `invoice`, `credit_note`, `order` to add `requisition`, `payment` and `receipt` |
| 5 Business terms and payment | Buyer reference, contract reference, payment terms, invoice period, payment means, party defaults, snapshot extension | Payment means defaults to `58` on a sales post when the organisation has an IBAN |
| 6 Export and readiness | `en16931_document`, `en16931_readiness`, `post_document` calls readiness | Sales errors block posting. Purchase gaps are warnings, except that a credit note needs its preceding invoice |

### A2.3 Sales documents

| Phase | Delivered |
| --- | --- |
| 1 Schema | `supplier_name` renamed to `party_name`. Sales headers allowed. Lines branch on direction. `reference_prefix`, `reference_padding` and `document_number` |
| 2 One save function | `save_document(jsonb)`. `save_purchase_invoice` was dropped (it appears in no live migration) |
| 3 Lifecycle | No voiding of sales (S2). Credit note limit (S3). Income GL code required at posting (S4). Date not more than one day ahead. Gapless numbering proved by a concurrency path |
| 4 App | One direction-aware entry form, credit note creation, lists with filters |
| 5 Print | Posted documents print from snapshots. File name `{document_number}.pdf`. DRAFT watermark |
| 6 End-to-end export tests | Fixtures in `supabase/tests/fixtures/en16931/` and golden UBL in `einvoice/fixtures/` |

### A2.4 Schema fixes

All five fixes are present. Evidence from the baseline: the unique index `organisation_defaults_peppol_unique` on `(peppol_scheme, lower(peppol_id))`; `transaction_headers.tenant_id` and `transaction_lines.tenant_id` are `ON DELETE RESTRICT`; the constraints `transaction_headers_posted_complete`, `transaction_headers_draft_clean` and `transaction_headers_void_complete` exist; amounts are `numeric(18,2)`; `create_tenant` and `create_organisation` take `p_home_currency` defaulting to `EUR`; `ref_eas.value_pattern` exists and a function reads it.

### A2.5 E-document repository

| Item | Spec | Delivered |
| --- | --- | --- |
| Phase 0 leftovers | Drop `save_purchase_invoice`, check `transaction_lines.reference`, logo path guard, `XI`, case-insensitive profile email, missing rules and indexes | Done. `XI` confirmed in the baseline. `transaction_lines.reference` was dropped |
| Tables | `e_documents`, contents, validation results, events, G9 settings | All present with the specified constraints |
| Envelope and `store_e_document` | HMAC-signed envelope, key in Vault, signature and size checks, outbound tied to `en16931_document`, inbound duplicate rule, addressing rule G8 | Done. Signature is `store_e_document(p_envelope, p_signature, p_xml)` |
| Validator | SaxonJS Schematron and `xmllint-wasm` XSD, no DOCTYPE | Done. Rules version 3.0.21. A fatal XSD error stops Schematron |
| Generation | `generateUbl`, golden tests, round trip | Done. Golden files for invoice, credit note, reverse charge and four order reference cases |
| Import | `parseUbl`, upload route, import function, posting guard G10 | Done. `import_e_document` refuses a `createSupplier` choice. The supplier is created in a separate dialog instead |
| Screens | E-documents list and detail, document panels, organisation pickers | Done |

**Differences and shortfalls:**

1. **Conformance evidence is incomplete.** Section 3.4 of the spec asks for: every example passing, every negative case giving its expected rule, a 30 document comparison with an independent reference validator and a 4 MB timing. `CONFORMANCE.md` records: the base example passes, the example set passes except `base-example_profile02.xml` (fails `PEPPOL-EN16931-R007`, which is expected for a non-billing profile), the golden files pass, and a 4 MB file validated in 1,281 ms. It does not record the 30 document comparison and says a sampled run of the negative cases "is still required". The comparison file the spec names does not contain the comparison.
2. **A validator defect lived for two weeks.** Until 12 November `validateXml` read the Schematron report under the wrong element name, so no EN 16931 or Peppol failure was ever reported. The XSD layer was unaffected. It was found and fixed, and tests now prove two known failures are reported. It is the strongest argument for finishing the reference-validator comparison.
3. **Reject is stricter.** The spec said any member may reject. The system allows owners and admins only, and adds `release_duplicate_e_document` for owners and admins.
4. **Access Point added.** The spec put Peppol out of scope. A settings screen, encrypted secrets and a mock adapter were built anyway (section C14).

### A2.6 Documents that disagree with the code

**Status, 24 November 2026:** all rows below are corrected in the repository, except that the two attached specs that name the missing files are not in the repository. The one repository spec with that fault (`specs/QULAPLUS_HARDENING_SPEC.md`) now points at `docs/QULA_PLUS_REFERENCE.md`. The payment approvals spec has a corrected status line, but its 40 boxes are not ticked.

| Document | Statement | What the code shows |
| --- | --- | --- |
| `CORE.md` | `organisation_defaults` "can be selected, inserted, and updated by a member" | Only select and update policies exist, update limited to owner and admin. `CORE.md` contradicts itself two paragraphs earlier |
| `CORE.md` | Account lists use `^[A-Z0-9]{1,20}$` | Codes may contain `.` and `-` after the first character |
| `CORE.md` | Header `transaction_type_id` is "A Purchases type" | Either direction, by transaction type |
| `CORE.md` | A stray table row `| flex1 … flex5 |` sits after the lock date paragraph | Formatting fault. It belongs in the header table |
| `TECHNICAL.md` | `store_e_document(p_xml, p_envelope, p_signature)` | Argument order is envelope, signature, xml |
| `TECHNICAL.md` | Column `transaction_types.numbering_rule` | Column is `numbering` |
| `TECHNICAL.md` | Nineteen end to end flows in the CI table | The table lists flows 1 to 40 |
| Hardening 1 and Schema fixes specs | Refer to `Fintran schema.md` and `Qula Plus functionality, schema and APIs.md` | Neither file is in the repository. `TECHNICAL.md` and this document replace them |
| `specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md` | "Nothing in it is built" | It is built (A3.4) |

## A3. The five repository specs

### A3.1 Payments and receipts (6)

Built in three releases. Release A is bank accounts. Release B is payments, allocations, settlement and the removal of the typed paid amount. Release C is printing, Ask Qula and Worth a look. It is applied to the hosted project. The hosted project held no typed paid amounts (0 of 10 documents), so the data migration changed nothing there.

Open (from the reference document): allocating to a void document is not tested, the "money on account" filter has no test, readiness against stored e-documents after an allocation is not tested, the hidden migrated types in the menu are not tested, "who owes us the most" has not run against real data, an eight day old receipt in Worth a look is unit tested only, an imported e-invoice with an amount paid has no end to end flow and the release migration was never run against a copy of the live project.

**The most important caveat in the whole project:** nobody has used payments in a browser. Four end to end flows (3, 5, 6 and 12) each lost a click once. The cause was never confirmed. The manual script is `docs/payments-test-script.md`.

### A3.2 Hardening 2 (7)

| Phase | State |
| --- | --- |
| 1 Spreadsheet safety | Done. One helper per format, a test that searches the source for bypasses |
| 2 Ask Qula actions | Done. Off by default, single-use signed tokens, ten minute expiry, refused if the document changed |
| 3 Stored questions and answers | Done. Opt-in with a notice, 30 days by default, purged by `pg_cron` |
| 4 Order quantity rules | Done. Invoiced, Reserved, Left |
| 5 Peppol order references | Done, with golden files |
| 6 Save before acting | Done. Two boxes have no test: a failed save and Create invoice with unsaved edits |
| 7 End to end tests | Done. 40 flows now |
| 8 Document screen split | Done. Leftovers: default title "Purchase Invoices" and form id `purchase-document` |

Six boxes remain open: the two in phase 6, the two that refer to a status document that does not exist (one in phase 7 and one in "Done when"), the dry run against a copy of the live project and the box that all acceptance tests pass, which waits on the others.

### A3.3 Purchase approvals and price tolerance (8)

Built and applied. Rules by transaction type and amount in the home currency, a role ladder, a fingerprint that cancels an approval when the document changes, a gate in `post_document` and in order activation, price tolerance against order lines, Worth a look and home count, approval emails behind a mock adapter. Six acceptance boxes are still open because no test proves them.

### A3.4 Payment approvals, supplier bank details and payment runs (9)

Built: supplier IBAN, BIC and account name with a change history, a bank change window, approval for money out payments (the requester can never approve), payment runs approved and posted as a whole, flows 28 to 34. **The spec file was never updated.** Its first line still says nothing is built and 40 boxes are unticked. Anyone reading it alone would conclude the wrong thing.

### A3.5 Journal export (10)

Built and applied to the hosted project on 19 and 20 November. Seven mapped accounts (including the suspense account added later), immutable numbered batches, reversals built from the exported lines, a generic CSV. Ten acceptance boxes are open.

## A4. Work done without a spec, or beyond one

| Area | What was built | Where it is described |
| --- | --- | --- |
| Orders and requisitions | A full lifecycle (draft, active, closed, cancelled), conversion to invoices, line level quantity limits, automatic close and reopen, credit notes that return quantity, sales order and customer order references | C6 |
| Ask Qula | An assistant with two modes, read-only tools, charts, confirmed actions, usage logging, retention and rating | C13 |
| Worth a look | Rule-based home card, 18 rules | C11 |
| Aged debtors and creditors | Two reports (the reference lists these as a built item, with no spec) | C12 |
| Access Point | Settings, secrets, test and participant lookup, mock adapter only | C14 |
| Email outbox | Queued approval emails, adapter, mock only | C9 |
| Transaction type codes | Three character scheme and renames, legacy URL redirects | B5 |
| Navigation | A Back model based on a recorded history, menu highlighting | C15 |
| Grids | Search, sort, paging, Excel and CSV export, grid lines, field picker | C15 |
| Dates and spelling | Browser-region dates, British English spell checker | C15 |
| Party summary | Panel beside customer and supplier forms with ageing and e-invoice checks | C5 |
| Form designer for payments | Own field lists and a database check | C10 |
| Design system | Tokens, navy chrome, fixed layouts, fonts | E3 |
| Product rename | FinTran to Qula Plus on screen, FinTran identifiers kept internally | E1 |
| Baseline squash | 84 migrations replaced by one baseline on 12 November | D1 |
| CI | Five checks, a docs checker, pinned CLI | F1 |
| Organisation settings tabs | Ask Qula, Access Point and Accounting moved into the organisation edit | C15 |

---

# Part B. Product description

## B1. What Qula Plus is

A multi-company accounts payable and receivable tool for businesses in Ireland and the EU. It records purchase and sales documents, applies payments to them, produces and checks EN 16931 e-invoices (Peppol BIS Billing 3.0), exports journals to a customer's own accounting system and answers questions through an assistant called Ask Qula.

It keeps no ledger and moves no money. It does not send e-invoices over the Peppol network. The app is Next.js, React and TypeScript. It talks to Supabase as the signed-in person and never uses a service-role key, so row level security decides what anyone can see. Postgres holds the business rules, so a rule holds however a row is changed.

The live database is the Supabase project `hxueqzgdwlaschcvwdke`. The repository, package and project keep the old name FinTran.

## B2. Roles

One person has one role per organisation. People are never created in the app: someone signs up, then an owner or admin grants them access by email.

| Capability | Member | Admin | Owner |
| --- | --- | --- | --- |
| Read everything in the organisation | Yes | Yes | Yes |
| Create, edit and delete customers, suppliers and draft documents | Yes | Yes | Yes |
| Post documents, record and post payments, allocate, remove an allocation, apply a credit note | Yes | Yes | Yes |
| Upload and import e-documents, regenerate an outbound one | Yes | Yes | Yes |
| Request approval | Yes | Yes | Yes |
| Void a posted purchase, void a payment, reject an e-document, release a duplicate | No | Yes | Yes |
| Change setup lists, forms, defaults, logo, lock date, approval rules, accounting accounts | Read only | Yes | Yes |
| Approve (admin level rules) | No | Yes | Yes |
| Approve (owner level rules) | No | No | Yes |
| Download EN 16931 JSON, read change history, Ask Qula and Access Point settings | No | Yes | Yes |
| Preview and export journals | No | Yes | Yes |
| Grant or revoke `member` | No | Yes | Yes |
| Grant or revoke `owner` or `admin`, create an organisation, delete an organisation with no documents | No | No | Yes |

An organisation always keeps at least one owner, enforced by a trigger as well as in the functions. Granting to an unknown email and to a known email the caller may not grant return the same message, so the API does not reveal who is registered.

## B3. Screens

| Area | Screens |
| --- | --- |
| Main menu | Home, Transactions, Customers, Suppliers, E-documents, Reports, Admin |
| Transactions | One tile per transaction type with draft, posted and void counts. Each opens a document list or a payment list. Payment runs sits here |
| Reports | Aged debtors, Aged creditors |
| Admin | GL codes, Departments, Cost centres, VAT rates, Currencies, Bank accounts, Products, Transaction types, Forms, Approval rules, Organisations, Access, Change history, Journal export |
| Organisation edit | Details, Ask Qula, Access Point and Accounting tabs (the last three for owners and admins only) |
| Title bar | Back, page title, Ask Qula sparkle button. The chat slides in from the right |
| Outside the shell | `/print/{code}/{id}` for printed documents and payments, `/login`, `/signup` |

---

# Part C. Functional description

## C1. Tenants and organisations

A tenant owns organisations. `create_tenant` makes the tenant, its first organisation, a home currency at rate 1, the defaults row and owner access in one transaction. `create_organisation` does the same inside a tenant where the caller is an owner. The open organisation is kept in the cookie `fintran-organisation`. If the cookie names an organisation the person cannot open, the app opens their first one. An organisation can be deleted by an owner when it has no documents and is not the last in its tenant. A tenant can only be deleted by a database administrator, and only when it holds no documents.

## C2. Organisation setup

- **Defaults:** home currency (required, rate 1, fixed once documents exist), structured address, contact details, VAT number, company number, Peppol scheme and ID (unique across all tenants, compared in lower case), IBAN, BIC, bank account name, printed banking text, logo (PNG, JPEG, WebP or GIF up to 2 MB in a private bucket).
- **Lock date:** blocks creating, editing, posting, voiding and deleting a document dated on or before it. Orders and requisitions are exempt. Allocations respect it.
- **Price tolerance** and its approval switch, **approval email** switch, **bank change window** (1 to 90 days), default inbound invoice and credit note types for e-invoice import.
- **Codes are fixed.** Every master code is chosen at creation. Postgres rejects a rename. The app omits the code from updates.

## C3. Setup lists

| List | Rules that matter |
| --- | --- |
| GL codes | Type is Fixed Asset, Current Liability, Current Asset, Income or Expense. A product's purchase GL must be Expense and its sales GL Income. A type cannot change while a product uses it |
| Departments, cost centres | Code and description |
| VAT rates | `Sales` or `Expense` type, an EN 16931 category with its zero-rate and exemption rules, a rate from 0 to 100. A rate or category used on a posted line cannot change |
| Currencies | An ISO code linked to `ref_currencies`, a rate (units per one home unit, up to 8 decimals). Home rate is 1 and fixed |
| Bank accounts | The organisation's own accounts: validated IBAN, optional BIC, currency, optional Current Asset GL code, one default per currency |
| Products | Purchase and sales prices (4 decimals), purchase and sales GL and VAT, unit |
| Transaction types | Direction, kind, number prefix and padding, up to five flex labels. See C4 |

## C4. Transaction types

A type has a direction (`Sales` or `Purchases`) and a kind: invoice, credit note, order, requisition, payment or receipt. Kind cannot change once something has been entered. Codes have three characters: `S` or `P`, then `RQ`, `OR`, `IN`, `CN`, `RC`, `PY` or `RF`. The standard set is `PRQ`, `POR`, `PIN`, `PCN`, `SOR`, `SIN`, `SCN`, `SRC`, `PPY`, `SRF` and `PRF`. The app never reads a code to decide what a type is. Four hidden system types (`SMR`, `PMP`, `SMF`, `PMF`) hold migrated typed paid amounts.

**Numbering.** `last_reference` moves forward by one and is never given back. Purchases number when the draft is saved. A type set to `on_post`, which every Sales type must be, numbers when the document posts. The type row is locked first and sales readiness is checked before the number is taken, so a failed post uses no number. The printed `document_number` is the prefix plus the zero-padded reference, stored once and kept if the prefix later changes.

## C5. Customers and suppliers

Same shape for both: name, currency (required, becomes the document currency), phone, email, website, structured address, VAT number, company number, Peppol scheme and ID (unique per organisation within each table), contact details, notes, payment terms in days. Customers also hold a default buyer reference. Suppliers also hold IBAN, BIC and account name with a change history readable by owners and admins, shown with the IBAN shortened.

A summary panel beside the form shows what they owe or are owed, money on account, active orders and the six latest documents. It also shows an e-invoicing check: for a customer, name, postal address and Peppol ID are required because a sales e-invoice is refused without them.

## C6. Documents

One entry screen serves every direction. The layout is a status row, then Document, Notes and Payment terms tabs, with header and totals on the left and the line grid on the right. A posted invoice or credit note gains Receipts, Payments or Applied.

| Kind | Lifecycle |
| --- | --- |
| Invoice, credit note | Draft, posted, void |
| Order, requisition | Draft, active (stored as `open`), closed, cancelled |

**Saving.** `save_document(jsonb)` is security invoker. It checks the organisation, party, currency and codes, copies blank product fields by direction, replaces the lines and lets triggers calculate amounts. A new sales draft fills a blank buyer reference, due date and payment terms from the customer. A button that posts, activates, closes or creates another document saves unsaved changes first and then acts. A failed save stops the action.

**Calculation.** Line nett is `round(quantity × price − discount, 2)`. Document VAT is one breakdown row per category and rate: taxable amount × rate ÷ 100, rounded to 2 decimals. Header VAT is the sum of those rows, total is nett plus VAT, home amounts are the foreign figure divided by the exchange rate. All money is `numeric(18,2)`. Prices and quantities keep 4 decimals. Rates keep 8. A discount or paid amount with more than 2 decimals is refused, not rounded.

**Posting.** Any member can post, subject to approvals (C8). Needs at least one line. A sales document also needs an Income GL code on every line, a date not more than a day ahead and a clean readiness result. Posting copies the organisation and the party into `issuer_snapshot` and `party_snapshot`, copies the logo to `{organisation_id}/snapshots/{header_id}`, and sets payment means `58` on a sales document when the organisation has an IBAN. A posted document keeps those copies for ever.

**Voiding.** Owners and admins may void a posted purchase document with a reason. A posted sales document cannot be voided: the correction is a credit note. A document with an effective allocation cannot be voided until the allocation is removed.

**Credit notes.** A credit note names the invoice it applies to. A sales credit note created from an invoice copies its lines. Posted credits against an invoice cannot exceed its total, checked with the invoice row locked. Posting applies the credit note to its invoice up to what is open. A credit note line may be marked Return to order to give quantity back.

**Other rules.** The same supplier invoice number cannot be entered twice for a supplier unless the first is void. Line VAT must match the direction. A line carries a product, GL code, department, cost centre, unit, discount, note and flex values.

## C7. Orders and requisitions

A requisition becomes a purchase order and an order becomes one or more invoices. Each new line stores its source line. An invoice may draw on several orders of one party. Each order line shows Invoiced (posted invoice quantity less returned quantity), Reserved (quantity on drafts) and Left, computed in `private.order_line_used` and exposed in the view `order_line_usage`. The source line is locked during the check so two people cannot take the last unit. An order closes by itself when posted invoices cover every line and reopens when an invoice is voided or a returning credit note posts. An order closed by hand stays closed and Worth a look reports it. Orders and requisitions are outside the period lock and are never exported as e-invoices.

## C8. Approvals

Off until an owner or admin sets a rule. Rules sit on a purchase invoice type, a purchase order type or a money-out payment type, with an amount in the home currency and a required role of `admin` or `owner`. Several rules on a type form a ladder. A request is made with `request_approval`, decided with `approve_document` or `reject_document` (a refusal needs a reason) and held back by `private.require_approval`, called from `post_document` and `set_order_status`. Every route to posting passes through it: the button, save and post, Ask Qula's confirmed post and imported drafts.

Documents: the requester cannot approve unless nobody else could (`approval_self` is recorded). Payments and runs: the requester can never approve. A fingerprint (`approval_hash`) of the document or payment and its lines or planned allocations is stored at request time. Any change makes the approval stop counting. Price tolerance flags an invoice line priced above its order line by more than the set percentage, and can force approval.

## C9. Email

Approval emails are queued in `email_outbox` by the functions and handed to an adapter in `src/lib/email/`. The only adapter is a mock that marks every email sent and delivers nothing. A failure never blocks an approval or posting. Failed emails are listed on the Approval rules screen.

## C10. Payments, settlement and payment runs

Four kinds of money record: customer receipt (`SRC`), supplier payment (`PPY`), customer refund (`SRF`) and supplier refund (`PRF`). They live in `payments`, never in `transaction_headers`.

**Allocations** apply money to documents: a receipt to a sales invoice, a payment to a purchase invoice, a refund to a credit note and a credit note to an invoice. Same party, same currency, same organisation. Over-allocation is refused. Each allocation records home amounts at both rates and an `exchange_difference`. An allocation is never edited once effective. A removal keeps who removed it and why. A draft payment holds pending allocations that take effect when it posts and are checked again then.

**Settlement.** `private.refresh_settlement` is the only writer of `paid_amount`, `amount_due` and `home_amount_due`. Nobody types a paid amount. `post_document` fixes `paid_at_posting` so a generated e-invoice never changes.

**Payment runs.** A run has one payment type, bank account, currency and date and a number such as `RUN-0001`. Creating one makes a draft payment per supplier allocating the full amount open on each chosen invoice. The run is approved as a whole against its home total, and also by an admin or owner whenever any supplier's bank details changed inside the window. A payment inside a run cannot be posted alone. Posting the run posts every payment or none. There is no bank file: the money is paid outside Qula Plus. The run exports to Excel with each supplier's IBAN.

Not supported: payments across currencies, write-offs, bank charges.

## C11. Home page and Worth a look

The home page shows document counts, documents posted in the last six weeks, shortcuts, the five latest changes for owners and admins, the number of approvals waiting for the person and the Worth a look card. The card uses fixed rules and no AI. The rules cover:

past due, part paid and past due, money on account over 7 days, likely match, not ready for e-invoicing (newest 10 drafts), possible duplicates, unusually large (over three times the party's usual), due within 7 days, orders to invoice, orders to close, closed orders with quantity left, drafts holding order quantity over 14 days, approvals waiting, own documents refused and the payment equivalents. A credit note is never reported overdue.

## C12. Reports and journal export

**Aged debtors and creditors:** by party in the home currency, in five bands aged from the due date or the transaction date (a choice on the page). Credit notes and unapplied money are taken off. Balances are current. Moving the date moves amounts between bands and does not rewind payments. Totals at the top and in the grid. Only the first 5,000 documents are read, and the page says so. There is an Excel export.

**Journal export** (owners and admins). An Accounting tab maps receivables, payables, VAT on sales, VAT on purchases, exchange gain or loss, rounding and suspense, plus an optional start date. The preview shows what is not yet exported up to a date and lists blocking problems with links. A journal with any problem is held back whole. Create batch makes an immutable batch `JB-0001`, journals `JB-0001-0007`, with the lines as made. Download gives a UTF-8 CSV with a byte order mark and formula-safe text. A document or payment voided after export is reversed by a journal made from the exported lines turned round with the same accounts, dated on the void date. Removing an allocation reverses its exchange difference the same way. A posted purchase line with no GL code goes to the suspense account with ` (no GL code)` on its description. Lock date does not stop export. Not built: Xero, Sage and QuickBooks layouts, live connectors, an account per VAT rate.

## C13. E-invoicing

**Business terms.** `en16931_document(header_id)` returns a document as EN 16931 terms keyed `BT-n` and `BG-n`, with amounts as two decimal strings and prices at four. Posted documents read parties from snapshots. Purchases use the supplier invoice number as BT-1 and sales use `document_number`. A line discount is an allowance with reason code `95`. Orders raise an error. Security invoker, so row level security applies.

**Readiness.** `en16931_readiness` returns `error` or `warning` rows with a rule id, business term and message. A readiness button turns red, orange or green and opens the gaps with plain English fixes from `rule-help.ts`. Sales errors block posting. Purchase gaps do not.

**Outbound.** After a sales post, the app calls `POST /api/einvoice/outbound/{headerId}`. The server builds UBL 2.1 (Invoice for 380, CreditNote for 381), validates against the UBL XSD, then the CEN EN 16931 and Peppol BIS 3.0.21 Schematron, signs an envelope and stores the file with its SHA-256. If generation fails the document stays posted and a Regenerate button appears until a valid file exists.

**Inbound.** A UBL file is uploaded on the E-documents screen. A file with a DOCTYPE, external entity, CII root or non-UBL root is refused before parsing. It is stored only when the buyer Peppol ID (or buyer VAT number when the organisation has no Peppol ID) matches. An identical file is not stored twice. A different file with the same seller and number becomes a duplicate. A valid file can be reviewed and imported as a purchase draft: supplier matched by Peppol ID then VAT number, each line's VAT mapped to an Expense rate of the same category and percentage, GL, department and cost centre pre-filled from the last import of that supplier and item. The seller IBAN is shown, with a warning if it changed since the last import, and is never written to the supplier. A file carrying document-level or line allowances or charges is stored but cannot be imported. A draft linked to an inbound file cannot be posted while its nett, VAT or total differs from the file's BT-109, BT-110 or BT-112.

A supplier-stated paid amount (BT-113) is shown as a notice and never allocated.

## C14. Access Point (stand-in)

A screen for provider, environment, secret storage, test connection, participant lookup and registration. The provider table has one row: `mock`, for sandbox and production. The mock always succeeds. No e-invoice is sent to anyone. The adapter interface has `send` and webhook methods ready. No provider has been chosen.

## C15. Ask Qula, printing, grids and navigation

**Ask Qula.** With AI off, a fixed set of keyword questions is answered from the organisation's transactions, e-documents and overdue invoices. With AI on, the question goes to the organisation's chosen provider (Anthropic, OpenAI, Azure OpenAI, an OpenAI-compatible endpoint or a scripted mock) with read-only tools and streams the answer. Tools cover transactions, ageing, totals by period, top parties, VAT by rate, open orders, payments, parties, products, change history (owners and admins), e-documents, readiness, rule explanations and help. Tables are built by the server and not by the model. Actions are off by default and need an owner or admin to switch them on: post a draft, or add a customer or supplier. The model only proposes. A card built from database figures appears. Confirm sends a signed single-use token valid for ten minutes. The confirmation is refused if the document changed. A draft with a readiness error cannot be confirmed, and neither can one that needs approval. Ratings are kept. Question and answer text is kept only if an owner or admin switches that on and accepts a notice, for 30 days unless set between 1 and 365. A job purges the text. Usage (tokens, tool calls, outcome) is logged without the text. Provider keys are stored as AES-256-GCM ciphertext and the API cannot read them back. Help text covers only Ask Qula itself.

**Printing.** Every document prints from its saved layout or the standard one. Print opens the browser dialog. PDF downloads the same page at A4, A5, Letter or Legal. Drafts print with DRAFT. Void documents print with VOID. Posted documents print only from snapshots. A payment prints as a remittance advice (money out) or a receipt (money in) from live organisation and party data, because payments keep no snapshot.

**Form designer.** Chooses title, page size, logo, VAT summary, banking block and which organisation, party, header and line fields appear. The database validates a saved layout (8,000 characters maximum). Sales forms must keep the mandatory particulars. A payment type has its own field lists and required fields.

**Grids.** Every list is a grid with search, sorting, paging, a rows per page menu, a grid lines button and Excel and CSV export of all matching rows with a field picker. Exports go through one helper that neutralises cells starting with `=`, `+`, `-` or `@`. Dates show as 18 Oct 2026 with the browser's region deciding order.

**Navigation.** Back returns to where the person came from, using a per-tab record of screens. Filters return. One-off signals do not. Opened by address, Back goes to the screen's parent. The sidebar highlights the item a screen sits under.

---

# Part D. Design decisions

## D0. Decision register

| Spec | Decisions |
| --- | --- |
| Hardening 1 | D1 numbering per type (purchases on insert, sales on post). D2 any member posts, owner or admin voids. D3 owners of an organisation in a tenant may create organisations. D4 owners manage every role, admins grant and revoke `member` only. D5 owner and admin change setup. D6 code format `[A-Z0-9][A-Z0-9.-]*`. D7 party VAT number added |
| EN 16931 | E1 VAT per breakdown. E2 amounts at 2 decimals, half away from zero. E3 credit notes are positive documents, sign applied in reporting. E4 enforce at posting for sales, warn for purchases. E5 default country `IE`. E6 address migration by line split with review flag. E7 payment means `58` when an IBAN exists |
| Sales | S1 one save function. S2 sales cannot be voided. S3 credit note limit. S4 Income GL code at posting. S5 currency from the customer. S6 prefix and padding on the printed number |
| Schema fixes | F1 organisation Peppol ID unique globally. F2 `posted_by` not required. F3 discount at 2 decimals. F4 home currency required at creation. F5 home currency fixed once documents exist |
| E-documents | G1 XML in Postgres, not Storage. G2 4 MB limit. G3 SaxonJS plus xmllint-wasm behind one interface. G4 HMAC envelope keyed from Vault. G5 outbound generated after posting. G6 UBL only. G7 allowances and charges block import. G8 addressing rule. G9 inbound types in organisation settings. G10 totals guard |
| Payments | Allocations are the only writer of paid amounts. Posting and settlement as in C10. Types with kinds `payment` and `receipt` |
| Hardening 2 | J1 formula-safe exports. J2 Ask Qula actions off by default. J3 single-use tokens |
| Approvals | A1 purchase invoices and orders only. A5 by role. A6 requester cannot approve unless nobody else could. A11 only a higher price counts. A13 one tolerance for the organisation |
| Payment approvals | B1 money out only. B2 posting is held back. B3 same rules table. B5 fingerprint |
| Journal export | J1 to J14 as in C12. J4 control accounts. J5 two VAT accounts |

## D1. Principles that explain most choices

1. **Postgres holds the rules.** Constraints, triggers, policies and functions enforce everything, so a bug in the app cannot break an invariant. The app repeats checks only for better messages.
2. **The user's session, always.** No service-role key. Where a write needs more than the user's rights, a security definer function checks the role itself.
3. **Immutable once real.** Codes after creation. Posted documents and their snapshots. Stored e-documents. Journal batches. Effective allocations. Audit rows. Each is protected by a trigger, a constraint or a missing privilege.
4. **One source for each derived number.** Paid and due amounts come from `refresh_settlement`. Order usage comes from `order_line_used`. Totals come from triggers. The app never computes what the database stores.
5. **Fail closed.** AI actions off by default. Approvals off until configured. Members read setup, not edit it. Unknown email and forbidden grant give one message.
6. **No ledger.** Accounting stays in the customer's system. Journal export is the route in.

## D2. Notable design choices and their reasons

| Choice | Reason |
| --- | --- |
| Composite foreign keys `(organisation_id, id)` | A row can never reference another organisation's data, whatever the app does |
| Snapshots at posting | A posted document reproduces exactly what was sent. Later edits to a party never change history |
| Document VAT from the breakdown | EN 16931 validates VAT per category and rate, not per line |
| Sales documents cannot be voided | A numbered, legally issued invoice is corrected only by a credit note |
| Sales number issued at posting, after readiness | No gaps. A failed post consumes nothing |
| XML in Postgres with a signed envelope | A member could replace a Storage object with their own session. Postgres can hash and verify |
| Allocation records exchange difference | The accounting export needs it and the value is fixed at allocation time |
| Reversals copy exported lines | Changing an account mapping later must not redirect a reversal |
| Fingerprint approvals | An approval applies to one version of one document |
| Payment requester can never approve | Stricter than documents because money leaves the business |
| Tolerances compare after-discount unit price | Matches how an order line is actually priced |
| Validator behind one interface | A Java service could replace SaxonJS later |

---

# Part E. Application architecture

## E1. Runtime and naming

| Piece | Role |
| --- | --- |
| Next.js 16 App Router | Pages, server actions, route handlers. `src/proxy.ts` is the session gate. The agent notes warn that this is not the Next.js of older releases. The docs in `node_modules/next/dist/docs/` are the reference |
| React 19, TypeScript | Client forms, title bar, Ask Qula. `src/lib/database.types.ts` is generator output, and `npm run db:types` fails if it stops matching the migrations |
| CSS modules | All styling on tokens in `src/app/globals.css`. No Tailwind, no component library |
| Supabase Auth, Postgres, Storage, Vault, pg_cron | Sign-in, rules, logo bucket `organisation-logos`, HMAC key, hourly purge job |
| Vercel | Region `lhr1`. E-invoice routes run with 1 GB memory and a 60 second limit |
| Libraries | `fast-xml-parser`, `xmllint-wasm`, `saxon-js` (with `xslt3` to compile SEF files), `fflate` for XLSX, `jspdf` and `html2canvas` for PDF, `nspell` with `dictionary-en-gb` |

Internal identifiers that keep the old name: cookie `fintran-organisation`, session and local storage keys `fintran.*`, Postgres settings `fintran.status_change`, `fintran.home_currency`, `fintran.deleting_organisation`, `fintran.settlement`, `fintran.run_post`, `fintran.audit_reason`, readiness rule ids `FINTRAN-*`, test emails `@fintran.test`. Changing the Postgres settings means changing triggers and the settings they read together in one migration.

## E2. Source layout

| Path | Contents |
| --- | --- |
| `src/app/(app)/` | Authenticated pages (transactions, customers, suppliers, e-documents, reports, admin lists, organisations, access, history, journal export, payment runs, forms, approval rules, bank accounts) |
| `src/app/api/` | `einvoice/inbound`, `einvoice/outbound/[headerId]`, `einvoice/[id]/xml`, `ask-qula`, `ask-qula/action`, `ask-qula/feedback`, `spelling-dictionary` |
| `src/app/print/[code]/[id]/` | Printable page, outside the shell |
| `src/components/` | Managers (list plus form) per entity, `document/` panels, `payment/`, `import-einvoice/`, `org-settings/`, `ask-qula/`, shared pieces and CSS modules |
| `src/lib/` | 110 modules: server actions (`*-actions.ts`), data readers (`*-data.ts`), pure rules with tests, `einvoice/` (ubl, validate, xsd, xml, store, envelope, canonical, semantic-read, rule-help), `ai/`, `export/`, `email/`, `supabase/` |
| `einvoice/` | `rules/3.0.21` (SEF files, XSD, manifest, conformance), `examples`, `fixtures` (golden UBL) |
| `supabase/` | `migrations` (baseline plus 20), `migrations_archive` (84, unused), `tests` (SQL and concurrency), `seed/e2e.sql`, `config.toml` |
| `e2e/` | 13 Playwright spec files, helpers and sample files |
| `specs/`, `docs/` | Specs and documents |

About 41,000 lines of TypeScript and TSX in `src`.

## E3. UI system

Navy sidebar and title bar, light grey work area, white panels, 8 px corners, one blue accent. Every colour, radius, size, space and shadow is a token in `globals.css`. Fonts: Public Sans for body, Plus Jakarta Sans for titles, IBM Plex Mono for codes, references and amounts. Buttons on navy use one outline spec in `ChromeControl.module.css`. Muted text keeps 4.5 to 1 contrast on white. Icons come from one file. Deleting asks first through one dialog component and never `window.confirm`.

Layout rules: the document screen is the only transaction layout. Record forms use two columns on a shared grid, no section headings and no placeholder text, widths that follow the value, tab order down the left and then the right, and every single line control 36 px high. A page title has at most one line of description and no shortcut links. Forms that can fail keep the person's entries (`keepEntries`).

## E4. Data loading and server actions

A page starts its data read at the same time as the workspace load (`getOrganisationScope`, `forOrganisation`), then awaits the workspace to check sign-in. Links to row pages use `prefetch`. Server actions return `{ error }` or `{ message }` or redirect, and call the database functions with the user's session. Document actions: `saveDocument`, `postDocument`, `voidDocument`, `createCreditNote`, `deleteDocument`, `createFromOrder`, `setOrderStatus`. Payment, payment run, approval, journal, bank account, party, product, transaction type, currency, form and settings actions follow the same pattern, one module per area.

## E5. E-invoice pipeline

```text
Sales post
  → POST /api/einvoice/outbound/{headerId}  (Node runtime, user session)
      en16931_document → generateUbl → XSD (xmllint-wasm) → Schematron EN + Peppol (SaxonJS SEF)
      → canonical JSON + HMAC envelope → store_e_document (Postgres)
          verifies member, signature, age under 10 minutes, SHA-256, size, outbound semantic equals en16931_document

Upload
  → POST /api/einvoice/inbound
      size, well-formed, no DOCTYPE, UBL root → XSD → Schematron → parseUbl → envelope → store_e_document
          addressing check, duplicate rule → valid or invalid or duplicate
  → import screen → import_e_document (builds payload from stored semantic only) → save_document
```

Generation and parsing are pure functions with no database access. The signing key is in Vault as `einvoice_hmac_k1` and in the host as `EINVOICE_HMAC_KEY` with `EINVOICE_HMAC_KEY_ID`. Rotation: add `k2` to Vault, switch the host, remove `k1` after a day. Canonical JSON is implemented identically in TypeScript and SQL and tested against shared fixtures. Next.js is configured to keep `xmllint-wasm` and `saxon-js` external and to include the SEF and XSD files in the traced routes.

---

# Part F. Database structure

## F1. Migrations

The schema is `supabase/migrations`, applied in filename order. `20261112101106_baseline.sql` (13,723 lines) replaces 84 earlier files, because those could not rebuild the database from empty: five patched `save_document` by matching its text, and four e-document migrations were applied live without their SQL being recorded. The baseline was fingerprint-matched to the live project. Later files:

| File | Content |
| --- | --- |
| `20261112110728_revoke_private_function_execute` | Revokes execute on private functions |
| `20261113103237_bank_accounts` | Bank accounts and a `MAIN` account per organisation |
| `20261113123253` to `20261113125349` | Payment kinds, `payments`, settlement columns, `allocations`, allocation documents |
| `20261113125722_payment_functions` | Save, post, void, delete, allocate, remove |
| `20261113130052_remove_typed_paid_amount` | Migrates typed paid amounts into payments and allocations |
| `20261113130201_allocate_lines` | Multi-document allocation |
| `20261113184039`, `20261117093738` | Three character type codes, migrated type codes |
| `20261117150118_payment_form_layouts` | Payment branch in form validation |
| `20261119072337_approvals` | Rules, header approval columns, outbox, tolerance |
| `20261119123844_supplier_bank_details` | Supplier bank fields and history |
| `20261119124618_payment_approvals` | Payment approval columns and gate |
| `20261119131003_payment_runs` | Payment runs |
| `20261119180342_journal_export` | Accounting settings, batches, journals |
| `20261120094437_journal_suspense` | Suspense account |
| `20261120095838_journal_reversals` | Reversals. Stops if an earlier batch exists |

## F2. Tables

49 public tables and one view (`order_line_usage`), counted from the migrations.

| Group | Tables |
| --- | --- |
| People and access | `tenants`, `organisations`, `profiles`, `organisation_access` |
| Setup | `organisation_defaults`, `currencies`, `bank_accounts`, `gl_codes`, `departments`, `cost_centres`, `vat_rates`, `products`, `customers`, `suppliers`, `supplier_bank_changes`, `transaction_types`, `transaction_forms`, `approval_rules`, `accounting_settings` |
| Documents | `transaction_headers`, `transaction_lines`, `transaction_vat_breakdown` |
| Money | `payments`, `allocations`, `payment_runs` |
| E-documents | `e_documents`, `e_document_contents`, `e_document_validation_results`, `e_document_events` |
| Journal | `journal_batches`, `journal_batch_lines`, `journal_exports` |
| Reference lists | `ref_countries`, `ref_currencies`, `ref_units`, `ref_vat_categories`, `ref_vatex`, `ref_payment_means`, `ref_eas` |
| Ask Qula and Access Point | `ai_providers`, `ai_settings`, `ai_usage`, `ai_feedback`, `ai_actions`, `access_point_providers`, `access_point_settings`, `organisation_secrets` |
| Cross-cutting | `audit_log`, `email_outbox` |

Almost every business table carries `tenant_id`, `organisation_id` and the four audit columns. A trigger checks the organisation belongs to the tenant and blocks moving a row between organisations.

## F3. Enums

| Enum | Values |
| --- | --- |
| `document_kind` | `invoice`, `credit_note`, `order`, `requisition`, `payment`, `receipt` |
| `document_status` | `draft`, `posted`, `void`, `open`, `closed`, `cancelled` |
| `numbering_rule` | `on_insert`, `on_post` |
| `e_document_direction` | `outbound`, `inbound` |
| `e_document_status` | `generated`, `received`, `invalid`, `valid`, `duplicate`, `imported`, `rejected` |

## F4. Documents, in detail

**`transaction_headers`.** Type (fixed), `reference`, `document_number`, dates, party columns, `party_name`, currency and exchange rate, order and supplier references, preceding invoice link, EN 16931 header terms, nine amount columns, `paid_amount`, `home_amount_due`, `paid_at_posting`, `supplier_stated_paid_amount`, status and posting columns, snapshots, `closed_by_system`, approval columns, flex fields.

Table constraints on status: posted and void rows must have a document number, both snapshots and `posted_at` (`transaction_headers_posted_complete`). A draft carries none of that (`transaction_headers_draft_clean`). A void row has `voided_at` and `void_reason` and only a void row has them (`transaction_headers_void_complete`).

**`transaction_lines`.** Line number, source and credited line references, `returns_to_order`, product, description, unit, note, seller item id, GL, department, cost centre, VAT rate with copied `vat_percentage`, category and exemption, quantity, price, discount, `nett_amount`, `vat_amount`, order line reference.

**`transaction_vat_breakdown`.** One row per header, category and rate. Written only by the totals trigger.

## F5. Money tables

**`payments`.** Type, number, status (`draft`, `posted`, `void`), source (`manual` or `migrated`), date, one party, bank account, currency, rate, amount, home amount, allocated and unallocated figures, means, bank reference, approval columns and `payment_run_id`.

**`allocations`.** Source (a payment or a credit note) and target (an invoice or a credit note), amount, home amounts, `exchange_difference`, `pending`, removal data. People cannot write it. `private.enforce_allocation` checks every rule.

**`payment_runs`.** Type, bank account, currency, date, number, status (`draft`, `posted`, `cancelled`), approval columns and who posted it. A run stores no total.

## F6. Functions

The baseline holds 113 function bodies across `public` and `private`. Later migrations add many more and replace some. The API-facing `public` functions are:

| Area | Functions |
| --- | --- |
| Tenant and access | `create_tenant`, `create_organisation`, `rename_organisation`, `delete_organisation`, `grant_organisation_access`, `revoke_organisation_access` |
| Documents | `save_document`, `post_document`, `void_document`, `set_order_status`, `create_from_order` |
| Approvals | `request_approval`, `approve_document`, `reject_document`, `approval_status`, `approval_queue`, `price_checks`, `queued_emails`, `record_email_result` |
| Payments | `save_payment`, `post_payment`, `void_payment`, `delete_payment`, `allocate`, `allocate_lines`, `allocate_oldest_first`, `remove_allocation`, `replace_pending_allocations` |
| Payment approvals and runs | `request_payment_approval`, `approve_payment`, `reject_payment`, `payment_approval_status`, `queued_payment_emails`, `create_payment_run`, `remove_run_payment`, `cancel_payment_run`, `request_run_approval`, `approve_run`, `reject_run`, `payment_run_approval_status`, `post_payment_run`, `queued_run_emails` |
| EN 16931 | `en16931_document`, `en16931_readiness`, `en16931_source`, `en16931_amount`, `en16931_price` |
| E-documents | `store_e_document`, `e_document_xml`, `import_e_document`, `reject_e_document`, `release_duplicate_e_document` |
| Journal | `journal_preview`, `journal_problems`, `create_journal_batch`, `journal_batch_lines_for` |
| Secrets and AI | `set_organisation_secret`, `clear_organisation_secret`, `organisation_secret_status`, `organisation_secret_ciphertext`, `record_ai_usage`, `ai_usage_allowance`, `record_ai_feedback`, `propose_ai_action`, `confirm_ai_action`, `finish_ai_action` |

`save_document`, `save_payment`, `en16931_document` and `en16931_readiness` run as the caller (security invoker). Security definer functions set `search_path` to empty, are revoked from `public` and `anon`, and live in `private` unless the API calls them. `replace_pending_allocations` is in `public` because `save_payment` runs with the caller's rights and cannot reach `private`.

Important `private` functions: `is_org_member`, `org_role`, `has_org_role`, `set_audit_columns`, `write_audit_log`, `issue_reference`, `enforce_document_status`, `refresh_settlement`, `order_line_used`, `sync_order_closure`, `require_approval`, `require_payment_approval`, `require_run_approval`, `approval_hash`, `journal_lines`, `validate_form_layout`, `iban_is_valid`, `prepare_peppol`, `enforce_home_currency`, `purge_ai_feedback_text`.

## F7. Security model

Select on a business table is `private.is_org_member(organisation_id)`. Write policies follow the role matrix in B2. The `anon` and `authenticated` roles keep only select, insert, update and delete on tables. Truncate, references and trigger were revoked. `audit_log`, e-document tables, journal tables, allocations, `email_outbox` and `organisation_secrets` have no direct write or read for people, as applicable. `profiles` are visible to oneself and to people who share an organisation, through a security definer helper that avoids recursive row level security. The logo bucket is private, read by members, written by owners and admins, and served through `/organisation-logo/{organisationId}` after a membership check. Other protections: XML refused when it could load outside files, signed envelopes, signed single-use AI tokens, formula-safe exports and encrypted provider keys.

## F8. Audit

`audit_log` records changes to organisation defaults, access, suppliers, customers, VAT rates, GL codes, currencies, transaction types, document headers, payments, allocations, bank accounts, approval rules, payment runs, accounting settings, supplier bank changes, journal batches, Ask Qula settings, Access Point settings and secret changes. An update stores only the changed columns. Recalculated totals and settlement-only updates are not logged. Automatic order closes carry a reason. Owners and admins read it. Nobody edits it.

---

# Part G. Testing, gaps and recommendations

## G1. How the project is checked

| Check | What runs | Size |
| --- | --- | --- |
| Documents | `npm run check:docs` | Names in `CORE.md`, `TECHNICAL.md` and the reference match the code. It checks names, not sentences |
| Unit tests | `npm test` (`tsx --test`) | About 180 tests across about 40 files |
| Types | `npm run db:types` | Generated types match the migrations |
| SQL tests | `scripts/run-sql-tests.sh` on a local Supabase stack | 43 test files and 3 two-session concurrency scripts. The runner's stale list is empty now |
| End to end | Playwright in Chromium on the built app | Flows 1 to 40 and a smoke test of every main page for owner, admin and member |

CI runs these on every pull request and every push to a `claude/` branch.

## G2. What is not built

| Gap | Note |
| --- | --- |
| Peppol sending and receiving | Mock Access Point only. Blocked on a provider choice. Irish mandatory e-invoicing is phased from 1 November 2028 according to secondary sources. Check Revenue's own pages |
| Real-time reporting to Revenue | Nothing exists |
| Invoice Response on reject | Reject is internal only |
| Import of allowances and charges | Blocked by decision G7 |
| Bank statement import and bank feeds | Nothing exists |
| Cross-currency payments, write-offs, bank charges | Not supported |
| VAT return | Nothing beyond VAT by rate in Ask Qula |
| Statements and reminder runs | Ask Qula drafts one reminder |
| Real outbound email | Mock adapter only. No mail provider chosen |
| Xero, Sage and QuickBooks files | Generic CSV only |
| Inviting people | A person must sign up first |
| Help for payments and credit notes | Help text covers Ask Qula only |

## G3. Recommendations, in order

1. **Run the manual payments script** and fix what it finds. Payments is the largest unproven area and the typed paid amount is gone, so there is no other way to mark an invoice paid.
2. **Settle the ignored clicks.** Four flows lost a click. Read the trace from one failing run.
3. **Finish the validator conformance work.** Run the 30 document comparison with an independent reference validator, run the negative Peppol cases and record both in `CONFORMANCE.md`. The wrong-element-name defect shows why.
4. **Correct the documents** listed in A2.6 and update the payment approvals spec status. They are small edits and they are what the next reader sees first.
5. **Close the open acceptance boxes that tests can close** (payments items 1 to 4, Hardening 2 phase 6, approvals and journal boxes).
6. **Run every migration against a copy of the live project.** Hardening 1, EN 16931 and the payments release each ask for it and none records it.
7. **Choose an Access Point provider and a mail provider.** Everything that waits on them (sending, receiving, the Invoice Response, real approval emails, bank feeds) is blocked on those two decisions.
8. **Sweep the FinTran identifiers** when convenient. The risk sits in the Postgres settings, so do it in one migration with the triggers.

## G4. Things I would like you to confirm

1. Which eight specs you meant, if not the ten I reviewed.
2. What decision G7 refers to. It is used as your label in the e-documents spec and is not defined elsewhere.
3. Whether the logo-copy behaviour at posting (refuse to post, not fall back) is what you want, because it is the one place the system does the opposite of the written spec.
