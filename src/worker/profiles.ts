import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { profileVisibilitySchema } from "../shared/contracts";
import type { Bindings, Variables } from "./env";
import { requireStudent } from "./auth";
import { ApiError, randomToken, verifyCsrf } from "./lib";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const profileRoutes = new Hono<AppEnv>();

async function badges(db: D1Database, studentId: string) {
  const quizBadges = (
    await db
      .prepare(
        `WITH ranked AS (
          SELECT a.*,row_number() OVER(PARTITION BY a.quiz_id ORDER BY a.attempt_no DESC,a.finalized_at DESC) rank
          FROM quiz_attempts a
          WHERE a.student_id=? AND a.status IN('SUBMITTED','EXPIRED')
        )
        SELECT r.quiz_id,q.slug,q.title quiz_title,r.finalized_at,
          coalesce(rsr.id,dfr.id,ar.id) badge_id,
          coalesce(rsr.title,dfr.title,ar.title) badge_title,
          coalesce(rsr.description,dfr.description,ar.description) badge_description,
          coalesce(rsr.image_key,dfr.image_key,ar.image_key) image_key,
          coalesce(rsr.emoji,dfr.emoji,ar.emoji) emoji,
          coalesce(rsr.theme,dfr.theme,ar.theme) theme,
          coalesce(rsr.accent_color,dfr.accent_color,ar.accent_color) accent_color
        FROM ranked r
        JOIN quizzes q ON q.id=r.quiz_id
        LEFT JOIN achievement_rules ar ON ar.id=r.achievement_rule_id
        LEFT JOIN double_failure_rules dfr ON dfr.id=r.double_failure_rule_id
        LEFT JOIN retry_success_rules rsr ON rsr.id=r.retry_success_rule_id
        WHERE r.rank=1 AND coalesce(rsr.id,dfr.id,ar.id) IS NOT NULL
        ORDER BY r.finalized_at DESC`,
      )
      .bind(studentId)
      .all()
  ).results as any[];
  const assignmentBadges = (
    await db.prepare(
      `SELECT awa.id badge_id,awa.achievement_id quiz_id,a.title quiz_title,awa.awarded_at finalized_at,
        json_extract(awa.definition_snapshot_json,'$.title') badge_title,
        json_extract(awa.definition_snapshot_json,'$.description') badge_description,
        json_extract(awa.definition_snapshot_json,'$.unlock_hint') unlock_hint,
        json_extract(awa.definition_snapshot_json,'$.image_key') image_key,
        json_extract(awa.definition_snapshot_json,'$.emoji') emoji,
        json_extract(awa.definition_snapshot_json,'$.theme') theme,
        json_extract(awa.definition_snapshot_json,'$.accent_color') accent_color,
        'assignment' badge_kind
       FROM assignment_achievement_awards awa
       JOIN assignment_versions av ON av.id=awa.assignment_version_id
       JOIN assignments a ON a.id=av.assignment_id
       WHERE awa.student_id=? AND coalesce(json_extract(awa.definition_snapshot_json,'$.visibility'),'public')<>'teacher_only'
       ORDER BY awa.awarded_at DESC`,
    ).bind(studentId).all()
  ).results as any[];
  const courseBadges = (
    await db.prepare(
      `SELECT caa.id badge_id,ca.id quiz_id,coalesce(cr.name,'Платформа') quiz_title,caa.awarded_at finalized_at,
        ca.title badge_title,ca.description badge_description,ca.unlock_hint,ca.image_key,ca.emoji, 'info' theme,ca.accent_color,
        'assignment' badge_kind
       FROM course_achievement_awards caa JOIN course_achievements ca ON ca.id=caa.achievement_id
       LEFT JOIN course_runs cr ON cr.id=ca.course_run_id WHERE caa.student_id=? ORDER BY caa.awarded_at DESC`,
    ).bind(studentId).all()
  ).results as any[];
  return [...quizBadges.map((item) => ({ ...item, badge_kind: "quiz" })), ...assignmentBadges, ...courseBadges]
    .sort((left, right) => Number(right.finalized_at) - Number(left.finalized_at));
}

profileRoutes.get("/student/profile", async (c) => {
  const session = await requireStudent(c);
  const student = await c.env.DB.prepare(
    "SELECT profile_share_token,profile_is_public FROM students WHERE id=?",
  )
    .bind(session.studentId!)
    .first<{
      profile_share_token: string | null;
      profile_is_public: number;
    }>();
  c.header("Cache-Control", "private, no-store");
  return c.json({
    is_public: !!student?.profile_is_public,
    share_token: student?.profile_share_token ?? null,
    badges: await badges(c.env.DB, session.studentId!),
  });
});

profileRoutes.put(
  "/student/profile",
  zValidator("json", profileVisibilitySchema),
  async (c) => {
    const session = await requireStudent(c);
    await verifyCsrf(c, session);
    const enabled = c.req.valid("json").is_public;
    let token: string | null = null;
    if (enabled) {
      for (let attempt = 0; attempt < 5; attempt++) {
        token = randomToken(18);
        const updated = await c.env.DB.prepare(
          "UPDATE students SET profile_share_token=coalesce(profile_share_token,?),profile_is_public=1 WHERE id=? RETURNING profile_share_token",
        )
          .bind(token, session.studentId!)
          .first<{ profile_share_token: string }>();
        if (updated) {
          token = updated.profile_share_token;
          break;
        }
      }
    } else {
      await c.env.DB.prepare(
        "UPDATE students SET profile_is_public=0 WHERE id=?",
      )
        .bind(session.studentId!)
        .run();
    }
    return c.json({
      is_public: enabled,
      share_token: enabled ? token : null,
      badges: await badges(c.env.DB, session.studentId!),
    });
  },
);

profileRoutes.post("/student/profile/rotate", async (c) => {
  const session = await requireStudent(c);
  await verifyCsrf(c, session);
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomToken(18);
    try {
      const updated = await c.env.DB.prepare(
        "UPDATE students SET profile_share_token=?,profile_is_public=1 WHERE id=? RETURNING profile_share_token",
      )
        .bind(token, session.studentId!)
        .first();
      if (updated)
        return c.json({
          is_public: true,
          share_token: token,
          badges: await badges(c.env.DB, session.studentId!),
        });
    } catch {
      // Extremely unlikely token collision; retry with fresh entropy.
    }
  }
  throw new ApiError(
    503,
    "PROFILE_TOKEN_FAILED",
    "Не удалось создать ссылку на профиль",
  );
});

profileRoutes.get("/public/profiles/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[A-Za-z0-9_-]{20,32}$/.test(token))
    throw new ApiError(404, "PROFILE_NOT_FOUND", "Профиль не найден");
  const student = await c.env.DB.prepare(
    "SELECT id FROM students WHERE profile_share_token=? AND profile_is_public=1",
  )
    .bind(token)
    .first<{ id: string }>();
  if (!student)
    throw new ApiError(404, "PROFILE_NOT_FOUND", "Профиль не найден");
  const items = await badges(c.env.DB, student.id);
  c.header("Cache-Control", "no-store");
  return c.json({ badges: items, badge_count: items.length });
});
