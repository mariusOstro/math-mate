\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
<<check_flow>>
declare
  u uuid := gen_random_uuid(); other_user uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  boot_id uuid := gen_random_uuid(); attempt_id uuid := gen_random_uuid(); command_id uuid := gen_random_uuid();
  question_id uuid; step_id uuid; thread_id uuid := gen_random_uuid(); user_message_id uuid := gen_random_uuid(); response_id uuid := gen_random_uuid();
  question jsonb := jsonb_build_object('source_id','RPC-TEST','question','Del 30 på 6.','level_code','4','difficulty',1,
    'category','divisjon','answer_value','5','answer_unit','kort','solution','30 / 6 = 5','validation_rules','{}'::jsonb);
  steps jsonb := '[{"step_number":1,"title":"Del","content":"Del antallet på seks."}]'::jsonb;
  result jsonb; command jsonb; before_count bigint;
begin
  if public.mathmate_import_problem(question,steps) <> 'inserted' then raise exception 'Initial import failed'; end if;
  if public.mathmate_import_problem(question,steps) <> 'skipped' then raise exception 'Repeated import was not idempotent'; end if;
  select id into question_id from public.problems where source_id = 'RPC-TEST' and is_active;
  select id into step_id from public.solution_steps where problem_id = question_id;
  insert into public.app_users(id) values(u),(other_user);
  command := jsonb_build_object('type','open_session','id',boot_id,'sessionId',s,'appVersion','rpc-test');
  result := public.mathmate_command(u,command);
  if result->>'sessionId' <> s::text then raise exception 'Wrong session id'; end if;
  perform public.mathmate_command(u,command);
  if (select count(*) from public.sessions where user_id = u) <> 1 then raise exception 'Repeated bootstrap created a second session'; end if;
  command := jsonb_build_object('type','start_attempt','id',command_id,'sessionId',s,'attemptId',attempt_id,'problemId',question_id);
  perform public.mathmate_command(u,command);
  result := public.mathmate_command(u,command);
  if not (result->>'replayed')::boolean then raise exception 'Attempt replay not detected'; end if;
  begin
    perform public.mathmate_command(u,jsonb_build_object('type','reveal_answer','id',command_id,'sessionId',s,'attemptId',attempt_id));
    raise exception 'Reused request id bypassed answer-reveal logging';
  exception when raise_exception then
    if sqlerrm <> 'request_conflict' then raise; end if;
  end;
  begin
    perform public.mathmate_command(other_user,command);
    raise exception 'Cross-user command was accepted';
  exception when raise_exception then
    if sqlerrm <> 'session_not_found' then raise; end if;
  end;
  perform public.mathmate_command(u,jsonb_build_object('type','mode_selected','id',gen_random_uuid(),'sessionId',s,'attemptId',attempt_id,'mode','guided'));
  select count(*) into before_count from public.events where session_id = s;
  begin
    perform public.mathmate_command(u,jsonb_build_object('type','reveal_step','id',gen_random_uuid(),'sessionId',s,'attemptId',attempt_id,'stepId',gen_random_uuid()));
    raise exception 'Invalid step was accepted';
  exception when raise_exception then
    if sqlerrm <> 'step_not_found' then raise; end if;
  end;
  if (select count(*) from public.events where session_id = s) <> before_count then raise exception 'Failed command left a partial event'; end if;
  perform public.mathmate_command(u,jsonb_build_object('type','reveal_step','id',gen_random_uuid(),'sessionId',s,'attemptId',attempt_id,'stepId',step_id));
  command_id := gen_random_uuid();
  command := jsonb_build_object('type','submit_answer','id',command_id,'sessionId',s,'attemptId',attempt_id,
    'rawAnswer','5 kort','normalizedAnswer','5','isCorrect',true,'checkerVersion','test');
  result := public.mathmate_command(u,command);
  if not (result->>'isCorrect')::boolean or not (result->>'solved')::boolean then raise exception 'Correct submission did not solve attempt'; end if;
  perform public.mathmate_command(u,command);
  begin
    perform public.mathmate_command(u,command || jsonb_build_object('rawAnswer','a different answer'));
    raise exception 'Reused request id accepted different answer content';
  exception when raise_exception then
    if sqlerrm <> 'request_conflict' then raise; end if;
  end;
  if (select count(*) from public.answer_submissions ans where ans.attempt_id = check_flow.attempt_id) < 1 then raise exception 'Submission missing'; end if;
  if (select count(*) from public.answer_submissions where id = command_id) <> 1 then raise exception 'Submission replay created duplicates'; end if;

  command := jsonb_build_object('type','begin_chat','id',user_message_id,'sessionId',s,'attemptId',attempt_id,
    'threadId',thread_id,'responseId',response_id,'content','Hvordan begynner jeg?','model','test-model','promptVersion','test',
    'minuteLimit',10,'dayLimit',100,'globalLimit',1000,'context','{}'::jsonb);
  perform public.mathmate_command(u,command);
  result := public.mathmate_command(u,command);
  if not (result->>'replayed')::boolean then raise exception 'Chat replay not detected'; end if;
  if (select count(*) from public.chat_messages m where m.thread_id = check_flow.thread_id) < 2 then raise exception 'Chat not persisted before generation'; end if;
  perform public.mathmate_command(u,jsonb_build_object('type','finish_chat','id',response_id,'sessionId',s,'attemptId',attempt_id,
    'messageId',response_id,'status','completed','content','Prøv å dele på seks.','inputTokens',30,'outputTokens',10,'latencyMs',100,'resolvedModel','resolved-test-model'));
  if (select status <> 'completed' or model <> 'resolved-test-model' from public.chat_messages where id = response_id) then raise exception 'Chat completion metadata missing'; end if;
  begin
    perform public.mathmate_command(u,command || jsonb_build_object('id',gen_random_uuid(),'responseId',gen_random_uuid(),'minuteLimit',1));
    raise exception 'Chat rate limit was not applied';
  exception when raise_exception then
    if sqlerrm <> 'chat_rate_limit' then raise; end if;
  end;

  if public.mathmate_import_problem(question || jsonb_build_object('question','Oppdatert oppgave: del 30 på 6.'),steps) <> 'versioned' then raise exception 'Changed content was not versioned'; end if;
  if (select count(*) from public.problems where source_id = 'RPC-TEST') <> 2 then raise exception 'Expected two problem versions'; end if;
  if (select problem_id from public.problem_attempts where id = attempt_id) <> question_id then raise exception 'Historical attempt changed version'; end if;

  -- Idle cleanup must close abandoned attempts without updating last_seen_at.
  update public.sessions set started_at = now() - interval '2 hours',last_activity_at = now() - interval '1 hour' where id = s;
  update public.app_users set created_at = now() - interval '3 hours',last_seen_at = now() - interval '1 hour' where id = u;
  perform public.mathmate_close_idle_sessions();
  if (select ended_at is null from public.sessions where id = s) then raise exception 'Idle session was not closed'; end if;
  if (select last_seen_at > now() - interval '50 minutes' from public.app_users where id = u) then raise exception 'Cleanup made the browser active again'; end if;
  perform public.mathmate_end_session(u,s);
  begin
    perform public.mathmate_end_session(other_user,s);
    raise exception 'Another browser closed an unrelated session';
  exception when raise_exception then
    if sqlerrm <> 'session_not_found' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.mathmate_command(uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.mathmate_import_problems(jsonb)','EXECUTE') then
    raise exception 'Browser role can call private application functions';
  end if;
end;
$$;
rollback;
\echo 'PASS: atomic application commands, browser ownership, retries, chat limits, import versioning and idle cleanup'
