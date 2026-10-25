-- Schema fixes phase 2. A tenant with documents cannot be deleted.

alter table public.transaction_headers
  drop constraint transaction_headers_tenant_id_fkey;

alter table public.transaction_headers
  add constraint transaction_headers_tenant_id_fkey
  foreign key (tenant_id) references public.tenants (id) on delete restrict;

alter table public.transaction_lines
  drop constraint transaction_lines_tenant_id_fkey;

alter table public.transaction_lines
  add constraint transaction_lines_tenant_id_fkey
  foreign key (tenant_id) references public.tenants (id) on delete restrict;

comment on table public.tenants is
  'Deletion is blocked while any transaction header or line exists. Those foreign keys are ON DELETE RESTRICT so a tenant cascade cannot bypass the organisation restrict on documents. Setup rows still cascade. There is no API function for deleting a tenant.';
