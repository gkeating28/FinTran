# Qula Tran technical description

Qula Tran keeps financial setup and documents separate for each organisation. A tenant owns one or more organisations. A person signs in once and is granted access to particular organisations as an owner, an admin, or a member.

Purchases and sales share one document store and one entry form. The transaction type decides the direction. Posted sales invoices and credit notes can be stored as Peppol BIS Billing 3.0 UBL. A received UBL file can be imported as a Purchases draft. Orders stay in Qula Tran and are not exported as EN 16931 invoices.

## Naming

The product name on screens, page titles, print, and messages is Qula Tran. These internal identifiers keep the previous name so existing sessions, files, and database behaviour do not change:

| Identifier | Why it stays |
| --- | --- |
| Repository and npm package `fintran` | The GitHub repository and package name |
| Cookie `fintran-organisation` | Existing browsers already store the open organisation under this name |
| `sessionStorage` key `fintran.ask-qula.{organisationId}` | Existing Ask Qula conversations |
| `localStorage` keys `fintran.form.*`, `fintran.transactionSplitWidth`, `fintran.spelling.ignored` | Saved grid sizes, split position, and ignored spellings |
| Postgres settings `fintran.status_change`, `fintran.home_currency`, `fintran.deleting_organisation` | Triggers already read these names |
| Readiness rule ids `FINTRAN-BT-1`, `FINTRAN-CREDIT`, `FINTRAN-ADDRESS-REVIEW` | Stored and displayed rule identifiers |
| Supabase project and the SQL test addresses `@fintran.test` | The hosted project and the test fixtures |
| Environment variable names | They are deployment configuration, not labels |

Supabase Auth email templates are edited in the Supabase project, not in this repository. They need the same product name there.

Domain rules in more detail, including EN 16931 business-term mapping, are in [CORE.md](CORE.md). This document is the application map: how the screen is built, which functions the app calls, and how the database is shaped.

## Runtime

| Piece | Role |
| --- | --- |
| Next.js 16 App Router | Pages, server actions, and route handlers. The session gate is `src/proxy.ts`, which calls `src/lib/supabase/proxy.ts`. |
| React 19 | Client forms, the title bar, and Ask Qula. |
| TypeScript | Application code. `src/lib/database.types.ts` is the generated Supabase type for tables and functions that were present when it was last generated. The e-document tables exist in SQL and are used by the app; that generated file lists their functions and enums and does not yet list the four e-document tables. |
| CSS modules | Screen styling. Tailwind is imported in `src/app/globals.css` and is used only for the document shell (`h-full`, `antialiased`). |
| Supabase Auth | Email sign-in. The browser session is stored in cookies through `@supabase/ssr`. |
| Postgres | All business rules: codes, totals, numbering, posting, and e-document status. |
| Supabase Storage | Private bucket `organisation-logos`. |
| Supabase Vault | HMAC key `einvoice_hmac_k1` for stored e-document envelopes. The matching value in the app host is `EINVOICE_HMAC_KEY` with `EINVOICE_HMAC_KEY_ID=k1`. |

The app talks to Postgres as the signed-in user. It does not use a service-role key. Row level security and security-definer functions enforce access.

The open organisation is the cookie `fintran-organisation`. If that id is not one of the user's memberships, the app opens the first membership.

Public paths are `/login`, `/signup`, and `/auth`. Every other path redirects to `/login` when there is no session.

## UI principles

The shell is a dark sidebar, a dark title bar, and a light work area.

| Token | Value | Use |
| --- | --- | --- |
| Sidebar | `#0f1f38`, 232px | Navigation, organisation selector, signed-in person |
| Title bar | `#16294a`, 60px | Breadcrumb `Managing: {organisation} / {page}` and the right-hand actions |
| Page | `#eef0f3` | Work area, `[data-app-page]` |
| Panel | `#ffffff` | Forms, grids, dialogs |
| Text | `#151b2b`, secondary `#3a4356`, muted `#8891a0` | |
| Accent | `#2c4c78` | Primary buttons, focus, links |
| Warn / danger / ok | `#c2410c` / `#b42318` / `#217a56` | |
| Form radius | 3px | Fields, quiet buttons, grids |
| Chrome radius | 8px | Buttons and the organisation selector on navy |
| UI font | Public Sans | Body, fields, buttons |
| Title font | Plus Jakarta Sans | Page and dialog titles |
| Mono | IBM Plex Mono | Codes and references |

### Navy chrome

Buttons on the navy title bar and dialog header, and the organisation selector in the sidebar, use `src/components/ChromeControl.module.css`.

- Stroke: `1px solid rgba(255, 255, 255, 0.42)`.
- Corner: 8px.
- Fill: transparent, so the navy shows through. A second fill inside the stroke makes the edge look grainy.
- Hover: stroke `rgba(255, 255, 255, 0.7)`, fill `rgba(255, 255, 255, 0.06)`.
- Keyboard focus: 2px white outline, 2px outside the control.
- Back is 64 by 42px. Ask Qula is 42 by 42px. Dialog close is 32 by 32px. Widths are whole pixels so the stroke sits on the pixel grid.
- Ask Qula is the rightmost title-bar control. Its chat slides in from the right, under the title bar. It does not float over the page footer.

### Transaction entry

Every sales and purchase entry screen copies `src/components/PurchaseInvoiceManager.tsx`. Do not invent a second layout.

1. One status row, 42px, one message. A problem replaces that message.
2. Tabs: Document, Notes, Payment.
3. Header fields and totals on the left. Line grid on the right.
4. A line opens in the existing line dialog.
5. Footer: the destructive action on the left, Cancel and Save on the right.
6. The form fills `[data-app-page]` through `FormModal` with `fillPage`. The title moves into the title bar. Back closes the form.
7. Use the classes in `src/components/OpsPage.module.css`: `statusRow`, `headerTabs`, `headerFields`, `invoiceSplit`, `amountBox`, `lineTable`, `lineDialog`, `field`, `quiet`, `primary`, `danger`, `modalActions`. Copy an existing control before adding CSS.
8. Focused fields draw the accent outline inside the box (`outline-offset: -2px`) so the header pane does not clip it.
9. The exchange rate is read-only when the supplier or customer currency is the organisation home currency. The field still submits. Posted documents stay locked.
10. A saved master code is read-only. GL codes, departments, cost centres, VAT rates, customers, suppliers, products, currencies, and transaction types take their code on create. The edit form shows the code and does not accept a new one. Updates omit the code. Postgres rejects a rename.

Form buttons on the light page stay the purchase-invoice set: `quiet` (white, 1px border, 3px corner), `primary` (accent fill), and `danger`.

### Ask Qula

The sparkle button opens a sheet fixed to the right edge, from the bottom of the title bar to the bottom of the viewport, 400px wide. It slides over 480ms. Escape, Close, and the sparkle button dismiss it. The conversation is kept in `sessionStorage` under `fintran.ask-qula.{organisationId}`.

Ask Qula matches keywords. It does not call a language model. A transaction card opens that transaction. An e-document card opens that e-document.

## Screens

| Path | What it shows |
| --- | --- |
| `/login`, `/signup` | Email sign-in and account creation |
| `/` | Home for the open organisation |
| `/transactions` | Transaction types, with draft, posted, and void counts |
| `/transactions/{code}` | Document list for that type |
| `/transactions/{code}` with a document open | The shared entry form |
| `/customers`, `/suppliers` | Parties |
| `/e-documents` | Received and sent e-documents, filtered by status, party, date, and number |
| `/e-documents/{id}` | Validation and history, or the import form when the file is an inbound valid invoice |
| `/admin` | Links to setup lists |
| `/gl-codes`, `/departments`, `/cost-centres`, `/vat-rates`, `/currencies`, `/products`, `/transaction-types` | Setup grids |
| `/organisations` | Organisations in the tenant, defaults, and logo |
| `/access` | Grants for the open organisation |
| `/forms`, `/forms/{code}` | Print layout for a transaction type |
| `/history` | Audit log, owners and admins |
| `/print/{code}/{id}` | Printable document. Print and PDF. This page is outside the app shell |
| `/defaults` | Organisation defaults |

The title bar Back control returns to the previous list, or closes a fill-page form.

## HTTP routes

These are the route handlers. Writes that belong to a form go through server actions, listed in the next section.

| Method and path | Auth | Behaviour |
| --- | --- | --- |
| `GET /auth/confirm` | Public | Exchanges an email `code`, or verifies `token_hash` and `type`, then redirects to `/`. A bad link redirects to `/login` with an error. |
| `POST /api/ask-qula` | Member of the named organisation | Body `{ question, organisationId }`. Question length 1–300. Returns `{ intent, text, docs? }`. `intent` is `transactions`, `documents`, `aging`, or `help`. |
| `POST /api/einvoice/inbound` | Signed in, open organisation | Multipart field `file`, a UBL Invoice or CreditNote. Stores it when the buyer Peppol ID, or the buyer VAT number when the organisation has no Peppol ID, matches that organisation. Returns `{ id }`. |
| `POST /api/einvoice/outbound/{headerId}` | Signed in, open organisation | Builds UBL from `en16931_document`, runs Schematron, and stores the file. Returns `{ id }`. |
| `GET /api/einvoice/{id}/xml` | Signed in | Downloads the stored XML via `e_document_xml`. `Content-Type: application/xml`. |
| `GET /transactions/{code}/{id}/en16931` | Owner or admin | Downloads `en16931_document` as pretty JSON. |
| `GET /organisation-logo/{organisationId}` | Member of that organisation | Streams the current logo, or `?object=snapshots/{headerId}` for the copy taken at posting. A missing file is 404, including for a stranger, so the URL does not reveal membership. |
| `GET /api/spelling-dictionary` | Public | British English affix and dictionary files for the in-form spell checker. Cached for a day. |

Ask Qula suggestions shipped with the client are “What is overdue?”, “Recent transactions”, “Draft transactions”, and “Received e-documents”.

## Server actions

Server actions run on the server with the user session and return `{ error }` or `{ message }` (`ActionState`), or redirect. They live in `src/lib`.

| Module | Functions | What they change |
| --- | --- | --- |
| `actions.ts` | `signIn`, `signUp`, `signOut`, `selectOrganisation` | Auth session and the organisation cookie |
| `actions.ts` | `createTenant`, `createOrganisation`, `deleteOrganisation`, `grantAccess`, `revokeAccess` | Tenant, organisation, and access RPCs |
| `reference-actions.ts` | `createReference`, `updateReference`, `deleteReference` | GL codes, departments, cost centres |
| `currency-actions.ts` | `createCurrency`, `updateCurrency`, `deleteCurrency`, `updateOrganisationDefaults` | Currencies, defaults, logo, and `rename_organisation` |
| `transaction-type-actions.ts` | `createTransactionType`, `updateTransactionType`, `deleteTransactionType` | Transaction types |
| `party-actions.ts` | `createParty`, `updateParty`, `deleteParty` | Customers and suppliers |
| `product-actions.ts` | `loadProductChoices`, `createProduct`, `updateProduct`, `deleteProduct` | Products |
| `form-actions.ts` | `saveTransactionForm` | `transaction_forms.layout` |
| `purchase-invoice-actions.ts` | `savePurchaseInvoice`, `postPurchaseInvoice`, `voidPurchaseInvoice`, `updatePaidAmount`, `createCreditNote`, `deletePurchaseInvoice` | Documents, for both directions |
| `readiness-actions.ts` | `loadTransactionReadiness` | Read-only `en16931_readiness` for a list of headers |

`savePurchaseInvoice` sends this JSON to `save_document`:

`id`, `transactionTypeId`, `transactionDate`, `dueDate`, `supplierId`, `customerId`, `partyName`, `contactDetails`, `notes`, `currencyId`, `exchangeRate`, `orderNumber`, `supplierReference`, `supplyDate`, `precedingHeaderId`, `precedingReference`, `precedingDate`, `buyerReference`, `contractReference`, `paymentTerms`, `invoicePeriodStart`, `invoicePeriodEnd`, `paymentMeansCode`, `paidAmount`, `roundingAmount`, `flex1`–`flex5`, and `lines`.

Each line sends `productId`, `description`, `glCodeId`, `departmentId`, `costCentreId`, `vatRateId`, `quantity`, `price`, `discountAmount`, `unitCode`, `lineNote`, and `sellerItemId`.

The import screen calls `import_e_document` directly. Reject calls `reject_e_document` directly. Both use the browser Supabase client and the user session.

## Database functions

These are the `public` functions the app is allowed to call. Arguments match `src/lib/database.types.ts`.

| Function | Returns | Purpose |
| --- | --- | --- |
| `create_tenant(tenant_name, organisation_name, p_home_currency default 'EUR')` | JSON | Tenant, first organisation, home currency at rate 1, defaults, and owner access for the caller |
| `create_organisation(p_tenant_id, organisation_name, p_home_currency default 'EUR')` | uuid | Another organisation in a tenant the caller owns |
| `rename_organisation(p_organisation_id, p_name)` | void | Renames the organisation. The slug stays. |
| `delete_organisation(p_organisation_id)` | void | Deletes an organisation with no documents, unless it is the last organisation in the tenant |
| `grant_organisation_access(p_organisation_id, p_email, p_role)` | void | Grants access to an existing profile. An owner may grant any role. An admin may grant members. |
| `revoke_organisation_access(p_organisation_id, p_user_id)` | void | Removes a grant. An organisation keeps at least one owner. |
| `save_document(p_document jsonb)` | uuid | Inserts or replaces a draft header and its lines. Security invoker, so header and line policies still apply. |
| `post_document(p_header_id, p_logo_path default null)` | void | Posts a draft. Sales types that number on post take the next number here. |
| `void_document(p_header_id, p_reason)` | void | Voids a posted purchase. A posted sale is corrected with a credit note. |
| `en16931_document(p_header_id)` | JSON | Business terms for a document the caller can see. Orders raise an error. |
| `en16931_readiness(p_header_id)` | rows of `rule_id`, `severity`, `business_term`, `message` | Gaps. Sales errors block posting. Purchase gaps are warnings, apart from the credit-note preceding invoice. |
| `en16931_source(p_header_id)` | JSON | Source payload used to build the business terms |
| `en16931_amount(p_value)` | text | Two decimal places |
| `en16931_price(p_value)` | text | Four decimal places |
| `store_e_document(p_xml, p_envelope, p_signature)` | uuid | Stores a signed e-document envelope |
| `e_document_xml(p_id)` | text | Stored XML for a document the caller can see |
| `import_e_document(p_id, p_choices jsonb)` | uuid | Turns a valid inbound file into a Purchases draft. Amounts come from the stored semantic JSON. `p_choices` carries `supplierId` or `createSupplier` with `supplier.code` and `supplier.name`, plus `lines[]` of `lineNumber`, `vatRateId`, `glCodeId`, `departmentId`, and `costCentreId`. The VAT rate must be Expense and must match the line's category and percentage. |
| `reject_e_document(p_id, p_reason)` | void | Marks a received document rejected. The reason is required. |

`private` is not on the API. Triggers and policies use it for tenant checks, code normalisation, totals, numbering, audit, VAT breakdown, snapshots, and e-document status changes.

## Database schema

SQL lives in `supabase/migrations` and is applied in filename order. Almost every business table has `tenant_id` and `organisation_id`. A trigger checks that the organisation belongs to that tenant and blocks a move to another organisation. Codes are trimmed and uppercased there.

A code is unique inside one organisation. After insert it cannot change (`private.guard_code_unchanged`). Referenced rows use `ON DELETE RESTRICT`. Deleting an organisation cascades the rows that belong only to it. `transaction_headers.tenant_id` and `transaction_lines.tenant_id` are `ON DELETE RESTRICT`, so a tenant with documents cannot be deleted. There is no API for deleting a tenant.

Every business table records `created_at`, `created_by`, `updated_at`, and `updated_by`. `created_at` and `created_by` stay put on update. Selected changes are copied to `audit_log`. An update stores only the columns that changed. Recalculated totals are not logged. Owners and admins can read the log. Nobody can update it through the API.

Blank text is stored as null.

### People and access

| Table | Columns that matter |
| --- | --- |
| `tenants` | `name` (2–80), `slug` unique |
| `organisations` | `tenant_id`, `name`, `slug` unique inside the tenant |
| `profiles` | `id` is the Auth user id, `email` unique ignoring case, `display_name`. A trigger on `auth.users` creates the row. |
| `organisation_access` | `user_id`, `organisation_id`, `role` of `owner`, `admin`, or `member`. One role per user per organisation. |

These four are changed through the functions above, not by open insert and update policies.

### Organisation profile

`organisation_defaults` is one row per organisation, created with the organisation.

| Column | Meaning |
| --- | --- |
| `home_currency_id` | Required. One of the organisation's currencies, always at rate 1. It cannot move once any document exists. |
| Address | `address_line1`–`address_line3` (100), `city` (60), `post_code` (20), `county` (60), `country_code` default `IE`. `EL` is a VAT prefix, not a postal country. |
| `address_needs_review` | Set when a free-text address was split or a VAT number could not be kept. Saving the address clears it. |
| Contact | `contact_name` (200), `contact_email`, `website` (200, no spaces), `phone` (40) |
| Registration | `vat_number` (country prefix plus 2–13 letters or digits), `company_number` (40) |
| `peppol_scheme`, `peppol_id` | Both set or both empty. Unique across every tenant, compared in lower case. Irish VAT electronic addresses use scheme `9935`. |
| Banking | `iban` (ISO 13616), `bic` (8 or 11), `bank_account_name` (100), `banking_details` (1000) |
| `logo_path` | Null, or `{organisation_id}/logo` |
| `lock_date` | Owners and admins. Blocks create, edit, post, void, and delete of a document dated on or before that day. |
| `inbound_invoice_type_id`, `inbound_credit_note_type_id` | Purchases types used when a received e-invoice is imported |

The logo file is an object in `organisation-logos` at `{organisation_id}/logo`: PNG, JPEG, WebP, or GIF, up to 2 MB. Posting copies it to `{organisation_id}/snapshots/{header_id}` before the document is posted.

`currencies`: `code` (read-only after save), `iso_code` linked to `ref_currencies` and unique in the organisation, `name`, `rate`. The rate is how many units of that currency equal one home unit, greater than 0, up to 8 decimal places. The home rate is 1 and cannot move. On a document, home amount = foreign amount ÷ `exchange_rate`.

### Setup lists

Each list is scoped by `(organisation_id, code)`. `code` matches `^[A-Z0-9][A-Z0-9.-]*$` after the triggers run. Products may be 30 characters. Other codes may be 20. Description is 1–200.

| Table | Extra columns |
| --- | --- |
| `gl_codes` | `account_type`: Fixed Asset, Current Liability, Current Asset, Income, Expense. A product purchase GL must be Expense. A product sales GL must be Income. The type cannot change while a product still uses that role. |
| `departments`, `cost_centres` | Code and description. Both are optional on a line. |
| `vat_rates` | `rate` 0–100 with two decimals, `vat_type` Sales or Expense, `vat_category`, and `exemption_code` / `exemption_reason` when the category requires them. A category on a posted or void line cannot change. |
| `products` | `purchase_price`, `sales_price` (4 decimals), purchase and sales GL and VAT, `unit_code` default `C62` |
| `customers`, `suppliers` | Same party shape: `name`, required `currency_id`, phone, email, website, structured address, VAT, company number, Peppol ID unique per organisation, `contact_details` (500), `notes` (4000), `payment_terms_days` 0–365. Customers also have `default_buyer_reference` (100). |
| `transaction_types` | `type` Sales or Purchases, `document_kind` invoice, credit_note, or order, `last_reference`, `numbering_rule` `on_insert` or `on_post`, `reference_prefix` (10), `reference_padding` 0–10, `flex1_label`–`flex5_label` (80). The kind cannot change after a document exists. Sales types number on post. |

`last_reference` only moves forward, by one, and only when a number is issued. Deleting a draft does not return the number. The printed number is the prefix plus the reference padded with zeros, stored on the document, and kept if the prefix later changes.

### Documents

`transaction_headers` is one document. `transaction_lines` are its lines. `transaction_vat_breakdown` is one row per VAT category and rate.

A purchase requires a supplier and cannot name a customer. A sale requires a customer and cannot name a supplier. The document currency is the party's currency. The exchange rate is read-only in the form when that currency is the home currency.

| Header column | Meaning |
| --- | --- |
| `transaction_type_id` | Fixed after insert |
| `reference` | Issued from `last_reference`. Unique per organisation and type. |
| `document_number` | Printed number, set when the reference is issued |
| `transaction_date` | Required |
| `due_date`, `supply_date` | Optional |
| `supplier_id`, `customer_id`, `party_name` | Party, and the name stored on the document |
| `supplier_reference` | Supplier invoice number. Purchases only. Unique per supplier ignoring case, unless the earlier document is void. |
| `currency_id`, `exchange_rate` | Party currency and the rate for this document |
| `order_number` | 40 |
| `preceding_header_id`, `preceding_reference`, `preceding_date` | Credit note's invoice. Posting requires the reference. A linked invoice must share the currency, and posted credits cannot exceed its total. |
| `buyer_reference`, `contract_reference`, `payment_terms` | BT-10, BT-12, BT-20 |
| `invoice_period_start`, `invoice_period_end` | Both set or both empty. End is not before start. |
| `payment_means_code` | UNCL4461. A sales post with an IBAN and a blank means becomes `58` (SEPA). Purchases stay unset. |
| Amounts | `foreign_nett_amount`, `foreign_vat_amount`, `foreign_total_amount`, `rounding_amount`, `amount_due`, and the three `home_*` amounts. Money is `numeric(18,2)`. Prices and quantities stay at 4 decimals. |
| `paid_amount` | The only amount still editable after posting |
| `status` | `draft`, `posted`, or `void` |
| `posted_at`, `posted_by`, `voided_at`, `voided_by`, `void_reason` | Set by `post_document` and `void_document` |
| `issuer_snapshot`, `party_snapshot` | Copies taken at posting, including address, Peppol, VAT, company number, and, for the issuer, bank details |
| `flex1`–`flex5` | Shown when that type has a label. 200 characters. |
| `contact_details`, `notes` | 500 and 4000 |

A draft can be edited and deleted. Posting needs at least one line. Purchases are numbered when the draft is saved. Sales drafts have no number until post, and a failed sales post does not consume a number. A void document cannot be changed or deleted.

| Line column | Meaning |
| --- | --- |
| `line_number` | From 1, unique on the header |
| `product_id` | Optional. Copies price, unit, GL, and VAT, which the line may then change. |
| `description` | Required, 1–200 |
| `unit_code` | Default `C62` |
| `line_note` | 400 |
| `seller_item_id` | 60. Purchases only. |
| `gl_code_id`, `department_id`, `cost_centre_id` | Optional. A sales post requires an Income GL on every line. |
| `vat_rate_id` | Expense on a purchase, Sales on a sale. Null means category `O` and VAT 0. |
| `quantity`, `price`, `discount_amount` | Quantity above 0. Discount not above quantity × price. |
| `nett_amount`, `vat_amount` | Written by trigger. Document VAT is the breakdown, not the sum of line VAT. |
| `vat_percentage`, category, exemption | Copied from the VAT code when the line is saved |

`transaction_forms` is one JSON layout per organisation and transaction type, at most 8000 characters. `pageSize` is `A4`, `A5`, `Letter`, or `Legal`. The JSON chooses the title and which organisation, party, header, and line fields appear. A sales form must show the organisation name, address, and VAT number, the customer name and address, the document number and date, the line description, quantity, price, tax, and amount, and the VAT summary. A sales credit note must also show the preceding invoice. The standard layout meets those rules. Print opens the browser dialog. PDF downloads the same page.

### Shared code lists

EN 16931 lists are shared by every organisation. Any signed-in user can read them. The API grants no insert, update, or delete. The seed is Peppol BIS Billing 3.0.21, May 2026, code lists dated 2026-03-06.

| Table | Contents |
| --- | --- |
| `ref_countries` | ISO 3166-1 alpha-2, plus `EL` as a VAT prefix only |
| `ref_currencies` | ISO 4217 with `minor_units` |
| `ref_units` | UN/ECE Recommendation 20, revision 11e |
| `ref_vat_categories` | UNCL5305 OpenPEPPOL subset |
| `ref_vatex` | CEF exemption reasons |
| `ref_payment_means` | UNCL4461 |
| `ref_eas` | Peppol electronic address schemes |

The short unit list on the form is `C62`, `H87`, `HUR`, `DAY`, `MON`, `KGM`, `LTR`, `MTR`, `MTK`, `KMT`, `SET`, and `XBX`. The short payment-means list is `30`, `31`, `42`, `48`, `49`, `58`, and `59`.

### E-documents

Ordinary inserts are not granted. Status changes go through `store_e_document`, validation, `import_e_document`, and `reject_e_document`.

`e_documents` holds the record. `e_document_contents` holds the XML, one row per document. `e_document_validation_results` holds Schematron findings (`layer` `xsd`, `en16931`, `peppol`, or `national`; `severity` `fatal` or `warning`). `e_document_events` is the status history and is frozen after insert.

| `e_documents` column | Meaning |
| --- | --- |
| `direction` | `outbound` or `inbound` |
| `status` | `generated`, `received`, `invalid`, `valid`, `duplicate`, `imported`, `rejected` |
| `source` | `generated` or `manual_upload` |
| `ubl_root` | `Invoice` or `CreditNote` |
| `header_id` | Linked Qula Tran document. One valid outbound file per header. One imported inbound file per header. |
| `duplicate_of` | Earlier file with the same hash |
| `sha256` | 64 hex characters. Unique per organisation and direction. |
| `byte_size` | 1 to 4 MiB |
| Party and totals | Sender and receiver scheme and id, document number, issue date, currency, total, amount due, seller and buyer name and VAT |
| `semantic` | EN 16931 JSON used for import and for the posted-total check |
| `validator_version`, `rules_version`, `validated_at` | Set together when validation has run |
| `rejection_reason` | Required when status is `rejected` |

XSD checking is not wired in. A file is still refused when it has a `DOCTYPE`, an external entity, a CII root, or a root that is not a UBL 2.1 Invoice or CreditNote. CEN EN 16931 Schematron runs, then Peppol BIS Billing 3.0.21 Schematron.

Posting an imported draft is refused when its nett, VAT, or total differs from `semantic` `BG-22` `BT-109`, `BT-110`, and `BT-112`.

### Audit

`audit_log`: `table_name`, `row_id`, `action`, `old_values`, `new_values`, `changed_at`, `changed_by`, `tenant_id`, `organisation_id`. It covers organisation defaults, access, suppliers, customers, VAT rates, GL codes, currencies, transaction types, and document headers.

## Who can do what

| Action | Member | Admin | Owner |
| --- | --- | --- | --- |
| Read the open organisation | yes | yes | yes |
| Customers, suppliers, and drafts | create, edit, delete | yes | yes |
| Post a document | yes | yes | yes |
| Edit the paid amount on a posted document | yes | yes | yes |
| Void a posted purchase | no | yes | yes |
| Raise a credit note from a posted sale | yes | yes | yes |
| Setup lists, forms, defaults, logo, lock date | read | change | change |
| Grant and revoke members | no | yes | yes |
| Grant owners and admins, create an organisation | no | no | yes |
| Download EN 16931 JSON | no | yes | yes |
| Read the audit log | no | yes | yes |
| Delete an organisation with no documents | no | no | yes, unless it is the last in the tenant |

Select on a business table uses `private.is_org_member(organisation_id)`.

## Environment

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server session key |
| `EINVOICE_HMAC_KEY` | Same secret as Vault `einvoice_hmac_k1` |
| `EINVOICE_HMAC_KEY_ID` | `k1` until the key is rotated |

To rotate the signing key, add Vault `einvoice_hmac_k2`, point the host at `k2`, and remove `k1` after a day. The key is not stored in the repository.

Local run:

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 43123
```

Open `http://localhost:43123`.
