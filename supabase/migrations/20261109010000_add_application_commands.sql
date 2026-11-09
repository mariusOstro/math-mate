-- Atomic commands for a stateless Next.js/Vercel backend. All functions are server-only.
begin;

create function public.mathmate_emit(
  p_session_id uuid, p_attempt_id uuid, p_id uuid, p_type text,
  p_occurred_at timestamptz, p_payload jsonb default '{}'::jsonb,
  p_step_id uuid default null, p_active_ms integer default 0
) returns void language plpgsql set search_path = '' as $$
declare problem_uuid uuid; next_sequence bigint; allowed_active bigint;
begin
  perform 1 from public.sessions where id = p_session_id for update;
  if exists (select 1 from public.events where id = p_id and session_id = p_session_id) then return; end if;
  if p_attempt_id is not null then
    select problem_id into problem_uuid from public.problem_attempts
    where id = p_attempt_id and session_id = p_session_id;
    if not found then raise exception 'attempt_not_found' using errcode = 'P0001'; end if;
  end if;
  select coalesce(max(sequence_number), 0) + 1 into next_sequence from public.events where session_id = p_session_id;
  if p_type = 'activity_heartbeat' then
    select greatest(0, floor(extract(epoch from (clock_timestamp() - started_at)) * 1000)
      - coalesce((select sum(active_ms) from public.events where session_id = p_session_id), 0))
    into allowed_active from public.sessions where id = p_session_id;
  else allowed_active := 0;
  end if;
  insert into public.events(id,session_id,attempt_id,problem_id,step_id,sequence_number,event_type,active_ms,payload,occurred_at)
  values(p_id,p_session_id,p_attempt_id,problem_uuid,p_step_id,next_sequence,p_type,
         least(greatest(0,p_active_ms),60000,allowed_active),p_payload,p_occurred_at);
end;
$$;

create function public.mathmate_command(p_user_id uuid, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  kind text := p_command->>'type';
  session_uuid uuid := nullif(p_command->>'sessionId','')::uuid;
  command_uuid uuid := nullif(p_command->>'id','')::uuid;
  attempt_uuid uuid := nullif(p_command->>'attemptId','')::uuid;
  occurred timestamptz := coalesce((p_command->>'occurredAt')::timestamptz,clock_timestamp());
  ses public.sessions; att public.problem_attempts; msg public.chat_messages; old_event public.events;
  result jsonb := '{}'::jsonb; event_type_name text; event_step uuid; event_payload jsonb := '{}'::jsonb;
  event_item jsonb; event_attempt uuid; problem_uuid uuid; thread_uuid uuid; message_uuid uuid; response_uuid uuid;
  submission_sequence integer; message_sequence integer; request_count bigint;
  request_fingerprint text := md5(jsonb_build_object(
    'type',p_command->'type','sessionId',p_command->'sessionId','attemptId',p_command->'attemptId',
    'problemId',p_command->'problemId','stepId',p_command->'stepId','mode',p_command->'mode',
    'rawAnswer',p_command->'rawAnswer','threadId',p_command->'threadId','content',p_command->'content',
    'responseId',p_command->'responseId','messageId',p_command->'messageId','status',p_command->'status')::text);
begin
  if not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'browser_not_found' using errcode = 'P0001';
  end if;

  if kind = 'open_session' then
    select e.* into old_event from public.events e join public.sessions s on s.id = e.session_id
    where e.id = command_uuid and e.event_type = 'session_started' and s.user_id = p_user_id;
    if found then return jsonb_build_object('sessionId',old_event.session_id,'resumed',true); end if;
    select * into ses from public.sessions where id = session_uuid for update;
    if found then
      if ses.user_id <> p_user_id then raise exception 'session_not_found' using errcode = 'P0001'; end if;
      if ses.ended_at is null and ses.last_activity_at >= clock_timestamp() - interval '30 minutes' then
        return jsonb_build_object('sessionId',ses.id,'resumed',true);
      end if;
      if ses.ended_at is null then
        update public.sessions set ended_at = last_activity_at,end_reason = 'inactivity' where id = ses.id;
        update public.problem_attempts set status = 'abandoned',finished_at = greatest(started_at,ses.last_activity_at)
        where session_id = ses.id and status = 'in_progress';
      end if;
      session_uuid := gen_random_uuid();
    end if;
    session_uuid := coalesce(session_uuid,gen_random_uuid());
    insert into public.sessions(id,user_id,app_version) values(session_uuid,p_user_id,p_command->>'appVersion');
    perform public.mathmate_emit(session_uuid,null,coalesce(command_uuid,gen_random_uuid()),'session_started',occurred,
      jsonb_build_object('app_version',p_command->>'appVersion'));
    return jsonb_build_object('sessionId',session_uuid,'resumed',false);
  end if;

  select * into ses from public.sessions where id = session_uuid and user_id = p_user_id for update;
  if not found then raise exception 'session_not_found' using errcode = 'P0001'; end if;
  if command_uuid is not null then
    select * into old_event from public.events where id = command_uuid;
    if found then
      if old_event.session_id <> session_uuid or old_event.attempt_id is distinct from attempt_uuid
         or old_event.payload->>'_request_fingerprint' is distinct from request_fingerprint then
        raise exception 'request_conflict' using errcode = 'P0001';
      end if;
      return coalesce(old_event.payload->'_result','{}'::jsonb) || jsonb_build_object('replayed',true);
    end if;
  end if;
  if attempt_uuid is not null and kind <> 'start_attempt' then
    select * into att from public.problem_attempts where id = attempt_uuid and session_id = session_uuid for update;
    if not found then raise exception 'attempt_not_found' using errcode = 'P0001'; end if;
  end if;

  if kind = 'start_attempt' then
    if ses.ended_at is not null then raise exception 'session_expired' using errcode = 'P0001'; end if;
    problem_uuid := (p_command->>'problemId')::uuid;
    if not exists (select 1 from public.problems where id = problem_uuid and is_active) then
      raise exception 'problem_not_found' using errcode = 'P0001';
    end if;
    insert into public.problem_attempts(id,session_id,problem_id) values(attempt_uuid,session_uuid,problem_uuid);
    result := jsonb_build_object('attemptId',attempt_uuid,'status','in_progress');
    event_type_name := 'problem_opened';

  elsif kind = 'mode_selected' then
    if p_command->>'mode' not in ('self','guided') then raise exception 'invalid_mode' using errcode = 'P0001'; end if;
    update public.problem_attempts set initial_mode = p_command->>'mode' where id = att.id and initial_mode = 'undecided';
    result := jsonb_build_object('mode',p_command->>'mode');
    event_type_name := 'mode_selected'; event_payload := result;

  elsif kind = 'reveal_step' then
    event_step := (p_command->>'stepId')::uuid;
    if not exists (select 1 from public.solution_steps where id = event_step and problem_id = att.problem_id) then
      raise exception 'step_not_found' using errcode = 'P0001';
    end if;
    result := jsonb_build_object('stepId',event_step); event_type_name := 'step_opened';

  elsif kind = 'reveal_answer' then
    result := jsonb_build_object('problemId',att.problem_id); event_type_name := 'answer_revealed';

  elsif kind = 'submit_answer' then
    select coalesce(max(submission_number),0) + 1 into submission_sequence from public.answer_submissions where attempt_id = att.id;
    insert into public.answer_submissions(id,attempt_id,submission_number,raw_answer,normalized_answer,is_correct,evaluation_status,checker_version,occurred_at)
    values(command_uuid,att.id,submission_sequence,p_command->>'rawAnswer',p_command->>'normalizedAnswer',
      (p_command->>'isCorrect')::boolean,'completed',p_command->>'checkerVersion',occurred);
    result := jsonb_build_object('submissionId',command_uuid,'submissionNumber',submission_sequence,
      'isCorrect',(p_command->>'isCorrect')::boolean,'solved',exists(select 1 from public.problem_attempts where id = att.id and status = 'solved'));
    event_type_name := 'answer_submitted'; event_payload := jsonb_build_object('submission_id',command_uuid,'submission_number',submission_sequence);

  elsif kind = 'leave_attempt' then
    update public.problem_attempts set status = 'abandoned',finished_at = clock_timestamp() where id = att.id and status = 'in_progress';
    result := jsonb_build_object('attemptId',att.id); event_type_name := 'problem_left'; event_payload := coalesce(p_command->'payload','{}'::jsonb);

  elsif kind = 'new_chat' then
    update public.chat_threads set closed_at = clock_timestamp() where id = (p_command->>'threadId')::uuid and attempt_id = att.id and closed_at is null;
    event_type_name := 'chat_cleared'; result := jsonb_build_object('cleared',true);

  elsif kind = 'begin_chat' then
    perform pg_advisory_xact_lock(hashtextextended('mathmate:global-chat-budget',0));
    select count(*) into request_count from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
    join public.problem_attempts a on a.id = t.attempt_id join public.sessions s on s.id = a.session_id
    where s.user_id = p_user_id and m.role = 'assistant' and m.received_at > clock_timestamp() - interval '1 minute';
    if request_count >= (p_command->>'minuteLimit')::integer then raise exception 'chat_rate_limit' using errcode = 'P0001'; end if;
    select count(*) into request_count from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
    join public.problem_attempts a on a.id = t.attempt_id join public.sessions s on s.id = a.session_id
    where s.user_id = p_user_id and m.role = 'assistant' and m.received_at > clock_timestamp() - interval '24 hours';
    if request_count >= (p_command->>'dayLimit')::integer then raise exception 'chat_day_limit' using errcode = 'P0001'; end if;
    select count(*) into request_count from public.chat_messages where role = 'assistant' and received_at > clock_timestamp() - interval '24 hours';
    if request_count >= (p_command->>'globalLimit')::integer then raise exception 'chat_global_limit' using errcode = 'P0001'; end if;
    thread_uuid := (p_command->>'threadId')::uuid;
    insert into public.chat_threads(id,attempt_id) values(thread_uuid,att.id) on conflict do nothing;
    if not exists (select 1 from public.chat_threads where id = thread_uuid and attempt_id = att.id and closed_at is null) then
      raise exception 'thread_not_found' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.chat_messages where thread_id = thread_uuid and status = 'pending') then
      raise exception 'chat_pending' using errcode = 'P0001';
    end if;
    select coalesce(max(sequence_number),0) + 1 into message_sequence from public.chat_messages where thread_id = thread_uuid;
    response_uuid := (p_command->>'responseId')::uuid;
    insert into public.chat_messages(id,thread_id,sequence_number,role,content,occurred_at)
    values(command_uuid,thread_uuid,message_sequence,'user',p_command->>'content',occurred);
    insert into public.chat_messages(id,thread_id,in_reply_to_id,sequence_number,role,status,model,prompt_version,context,occurred_at)
    values(response_uuid,thread_uuid,command_uuid,message_sequence+1,'assistant','pending',p_command->>'model',p_command->>'promptVersion',
      coalesce(p_command->'context','{}'::jsonb),clock_timestamp());
    result := jsonb_build_object('threadId',thread_uuid,'userMessageId',command_uuid,'assistantMessageId',response_uuid);
    event_type_name := 'chat_message_sent'; event_payload := jsonb_build_object('thread_id',thread_uuid,'user_message_id',command_uuid,'assistant_message_id',response_uuid);

  elsif kind = 'finish_chat' then
    message_uuid := (p_command->>'messageId')::uuid;
    select m.* into msg from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
    where m.id = message_uuid and t.attempt_id = att.id for update of m;
    if not found or msg.role <> 'assistant' then raise exception 'message_not_found' using errcode = 'P0001'; end if;
    if msg.status = 'pending' then
      update public.chat_messages set status = p_command->>'status',content = p_command->>'content',
        error_code = p_command->>'errorCode',input_tokens = (p_command->>'inputTokens')::integer,
        output_tokens = (p_command->>'outputTokens')::integer,latency_ms = (p_command->>'latencyMs')::integer,
        provider_request_id = p_command->>'providerRequestId',model = coalesce(p_command->>'resolvedModel',model) where id = msg.id;
    end if;
    result := jsonb_build_object('messageId',msg.id);
    event_type_name := case when p_command->>'status' = 'completed' then 'chat_message_received' else 'chat_message_failed' end;
    event_payload := jsonb_build_object('message_id',msg.id,'error_code',p_command->>'errorCode');

  elsif kind = 'event_batch' then
    if jsonb_typeof(p_command->'events') <> 'array' or jsonb_array_length(p_command->'events') > 50 then
      raise exception 'invalid_event_batch' using errcode = 'P0001';
    end if;
    for event_item in select value from jsonb_array_elements(p_command->'events') loop
      if event_item->>'type' not in ('page_view','level_selected','problem_selected','chat_opened','chat_closed',
        'theme_changed','activity_heartbeat','page_hidden','page_visible','answer_input_changed','difficulty_rated','helpfulness_rated','step_closed') then
        raise exception 'invalid_event_type' using errcode = 'P0001';
      end if;
      event_attempt := nullif(event_item->>'attemptId','')::uuid;
      if exists(select 1 from public.events where id = (event_item->>'id')::uuid and session_id <> session_uuid) then
        raise exception 'request_conflict' using errcode = 'P0001';
      end if;
      perform public.mathmate_emit(session_uuid,event_attempt,(event_item->>'id')::uuid,event_item->>'type',
        (event_item->>'occurredAt')::timestamptz,coalesce(event_item->'payload','{}'::jsonb),nullif(event_item->>'stepId','')::uuid,
        least(greatest(0,coalesce((event_item->>'activeMs')::integer,0)),60000));
    end loop;
    return jsonb_build_object('accepted',jsonb_array_length(p_command->'events'));
  else raise exception 'invalid_command' using errcode = 'P0001';
  end if;

  if command_uuid is null then raise exception 'request_id_required' using errcode = 'P0001'; end if;
  perform public.mathmate_emit(session_uuid,attempt_uuid,command_uuid,event_type_name,occurred,
    event_payload || jsonb_build_object('_result',result,'_request_fingerprint',request_fingerprint),event_step);
  return result || jsonb_build_object('replayed',false);
end;
$$;

create function public.mathmate_close_idle_sessions()
returns integer language plpgsql set search_path = '' as $$
declare ses public.sessions; affected integer := 0;
begin
  for ses in select * from public.sessions where ended_at is null and last_activity_at < clock_timestamp() - interval '30 minutes'
             order by id for update skip locked loop
    update public.sessions set ended_at = last_activity_at,end_reason = 'inactivity' where id = ses.id;
    update public.problem_attempts set status = 'abandoned',finished_at = greatest(started_at,ses.last_activity_at)
    where session_id = ses.id and status = 'in_progress';
    perform public.mathmate_emit(ses.id,null,gen_random_uuid(),'session_ended',clock_timestamp(),jsonb_build_object('reason','inactivity'));
    affected := affected + 1;
  end loop;
  update public.chat_messages set status = 'failed',error_code = 'request_interrupted'
  where status = 'pending' and received_at < clock_timestamp() - interval '2 minutes';
  return affected;
end;
$$;

create function public.mathmate_level_counts()
returns table(level_code text, count bigint) language sql stable set search_path = '' as $$
  select level_code,count(*) from public.problems where is_active group by level_code;
$$;

revoke all on function public.mathmate_emit(uuid,uuid,uuid,text,timestamptz,jsonb,uuid,integer) from public,anon,authenticated;
revoke all on function public.mathmate_command(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.mathmate_close_idle_sessions() from public,anon,authenticated;
revoke all on function public.mathmate_level_counts() from public,anon,authenticated;
grant execute on function public.mathmate_emit(uuid,uuid,uuid,text,timestamptz,jsonb,uuid,integer) to service_role;
grant execute on function public.mathmate_command(uuid,jsonb) to service_role;
grant execute on function public.mathmate_close_idle_sessions() to service_role;
grant execute on function public.mathmate_level_counts() to service_role;
commit;
