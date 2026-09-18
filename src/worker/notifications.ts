import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { requireStudent } from "./auth";
import { ApiError, now, randomToken, sha256, verifyCsrf } from "./lib";
import { zValidator } from "@hono/zod-validator";
import { notificationPreferencesSchema } from "../shared/contracts";
import { z } from "zod";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const notificationRoutes = new Hono<AppEnv>();

async function telegram(env: Bindings, method: string, body: unknown) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_NOT_CONFIGURED");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`TELEGRAM_HTTP_${response.status}`);
}

notificationRoutes.post("/integrations/telegram/webhook", async (c) => {
  const expected = c.env.TELEGRAM_WEBHOOK_SECRET, supplied = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!expected || !supplied || await sha256(expected) !== await sha256(supplied)) throw new ApiError(401, "TELEGRAM_WEBHOOK_UNAUTHORIZED", "Неверный секрет webhook");
  const update = await c.req.json<any>(), text = String(update.message?.text ?? ""), chatId = update.message?.chat?.id;
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{20,100})$/);
  if (!match || chatId == null) return c.json({ accepted: true });
  const timestamp = now(), tokenHash = await sha256(match[1]);
  const claimed = await c.env.DB.prepare("UPDATE telegram_link_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING student_id")
    .bind(timestamp, tokenHash, timestamp).first<{ student_id: string }>();
  if (!claimed) {
    await telegram(c.env, "sendMessage", { chat_id: chatId, text: "Ссылка устарела или уже использована. Создайте новую ссылку в личном кабинете." });
    return c.json({ accepted: true });
  }
  await c.env.DB.prepare(`INSERT INTO student_notification_preferences(student_id,email,telegram_chat_id,email_enabled,telegram_enabled,updated_at)
    VALUES(?,NULL,?,0,1,?) ON CONFLICT(student_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id,telegram_enabled=1,updated_at=excluded.updated_at`)
    .bind(claimed.student_id, String(chatId), timestamp).run();
  await telegram(c.env, "sendMessage", { chat_id: chatId, text: "Аккаунт подключён. Важные уведомления курса теперь будут приходить сюда. Отвечать на вопросы по работам нужно в личном кабинете платформы." });
  return c.json({ accepted: true });
});

notificationRoutes.get("/student/notification-preferences", async (c) => {
  const student = await requireStudent(c);
  const row = await c.env.DB.prepare("SELECT email,telegram_chat_id,email_enabled,telegram_enabled FROM student_notification_preferences WHERE student_id=?")
    .bind(student.studentId!).first<any>();
  return c.json({ email: row?.email ?? null, telegram_linked: !!row?.telegram_chat_id, email_enabled: !!row?.email_enabled, telegram_enabled: !!row?.telegram_enabled, telegram_bot_username: c.env.TELEGRAM_BOT_USERNAME ?? null });
});

notificationRoutes.post("/student/notification-preferences/telegram-link", async (c) => {
  const student = await requireStudent(c); await verifyCsrf(c, student);
  const username = c.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!username) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "Telegram-бот пока не настроен");
  const token = randomToken(24), timestamp = now();
  await c.env.DB.prepare("INSERT INTO telegram_link_tokens(token_hash,student_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(await sha256(token), student.studentId!, timestamp + 900, timestamp).run();
  return c.json({ url: `https://t.me/${username}?start=${encodeURIComponent(token)}`, expires_at: timestamp + 900 });
});

notificationRoutes.delete("/student/notification-preferences/telegram-link", async (c) => {
  const student = await requireStudent(c); await verifyCsrf(c, student); const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE student_notification_preferences SET telegram_chat_id=NULL,telegram_enabled=0,updated_at=? WHERE student_id=?")
      .bind(timestamp, student.studentId!),
    c.env.DB.prepare("DELETE FROM telegram_link_tokens WHERE student_id=? AND consumed_at IS NULL").bind(student.studentId!),
    c.env.DB.prepare(`UPDATE notification_outbox SET payload_json=json_remove(payload_json,'$.telegram_chat_id')
      WHERE status IN ('pending','failed') AND notification_id IN (SELECT id FROM student_notifications WHERE student_id=?)`)
      .bind(student.studentId!),
  ]);
  await c.env.DB.prepare(`UPDATE notification_outbox SET status='sent',sent_at=?,last_error=NULL
    WHERE status IN ('pending','failed') AND json_extract(payload_json,'$.email') IS NULL
      AND json_extract(payload_json,'$.telegram_chat_id') IS NULL
      AND notification_id IN (SELECT id FROM student_notifications WHERE student_id=?)`)
    .bind(timestamp, student.studentId!).run();
  return c.json({ unlinked: true });
});

notificationRoutes.post("/integrations/telegram/link", zValidator("json", z.object({ token: z.string().min(20).max(100), chat_id: z.string().regex(/^-?[0-9]{1,31}$/) }).strict()), async (c) => {
  const expected = c.env.NOTIFICATION_WEBHOOK_SECRET, supplied = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || await sha256(expected) !== await sha256(supplied)) throw new ApiError(401, "INTEGRATION_UNAUTHORIZED", "Неверный ключ интеграции");
  const input = c.req.valid("json"), timestamp = now(), hash = await sha256(input.token);
  const link = await c.env.DB.prepare("SELECT student_id FROM telegram_link_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?")
    .bind(hash, timestamp).first<{ student_id: string }>();
  if (!link) throw new ApiError(409, "TELEGRAM_LINK_EXPIRED", "Ссылка устарела или уже использована");
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO student_notification_preferences(student_id,email,telegram_chat_id,email_enabled,telegram_enabled,updated_at)
      VALUES(?,NULL,?,0,1,?) ON CONFLICT(student_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id,telegram_enabled=1,updated_at=excluded.updated_at`)
      .bind(link.student_id, input.chat_id, timestamp),
    c.env.DB.prepare("UPDATE telegram_link_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL").bind(timestamp, hash),
  ]);
  return c.json({ linked: true });
});

notificationRoutes.put("/student/notification-preferences", zValidator("json", notificationPreferencesSchema), async (c) => {
  const student = await requireStudent(c); await verifyCsrf(c, student); const input = c.req.valid("json");
  if (input.telegram_enabled && !(await c.env.DB.prepare("SELECT 1 FROM student_notification_preferences WHERE student_id=? AND telegram_chat_id IS NOT NULL").bind(student.studentId!).first()))
    throw new ApiError(409, "TELEGRAM_NOT_LINKED", "Сначала подключите Telegram-бота");
  await c.env.DB.prepare(`INSERT INTO student_notification_preferences(student_id,email,telegram_chat_id,email_enabled,telegram_enabled,updated_at)
    VALUES(?,?,NULL,?,?,?) ON CONFLICT(student_id) DO UPDATE SET email=excluded.email,
    email_enabled=excluded.email_enabled,telegram_enabled=excluded.telegram_enabled,updated_at=excluded.updated_at`)
    .bind(student.studentId!, input.email, input.email_enabled ? 1 : 0, input.telegram_enabled ? 1 : 0, now()).run();
  return c.json(input);
});

notificationRoutes.get("/student/notifications", async (c) => {
  const student = await requireStudent(c);
  const rows = await c.env.DB.prepare(
    `SELECT id,kind,title,message,entity_kind,entity_id,created_at,read_at
     FROM student_notifications WHERE student_id=? ORDER BY created_at DESC LIMIT 100`,
  ).bind(student.studentId!).all();
  return c.json({ items: rows.results, unread: rows.results.filter((item: any) => !item.read_at).length });
});

notificationRoutes.post("/student/notifications/:id/read", async (c) => {
  const student = await requireStudent(c); await verifyCsrf(c, student);
  await c.env.DB.prepare("UPDATE student_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND student_id=?")
    .bind(now(), c.req.param("id"), student.studentId!).run();
  return c.json({ accepted: true });
});

notificationRoutes.post("/student/notifications/read-all", async (c) => {
  const student = await requireStudent(c); await verifyCsrf(c, student);
  await c.env.DB.prepare("UPDATE student_notifications SET read_at=? WHERE student_id=? AND read_at IS NULL")
    .bind(now(), student.studentId!).run();
  return c.json({ accepted: true });
});

export function notificationStatements(db: D1Database, input: { id: string; studentId: string; kind: string; title: string; message: string; entityKind?: string; entityId?: string; dedupeKey: string; timestamp: number }) {
  const actionPath = input.entityKind === "submission" && input.entityId ? `/profile/submissions/${input.entityId}` : "/profile/notifications";
  const payload = JSON.stringify({ notification_id: input.id, student_id: input.studentId, kind: input.kind, title: input.title, message: input.message, entity_kind: input.entityKind ?? null, entity_id: input.entityId ?? null, action_path: actionPath, created_at: input.timestamp });
  return [
    db.prepare(`INSERT INTO student_notifications(id,student_id,kind,title,message,entity_kind,entity_id,dedupe_key,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`).bind(input.id, input.studentId, input.kind, input.title, input.message, input.entityKind ?? null, input.entityId ?? null, input.dedupeKey, input.timestamp),
    db.prepare(`INSERT INTO notification_outbox(id,notification_id,channel,payload_json,next_attempt_at,created_at)
      SELECT ?,?,'webhook',json_set(?,'$.email',CASE WHEN p.email_enabled=1 THEN p.email END,
        '$.telegram_chat_id',CASE WHEN p.telegram_enabled=1 THEN p.telegram_chat_id END),?,?
      FROM student_notification_preferences p WHERE p.student_id=?
        AND ((p.email_enabled=1 AND p.email IS NOT NULL) OR (p.telegram_enabled=1 AND p.telegram_chat_id IS NOT NULL))
        AND EXISTS(SELECT 1 FROM student_notifications WHERE id=?) ON CONFLICT(notification_id,channel) DO NOTHING`)
      .bind(`${input.id}:webhook`, input.id, payload, input.timestamp, input.timestamp, input.studentId, input.id),
  ];
}

export async function deliverNotificationOutbox(env: Bindings, limit = 25) {
  if (!env.NOTIFICATION_WEBHOOK_URL && !env.TELEGRAM_BOT_TOKEN) return { sent: 0, failed: 0, disabled: true };
  const timestamp = now();
  const rows = await env.DB.prepare(`SELECT id,payload_json,attempts FROM notification_outbox
    WHERE status IN ('pending','failed') AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY created_at LIMIT ?`)
    .bind(timestamp, timestamp, limit).all<any>();
  let sent = 0, failed = 0;
  for (const row of rows.results) {
    const claimed = await env.DB.prepare("UPDATE notification_outbox SET status='sending',lease_expires_at=? WHERE id=? AND status IN ('pending','failed') AND (lease_expires_at IS NULL OR lease_expires_at<=?)")
      .bind(timestamp + 60, row.id, timestamp).run();
    if (!claimed.meta.changes) continue;
    try {
      const payload = JSON.parse(row.payload_json);
      if (payload.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
        const url = env.APP_BASE_URL ? new URL(payload.action_path || "/profile/notifications", env.APP_BASE_URL).toString() : null;
        await telegram(env, "sendMessage", { chat_id: payload.telegram_chat_id, text: `${payload.title}\n\n${payload.message}`, ...(url ? { reply_markup: { inline_keyboard: [[{ text: "Открыть платформу", url }]] } } : {}) });
      }
      if (payload.email && env.NOTIFICATION_WEBHOOK_URL) {
        const response = await fetch(env.NOTIFICATION_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", ...(env.NOTIFICATION_WEBHOOK_SECRET ? { Authorization: `Bearer ${env.NOTIFICATION_WEBHOOK_SECRET}` } : {}) }, body: row.payload_json });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
      }
      await env.DB.prepare("UPDATE notification_outbox SET status='sent',attempts=attempts+1,sent_at=?,lease_expires_at=NULL,last_error=NULL WHERE id=?").bind(now(), row.id).run(); sent++;
    } catch (error) {
      const attempts = Number(row.attempts) + 1, delay = Math.min(86400, 60 * 2 ** Math.min(attempts, 10));
      await env.DB.prepare("UPDATE notification_outbox SET status='failed',attempts=?,next_attempt_at=?,lease_expires_at=NULL,last_error=? WHERE id=?")
        .bind(attempts, now() + delay, String(error).slice(0, 300), row.id).run(); failed++;
    }
  }
  return { sent, failed, disabled: false };
}
