# Qula Plus hardening spec

Goal: close the risks found in the review of 11 November 2026 before real users arrive. Most phases are small. Phase 7 adds the end-to-end test suite that the later phases and all future work rely on.

Read `docs/QULA_PLUS_REFERENCE.md`, `CORE.md`, `TECHNICAL.md` and the earlier specs first.

## Rules for the agent

The rules from the earlier specs still apply: new migrations only, rules enforced in Postgres, no service-role key, security definer functions with `search_path = ''`, British spelling, SQL tests for every acceptance criterion, regenerate types, and update the documentation after each phase.

Each phase must leave behaviour that is not mentioned in it unchanged.

## Status on 18 November 2026

Added after an audit of each phase against the code and the tests. All eight phases are built and merged. 30 of the 36 acceptance boxes below are ticked, each with the test that proves it, and six are open with the reason beside them.

| Phase | State | Open |
| --- | --- | --- |
| 1 Spreadsheet export safety | Done | None |
| 2 Ask Qula actions | Done | None |
| 3 Stored questions and answers | Done | None |
| 4 Order quantity rules | Done | None |
| 5 Peppol order references | Done | None |
| 6 Save before acting | Done. Flow 1 proves the main case | Two boxes have no test: a failed save, and Create invoice with unsaved edits |
| 7 End-to-end tests | Done. Flows 1 to 10 pass in CI, and nine more flows have been added since | The status document it mentions does not exist |
| 8 Document screen and names | Done. The screen is a shell and panels in `src/components/document/`, the largest file is 534 lines, and `PurchaseInvoice` is gone from `src` and `e2e` | Small leftovers: `DocumentManager` still defaults its title to "Purchase Invoices", and the form's HTML id is `purchase-document` |

Two things in the spec have changed since it was written. `updatePaidAmount`, named in phase 8, was removed when the typed paid amount went (see the payments spec, phase 5). "Approvals", listed as out of scope here, is now a planned item (see `docs/QULA_PLUS_REFERENCE.md`, section 15).

The "Out of scope" list below is still true on two counts: the internal FinTran identifiers have not been renamed, and there are no Access Point providers.

---

## Decisions taken in this spec

| # | Decision | Default chosen |
| --- | --- | --- |
| J1 | Spreadsheet safety | CSV text cells that could be read as a formula get a leading apostrophe. XLSX writes text as explicit string cells and never writes formula cells. |
| J2 | Ask Qula actions | Off by default for every organisation, including existing ones. Owners and admins switch them on separately from AI answers. |
| J3 | Action tokens | Single use, valid for ten minutes, and refused if the target changed after the proposal. |
| J4 | Stored questions and answers | Kept for 30 days by default (configurable from 1 to 365), then deleted automatically. Ratings are kept without the text. |
| J5 | Reopening orders | An order closed automatically by the system reopens automatically when a void or a returning credit note leaves something to invoice. An order closed by hand stays closed. |
| J6 | Credit notes and order quantity | A credit note line returns quantity to the order only when it is linked to an invoice line from that order and marked "Return to order". It counts only once the credit note is posted. |
| J7 | Drafts holding order quantity | Still counted, so two people can't over-invoice an order. They are shown separately as "Reserved", and drafts older than 14 days are flagged. |
| J8 | Buttons that change status on a form with unsaved edits | Save first, then act, in one step. If the save fails, the action does not run. |

---

## Phase 1: spreadsheet export safety (decision J1)

Affects the grid Excel export, every CSV download, Ask Qula's table download, and any other export.

### 1.1 CSV

Add `src/lib/export/safe-cell.ts`. For every text cell, if the value starts with `=`, `+`, `-`, `@`, a tab or a carriage return, prefix it with `'`. Numbers and dates written as numbers are not changed. Quote every field and escape quotes as `""`.

### 1.2 XLSX

- Write numbers as numeric cells and dates as date cells.
- Write every other value as an explicit string cell (type `s` or inline string).
- Never write a formula cell from data.
- Confirm the library in use does not infer formulas from strings.

### 1.3 Single path

Every export goes through one helper per format. Remove any export code that builds rows directly.

### Acceptance

- [x] A supplier named `=HYPERLINK("http://example.com","x")` exports to CSV as `'=HYPERLINK(...)` and to XLSX as plain text. Tested in `src/lib/export/safe-cell.test.ts` (supplier named as a formula) and `xlsx.test.ts` (plain string cell, never a formula).
- [x] A party name starting with `-` exports safely; a negative amount still exports as a number. Tested in `safe-cell.test.ts`: a negative number is left as a number.
- [x] Ask Qula's CSV download passes the same tests. Tested in `safe-cell.test.ts`: Ask Qula's table download goes through the same helper.
- [x] A code search finds no export that bypasses the helpers. Tested in `safe-cell.test.ts`: a test searches `src` for any export that bypasses the helpers.

---

## Phase 2: Ask Qula actions (decisions J2 and J3)

### 2.1 Switch

- Add `actions_enabled boolean not null default false` to `ai_settings`. The migration sets it to false for every existing row.
- It can only be true while AI answers are enabled.
- Owners and admins change it on the Ask Qula settings screen, with a note: "Ask Qula may propose posting drafts and adding customers or suppliers. Nothing happens until a person confirms."
- When it is false, the model is given no action tools, and the action route refuses every token.

### 2.2 Proposals and single use

Each proposal writes an `ai_actions` row before the token is returned:

| Column | Rule |
| --- | --- |
| `status` | `proposed`, `confirmed`, `failed`, `expired`, `superseded` |
| `token_hash` | SHA-256 of the token. The token itself is never stored |
| `expires_at` | Proposal time plus 10 minutes |
| `target_id` | The document being posted, when there is one |
| `target_version` | The target header's `updated_at` at proposal time |
| `proposal` | The server-built summary shown to the person (2.3) |

`POST /api/ask-qula/action` must:

1. Hash the token, then in one statement move the matching row from `proposed` to `confirmed` only if it has not expired and belongs to this user and organisation. If no row changes, return 409 (already used) or 400 (expired or unknown).
2. For a post action, refuse with 409 if the header is no longer a draft or its `updated_at` differs from `target_version`: `This document changed after Ask Qula proposed posting it. Ask again.`
3. Run the action under the person's own session, as today, and record the outcome as `confirmed` or `failed`.

### 2.3 What the person confirms

The confirmation card is built on the server from the database, never from the model's text.

**Post a document:**

- type, party, date and due date
- the number it will receive: for on-post types, "Next number: INV-00043 (may change if another document posts first)"
- nett, VAT and total in the document currency
- the VAT breakdown
- the readiness result

If readiness has any errors, there is no Confirm button.

**Add a customer or supplier:** every field that will be saved, with blanks shown as blank.

The card is labelled "Proposed by Ask Qula".

### Acceptance

- [x] With actions off, the model is offered no action tools and a valid token is refused. Tested in `actions.test.ts` (nothing is proposed with actions off) and `supabase/tests/hardening_phase2.sql` (the confirm is refused).
- [x] Existing organisations have actions off after the migration. Tested in `hardening_phase2.sql`: actions are off by default, and stay off unless AI answers are on.
- [x] Using a token twice: the first post succeeds, the second returns 409 and nothing is posted twice. Tested in `hardening_phase2.sql`: first confirm posts, second is refused, one confirmed row.
- [x] Editing the draft after the proposal makes the confirm return 409. Tested in `hardening_phase2.sql`: confirming after an edit fails and the draft is not posted.
- [x] A token from another user or organisation is refused. Tested in `hardening_phase2.sql`: another member, an outsider and another organisation are refused.
- [x] The confirm card's figures match the database, even when the model's text gives different figures. Tested in `actions.test.ts`: the card is built from the database.
- [x] A draft with readiness errors shows no Confirm button. Tested in `actions.test.ts`: a sales draft that is not ready shows why and has nothing to confirm.

---

## Phase 3: stored questions and answers (decision J4)

- Add `answer_retention_days integer not null default 30`, from 1 to 365, to `ai_settings`.
- Install `pg_cron` and schedule `private.purge_ai_feedback_text()` daily at 03:15 Europe/Dublin. It clears `question`, `answer` and `comment` on `ai_feedback` rows older than the organisation's retention, and keeps the rating.
- Switching `log_answers` on requires a second data notice: "Questions and answers will be stored for {n} days and visible to owners and admins." Record who accepted it and when.
- Only owners and admins can read stored text, as today.

### Acceptance

- [x] A feedback row older than the retention period has no text after the purge runs, and keeps its rating. Tested in `hardening_phase3.sql`.
- [x] Rows inside the retention period are untouched. Tested in `hardening_phase3.sql`.
- [x] `log_answers` cannot be switched on without accepting the notice. Tested in `hardening_phase3.sql`.

---

## Phase 4: order quantity rules (decisions J5, J6 and J7)

### 4.1 Who closed the order

- Add `closed_by_system boolean not null default false` to `transaction_headers`.
- Automatic closing sets it to true. Closing by hand, or reopening, sets it to false.
- Record each automatic close and reopen in the audit log, with the reason in the change details.

### 4.2 Credit notes on order lines

Add to `transaction_lines`:

| Column | Rule |
| --- | --- |
| `credited_line_id` | Nullable. Same-organisation reference to a line on the credit note's preceding invoice |
| `returns_to_order` | Boolean, default false. Allowed only when `credited_line_id` points to an invoice line with a `source_line_id` |

Rules:

- The total quantity credited against one invoice line, across posted and draft credit notes, cannot exceed that line's quantity.
- **Create credit note** from a posted invoice copies each line with `credited_line_id` set. `returns_to_order` is ticked when the invoice line came from an order. The user can untick it, for example for a price-only credit.
- A line marked `returns_to_order` must have a quantity.

### 4.3 Quantity used on an order line

Replace the current calculation with:

> used = quantity on non-void invoice lines drawing on this order line (draft and posted) − quantity on **posted** credit note lines with `returns_to_order` whose credited line draws on this order line

Show it on each order line as:

| Column | Meaning |
| --- | --- |
| Invoiced | Posted invoice quantity less returned credit quantity |
| Reserved | Draft invoice quantity |
| Left | Order quantity − Invoiced − Reserved |

The existing row lock and the over-invoicing check use the new calculation.

### 4.4 Reopening (decision J5)

When a void, or a posted returning credit note, leaves an order with something left to invoice:

- if `closed_by_system` is true, the order reopens to Active and `closed_by_system` becomes false
- if the order was closed by hand, it stays closed, and **Worth a look** lists it under "Closed orders with quantity left"

Automatic closing now also counts returning credit notes. An order closes only when Invoiced covers every line.

### 4.5 Old drafts (decision J7)

- **Worth a look** adds "Drafts holding order quantity": draft invoices older than 14 days that draw on an active order, with the quantity held.
- The order screen lists drafts drawing on it, with links.

### Acceptance

- [x] An order fully covered by posted invoices closes automatically. Voiding one invoice reopens it, and the voided quantity is Left. Tested in `hardening_phase4.sql` and end-to-end flows 1 and 3.
- [x] An order closed by hand stays closed after a void, and appears in Worth a look. Tested in `hardening_phase4.sql`, and the Worth a look listing in `insights.test.ts`.
- [x] Posting a credit note line marked Return to order gives its quantity back and reopens an auto-closed order; a draft credit note does not. Tested in `hardening_phase4.sql` and end-to-end flow 4: a draft credit note gives nothing back, a posted one does.
- [x] A price-only credit (Return to order unticked) gives nothing back. Tested in `hardening_phase4.sql`.
- [x] Crediting more than the invoice line's quantity is refused. Tested in `hardening_phase4.sql`, for posted and draft credit notes.
- [x] A 15-day-old draft drawing on an order appears in Worth a look; a 13-day-old one does not. Tested in `insights.test.ts`: 15 days is flagged, 14 and 13 are not.
- [x] Two concurrent invoices for the last unit of an order line: one succeeds and one is refused. Tested by `supabase/tests/concurrency/last_unit.sh`, which `scripts/run-sql-tests.sh` runs.

---

## Phase 5: Peppol order references

Confirm each rule below against the Peppol BIS Billing 3.0 documentation and Schematron before coding. Do not rely on this spec's description.

| Case | Expected UBL |
| --- | --- |
| Buyer order number only (BT-13) | `cac:OrderReference/cbc:ID` |
| Sales order number only (BT-14) | `cac:OrderReference` with `cbc:SalesOrderID`, and the placeholder Peppol specifies for `cbc:ID` when there is no buyer order number (believed to be `NA`; confirm) |
| Both | `cbc:ID` and `cbc:SalesOrderID` in one `cac:OrderReference` |
| Line order reference (BT-132) | `cac:OrderLineReference/cbc:LineID` on the line. Confirm whether a document-level order reference is then required, and supply it if so |

For inbound files, `parseUbl` treats the placeholder value as no buyer order number.

Add a golden fixture and expected UBL for every case. Each must pass XSD, EN 16931 and Peppol validation.

### Acceptance

- [x] All four cases generate valid files that match their golden XML. Tested in `src/lib/einvoice/order-reference.test.ts`, with a golden file for each case in `einvoice/fixtures`.
- [x] A sales invoice from a sales order with no customer order number validates. Tested in `order-reference.test.ts`.
- [x] Parsing a file with the placeholder gives a null buyer order number. Tested in `order-reference.test.ts`.

---

## Phase 6: save before acting (decision J8)

Affects Post, Activate, Close, Reopen, Cancel, Create invoice, Create credit note and From order on the document screen.

- If the form has unsaved changes, the button saves first, then runs the action. The button label shows this, for example "Save and post".
- If the save fails, show the save errors and do not run the action.
- If there are no unsaved changes, the action runs as today.
- Remove the current "unsaved changes" warnings for these buttons.

### Acceptance

- [x] Changing a line quantity and pressing "Save and post" posts the changed quantity. Tested by end-to-end flow 1: the quantity is changed on the new invoice and Save and post saves it first.
- [ ] A save that fails validation leaves the document in draft and shows the error. Open: `follow-on.test.ts` tests which actions may follow a save, but no test makes a save fail and checks the document stays a draft with the error shown.
- [ ] Create invoice from an order with unsaved edits uses the saved, edited order. Open: no test edits an order and presses Create invoice without saving first.

---

## Phase 7: end-to-end tests

### 7.1 Set-up

- Use Playwright, running against the Next.js app and a local Supabase stack built from the migrations.
- Add a seed script for tests that creates:
  - one tenant with two organisations
  - an owner, an admin and a member
  - the usual setup lists
  - Sales and Purchases types for each kind
  - two customers and two suppliers with complete e-invoicing details
- Use the `mock` AI and Access Point adapters. No test calls a real provider.
- Run in CI on every pull request. Save traces and screenshots for failures.

### 7.2 Flows

Each flow signs in through the real sign-in page.

1. Sales order → activate → invoice part → invoice the rest → order closes automatically.
2. Two sales orders → one invoice from both → both show the right Invoiced and Left.
3. Purchase requisition → purchase order → invoice → void the invoice → order reopens.
4. Posted sales invoice → credit note with Return to order → order reopens.
5. Upload a received e-invoice → create the supplier in the modal → import → post.
6. Upload the same file again → no new row. Upload a different file with the same number → duplicate → admin releases it.
7. Ask Qula with mock AI answers a question with a card. A proposed post is confirmed once; a second confirm fails.
8. The member role cannot see admin actions (void, reject, settings), and is refused when calling them directly.
9. Export a grid containing a formula-like party name, then check the downloaded file (phase 1).
10. Print and PDF of a posted invoice show the snapshot values after the customer's address is changed.

### 7.3 Smoke checks

Each main page loads for each role without console errors.

### Acceptance

- [x] All ten flows pass in CI. All ten flows (1 to 10) pass in CI, as do the nine added since.
- [x] A deliberately broken flow fails CI and uploads a trace. CI keeps a trace, a screenshot and a video of a failing test and uploads them. Real failures have shown it, though nobody broke a flow on purpose to check.
- [ ] The "Built but not proven" list in the status document can be reduced to items that still need real data. Open: there is no status document in the repository, so there is no "Built but not proven" list to reduce. The payments reference (`docs/QULA_PLUS_REFERENCE.md`) now says what is proven and what is not.

---

## Phase 8: document screen and action names (no behaviour change)

Run this phase only after phase 7 passes, so the tests prove nothing changed.

- Split the document screen into a shared shell plus panels:
  - header and lines (shared)
  - invoice and credit note actions
  - order and requisition actions
  - e-invoice panel
  - linked documents
- No single file should exceed about 600 lines.
- Rename the document server actions and files from "PurchaseInvoice" to "Document": `saveDocument`, `postDocument`, `voidDocument`, `updatePaidAmount`, `deleteDocument`, `createCreditNote`, with the component as `DocumentManager`.
- Update `TECHNICAL.md` and the status document.

### Acceptance

- [x] All unit, SQL and end-to-end tests pass unchanged. No test files were changed to make it pass that I could find: the end-to-end selectors still use the old form id. Everything passes in CI now.
- [x] No source file or export uses the name "PurchaseInvoice". A search of `src` and `e2e` finds no use of the name. A fixture file called `purchase-invoice` is a file name, not the old identifier.

---

## Out of scope

- Payment records, banking integration and accounting system integration (next spec)
- Approvals
- Renaming internal "FinTran" identifiers (cookie, repository). Do this in one sweep later, with a cookie migration so users stay signed in
- Access Point providers and network delivery (waiting on a provider choice)

## Done when

- [ ] All phases' acceptance tests pass, including the end-to-end suite in CI. Open: two boxes in phase 6 (a failed save before acting, and Create invoice with unsaved edits) and the status document in phase 7 are not covered, so not all acceptance tests exist yet.
- [ ] Every migration runs cleanly against a copy of the live project. Open: every migration was applied to the hosted project in turn, but I cannot show that each ran cleanly against a copy of the live project.
- [x] Types are regenerated. `npm run db:types` passes in CI.
- [ ] The status document, `CORE.md` and `TECHNICAL.md` describe the new rules, and the "Known rough edges" list is updated. Open: `CORE.md` and `TECHNICAL.md` describe the new rules, but there is no status document and no "Known rough edges" list in the repository.
