# Qula Plus purchase approvals and price tolerance spec

Version 1, 18 November 2026. A draft for review. Nothing in it is built.

Goal: let an organisation say that a purchase order or purchase invoice above a set amount, or an invoice whose prices have gone over what was ordered, must be approved by someone senior before it takes effect. This is step 2 of the agreed order (aged debtors and creditors, approvals with price tolerance, journal export, bank statement import, live connectors and bank feeds). It comes before journal export so that what is exported has already passed the posting rules.

Read `docs/QULA_PLUS_REFERENCE.md`, `CORE.md`, `TECHNICAL.md` and the two earlier specs first.

## Rules for the agent

The rules from the earlier specs still apply: new migrations only, rules enforced in Postgres, no service-role key, security definer functions with `search_path = ''`, British spelling, SQL tests for every acceptance criterion, regenerate types, and update the documentation after each phase (`npm run check:docs` must pass). Each phase must leave behaviour that is not mentioned in it unchanged, and with no approval rule set, every organisation must behave exactly as it does today.

## Questions for review

The spec chooses a default for each of these (see the decisions table). Each can change before anything is built.

1. **Who approves.** The default is by role, using the roles that exist (member, admin, owner), with no named approver lists. Is that enough, or do you need approvers named per rule or per supplier?
2. **Entering and approving.** The default is that the person who enters a document cannot approve it, even if they are an owner, unless nobody else could. Is that right?
3. **Credit notes.** The default is that purchase credit notes are not gated, because they reduce what is owed. Should they be?
4. **Sales.** The default is purchases only. Is any control wanted on sales documents?
5. **Payments.** Approving a payment run is a separate control and is left out. Should it be next?
6. **Notification.** The default is a count on the home page and a filter, with no email. Is email needed for the first version?
7. **Price tolerance.** The default flags only a price that is higher than ordered, as a percentage of the order price, one setting for the whole organisation. Should a lower price be flagged too, or should the tolerance be per supplier?

## What exists today that this changes

| Place | Today | Under this spec |
| --- | --- | --- |
| `post_document` | Any member can post a draft. Every path posts through it: the Post button, Save and post, Ask Qula's confirmed post (`postDocumentNow`) and a draft made by importing an e-invoice | Refuses a purchase invoice that needs approval and has not got it |
| `set_order_status` (Activate) | Any member can activate a draft order | Refuses a purchase order that needs approval and has not got it |
| Header columns | `home_total_amount` holds the total in the home currency for invoices and orders | Used as the amount a rule is compared with |
| Invoice from an order | `create_from_order` copies each order line's price, and a line keeps `source_line_id` | The price on the invoice line is compared with the price on the order line it came from |
| Roles | Owner, admin and member. Admins and owners already void purchases, reject e-documents and set the lock date | The same three roles are the approval levels |
| Audit log | Document header changes are logged | Requests, approvals and rejections are logged too |

## Decisions taken in this spec

| # | Decision | Default chosen |
| --- | --- | --- |
| A1 | What is covered | Purchase orders and purchase invoices. Not requisitions, credit notes, sales documents or payments |
| A2 | What is held back | **Activating** a purchase order and **posting** a purchase invoice. Saving, editing, deleting and creating a draft stay free for any member. Voiding a posted purchase stays owner or admin as today and is not gated |
| A3 | Rules | An owner or admin sets rules for each purchase transaction type: an amount in the home currency and the role that must approve at or above it. Several rules on one type make a ladder, and the highest amount not above the document's total applies. With no rule, nothing changes |
| A4 | Amount compared | The document's total with VAT in the home currency (`home_total_amount`) |
| A5 | Approver level | The role must be at least the rule's role, in the order member, admin, owner. An owner can approve anything an admin can |
| A6 | Separate people | The person who requested approval cannot approve it. If nobody else in the organisation has a high enough role, the requester may approve it, and the record says so |
| A7 | An approval is for one version | Any change to the document after a request or an approval (a line, a price, the supplier, the date) cancels it and the document needs approval again |
| A8 | Rejection | A rejection needs a reason, returns the document to a state where it can be edited, and the reason is shown to whoever entered it. It can be requested again after a change |
| A9 | Who can then post | Once approved, any member can post or activate it, as today. Approval is the extra step, not a new owner of the action |
| A10 | Price tolerance, where | Purchase invoice lines that came from an order line (`source_line_id`). A line typed in with no order line is not compared |
| A11 | Price tolerance, measure | The unit net price on the invoice line, after any discount, against the same figure on the order line. The tolerance is a percentage of the order price. Only an **increase** over the tolerance counts |
| A12 | Price tolerance, effect | A line over tolerance is marked on the line and in the posting summary. If the organisation has approvals turned on for the type, a purchase invoice with any such line needs approval from an admin or owner whatever its amount. It is a warning only where no approval rule applies to the type |
| A13 | Setting | One tolerance percentage for the organisation, on the Organisations screen next to the lock date, with a switch for whether a breach needs approval. Off (no percentage) by default |
| A14 | Notification | No email in this version. Approvers see a count on the home page, a Worth a look entry and a filter on the lists. The requester sees the state on the document |
| A15 | Ask Qula | It cannot request or give approval. A proposed post of a document that needs approval shows why and has no Confirm button, as a draft with a readiness error does |
| A16 | Imported e-invoice drafts | Treated like any other draft. Approval applies when they are posted |
| A17 | Audit | Every request, approval and rejection is recorded with who, when and the note |
| A18 | Existing data | Drafts and rules at the time of the migration: none. No organisation has a rule, so nothing is held back until an owner or admin sets one |

## Phase 1: database

### 1.1 Rules table

New table `approval_rules`, with the standard scoping and audit columns, `tenant_id` and `organisation_id` kept in step by the usual trigger.

| Column | Rule |
| --- | --- |
| `transaction_type_id` | Required. A Purchases type of kind invoice or order, in this organisation, by a composite key |
| `amount` | Required, greater than 0, two decimal places, in the home currency |
| `required_role` | `admin` or `owner` |
| `active` | Default true |

Unique on `(organisation_id, transaction_type_id, amount)`. Members read it. Owners and admins write it. A type with rules cannot change its kind. Deleting a type that has rules is refused (restrict).

### 1.2 Header columns

New columns on `transaction_headers`, all null on a document that never needed approval:

| Column | Meaning |
| --- | --- |
| `approval_status` | Null, `required`, `requested`, `approved` or `rejected` |
| `approval_required_role` | `admin` or `owner`: the level this document needs |
| `approval_reason` | `amount`, `price` or `amount and price`: why it needs approval |
| `approval_requested_by`, `approval_requested_at` | Who asked and when |
| `approval_decided_by`, `approval_decided_at` | Who approved or rejected and when |
| `approval_note` | The note with the request, or the reason for a rejection |
| `approval_self` | True when the requester approved it because nobody else could (A6) |

These are written only by the functions below. A person cannot update them directly, and a posted document's values are frozen.

### 1.3 Functions

| Function | Behaviour |
| --- | --- |
| `private.approval_check(p_header_id)` | Returns whether approval is needed, the role, and the reason. Draft purchase invoices and orders only. Finds the rule by A3 and A4, adds the tolerance rule of A12, and takes the higher role of the two |
| `request_approval(p_header_id, p_note)` | Any member. The document must be a draft that needs approval and has not been approved. Sets `requested` and records who and when. Refused if it needs nothing |
| `approve_document(p_header_id, p_note)` | A role at least `approval_required_role`. Refused for the requester unless A6 allows it. Only from `requested`. Sets `approved` |
| `reject_document(p_header_id, p_reason)` | Same role test. Reason required. Sets `rejected` |
| `post_document` and `set_order_status` (activate) | After their existing checks, call `private.approval_check`. If approval is needed and the status is not `approved`, refuse with a message that says what to do: `This document needs approval from an admin or owner. Request approval first.`, `Waiting for approval from an admin or owner.` or `Approval was refused: {reason}.` |

A trigger on the header and on the lines sets a `requested` or `approved` document back to `required` when anything about it changes, except when the change is one of the functions above. A rule change does not alter documents already approved or posted. The check runs again at posting, so a rule raised after an approval is applied at the next post.

### Acceptance

- [ ] With no rule set, posting a purchase invoice and activating a purchase order behave exactly as before.
- [ ] A rule of €1,000 for admin on a purchase invoice type: a €999.99 invoice posts for a member. A €1,000.00 one is refused with the request message.
- [ ] A member requests approval, an admin approves, and then a member posts it.
- [ ] A ladder of €1,000 for admin and €10,000 for owner: a €5,000 invoice can be approved by an admin and a €12,000 one only by an owner.
- [ ] A member cannot approve. An admin cannot approve a document that needs an owner.
- [ ] The requester cannot approve their own request when another person with a high enough role exists. When none does, they can, and `approval_self` is true.
- [ ] Editing a line, the price, the supplier or the date of a requested or approved document sets it back to `required`.
- [ ] A rejection without a reason is refused. A rejected document can be changed and requested again.
- [ ] The same gate applies to activating a purchase order. A requisition, a credit note, a sales document and a payment are not gated.
- [ ] A document needing approval cannot be posted through Ask Qula's route, an imported draft's Post, or the save-before-acting button, because all of them end in `post_document`.
- [ ] Nobody can write the approval columns or the rules table directly, except owners and admins on the rules. A member can read the rules.
- [ ] Requests, approvals and rejections are in the audit log with the note.
- [ ] A posted document's approval record cannot change.

## Phase 2: price tolerance

### 2.1 Setting

New columns on `organisation_defaults`: `price_tolerance_percent` (null, or from 0 to 100 with two decimal places) and `price_tolerance_needs_approval` (default true). Owners and admins set them, with the lock date. Null means no check.

### 2.2 Check

`public.price_checks(p_header_id)` returns, for each line of a purchase invoice that has a `source_line_id`, the order price, the invoice price, both unit net prices after discount, the percentage difference and whether it is over tolerance (A11). It returns nothing when the percentage is null. It is what `private.approval_check` uses for A12.

### Acceptance

- [ ] An invoice line priced 4% over its order line with a 5% tolerance is not over. At 5.01% it is.
- [ ] A line priced below the order price is never over.
- [ ] A discount on the invoice line counts: a higher price with an offsetting discount that leaves the unit net price equal is not over.
- [ ] A line with no order line is not compared.
- [ ] With a null percentage nothing is checked, and with approvals turned on for the type a breach makes the invoice need approval from an admin even when its amount is under every rule.
- [ ] With `price_tolerance_needs_approval` false, a breach is shown and does not block posting.

## Phase 3: screens

- **Rules.** A list under Admin, "Approval rules", in the standard setup grid and record form: type, amount, required role, active. Owners and admins edit it. A short line says what happens when there is no rule.
- **Organisations screen.** The tolerance percentage and the switch, beside the lock date.
- **Document screen.** The status row says what is needed: "Needs approval from an admin or owner", "Approval requested by {name}, waiting", "Approved by {name}" or "Approval refused: {reason}". Where approval is needed, the Post (or Activate) button becomes **Request approval** (it saves first, as the other buttons do). An approver sees **Approve** and **Reject** on a requested document, each asking for a note. An edit to an approved document says the approval has been cancelled.
- **Lines.** A purchase invoice line over tolerance is marked, with the order price and the percentage.
- **Lists.** An Approval column and a filter (needs approval, waiting, approved, refused). The home page shows the count of documents waiting for the person's role.

### Acceptance

- [ ] A member sees Request approval where a rule applies, and Post where none does.
- [ ] An approver sees Approve and Reject only on a document in the requested state and only with a high enough role.
- [ ] Request approval on a form with unsaved edits saves first and then requests, and a failed save does not request.
- [ ] A line over tolerance shows the marker and the percentage.
- [ ] The list filter finds documents waiting for approval, and the home page count matches it.
- [ ] The rules list and the tolerance setting cannot be changed by a member.

## Phase 4: Ask Qula, Worth a look and imports

- **Worth a look:** "Waiting for approval", for people who can approve, with the oldest and the amount. "Refused" for the requester, until the document is changed or deleted.
- **Ask Qula:** the proposal card for a post shows when approval is needed and why, and has no Confirm button. `search_transactions` shows each document's approval state and can filter on it. Ask Qula cannot request or give approval.
- **Imported drafts:** no change to the import. The draft shows the same approval state as any other.

### Acceptance

- [ ] A document waiting for approval appears in Worth a look for an admin and not for a member.
- [ ] Asking Ask Qula to post a document that needs approval gives a card with the reason and no Confirm button.
- [ ] Ask Qula can list documents waiting for approval.
- [ ] An imported draft over a rule's amount is refused at posting until approved.

## Phase 5: end-to-end tests

New flows, numbered from 20, each with amounts no other flow uses:

20. An owner sets a rule. A member's invoice over the amount cannot be posted. The member requests approval, an admin approves it, and the member posts it.
21. Editing an approved invoice cancels the approval.
22. An admin rejects with a reason, and the member sees the reason, changes the invoice and asks again.
23. An invoice raised from an order and edited to a higher price over the tolerance needs approval, and one within it does not.
24. Ask Qula shows no Confirm button for a document that needs approval.
25. With no rule, posting is unchanged.

### Acceptance

- [ ] All six flows pass in CI, and the existing flows pass without changes beyond any new setup they need.

## Out of scope

- Sales approvals, and approval of voids, credit notes, requisitions and payments
- More than one approver in a chain, named approvers, delegation and out-of-office cover
- Email or other notification
- Tolerance by supplier, by product or by an absolute amount, and a tolerance on quantity (a quantity is already limited by what is left on the order)
- Budgets and spend limits by GL code or department
- Approving a payment run (a separate control, and a candidate for the spec after this)

## Done when

- [ ] All SQL, unit and end-to-end tests pass on a fresh database built from all migrations in order.
- [ ] With no approval rule and no tolerance set, every existing flow passes unchanged.
- [ ] Types are regenerated.
- [ ] `CORE.md`, `TECHNICAL.md` and `docs/QULA_PLUS_REFERENCE.md` describe approvals and tolerance, and `npm run check:docs` passes.
- [ ] The migration is applied to the hosted FinTran project, with the date recorded.
