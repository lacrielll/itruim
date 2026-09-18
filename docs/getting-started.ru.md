# Itruim — запуск и развёртывание

## Назначение

`quiz-platform` — облачный control plane учебной платформы. Один Cloudflare
Worker обслуживает React-интерфейс и Hono API. D1 хранит пользователей, курсы,
квизы, лабораторные, очередь проверок и результаты. Изображения медалей и
достижений хранятся в приватном Backblaze B2.

Код студентов здесь **не выполняется**. Лабораторные забирает отдельный
отдельный `grader-worker`, работающий на доверенной машине. Сам движок может
быть публичным; production grader-packs и скрытые тесты хранятся отдельно.

Пример первой лабораторной: [AKlimovUrfu/lab1](https://github.com/AKlimovUrfu/lab1).
Ссылку на публичный репозиторий grader добавьте сюда после его публикации:
`<GRADER_WORKER_REPOSITORY_URL>`.

## Требования

- Node.js 22.12+ и npm;
- Cloudflare account с Workers и D1;
- Backblaze B2 bucket и ограниченный Application Key;
- Wrangler: `npx wrangler login`.

## Локальный запуск

```bash
git clone <QUIZ_PLATFORM_REPOSITORY_URL>
cd quiz-engine
npm ci
cp .dev.vars.example .dev.vars
npm run admin:hash
```

Поместите полученный hash в `ADMIN_PASSWORD_HASH`. Создайте независимые секреты:

```bash
openssl rand -base64 48 # CSRF_SECRET
openssl rand -base64 48 # RATE_LIMIT_PEPPER
```

Заполните `.dev.vars`, затем:

```bash
npm run db:migrate:local
npm run dev
```

Интерфейс: `http://localhost:5173`. Локальные данные находятся в `.wrangler/`.
Для локальной загрузки решений запустите grader-команду `grader-worker
serve-uploads`; `LOCAL_DEV_UPLOADS=true` допустим только локально.

## Проверка перед публикацией

```bash
npm run check
```

Команда собирает TypeScript/Worker, запускает тесты и проверяет bundle. Также
рекомендуется проверить вход администратора, регистрацию тестового студента,
квиз, CSV, загрузку изображения и полный путь лабораторной с grader-worker.

## Cloudflare и B2

Создайте D1:

```bash
npx wrangler d1 create quiz-db
```

Укажите полученный `database_id` в `wrangler.jsonc`. Создайте приватный B2
bucket и ключ только с `read/write/delete` для этого bucket.

Production-секреты:

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

Опционально добавьте Telegram secrets из `.dev.vars.example`. Никогда не
помещайте реальные значения в Git, Vite variables или build logs.

## Первый deploy

Миграции применяются **до** версии Worker, которая их использует:

```bash
npm run check
npx wrangler d1 export quiz-db --remote --output quiz-db-backup.sql
npm run db:migrate:remote
npm run deploy
curl -i https://<WORKER>.workers.dev/api/health
```

После deploy создайте в админке курс, запуск курса, лекционные/практические
группы и grader credential. Токен grader показывается один раз; сохраните его
на машине grader, а не в Cloudflare frontend variables.

## Обновления и rollback

1. Добавляйте только новую append-only migration.
2. Сначала backup и additive migration, затем deploy.
3. Проверьте `/api/health` и ключевые пользовательские пути.
4. При ошибке откатите Worker version в Cloudflare Dashboard. Не пытайтесь
   вручную удалять колонки из production D1.

## GitHub integration

Cloudflare Workers Builds можно подключить к репозиторию с командами:

- build: `npm run build`;
- deploy: `npx wrangler deploy`.

Remote migrations лучше оставить явным контролируемым шагом. Preview builds не
должны иметь доступ к production D1/B2.

## Граница ответственности

Платформа отвечает за identity, роли, версии, доступ, очередь, leases,
идемпотентность, отчёты и durable state. Она не должна клонировать или запускать
студенческий код. Это делает grader-worker в отдельном sandbox-контуре.
