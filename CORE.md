# FinTran core

FinTran keeps financial setup and purchase documents separate for each organisation. A tenant owns one or more organisations. A person signs in once and is granted access to particular organisations inside a tenant, as an owner, admin, or member.

The live database is the FinTran Supabase project. The schema is the SQL in `supabase/migrations`, applied in filename order. Postgres holds the rules: uniqueness, which codes may be used together, reference numbers, and totals. The Next.js app reads and writes through the Supabase API as the signed-in user. It does not use a service-role key.

Sales transaction types can be defined, and a printable form can be designed for them. Sales documents are not stored yet. Purchase documents are.

## How the pieces fit

```text
tenant
  └── organisation
        ├── organisation_access        who may open it, and as which role
        ├── organisation_defaults      home currency, address, logo, banking
        ├── currencies
        ├── gl_codes
        ├── departments
        ├── cost_centres
        ├── vat_rates
        ├── products
        ├── customers
        ├── suppliers
        ├── transaction_types
        │     └── transaction_forms    one printable layout
        └── transaction_headers        purchase documents only
              └── transaction_lines
```

Almost every business table carries both `tenant_id` and `organisation_id`. A trigger checks that the organisation belongs to that tenant, and blocks a row from being moved to another organisation. Codes are uppercased and trimmed in those triggers. A code is unique inside one organisation, not across the whole database.

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

- `create_tenant(tenant_name, organisation_name)` creates the tenant, its first organisation, the defaults row, and owner access for the caller.
- `create_organisation(tenant_id, organisation_name)` adds another organisation in a tenant the caller manages.
- `grant_organisation_access(organisation_id, email, role)` grants access to someone who already has a profile.
- `revoke_organisation_access(organisation_id, user_id)` removes that grant.

The functions check the caller's role. Only an owner of an organisation in the tenant can create another organisation. An owner can grant any role. An admin can grant and remove members only. A member cannot create organisations or change access. An organisation must keep at least one owner.

## Who can see a row

Row level security is enabled on the public tables. The usual select rule is `private.is_org_member(organisation_id)`: the signed-in user has a row in `organisation_access` for that organisation.

Owners and admins can change setup: currencies, GL codes, departments, cost centres, VAT rates, products, transaction types, forms, organisation defaults, and the logo. Members can read that setup. Members can create, edit, and delete customers, suppliers, and draft documents.

Every business table records `created_at`, `created_by`, `updated_at`, and `updated_by`. `created_at` and `created_by` stay as they were on update. Changes to organisation defaults, access, suppliers, customers, VAT rates, GL codes, currencies, transaction types, and document headers are written to `audit_log`. An update stores only the columns that changed. Recalculated document totals are not logged. Owners and admins can read the log for their organisation. Nobody can change it directly.

Exceptions:

- `tenants`, `organisations`, `profiles`, and `organisation_access` can be read by a member. They are changed through the functions above, not by open insert and update policies.
- `organisation_defaults` can be selected, inserted, and updated by a member. Delete is not granted. The row is created with the organisation and removed when the organisation is deleted.
- `save_purchase_invoice` is security invoker. It runs as the caller, so the header and line policies still apply. It does not call into the `private` schema.

`private` is not on the API. Authenticated users can execute a few helpers such as `is_org_member` only because policies and triggers need them. They cannot list or change that schema.

## Organisation defaults and currencies

Creating an organisation inserts one `organisation_defaults` row.

| Column | Meaning |
| --- | --- |
| `organisation_id` | Primary key, and the organisation |
| `tenant_id` | Must match that organisation |
| `home_currency_id` | The organisation's home currency. Must be one of its `currencies` |
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
| `peppol_scheme`, `peppol_id` | Both set, or both empty. The scheme is an EAS code. Irish VAT electronic addresses use `9935`. BT-34 |
| `iban` | Checked with the ISO 13616 mod-97 rule and stored without spaces. BT-84 |
| `bic` | 8 or 11 characters. BT-86 |
| `bank_account_name` | Up to 100. BT-85 |
| `banking_details` | Free text up to 1000, still used for the printed bank block |
| `logo_path` | Null, or `{organisation_id}/logo` |
| `updated_at` | Set on every change |

Customers and suppliers use the same address, VAT, company number, and Peppol columns. On a sales document those are the buyer (BT-47 to BT-55). On a purchase document the supplier columns are the seller. Peppol IDs are unique per organisation for customers, and separately for suppliers. Several records can have no Peppol ID.

Blank text is stored as null.

A free-text address that was already stored was split on line breaks into lines 1 to 3. Further lines were joined into line 3, the country was set to `IE`, and the address was marked for review. A blank address was left blank. A VAT number that already had a known prefix was kept. An Irish number without a prefix was given `IE`. Any other old VAT number was cleared, written to the audit log, and the address was marked for review.

`currencies.iso_code` is the ISO 4217 code, linked to `ref_currencies`, and unique inside the organisation. It is filled from the currency code when that code is already an ISO code. `currencies.rate` is how many units of that currency equal one unit of the home currency. The home currency's own rate is 1. A rate is greater than 0 and has up to 8 decimal places. On a document, the same convention is stored as `exchange_rate`: home amount = foreign amount ÷ rate.

Printing still uses one Address field. For a draft it joins the structured lines, city, county, post code, and country. A posted or void document keeps the single address string already stored on its snapshot.

The logo file is not in the table. It is an object in the private Storage bucket `organisation-logos`, at `{organisation_id}/logo`. The bucket allows PNG, JPEG, WebP, and GIF up to 2 MB. Storage policies use `private.organisation_logo_allowed`, so only a member of that organisation can read or replace the file. The app serves it through `/organisation-logo/{organisation_id}` after checking membership.

## Account structure

These tables are the lists under Admin. Each has `tenant_id`, `organisation_id`, `code`, and `description` (description 1–200). `code` matches `^[A-Z0-9]{1,20}$`, except products, which allow 30 characters. `(organisation_id, code)` is unique.

### `gl_codes`

`account_type` is required and is one of:

- Fixed Asset
- Current Liability
- Current Asset
- Income
- Expense

A product's purchase GL code must be Expense. Its sales GL code must be Income. A trigger stops an account type from being changed while a product still uses that code in the matching role.

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
| `code`, `name` | Code as above. Name 1–200 |
| `currency_id` | Required. One of this organisation's currencies |
| `phone`, `email`, `website`, `address` | Optional, with the same checks as the organisation profile |
| `contact_details` | Optional, up to 500 |
| `notes` | Optional, up to 4000 |
| `payment_terms_days` | Optional whole number from 0 to 365 |
| `default_buyer_reference` | Customers only. Optional, up to 100. EN 16931 BT-10 |

A supplier's currency becomes the currency of a purchase document and cannot be edited on the document. Customers are stored for sales documents, which are not entered yet.

A new sales draft copies blank fields from its customer. A blank buyer reference takes `default_buyer_reference`. When `payment_terms_days` is set, a blank due date becomes the document date plus that many days, and blank payment terms become “Due on receipt” for 0, “Payment due within 1 day” for 1, or “Payment due within N days”. Values already entered are left as they are. Purchase drafts are not filled from the supplier.

## Transaction types

`transaction_types.type` is `Sales` or `Purchases`. `document_kind` is `invoice`, `credit_note`, or `order`.

| Column | Meaning |
| --- | --- |
| `code`, `description` | The short code shown in menus, and the name used as the page title |
| `document_kind` | Invoice, credit note, or order. A description containing “order” was set to order. The kind cannot change after a document has been entered |
| `last_reference` | The last number issued for this type. New types are forced to 0 |
| `flex1_label` … `flex5_label` | Optional labels, up to 80 characters. A blank label hides that flex field on the document |

An order still stores header totals. Later VAT reporting leaves orders out, and an order is never exported. A credit note, sales or purchase, needs the preceding invoice reference before it can be posted. Sales documents are still not stored.

`last_reference` only moves forward. An update may set it to the previous value plus one. Any other change is put back. Deleting a document does not give the number back.

The header insert trigger is what advances it: it adds one and stores that number as the document reference. The first document of a type is reference 1.

## Purchase documents

`transaction_headers` is one document. `transaction_lines` are its lines. The header trigger rejects any type whose `type` is not `Purchases`, so a sales type cannot be saved here.

The app writes both tables through `save_purchase_invoice(jsonb)`. That function checks the organisation, supplier, currency, product, and codes, replaces the lines, and lets the triggers calculate amounts.

### Header

| Column | Meaning |
| --- | --- |
| `transaction_type_id` | A Purchases type. Cannot be changed after insert |
| `reference` | Issued from `last_reference`. Unique per organisation and type. Cannot be renumbered |
| `transaction_date` | Required |
| `due_date` | Optional |
| `supplier_id`, `supplier_name` | The supplier, and the name stored on the document |
| `contact_details` | Optional, up to 500 |
| `notes` | Optional, up to 4000 |
| `currency_id`, `exchange_rate` | The supplier's currency, and the rate used for this document |
| `order_number` | Optional, up to 40 |
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
| `amount_due` | Total minus paid, plus rounding. A posted document updates this when the paid amount changes |
| `home_nett_amount`, `home_vat_amount`, `home_total_amount` | Each foreign figure divided by `exchange_rate` and rounded to 2 decimal places |
| `paid_amount` | Zero or greater. On a posted document this is the only amount that can still be edited. The VAT totals stay as they were |
| `status` | `draft`, `posted`, or `void`. Existing documents were marked posted when this column was added |
| `posted_at`, `posted_by` | Set when the document is posted |
| `voided_at`, `voided_by`, `void_reason` | Set when an owner or admin voids a posted document. The reason is required |

A draft can be edited and deleted. Posting needs at least one line and is allowed for any member. Purchases are numbered when the draft is saved. A type set to number on posting, which every Sales type must use, leaves the draft without a number and issues the next number when it is posted. Deleting those drafts does not use a number. A posted document is read-only apart from the paid amount, until an owner or admin voids it from the document form. A void document cannot be changed or deleted. Status changes only through `post_document` and `void_document`.

Posting copies the organisation and the supplier into `issuer_snapshot` and `party_snapshot`. Those copies do not change if the organisation or supplier is edited later. A new posting also stores the structured address, country, Peppol scheme and identifier, VAT number, and company number. The issuer copy adds the IBAN, BIC, and bank account name. Documents posted before these fields existed keep the snapshot they already had. When a sales document is posted and the organisation has an IBAN, a blank payment means becomes `58` (SEPA credit transfer). A means already chosen is left. Purchases stay unset. Missing buyer reference, order number, due date, payment terms, Peppol ID, or address does not block posting. Documents that were already posted when snapshots were added were filled from the data at that time, including the live logo path. A new posting copies the logo to `{organisation_id}/snapshots/{header_id}` first, and does not post if that copy fails. Each line stores `vat_percentage`, the VAT category, and any exemption from the VAT code at the time the line is saved. A line with no VAT code is category `O`. Line nett is rounded to 2 decimal places. Line VAT is kept for display. Document VAT is one row in `transaction_vat_breakdown` for each category and rate: the taxable amount times the rate, rounded to 2 decimal places. A posted document keeps the totals it had when it was posted. A VAT code used on a posted or void line cannot have its rate, type, or category changed. Customers and suppliers have an optional `vat_number`.

A purchase document stores an optional supplier invoice number and supply date. The same supplier invoice number cannot be entered twice for one supplier, ignoring case, unless the first document has been voided. A purchase requires a supplier and cannot name a customer. `customer_id` is ready for sales documents, which are still not stored.

Codes may contain dots and hyphens after the first character. The first character is a letter or number. Products may be 30 characters. Other codes may be 20.

An owner can delete an organisation that has no documents, unless it is the last organisation in the tenant. The app then removes its logo files. There is no direct delete of an organisation from the API.

A saved form layout is checked in the database. A sales form must show the organisation name, address, and VAT number, the customer name and address, the document number and date, the line description, quantity, price, tax, and amount, and the VAT summary. A sales credit note must also show the preceding invoice. A purchase credit note may leave that field off the form; posting still requires the reference. The standard layout meets the sales invoice rules.

`organisation_defaults.lock_date` blocks creating, editing, posting, voiding, or deleting a document whose date is on or before that day. Owners and admins set the lock date.
| `flex1` … `flex5` | Optional text, up to 200. Shown only when that type has a label |

On every header insert or update the trigger replaces the six amount columns from the lines. A new header therefore starts at zero until its lines exist. Saving a line updates the header, which runs the trigger again.

### Lines

| Column | Meaning |
| --- | --- |
| `header_id` | The document. Deleting the header deletes its lines |
| `line_number` | Starts at 1. Unique on the header |
| `reference`, `transaction_type_id`, `organisation_id`, `tenant_id` | Copied from the header |
| `product_id` | Optional. Must belong to the same organisation |
| `description` | Required, 1–200 |
| `unit_code` | EN 16931 unit. Defaults to `C62`, one |
| `line_note` | Optional, up to 400 |
| `seller_item_id` | Optional, up to 60. Purchases only |
| `gl_code_id` | Optional GL code |
| `department_id`, `cost_centre_id` | Optional |
| `vat_rate_id` | Optional. If set, it must be an Expense rate. If null, VAT is 0 |
| `quantity` | Greater than 0 |
| `price` | Zero or greater |
| `discount_amount` | Zero or greater, and not more than quantity × price |
| `nett_amount` | quantity × price − discount. Set by trigger |
| `vat_amount` | Nett × VAT percentage. Set by trigger |

The screen may show a calculated nett and VAT before save. The stored figures are the ones the trigger writes.

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
  "headerFields": ["reference", "transactionDate", "terms", "dueDate"],
  "lineColumns": ["date", "item", "description", "tax", "quantity", "price", "amount"]
}
```

`pageSize` is `A4`, `A5`, `Letter`, or `Legal`. A4 is the default when the value is missing.

Allowed organisation fields: `name`, `address`, `phone`, `contactEmail`, `website`, `contactName`, `vatNumber`, `companyNumber`, `peppolId`, `country`.

Allowed bill-to fields: `contactDetails`, `name`, `address`, `phone`, `email`, `website`, `code`, `peppolId`, `country`. For a purchase document the party is the supplier. For a sales layout it is the customer.

Allowed document fields: `reference`, `transactionDate`, `terms`, `dueDate`, `orderNumber`, `supplierReference`, `supplyDate`, `currency`, `exchangeRate`, `paidAmount`, `buyerReference`, `contractReference`, `paymentTerms`, `invoicePeriod`, `precedingReference`, and `flex1` through `flex5`. Terms are the number of days from the document date to the due date. Payment terms are the stored text. The invoice period is the two dates. Flex fields appear only when that transaction type has a label.

Allowed line columns: `date`, `item`, `description`, `tax`, `quantity`, `price`, `amount`, `discount`, `glCode`, `vatCode`, `department`, `costCentre`, `unit`, `lineNote`. Quantity, price, amount, and discount are the numeric columns.

If no row has been saved, printing uses this standard layout. The VAT summary and bank details are drawn at the bottom of the page. Print opens the browser print dialog. PDF downloads the same page at the layout's page size.

## What the screens do

| Screen | Tables |
| --- | --- |
| Sign in, and the organisation switcher | `profiles`, `organisation_access`, `organisations`, `tenants` |
| Admin lists for GL codes, departments, cost centres, VAT, currencies, products, transaction types | The matching table |
| Organisations | `organisations`, `organisation_defaults`, `currencies`, and the logo bucket |
| Access | `organisation_access`, `profiles` |
| Customers and suppliers | `customers`, `suppliers`, `currencies` |
| Transactions menu | `transaction_types`, with a count from `transaction_headers` |
| Purchase invoice, order, and return pages | `transaction_headers`, `transaction_lines`, plus the lookups above. Drafts can be posted. Owners and admins can void a posted document |
| Change history | `audit_log`, for owners and admins |
| Forms | `transaction_forms` and `transaction_types` |
| Print and PDF | The saved form, or the standard layout, filled from the organisation, the supplier, and one header with its lines |

Purchase pages share one entry form. The transaction type is fixed on that page, so each type keeps its own reference sequence and flex labels. The supplier is required. Currency is taken from the supplier and shown read-only.
