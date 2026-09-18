import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Bindings, Session, Variables } from "./env";

export const now = () => Math.floor(Date.now() / 1000);
export const uuid = () => crypto.randomUUID().toLowerCase();
const encoder = new TextEncoder();

export function normalizeDisplay(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е");
}
export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  return toBase64(await crypto.subtle.digest("SHA-256", data));
}
export async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export function randomToken(bytes = 32): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return toBase64(out)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function secureEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const STUDENT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function studentCode(length = 12): string {
  const max = 256 - (256 % STUDENT_ALPHABET.length);
  let result = "";
  while (result.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes)
      if (byte < max && result.length < length)
        result += STUDENT_ALPHABET[byte % STUDENT_ALPHABET.length];
  }
  return result;
}
export function shuffle<T>(input: readonly T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const limit = 0x100000000 - (0x100000000 % (i + 1));
    let n: number;
    do {
      const b = new Uint32Array(1);
      crypto.getRandomValues(b);
      n = b[0]!;
    } while (n >= limit);
    const j = n % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: unknown,
  ) {
    super(message);
  }
}
export function jsonError(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  error: unknown,
) {
  const e =
    error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL_ERROR", "Внутренняя ошибка");
  if (!(error instanceof ApiError))
    console.error(
      JSON.stringify({ requestId: c.get("requestId"), error: String(error) }),
    );
  return c.json(
    {
      error: {
        code: e.code,
        message: e.message,
        request_id: c.get("requestId"),
        ...(e.fields === undefined ? {} : { fields: e.fields }),
      },
    },
    e.status as 400,
  );
}

type SessionKind = "admin" | "teacher" | "student";
export const cookieName = (kind: SessionKind, url?: string) =>
  `${url && new URL(url).protocol === "https:" ? "__Host-" : ""}${kind === "admin" ? "quiz_admin" : kind === "teacher" ? "quiz_teacher" : "quiz_student"}`;
export function setSessionCookie(
  c: Context,
  kind: SessionKind,
  token: string,
  maxAge: number,
) {
  setCookie(c, cookieName(kind, c.req.url), token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
}
export function clearSessionCookie(c: Context, kind: SessionKind) {
  const secure = new URL(c.req.url).protocol === "https:";
  deleteCookie(c, cookieName(kind, c.req.url), {
    path: "/",
    secure,
    httpOnly: true,
    sameSite: "Lax",
  });
}

export async function createSession(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  kind: SessionKind,
  actorId?: string,
) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const timestamp = now();
  const absolute = kind === "student" ? 7 * 86400 : 12 * 3600;
  const idle = kind === "student" ? 86400 : 30 * 60;
  const id = uuid();
  const table = kind === "admin" ? "admin_sessions" : kind === "teacher" ? "teacher_sessions" : "student_sessions";
  const columns =
    kind === "admin"
      ? "id, token_hash, created_at, expires_at, idle_expires_at, last_seen_at"
      : `id, ${kind === "teacher" ? "teacher_id" : "student_id"}, token_hash, created_at, expires_at, idle_expires_at, last_seen_at`;
  const values =
    kind === "admin"
      ? [
          id,
          tokenHash,
          timestamp,
          timestamp + absolute,
          timestamp + idle,
          timestamp,
        ]
      : [
          id,
          actorId!,
          tokenHash,
          timestamp,
          timestamp + absolute,
          timestamp + idle,
          timestamp,
        ];
  await c.env.DB.prepare(
    `INSERT INTO ${table} (${columns}) VALUES (${values.map(() => "?").join(",")})`,
  )
    .bind(...values)
    .run();
  setSessionCookie(c, kind, token, absolute);
  return {
    id,
    kind,
    ...(kind === "student" ? { studentId: actorId } : {}),
    ...(kind === "teacher" ? { teacherId: actorId } : {}),
    expiresAt: timestamp + absolute,
  } satisfies Session;
}

export async function readSession(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  kind: SessionKind,
): Promise<Session | null> {
  const token = getCookie(c, cookieName(kind, c.req.url));
  if (!token) return null;
  const hash = await sha256(token);
  const timestamp = now();
  const table = kind === "admin" ? "admin_sessions" : kind === "teacher" ? "teacher_sessions" : "student_sessions";
  const actorColumn = kind === "teacher" ? "teacher_id" : "student_id";
  const row = await c.env.DB.prepare(
    `SELECT id, expires_at, idle_expires_at${kind === "admin" ? "" : `, ${actorColumn}`} FROM ${table} WHERE token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{
      id: string;
      expires_at: number;
      idle_expires_at: number;
      student_id?: string;
      teacher_id?: string;
    }>();
  if (!row || timestamp >= row.expires_at || timestamp >= row.idle_expires_at) {
    clearSessionCookie(c, kind);
    return null;
  }
  const idle = kind === "student" ? 86400 : 1800;
  await c.env.DB.prepare(
    `UPDATE ${table} SET last_seen_at = ?, idle_expires_at = min(expires_at, ?) WHERE id = ? AND last_seen_at < ?`,
  )
    .bind(timestamp, timestamp + idle, row.id, timestamp - 300)
    .run();
  return {
    id: row.id,
    kind,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    expiresAt: row.expires_at,
  };
}

export async function csrfToken(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  session: Session,
): Promise<string> {
  const payload = `${session.kind}.${session.id}.${session.expiresAt}`;
  return `${payload}.${(await hmac(c.env.CSRF_SECRET, payload)).replaceAll("=", "")}`;
}
export async function verifyCsrf(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  session: Session,
) {
  const origin = c.req.header("Origin");
  const expectedOrigin = new URL(c.req.url).origin;
  if (origin && origin !== expectedOrigin)
    throw new ApiError(403, "CSRF_ORIGIN", "Недопустимый источник запроса");
  if (c.req.header("Sec-Fetch-Site") === "cross-site")
    throw new ApiError(403, "CSRF_SITE", "Недопустимый источник запроса");
  const supplied = c.req.header("X-CSRF-Token") ?? "";
  const expected = await csrfToken(c, session);
  if (!secureEqual(encoder.encode(supplied), encoder.encode(expected)))
    throw new ApiError(403, "CSRF_INVALID", "Недействительный CSRF-токен");
}

export function slugify(value: string): string {
  const translit: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  return (
    normalizeText(value)
      .split("")
      .map((c) => translit[c] ?? c)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .replace(/-+/g, "-")
      .slice(0, 80) || "quiz"
  );
}
export const reservedSlugs = new Set([
  "admin",
  "api",
  "media",
  "register",
  "login",
  "assets",
  "q",
]);
export function validateSlug(value: string) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
    reservedSlugs.has(value) ||
    [...reservedSlugs].some((p) => value.startsWith(`${p}-`))
  )
    throw new ApiError(400, "SLUG_INVALID", "Недопустимый или системный slug");
}

export async function consumeRate(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  scope: string,
  rawKey: string,
  limit: number,
  windowSeconds: number,
) {
  const timestamp = now();
  const window = Math.floor(timestamp / windowSeconds) * windowSeconds;
  const key = await hmac(c.env.RATE_LIMIT_PEPPER, rawKey);
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limit_buckets(scope,key_hash,window_started_at,count,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(scope,key_hash,window_started_at) DO UPDATE SET count=count+1,updated_at=excluded.updated_at RETURNING count`,
  )
    .bind(scope, key, window, timestamp)
    .first<{ count: number }>();
  if (!row || row.count > limit)
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Слишком много запросов. Попробуйте позже",
    );
}
