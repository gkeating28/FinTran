-- Payments release B, phase 2: the two new document kinds (QULAPLUS_PAYMENTS_SPEC.md, 2.1).
--
-- A new enum value cannot be used in the transaction that adds it, so this is a migration of its own.
-- Nothing uses the values until the next migration.
--
-- Where the code branches on document_kind, it was checked for the new values. Every function that reads a kind on a
-- header compares it to a named kind ('invoice', 'credit_note', 'order', 'requisition'), so a payment or receipt falls
-- through to nothing. The next migration makes sure no header can have such a type.
alter type public.document_kind add value if not exists 'payment';
alter type public.document_kind add value if not exists 'receipt';

comment on type public.document_kind is 'invoice is EN 16931 BT-3 380 and credit_note is 381. order is not exported and is left out of later VAT reporting. payment (money out) and receipt (money in) number payments, which are not documents and never become transaction headers.';
