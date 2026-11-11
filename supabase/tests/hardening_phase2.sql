-- Hardening phase 2. Ask Qula actions: the switch, single-use tokens, expiry and the changed-document check.
-- Builds its own tenant and rolls back.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d201', 'owner-harden2@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb),
  ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d202', 'member-harden2@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Member"}'::jsonb),
  ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d203', 'other-harden2@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Other"}'::jsonb);

-- A second tenant, for the person who must not be able to use the first tenant's tokens.
select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d203', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.other_org', (public.create_tenant('Harden Two Other', 'Harden Two Other Office'))->>'organisation_id', true);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d201', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Harden Two Books', 'Harden Two Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, reference_prefix, reference_padding)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', null, 0);
select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);

-- A second member of the same organisation.
reset role;
insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d202', 'member');
set local role authenticated;

create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.hash(p_token text) returns text language sql as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;
create function pg_temp.draft(p_reference text) returns uuid language sql as $$
  select public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'supplierReference', p_reference,
    'transactionDate', '2026-11-12',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 100))
  ));
$$;

do $$
declare
  v_org uuid := current_setting('test.org')::uuid;
  v_owner text := 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d201';
  v_member text := 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d202';
  v_other text := 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d203';
  v_draft uuid;
  v_second uuid;
  v_result text;
  v_count integer;
begin
  -- The switch exists, is off by default, and cannot be on while AI answers are off.
  insert into public.ai_settings (organisation_id, tenant_id) values (v_org, current_setting('test.tenant')::uuid);
  if (select actions_enabled from public.ai_settings where organisation_id = v_org) then
    raise exception 'phase 2: actions are on by default';
  end if;
  update public.ai_settings set actions_enabled = true where organisation_id = v_org;
  if (select actions_enabled from public.ai_settings where organisation_id = v_org) then
    raise exception 'phase 2: actions were switched on while AI answers are off';
  end if;

  v_draft := pg_temp.draft('SUP-1');

  -- With actions off nothing can be proposed.
  begin
    perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-off'), v_draft, 'Post', '{}'::jsonb);
    raise exception 'phase 2: a proposal was accepted with actions off';
  exception when others then
    if sqlerrm not like '%switched off%' then raise exception 'phase 2: off error was %', sqlerrm; end if;
  end;

  -- Switch AI answers and actions on.
  perform public.set_organisation_secret(v_org, 'ai_api_key', 'ciphertext', 'abcd');
  update public.ai_settings
  set enabled = true, provider_code = 'mock', model = 'mock', data_notice_accepted_at = now(), actions_enabled = true
  where organisation_id = v_org;
  if not (select actions_enabled from public.ai_settings where organisation_id = v_org) then
    raise exception 'phase 2: actions could not be switched on';
  end if;

  -- A member cannot change the switch.
  perform pg_temp.as_user(v_member);
  update public.ai_settings set actions_enabled = false where organisation_id = v_org;
  perform pg_temp.as_user(v_owner);
  if not (select actions_enabled from public.ai_settings where organisation_id = v_org) then
    raise exception 'phase 2: a member changed the actions switch';
  end if;

  -- Propose, then confirm twice. The first works and the second is refused.
  perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-1'), v_draft, 'Post SUP-1', '{"title":"Post"}'::jsonb);
  if (select status || ':' || (expires_at - at = interval '10 minutes')::text || ':' || (target_version = (select updated_at from public.transaction_headers where id = v_draft))::text
      from public.ai_actions where token_hash = pg_temp.hash('token-1')) <> 'proposed:true:true' then
    raise exception 'phase 2: the proposal row is wrong';
  end if;
  if exists (select 1 from public.ai_actions where token_hash = 'token-1' or proposal::text like '%token-1%' or summary like '%token-1%') then
    raise exception 'phase 2: the token itself was stored';
  end if;

  -- Another member of the same organisation, and a person in another organisation, cannot use it.
  perform pg_temp.as_user(v_member);
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-1'));
  if v_result <> 'unknown' then raise exception 'phase 2: another member got %', v_result; end if;
  perform pg_temp.as_user(v_other);
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-1'));
  if v_result <> 'unknown' then raise exception 'phase 2: an outsider got %', v_result; end if;
  v_result := public.confirm_ai_action(current_setting('test.other_org')::uuid, pg_temp.hash('token-1'));
  if v_result not in ('unknown', 'disabled') then raise exception 'phase 2: another organisation got %', v_result; end if;
  perform pg_temp.as_user(v_owner);
  -- The right person in the wrong organisation is refused too.
  v_result := public.confirm_ai_action(current_setting('test.other_org')::uuid, pg_temp.hash('token-1'));
  if v_result <> 'unknown' then raise exception 'phase 2: the wrong organisation got %', v_result; end if;
  if (select status from public.ai_actions where token_hash = pg_temp.hash('token-1')) <> 'proposed' then
    raise exception 'phase 2: a refused confirm used the token';
  end if;

  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-1'));
  if v_result <> 'confirmed' then raise exception 'phase 2: first confirm got %', v_result; end if;
  perform public.post_document(v_draft, null);
  perform public.finish_ai_action(pg_temp.hash('token-1'), true, 'Posted SUP-1', '');
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-1'));
  if v_result <> 'used' then raise exception 'phase 2: second confirm got %', v_result; end if;
  if (select status::text from public.transaction_headers where id = v_draft) <> 'posted' then
    raise exception 'phase 2: the draft was not posted';
  end if;
  select count(*) into v_count from public.ai_actions where target_id = v_draft and status = 'confirmed';
  if v_count <> 1 then raise exception 'phase 2: % confirmed rows for one post', v_count; end if;

  -- A posted document cannot be proposed again.
  begin
    perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-posted'), v_draft, 'Post', '{}'::jsonb);
    raise exception 'phase 2: a posted document was proposed';
  exception when others then
    if sqlerrm not like '%Only a draft%' then raise exception 'phase 2: posted error was %', sqlerrm; end if;
  end;

  -- Editing the draft after the proposal makes the confirm fail, and the token is spent.
  v_second := pg_temp.draft('SUP-2');
  perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-2'), v_second, 'Post SUP-2', '{}'::jsonb);
  -- Every statement in this test shares one transaction time, so a later edit is simulated by moving updated_at on,
  -- which is what the audit trigger does for an edit in a later transaction.
  reset role;
  set local session_replication_role = replica;
  update public.transaction_headers set notes = 'Changed', updated_at = updated_at + interval '1 second' where id = v_second;
  set local session_replication_role = origin;
  set local role authenticated;
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-2'));
  if v_result <> 'changed' then raise exception 'phase 2: confirm after an edit got %', v_result; end if;
  if (select status from public.ai_actions where token_hash = pg_temp.hash('token-2')) <> 'failed' then
    raise exception 'phase 2: a changed document did not fail the action';
  end if;
  if (select status::text from public.transaction_headers where id = v_second) <> 'draft' then
    raise exception 'phase 2: the changed draft was posted';
  end if;

  -- A newer proposal for the same document replaces the older one.
  perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-3'), v_second, 'Post SUP-2', '{}'::jsonb);
  perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-4'), v_second, 'Post SUP-2', '{}'::jsonb);
  if (select status from public.ai_actions where token_hash = pg_temp.hash('token-3')) <> 'superseded' then
    raise exception 'phase 2: the older proposal was not superseded';
  end if;
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-3'));
  if v_result <> 'expired' then raise exception 'phase 2: a superseded token got %', v_result; end if;

  -- After ten minutes the token is refused and marked expired.
  reset role;
  update public.ai_actions set expires_at = now() - interval '1 second' where token_hash = pg_temp.hash('token-4');
  set local role authenticated;
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-4'));
  if v_result <> 'expired' then raise exception 'phase 2: a late token got %', v_result; end if;
  if (select status from public.ai_actions where token_hash = pg_temp.hash('token-4')) <> 'expired' then
    raise exception 'phase 2: a late token was not marked expired';
  end if;

  -- A token nobody issued.
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('never-issued'));
  if v_result <> 'unknown' then raise exception 'phase 2: an unknown token got %', v_result; end if;

  -- Adding a party has no target, and a failed action is recorded as failed.
  perform public.propose_ai_action(v_org, 'add_party', pg_temp.hash('token-5'), null, 'Add supplier ACME', '{}'::jsonb);
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-5'));
  if v_result <> 'confirmed' then raise exception 'phase 2: add party confirm got %', v_result; end if;
  perform public.finish_ai_action(pg_temp.hash('token-5'), false, 'Add supplier ACME', 'That code is taken.');
  if (select status || ':' || detail from public.ai_actions where token_hash = pg_temp.hash('token-5')) <> 'failed:That code is taken.' then
    raise exception 'phase 2: a failed action was not recorded';
  end if;

  -- Switching actions off refuses a token that is otherwise good.
  perform public.propose_ai_action(v_org, 'post_draft', pg_temp.hash('token-6'), v_second, 'Post SUP-2', '{}'::jsonb);
  update public.ai_settings set actions_enabled = false where organisation_id = v_org;
  v_result := public.confirm_ai_action(v_org, pg_temp.hash('token-6'));
  if v_result <> 'disabled' then raise exception 'phase 2: confirm with actions off got %', v_result; end if;
  if (select status::text from public.transaction_headers where id = v_second) <> 'draft' then
    raise exception 'phase 2: a document was posted with actions off';
  end if;

  -- Switching AI answers off switches actions off with them.
  update public.ai_settings set actions_enabled = true where organisation_id = v_org;
  update public.ai_settings set enabled = false where organisation_id = v_org;
  if (select actions_enabled from public.ai_settings where organisation_id = v_org) then
    raise exception 'phase 2: actions stayed on after AI answers were switched off';
  end if;

  -- People cannot write action rows themselves, and a member cannot read them.
  begin
    insert into public.ai_actions (organisation_id, tenant_id, action, summary, status)
    values (v_org, current_setting('test.tenant')::uuid, 'post_draft', 'Forged', 'confirmed');
    raise exception 'phase 2: an action row was written directly';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user(v_member);
  select count(*) into v_count from public.ai_actions where organisation_id = v_org;
  if v_count <> 0 then raise exception 'phase 2: a member can read the action log'; end if;
end
$$;

select 'hardening phase 2 ok' as result;
rollback;
