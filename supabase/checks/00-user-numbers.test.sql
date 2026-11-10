\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare first_id uuid := gen_random_uuid(); second_id uuid := gen_random_uuid(); third_id uuid := gen_random_uuid();
  first_number integer; second_number integer; third_number integer;
begin
  if (select user_number from public.app_users where id = '00000000-0000-4000-8000-000000000001') <> 1010
     or (select user_number from public.app_users where id = '00000000-0000-4000-8000-000000000002') <> 1011
     or (select user_number from public.app_users where id = '00000000-0000-4000-8000-000000000003') <> 1012 then
    raise exception 'Existing profiles were not numbered chronologically from 1010';
  end if;
  if (select user_id from public.sessions where id = '00000000-0000-4000-8000-000000000010')
     <> '00000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Backfill changed an existing relationship';
  end if;
  insert into public.app_users(id) values(first_id) returning user_number into first_number;
  insert into public.app_users(id) values(second_id) returning user_number into second_number;
  if first_number <> 1013 or second_number <> 1014 then raise exception 'New numbers do not follow the backfilled profiles'; end if;
  update public.app_users set last_seen_at = clock_timestamp() where id = second_id;
  if (select user_number from public.app_users where id = second_id) <> second_number then raise exception 'Activity changed the support number'; end if;
  delete from public.app_users where id = first_id;
  insert into public.app_users(id) values(third_id) returning user_number into third_number;
  if third_number <> 1015 then raise exception 'A deleted support number was reused'; end if;
  if (select user_number from public.user_stats where user_id = third_id) <> third_number then raise exception 'Statistics do not show the support number'; end if;
  begin
    update public.app_users set user_number = 5000 where id = second_id;
    raise exception 'An assigned support number was changed';
  exception when sqlstate '428C9' then null; end;
  begin
    update public.app_users set user_number = default where id = second_id;
    raise exception 'An assigned support number was regenerated';
  exception when check_violation then null; end;
  begin
    insert into public.app_users(id,user_number) values(gen_random_uuid(),5001);
    raise exception 'A caller chose a support number';
  exception when sqlstate '428C9' then null; end;
end;
$$;
reset role;
-- Sequence state is not transactional. Restore it explicitly after this boundary check.
do $$
declare seq regclass := pg_get_serial_sequence('public.app_users','user_number')::regclass;
  saved_value bigint; saved_called boolean;
begin
  execute format('select last_value,is_called from %s',seq) into saved_value,saved_called;
  perform setval(seq,9999,true);
  begin
    insert into public.app_users(id) values(gen_random_uuid());
    raise exception 'The four-digit range overflowed or cycled';
  exception when sqlstate '2200H' then null; end;
  perform setval(seq,saved_value,saved_called);
  if has_sequence_privilege('anon',seq,'USAGE') or has_sequence_privilege('authenticated',seq,'USAGE') then
    raise exception 'Browser roles can allocate support numbers';
  end if;
end;
$$;
rollback;
\echo 'PASS: chronological backfill, sequential user numbers, immutable references, deletion, private sequence and four-digit limit'
