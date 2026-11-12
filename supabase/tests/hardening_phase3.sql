-- Hardening phase 3. Stored questions and answers: the notice, the retention period and the purge.
-- Builds its own tenant and rolls back.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d301', 'owner-harden3@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb),
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d302', 'member-harden3@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Member"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d301', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Harden Three Books', 'Harden Three Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
reset role;
insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d302', 'member');
-- A second organisation with no settings row, which uses the default of 30 days.
insert into public.organisations (tenant_id, name, slug)
values (current_setting('test.tenant')::uuid, 'Harden Three Second', 'harden-three-second');
select set_config('test.second', (select id::text from public.organisations where name = 'Harden Three Second'), true);
set local role authenticated;

do $$
declare
  v_org uuid := current_setting('test.org')::uuid;
  v_second uuid := current_setting('test.second')::uuid;
  v_tenant uuid := current_setting('test.tenant')::uuid;
  v_owner uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d301';
  v_cleared integer;
  v_row record;
begin
  -- The retention period defaults to 30 days and must be from 1 to 365.
  insert into public.ai_settings (organisation_id, tenant_id) values (v_org, v_tenant);
  if (select answer_retention_days from public.ai_settings where organisation_id = v_org) <> 30 then
    raise exception 'phase 3: the default retention is not 30 days';
  end if;
  begin
    update public.ai_settings set answer_retention_days = 0 where organisation_id = v_org;
    raise exception 'phase 3: a retention of 0 days was saved';
  exception when check_violation then null;
  end;
  begin
    update public.ai_settings set answer_retention_days = 366 where organisation_id = v_org;
    raise exception 'phase 3: a retention of 366 days was saved';
  exception when check_violation then null;
  end;

  -- Keeping the text cannot be switched on without accepting the notice.
  begin
    update public.ai_settings set log_answers = true where organisation_id = v_org;
    raise exception 'phase 3: log_answers was switched on without the notice';
  exception when others then
    if sqlerrm not like '%Accept the notice%30 days%' then raise exception 'phase 3: notice error was %', sqlerrm; end if;
  end;
  if (select log_answers from public.ai_settings where organisation_id = v_org) then
    raise exception 'phase 3: log_answers is on';
  end if;

  -- With the notice accepted it is switched on, and who accepted it and when is recorded.
  update public.ai_settings set log_answers = true, log_notice_accepted_at = clock_timestamp() where organisation_id = v_org;
  select log_answers, log_notice_accepted_at, log_notice_accepted_by into v_row from public.ai_settings where organisation_id = v_org;
  if not v_row.log_answers or v_row.log_notice_accepted_at is null or v_row.log_notice_accepted_by is distinct from v_owner then
    raise exception 'phase 3: the acceptance was not recorded';
  end if;

  -- Another setting can change without the notice again, but the number of days cannot.
  update public.ai_settings set user_hourly_limit = 40 where organisation_id = v_org;
  begin
    update public.ai_settings set answer_retention_days = 90 where organisation_id = v_org;
    raise exception 'phase 3: the retention changed without the notice';
  exception when others then
    if sqlerrm not like '%Accept the notice%90 days%' then raise exception 'phase 3: retention notice error was %', sqlerrm; end if;
  end;
  update public.ai_settings set answer_retention_days = 10, log_notice_accepted_at = clock_timestamp() where organisation_id = v_org;

  -- Switching it off needs nothing. Switching it back on needs the notice again.
  update public.ai_settings set log_answers = false where organisation_id = v_org;
  begin
    update public.ai_settings set log_answers = true where organisation_id = v_org;
    raise exception 'phase 3: log_answers was switched back on without the notice';
  exception when others then
    if sqlerrm not like '%Accept the notice%' then raise exception 'phase 3: second notice error was %', sqlerrm; end if;
  end;
  update public.ai_settings set log_answers = true, log_notice_accepted_at = clock_timestamp() where organisation_id = v_org;

  -- A member cannot switch it on.
  perform set_config('request.jwt.claims', json_build_object('sub', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d302', 'role', 'authenticated')::text, true);
  update public.ai_settings set answer_retention_days = 365, log_notice_accepted_at = clock_timestamp() where organisation_id = v_org;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  if (select answer_retention_days from public.ai_settings where organisation_id = v_org) <> 10 then
    raise exception 'phase 3: a member changed the retention';
  end if;

  -- Ratings of different ages. The first organisation keeps text for 10 days, the second for the default 30.
  reset role;
  insert into public.ai_feedback (organisation_id, tenant_id, user_id, at, rating, comment, question, answer) values
    (v_org, v_tenant, v_owner, now() - interval '11 days', -1, 'Old comment', 'Old question', 'Old answer'),
    (v_org, v_tenant, v_owner, now() - interval '9 days', 1, 'New comment', 'New question', 'New answer'),
    (v_org, v_tenant, v_owner, now() - interval '400 days', 1, null, null, null),
    (v_second, v_tenant, v_owner, now() - interval '31 days', -1, 'Second old', 'Second old question', 'Second old answer'),
    (v_second, v_tenant, v_owner, now() - interval '29 days', 1, 'Second new', 'Second new question', 'Second new answer');
  insert into public.ai_actions (organisation_id, tenant_id, user_id, action, summary, status, token_hash, expires_at)
  values (v_org, v_tenant, v_owner, 'add_party', 'Stale', 'proposed', repeat('a', 64), now() - interval '1 hour'),
         (v_org, v_tenant, v_owner, 'add_party', 'Fresh', 'proposed', repeat('b', 64), now() + interval '5 minutes');

  v_cleared := private.purge_ai_feedback_text();
  if v_cleared <> 2 then raise exception 'phase 3: the purge cleared % rows, not 2', v_cleared; end if;

  -- Older than the retention period: no text, and the rating is kept.
  select rating, comment, question, answer into v_row from public.ai_feedback where organisation_id = v_org and at < now() - interval '10 days' and at > now() - interval '12 days';
  if v_row.rating <> -1 or v_row.comment is not null or v_row.question is not null or v_row.answer is not null then
    raise exception 'phase 3: an old rating kept its text or lost its rating';
  end if;
  -- Inside the retention period: untouched.
  select rating, comment, question, answer into v_row from public.ai_feedback where organisation_id = v_org and at > now() - interval '10 days';
  if v_row.rating <> 1 or v_row.comment <> 'New comment' or v_row.question <> 'New question' or v_row.answer <> 'New answer' then
    raise exception 'phase 3: a rating inside the retention period was changed';
  end if;
  -- An organisation with no settings uses 30 days.
  if (select count(*) from public.ai_feedback where organisation_id = v_second and question is null) <> 1
     or (select question from public.ai_feedback where organisation_id = v_second and at > now() - interval '30 days') <> 'Second new question' then
    raise exception 'phase 3: the default retention of 30 days was not used';
  end if;
  if (select count(*) from public.ai_feedback where organisation_id in (v_org, v_second)) <> 5 then
    raise exception 'phase 3: the purge deleted a rating';
  end if;
  -- Running it again clears nothing more.
  if private.purge_ai_feedback_text() <> 0 then raise exception 'phase 3: a second purge cleared rows'; end if;

  -- The same job marks proposals nobody confirmed as expired.
  if (select status from public.ai_actions where token_hash = repeat('a', 64)) <> 'expired'
     or (select status from public.ai_actions where token_hash = repeat('b', 64)) <> 'proposed' then
    raise exception 'phase 3: stale proposals were not expired correctly';
  end if;

  -- The nightly wrapper only works in the hour that is 3am in Dublin.
  if extract(hour from (now() at time zone 'Europe/Dublin')) <> 3 and private.purge_ai_feedback_text_nightly() is not null then
    raise exception 'phase 3: the nightly job ran outside 3am Dublin time';
  end if;

  -- The job is scheduled once, at a quarter past every hour.
  if (select count(*) from cron.job where jobname = 'purge-ai-feedback-text' and schedule = '15 * * * *'
        and command = 'select private.purge_ai_feedback_text_nightly()') <> 1 then
    raise exception 'phase 3: the purge is not scheduled';
  end if;

  -- People cannot run the purge themselves, and only owners and admins can read stored text.
  set local role authenticated;
  begin
    perform private.purge_ai_feedback_text();
    raise exception 'phase 3: a signed-in person ran the purge';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d302', 'role', 'authenticated')::text, true);
  if (select count(*) from public.ai_feedback where organisation_id = v_org) <> 0 then
    raise exception 'phase 3: a member can read stored feedback';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  if (select count(*) from public.ai_feedback where organisation_id = v_org) <> 3 then
    raise exception 'phase 3: the owner cannot read stored feedback';
  end if;
end
$$;

select 'hardening phase 3 ok' as result;
rollback;
