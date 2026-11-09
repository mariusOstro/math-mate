begin;
create function public.mathmate_end_session(p_user_id uuid,p_session_id uuid)
returns void language plpgsql set search_path = '' as $$
declare ses public.sessions;
begin
  select * into ses from public.sessions where id = p_session_id and user_id = p_user_id for update;
  if not found then raise exception 'session_not_found' using errcode = 'P0001'; end if;
  if ses.ended_at is not null then return; end if;
  update public.sessions set ended_at = last_activity_at,end_reason = 'inactivity' where id = ses.id;
  update public.problem_attempts set status = 'abandoned',finished_at = greatest(started_at,ses.last_activity_at)
  where session_id = ses.id and status = 'in_progress';
  perform public.mathmate_emit(ses.id,null,gen_random_uuid(),'session_ended',clock_timestamp(),jsonb_build_object('reason','inactivity'));
end;
$$;
revoke all on function public.mathmate_end_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mathmate_end_session(uuid,uuid) to service_role;
commit;
