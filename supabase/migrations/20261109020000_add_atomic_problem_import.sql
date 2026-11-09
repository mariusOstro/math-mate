begin;
create function public.mathmate_import_problem(p_problem jsonb,p_steps jsonb)
returns text language plpgsql set search_path = '' as $$
declare previous public.problems; existing_content jsonb; existing_steps jsonb;
  problem_uuid uuid; next_version integer; item jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('mathmate:problem:' || (p_problem->>'source_id'),0));
  select * into previous from public.problems where source_id = p_problem->>'source_id' and is_active for update;
  if found then
    existing_content := jsonb_build_object('source_id',previous.source_id,'question',previous.question,'level_code',previous.level_code,
      'difficulty',previous.difficulty,'category',previous.category,'answer_value',previous.answer_value,'answer_unit',previous.answer_unit,
      'solution',previous.solution,'validation_rules',previous.validation_rules);
    select jsonb_agg(jsonb_build_object('step_number',step_number,'title',title,'content',content) order by step_number)
    into existing_steps from public.solution_steps where problem_id = previous.id;
    if existing_content = p_problem and coalesce(existing_steps,'[]'::jsonb) = p_steps then return 'skipped'; end if;
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then raise exception 'An imported problem needs solution steps.'; end if;
  select coalesce(max(version),0) + 1 into next_version from public.problems where source_id = p_problem->>'source_id';
  update public.problems set is_active = false where source_id = p_problem->>'source_id' and is_active;
  insert into public.problems(source_id,version,question,level_code,difficulty,category,answer_value,answer_unit,solution,validation_rules)
  values(p_problem->>'source_id',next_version,p_problem->>'question',p_problem->>'level_code',(p_problem->>'difficulty')::smallint,
    p_problem->>'category',p_problem->>'answer_value',p_problem->>'answer_unit',p_problem->>'solution',p_problem->'validation_rules') returning id into problem_uuid;
  for item in select value from jsonb_array_elements(p_steps) loop
    insert into public.solution_steps(problem_id,step_number,title,content)
    values(problem_uuid,(item->>'step_number')::integer,item->>'title',item->>'content');
  end loop;
  return case when next_version = 1 then 'inserted' else 'versioned' end;
end;
$$;
create function public.mathmate_import_problems(p_items jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare item jsonb; outcome text; inserted integer := 0; skipped integer := 0; versioned integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then raise exception 'Import up to 50 problems per batch.'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    outcome := public.mathmate_import_problem(item->'problem',item->'steps');
    if outcome = 'inserted' then inserted := inserted + 1;
    elsif outcome = 'versioned' then versioned := versioned + 1;
    else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'skipped',skipped,'versioned',versioned);
end;
$$;

-- Automatic cleanup must not make an inactive browser appear active again.
create or replace function public.mathmate_touch_activity()
returns trigger language plpgsql set search_path = '' as $$
declare session_uuid uuid;
begin
  if tg_table_name = 'events' then
    if new.event_type = 'session_ended' or (new.event_type = 'activity_heartbeat' and new.active_ms = 0) then return new; end if;
    session_uuid := new.session_id;
  elsif tg_table_name = 'problem_attempts' then session_uuid := new.session_id;
  elsif tg_table_name = 'answer_submissions' then
    select session_id into session_uuid from public.problem_attempts where id = new.attempt_id;
  elsif tg_table_name = 'chat_messages' then
    if new.role <> 'user' then return new; end if;
    select a.session_id into session_uuid from public.chat_threads t join public.problem_attempts a on a.id = t.attempt_id where t.id = new.thread_id;
  end if;
  update public.sessions set last_activity_at = greatest(last_activity_at,clock_timestamp()) where id = session_uuid and ended_at is null;
  update public.app_users set last_seen_at = greatest(last_seen_at,clock_timestamp()) where id = (select user_id from public.sessions where id = session_uuid);
  return new;
end;
$$;
create index chat_messages_assistant_budget_idx on public.chat_messages(received_at desc) where role = 'assistant';
create index chat_messages_pending_cleanup_idx on public.chat_messages(received_at) where status = 'pending';
revoke all on function public.mathmate_import_problem(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.mathmate_import_problems(jsonb) from public,anon,authenticated;
grant execute on function public.mathmate_import_problem(jsonb,jsonb) to service_role;
grant execute on function public.mathmate_import_problems(jsonb) to service_role;
commit;
