\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare
  u uuid := gen_random_uuid(); other_user uuid := gen_random_uuid();
  old_session uuid := gen_random_uuid(); new_session uuid := gen_random_uuid(); other_session uuid := gen_random_uuid();
  result jsonb; first_page jsonb; second_page jsonb; old_problem uuid; new_problem uuid;
begin
  insert into public.app_users(id) values(u),(other_user);
  insert into public.sessions(id,user_id,app_version) values
    (old_session,u,'queue-test'),(new_session,u,'queue-test'),(other_session,other_user,'queue-test');
  insert into public.problems(source_id,question,level_code,difficulty,category,answer_value,solution)
    select 'QUEUE-TEST-' || lpad(n::text,3,'0'),'Test question','4',1,'test','5','A private solution'
    from generate_series(1,156) n;
  insert into public.problems(source_id,question,level_code,difficulty,category,answer_value,solution)
    values('QUEUE-OTHER-LEVEL','Other level','5',1,'test','5','Private');
  result := public.mathmate_unattempted_problems(u,'4',0,150);
  if (result->>'total')::integer <> 156 or jsonb_array_length(result->'problems') <> 150 then
    raise exception 'The new user did not receive the full catalog with pagination';
  end if;
  if result->'problems'->0 ? 'answer_value' or result->'problems'->0 ? 'solution'
     or result->'problems'->0 ? 'validation_rules' then raise exception 'Queue leaked private answer fields'; end if;

  -- Across sessions: solved, abandoned, unfinished, and an incorrect answer all count.
  insert into public.problem_attempts(session_id,problem_id,status,first_correct_at,finished_at)
    select case when p.source_id <= 'QUEUE-TEST-002' then old_session else new_session end,p.id,
      case when p.source_id = 'QUEUE-TEST-001' then 'solved' when p.source_id in ('QUEUE-TEST-002','QUEUE-TEST-004') then 'abandoned' else 'in_progress' end,
      case when p.source_id = 'QUEUE-TEST-001' then now() else null end,
      case when p.source_id <> 'QUEUE-TEST-003' then now() else null end
    from public.problems p where p.source_id between 'QUEUE-TEST-001' and 'QUEUE-TEST-004';
  insert into public.answer_submissions(attempt_id,submission_number,raw_answer,is_correct,evaluation_status,checker_version,occurred_at,evaluated_at)
    select a.id,1,'incorrect',false,'completed','test',now(),now()
    from public.problem_attempts a join public.problems p on p.id = a.problem_id
    where a.session_id = new_session and p.source_id = 'QUEUE-TEST-004';
  insert into public.problem_attempts(session_id,problem_id)
    select other_session,id from public.problems where source_id = 'QUEUE-TEST-005';
  update public.sessions set ended_at = last_activity_at,end_reason = 'explicit' where id = old_session;

  -- A reimported version of an already attempted source must not reappear.
  select id into old_problem from public.problems where source_id = 'QUEUE-TEST-001';
  update public.problems set is_active = false where id = old_problem;
  insert into public.problems(source_id,version,question,level_code,difficulty,category,answer_value,solution)
    values('QUEUE-TEST-001',2,'Updated question','4',1,'test','6','New private solution') returning id into new_problem;
  first_page := public.mathmate_unattempted_problems(u,'4',0,150);
  second_page := public.mathmate_unattempted_problems(u,'4',150,150);
  if (first_page->>'total')::integer <> 152 or jsonb_array_length(first_page->'problems') <> 150
     or jsonb_array_length(second_page->'problems') <> 2 then raise exception 'History filtering broke counts or pagination'; end if;
  if first_page->'problems'->0->>'source_id' <> 'QUEUE-TEST-005'
     or (first_page->'problems'->0->>'position')::integer <> 5 then raise exception 'The user did not continue with problem five'; end if;
  if second_page->'problems'->0->>'source_id' <> 'QUEUE-TEST-155' then raise exception 'Ordering changed between pages'; end if;
  result := public.mathmate_unattempted_problems(other_user,'4',0,150);
  if (result->>'total')::integer <> 155 or result->'problems'->0->>'id' <> new_problem::text then
    raise exception 'One user inherited another user''s history';
  end if;
  result := public.mathmate_unattempted_problems(u,'5',0,150);
  if (result->>'total')::integer <> 1 then raise exception 'History crossed level boundaries'; end if;

  -- Exhaustion is an empty queue, never an automatic repeat of earlier questions.
  insert into public.problem_attempts(session_id,problem_id)
    select new_session,p.id from public.problems p where p.is_active and p.level_code = '4';
  result := public.mathmate_unattempted_problems(u,'4',0,150);
  if (result->>'total')::integer <> 0 or result->'problems' <> '[]'::jsonb then raise exception 'Exhausted queue repeated questions'; end if;
  if has_function_privilege('anon','public.mathmate_unattempted_problems(uuid,text,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.mathmate_unattempted_problems(uuid,text,integer,integer)','EXECUTE') then
    raise exception 'Personal queue is callable by browser database roles';
  end if;
end;
$$;
rollback;
\echo 'PASS: personal queues, cross-session history, original numbering, all attempt states, versions, privacy, pagination and exhaustion'
