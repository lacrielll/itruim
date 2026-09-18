export type Bindings = {
  DB: D1Database;
  /** Local integration-test binding. Production media is stored in Backblaze B2. */
  MEDIA?: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  CSRF_SECRET: string;
  RATE_LIMIT_PEPPER: string;
  B2_ENDPOINT: string;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  LLM_ANSWER_DEADLINE_SECONDS?: string;
  /** Must only be enabled for local wrangler development. */
  LOCAL_DEV_UPLOADS?: string;
  /** Optional adapter endpoint (Telegram/email bridge) consuming notification JSON. */
  NOTIFICATION_WEBHOOK_URL?: string;
  NOTIFICATION_WEBHOOK_SECRET?: string;
  /** Public bot username without @, used to generate Telegram deep links. */
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  APP_BASE_URL?: string;
};

export type Session = {
  id: string;
  kind: "admin" | "teacher" | "student";
  studentId?: string;
  teacherId?: string;
  expiresAt: number;
};
export type Variables = {
  requestId: string;
  admin?: Session;
  teacher?: Session;
  student?: Session;
};
