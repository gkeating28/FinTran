-- Phase 4 acceptance tests. Raises on failure and rolls back.
begin;

create temp table phase4_users (who text primary key, id uuid not null);
insert into phase4_users (who, id) values
  ('owner', 'a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4'),
  ('admin', 'b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4'),
  ('member', 'c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-phase4@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', who)
from phase4_users;

select set_config('test.owner_id', (select id::text from phase4_users where who = 'owner'), true);
select set_config('test.admin_id', (select id::text from phase4_users where who = 'admin'), true);
select set_config('test.member_id', (select id::text from phase4_users where who = 'member'), true);

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.org', (public.create_tenant('Phase Four Books', 'Phase Four Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-phase4@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-phase4@fintran.test', 'member');

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');

select set_config('test.type', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.member_id'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.header', public.save_purchase_invoice(jsonb_build_object(
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-06-15',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 10))
))::text, true);

select set_config('test.sealed', public.save_purchase_invoice(jsonb_build_object(
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-06-15',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Sealed line', 'quantity', 1, 'price', 3))
))::text, true);
select public.post_document(current_setting('test.sealed')::uuid);

select set_config('test.locked', public.save_purchase_invoice(jsonb_build_object(
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-06-15',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Locked line', 'quantity', 1, 'price', 8))
))::text, true);

select set_config('test.empty', public.save_purchase_invoice(jsonb_build_object(
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-07-01',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', '[]'::jsonb
))::text, true);

do $$
begin
  update public.transaction_headers set status = 'posted' where id = current_setting('test.header')::uuid;
  raise exception 'phase 4: a direct status update was allowed';
exception
  when others then
    if sqlerrm not like '%posting or voiding%' then
      raise exception 'phase 4: direct status error was %', sqlerrm;
    end if;
end;
$$;

do $$
begin
  perform public.post_document(current_setting('test.empty')::uuid);
  raise exception 'phase 4: an empty document was posted';
exception
  when others then
    if sqlerrm not like '%Add a line%' then
      raise exception 'phase 4: empty post error was %', sqlerrm;
    end if;
end;
$$;

select public.post_document(current_setting('test.header')::uuid);

do $$
declare
  v_line uuid;
begin
  select id into v_line from public.transaction_lines where header_id = current_setting('test.header')::uuid limit 1;
  begin
    update public.transaction_lines set description = 'Changed' where id = v_line;
    raise exception 'phase 4: a posted line was updated';
  exception
    when others then
      if sqlerrm not like '%cannot be changed%' then
        raise exception 'phase 4: posted line error was %', sqlerrm;
      end if;
  end;
  begin
    delete from public.transaction_lines where id = v_line;
    raise exception 'phase 4: a posted line was deleted';
  exception
    when others then
      if sqlerrm not like '%cannot be changed%' then
        raise exception 'phase 4: posted line delete error was %', sqlerrm;
      end if;
  end;
  begin
    update public.transaction_headers set notes = 'Nope' where id = current_setting('test.header')::uuid;
    raise exception 'phase 4: a posted header field was changed';
  exception
    when others then
      if sqlerrm not like '%paid amount%' then
        raise exception 'phase 4: posted header error was %', sqlerrm;
      end if;
  end;
  update public.transaction_headers set paid_amount = 4 where id = current_setting('test.header')::uuid;
  if (select paid_amount from public.transaction_headers where id = current_setting('test.header')::uuid) is distinct from 4 then
    raise exception 'phase 4: paid amount was not saved';
  end if;
  begin
    delete from public.transaction_headers where id = current_setting('test.header')::uuid;
    raise exception 'phase 4: a posted document was deleted';
  exception
    when others then
      if sqlerrm not like '%cannot be deleted%' then
        raise exception 'phase 4: posted delete error was %', sqlerrm;
      end if;
  end;
  begin
    perform public.void_document(current_setting('test.header')::uuid, 'Member void');
    raise exception 'phase 4: a member voided a document';
  exception
    when others then
      if sqlerrm not like '%owner or admin%' then
        raise exception 'phase 4: member void error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.void_document(current_setting('test.header')::uuid, '   ');
  raise exception 'phase 4: a blank void reason was accepted';
exception
  when others then
    if sqlerrm not like '%reason%' then
      raise exception 'phase 4: blank reason error was %', sqlerrm;
    end if;
end;
$$;

select public.void_document(current_setting('test.header')::uuid, 'Entered in error');

do $$
begin
  if (select void_reason from public.transaction_headers where id = current_setting('test.header')::uuid) is distinct from 'Entered in error' then
    raise exception 'phase 4: void reason was not stored';
  end if;
  begin
    delete from public.transaction_headers where id = current_setting('test.header')::uuid;
    raise exception 'phase 4: a void document was deleted';
  exception
    when others then
      if sqlerrm not like '%cannot be deleted%' then
        raise exception 'phase 4: void delete error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
set local role authenticated;

update public.organisation_defaults
set lock_date = date '2026-06-30'
where organisation_id = current_setting('test.org')::uuid;

do $$
begin
  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.type'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-06-15',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Locked', 'quantity', 1, 'price', 5))
    ));
    raise exception 'phase 4: a locked-period document was created';
  exception
    when others then
      if sqlerrm not like '%locked period%' then
        raise exception 'phase 4: locked create error was %', sqlerrm;
      end if;
  end;

  begin
    update public.transaction_headers set notes = 'Later' where id = current_setting('test.locked')::uuid;
    raise exception 'phase 4: a locked-period document was edited';
  exception
    when others then
      if sqlerrm not like '%locked period%' then
        raise exception 'phase 4: locked edit error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.post_document(current_setting('test.locked')::uuid);
    raise exception 'phase 4: a locked-period document was posted';
  exception
    when others then
      if sqlerrm not like '%locked period%' then
        raise exception 'phase 4: locked post error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.void_document(current_setting('test.sealed')::uuid, 'Locked void');
    raise exception 'phase 4: a locked-period document was voided';
  exception
    when others then
      if sqlerrm not like '%locked period%' then
        raise exception 'phase 4: locked void error was %', sqlerrm;
      end if;
  end;

  begin
    delete from public.transaction_headers where id = current_setting('test.locked')::uuid;
    raise exception 'phase 4: a locked-period document was deleted';
  exception
    when others then
      if sqlerrm not like '%locked period%' then
        raise exception 'phase 4: locked delete error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select 'phase 4 ok' as result;
rollback;
