-- Disposable fixtures inserted just before the support-number migration.
-- Physical insertion order differs from chronological order on purpose.
insert into public.app_users(id,created_at) values
 ('00000000-0000-4000-8000-000000000003',now() - interval '1 day'),
 ('00000000-0000-4000-8000-000000000001',now() - interval '3 days'),
 ('00000000-0000-4000-8000-000000000002',now() - interval '2 days');
insert into public.sessions(id,user_id,app_version) values
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','user-number-migration-check');
