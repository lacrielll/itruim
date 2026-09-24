import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  courseSchema,
  courseRunSchema,
  groupSchema,
  joinCodeSchema,
  membershipResolutionSchema,
  teacherCreateSchema,
} from "../shared/contracts";
import type { Bindings, Variables } from "./env";
import { hashPassword, requireAdmin, requireStudent, requireTeacher } from "./auth";
import { ApiError, consumeRate, createSession, csrfToken, normalizeCode, normalizeDisplay, normalizeText, now, randomToken, sha256, slugify, studentCode, uuid, verifyCsrf } from "./lib";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const groupRoutes = new Hono<AppEnv>();

const inviteTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }).strict();

async function activeRegistrationInvite(db: D1Database, token: string) {
  return db.prepare(
    `SELECT i.id,i.group_id,g.name group_name,g.kind,cr.name course_run_name
     FROM group_registration_invites i JOIN groups g ON g.id=i.group_id
     JOIN course_runs cr ON cr.id=g.course_run_id
     WHERE i.token_hash=? AND i.is_active=1 AND i.revoked_at IS NULL`,
  ).bind(await sha256(token)).first<any>();
}

groupRoutes.get("/public/group-registration-invites/:token", zValidator("param", inviteTokenSchema), async (c) => {
  const invite = await activeRegistrationInvite(c.env.DB, c.req.param("token"));
  if (!invite) throw new ApiError(404, "INVITE_NOT_FOUND", "Ссылка регистрации недействительна или отозвана");
  return c.json({ group_name: invite.group_name, group_kind: invite.kind, course_run_name: invite.course_run_name });
});

groupRoutes.post("/public/group-registration-invites/:token/register", zValidator("param", inviteTokenSchema), zValidator("json", z.object({ fio: z.string().trim().min(3).max(240) }).strict()), async (c) => {
  const token = c.req.param("token"), tokenHash = await sha256(token), invite = await activeRegistrationInvite(c.env.DB, token);
  if (!invite) throw new ApiError(404, "INVITE_NOT_FOUND", "Ссылка регистрации недействительна или отозвана");
  const display = normalizeDisplay(c.req.valid("json").fio), normalized = normalizeText(display);
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "local";
  await consumeRate(c, "invite-register-ip", ip, 12, 3600);
  await consumeRate(c, "invite-register-fio", normalized, 5, 3600);
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = uuid(), code = studentCode(), timestamp = now();
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO students(id,student_code,fio_display,fio_normalized,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING").bind(id, code, display, normalized, timestamp),
      c.env.DB.prepare("SELECT id,student_code,fio_display FROM students WHERE fio_normalized=?").bind(normalized),
    ]);
    const student = rows[1]?.results?.[0] as { id: string; student_code: string; fio_display: string } | undefined;
    if (!student) continue;
    const membership = await c.env.DB.prepare(
      `INSERT INTO group_memberships(id,student_id,group_id,created_at,created_by_kind,created_by_id)
       SELECT ?,?,i.group_id,?,'admin',i.id FROM group_registration_invites i
       WHERE i.token_hash=? AND i.is_active=1 AND i.revoked_at IS NULL
       ON CONFLICT(student_id,group_id) DO NOTHING`,
    ).bind(uuid(), student.id, timestamp, tokenHash).run();
    const member = membership.meta.changes > 0 || await c.env.DB.prepare("SELECT 1 FROM group_memberships WHERE student_id=? AND group_id=?").bind(student.id, invite.group_id).first();
    if (!member) throw new ApiError(409, "INVITE_REVOKED", "Ссылка регистрации была отозвана");
    const session = await createSession(c, "student", student.id);
    return c.json({ student_code: student.student_code, fio_display: student.fio_display, existing: student.id !== id, group_name: invite.group_name, course_run_name: invite.course_run_name, csrf_token: await csrfToken(c, session) });
  }
  throw new ApiError(503, "CODE_GENERATION_FAILED", "Не удалось создать код. Попробуйте ещё раз");
});

async function adminMutation(c: any) {
  const session = await requireAdmin(c);
  await verifyCsrf(c, session);
  return session;
}
async function studentMutation(c: any) {
  const session = await requireStudent(c);
  await verifyCsrf(c, session);
  return session;
}
export async function requireTeacherGroupAccess(
  c: Parameters<typeof requireTeacher>[0],
  groupId: string,
) {
  const session = await requireTeacher(c);
  const access = await c.env.DB.prepare(
    "SELECT 1 FROM teacher_group_access WHERE teacher_id=? AND group_id=?",
  ).bind(session.teacherId!, groupId).first();
  if (!access) throw new ApiError(403, "GROUP_FORBIDDEN", "Нет доступа к этой группе");
  return session;
}

export async function requireTeacherGroupKind(
  c: Parameters<typeof requireTeacher>[0],
  groupId: string,
  expectedKind: "lecture" | "practice",
) {
  const session = await requireTeacher(c);
  const group = await c.env.DB.prepare(
    `SELECT g.kind FROM teacher_group_access tga
     JOIN groups g ON g.id=tga.group_id
     WHERE tga.teacher_id=? AND g.id=?`,
  ).bind(session.teacherId!, groupId).first<{ kind: string }>();
  if (!group) throw new ApiError(403, "GROUP_FORBIDDEN", "Нет доступа к этой группе");
  if (group.kind !== expectedKind)
    throw new ApiError(404, "SECTION_NOT_AVAILABLE", expectedKind === "lecture" ? "Табель доступен только для лекционной группы" : "Лабораторные доступны только для практической группы");
  return session;
}

export async function requireStudentMembership(
  c: Parameters<typeof requireStudent>[0],
  groupId: string,
) {
  const session = await requireStudent(c);
  const membership = await c.env.DB.prepare(
    "SELECT 1 FROM group_memberships WHERE student_id=? AND group_id=?",
  ).bind(session.studentId!, groupId).first();
  if (!membership) throw new ApiError(403, "GROUP_FORBIDDEN", "Вы не состоите в этой группе");
  return session;
}

groupRoutes.get("/student/groups", async (c) => {
  const session = await requireStudent(c);
  const memberships = await c.env.DB.prepare(
    `SELECT g.id,g.name,g.kind,cr.id course_run_id,cr.name course_run_name,gm.created_at
     FROM group_memberships gm JOIN groups g ON g.id=gm.group_id
     JOIN course_runs cr ON cr.id=g.course_run_id
     WHERE gm.student_id=? ORDER BY cr.name,g.kind,g.name`,
  ).bind(session.studentId!).all();
  const requests = await c.env.DB.prepare(
    `SELECT r.id,r.status,r.created_at,r.resolved_at,g.id group_id,g.name group_name,
            g.kind,cr.name course_run_name
     FROM group_membership_requests r JOIN groups g ON g.id=r.group_id
     JOIN course_runs cr ON cr.id=g.course_run_id
     WHERE r.student_id=? ORDER BY r.created_at DESC`,
  ).bind(session.studentId!).all();
  return c.json({ memberships: memberships.results, requests: requests.results });
});

groupRoutes.post(
  "/student/groups/lookup",
  zValidator("json", joinCodeSchema),
  async (c) => {
    const session = await studentMutation(c);
    const code = normalizeCode(c.req.valid("json").join_code);
    await consumeRate(c, "join-code-student", session.studentId!, 20, 3600);
    const group = await c.env.DB.prepare(
      `SELECT g.id,g.name,g.kind,g.join_requests_enabled,cr.name course_run_name,
        EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.group_id=g.id AND gm.student_id=?) is_member,
        EXISTS(SELECT 1 FROM group_membership_requests r WHERE r.group_id=g.id AND r.student_id=? AND r.status='pending') has_pending_request
       FROM groups g JOIN course_runs cr ON cr.id=g.course_run_id WHERE g.join_code=?`,
    ).bind(session.studentId!, session.studentId!, code).first();
    if (!group) throw new ApiError(404, "JOIN_CODE_NOT_FOUND", "Группа с таким кодом не найдена");
    return c.json(group);
  },
);

groupRoutes.post(
  "/student/group-requests",
  zValidator("json", joinCodeSchema),
  async (c) => {
    const session = await studentMutation(c);
    const code = normalizeCode(c.req.valid("json").join_code);
    await consumeRate(c, "join-request-student", session.studentId!, 12, 3600);
    const group = await c.env.DB.prepare(
      "SELECT id,join_requests_enabled FROM groups WHERE join_code=?",
    ).bind(code).first<{ id: string; join_requests_enabled: number }>();
    if (!group) throw new ApiError(404, "JOIN_CODE_NOT_FOUND", "Группа с таким кодом не найдена");
    if (!group.join_requests_enabled)
      throw new ApiError(409, "JOIN_REQUESTS_DISABLED", "Группа сейчас не принимает заявки");
    const member = await c.env.DB.prepare(
      "SELECT 1 FROM group_memberships WHERE student_id=? AND group_id=?",
    ).bind(session.studentId!, group.id).first();
    if (member) throw new ApiError(409, "ALREADY_MEMBER", "Вы уже состоите в этой группе");
    const existing = await c.env.DB.prepare(
      "SELECT id,status,created_at FROM group_membership_requests WHERE student_id=? AND group_id=? AND status='pending'",
    ).bind(session.studentId!, group.id).first();
    if (existing) return c.json(existing);
    const id = uuid(), timestamp = now();
    try {
      await c.env.DB.prepare(
        "INSERT INTO group_membership_requests(id,student_id,group_id,status,created_at) VALUES(?,?,?,'pending',?)",
      ).bind(id, session.studentId!, group.id, timestamp).run();
    } catch {
      const winner = await c.env.DB.prepare(
        "SELECT id,status,created_at FROM group_membership_requests WHERE student_id=? AND group_id=? AND status='pending'",
      ).bind(session.studentId!, group.id).first();
      if (winner) return c.json(winner);
      throw new ApiError(409, "REQUEST_CONFLICT", "Не удалось создать заявку");
    }
    return c.json({ id, status: "pending", created_at: timestamp }, 201);
  },
);

groupRoutes.post("/student/group-requests/:id/cancel", async (c) => {
  const session = await studentMutation(c);
  const timestamp = now();
  const result = await c.env.DB.prepare(
    "UPDATE group_membership_requests SET status='cancelled',resolved_at=? WHERE id=? AND student_id=? AND status='pending'",
  ).bind(timestamp, c.req.param("id"), session.studentId!).run();
  if (!result.meta.changes) throw new ApiError(404, "REQUEST_NOT_FOUND", "Активная заявка не найдена");
  return c.json({ status: "cancelled", resolved_at: timestamp });
});

groupRoutes.get("/admin/courses", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT c.*,count(DISTINCT cr.id) run_count,count(DISTINCT a.id) assignment_count,count(DISTINCT ca.id) achievement_count
     FROM courses c LEFT JOIN course_runs cr ON cr.course_id=c.id LEFT JOIN assignments a ON a.course_id=c.id
     LEFT JOIN course_achievements ca ON ca.course_id=c.id GROUP BY c.id ORDER BY c.title`,
  ).all();
  return c.json({ items: rows.results });
});

groupRoutes.post("/admin/courses", zValidator("json", courseSchema), async (c) => {
  await adminMutation(c);
  const input = c.req.valid("json"), id = uuid(), timestamp = now(), base = input.slug || slugify(input.title);
  if (!base) throw new ApiError(400, "COURSE_SLUG_INVALID", "Не удалось сформировать slug курса");
  let slug = base;
  for (let suffix = 2; await c.env.DB.prepare("SELECT 1 FROM courses WHERE slug=?").bind(slug).first(); suffix++) slug = `${base}-${suffix}`;
  await c.env.DB.prepare("INSERT INTO courses(id,slug,title,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(id, slug, input.title, timestamp, timestamp).run();
  return c.json({ id, slug, title: input.title }, 201);
});

groupRoutes.get("/admin/course-runs", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT cr.*,c.title course_title,count(DISTINCT g.id) group_count
     FROM course_runs cr JOIN courses c ON c.id=cr.course_id LEFT JOIN groups g ON g.course_run_id=cr.id
     GROUP BY cr.id ORDER BY cr.created_at DESC`,
  ).all();
  return c.json({ items: rows.results });
});

groupRoutes.post("/admin/course-runs", zValidator("json", courseRunSchema), async (c) => {
  await adminMutation(c);
  const timestamp = now(), id = uuid();
  const input = c.req.valid("json");
  await c.env.DB.prepare(
    "INSERT INTO course_runs(id,course_id,name,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM courses WHERE id=?)",
  ).bind(id, input.course_id, input.name, timestamp, timestamp, input.course_id).run();
  return c.json({ id, course_id: input.course_id, name: input.name }, 201);
});

groupRoutes.get("/admin/groups", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT g.*,cr.name course_run_name,
      (SELECT count(*) FROM group_memberships gm WHERE gm.group_id=g.id) member_count,
      (SELECT count(*) FROM group_membership_requests r WHERE r.group_id=g.id AND r.status='pending') pending_count
     FROM groups g JOIN course_runs cr ON cr.id=g.course_run_id ORDER BY cr.name,g.kind,g.name`,
  ).all();
  return c.json({ items: rows.results });
});

groupRoutes.post("/admin/groups", zValidator("json", groupSchema), async (c) => {
  await adminMutation(c);
  const input = c.req.valid("json"), timestamp = now(), id = uuid();
  for (let i = 0; i < 8; i++) {
    const joinCode = studentCode(8);
    try {
      await c.env.DB.prepare(
        "INSERT INTO groups(id,course_run_id,name,kind,join_code,join_requests_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(id, input.course_run_id, input.name, input.kind, joinCode, input.join_requests_enabled ? 1 : 0, timestamp, timestamp).run();
      return c.json({ id, join_code: joinCode }, 201);
    } catch (error) {
      if (i === 7) throw error;
    }
  }
  throw new ApiError(503, "JOIN_CODE_GENERATION_FAILED", "Не удалось создать код группы");
});

groupRoutes.post("/admin/groups/:groupId/registration-invites", async (c) => {
  await adminMutation(c);
  const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id=?").bind(c.req.param("groupId")).first();
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "Группа не найдена");
  const token = randomToken(), timestamp = now(), id = uuid();
  await c.env.DB.prepare("INSERT INTO group_registration_invites(id,group_id,token_hash,created_at) VALUES(?,?,?,?)")
    .bind(id, c.req.param("groupId"), await sha256(token), timestamp).run();
  return c.json({ id, token, created_at: timestamp }, 201);
});

groupRoutes.delete("/admin/groups/:groupId/registration-invites/:inviteId", async (c) => {
  await adminMutation(c);
  const result = await c.env.DB.prepare("UPDATE group_registration_invites SET is_active=0,revoked_at=? WHERE id=? AND group_id=? AND is_active=1")
    .bind(now(), c.req.param("inviteId"), c.req.param("groupId")).run();
  if (!result.meta.changes) throw new ApiError(404, "INVITE_NOT_FOUND", "Активная ссылка не найдена");
  return c.body(null, 204);
});

groupRoutes.get("/admin/teachers", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT t.id,t.username,t.display_name,t.is_active,t.created_at,
      count(tga.group_id) group_count FROM teachers t
     LEFT JOIN teacher_group_access tga ON tga.teacher_id=t.id
     GROUP BY t.id ORDER BY t.display_name`,
  ).all();
  return c.json({ items: rows.results });
});

groupRoutes.post("/admin/teachers", zValidator("json", teacherCreateSchema), async (c) => {
  await adminMutation(c);
  const input = c.req.valid("json"), id = uuid(), timestamp = now();
  const passwordHash = await hashPassword(input.password);
  await c.env.DB.prepare(
    "INSERT INTO teachers(id,username,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)",
  ).bind(id, input.username, input.display_name, passwordHash, timestamp, timestamp).run();
  return c.json({ id, username: input.username, display_name: input.display_name }, 201);
});

groupRoutes.put("/admin/teachers/:teacherId/groups/:groupId", async (c) => {
  const admin = await adminMutation(c), id = uuid(), timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO teacher_group_access(id,teacher_id,group_id,created_at,created_by_admin_session_id) VALUES(?,?,?,?,?) ON CONFLICT(teacher_id,group_id) DO NOTHING",
  ).bind(id, c.req.param("teacherId"), c.req.param("groupId"), timestamp, admin.id).run();
  return c.body(null, 204);
});

groupRoutes.delete("/admin/teachers/:teacherId/groups/:groupId", async (c) => {
  await adminMutation(c);
  await c.env.DB.prepare("DELETE FROM teacher_group_access WHERE teacher_id=? AND group_id=?")
    .bind(c.req.param("teacherId"), c.req.param("groupId")).run();
  return c.body(null, 204);
});

groupRoutes.get("/admin/group-requests", async (c) => {
  await requireAdmin(c);
  return c.json({ items: (await requestList(c.env.DB)).results });
});

groupRoutes.get("/admin/groups/:groupId/students", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT s.id,s.fio_display,gm.created_at FROM group_memberships gm
     JOIN students s ON s.id=gm.student_id WHERE gm.group_id=? ORDER BY s.fio_normalized`,
  ).bind(c.req.param("groupId")).all();
  return c.json({ items: rows.results });
});

groupRoutes.get("/teacher/groups", async (c) => {
  const teacher = await requireTeacher(c);
  const groups = await c.env.DB.prepare(
    `SELECT g.id,g.name,g.kind,cr.name course_run_name,
      (SELECT count(*) FROM group_memberships gm WHERE gm.group_id=g.id) member_count
     FROM teacher_group_access tga JOIN groups g ON g.id=tga.group_id
     JOIN course_runs cr ON cr.id=g.course_run_id WHERE tga.teacher_id=? ORDER BY cr.name,g.kind,g.name`,
  ).bind(teacher.teacherId!).all();
  return c.json({ items: groups.results });
});

const requestParamsSchema = z.object({ id: z.string().uuid() });
groupRoutes.post(
  "/admin/group-requests/:id/resolve",
  zValidator("param", requestParamsSchema),
  zValidator("json", membershipResolutionSchema),
  async (c) => {
    const admin = await adminMutation(c);
    return resolveRequest(c, "admin", admin.id);
  },
);
// Преподаватель видит только назначенные группы и проверяет работы.
// Состав групп и заявки изменяет исключительно администратор.

async function requestList(db: D1Database, groupId?: string) {
  return db.prepare(
    `SELECT r.id,r.status,r.created_at,r.resolved_at,r.group_id,s.id student_id,s.fio_display,
            g.name group_name,g.kind,cr.name course_run_name
     FROM group_membership_requests r JOIN students s ON s.id=r.student_id
     JOIN groups g ON g.id=r.group_id JOIN course_runs cr ON cr.id=g.course_run_id
     ${groupId ? "WHERE r.group_id=?" : ""} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC`,
  ).bind(...(groupId ? [groupId] : [])).all();
}

async function resolveRequest(c: any, actorKind: "admin" | "teacher", actorId: string) {
  const decision = c.req.valid("json").decision as "approved" | "rejected";
  const id = c.req.param("id"), timestamp = now(), membershipId = uuid();
  const statements = [
    c.env.DB.prepare(
      "UPDATE group_membership_requests SET status=?,resolved_at=?,resolved_by_kind=?,resolved_by_id=? WHERE id=? AND status='pending'",
    ).bind(decision, timestamp, actorKind, actorId, id),
  ];
  if (decision === "approved") statements.push(
    c.env.DB.prepare(
      `INSERT INTO group_memberships(id,student_id,group_id,created_at,created_by_kind,created_by_id)
       SELECT ?,student_id,group_id,?,?,? FROM group_membership_requests
       WHERE id=? AND status='approved' AND resolved_by_kind=? AND resolved_by_id=?
       ON CONFLICT(student_id,group_id) DO NOTHING`,
    ).bind(membershipId, timestamp, actorKind, actorId, id, actorKind, actorId),
  );
  const results = await c.env.DB.batch(statements);
  if (!results[0]?.meta.changes)
    throw new ApiError(409, "REQUEST_ALREADY_RESOLVED", "Заявка уже обработана");
  return c.json({ id, status: decision, resolved_at: timestamp });
}
