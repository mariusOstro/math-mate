-- Read the browser profile's history across sessions and problem versions.
begin;
create function public.mathmate_unattempted_problems(
  p_user_id uuid, p_level text, p_offset integer default 0, p_limit integer default 150
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with catalog as materialized (
    select p.id,p.source_id,p.version,p.question,p.level_code,p.difficulty,p.category,p.answer_unit,
           row_number() over (order by p.source_id)::integer as position
    from public.problems p
    where p.is_active and p.level_code = p_level
  ), remaining as materialized (
    select p.* from catalog p
    where not exists (
      select 1 from public.sessions s
      join public.problem_attempts a on a.session_id = s.id
      join public.problems previous on previous.id = a.problem_id
      where s.user_id = p_user_id and previous.source_id = p.source_id
    )
  ), page as (
    select * from remaining order by position
    offset greatest(p_offset,0) limit least(greatest(p_limit,1),150)
  )
  select jsonb_build_object(
    'problems',coalesce((select jsonb_agg(to_jsonb(page) order by position) from page),'[]'::jsonb),
    'total',(select count(*) from remaining)
  );
$$;
revoke all on function public.mathmate_unattempted_problems(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.mathmate_unattempted_problems(uuid,text,integer,integer) to service_role;
comment on function public.mathmate_unattempted_problems(uuid,text,integer,integer) is
  'Backend-only personal queue. Opening an attempt excludes all versions of that source problem in later queues. Returns no answers or solutions.';
notify pgrst,'reload schema';
commit;
