alter table public.transaction_types
  add column reference_prefix text,
  add column reference_padding integer not null default 0,
  add constraint transaction_types_reference_prefix_check check (
    reference_prefix is null or reference_prefix ~ '^[A-Za-z0-9./-]{1,10}$'
  ),
  add constraint transaction_types_reference_padding_check check (reference_padding between 0 and 10);

comment on column public.transaction_types.reference_prefix is
  'Optional text placed before the document number. Later changes do not rewrite issued numbers.';
comment on column public.transaction_types.reference_padding is
  'Zero-pad width for the document number. 0 leaves the reference unpadded. Later changes do not rewrite issued numbers.';

alter table public.transaction_headers rename column supplier_name to party_name;
alter table public.transaction_headers
  rename constraint transaction_headers_supplier_name_check to transaction_headers_party_name_check;

comment on column public.transaction_headers.party_name is
  'Name stored on the document. Copied from the supplier or customer, and kept if the payload overrides it.';

alter table public.transaction_headers
  add column document_number text,
  add constraint transaction_headers_document_number_check check (
    document_number is null or char_length(document_number) between 1 and 30
  );

comment on column public.transaction_headers.document_number is
  'Printed document number, fixed when the reference is issued.';

create unique index transaction_headers_document_number_idx
  on public.transaction_headers (organisation_id, transaction_type_id, document_number)
  where document_number is not null;

create or replace function private.format_document_number(p_prefix text, p_padding integer, p_reference integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_prefix, '') || lpad(
    p_reference::text,
    greatest(p_padding, char_length(p_reference::text)),
    '0'
  );
$$;

comment on function private.format_document_number(text, integer, integer) is
  'Prefix plus zero padding. Padding 0 keeps the reference as written, because lpad to width 0 would erase it.';

revoke all on function private.format_document_number(text, integer, integer) from public, anon, authenticated;
