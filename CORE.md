# Qula Plus core

Qula Plus keeps financial setup and purchase documents separate for each organisation. A tenant owns one or more organisations. A person signs in once and is granted access to particular organisations inside a tenant, as an owner, admin, or member.

The live database is the FinTran Supabase project. The schema is the SQL in `supabase/migrations`, applied in filename order, starting from a baseline that matches the live project on 12 November 2026. Postgres holds the rules: uniqueness, which codes may be used together, reference numbers, and totals. The Next.js app reads and writes through the Supabase API as the signed-in user. It does not use a service-role key.

Sales invoices, sales credit notes, and sales orders are stored with purchase documents. An order is not exported as an EN 16931 invoice.

## How the pieces fit

```text
tenant
  └── organisation
        ├── organisation_access        who may open it, and as which role
        ├── organisation_defaults      home currency, address, logo, banking
        ├── currencies
        ├── bank_accounts              the organisation's own bank accounts
        ├── gl_codes
        ├── departments
        ├── cost_centres
        ├── vat_rates
        ├── products
        ├── customers
        ├── suppliers
        ├── transaction_types
        │     └── transaction_forms    one printable layout
        ├── transaction_headers        purchase documents, sales invoices, and sales credit notes
        │     └── transaction_lines
        ├── payments                   money paid and received, never headers
        └── allocations                a payment or credit note applied to an invoice or credit note
```

Almost every business table carries both `tenant_id` and `organisation_id`. A trigger checks that the organisation belongs to that tenant, and blocks a row from being moved to another organisation. Codes are uppercased and trimmed in those triggers. A code is unique inside one organisation, not across the whole database.

A code is chosen when the row is created. After that save, the code is read-only. This covers GL codes, departments, cost centres, VAT rates, customers, suppliers, products, currencies, and transaction types. The edit form shows the saved code and does not accept a new one. An update leaves the code out. Postgres rejects a change.

Where a code is used by another row, the foreign key is `ON DELETE RESTRICT`. You cannot remove a currency, GL code, VAT rate, product, supplier, or transaction type that is still referenced. Deleting an organisation deletes the rows that belong only to it (`ON DELETE CASCADE`).

## Reference code lists

EN 16931 code lists are shared by every organisation. They are not copied per tenant. Any signed-in user can read them. The API grants no insert, update, or delete.

The seed is pinned to Peppol BIS Billing 3.0.21, the May 2026 release, code list publication 2026-03-06, taken from the code list pages at `https://docs.peppol.eu/poacc/billing/3.0/codelist/`. Currency minor units come from the ISO 4217 maintenance agency list published 2026-09-17. `CNH` is on the Peppol currency list and not on that ISO list, so it is stored with 2 minor units, the same as `CNY`.

| Table | What it holds |
| --- | --- |
| `ref_countries` | ISO 3166-1 alpha-2, page version 2013, plus `EL` |
| `ref_currencies` | ISO 4217, page version 2018-01-01, with `minor_units` |
| `ref_units` | UN/ECE Recommendation 20, including Recommendation 21 codes prefixed with X, revision 11e |
| `ref_vat_categories` | UNCL5305 OpenPEPPOL subset, version D.16B |
| `ref_vatex` | CEF VATEX exemption reason codes |
| `ref_payment_means` | UNCL4461, version D.16B |
| `ref_eas` | Peppol electronic address schemes |

`EL` is Greece's VAT prefix. `vat_prefix_only` is true, so it is not a postal country. Postal Greece is `GR`. Irish VAT electronic addresses use EAS scheme `9935`, Ireland VAT number.

VAT category flags follow the CEN schematron published with that release. An exemption reason is required for `E`, `AE`, `K`, `G`, and `O` (`BR-E-10`, `BR-AE-10`, `BR-IC-10`, `BR-G-10`, `BR-O-10`). The rate must be zero for `Z`, `E`, `AE`, `K`, `G`, and `O`. Category `O` omits the rate in UBL (`BR-O-05`); the flag records that as zero. `S` must be above zero and must not carry an exemption. `L` and `M` may be zero or more. `B` is the Italian split-payment category from the same Peppol subset.

The short unit pick list is `C62`, `H87`, `HUR`, `DAY`, `MON`, `KGM`, `LTR`, `MTR`, `MTK`, `KMT`, `SET`, and `XBX`. The short payment-means pick list is `30`, `31`, `42`, `48`, `49`, `58`, and `59`. `58` is SEPA credit transfer.

## People, tenants, and organisations

Sign-in is Supabase Auth. `public.profiles` is one row per user. Its `id` is the Auth user id. A trigger on `auth.users` creates the profile and, if no display name was given, uses the part of the email before `@`. Email is unique ignoring case.

| Table | Purpose | Important columns |
| --- | --- | --- |
| `tenants` | The owning account | `name` (2–80), `slug` unique |
| `organisations` | A company inside a tenant | `tenant_id`, `name`, `slug` unique inside the tenant |
| `profiles` | The signed-in person | `id`, `email`, `display_name` |
| `organisation_access` | Which organisations that person may open | `user_id`, `organisation_id`, `role` |

`role` is `owner`, `admin`, or `member`. One user has at most one role on one organisation.

These four tables are not written with ordinary inserts from the app. Owners and admins call security-definer functions:

- `create_tenant(tenant_name, organisation_name, p_home_currency default 'EUR')` creates the tenant, its first organisation, a home currency at rate 1, the defaults row, and owner access for the caller.
- `create_organisation(tenant_id, organisation_name, p_home_currency default 'EUR')` adds another organisation in a tenant the caller manages, with the same home currency.
- `grant_organisation_access(organisation_id, email, role)` grants access to someone who already has a profile.
- `revoke_organisation_access(organisation_id, user_id)` removes that grant.

The functions check the caller's role. Only an owner of an organisation in the tenant can create another organisation. An owner can grant any role. An admin can grant and remove members only. A member cannot create organisations or change access. An organisation must keep at least one owner.

## Who can see a row

Row level security is enabled on the public tables. The usual select rule is `private.is_org_member(organisation_id)`: the signed-in user has a row in `organisation_access` for that organisation.

Owners and admins can change setup: currencies, GL codes, departments, cost centres, VAT rates, products, transaction types, forms, organisation defaults, and the logo. Members can read that setup. Members can create, edit, and delete customers, suppliers, and draft documents.

Every business table records `created_at`, `created_by`, `updated_at`, and `updated_by`. `created_at` and `created_by` stay as they were on update. Changes to organisation defaults, access, suppliers, customers, VAT rates, GL codes, currencies, transaction types, and document headers are written to `audit_log`. An update stores only the columns that changed. Recalculated document totals are not logged. Owners and admins can read the log for their organisation. Nobody can change it directly.

Exceptions:

- `tenants`, `organisations`, `profiles`, and `organisation_access` can be read by a member. They are changed through the functions above, not by open insert and update policies.
- `organisation_defaults` can be selected by a member and updated by an owner or admin. Insert and delete are not granted to anyone through the API. The row is created with the organisation and removed when the organisation is deleted.
- `save_document` is security invoker. It runs as the caller, so the header and line policies still apply. It does not call into the `private` schema.

`private` is not on the API. Authenticated users can execute a few helpers such as `is_org_member` only because policies and triggers need them. They cannot list or change that schema.

## Organisation defaults and currencies

Creating an organisation inserts its home currency at rate 1, then one `organisation_defaults` row. The home currency is required. It cannot be deleted while it is the home currency, its rate cannot move away from 1, and it cannot be changed once the organisation has any document. Until then, changing it sets the new home currency's rate to 1. The other rates stay as they were and should be checked, because they are relative to the home currency.

| Column | Meaning |
| --- | --- |
| `organisation_id` | Primary key, and the organisation |
| `tenant_id` | Must match that organisation |
| `home_currency_id` | Required. The organisation's home currency, one of its `currencies`, always at rate 1 |
| `address_line1`, `address_line2`, `address_line3` | Up to 100 characters each. EN 16931 BT-35, BT-36, and BT-162 |
| `city` | Up to 60. BT-37 |
| `post_code` | Up to 20, stored in capitals with internal spaces collapsed. BT-38 |
| `county` | Up to 60. BT-39 |
| `country_code` | Postal country, default `IE`. It cannot be `EL`, which is only a VAT prefix. BT-40 |
| `address_needs_review` | Set when a free-text address was split, or when a VAT number could not be kept. Saving the address clears it |
| `contact_name` | Up to 200 |
| `contact_email` | An email address, up to 200 |
| `website` | Up to 200, no spaces |
| `phone` | Up to 40, digits and `+(). -` |
| `vat_number` | A country prefix from the country list, including `EL`, then 2 to 13 letters or digits. Example: `IE1234567T`. BT-31 |
| `company_number` | Up to 40, starting with a letter or digit. BT-30 |
| `peppol_scheme`, `peppol_id` | Both set, or both empty. The scheme is an EAS code. The ID is 1 to 100 letters, digits, or `. - _ :`, with no spaces, and is kept in the case it was entered. Scheme `0088` is 13 digits and `0060` is 9 digits. An organisation's scheme and ID are unique across every tenant, compared in lower case. Irish VAT electronic addresses use `9935`. BT-34 |
| `iban` | Checked with the ISO 13616 mod-97 rule and stored without spaces. BT-84 |
| `bic` | 8 or 11 characters. BT-86 |
| `bank_account_name` | Up to 100. BT-85 |
| `banking_details` | Free text up to 1000, still used for the printed bank block |
| `logo_path` | Null, or `{organisation_id}/logo` |
| `updated_at` | Set on every change |

Customers and suppliers use the same address, VAT, company number, and Peppol columns. On a sales document those are the buyer (BT-47 to BT-55). On a purchase document the supplier columns are the seller. Peppol IDs are unique per organisation for customers, and separately for suppliers. A customer or supplier may use the same Peppol ID as a Qula Plus organisation. Several records can have no Peppol ID.

A tenant can be deleted only when it has no documents. `transaction_headers.tenant_id` and `transaction_lines.tenant_id` are `ON DELETE RESTRICT`. Setup rows still cascade with the tenant. There is no API for deleting a tenant.

Posted and void documents must have a document number, issuer snapshot, party snapshot, and `posted_at`. A draft must not have posting or snapshot data. A void document must have `voided_at` and `void_reason`, and only a void document may have those. `posted_by` and `voided_by` may be null after the profile is deleted.

Document nett, VAT, total, paid, and discount amounts are `numeric(18,2)`. Prices and quantities stay at 4 decimal places, and exchange rates at 8. `save_document` refuses a paid amount or discount with more than 2 decimal places.

Blank text is stored as null.

A free-text address that was already stored was split on line breaks into lines 1 to 3. Further lines were joined into line 3, the country was set to `IE`, and the address was marked for review. A blank address was left blank. A VAT number that already had a known prefix was kept. An Irish number without a prefix was given `IE`. Any other old VAT number was cleared, written to the audit log, and the address was marked for review.

`currencies.code` is read-only after the currency is saved. `currencies.iso_code` is the ISO 4217 code, linked to `ref_currencies`, and unique inside the organisation. It is filled from the currency code when that code is already an ISO code. `currencies.rate` is how many units of that currency equal one unit of the home currency. The home currency's own rate is 1. A rate is greater than 0 and has up to 8 decimal places. On a document, the same convention is stored as `exchange_rate`: home amount = foreign amount ÷ rate.

Printing still uses one Address field. For a draft it joins the structured lines, city, county, post code, and country. A posted or void document keeps the single address string already stored on its snapshot.

The logo file is not in the table. It is an object in the private Storage bucket `organisation-logos`, at `{organisation_id}/logo`. The bucket allows PNG, JPEG, WebP, and GIF up to 2 MB. Storage policies use `private.organisation_logo_allowed`, so only a member of that organisation can read or replace the file. The app serves it through `/organisation-logo/{organisation_id}` after checking membership.

## Account structure

These tables are the lists under Admin. Each has `tenant_id`, `organisation_id`, `code`, and `description` (description 1–200). `code` matches `^[A-Z0-9][A-Z0-9.-]{0,19}$`, so it starts with a letter or number and may then contain `.` and `-`, except products, which allow 30 characters. `(organisation_id, code)` is unique. The code cannot be changed after the row is saved.

### `bank_accounts`

The organisation's own bank accounts. Every payment and receipt is recorded against one. It has the standard scoping and audit columns and the same code rule as the lists above, with these columns:

| Column | Rule |
| --- | --- |
| `code`, `name` | Code unique per organisation and fixed after save. Name 1 to 100 |
| `iban` | Spaces removed and uppercased on save, then checked with `private.iban_is_valid`. Unique per organisation on the stored value |
| `bic` | Optional, 8 or 11 characters, checked by `private.prepare_bic` |
| `currency_id` | One of the organisation's currencies, by a composite key on `(organisation_id, currency_id)` |
| `gl_code_id` | Required, a Current Asset GL code of its own with no system role, unique per organisation. A bank account saved without one is given a new code (`1210` and up, named "Bank: {name}") |
| `active` | Default true. An inactive account cannot be the default |
| `is_default` | At most one default per currency, by a partial unique index. Setting a default clears the previous one for that currency in the same statement. Making a default account inactive clears its flag |

Members read the table. Owners and admins write it. `private.enforce_bank_account` does the scope check, the normalisation, the GL type check and the default rule. The `tenant_id` key cascades, as for the other lists, so a tenant that holds only bank accounts can still be deleted. Payments and allocations use `ON DELETE RESTRICT` on their own `tenant_id` key, so a tenant with payments cannot be deleted. The migration `20261113103237_bank_accounts` creates a `MAIN` account in the home currency from each organisation's IBAN, and leaves the organisation's own IBAN in place because invoices still show it (BT-84). `supabase/tests/bank_accounts.sql` checks the rules.

### `gl_codes`

`account_type` is required and is one of Fixed Asset, Current Asset, Current Liability, Non-current Liability, Equity, Income, Cost of Sales and Expense. The ledger spec groups them into report sections and gives each a normal balance (`private.account_normal_balance`).

A product's purchase GL code must be Expense or Cost of Sales. Its sales GL code must be Income. A trigger stops an account type from being changed while a product still uses that code in the matching role. A purchase invoice line may use any type, so assets and prepayments can be bought.

A GL code also has `active` (an inactive code cannot be used on a new line), `external_code` and `external_name` (the account in another accounting system, used by the feed), `report_group` (reserved for the reports spec) and `system_role`. See "General ledger foundation".

### `departments` and `cost_centres`

Code and description only. Both can be left empty on a purchase line.

### `vat_rates`

| Column | Meaning |
| --- | --- |
| `rate` | Percentage from 0 to 100, two decimal places |
| `vat_type` | `Sales` or `Expense` |
| `vat_category` | EN 16931 category, such as `S` standard or `E` exempt. Standard must be above zero. Categories marked zero-rate must be 0 |
| `exemption_code`, `exemption_reason` | Required for exempt, reverse charge, intra-community, export, and outside-scope categories. At least one of the two |

Purchase VAT on a product, and VAT on a purchase line, must be an Expense rate. Sales VAT on a product must be a Sales rate. A category used on a posted or void line cannot be changed. Existing rates above zero were set to `S`. There were no zero-rated codes.

### `products`

| Column | Meaning |
| --- | --- |
| `purchase_price`, `sales_price` | Zero or greater, four decimal places |
| `purchase_gl_code_id` | An Expense GL code in this organisation |
| `sales_gl_code_id` | An Income GL code in this organisation |
| `purchase_vat_code_id` | An Expense VAT rate |
| `sales_vat_code_id` | A Sales VAT rate |
| `unit_code` | EN 16931 unit. Defaults to `C62`, one. A blank unit is stored as `C62` |

Choosing a product on a purchase line copies its purchase price, unit, Expense GL code, and Expense VAT rate. Those can then be changed on the line.

### `customers` and `suppliers`

Both have the same shape.

| Column | Meaning |
| --- | --- |
| `code`, `name` | Code as above, and read-only after the row is saved. Name 1–200 |
| `currency_id` | Required. One of this organisation's currencies |
| `phone`, `email`, `website`, `address` | Optional, with the same checks as the organisation profile |
| `contact_details` | Optional, up to 500 |
| `notes` | Optional, up to 4000 |
| `payment_terms_days` | Optional whole number from 0 to 365 |
| `default_buyer_reference` | Customers only. Optional, up to 100. EN 16931 BT-10 |

A supplier's currency becomes the currency of a purchase document and cannot be edited on the document. A customer's currency becomes the currency of a sales document in the same way.

A new sales draft copies blank fields from its customer. A blank buyer reference takes `default_buyer_reference`. When `payment_terms_days` is set, a blank due date becomes the document date plus that many days, and blank payment terms become “Due on receipt” for 0, “Payment due within 1 day” for 1, or “Payment due within N days”. Values already entered are left as they are. Purchase drafts are not filled from the supplier.

## Transaction types

`transaction_types.type` is `Sales` or `Purchases`. `document_kind` is `invoice`, `credit_note`, `order`, `requisition`, `payment` or `receipt`. The last two number payments, which are not documents (see Payments and settlement).

| Column | Meaning |
| --- | --- |
| `code`, `description` | The short code shown in menus, read-only after the row is saved, and the name used as the page title |
| `document_kind` | Invoice, credit note, order, requisition, payment or receipt. A description containing “order” was set to order. The kind cannot change after a document or payment has been entered |
| `last_reference` | The last number issued for this type. New types are forced to 0 |
| `flex1_label` … `flex5_label` | Optional labels, up to 80 characters. A blank label hides that flex field on the document |

An order stores header totals. Later VAT reporting leaves orders out, and an order is never exported. A credit note, sales or purchase, needs the preceding invoice reference before it can be posted.

`reference_prefix` is optional, up to 10 characters, using letters, digits, `-`, `/`, and `.`. `reference_padding` is 0 to 10. Together they form the printed document number when a reference is issued: the prefix, then the reference padded with zeros. Padding 0 leaves the reference as written. The number is stored on the document and does not change if the prefix or padding is edited later.

`last_reference` only moves forward. An update may set it to the previous value plus one. Any other change is put back. Deleting a document does not give the number back.

The header insert trigger is what advances it: it adds one and stores that number as the document reference. The first document of a type is reference 1.

### Transaction type codes

Every transaction type code has three characters. The first is the direction, `S` for Sales or `P` for Purchases. The other two say what the record is:

| Kind | Letters | Sales | Purchases |
| --- | --- | --- | --- |
| Requisition | `RQ` | none | `PRQ` |
| Order | `OR` | `SOR` | `POR` |
| Invoice | `IN` | `SIN` | `PIN` |
| Credit note | `CN` | `SCN` | `PCN` |
| Receipt | `RC` | `SRC` customer receipt | none |
| Payment | `PY` | none | `PPY` supplier payment |
| Refund | `RF` | `SRF` customer refund | `PRF` supplier refund |

`RF` is used for the types that settle a credit note. In the database those are the payment kind on Sales (money out to a customer) and the receipt kind on Purchases (money in from a supplier). A new kind takes a new two-letter code and needs no exceptions. The printed number prefix is the code and a hyphen (`SIN-`, `SRC-`). It is separate from the code, so a type may have no prefix or a different one. The app does not read a code to decide what a type is: the kind and direction columns do that. The migration `three_character_type_codes` renamed the types of the standard sets, which earlier used `SI`, `PI`, `REC` and similar. It renames a type only when its code, direction and kind were the standard ones, and changes a prefix only when it was still the old default. The hidden types made by the typed paid amount migration were first coded `MIGREC`, `MIGPAY`, `MIGCREF` and `MIGSREF`. The migration `three_character_migrated_type_codes` renamed them. They are not part of the standard set, because an organisation may have a customer receipt of its own, so they read as the direction, then `M` for migrated, then the first letter of what they are: `SMR` migrated customer receipt, `PMP` migrated supplier payment, `SMF` migrated customer refund and `PMF` migrated supplier refund. Their `MIG-` prefix stays, because the numbers already issued carry it. A link or bookmark that still uses an old standard code (`/transactions/SI`, `/print/SI/…`, `/forms/SI`) is sent to the current one, from `src/lib/legacy-type-codes.ts`.

## Purchase documents

`transaction_headers` is one document. `transaction_lines` are its lines. A sales invoice, sales credit note, or sales order can be saved here. A purchase requires a supplier and cannot name a customer. A sale requires a customer and cannot name a supplier. The document currency must be the party's currency. A supplier invoice number is only stored on a purchase.

The app writes both tables through `save_document(jsonb)`. Direction comes from the transaction type. The function checks the organisation, the party, the currency, and the codes, copies blank product fields from the purchase or sales side of the product, replaces the lines, and lets the triggers calculate amounts. A new sales draft with an empty buyer reference, due date, or payment terms takes those from the customer. When the document date later changes and the due date is still the one derived from the customer's terms, the due date moves with it. A value sent in the payload is left as it is.

### Header

| Column | Meaning |
| --- | --- |
| `transaction_type_id` | A Sales or Purchases type, which sets the direction. Cannot be changed after insert |
| `reference` | Issued from `last_reference`. Unique per organisation and type. Cannot be renumbered |
| `transaction_date` | Required |
| `due_date` | Optional |
| `supplier_id`, `customer_id`, `party_name` | The supplier or the customer, and the name stored on the document |
| `document_number` | The printed number, set when `reference` is issued. Unique per organisation and type |
| `contact_details` | Optional, up to 500 |
| `notes` | Optional, up to 4000 |
| `currency_id`, `exchange_rate` | The supplier's currency, and the rate used for this document |
| `order_number` | Optional, up to 40 |
| `supplier_reference`, `supply_date` | Purchases only: the supplier's own invoice number, up to 60, and the supply date. See below |
| `preceding_header_id` | Optional link to a posted invoice in this organisation, for the same supplier. Another organisation is refused |
| `preceding_reference`, `preceding_date` | The invoice reference and date a credit note applies to. Copied from the linked invoice when left blank |
| `buyer_reference` | Optional, up to 100. EN 16931 BT-10 |
| `contract_reference` | Optional, up to 60. EN 16931 BT-12 |
| `payment_terms` | Optional, up to 400. EN 16931 BT-20 |
| `invoice_period_start`, `invoice_period_end` | Both set, or both empty. The end is not before the start. EN 16931 BG-14, BT-73 and BT-74 |
| `payment_means_code` | Optional UNCL4461 code. EN 16931 BT-81. A purchase is not given one automatically |
| `foreign_nett_amount` | Sum of the line nett amounts, rounded to 2 decimal places |
| `foreign_vat_amount` | Sum of the VAT breakdown, not the sum of the line VAT amounts |
| `foreign_total_amount` | Nett plus VAT |
| `rounding_amount` | Optional rounding, editable on a draft. Included in the amount due |
| `amount_due` | Total minus paid, plus rounding. Worked out by settlement, never typed. A draft owes its whole total |
| `home_nett_amount`, `home_vat_amount`, `home_total_amount` | Each foreign figure divided by `exchange_rate` and rounded to 2 decimal places |
| `paid_amount` | Calculated from effective allocations (see Payments and settlement). Nobody types it: `save_document` refuses a `paidAmount`, a draft always has 0, and on a posted document only settlement may change it. On a credit note the same figure is shown as Applied |
| `home_amount_due` | Home total less the home amount of every effective allocation. Written by settlement |
| `paid_at_posting` | The paid amount when the document was posted. Every e-invoice reads this, so a generated e-invoice never changes (BT-113, BT-115) |
| `supplier_stated_paid_amount` | BT-113 on an imported e-invoice. Information only. It is never allocated or counted |
| `status` | `draft`, `posted`, or `void` for an invoice or credit note. `draft`, `open`, `closed`, or `cancelled` for an order or requisition. Existing documents were marked posted when this column was added |
| `posted_at`, `posted_by` | Set when the document is posted |
| `voided_at`, `voided_by`, `void_reason` | Set when an owner or admin voids a posted document. The reason is required |
| `closed_by_system` | On an order, true while it is closed because posted invoices cover every line. Closing by hand, or reopening, sets it false. Only a closure made by the system is undone by the system, when a posted invoice is voided or a credit note returns quantity to the order |
| `flex1` … `flex5` | Optional text, up to 200. Shown only when that type has a label |

A draft can be edited and deleted. Posting needs at least one line and is allowed for any member. Purchases are numbered when the draft is saved. A type set to number on posting, which every Sales type must use, leaves the draft without a number and issues the next number when it is posted. The type row is locked first. Sales readiness is checked before that number is taken, so a failed post does not use a number. Deleting a sales draft does not use a number. A posted purchase can be voided by an owner or admin. A posted sales document cannot be voided; the correction is a credit note. A void document cannot be changed or deleted. Status changes only through `post_document` and `void_document`.

An order or a requisition is not posted. The transaction type kind decides the lifecycle. An invoice or credit note goes draft, posted, void. An order or requisition goes draft, active, closed. The active status is stored as `open` and shown to people as Active, because open also means looking at a document. An active one can be cancelled, and a closed one can be reopened. A cancelled one cannot be reopened. A requisition is a Purchases document and is the step before a purchase order. An active order can still be changed, lines included. A closed or cancelled order cannot. Only a draft order can be deleted. The period lock does not apply to orders and requisitions, and they are not exported as EN 16931 invoices. Activating needs at least one line and is allowed for any member. A type numbered on posting gets its number when the order is activated. The status of an order changes only through `set_order_status(header_id, action)`, where the action is `open`, `close`, `reopen` or `cancel`. `post_document` refuses an order and `set_order_status` refuses an invoice. Posting details (`posted_at`, the snapshots) are only required on posted and void documents.

A button that posts a document, changes an order's status or creates another document from it saves any unsaved changes first and then acts, in one step. If the save fails, the action does not run. An order closes by itself when posted invoices cover every line. Each order line shows Invoiced (posted invoice quantity less quantity returned by credit notes), Reserved (quantity on draft invoices) and Left. A draft invoice holds its quantity so an order cannot be over-invoiced, and Worth a look flags a draft that has held quantity for more than 14 days. An order the system closed reopens by itself when one of its invoices is voided, or when a credit note line marked Return to order is posted, and something is left to invoice. An order a person closed stays closed, and Worth a look lists it under Closed orders with quantity left. A credit note line returns quantity to the order only when it is linked to an invoice line that came from that order, is marked Return to order and the credit note is posted. A price-only credit leaves Return to order unticked and gives nothing back. The quantity credited against an invoice line, on draft and posted credit notes together, cannot exceed that line. A credit note that returned quantity cannot be voided once that quantity has been invoiced again.

A requisition becomes a purchase order and an order becomes one or more invoices. `create_from_order(header_id, type_id)` starts a draft from an active order or requisition. Each new line stores the line it came from in `transaction_lines.source_line_id`. An invoice started from an order begins with what is left on each line. `order_number` is the buyer's purchase order number (BT-13) and `sales_order_reference` is the seller's own order number (BT-14). An invoice from a purchase order takes that order's number as its order number. An invoice from a sales order takes the customer's order number entered on the sales order as its order number, and the sales order's number as its sales order reference. Both fields hold up to 200 characters, because an invoice can draw on several orders of the same supplier or customer and then lists each number. A line can also hold `order_line_reference`, the line of the buyer's purchase order it answers (BT-132), up to 60 characters. An order line cannot be invoiced for more than its quantity. Draft and posted invoices count towards that, a void invoice does not, and the measure is quantity, not value. The order line is locked while this is checked. A requisition does not limit the orders made from it. The invoice must be for the same supplier or customer as the order, and both must be purchases or both sales. An order line cannot be reduced below what is invoiced from it, and a line another document came from cannot be removed. An order that another document came from cannot be cancelled. It is closed. An order closes by itself when an invoice is posted and posted invoices then cover every line. A draft invoice does not close it. Voiding an invoice later does not reopen the order. It is reopened by hand. `save_document` now keeps the id of each line it replaces, so these links survive a save. The foreign key on `source_line_id` is deferred and `save_document` checks it before it returns.

Posting a sales document also requires an Income GL code on every line, and a document date no later than tomorrow. A credit note linked to an invoice in Qula Plus, sales or purchase, must use the same currency. The posted credits against that invoice, including the one being posted, cannot exceed the invoice total with VAT. The invoice row is locked while that is checked. A credit note that only names an invoice from outside Qula Plus is not limited.

Posting copies the organisation and the supplier into `issuer_snapshot` and `party_snapshot`. Those copies do not change if the organisation or supplier is edited later. A new posting also stores the structured address, country, Peppol scheme and identifier, VAT number, and company number. The issuer copy adds the IBAN, BIC, and bank account name. Documents posted before these fields existed keep the snapshot they already had. When a sales document is posted and the organisation has an IBAN, a blank payment means becomes `58` (SEPA credit transfer). A means already chosen is left. Purchases stay unset. Missing buyer reference, order number, due date, payment terms, Peppol ID, or address does not block a purchase. Those gaps are warnings. The same gaps block a sales document. Documents that were already posted when snapshots were added were filled from the data at that time, including the live logo path. A new posting copies the logo to `{organisation_id}/snapshots/{header_id}` first, and does not post if that copy fails. Each line stores `vat_percentage`, the VAT category, and any exemption from the VAT code at the time the line is saved. A line with no VAT code is category `O`. Line nett is rounded to 2 decimal places. Line VAT is kept for display. Document VAT is one row in `transaction_vat_breakdown` for each category and rate: the taxable amount times the rate, rounded to 2 decimal places. A posted document keeps the totals it had when it was posted. A VAT code used on a posted or void line cannot have its rate, type, or category changed. Customers and suppliers have an optional `vat_number`.

A purchase document stores an optional supplier invoice number and supply date. The same supplier invoice number cannot be entered twice for one supplier, ignoring case, unless the first document has been voided. Sales documents leave the supplier invoice number empty.

Codes may contain dots and hyphens after the first character. The first character is a letter or number. Products may be 30 characters. Other codes may be 20.

An owner can delete an organisation that has no documents, unless it is the last organisation in the tenant. The app then removes its logo files. There is no direct delete of an organisation from the API.

A saved form layout is checked in the database. A sales form must show the organisation name, address, and VAT number, the customer name and address, the document number and date, the line description, quantity, price, tax, and amount, and the VAT summary. A sales credit note must also show the preceding invoice. A purchase credit note may leave that field off the form; posting still requires the reference. The standard layout meets the sales invoice rules.

`organisation_defaults.lock_date` blocks creating, editing, posting, voiding, or deleting a document whose date is on or before that day. Owners and admins set the lock date.

On every header insert or update the trigger replaces the six amount columns from the lines. A new header therefore starts at zero until its lines exist. Saving a line updates the header, which runs the trigger again.

### Lines

| Column | Meaning |
| --- | --- |
| `header_id` | The document. Deleting the header deletes its lines |
| `line_number` | Starts at 1. Unique on the header |
| `transaction_type_id`, `organisation_id`, `tenant_id` | Copied from the header |
| `product_id` | Optional. Must belong to the same organisation |
| `description` | Required, 1–200 |
| `unit_code` | EN 16931 unit. Defaults to `C62`, one |
| `line_note` | Optional, up to 400 |
| `seller_item_id` | Optional, up to 60. Purchases only |
| `gl_code_id` | Optional GL code |
| `department_id`, `cost_centre_id` | Optional |
| `vat_rate_id` | Optional. A purchase line must use an Expense rate. A sales line must use a Sales rate. If null, VAT is 0 |
| `quantity` | Greater than 0 |
| `price` | Zero or greater |
| `discount_amount` | Zero or greater, and not more than quantity × price |
| `source_line_id` | The order or requisition line this line was started from. A line that another document draws on cannot be removed |
| `credited_line_id` | On a credit note line, the invoice line it credits. The invoice must be the one the credit note applies to. Only a credit note line can set it |
| `returns_to_order` | True when crediting the line gives its quantity back to the order the invoice line came from. Needs `credited_line_id` and a line that came from an order. It counts only once the credit note is posted, and voiding that credit note is refused if the quantity has since been invoiced again |
| `nett_amount` | quantity × price − discount. Set by trigger |
| `vat_amount` | Nett × VAT percentage. Set by trigger |

The screen may show a calculated nett and VAT before save. The stored figures are the ones the trigger writes.

## Payments and settlement

A payment is money paid out and a receipt is money in. Both live in `payments`, which is not a document table: a payment never becomes a transaction header, and a header cannot be given a payment type (`private.refuse_payment_kind`). Money is applied to documents by `allocations`. Nothing else writes a paid figure.

### Payment types

`transaction_types.document_kind` also takes `payment` and `receipt`. A type of that kind numbers payments, with the same prefix, padding and numbering rule as a document type. The direction is the type's Sales or Purchases:

| Type | Kind | Direction | Settles |
| --- | --- | --- | --- |
| Customer receipt (`SRC`) | receipt | Sales | Sales invoices |
| Supplier payment (`PPY`) | payment | Purchases | Purchase invoices |
| Customer refund (`SRF`) | payment | Sales | Sales credit notes |
| Supplier refund (`PRF`) | receipt | Purchases | Purchase credit notes |

The codes follow the coding system for every transaction type (see Transaction type codes). An owner or admin is offered these four on the Transactions menu when the organisation has none. `is_system` marks types made by a migration (`SMR`, `PMP`, `SMF` and `PMF`, for figures typed before settlement existed). People cannot create, edit or delete them, and they are left off the Transactions menu and the transaction type admin list. The kind and direction of a type cannot change once a payment uses it.

### `payments`

| Column | Rule |
| --- | --- |
| `transaction_type_id`, `reference`, `document_number` | The type, and a number issued as for documents. A draft has none when the type numbers on post |
| `status` | `draft`, `posted` or `void`. Only posting and voiding change it |
| `source` | `manual`, or `migrated` for a payment made from a typed paid amount |
| `payment_date`, `customer_id` or `supplier_id`, `party_name` | One party, matching the type's direction. The name is copied from the party |
| `bank_account_id` | Required for a manual payment. Active, in the payment currency |
| `currency_id`, `exchange_rate`, `amount`, `home_amount` | The currency is the party's. The rate is 1 in the home currency, and read-only there. Home amount is amount divided by rate |
| `allocated_amount`, `unallocated_amount`, `home_unallocated_amount` | Written by settlement only |
| `payment_means_code`, `bank_reference`, `notes` | UNCL4461 code (default `58`), up to 140, up to 4000. On a posted payment only the notes and bank reference change |
| `posted_at`, `voided_at`, `void_reason` | Set by posting and voiding. The reason is required |

Row level security lets members read, insert drafts, and update drafts and posted rows. A void payment cannot be changed and only a draft can be deleted. `private.enforce_payment` holds every other rule.

### `allocations`

An allocation applies part or all of a payment, a receipt or a credit note to an open invoice or credit note. People cannot write the table: the functions below do, and `private.enforce_allocation` checks every rule.

| Source | Allowed target |
| --- | --- |
| Customer receipt | Posted sales invoice |
| Supplier payment | Posted purchase invoice |
| Customer refund | Posted sales credit note |
| Supplier refund | Posted purchase credit note |
| Posted sales credit note | Posted sales invoice |
| Posted purchase credit note | Posted purchase invoice |

- Source and target are in the same organisation, for the same party, in the same currency. A credit note is never the target of another credit note.
- **Effective** means not pending and not removed. A draft payment holds **pending** allocations, which do nothing until it posts. A removal is recorded with a reason and who made it. An allocation is never edited or deleted once effective.
- Over-allocation is refused. An invoice cannot be allocated more than its total plus rounding. A payment cannot allocate more than its amount. A credit note's allocations as source plus as target cannot exceed its total plus rounding.
- The allocation date is the later of the two documents, or later. It must not fall in a locked period. The lock date applies to the allocation, so settlement may update a document dated inside a locked period.
- Home amounts are set at both rates and the difference is stored as `exchange_difference` (gain positive). It is kept for the accounting integration and posted nowhere. The allocation that settles a document, or uses up a payment, takes the home balance that is left.
- Every function that allocates locks the source row, then each target in id order, before it reads what is open.

### Settlement

`private.refresh_settlement` is the one place that writes `paid_amount`, `amount_due` and `home_amount_due` on a posted document and the allocated figures on a payment. An invoice's paid amount is the sum of effective allocations targeting it. A credit note's is the same plus those where it is the source. A trigger calls it for both sides after every insert, removal or change of `pending`. While it runs, `fintran.settlement` is set so that the posted-document guard accepts those columns, the audit columns are left alone, and the audit log skips a header update that changes only them. The allocation rows are audited instead. Void documents are never refreshed.

### Functions

| Function | What it does |
| --- | --- |
| `save_payment(jsonb)` | Inserts or replaces a draft and its pending allocations. Security invoker |
| `post_payment(id)` | Checks every planned allocation against what is open now, numbers the payment, and makes the allocations effective. Fails with the list of documents that no longer have enough open |
| `void_payment(id, reason)` | Owners and admins. Removes every effective allocation with the reason, then voids |
| `delete_payment(id)` | Deletes a draft and its pending allocations |
| `allocate`, `allocate_lines`, `allocate_oldest_first` | Allocate from a posted payment or credit note, one document, several in one step, or oldest due date first |
| `remove_allocation(id, reason)` | Removes an effective allocation |
| `replace_pending_allocations` | Used by `save_payment`. It is in `public` because that function runs with the caller's rights and cannot reach `private` |

`post_document` fixes `paid_at_posting`, then applies a credit note to its preceding invoice, up to what is open on the invoice. `void_document` is refused while the document has an effective allocation. Voiding a purchase drops pending ones.

### Typed paid amounts

Before settlement the paid amount was a figure typed on the document. The migration `remove_typed_paid_amount` turns each posted document with such a figure into a migrated payment and one allocation, so its paid amount and amount due come out as they were, and clears the figure on drafts. It reports every decision as a notice, checks every posted document afterwards, and does nothing on a second run. A document typed as paid for more than its total is allocated up to its total and the rest stays on the migrated payment.

## Purchase approvals and price tolerance

An organisation can require approval before a purchase order is activated or a purchase invoice is posted. It is off until an owner or admin sets a rule, and with no rule nothing changes for anyone. The design is in `specs/QULAPLUS_APPROVALS_SPEC.md`.

**Rules.** `approval_rules` holds, for one purchase invoice type or one purchase order type, an amount in the home currency and the role that must approve at or above it, `admin` or `owner`. Several rules on a type make a ladder: the highest amount not above the document's total with VAT (`home_total_amount`) applies. An owner can approve anything an admin can. Requisitions, credit notes, sales documents and payments are not covered, and a rule cannot be made for them. Voiding a posted purchase stays with owners and admins, as before.

**Asking and deciding.** A member asks with `request_approval` and an admin or owner (an owner only, for an owner rule) decides with `approve_document` or `reject_document`. A refusal needs a reason. The person who asked cannot decide, unless no one else in the organisation has a high enough role. Then they can, and `approval_self` records it. Once approved, any member can post or activate it.

**What holds back.** `post_document` and the Activate action of `set_order_status` call `private.require_approval`, so every route to posting passes through it: the Post button, Save and post, Ask Qula's confirmed post and a draft made by importing an e-invoice. The messages say what to do: "This document needs approval from an admin or owner. Request approval first.", "Waiting for approval from an admin or owner." and "Approval was refused: {reason}.". Saving, editing and deleting a draft stay free.

**A change cancels an approval.** The header keeps a fingerprint of the document and its lines (`approval_hash`) from when approval was asked for. A request, an approval or a refusal counts only while the document still gives the same fingerprint, so any change to a line, a price, the supplier or the date means it needs approval again. Saving a document without changing it does not. A rule raised after an approval, so that a higher role is needed, has the same effect. The approval columns are written only by the three functions and cannot be changed on a posted document.

**Price tolerance.** The organisation can set a percentage (`price_tolerance_percent`, with the lock date). A purchase invoice line that came from an order line is compared with it by unit price after any discount. A line is over when its price is higher than the order's by more than the percentage. A lower price is never over, and a line typed in with no order line is not compared. `price_checks` gives the figures for the screen. If the invoice's type has approval rules, and `price_tolerance_needs_approval` is on, an invoice with a line over the tolerance needs approval from an admin or owner whatever its amount. Otherwise it is a warning only. Everything about approval is recorded in the audit log with its note.

**Screens.** Owners and admins set the rules under Admin, Approval rules, and the tolerance percentage and its switch on the Organisations screen. On a draft purchase document that needs approval the status row says what is needed, and the Post or Activate button is replaced by Request approval (Save and request approval when there are unsaved edits, which saves first). On a requested document an approver with a high enough role sees Approve and Refuse, and Refuse asks for the reason. A line over the tolerance is marked "Over order price" on a purchase invoice. A purchase list shows an Approval column and filter only when a draft in it needs approval.

**Worth a look and the home page.** Worth a look lists documents waiting for the person's approval, with the oldest and its amount, and the person's own documents that were refused, with the reason. The home page shows the number waiting for the person, and only when it is above zero.

**Ask Qula.** The card for posting a draft that needs approval gives the reason and has nothing to confirm, because Ask Qula cannot ask for, give or refuse approval. Searching shows each draft's approval and can list those that need it, are waiting, approved or refused. An imported draft is no different from any other draft.

**Email.** Asking for approval queues an email to every person with a high enough role except the person asking. Approving or refusing queues one to the person who asked, with the note or reason and a link, unless they decided it themselves. Owners and admins can switch approval emails off on the Organisations screen. No mail provider has been chosen, so the only adapter is a mock that records the email as sent and delivers nothing, and the Organisations screen says so. A failed email never stops an approval, a refusal or posting. Owners and admins see failed emails on the Approval rules screen.

## Payment approvals

A payment that sends money out, a supplier payment or a customer refund, can need approval before it is posted. Receipts and supplier refunds, which bring money in, never do. It is off until an owner or admin sets a rule or a bank change window, and with neither nothing changes for anyone. The design is in `specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md`.

**Rules.** The Approval rules screen offers payment types of the money-out kind as well as purchase invoice and order types. For a payment type, an amount in the home currency and the role that must approve at or above it, `admin` or `owner`, as a ladder. The amount compared is the payment's home amount.

**Bank details.** A payment to a supplier whose bank details changed inside the bank change window (Organisations screen) needs an admin or owner whatever its amount, with or without amount rules. The reason says so. A customer refund is never held for this.

**Asking and deciding.** A member asks, and an admin or owner (an owner only, for an owner rule) decides, with a reason when refusing. Unlike documents, the person who asked can never decide, even when they are the only person with a high enough role. An organisation with one owner and no admin has to add a second person to approve its own large payments. Once approved, any member can post it.

**What holds back.** `post_payment` is the only way a payment becomes posted, and it refuses a payment that needs approval and has not got it, with a message that says what to do. Saving, editing and deleting a draft stay free.

**A change cancels an approval.** The fingerprint covers the payment (who, the bank account, the date, the amount and rate, the means and reference) and its planned allocations. Any change means it needs approval again. Saving without a change does not.

**Screens.** The payment form shows what is needed in the status row, replaces Post with Request approval (Save and request approval when there are unsaved edits), and shows Approve and Refuse to someone who may decide, never to the person who asked. A payments list shows an Approval column and filter only when a draft needs approval. Worth a look and the home page count include payments waiting for the person, and their own refused ones. Emails use the same adapter, switch and failed-email list as documents.

## Payment runs

A payment run pays several posted purchase invoices at once. It is under Transactions, Payment runs. Anyone in the organisation can see runs and make one. A run has one payment type (a supplier payment type), one bank account, one currency and one payment date, and a number such as RUN-0001.

**Making a run.** Add shows the posted purchase invoices that have something open in the bank account's currency and are not already in a draft run, with a filter for due on or before a date. Tick the invoices and make the run. It creates one draft payment for each supplier, which allocates the full amount open on each chosen invoice. Nothing is taken off an invoice until the run posts. Part payments and mixed currencies are not offered.

**The run screen.** It lists each supplier's payment with its IBAN and the invoices paid, the status row, and the buttons. While the run is a draft a supplier can be taken out (its payment stays as an ordinary draft), the run can be cancelled (its draft payments are deleted and every invoice is free again) and the run exports to Excel with each supplier's IBAN, BIC, account name, amount and invoices. There is no bank file: the money is paid outside Qula Plus.

**Approval.** The run is approved as a whole, not each payment. The rules of the run's payment type apply to the run's total in the home currency. A run also needs an admin or owner whatever its total when any supplier in it had bank details change inside the window, and the screen names them. As for payments, the person who asked can never approve, and any change to the run or to a payment or allocation in it cancels the approval. A payment that belongs to a run needs no approval of its own and cannot be posted on its own: the message says to post the run.

**Posting.** Post run posts every payment, or none. Each payment is checked against what is open on its invoices at that moment, so an invoice paid somewhere else since the run was made stops the whole run, and the message lists what is short. The run is then posted. A posted run cannot be changed, and voiding one of its payments is done on that payment as before.

**Elsewhere.** Worth a look, the home page count and the approval emails treat a run like a payment. Ask Qula can list runs and their approval, and cannot post a payment or a run or ask for approval.

## Supplier bank details

A supplier can hold an IBAN, a BIC and a bank account name, set on the supplier form under Bank details. The IBAN and BIC are checked and tidied the way an organisation's own bank accounts are: an IBAN is stored in capitals without spaces, and a wrong IBAN or BIC is refused. All three are optional, and any member who can edit a supplier can change them.

Every change to one of them, from a value that was already set, is recorded with the old and new values and who made it. Setting the details for the first time is not a change. Owners and admins see the latest changes on the supplier form, with the IBAN shortened to its first and last four characters, and in the audit log. Nobody can write the history directly.

The Organisations screen has a bank change window in days, from 1 to 90, blank for off. While a supplier's details changed inside the window, a payment to that supplier needs approval (see Payment approvals). Blank by default, so nothing changes until an owner or admin sets it.

## Reports

Reports is on the main menu, below E-documents. It lists the reports: Aged debtors and Aged creditors. Anyone in the organisation can open them.

### Aged debtors and creditors

Aged debtors (Sales, what customers owe) and Aged creditors (Purchases, what is owed to suppliers) list the parties with a balance, largest first, in the home currency, in five bands. A choice at the top, Age from, says what the age counts from.

- **Due date** (the default): not yet due, then 1 to 30, 31 to 60, 61 to 90 and over 90 days past the due date. A band starts the day after the due date, so an invoice due on the ageing date is not yet due. A document with no due date counts as due on the day.
- **Transaction date**: 0 to 30, 31 to 60, 61 to 90, 91 to 120 and over 120 days since the document's transaction date.

The balance is what is still due on posted documents (`home_amount_due`, after every allocation). A posted credit note with a balance is taken off, and a posted receipt or payment with money not yet applied is shown in an On account column and taken off the total, so a party's total is what they really owe. Money on account is not aged. Voided and draft documents are left out.

The ageing date is set on the page and defaults to today. Balances are always as they stand now: moving the date moves amounts between the bands and does not rewind payments. The top of the page shows the totals for each band and what is owed in all, and the grid ends with a totals row that adds up the parties shown, so a search narrows the total too. A row's Documents button lists what makes up the party's balance, each with a link to open it and its age on the chosen basis. The grid searches, sorts and exports to Excel like the other lists. Only the first 5,000 documents are read, and the page says so when that limit is reached. Ask Qula's ageing lookup uses the due date bands (`bandOf` in `src/lib/aged.ts`), so its figures agree with the report when it is set to due date.

## General ledger foundation

Qula Plus is gaining a double-entry general ledger that works as the book of record or as a feed to another accounting system (`specs/QULAPLUS_LEDGER_SPEC.md`). This describes releases A and B, which are built: the chart of accounts, the mode setting, the journal tables, posting, the backfill and the reconciliation. Release B runs in **shadow mode**: the ledger is written and checked, and nothing a person does is refused that was allowed before. The requirements that change what people can do (a GL code on every line, the period rules), manual journals, the screens and the feed are releases C and D.

**System roles.** `gl_codes.system_role` is the one place the ledger's accounts are stored. Each organisation has exactly one code for each of eight roles, and the code's account type must match: `debtors_control` (Current Asset), `creditors_control` (Current Liability), `vat_output` (Current Liability), `vat_input` (Current Asset), `retained_earnings` (Equity), `fx_difference` (Expense), `rounding` (Expense) and `suspense` (Current Asset). A new organisation gets default codes (`1100`, `2100`, `2200`, `1200`, `3200`, `7900`, `7910` and `9990`, with `-1`, `-2` added when a code is taken). `set_system_role(organisation, role, gl code)` moves a role. It is for owners and admins and refuses a code of the wrong type, one that already has another role, an inactive one and, for the two control roles, one used on a document line or a product. A code that holds a role cannot be deleted or made inactive, and its account type cannot change. Once any journal line uses a code, its role cannot change.

**Control accounts.** The debtors and creditors control accounts may only be used by the system. A document line, a product or a manual journal cannot use one, and neither can an inactive code on a new line.

**The Accounting tab columns are a mirror.** `accounting_settings` still holds the old role columns because the journal export reads them until it is refitted on the ledger. They are written only by a trigger that follows `system_role`, and a direct write is refused with "Use set_system_role". The start date is still written there. The Accounting tab reads and writes the roles through `set_system_role`.

**The migration.** `private.ledger_role_problems()` lists, and the migration stops on, a choice whose account type does not match its role, one code chosen for two roles, a control account already used on a document line or a product, and bank accounts that share a GL code. `private.ledger_adopt_roles()` then gives each existing choice its role, creates the default account for every role that has none, and gives each bank account without a GL code one of its own.

**Mode and period columns.** `organisation_defaults` has `ledger_mode` (`feed` or `book`, default `feed`), `ledger_start_date`, `lock_exported` and `exported_through`. The mode and the exported-through date are changed only by the system (a trigger refuses a hand edit), and the date only moves forward. Owners and admins set the go-live date and the lock switch.

**Journal tables.** `journal_entries` is one balanced posting: a date, a source (`document`, `payment`, `allocation`, `manual` or `reversal`), a number from a per-organisation counter (`ledger_counters`, written only by `private.next_entry_number`) and a status. `journal_lines` are its debits and credits to GL codes, in the home currency, with the document currency amount and rate, optional department, cost centre, customer or supplier, and the VAT category, percentage and taxable amount on VAT lines. A constraint trigger deferred to the end of the transaction refuses a posted entry with fewer than two lines or whose debits differ from its credits. A posted entry and its lines cannot be updated or deleted by anyone, even the table owner, and an entry is reversed at most once. An entry dated on or before the lock date is refused, except by the backfill (a migration-only setting). Nobody writes the tables through the API: they have no insert, update or delete privilege, and the functions and triggers that will post set `fintran.ledger_post`. Owners and admins read them, and members read none. They are not copied into the audit log. An organisation with journal entries cannot be deleted.

**Posting (release B).** Entries are made by triggers, so every route to a posted state is covered, including payment runs, imports, Ask Qula and the automatic credit note application. If the ledger posting fails, the whole action fails and uses no number.

- **A document** becomes `posted`: one `document` entry dated the document date. Lines and VAT are debits on a purchase invoice and a sales credit note, and credits on a sales invoice and a purchase credit note, and the control line (debtors for sales, creditors for purchases, with the customer or supplier set) takes the other side. The header's home nett is spread over the lines in proportion to their nett, and its home VAT over the VAT breakdown rows, in cents by largest remainder, so the parts add up exactly. Each VAT line records its category, percentage and taxable amount. The control line is the home total plus the home value of the rounding amount (BT-114), and the rounding account takes whatever is left, so every entry balances. A document worth nothing makes no entry. Orders, requisitions and drafts make none.
- **A line with no usable GL code** (none, or one made inactive after the line was entered) posts to the suspense account with ` (no GL code)` or ` (inactive GL code)` on its description. `ledger_suspense_lines` lists them for review. Release C refuses such a line instead (`private.ledger_strict()` becomes true).
- **A payment** becomes `posted`: money in debits the bank account's GL code and credits the control account, and money out does the opposite, for the payment's home amount. A migrated payment, which has no bank account, posts its bank side to suspense.
- **An allocation** with an exchange difference becomes effective: a gain debits the control account of its target and credits the exchange differences account, and a loss does the opposite, dated on the allocation date. A same-currency allocation posts nothing.
- **A void or a removal** posts a `reversal` that turns round the lines of the original entry with the same accounts, dimensions, parties and VAT. Its date is the entry's own date while that date is after the lock date and after the exported-through date, and otherwise the day of the void or removal (`private.reversal_date`).
- **Numbers** come from the per-organisation counter, which is locked last, so entries get consecutive numbers in posting order and two people posting at once wait for each other without a deadlock.

**Backfill.** `ledger_backfill(organisation)` (owners and admins) posts every posted or void document, payment and allocation that has no entry, in date order, marked `backfilled`, with each reversal on the date the void or removal really happened. It passes the lock date through a migration-only setting, posts nothing twice, and stops without changing anything if a posted document's home total differs from its home nett plus home VAT by more than 0.05. It also marks the rows of earlier journal batches with the entry they exported (`journal_exports.entry_id`) and sets the exported-through date to the latest batch date, so nothing already sent is sent again. The migration runs it for every organisation and prints, for each, what it posted and how many lines are on suspense.

**Reconciliation.** `ledger_reconciliation(organisation)` (owners and admins) returns one row for each check with both figures and the difference: Debtors (the debtors control balance against what customers owe, from the documents and the money not yet applied), Creditors (the same for suppliers), each bank account (its balance from system entries against its posted receipts less payments) and Balance (total debits against total credits). Worth a look adds "The ledger does not agree with customer balances" (or the failing check) for owners and admins when a difference is not zero.

## Journal export

Qula Plus has no ledger. The journal export sends what has been posted to the organisation's own accounting system as a CSV. It is under Admin, for owners and admins only: the Journal export tile is not shown to a member, and the address sends a member back to Admin. The accounts it uses are the Accounting tab of the organisation edit (see Organisation settings).

**Accounting.** One screen holds the seven accounts the journal uses, each a system role on a GL code (see "General ledger foundation"). It offers only active codes of the right account type, and it has no "not set" choice, because every organisation has all of them: receivables and payables (the control accounts), VAT on sales, VAT on purchases, exchange gain or loss, rounding and suspense, and an optional start date. The suspense account is for a posted purchase line that has no GL code, such as one on an imported e-invoice. A posted line cannot be edited, so without it that line would stop every batch for ever. With it set, the line is journalled to the suspense account and its description ends with (no GL code), so the accountant can recode it. With it blank, such a line is a problem the preview reports. It is needed only when such a line exists. Nothing dated before the start date is exported, which keeps old history out when an organisation goes live. The screen also lists the active bank accounts that have no GL code. Each bank account's own GL code is the bank line of a payment's journal.

**What a journal is.** Every journal is in the home currency and balances to the cent. A line also carries the amount in the document's currency. A sales invoice debits receivables for the total, credits each line's GL code for its nett and credits VAT on sales. A purchase invoice debits each line's GL code and VAT on purchases and credits payables. A credit note is the same with debits and credits swapped. Department and cost centre go on the lines that carry a GL code, not on control or VAT lines. A payment, receipt or refund debits or credits the bank account's GL code against receivables (sales) or payables (purchases) for the whole home amount, applied or not. A payment that settles a foreign currency document at a different rate has an exchange difference on its allocation, and each one writes its own journal between the control account and the exchange account, dated on the allocation date. A document's rounding amount goes to the rounding account. Journals are dated on the document date, the payment date and the allocation date.

**Reversals.** A purchase invoice or credit note, or a payment, that is voided after it was exported is reversed by a journal dated on the day it was voided, and an allocation removed after it was exported has its exchange difference reversed the same way. A reversal is the exported lines turned round, with the accounts and amounts they were exported with, so changing an account in the accounting settings (or a bank account's GL code) after an export does not send the reversal anywhere else. A reversal cannot be blocked by a missing account. Anything voided before it was exported is left out, and so is anything that was never posted. Orders, requisitions and drafts are never exported.

**Batches.** On the Journal export screen, Add opens a preview. Choose the "up to" date and the screen shows what cannot be exported first (a control account not set, a bank account with no GL code, a line with no GL code and no suspense account), each with a link to fix it. A journal with a problem is held back whole. With no problems, the preview shows each journal and the totals, and Create batch says how many journals and lines it will export. A batch holds everything not yet exported up to the date, whenever it was posted, so a document posted late is included in the next one. A batch is numbered `JB-0001`, cannot be changed or deleted and cannot be run again, and each journal in it is numbered `JB-0001-0007`. A mistake is corrected in the accounting system, or by reversing in Qula Plus and exporting again. The lock date stops posting in a period and does not stop exporting.

**The file.** Download gives a UTF-8 CSV with a byte order mark, named after the batch (`JB-0001.csv`), with one row for each line: batch, journal, date, account code, account name, description, debit, credit, currency, amount in currency, department, cost centre, source kind, source number and party. Amounts have two decimals. A downloaded batch is the lines as they were made, so it is the same later whatever has changed since. Text that a spreadsheet could run as a formula is made safe, as in the other exports. Setting the accounts, making a batch and downloading one are in the change history.

Not built: files shaped for Xero, Sage and QuickBooks, live connectors, an account on each VAT rate, and different control accounts for different customers, suppliers or currencies.

## Printable forms

`transaction_forms` has one row per organisation and transaction type. The `layout` column is JSON, at most 8000 characters. The page shape is fixed. The JSON chooses the title, page size, and which fields appear, in order, inside each band.

```json
{
  "version": 1,
  "title": "Tax Invoice",
  "pageSize": "A4",
  "showLogo": true,
  "showVatSummary": true,
  "showBanking": true,
  "organisationFields": ["name", "address", "phone", "contactEmail", "vatNumber"],
  "partyFields": ["contactDetails", "name", "address"],
  "headerFields": ["documentNumber", "transactionDate", "terms", "dueDate"],
  "lineColumns": ["date", "item", "description", "tax", "quantity", "price", "amount"]
}
```

`pageSize` is `A4`, `A5`, `Letter`, or `Legal`. A4 is the default when the value is missing.

Allowed organisation fields: `name`, `address`, `phone`, `contactEmail`, `website`, `contactName`, `vatNumber`, `companyNumber`, `peppolId`, `country`.

Allowed bill-to fields: `contactDetails`, `name`, `address`, `phone`, `email`, `website`, `code`, `peppolId`, `country`, `vatNumber`. For a purchase document the party is the supplier. For a sales layout it is the customer.

Allowed document fields: `reference`, `documentNumber`, `transactionDate`, `terms`, `dueDate`, `orderNumber`, `supplierReference`, `supplyDate`, `currency`, `exchangeRate`, `paidAmount`, `buyerReference`, `contractReference`, `paymentTerms`, `invoicePeriod`, `precedingReference`, and `flex1` through `flex5`. `documentNumber` is the printed number. `reference` remains allowed so existing layouts keep working. A sales layout must show one of those two, and the date. Terms are the number of days from the document date to the due date. Payment terms are the stored text. The invoice period is the two dates. Flex fields appear only when that transaction type has a label.

Allowed line columns: `date`, `item`, `description`, `tax`, `quantity`, `price`, `amount`, `discount`, `glCode`, `vatCode`, `department`, `costCentre`, `unit`, `lineNote`, `order` (the order a line came from). Quantity, price, amount, and discount are the numeric columns.

If no row has been saved, printing uses this standard layout. The VAT summary and bank details are drawn at the bottom of the page. Print opens the browser print dialog. PDF downloads the same page at the layout's page size.

### On the invoice screens

Receipts, payments and refunds are recorded only on their own screens (Transactions, then Customer receipt, Supplier payment, Customer refund or Supplier refund). A posted invoice or credit note shows what has settled it on a tab of its own. The tab is **Receipts** on a sales invoice, **Payments** on a purchase invoice and **Applied** on a credit note. It lists each receipt or payment with its date and amount, with the number as a link that opens it, and shows the total, what is paid and what is open. It has no button to record money: a line under the figures names the screen that does, with a link to its list. The tab beside **Document** and **Notes** that holds payment means, terms and bank details is called **Payment terms**.

A credit note's tab also has **Apply to an invoice** while it has a balance, and an application can be removed from it with a reason. Applying a credit note is not a receipt or a payment, so it has no other home. A refund is recorded on the Customer refund or Supplier refund screen, where the credit note appears among the open items.

### Received e-invoices that say they are part paid

When an e-invoice is received with an amount in BT-113 (what the supplier says is paid), the import screen shows a notice under Paid amount, and the tab of the posted invoice that lists its receipts or payments shows it while something is still open. It says the supplier states an amount is paid and that nothing was recorded from it: record the payment if it is yours, or check it with the supplier. The figure is information only (`supplier_stated_paid_amount`). It is never allocated and never changes what is due. The notice is `supplierStatedPaidMessage` in `src/lib/payments.ts`.

### Printed payments, receipts and refunds

A payment prints from its own page, on the payment list or the open payment, with Print and PDF through the same print route as a document (`/print/{code}/{id}`). The layout comes from the form saved for its transaction type, and from the standard form when none is saved. It is designed in the form designer, on the Forms list like any other type (see below).

- **Title.** The form's title, which starts as the standard one. Money paid out is a **Remittance advice**: a supplier payment, or a refund to a customer. Money received is a **Receipt**: a customer receipt, or a refund from a supplier.
- **Content.** The organisation (name, address, phone, email, website, VAT and company numbers, logo), the party under "Paid to" or "Received from", then the number, date, payment method, bank reference, bank account with its IBAN, and currency. Empty details are left out.
- **Table.** One row for each document the payment settles, with its number, date, total and the amount applied. A posted payment lists its effective allocations. A draft lists what it has planned. A void payment lists what it settled before it was voided. A payment settling nothing says it is not applied to any document.
- **Totals.** The amount, the amount applied, and what is on account when something is left.
- **Status.** A draft prints with DRAFT and no number. A void payment prints with VOID and its reason. A posted payment has neither.
- **Details are live.** A payment keeps no copy of the organisation or the party when it is posted, so it prints their details as they are now. An invoice keeps a copy. Print a payment after changing the address and the new address shows.

#### Designing the form of a payment type

A payment, receipt or refund type has a form in `transaction_forms` like a document, with the same settings (title, page size, logo, and lists of organisation fields, party fields, header fields and line columns). What it can list is its own, in `src/lib/payment-form-layout.ts`:

- **Party.** Name, address, VAT number.
- **Payment (header).** Number, date, payment method, bank reference, bank account (Paid from or Paid into), currency.
- **Invoices settled (line columns).** Document, date, document total, amount applied. A refund settles credit notes, and the first column says so.
- **Always shown.** The organisation name, the party name, the number and date, and the document and the amount applied. The designer will not let them be taken off, and the database refuses a saved layout without them (`private.validate_form_layout`, migration `20261117150118_payment_form_layouts`). The VAT summary and banking footer settings do not apply and are not offered.
- **Fixed.** The totals block, the notes and the DRAFT and VOID marks are always printed.

The designer for a payment type is `PaymentFormDesigner.tsx`. It previews the latest payment of the type, or a sample. `getFormType` still treats a payment type as not found, so the document designer cannot open for one; `getPaymentFormType` finds it instead, and `saveTransactionForm` saves either kind.

`src/lib/payment-print.ts` builds the page from plain values and a layout, and has the tests. `src/lib/payment-print-data.ts` reads the rows and `src/components/PrintedPayment.tsx` draws them on the same paper as a printed document.

## EN 16931 export and readiness

`en16931_document(header id)` returns the posted or draft document as EN 16931 business terms in JSON. Amounts are strings with two decimal places and prices keep four. Empty terms are left out. `BT-23` and `BT-24` are the Peppol process and specification identifiers. `BT-83` repeats the invoice number. A line discount is an allowance with reason code `95`, and the unit price stays the price before that discount. Purchases use the supplier invoice number as `BT-1`. Sales use `document_number`. Orders raise an error. A document the caller cannot see returns no row.

For a posted or void document the parties come from the snapshot taken at posting. A later change to the supplier or customer does not change that JSON.

Posted sales invoices and credit notes can be stored as UBL e-documents. Orders are not exported. The XML is generated on the server from `en16931_document`, checked against the UBL 2.1 XSD and then the CEN EN 16931 Schematron and the Peppol BIS Billing 3.0.21 Schematron, and kept in `e_documents` with its SHA-256. A fatal XSD error stops Schematron. A sales invoice with a sales order number and no customer order number carries `NA` as the purchase order reference, as Peppol specifies, and a received file with `NA` is read as having no buyer order number. A file is still refused when it has a `DOCTYPE`, an external entity, a CII root, or a root that is not a UBL 2.1 Invoice or CreditNote. A received UBL file is uploaded on the E-documents screen. It is stored only when the buyer Peppol ID, or the buyer VAT number when the organisation has no Peppol ID, matches that organisation. A valid received file can be imported as a Purchases draft, using the invoice and credit note types chosen on the organisation screen. Posting that draft is refused while its nett, VAT, or total differs from the e-invoice. The posted sales document shows the e-invoice status, its validation summary, a download, and regenerate when no valid file is stored. An imported purchase shows a link to the e-document and the totals comparison. The signing key lives in Supabase Vault as `einvoice_hmac_k1` and in Vercel as `EINVOICE_HMAC_KEY` with `EINVOICE_HMAC_KEY_ID=k1`. To rotate it, add `einvoice_hmac_k2`, point Vercel at `k2`, and remove `k1` after a day. The key is never stored in the repository.

`en16931_readiness(header id)` lists gaps as `error` or `warning`. Sales errors stop posting. Purchase gaps stay warnings, apart from the credit-note rule that already requires the preceding invoice. The document page and the document list show a Readiness button. It is red when there is an error, orange when there are only warnings, and green when the document is ready. The button opens the gaps. A party gap links to Suppliers or Organisations. A document field stays on the form. Owners and admins can download the JSON.

## Back and moving around

The Back button in the title bar, and the Back link on a printed document or an e-document, return to where the person came from, not to a fixed screen. If someone goes from Customers to Suppliers through the menu, Back goes to Customers. If they open a report from Reports and then a document from the report, Back goes to the report, and Back again goes to Reports.

- **A screen is one step however many times it changes.** Changing a filter, saving something that reloads the same screen, or seeing a message does not add a step. Back from a report whose filter was changed twice goes to the screen before the report.
- **Coming back brings back the filters** the screen had, but never reopens a document that was closed or repeats a message.
- **A link that opens a document** (from a report, a customer's history or a payment) sends Back straight to where the link was while that document is open. Once the document is closed, or when someone opens a form themselves, Back closes the form first.
- **Opened by its address, or in a new tab,** there is nowhere to go back to, so Back goes to the screen that leads to it: a transaction list to Transactions, an Admin screen (including Journal export) to Admin, a report to Reports, an e-document to the e-document list, and the main menu screens to Home.
- The browser's own back and forward buttons work as the browser does, and Back follows them.
- Signing in or out starts the record again.
- **The main menu shows where you are.** Every Admin screen (GL codes, Journal export, forms and the rest) highlights Admin, and Payment runs highlights Transactions.

Not built: Back does not return to a document dialog that was open when someone left a list through a link, only to the list, and it does not restore the scroll position or the page of a grid.

## What the screens do

| Screen | Tables |
| --- | --- |
| Sign in, and the organisation switcher | `profiles`, `organisation_access`, `organisations`, `tenants` |
| Admin lists for GL codes, departments, cost centres, VAT, currencies, bank accounts, products, transaction types | The matching table |
| Organisations | `organisations`, `organisation_defaults`, `currencies`, and the logo bucket |
| Access | `organisation_access`, `profiles` |
| Customers and suppliers | `customers`, `suppliers`, `currencies` |
| Transactions menu | `transaction_types`, with draft, posted, and void counts from `transaction_headers` |
| Purchase and sales document pages | `transaction_headers`, `transaction_lines`, plus the lookups above. The same form follows the type's direction. Drafts can be posted. Owners and admins can void a posted purchase. A posted sales invoice can raise a credit note. A posted sales invoice or credit note also shows its e-invoice |
| E-documents | `e_documents`, `e_document_contents`, `e_document_validation_results`, `e_document_events`. Received and sent lists can be filtered by status, party, date, and number |
| Change history | `audit_log`, for owners and admins |
| Forms | `transaction_forms` and `transaction_types` |
| Print and PDF | The saved form, or the standard layout, filled from the organisation, the supplier, and one header with its lines |
| Ask Qula | `transaction_headers`, `transaction_types`, `currencies`, and `e_documents` for the open organisation |

Ask Qula is the sparkle button at the right of the title bar. The chat slides in from the right. Until an owner or admin enables a provider, a question is matched by keyword and answered from that organisation's transactions, e-documents, or overdue invoices. When AI is enabled, the question and the data needed to answer it are sent to the organisation's provider. The tools are read-only and use the signed-in user's session. Ask Qula can also propose posting a draft or adding a customer or supplier, but only when an owner or admin has switched actions on for the organisation. Actions are off by default and are separate from AI answers. Nothing happens until a person confirms. The confirmation shows figures read from the database, not the model's words. A confirmation works once, for ten minutes, and is refused if the document changed after it was proposed. A draft that is not ready to post cannot be confirmed. When someone rates an answer, the question and answer are kept with the rating only if an owner or admin has switched that on and accepted a notice naming how long they are kept. The text is kept for 30 days unless the organisation chooses another period from 1 to 365 days, then deleted automatically. The rating is kept. Only owners and admins can read the stored text. A transaction card opens that transaction. An e-document card opens that e-document. The conversation stays in the browser, including when the record is opened. API keys are stored as ciphertext. Access Point settings are per organisation and currently use the mock provider.

Payments and receipts have their own list (`/transactions/{code}` for a payment type) and entry screen. The header is on the left: date, party, bank account, amount, currency, exchange rate, payment means, bank reference and notes. The open items of the party are on the right, each with an Allocate amount, with Allocate oldest first and Clear. A double tap on an open document allocates everything still open on it, if that fits in what is left of the amount. With no amount entered on a draft it fills the amount in from the document. If it does not fit, nothing changes and the message says what is left. Applying a credit note to invoices works the same way against its balance. Totals show Amount, Allocated and On account. Save, Save and post and Delete are for drafts. Void asks for a reason and is for owners and admins. Remove on an allocation asks for a reason and any member can use it. A posted payment's open items stay usable to allocate money that is still on account.

Purchase and sales pages share one entry form. The transaction type is fixed on that page, so each type keeps its own reference sequence and flex labels. A purchase uses a supplier. A sale uses a customer. Currency is taken from that party and shown read-only. The exchange rate is read-only when that currency is the organisation home currency. The form is one status line, then Document, Notes, and Payment terms, with the header and totals on the left and the lines on the right. A posted invoice or credit note has one more tab, Receipts on a sales invoice, Payments on a purchase invoice and Applied on a credit note. It lists what settled the document, with a link to open each receipt or payment, and shows what is open. It records nothing: receipts, payments and refunds are recorded on their own screens, and a credit note can be applied to an invoice from its tab. A posted sales invoice lists its credit notes and the amount still available to credit. Document lists have Paid and Amount due columns and a filter for unpaid, part paid and paid. The customer and supplier summary shows money on account and recent payments. What a customer owes, or a supplier is owed, is reduced by receipts and payments not yet applied to an invoice, as well as by credit note balances. A party with more on account than is owed turns the card round: it shows what you owe them, or what they owe you. A sales order uses that same form. The transaction type form sets the document number prefix and padding.

## Organisation settings

Ask Qula, the Access Point and the Accounting accounts are settings of one organisation, so they are tabs of the organisation edit (Admin, Organisations, Edit): Details, Ask Qula, Access Point and Accounting. They have no tiles of their own on Admin. Journal export is something you do, not a setting, so it keeps its tile.

- **The tab is in the address.** `/organisations?edit={organisation}&tab={ask-qula|access-point|accounting}` opens that organisation on that tab. A save comes back to the same tab with its message.
- **A save is for the organisation being edited,** which may not be the one the person is working in. Each settings form names its organisation, and the role is checked for that organisation: only an owner or admin of it can save.
- **Only owners and admins see the tabs.** A member who opens an organisation sees Details, read only.
- **The old addresses still work.** `/ask-qula`, `/access-point` and `/accounting` open the matching tab for the organisation the person is working in, and a member is sent to Admin. Back from one goes to where the link was.

## Page headers

A page title has at most one line of description under it, and no shortcut links. A link to another screen belongs in the menu or in the content of the page, not in the header. Anything longer than a line is help text next to the field it explains.
