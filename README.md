# MathMate

Norwegian mathematics practice with the prototype's interface, a Supabase question bank, server-checked answers, step-by-step guidance and an OpenAI tutor. The main application is a Next.js App Router application suitable for Vercel. The original local prototype remains in `prototype/` as a separate reference.

## Run locally

Use Node.js **22 LTS or 24 LTS**, with npm. Run from the repository root:

```powershell
npm install
npm run dev
```

Open **http://localhost:3000**. For a production build:

```powershell
npm run build
npm start
```

The application uses Supabase during local development too. There is no silent local/mock database fallback.

## Environment variables

Copy `.env.example` to `.env` on a new machine. Preserve existing configured values on this machine.

| Variable                       | Purpose                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `SUPABASE_URL`                 | Project URL for the intended Supabase database                             |
| `SUPABASE_SECRET_KEY`          | Server secret key for that same project                                    |
| `OPENAI_API_KEY`               | Required for AI chat; practice works without it                            |
| `OPENAI_MODEL`                 | Optional; defaults to the original project's `gpt-4o`                      |
| `BROWSER_ID_SECRET`            | Independent random secret for signing the anonymous browser-binding cookie |
| `CRON_SECRET`                  | Random secret protecting scheduled session cleanup                         |
| `CHAT_REQUESTS_PER_MINUTE`     | Per-browser AI request limit; default 8                                    |
| `CHAT_REQUESTS_PER_DAY`        | Per-browser rolling 24-hour AI limit; default 100                          |
| `CHAT_GLOBAL_REQUESTS_PER_DAY` | Global rolling 24-hour AI spending guard; default 1000 requests            |
| `APP_VERSION`                  | Optional analytics release label; otherwise Vercel commit SHA or `1.0.0`   |

`BROWSER_ID_SECRET` and `CRON_SECRET` were generated locally during this rewrite if missing. Their values are only in the ignored `.env`, not in Git. Use long random values when setting up another environment. If `BROWSER_ID_SECRET` is omitted, the browser signature uses a purpose-specific HMAC with the server Supabase key; a separate stable secret is preferred. Rotating the browser-signing secret invalidates old cookies.

Do not prefix server keys with `NEXT_PUBLIC_`. No Supabase key or OpenAI key is needed in browser code. `DATABASE_URL`, OAuth credentials and `AUTH_SECRET` from the previous application are no longer used. They have not been deleted from your private `.env`.

## Supabase setup and the question bank

The complete schema and deployment instructions are in [supabase/README.md](supabase/README.md).

For a new project:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
npm run db:check
npm run db:import -- --dry-run
npm run db:import
```

All four migrations have been applied and all **1,550 questions** have been imported into the configured project during this rewrite. On this machine, use `npm run db:check` to inspect connectivity instead of repeating setup.

The import reads the root `Matematikk_tekstoppgaver_1550.xlsx`, validates every row before writing, and imports all 14 school levels/subjects. You can choose a different workbook with `npm run db:import -- --file path/to/file.xlsx`.

Importing again skips unchanged questions. A changed question, answer, validation rule or solution-step definition creates a new immutable version and deactivates the previous version in one database transaction. Old attempts continue to reference the version actually shown to the learner. Import batches are atomic and repeatable. Import is a deliberate administration command, never part of a Vercel build or normal page request.

The imported solution steps use the same method as the prototype: a reading strategy followed by parts of the workbook's own solution. AI is not used to generate or rewrite the 1,550 source solutions. Some source calculations already include the numeric answer before the explicit answer reveal.

## Application architecture

```text
app/
  components/                 Norwegian React UI matching the prototype
  hooks/use-mathmate.ts       Practice workflow and active-time measurement
  services/browser-api.ts    HTTP client and durable IndexedDB delivery queue
  api/[...path]/route.ts      Request handling and anonymous browser binding
  api/cron/close-sessions/    Protected scheduled cleanup
src/
  entities/                  Domain models and pure answer evaluation
  application/
    repositories/            Persistence interface
    services/                Tutor interface and versioned tutoring policy
    use-cases/               Practice, answers, steps, chat and session workflows
  interface-adapters/         Controllers and strict input validation
  infrastructure/
    repositories/            Supabase implementation
    services/                OpenAI implementation
    datasets/                Read-only Excel importer
di/container.ts              Stateless dependency composition
lib/                         Server-only configuration, database and cookie signing
supabase/migrations/         Authoritative schema, atomic commands and import functions
scripts/db/                  Connectivity, import and opt-in real integration checks
tests/unit/                  Focused domain/controller/use-case tests
```

The dependency direction follows the earlier application's layered design: controllers call use cases, use cases depend on repository/service interfaces, and infrastructure implements those interfaces. The composition root wires them together. There is no Prisma or Supabase Auth dependency in the application runtime. The old `prisma/` directory is historical; do not run its migrations against this new model.

## Identity and logging

There is no account creation or login. A random browser UUID is saved in `localStorage`; the current tab's session and attempt identifiers use `sessionStorage`. A signed HttpOnly cookie binds requests to that browser profile, so knowing a public UUID alone does not let someone access another profile's attempts or chat. If local data and the binding cookie are lost, a new profile is created. A shared browser profile can still represent more than one person.

The server is the only application component that accesses Supabase. The tables and RPCs are closed to `anon` and `authenticated`; the server key uses `service_role`. Every private operation verifies the browser's ownership of the session/attempt/thread.

Implemented records include:

- Session start, last activity, idle renewal and closure, app version, active time and elapsed time.
- Level selection, question visits, attempts, navigation and abandoned attempts.
- Each submitted answer exactly as received, normalized answer, correctness, checker version and evaluation timestamps. The browser cannot choose correctness.
- Work-mode choices, each opened solution step, step visibility time when hidden, and answer reveals.
- Each user chat message and pending/completed/failed assistant response, including prompt/model version, provider request ID, latency and token usage.
- Chat panel open/close, new conversation, page visibility, theme changes and answer-field interaction counts. Raw keystrokes are not recorded.

Question answers and hidden solution content are not included in the initial public question list. A reveal is recorded before its content is returned. A submitted answer and its analytics event are committed together. Chat requests and a pending response are committed before calling OpenAI; completed output is stored before it is returned to the browser. Repeated request IDs return stored results and do not generate another paid AI response.

Activity pulses normally run every 15 seconds. Active time is estimated from a visible, focused page and recent interaction (60-second idle threshold); it is not a recording of human attention. Client intervals are bounded and deduplicated on the server. Overlapping visible-step durations must not be added together as session time. A new session is created after a 30-minute interaction gap when the user returns, preserving the current question/input and recording newly displayed assistance in the new attempt.

Pending actions are stored in IndexedDB until delivery is acknowledged. Retries reuse IDs; the database checks that the same ID has the same semantic request. Page-hide delivery uses `sendBeacon` where available and retains queued events until an acknowledged retry. The UI shows when delivery is pending or failing. If durable browser storage is unavailable, the app warns and retains the current page's queue in memory. Browser deletion, prolonged unavailability or a forcibly terminated request can still prevent final delivery; the application does not claim lossless logging in those cases.

No conversation history or user state relies on a long-running server process. Supabase holds persistent state across Vercel function instances. OpenAI calls use `store: false`; OpenAI's own data-handling policies still apply. The app's `/om-lagring` page explains the actual collection to learners. Automatic deletion of server logs is disabled until a retention policy is chosen.

## Statistics

The server/admin can query these database views:

- `attempt_stats`: answer counts, first-answer correctness, time to first correct answer, active time, used steps/chat/revealed answer and assisted/unassisted classification.
- `session_stats`: attempted and solved attempts, distinct logical questions solved, submissions and active/elapsed time.
- `user_stats`: activity totals across a browser profile's sessions.
- `problem_stats`: question/version usage, solve counts and average time to a correct answer.

`solved_unassisted` means no recorded step, answer reveal or completed AI response before the first correct evaluation. It cannot prove that no external help was used. Server receipt timestamps are used for this classification; client timestamps are preserved separately for analysis.

## Deploy to Vercel

1. Push the application to your Git repository and import it into Vercel.
2. Use **Root Directory `.`**, **Framework Next.js**, a supported **Node.js 22 or 24** runtime, and the default Next.js output settings. Do not select the `prototype` folder.
3. Set the server environment variables from the table above in the appropriate Vercel environment. In particular, copy the local `BROWSER_ID_SECRET` and `CRON_SECRET` values securely into Vercel; Git does not contain them.
4. Deploy with the standard `npm run build`. `npm start` is for local production verification, not a custom Vercel server command.

`vercel.json` configures a daily protected cleanup call to `/api/cron/close-sessions`. `CRON_SECRET` must be configured for the call to be accepted. The job closes stale sessions at their last recorded activity and marks interrupted pending AI responses as failed. It does not delete learning logs. Stale sessions are also handled when the browser resumes. The API routes declare a 60-second maximum duration and use Node.js runtime.

Use a separate Supabase project for Vercel Preview deployments if preview/testing traffic should not appear in production research data. Database migrations and question import are separate from application deployments. The optional GitHub Supabase deployment workflow remains available; see the Supabase guide for activation.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The focused tests cover server-side answers, invalid client correctness claims, browser identity, session renewal, pending chat logging, provider failures and replay protection. GitHub's application checks run lint, tests and build.

For local PostgreSQL constraint/RLS/atomic-command checks:

```powershell
./supabase/checks/test-schema.ps1
```

For an opt-in integration check against the running local app, real Supabase, and one real OpenAI response:

```powershell
npm start
# In another terminal:
npm run db:smoke
```

`db:smoke` creates fresh test browser profiles, exercises the API, verifies raw logs/statistics, and deletes only its own generated profiles afterward. The AI call uses the configured API quota. Add `-- --skip-ai` to skip generation, or `-- --keep-data` to retain those test profiles for inspection.

## Reference documentation

[Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase server keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations), [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
