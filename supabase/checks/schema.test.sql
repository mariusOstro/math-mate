\set ON_ERROR_STOP on
begin;

do $$
declare name text; role_name text;
begin
  foreach name in array array['app_users','sessions','problems','solution_steps','problem_attempts',
                              'answer_submissions','chat_threads','chat_messages','events'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = name and c.relrowsecurity) then
      raise exception 'Missing RLS on %', name;
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, 'public.' || name, 'SELECT')
         or has_table_privilege(role_name, 'public.' || name, 'INSERT')
         or has_table_privilege(role_name, 'public.' || name, 'UPDATE')
         or has_table_privilege(role_name, 'public.' || name, 'DELETE') then
        raise exception 'Unexpected browser privileges on % for %', name, role_name;
      end if;
    end loop;
  end loop;
  foreach name in array array['attempt_stats','session_stats','user_stats','problem_stats'] loop
    if has_table_privilege('anon', 'public.' || name, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || name, 'SELECT') then
      raise exception 'Unexpected browser access to view %', name;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.events', 'UPDATE') then
    raise exception 'Events must not be updatable by the backend';
  end if;
end;
$$;

-- Exercise triggers and views with exactly the privileges used by the backend.
set local role service_role;
do $$
declare
  u uuid := gen_random_uuid(); s uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
  st uuid := gen_random_uuid(); st2 uuid := gen_random_uuid();
  th uuid := gen_random_uuid(); th2 uuid := gen_random_uuid();
  um uuid := gen_random_uuid(); am uuid := gen_random_uuid(); ev uuid := gen_random_uuid();
  result record;
begin
  insert into public.app_users(id) values (u);
  insert into public.sessions(id,user_id,app_version) values (s,u,'schema-test'),(s2,u,'schema-test');
  insert into public.problems(id,source_id,question,level_code,difficulty,category,answer_value,answer_unit,solution)
  values (p,'TEST-A','30 kort fordeles på 6 elever.','4',1,'divisjon','5','kort','30 / 6 = 5'),
         (p2,'TEST-B','Finn halvparten av 20.','5',1,'brøk','10','','20 / 2 = 10');
  insert into public.solution_steps(id,problem_id,step_number,title,content)
  values (st,p,1,'Del','Del 30 på 6.'),(st2,p2,1,'Halver','Del på to.');
  insert into public.problem_attempts(id,session_id,problem_id)
  values (a,s,p),(a2,s,p),(a3,s,p2);
  insert into public.chat_threads(id,attempt_id) values (th,a),(th2,a2);
  insert into public.chat_messages(id,thread_id,sequence_number,role,content,occurred_at)
  values (um,th,1,'user','Hvordan begynner jeg?',clock_timestamp());
  insert into public.chat_messages(id,thread_id,in_reply_to_id,sequence_number,role,status,model,prompt_version,occurred_at)
  values (am,th,um,2,'assistant','pending','test-model','v1',clock_timestamp());
  update public.chat_messages set content = 'Hva blir 30 delt på 6?', status = 'completed', input_tokens = 30, output_tokens = 12 where id = am;

  insert into public.events(id,session_id,attempt_id,problem_id,sequence_number,event_type,active_ms,occurred_at)
  values (ev,s,a,p,1,'activity_heartbeat',700,clock_timestamp());
  -- Replaying a batch with the same event id is harmless when ON CONFLICT is used.
  insert into public.events(id,session_id,attempt_id,problem_id,sequence_number,event_type,active_ms,occurred_at)
  values (ev,s,a,p,1,'activity_heartbeat',700,clock_timestamp()) on conflict do nothing;
  insert into public.events(session_id,sequence_number,event_type,active_ms,occurred_at)
  values (s,2,'activity_heartbeat',500,clock_timestamp());
  insert into public.events(session_id,attempt_id,problem_id,step_id,sequence_number,event_type,occurred_at)
  values (s,a,p,st,3,'step_opened',clock_timestamp());

  insert into public.answer_submissions(attempt_id,submission_number,raw_answer,is_correct,evaluation_status,checker_version,occurred_at)
  values (a,1,'4',false,'completed','v1',clock_timestamp());
  if (select status from public.problem_attempts where id = a) <> 'in_progress' then
    raise exception 'Incorrect answer marked an attempt as solved';
  end if;
  insert into public.answer_submissions(attempt_id,submission_number,raw_answer,checker_version,occurred_at)
  values (a,2,'5 kort','v1',clock_timestamp());
  update public.answer_submissions set normalized_answer = '5', is_correct = true, evaluation_status = 'completed'
  where attempt_id = a and submission_number = 2;
  insert into public.answer_submissions(attempt_id,submission_number,raw_answer,is_correct,evaluation_status,checker_version,occurred_at)
  values (a2,1,'5',true,'completed','v1',clock_timestamp());
  update public.problem_attempts set status = 'abandoned', finished_at = clock_timestamp() where id = a3;

  select * into strict result from public.session_stats where session_id = s;
  if result.attempt_count <> 3 or result.solved_attempt_count <> 2
     or result.distinct_problems_solved <> 1 or result.submission_count <> 3
     or result.active_ms <> 1200 or result.unassisted_solved_count <> 1 then
    raise exception 'Session aggregation is wrong: %', row_to_json(result);
  end if;
  select * into strict result from public.attempt_stats where attempt_id = a;
  if result.submission_count <> 2 or result.active_ms <> 700 or not result.used_steps
     or result.solved_unassisted or result.user_message_count <> 1 or result.assistant_message_count <> 1
     or result.first_submission_correct or result.time_to_correct_ms < 0 then
    raise exception 'Attempt aggregation is wrong: %', row_to_json(result);
  end if;
  select * into strict result from public.user_stats where user_id = u;
  if result.session_count <> 2 or result.active_ms <> 1200 or result.submission_count <> 3 then
    raise exception 'User aggregation is wrong: %', row_to_json(result);
  end if;
  select * into strict result from public.problem_stats where problem_id = p;
  if result.attempt_count <> 2 or result.browser_user_count <> 1 or result.solved_attempt_count <> 2 then
    raise exception 'Problem aggregation is wrong: %', row_to_json(result);
  end if;

  begin
    insert into public.events(session_id,attempt_id,problem_id,sequence_number,event_type,occurred_at)
    values (s2,a,p,1,'problem_opened',clock_timestamp());
    raise exception 'Accepted an attempt from the wrong session';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.events(session_id,attempt_id,problem_id,step_id,sequence_number,event_type,occurred_at)
    values (s,a,p,st2,10,'step_opened',clock_timestamp());
    raise exception 'Accepted a step from the wrong problem';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.events(session_id,attempt_id,sequence_number,event_type,occurred_at)
    values (s,a,10,'problem_opened',clock_timestamp());
    raise exception 'Accepted an incomplete attempt context';
  exception when check_violation then null; end;
  begin
    insert into public.events(session_id,sequence_number,event_type,active_ms,occurred_at)
    values (s,10,'activity_heartbeat',60001,clock_timestamp());
    raise exception 'Accepted an unbounded active-time interval';
  exception when check_violation then null; end;
  begin
    insert into public.events(session_id,sequence_number,event_type,occurred_at)
    values (s,3,'chat_opened',clock_timestamp());
    raise exception 'Accepted a duplicate sequence number';
  exception when unique_violation then null; end;
  begin
    insert into public.chat_messages(thread_id,in_reply_to_id,sequence_number,role,status,model,prompt_version,occurred_at)
    values (th2,um,1,'assistant','pending','test','v1',clock_timestamp());
    raise exception 'Accepted a reply in the wrong chat thread';
  exception when check_violation or foreign_key_violation then null; end;
  begin
    insert into public.chat_messages(thread_id,in_reply_to_id,sequence_number,role,status,model,prompt_version,occurred_at)
    values (th,am,3,'assistant','pending','test','v1',clock_timestamp());
    raise exception 'Accepted an assistant message as a question';
  exception when check_violation then null; end;
  begin
    update public.problems set answer_value = '6' where id = p;
    raise exception 'Allowed changing a historical problem answer';
  exception when check_violation then null; end;
  begin
    update public.solution_steps set content = 'Changed' where id = st;
    raise exception 'Allowed changing a previously used step';
  exception when check_violation then null; end;
  begin
    update public.answer_submissions set is_correct = false where attempt_id = a and submission_number = 2;
    raise exception 'Allowed rewriting a completed submission';
  exception when check_violation then null; end;
  begin
    update public.chat_messages set content = 'Rewritten' where id = am;
    raise exception 'Allowed rewriting a completed AI response';
  exception when check_violation then null; end;
  begin
    insert into public.problems(source_id,question,level_code,difficulty,category,answer_value,solution)
    values ('TEST-A','Other version','4',1,'test','1','test');
    raise exception 'Allowed two active versions of the same source problem';
  exception when unique_violation then null; end;

  -- Verify that deleting a browser profile also removes its activity, with no orphan logs.
  delete from public.app_users where id = u;
  if exists (select 1 from public.events where session_id in (s,s2))
     or exists (select 1 from public.chat_messages where thread_id in (th,th2))
     or exists (select 1 from public.answer_submissions where attempt_id in (a,a2,a3)) then
    raise exception 'Deleting a profile left orphan activity data';
  end if;
end;
$$;
reset role;

-- Confirm that RLS still denies reads/writes even if an accidental grant is added later.
insert into public.app_users(id) values ('00000000-0000-0000-0000-000000000001');
grant select, insert on public.app_users to anon, authenticated;
set local role anon;
do $$
begin
  if exists (select 1 from public.app_users) then raise exception 'RLS leaked browser profiles'; end if;
  begin
    insert into public.app_users(id) values (gen_random_uuid());
    raise exception 'RLS allowed an anonymous insert';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.app_users) then raise exception 'RLS leaked profiles to authenticated'; end if;
end;
$$;
reset role;
rollback;
\echo 'PASS: schema, backend flow, statistics, versioning, foreign keys, deduplication, deletion and browser isolation'
