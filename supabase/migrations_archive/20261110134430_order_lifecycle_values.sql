-- Order lifecycle, part 1. New status and kind values.
-- They are added on their own because a new enum value cannot be used in the transaction that adds it.
alter type public.document_status add value if not exists 'open';
alter type public.document_status add value if not exists 'closed';
alter type public.document_status add value if not exists 'cancelled';
alter type public.document_kind add value if not exists 'requisition';
