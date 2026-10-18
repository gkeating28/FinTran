-- Phase 2: role-based writes, reference issuing, ownership, and tenant management.

create or replace function private.issue_reference(p_transaction_type_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference integer;
begin
  perform 1
  from public.transaction_types
  where id = p_transaction_type_id
  for update;

  update public.transaction_types
  set last_reference = last_reference + 1
  where id = p_transaction_type_id
  returning last_reference into v_reference;

  if v_reference is null then
    raise exception 'Choose a Purchases transaction type';
  end if;

  return v_reference;
end;
$$;

revoke all on function private.issue_reference(uuid) from public, anon, authenticated;

create or replace function private.enforce_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  type_org uuid;
  type_kind text;
  supplier_org uuid;
  currency_org uuid;
  nett numeric(16, 4);
  vat numeric(16, 4);
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id
       or new.reference is distinct from old.reference) then
    raise exception 'A transaction cannot be moved or renumbered';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select organisation_id, type into type_org, type_kind
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_org is null or type_org is distinct from new.organisation_id or type_kind is distinct from 'Purchases' then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select organisation_id into supplier_org
  from public.suppliers
  where id = new.supplier_id;

  if supplier_org is null or supplier_org is distinct from new.organisation_id then
    raise exception 'Supplier must belong to this organisation';
  end if;

  select organisation_id into currency_org
  from public.currencies
  where id = new.currency_id;

  if currency_org is null or currency_org is distinct from new.organisation_id then
    raise exception 'Currency must belong to this organisation';
  end if;

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.supplier_name := btrim(new.supplier_name);
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  new.order_number := nullif(btrim(new.order_number), '');
  new.flex1 := nullif(btrim(new.flex1), '');
  new.flex2 := nullif(btrim(new.flex2), '');
  new.flex3 := nullif(btrim(new.flex3), '');
  new.flex4 := nullif(btrim(new.flex4), '');
  new.flex5 := nullif(btrim(new.flex5), '');

  if tg_op = 'INSERT' then
    new.reference := private.issue_reference(new.transaction_type_id);
  end if;

  select coalesce(sum(nett_amount), 0), coalesce(sum(vat_amount), 0)
    into nett, vat
  from public.transaction_lines
  where header_id = new.id;

  new.foreign_nett_amount := nett;
  new.foreign_vat_amount := vat;
  new.foreign_total_amount := nett + vat;
  new.home_nett_amount := round(nett / new.exchange_rate, 4);
  new.home_vat_amount := round(vat / new.exchange_rate, 4);
  new.home_total_amount := round((nett + vat) / new.exchange_rate, 4);

  return new;
end;
$$;

revoke all on function private.enforce_transaction_header() from public, anon, authenticated;

do $$
declare
  setup_table text;
  setup_tables text[] := array[
    'currencies',
    'gl_codes',
    'departments',
    'cost_centres',
    'vat_rates',
    'products',
    'transaction_types',
    'transaction_forms'
  ];
begin
  foreach setup_table in array setup_tables loop
    execute format('drop policy %I on public.%I', setup_table || '_insert', setup_table);
    execute format('drop policy %I on public.%I', setup_table || '_update', setup_table);
    execute format('drop policy %I on public.%I', setup_table || '_delete', setup_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.has_org_role(organisation_id, array[%L, %L])))',
      setup_table || '_insert',
      setup_table,
      'owner',
      'admin'
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.has_org_role(organisation_id, array[%L, %L]))) with check ((select private.has_org_role(organisation_id, array[%L, %L])))',
      setup_table || '_update',
      setup_table,
      'owner',
      'admin',
      'owner',
      'admin'
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.has_org_role(organisation_id, array[%L, %L])))',
      setup_table || '_delete',
      setup_table,
      'owner',
      'admin'
    );
  end loop;
end;
$$;

drop policy organisation_defaults_insert on public.organisation_defaults;
drop policy organisation_defaults_update on public.organisation_defaults;

create policy organisation_defaults_update on public.organisation_defaults
  for update to authenticated
  using ((select private.has_org_role(organisation_id, array['owner', 'admin'])))
  with check ((select private.has_org_role(organisation_id, array['owner', 'admin'])));

create or replace function private.organisation_logo_manage(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organisation uuid;
begin
  if object_name is null
     or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo$' then
    return false;
  end if;

  organisation := split_part(object_name, '/', 1)::uuid;
  return private.has_org_role(organisation, array['owner', 'admin']);
end;
$$;

revoke all on function private.organisation_logo_manage(text) from public, anon;
grant execute on function private.organisation_logo_manage(text) to authenticated, supabase_storage_admin;

drop policy organisation_logos_insert on storage.objects;
drop policy organisation_logos_update on storage.objects;
drop policy organisation_logos_delete on storage.objects;

create policy organisation_logos_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_manage(name)
  );

create policy organisation_logos_update
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_manage(name)
  )
  with check (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_manage(name)
  );

create policy organisation_logos_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_manage(name)
  );

create or replace function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_others integer;
begin
  if old.role = 'owner'
     and (
       tg_op = 'DELETE'
       or new.role is distinct from 'owner'
       or new.organisation_id is distinct from old.organisation_id
     )
  then
    select count(*) into v_others
    from public.organisation_access
    where organisation_id = old.organisation_id
      and role = 'owner'
      and user_id is distinct from old.user_id;

    if v_others = 0 then
      raise exception 'An organisation must keep at least one owner.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_last_owner() from public, anon, authenticated;

create trigger organisation_access_last_owner
  before update or delete on public.organisation_access
  for each row execute function private.guard_last_owner();

create or replace function public.grant_organisation_access(
  p_organisation_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  target_id uuid;
  target_role text;
  target_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before granting access';
  end if;
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Role must be owner, admin, or member';
  end if;

  caller_role := private.org_role(p_organisation_id);
  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'You need an owner or admin role in this organisation';
  end if;
  if caller_role = 'admin' and p_role <> 'member' then
    raise exception 'Could not grant access to that email address.';
  end if;

  select id into target_id
  from public.profiles
  where lower(email) = lower(btrim(p_email));

  if target_id is null then
    raise exception 'Could not grant access to that email address.';
  end if;

  select role into target_role
  from public.organisation_access
  where organisation_id = p_organisation_id
    and user_id = target_id;

  if caller_role = 'admin' and target_role in ('owner', 'admin') then
    raise exception 'Could not grant access to that email address.';
  end if;

  select tenant_id into target_tenant
  from public.organisations
  where id = p_organisation_id;

  insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
  values (target_tenant, p_organisation_id, target_id, p_role)
  on conflict (organisation_id, user_id) do update
    set role = excluded.role;
end;
$$;

create or replace function public.revoke_organisation_access(
  p_organisation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  target_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before changing access';
  end if;

  caller_role := private.org_role(p_organisation_id);
  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'You need an owner or admin role in this organisation';
  end if;

  select role into target_role
  from public.organisation_access
  where organisation_id = p_organisation_id
    and user_id = p_user_id;

  if target_role is null then
    raise exception 'That user does not have access to this organisation';
  end if;
  if caller_role = 'admin' and target_role <> 'member' then
    raise exception 'You can only remove a member';
  end if;

  delete from public.organisation_access
  where organisation_id = p_organisation_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.grant_organisation_access(uuid, text, text) from public, anon;
revoke all on function public.revoke_organisation_access(uuid, uuid) from public, anon;
grant execute on function public.grant_organisation_access(uuid, text, text) to authenticated;
grant execute on function public.revoke_organisation_access(uuid, uuid) to authenticated;

create or replace function private.can_manage_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_access
    where tenant_id = p_tenant_id
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

revoke all on function private.can_manage_tenant(uuid) from public, anon, authenticated;

create or replace function public.create_organisation(p_tenant_id uuid, organisation_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  organisation_id uuid;
  organisation_slug text;
  attempt integer := 0;
begin
  if uid is null then
    raise exception 'Sign in before creating an organisation';
  end if;
  if not (select private.can_manage_tenant(p_tenant_id)) then
    raise exception 'You need an owner role in this tenant';
  end if;
  if char_length(btrim(organisation_name)) < 2 then
    raise exception 'Name needs at least 2 characters';
  end if;

  organisation_slug := private.slugify(organisation_name);
  if organisation_slug = '' then
    raise exception 'Name needs at least one letter or number';
  end if;

  while exists (
    select 1 from public.organisations
    where tenant_id = p_tenant_id and slug = organisation_slug
  ) loop
    attempt := attempt + 1;
    if attempt > 5 then
      raise exception 'Could not reserve a unique organisation name';
    end if;
    organisation_slug := private.slugify(organisation_name) || '-' || substr(extensions.gen_random_uuid()::text, 1, 4);
  end loop;

  insert into public.organisations (tenant_id, name, slug)
  values (p_tenant_id, btrim(organisation_name), organisation_slug)
  returning id into organisation_id;

  insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
  values (p_tenant_id, organisation_id, uid, 'owner');

  return organisation_id;
end;
$$;

revoke all on function public.create_organisation(uuid, text) from public, anon;
grant execute on function public.create_organisation(uuid, text) to authenticated;

create or replace function public.save_purchase_invoice(p_document jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_header_id uuid;
  v_header_org uuid;
  v_supplier_name text;
  v_line jsonb;
  v_line_number integer := 0;
begin
  select organisation_id, tenant_id into v_org, v_tenant
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid
    and type = 'Purchases';

  if v_org is null then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = nullif(p_document->>'supplierId', '')::uuid
    and organisation_id = v_org;

  if v_supplier_name is null then
    raise exception 'Choose a supplier';
  end if;

  if nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_supplier_name := btrim(p_document->>'supplierName');
  end if;

  v_header_id := nullif(p_document->>'id', '')::uuid;

  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, supplier_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant,
      v_org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      (p_document->>'supplierId')::uuid,
      v_supplier_name,
      p_document->>'contactDetails',
      p_document->>'notes',
      (p_document->>'currencyId')::uuid,
      (p_document->>'exchangeRate')::numeric,
      p_document->>'orderNumber',
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      p_document->>'flex1',
      p_document->>'flex2',
      p_document->>'flex3',
      p_document->>'flex4',
      p_document->>'flex5'
    )
    returning id into v_header_id;
  else
    select organisation_id into v_header_org
    from public.transaction_headers
    where id = v_header_id;

    if v_header_org is null then
      raise exception 'That invoice could not be updated';
    end if;
    if v_header_org is distinct from v_org then
      raise exception 'That invoice belongs to another organisation';
    end if;
    if not exists (
      select 1
      from public.organisation_access
      where organisation_id = v_header_org
        and user_id = (select auth.uid())
    ) then
      raise exception 'You are not a member of this organisation';
    end if;

    update public.transaction_headers
    set transaction_date = (p_document->>'transactionDate')::date,
        due_date = nullif(p_document->>'dueDate', '')::date,
        supplier_id = (p_document->>'supplierId')::uuid,
        supplier_name = v_supplier_name,
        contact_details = p_document->>'contactDetails',
        notes = p_document->>'notes',
        currency_id = (p_document->>'currencyId')::uuid,
        exchange_rate = (p_document->>'exchangeRate')::numeric,
        order_number = p_document->>'orderNumber',
        paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
        flex1 = p_document->>'flex1',
        flex2 = p_document->>'flex2',
        flex3 = p_document->>'flex3',
        flex4 = p_document->>'flex4',
        flex5 = p_document->>'flex5'
    where id = v_header_id
      and organisation_id = v_org;

    if not found then
      raise exception 'That invoice could not be updated';
    end if;

    delete from public.transaction_lines
    where header_id = v_header_id;
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_document->'lines', '[]'::jsonb))
  loop
    v_line_number := v_line_number + 1;
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount
    ) values (
      v_tenant,
      v_org,
      v_header_id,
      (p_document->>'transactionTypeId')::uuid,
      0,
      v_line_number,
      nullif(v_line->>'productId', '')::uuid,
      coalesce(v_line->>'description', ''),
      nullif(v_line->>'glCodeId', '')::uuid,
      nullif(v_line->>'departmentId', '')::uuid,
      nullif(v_line->>'costCentreId', '')::uuid,
      nullif(v_line->>'vatRateId', '')::uuid,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      coalesce(nullif(v_line->>'price', '')::numeric, 0),
      coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0),
      0,
      0
    );
  end loop;

  return v_header_id;
end;
$$;

revoke all on function public.save_purchase_invoice(jsonb) from public, anon;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;
