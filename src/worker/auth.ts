import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  adminLoginSchema,
  fioSchema,
  studentLoginSchema,
  teacherLoginSchema,
} from "../shared/contracts";
import type { Bindings, Variables } from "./env";
import {
  ApiError,
  clearSessionCookie,
  consumeRate,
  createSession,
  csrfToken,
  fromBase64,
  normalizeCode,
  normalizeDisplay,
  normalizeText,
  now,
  readSession,
  secureEqual,
  sha256,
  studentCode,
  toBase64,
  uuid,
  verifyCsrf,
} from "./lib";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const authRoutes = new Hono<AppEnv>();

function clientKey(c: { req: { header(name: string): string | undefined } }) {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "local"
  );
}

export async function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = encoded.split("$");
  if (
    algorithm !== "pbkdf2-sha256" ||
    !iterationsText ||
    !saltText ||
    !hashText
  )
    return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const salt = fromBase64(saltText);
    const expected = fromBase64(hashText);
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt.buffer as ArrayBuffer,
        iterations,
      },
      key,
      expected.length * 8,
    );
    return secureEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  // Cloudflare Workers WebCrypto currently rejects PBKDF2 iteration counts
  // above 100,000. Keep the encoded count explicit so verification remains
  // portable and existing hashes can still describe their own work factor.
  const iterations = 100_000;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(bits)}`;
}

authRoutes.post(
  "/public/students/register",
  zValidator("json", fioSchema),
  async (c) => {
    const display = normalizeDisplay(c.req.valid("json").fio);
    const normalized = normalizeText(display);
    await consumeRate(c, "register-ip", clientKey(c), 12, 3600);
    await consumeRate(c, "register-fio", normalized, 5, 3600);
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = uuid();
      const code = studentCode();
      const timestamp = now();
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO students(id,student_code,fio_display,fio_normalized,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
        ).bind(id, code, display, normalized, timestamp),
        c.env.DB.prepare(
          "SELECT id,student_code,fio_display,created_at FROM students WHERE fio_normalized=?",
        ).bind(normalized),
      ]);
      const row = results[1]?.results?.[0] as
        | {
            id: string;
            student_code: string;
            fio_display: string;
            created_at: number;
          }
        | undefined;
      if (row)
        return c.json({
          student_code: row.student_code,
          fio_display: row.fio_display,
          existing: row.id !== id,
        });
    }
    throw new ApiError(
      503,
      "CODE_GENERATION_FAILED",
      "Не удалось создать код. Попробуйте ещё раз",
    );
  },
);

authRoutes.post(
  "/student/session",
  zValidator("json", studentLoginSchema),
  async (c) => {
    const input = c.req.valid("json");
    const code = normalizeCode(input.student_code);
    const fio = normalizeText(normalizeDisplay(input.fio));
    const ip = clientKey(c);
    await consumeRate(c, "student-login-ip", ip, 30, 600);
    const student = await c.env.DB.prepare(
      "SELECT id,student_code,fio_display FROM students WHERE student_code=? AND fio_normalized=?",
    )
      .bind(code, fio)
      .first<{ id: string; student_code: string; fio_display: string }>();
    if (!student) {
      await consumeRate(c, "student-login-code", code, 8, 3600);
      throw new ApiError(401, "INVALID_STUDENT_CREDENTIALS", "Неверные ФИО или код студента");
    }
    const current = await readSession(c, "student");
    const session =
      current?.studentId === student.id
        ? current
        : await createSession(c, "student", student.id);
    return c.json({
      student_code: student.student_code,
      fio_display: student.fio_display,
      csrf_token: await csrfToken(c, session),
      expires_at: session.expiresAt,
    });
  },
);

authRoutes.get("/student/session", async (c) => {
  const session = await readSession(c, "student");
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "Введите код студента");
  const student = await c.env.DB.prepare(
    "SELECT student_code,fio_display FROM students WHERE id=?",
  )
    .bind(session.studentId!)
    .first<{ student_code: string; fio_display: string }>();
  return c.json({
    student_code: student?.student_code,
    fio_display: student?.fio_display,
    csrf_token: await csrfToken(c, session),
    expires_at: session.expiresAt,
  });
});

authRoutes.delete("/student/session", async (c) => {
  const session = await readSession(c, "student");
  if (session) {
    await verifyCsrf(c, session);
    await c.env.DB.prepare(
      "UPDATE student_sessions SET revoked_at=? WHERE id=?",
    )
      .bind(now(), session.id)
      .run();
  }
  clearSessionCookie(c, "student");
  return c.body(null, 204);
});

authRoutes.post(
  "/admin/session",
  zValidator("json", adminLoginSchema),
  async (c) => {
    const { username, password } = c.req.valid("json");
    const ip = clientKey(c);
    await consumeRate(c, "admin-login-ip", ip, 8, 900);
    const usernameOkay = username === c.env.ADMIN_USERNAME;
    const passwordOkay = await verifyPassword(
      c.env.ADMIN_PASSWORD_HASH,
      password,
    );
    if (!usernameOkay || !passwordOkay) {
      await consumeRate(c, "admin-login-global-failure", "admin", 30, 3600);
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверные учётные данные");
    }
    const session = await createSession(c, "admin");
    return c.json({
      username: c.env.ADMIN_USERNAME,
      csrf_token: await csrfToken(c, session),
      expires_at: session.expiresAt,
    });
  },
);

authRoutes.get("/admin/session", async (c) => {
  const session = await readSession(c, "admin");
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "Требуется вход администратора");
  return c.json({
    username: c.env.ADMIN_USERNAME,
    csrf_token: await csrfToken(c, session),
    expires_at: session.expiresAt,
  });
});

authRoutes.delete("/admin/session", async (c) => {
  const session = await readSession(c, "admin");
  if (session) {
    await verifyCsrf(c, session);
    await c.env.DB.prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
      .bind(now(), session.id)
      .run();
  }
  clearSessionCookie(c, "admin");
  return c.body(null, 204);
});

authRoutes.post(
  "/teacher/session",
  zValidator("json", teacherLoginSchema),
  async (c) => {
    const { username, password } = c.req.valid("json");
    const ip = clientKey(c);
    await consumeRate(c, "teacher-login-ip", ip, 12, 900);
    const teacher = await c.env.DB.prepare(
      "SELECT id,username,display_name,password_hash FROM teachers WHERE username=? COLLATE NOCASE AND is_active=1",
    )
      .bind(username)
      .first<{ id: string; username: string; display_name: string; password_hash: string }>();
    const okay = teacher ? await verifyPassword(teacher.password_hash, password) : false;
    if (!teacher || !okay) {
      await consumeRate(c, "teacher-login-account", normalizeText(username), 8, 3600);
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверные учётные данные");
    }
    const session = await createSession(c, "teacher", teacher.id);
    return c.json({
      username: teacher.username,
      display_name: teacher.display_name,
      csrf_token: await csrfToken(c, session),
      expires_at: session.expiresAt,
    });
  },
);

authRoutes.get("/teacher/session", async (c) => {
  const session = await requireTeacher(c);
  const teacher = await c.env.DB.prepare(
    "SELECT username,display_name FROM teachers WHERE id=? AND is_active=1",
  ).bind(session.teacherId!).first<{ username: string; display_name: string }>();
  if (!teacher) throw new ApiError(401, "UNAUTHENTICATED", "Учётная запись преподавателя отключена");
  return c.json({ ...teacher, csrf_token: await csrfToken(c, session), expires_at: session.expiresAt });
});

authRoutes.delete("/teacher/session", async (c) => {
  const session = await readSession(c, "teacher");
  if (session) {
    await verifyCsrf(c, session);
    await c.env.DB.prepare("UPDATE teacher_sessions SET revoked_at=? WHERE id=?")
      .bind(now(), session.id).run();
  }
  clearSessionCookie(c, "teacher");
  return c.body(null, 204);
});

export async function requireAdmin(c: Parameters<typeof readSession>[0]) {
  const session = await readSession(c, "admin");
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "Требуется вход администратора");
  return session;
}
export async function requireStudent(c: Parameters<typeof readSession>[0]) {
  const session = await readSession(c, "student");
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "Введите код студента");
  return session;
}
export async function requireTeacher(c: Parameters<typeof readSession>[0]) {
  const session = await readSession(c, "teacher");
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "Требуется вход преподавателя");
  const active = await c.env.DB.prepare("SELECT 1 FROM teachers WHERE id=? AND is_active=1")
    .bind(session.teacherId!).first();
  if (!active) throw new ApiError(401, "UNAUTHENTICATED", "Учётная запись преподавателя отключена");
  return session;
}
