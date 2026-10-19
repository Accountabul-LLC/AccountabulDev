-- Property Intelligence question-and-answer audit trail, ported from
-- property-intelligence-app's D1 tables analysis_messages,
-- analysis_question_runs and analysis_question_events behind
-- app/lib/analysis-repository.ts.
--
-- The product promise for Property Analysis is that every answer is traceable:
-- which intent was detected, which handler took it, whether the handler could
-- answer at all, which sources were missing, whether validation passed, and
-- whether the question was even eligible for model research. That is only
-- worth anything if the trail cannot be rewritten after the fact, so all three
-- tables are APPEND-ONLY: owner SELECT, service-role INSERT, and no UPDATE or
-- DELETE policy for anyone. A correction is a new question run, never an edit
-- to a recorded one.
--
-- Writes go through the service role for the same reason the intake and
-- warning tables do (20260924200000): the routing decision is computed
-- server-side from the dossier, and a client that could insert its own run row
-- could claim an answer the router never produced.

create table public.property_analysis_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.property_analysis_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  message_type text not null default 'chat' check (length(message_type) between 1 and 40),
  content text not null check (length(content) between 1 and 20000),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now()
);
create index property_analysis_messages_thread_idx
  on public.property_analysis_messages (thread_id, created_at);

create table public.property_analysis_question_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.property_analysis_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_message_id uuid not null
    references public.property_analysis_messages(id) on delete cascade,
  answer_message_id uuid not null
    references public.property_analysis_messages(id) on delete cascade,
  raw_question text not null check (length(raw_question) between 1 and 1000),
  normalized_question text not null,
  detected_intent text not null,
  handler_id text not null,
  handler_can_answer boolean not null,
  route text not null,
  outcome_status text not null,
  missing_source_count integer not null default 0 check (missing_source_count >= 0),
  missing_sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(missing_sources) = 'array'),
  model_research_eligible boolean not null,
  validation_passed boolean not null,
  trace_version integer not null default 1 check (trace_version > 0),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (completed_at >= started_at)
);
create index property_analysis_question_runs_owner_idx
  on public.property_analysis_question_runs (user_id, completed_at desc);
create index property_analysis_question_runs_thread_idx
  on public.property_analysis_question_runs (thread_id, completed_at desc);

create table public.property_analysis_question_events (
  id uuid primary key default gen_random_uuid(),
  question_run_id uuid not null
    references public.property_analysis_question_runs(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  stage text not null,
  decision text not null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  unique (question_run_id, sequence)
);

-- Append-only: SELECT for the owner, INSERT for the service role, and no
-- UPDATE or DELETE policy on any of the three.
revoke all on public.property_analysis_messages from public, anon, authenticated;
grant select on public.property_analysis_messages to authenticated;
grant select, insert on public.property_analysis_messages to service_role;
alter table public.property_analysis_messages enable row level security;
create policy property_analysis_messages_owner_read
  on public.property_analysis_messages for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.property_analysis_question_runs from public, anon, authenticated;
grant select on public.property_analysis_question_runs to authenticated;
grant select, insert on public.property_analysis_question_runs to service_role;
alter table public.property_analysis_question_runs enable row level security;
create policy property_analysis_question_runs_owner_read
  on public.property_analysis_question_runs for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.property_analysis_question_events from public, anon, authenticated;
grant select on public.property_analysis_question_events to authenticated;
grant select, insert on public.property_analysis_question_events to service_role;
alter table public.property_analysis_question_events enable row level security;
create policy property_analysis_question_events_owner_read
  on public.property_analysis_question_events for select to authenticated
  using (
    exists (
      select 1 from public.property_analysis_question_runs run
      where run.id = question_run_id and run.user_id = (select auth.uid())
    )
  );
