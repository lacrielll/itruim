# Itruim — setup and deployment

## Purpose

`quiz-platform` is the cloud control plane of the learning platform. A single
Cloudflare Worker serves the React UI and Hono API. D1 stores identities,
courses, quizzes, assignments, grading jobs and results. Medal and achievement
images are stored in a private Backblaze B2 bucket.

Student code is **never executed here**. Coding submissions are processed by a
separate `grader-worker` on a trusted machine. The engine may be public;
production grader packs and hidden tests remain separate and private.

The first sample assignment is available at
[AKlimovUrfu/lab1](https://github.com/AKlimovUrfu/lab1).
Add the grader repository URL here after publishing it:
`<GRADER_WORKER_REPOSITORY_URL>`.

## Requirements

- Node.js 22.12+ and npm;
- a Cloudflare account with Workers and D1;
- a private Backblaze B2 bucket and a restricted Application Key;
- Wrangler authentication: `npx wrangler login`.

## Local development

```bash
git clone <QUIZ_PLATFORM_REPOSITORY_URL>
cd quiz-engine
npm ci
cp .dev.vars.example .dev.vars
npm run admin:hash
```

Put the generated hash into `ADMIN_PASSWORD_HASH` and generate independent
secrets:

```bash
openssl rand -base64 48 # CSRF_SECRET
openssl rand -base64 48 # RATE_LIMIT_PEPPER
```

Complete `.dev.vars`, then run:

```bash
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173`. Local D1 state is stored under `.wrangler/`.
For local directory/ZIP submissions, run `grader-worker serve-uploads` as well.
`LOCAL_DEV_UPLOADS=true` must never be enabled in production.

## Verification

```bash
npm run check
```

This builds the TypeScript/Worker application, runs tests and audits the client
bundle. Before a release, also smoke-test admin login, student registration, a
quiz attempt, CSV export, media upload and one complete grader workflow.

## Cloudflare and B2

Create D1:

```bash
npx wrangler d1 create quiz-db
```

Put the returned `database_id` into `wrangler.jsonc`. Create a private B2 bucket
and an Application Key restricted to `read/write/delete` on that bucket only.

Set production secrets:

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put CSRF_SECRET
npx wrangler secret put RATE_LIMIT_PEPPER
npx wrangler secret put B2_ENDPOINT
npx wrangler secret put B2_REGION
npx wrangler secret put B2_BUCKET
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
```

Telegram integration is optional; see `.dev.vars.example`. Never commit real
values or expose them through Vite variables or build logs.

## First deployment

Apply migrations **before** deploying code that depends on them:

```bash
npm run check
npx wrangler d1 export quiz-db --remote --output quiz-db-backup.sql
npm run db:migrate:remote
npm run deploy
curl -i https://<WORKER>.workers.dev/api/health
```

Use the admin UI to create a course, course run, lecture/practice groups and a
grader credential. The grader token is displayed once; store it on the grader
host, never in frontend variables.

## Upgrades and rollback

1. Add a new append-only migration; never edit an applied migration.
2. Create a backup, apply the additive migration, then deploy.
3. Verify `/api/health` and critical user journeys.
4. If needed, roll back the Worker version in Cloudflare Dashboard. Do not
   attempt ad-hoc destructive D1 schema rollback.

## GitHub integration

Cloudflare Workers Builds may use:

- build command: `npm run build`;
- deploy command: `npx wrangler deploy`.

Keep remote migrations as an explicit controlled step. Preview deployments must
not have access to production D1 or B2.

## Trust boundary

The platform owns identity, authorization, immutable versions, queue leases,
idempotency, reports and durable state. It must not clone or execute student
code. That responsibility belongs to the isolated grader-worker.
