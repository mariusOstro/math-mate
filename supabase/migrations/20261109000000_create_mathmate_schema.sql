-- MathMate: backend-only data model. Requires Supabase's standard database roles.
-- This migration deliberately does not modify the legacy Prisma tables.
begin;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint app_users_time_order check (last_seen_at >= created_at)
);
comment on table public.app_users is 'Pseudonymous browser profiles, not authenticated people. The id may be kept in localStorage.';

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('explicit', 'inactivity', 'navigation', 'shutdown')),
  app_version text not null,
  constraint sessions_time_order check (
    last_activity_at >= started_at and (ended_at is null or ended_at >= last_activity_at)
  ),
  constraint sessions_end_pair check ((ended_at is null) = (end_reason is null)),
  constraint sessions_app_version check (length(btrim(app_version)) between 1 and 100)
);
create index sessions_user_started_idx on public.sessions(user_id, started_at desc);
create index sessions_open_activity_idx on public.sessions(last_activity_at) where ended_at is null;

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  source_id text not null check (length(btrim(source_id)) between 1 and 100),
  version integer not null default 1 check (version > 0),
  question text not null check (length(btrim(question)) > 0),
  level_code text not null check (level_code in ('4','5','6','7','8','9','10','1P','2P','1T','R1','R2','S1','S2')),
  difficulty smallint not null check (difficulty > 0),
  category text not null check (length(btrim(category)) > 0),
  answer_value text not null check (length(btrim(answer_value)) > 0),
  answer_unit text not null default '',
  solution text not null check (length(btrim(solution)) > 0),
  validation_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_rules) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source_id, version)
);
create unique index problems_one_active_version_idx on public.problems(source_id) where is_active;
create index problems_active_level_idx on public.problems(level_code, category, difficulty) where is_active;
comment on column public.problems.answer_value is 'Original fasit_verdi from Excel, stored as text to preserve numeric and symbolic answers.';
comment on column public.problems.validation_rules is 'Server-side checker configuration, e.g. answer_type, decimal_places, absolute_tolerance, accepted_answers.';

create table public.solution_steps (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  title text not null,
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now(),
  unique (problem_id, step_number),
  unique (id, problem_id)
);

create table public.problem_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete restrict,
  initial_mode text not null default 'undecided' check (initial_mode in ('undecided', 'self', 'guided')),
  status text not null default 'in_progress' check (status in ('in_progress', 'solved', 'abandoned')),
  started_at timestamptz not null default now(),
  first_correct_at timestamptz,
  finished_at timestamptz,
  unique (id, session_id),
  unique (id, problem_id),
  constraint problem_attempts_time_order check (
    (first_correct_at is null or first_correct_at >= started_at)
    and (finished_at is null or finished_at >= started_at)
    and (first_correct_at is null or finished_at >= first_correct_at)
  ),
  constraint problem_attempts_solved_state check (
    (status = 'solved' and first_correct_at is not null and finished_at is not null)
    or (status = 'in_progress' and first_correct_at is null and finished_at is null)
    or (status = 'abandoned' and first_correct_at is null and finished_at is not null)
  )
);
create index problem_attempts_session_idx on public.problem_attempts(session_id, started_at);
create index problem_attempts_problem_idx on public.problem_attempts(problem_id, started_at desc);

create table public.answer_submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.problem_attempts(id) on delete cascade,
  submission_number integer not null check (submission_number > 0),
  raw_answer text not null check (length(raw_answer) between 1 and 10000),
  normalized_answer text,
  is_correct boolean,
  evaluation_status text not null default 'pending' check (evaluation_status in ('pending', 'completed', 'error')),
  checker_version text not null,
  error_code text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  evaluated_at timestamptz,
  unique (attempt_id, submission_number),
  constraint answer_submissions_evaluation_state check (
    (evaluation_status = 'completed' and is_correct is not null and evaluated_at is not null and error_code is null)
    or (evaluation_status = 'pending' and is_correct is null and evaluated_at is null and error_code is null)
    or (evaluation_status = 'error' and is_correct is null and evaluated_at is null and error_code is not null)
  )
);
create index answer_submissions_received_idx on public.answer_submissions(received_at desc);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.problem_attempts(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (closed_at is null or closed_at >= created_at)
);
create index chat_threads_attempt_idx on public.chat_threads(attempt_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  in_reply_to_id uuid,
  sequence_number integer not null check (sequence_number > 0),
  role text not null check (role in ('user', 'assistant')),
  content text check (length(content) <= 32000),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  model text,
  prompt_version text,
  provider_request_id text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  error_code text,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (thread_id, sequence_number),
  unique (id, thread_id),
  foreign key (in_reply_to_id, thread_id) references public.chat_messages(id, thread_id),
  constraint chat_messages_role_state check (
    (role = 'user' and in_reply_to_id is null and status = 'completed')
    or (role = 'assistant' and in_reply_to_id is not null and model is not null and prompt_version is not null)
  ),
  constraint chat_messages_delivery_state check (
    (status = 'completed' and content is not null and length(btrim(content)) > 0 and completed_at is not null and error_code is null)
    or (status = 'pending' and completed_at is null and error_code is null)
    or (status = 'failed' and completed_at is not null and error_code is not null)
  ),
  check (completed_at is null or completed_at >= received_at)
);
create index chat_messages_reply_idx on public.chat_messages(in_reply_to_id) where in_reply_to_id is not null;
create index chat_messages_received_idx on public.chat_messages(received_at desc);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  attempt_id uuid,
  problem_id uuid references public.problems(id) on delete restrict,
  step_id uuid,
  sequence_number bigint not null check (sequence_number > 0),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  schema_version smallint not null default 1 check (schema_version > 0),
  active_ms integer not null default 0 check (active_ms between 0 and 60000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  unique (session_id, sequence_number),
  foreign key (attempt_id, session_id) references public.problem_attempts(id, session_id) on delete cascade,
  foreign key (attempt_id, problem_id) references public.problem_attempts(id, problem_id) on delete cascade,
  foreign key (step_id, problem_id) references public.solution_steps(id, problem_id),
  constraint events_attempt_context check (attempt_id is null or problem_id is not null),
  constraint events_step_context check (step_id is null or (attempt_id is not null and problem_id is not null)),
  constraint events_step_required check (event_type not in ('step_opened', 'step_closed') or step_id is not null),
  constraint events_active_heartbeat check (event_type = 'activity_heartbeat' or active_ms = 0)
);
create index events_session_time_idx on public.events(session_id, occurred_at, sequence_number);
create index events_attempt_time_idx on public.events(attempt_id, received_at) where attempt_id is not null;
create index events_step_idx on public.events(step_id) where step_id is not null;
create index events_problem_idx on public.events(problem_id) where problem_id is not null;
create index events_type_received_idx on public.events(event_type, received_at desc);
comment on column public.events.active_ms is 'Non-overlapping, server-validated active interval since the previous heartbeat, at most 60 seconds. Not elapsed wall-clock time.';
comment on column public.events.received_at is 'Trusted server receipt timestamp. occurred_at is an untrusted client-clock timestamp.';

-- Preserve the problem definition used by historical attempts.
create function public.mathmate_preserve_problem_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.source_id, new.version, new.question, new.level_code, new.difficulty,
         new.category, new.answer_value, new.answer_unit, new.solution, new.validation_rules)
     is distinct from
     row(old.source_id, old.version, old.question, old.level_code, old.difficulty,
         old.category, old.answer_value, old.answer_unit, old.solution, old.validation_rules) then
    raise exception 'Create a new problem version instead of changing existing content.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger preserve_problem_version before update on public.problems
for each row execute function public.mathmate_preserve_problem_version();

create function public.mathmate_preserve_used_steps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' and exists (select 1 from public.problem_attempts where problem_id = old.problem_id))
     or (tg_op <> 'DELETE' and exists (select 1 from public.problem_attempts where problem_id = new.problem_id)) then
    raise exception 'Steps already used by an attempt are immutable; create a new problem version.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger preserve_used_steps before insert or update or delete on public.solution_steps
for each row execute function public.mathmate_preserve_used_steps();

-- Only the backend evaluates answers. This trigger timestamps evaluation, not correctness.
create function public.mathmate_prepare_submission()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.evaluation_status = 'completed' then
      raise exception 'Completed submissions are immutable.' using errcode = '23514';
    end if;
    if row(new.id, new.attempt_id, new.submission_number, new.raw_answer, new.occurred_at, new.received_at)
       is distinct from row(old.id, old.attempt_id, old.submission_number, old.raw_answer, old.occurred_at, old.received_at) then
      raise exception 'Submission identity and original answer are immutable.' using errcode = '23514';
    end if;
  end if;
  if new.evaluation_status = 'completed' then new.evaluated_at := clock_timestamp(); end if;
  return new;
end;
$$;
create trigger prepare_submission before insert or update on public.answer_submissions
for each row execute function public.mathmate_prepare_submission();

create function public.mathmate_record_correct_answer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.evaluation_status = 'completed' and new.is_correct then
    update public.problem_attempts
    set first_correct_at = least(coalesce(first_correct_at, new.evaluated_at), new.evaluated_at),
        finished_at = least(coalesce(first_correct_at, new.evaluated_at), new.evaluated_at),
        status = 'solved'
    where id = new.attempt_id;
  end if;
  return new;
end;
$$;
create trigger record_correct_answer after insert or update on public.answer_submissions
for each row execute function public.mathmate_record_correct_answer();

create function public.mathmate_prepare_chat_message()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role = 'assistant' and not exists (
    select 1 from public.chat_messages
    where id = new.in_reply_to_id and thread_id = new.thread_id and role = 'user'
  ) then
    raise exception 'An assistant reply must reference a user message in the same thread.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'pending' then
      raise exception 'Finished chat messages are immutable; insert a new reply to retry.' using errcode = '23514';
    end if;
    if row(new.id, new.thread_id, new.in_reply_to_id, new.sequence_number, new.role, new.occurred_at, new.received_at)
       is distinct from row(old.id, old.thread_id, old.in_reply_to_id, old.sequence_number, old.role, old.occurred_at, old.received_at) then
      raise exception 'Chat message identity is immutable.' using errcode = '23514';
    end if;
  end if;
  if new.status <> 'pending' then new.completed_at := clock_timestamp(); end if;
  return new;
end;
$$;
create trigger prepare_chat_message before insert or update on public.chat_messages
for each row execute function public.mathmate_prepare_chat_message();

-- Refresh the server-side activity watermark for accepted user activity.
-- AI completion alone and zero-active-time heartbeats do not extend the user's session.
create function public.mathmate_touch_activity()
returns trigger language plpgsql set search_path = '' as $$
declare session_uuid uuid;
begin
  if tg_table_name = 'events' then
    if new.event_type = 'activity_heartbeat' and new.active_ms = 0 then return new; end if;
    session_uuid := new.session_id;
  elsif tg_table_name = 'problem_attempts' then
    session_uuid := new.session_id;
  elsif tg_table_name = 'answer_submissions' then
    select session_id into session_uuid from public.problem_attempts where id = new.attempt_id;
  elsif tg_table_name = 'chat_messages' then
    if new.role <> 'user' then return new; end if;
    select a.session_id into session_uuid
    from public.chat_threads t join public.problem_attempts a on a.id = t.attempt_id
    where t.id = new.thread_id;
  end if;
  update public.sessions set last_activity_at = greatest(last_activity_at, clock_timestamp())
  where id = session_uuid and ended_at is null;
  update public.app_users set last_seen_at = greatest(last_seen_at, clock_timestamp())
  where id = (select user_id from public.sessions where id = session_uuid);
  return new;
end;
$$;
create trigger touch_attempt_activity after insert on public.problem_attempts
for each row execute function public.mathmate_touch_activity();
create trigger touch_event_activity after insert on public.events
for each row execute function public.mathmate_touch_activity();
create trigger touch_submission_activity after insert on public.answer_submissions
for each row execute function public.mathmate_touch_activity();
create trigger touch_chat_activity after insert on public.chat_messages
for each row execute function public.mathmate_touch_activity();

-- Pre-aggregate each relation separately to avoid multiplying rows and inflating counts.
create view public.attempt_stats with (security_invoker = true) as
select a.id as attempt_id, s.user_id, a.session_id, a.problem_id, p.source_id, p.version,
       p.level_code, a.status, a.started_at, a.finished_at, a.first_correct_at,
       greatest(0, extract(epoch from (coalesce(a.finished_at, s.last_activity_at) - a.started_at)) * 1000) as elapsed_ms,
       case when a.first_correct_at is not null
         then extract(epoch from (a.first_correct_at - a.started_at)) * 1000 end as time_to_correct_ms,
       coalesce(ans.submission_count, 0) as submission_count,
       coalesce(ans.correct_submission_count, 0) as correct_submission_count,
       coalesce(ans.first_submission_correct, false) as first_submission_correct,
       coalesce(ev.active_ms, 0) as active_ms,
       coalesce(ev.used_steps, false) as used_steps,
       coalesce(ev.answer_revealed, false) as answer_revealed,
       coalesce(cm.user_message_count, 0) as user_message_count,
       coalesce(cm.assistant_message_count, 0) as assistant_message_count,
       (a.first_correct_at is not null and not coalesce(ev.help_before_correct, false)
        and not coalesce(cm.chat_before_correct, false)) as solved_unassisted
from public.problem_attempts a
join public.sessions s on s.id = a.session_id
join public.problems p on p.id = a.problem_id
left join lateral (
  select count(*) as submission_count,
         count(*) filter (where evaluation_status = 'completed' and is_correct) as correct_submission_count,
         (array_agg(is_correct order by submission_number))[1] as first_submission_correct
  from public.answer_submissions where attempt_id = a.id
) ans on true
left join lateral (
  select sum(active_ms) as active_ms,
         bool_or(event_type = 'step_opened') as used_steps,
         bool_or(event_type = 'answer_revealed') as answer_revealed,
         bool_or(event_type in ('step_opened', 'answer_revealed') and received_at <= a.first_correct_at) as help_before_correct
  from public.events where attempt_id = a.id
) ev on true
left join lateral (
  select count(*) filter (where m.role = 'user') as user_message_count,
         count(*) filter (where m.role = 'assistant' and m.status = 'completed') as assistant_message_count,
         bool_or(m.role = 'assistant' and m.status = 'completed' and m.completed_at <= a.first_correct_at) as chat_before_correct
  from public.chat_threads t join public.chat_messages m on m.thread_id = t.id
  where t.attempt_id = a.id
) cm on true;

create view public.session_stats with (security_invoker = true) as
select s.id as session_id, s.user_id, s.started_at, s.last_activity_at, s.ended_at,
       extract(epoch from (coalesce(s.ended_at, s.last_activity_at) - s.started_at)) * 1000 as elapsed_ms,
       coalesce(ev.active_ms, 0) as active_ms,
       coalesce(a.attempt_count, 0) as attempt_count,
       coalesce(a.solved_attempt_count, 0) as solved_attempt_count,
       coalesce(a.distinct_problems_solved, 0) as distinct_problems_solved,
       coalesce(a.unassisted_solved_count, 0) as unassisted_solved_count,
       coalesce(a.submission_count, 0) as submission_count
from public.sessions s
left join lateral (
  select sum(active_ms) as active_ms from public.events where session_id = s.id
) ev on true
left join lateral (
  select count(*) as attempt_count,
         count(*) filter (where first_correct_at is not null) as solved_attempt_count,
         count(distinct source_id) filter (where first_correct_at is not null) as distinct_problems_solved,
         count(*) filter (where solved_unassisted) as unassisted_solved_count,
         sum(submission_count) as submission_count
  from public.attempt_stats where session_id = s.id
) a on true;

create view public.user_stats with (security_invoker = true) as
select u.id as user_id, u.created_at, u.last_seen_at,
       count(s.session_id) as session_count,
       coalesce(sum(s.active_ms), 0) as active_ms,
       coalesce(sum(s.attempt_count), 0) as attempt_count,
       coalesce(sum(s.solved_attempt_count), 0) as solved_attempt_count,
       coalesce(sum(s.submission_count), 0) as submission_count
from public.app_users u left join public.session_stats s on s.user_id = u.id
group by u.id;

create view public.problem_stats with (security_invoker = true) as
select p.id as problem_id, p.source_id, p.version, p.level_code, p.category,
       count(a.attempt_id) as attempt_count,
       count(distinct a.user_id) as browser_user_count,
       count(*) filter (where a.first_correct_at is not null) as solved_attempt_count,
       count(*) filter (where a.solved_unassisted) as unassisted_solved_count,
       avg(a.time_to_correct_ms) as average_time_to_correct_ms,
       coalesce(sum(a.submission_count), 0) as submission_count
from public.problems p left join public.attempt_stats a on a.problem_id = p.id
group by p.id;

-- No browser access, even though these tables live in the exposed public schema.
-- No policies are created: anon/authenticated cannot read or write these tables.
do $$
declare name text;
begin
  foreach name in array array['app_users','sessions','problems','solution_steps','problem_attempts',
                              'answer_submissions','chat_threads','chat_messages','events'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
  end loop;
end;
$$;
revoke update on public.events from service_role;
grant usage on schema public to service_role;

revoke all on public.attempt_stats, public.session_stats, public.user_stats, public.problem_stats
from public, anon, authenticated;
grant select on public.attempt_stats, public.session_stats, public.user_stats, public.problem_stats to service_role;

revoke all on function public.mathmate_preserve_problem_version() from public, anon, authenticated;
revoke all on function public.mathmate_preserve_used_steps() from public, anon, authenticated;
revoke all on function public.mathmate_prepare_submission() from public, anon, authenticated;
revoke all on function public.mathmate_record_correct_answer() from public, anon, authenticated;
revoke all on function public.mathmate_prepare_chat_message() from public, anon, authenticated;
revoke all on function public.mathmate_touch_activity() from public, anon, authenticated;

commit;
