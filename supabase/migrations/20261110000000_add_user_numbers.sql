-- A public support reference, separate from the private UUID/cookie binding.
begin;
lock table public.app_users in access exclusive mode;

do $$
begin
  if (select count(*) from public.app_users) > 8990 then
    raise exception 'Four-digit user numbers 1010-9999 cannot cover all existing profiles.';
  end if;
end;
$$;

alter table public.app_users add column user_number integer;
-- Deterministic backfill: oldest profiles get the first numbers. UUIDs and FKs stay intact.
with numbered as (
  select id, (1009 + row_number() over (order by created_at,id))::integer as number
  from public.app_users
)
update public.app_users u set user_number = n.number from numbered n where n.id = u.id;

alter table public.app_users alter column user_number set not null;
alter table public.app_users alter column user_number add generated always as identity
  (start with 1010 increment by 1 minvalue 1010 maxvalue 9999 no cycle cache 1);
alter table public.app_users add constraint app_users_user_number_unique unique(user_number);
alter table public.app_users add constraint app_users_user_number_range check(user_number between 1010 and 9999);

do $$
declare seq regclass := pg_get_serial_sequence('public.app_users','user_number')::regclass;
  highest integer;
begin
  select max(user_number) into highest from public.app_users;
  perform setval(seq,coalesce(highest,1010),highest is not null);
  execute format('revoke all on sequence %s from public,anon,authenticated',seq);
  execute format('grant usage,select on sequence %s to service_role',seq);
end;
$$;

create function public.mathmate_preserve_user_number()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_number is distinct from old.user_number then
    raise exception 'A user number cannot be changed or reused.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger preserve_user_number before update on public.app_users
for each row execute function public.mathmate_preserve_user_number();
revoke all on function public.mathmate_preserve_user_number() from public,anon,authenticated;
grant execute on function public.mathmate_preserve_user_number() to service_role;

-- Append the reference to the existing admin view, retaining all existing column positions.
create or replace view public.user_stats with (security_invoker = true) as
select u.id as user_id, u.created_at, u.last_seen_at,
       count(s.session_id) as session_count,
       coalesce(sum(s.active_ms),0) as active_ms,
       coalesce(sum(s.attempt_count),0) as attempt_count,
       coalesce(sum(s.solved_attempt_count),0) as solved_attempt_count,
       coalesce(sum(s.submission_count),0) as submission_count,
       u.user_number
from public.app_users u left join public.session_stats s on s.user_id = u.id
group by u.id;

comment on column public.app_users.user_number is 'Unique support reference 1010-9999, automatically assigned and never recycled after deletion. Not an authentication credential.';
notify pgrst,'reload schema';
commit;
