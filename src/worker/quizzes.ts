import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  achievementSchema,
  availabilitySchema,
  doubleFailureAchievementSchema,
  questionInputSchema,
  quizCreateSchema,
  quizPublicationSchema,
  versionSettingsSchema,
  type QuestionInput,
} from "../shared/contracts";
import type { Bindings, Variables } from "./env";
import { requireAdmin } from "./auth";
import {
  ApiError,
  csrfToken,
  normalizeText,
  now,
  reservedSlugs,
  sha256,
  slugify,
  uuid,
  validateSlug,
  verifyCsrf,
} from "./lib";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const quizRoutes = new Hono<AppEnv>();

type VersionRow = {
  id: string;
  quiz_id: string;
  version_number: number;
  status: "DRAFT" | "PUBLISHED";
  title: string;
  description: string;
  time_per_question_seconds: number;
  shuffle_questions: number;
  shuffle_options: number;
  failure_barrier_enabled: number;
  failure_barrier_threshold_bp: number;
  success_barrier_correct_answers: number;
  show_answer_review_after_submit: number;
  revision: number;
  created_at: number;
  published_at: number | null;
};
type QuestionRow = {
  id: string;
  quiz_version_id: string;
  position: number;
  type: QuestionInput["type"];
  text: string;
  points: number;
  created_at: number;
};

const ifMatch = (value: string | undefined) => {
  const n = Number(value?.replaceAll('"', ""));
  if (!Number.isInteger(n) || n < 1)
    throw new ApiError(
      428,
      "REVISION_REQUIRED",
      "Требуется корректный If-Match",
    );
  return n;
};
async function adminMutation(c: Parameters<typeof requireAdmin>[0]) {
  const session = await requireAdmin(c);
  await verifyCsrf(c, session);
  return session;
}

async function uniqueSlug(db: D1Database, preferred: string): Promise<string> {
  const base = slugify(preferred);
  validateSlug(base);
  for (let i = 0; i < 1000; i++) {
    const candidate = i ? `${base}-${i + 1}` : base;
    if (reservedSlugs.has(candidate)) continue;
    const exists = await db
      .prepare("SELECT 1 FROM quizzes WHERE slug=?")
      .bind(candidate)
      .first();
    if (!exists) return candidate;
  }
  throw new ApiError(
    409,
    "SLUG_UNAVAILABLE",
    "Не удалось подобрать уникальный slug",
  );
}

export async function loadVersion(
  db: D1Database,
  id: string,
  includeKeys = true,
) {
  const version = await db
    .prepare("SELECT * FROM quiz_versions WHERE id=?")
    .bind(id)
    .first<VersionRow>();
  if (!version)
    throw new ApiError(404, "VERSION_NOT_FOUND", "Версия не найдена");
  const questions = await db
    .prepare(
      "SELECT * FROM questions WHERE quiz_version_id=? ORDER BY position",
    )
    .bind(id)
    .all<QuestionRow>();
  const output = [];
  for (const q of questions.results) {
    const base: Record<string, unknown> = {
      id: q.id,
      position: q.position,
      type: q.type,
      text: q.text,
      points: q.points,
    };
    if (q.type === "SINGLE" || q.type === "MULTIPLE") {
      const opts = await db
        .prepare(
          `SELECT id,position,text${includeKeys ? ",is_correct" : ""} FROM question_options WHERE question_id=? ORDER BY position`,
        )
        .bind(q.id)
        .all();
      base.options = opts.results;
    } else if (q.type === "NUMERIC")
      base.numeric = await db
        .prepare(
          includeKeys
            ? "SELECT correct_value,absolute_tolerance,numeric_kind FROM numeric_answer_configs WHERE question_id=?"
            : "SELECT numeric_kind FROM numeric_answer_configs WHERE question_id=?",
        )
        .bind(q.id)
        .first();
    else if (q.type === "SHORT_TEXT" && includeKeys)
      base.answers = (
        await db
          .prepare(
            "SELECT answer_normalized FROM short_answer_variants WHERE question_id=? ORDER BY id",
          )
          .bind(q.id)
          .all<{ answer_normalized: string }>()
      ).results.map((v) => v.answer_normalized);
    output.push(base);
  }
  const achievements = (
    await db
      .prepare(
        "SELECT * FROM achievement_rules WHERE quiz_version_id=? ORDER BY position",
      )
      .bind(id)
      .all()
  ).results;
  const doubleFailureAchievement = await db
    .prepare("SELECT * FROM double_failure_rules WHERE quiz_version_id=?")
    .bind(id)
    .first();
  const retrySuccessAchievement = await db
    .prepare("SELECT * FROM retry_success_rules WHERE quiz_version_id=?")
    .bind(id)
    .first();
  return {
    ...version,
    questions: output,
    achievements: includeKeys
      ? achievements
      : achievements.map(
          ({
            id,
            min_correct_answers,
            title,
            description,
            image_key,
            emoji,
            theme,
            accent_color,
          }) => ({
            id,
            min_correct_answers,
            title,
            description,
            image_key,
            emoji,
            theme,
            accent_color,
          }),
        ),
    double_failure_achievement: doubleFailureAchievement,
    retry_success_achievement: retrySuccessAchievement,
  };
}

quizRoutes.get("/public/quizzes/:slug", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT q.slug,q.opens_at,q.start_deadline_at,v.title,v.description FROM quizzes q JOIN quiz_versions v ON v.id=q.published_version_id WHERE q.slug=?",
  )
    .bind(c.req.param("slug"))
    .first();
  if (!row) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
  return c.json(row);
});

quizRoutes.get("/admin/quizzes", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT q.*,pv.version_number published_version_number,dv.id draft_version_id,dv.version_number draft_version_number FROM quizzes q LEFT JOIN quiz_versions pv ON pv.id=q.published_version_id LEFT JOIN quiz_versions dv ON dv.quiz_id=q.id AND dv.status='DRAFT' ORDER BY q.updated_at DESC`,
  ).all();
  return c.json({ items: rows.results });
});

quizRoutes.post(
  "/admin/quizzes",
  zValidator("json", quizCreateSchema),
  async (c) => {
    await adminMutation(c);
    const input = c.req.valid("json");
    const slug = await uniqueSlug(c.env.DB, input.slug || input.title);
    validateSlug(slug);
    const timestamp = now();
    const quizId = uuid(),
      versionId = uuid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO quizzes(id,slug,title,description,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        quizId,
        slug,
        input.title,
        input.description,
        timestamp,
        timestamp,
      ),
      c.env.DB.prepare(
        "INSERT INTO quiz_versions(id,quiz_id,version_number,status,title,description,created_at) VALUES(?,?,1,'DRAFT',?,?,?)",
      ).bind(versionId, quizId, input.title, input.description, timestamp),
      c.env.DB.prepare(
        "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,title,description,created_at) VALUES(?,?,0,0,'Участник','Тест завершён',?)",
      ).bind(uuid(), versionId, timestamp),
    ]);
    return c.json({ id: quizId, slug, draft_version_id: versionId }, 201);
  },
);

quizRoutes.get("/admin/quizzes/:id", async (c) => {
  await requireAdmin(c);
  const quiz = await c.env.DB.prepare("SELECT * FROM quizzes WHERE id=?")
    .bind(c.req.param("id"))
    .first();
  if (!quiz) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
  const versions = await c.env.DB.prepare(
    "SELECT id,version_number,status,title,revision,published_at FROM quiz_versions WHERE quiz_id=? ORDER BY version_number DESC",
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ ...quiz, versions: versions.results });
});

quizRoutes.patch(
  "/admin/quizzes/:id",
  zValidator("json", quizCreateSchema.partial()),
  async (c) => {
    await adminMutation(c);
    const input = c.req.valid("json");
    if (input.slug) {
      validateSlug(input.slug);
      const occupied = await c.env.DB.prepare(
        "SELECT 1 FROM quizzes WHERE slug=? AND id<>?",
      )
        .bind(input.slug, c.req.param("id"))
        .first();
      if (occupied)
        throw new ApiError(
          409,
          "SLUG_UNAVAILABLE",
          "Этот slug уже используется",
        );
    }
    const row = await c.env.DB.prepare(
      "UPDATE quizzes SET title=coalesce(?,title),description=coalesce(?,description),slug=coalesce(?,slug),updated_at=? WHERE id=? RETURNING *",
    )
      .bind(
        input.title ?? null,
        input.description ?? null,
        input.slug ?? null,
        now(),
        c.req.param("id"),
      )
      .first();
    if (!row) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

quizRoutes.patch(
  "/admin/quizzes/:id/availability",
  zValidator("json", availabilitySchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const v = c.req.valid("json");
    const row = await c.env.DB.prepare(
      "UPDATE quizzes SET opens_at=?,start_deadline_at=?,availability_revision=availability_revision+1,updated_at=? WHERE id=? AND availability_revision=? RETURNING *",
    )
      .bind(v.opens_at, v.start_deadline_at, now(), c.req.param("id"), revision)
      .first();
    if (!row)
      throw new ApiError(409, "QUIZ_CHANGED", "Настройки уже изменились");
    return c.json(row);
  },
);

quizRoutes.get("/admin/quiz-versions/:id", async (c) => {
  await requireAdmin(c);
  return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
});
quizRoutes.post("/admin/quiz-versions/:id/preview", async (c) => {
  await requireAdmin(c);
  const v: any = await loadVersion(c.env.DB, c.req.param("id"), false);
  return c.json(publicVersionForPreview(v));
});

function publicVersionForPreview(v: any) {
  return {
    id: v.id,
    version_number: v.version_number,
    title: v.title,
    description: v.description,
    time_per_question_seconds: v.time_per_question_seconds,
    shuffle_questions: !!v.shuffle_questions,
    shuffle_options: !!v.shuffle_options,
    questions: v.questions.map((q: any) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      points: q.points,
      ...(q.options
        ? { options: q.options.map((o: any) => ({ id: o.id, text: o.text })) }
        : {}),
    })),
    achievements: v.achievements,
  };
}

quizRoutes.patch(
  "/admin/quiz-versions/:id",
  zValidator("json", versionSettingsSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const v = c.req.valid("json");
    const questionCount =
      (
        await c.env.DB.prepare(
          "SELECT count(*) n FROM questions WHERE quiz_version_id=?",
        )
          .bind(c.req.param("id"))
          .first<{ n: number }>()
      )?.n ?? 0;
    if (
      v.failure_barrier_enabled &&
      (questionCount < 2 ||
        v.success_barrier_correct_answers > questionCount - 1)
    ) {
      throw new ApiError(
        400,
        "BARRIER_INVALID",
        "Порог успеха должен быть от 1 до количества вопросов минус один",
      );
    }
    const row = await c.env.DB.prepare(
      `UPDATE quiz_versions SET title=?,description=?,time_per_question_seconds=?,shuffle_questions=?,shuffle_options=?,failure_barrier_enabled=?,failure_barrier_threshold_bp=?,success_barrier_correct_answers=?,show_answer_review_after_submit=?,revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=? RETURNING *`,
    )
      .bind(
        v.title,
        v.description,
        v.time_per_question_seconds,
        +v.shuffle_questions,
        +v.shuffle_options,
        +v.failure_barrier_enabled,
        v.success_barrier_correct_answers,
        v.success_barrier_correct_answers,
        +v.show_answer_review_after_submit,
        c.req.param("id"),
        revision,
      )
      .first();
    if (!row)
      throw new ApiError(
        409,
        "DRAFT_CHANGED",
        "Draft изменён или уже опубликован",
      );
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

async function validateQuestion(input: QuestionInput) {
  if (
    input.type === "SINGLE" &&
    input.options.filter((o) => o.is_correct).length !== 1
  )
    throw new ApiError(
      400,
      "QUESTION_INVALID",
      "Single choice требует ровно один правильный вариант",
    );
  if (
    input.type === "MULTIPLE" &&
    (input.options.filter((o) => o.is_correct).length < 2 ||
      input.options.filter((o) => !o.is_correct).length < 1)
  )
    throw new ApiError(
      400,
      "QUESTION_INVALID",
      "Multiple choice требует минимум два правильных и один неправильный вариант",
    );
  if (
    input.type === "SHORT_TEXT" &&
    new Set(input.answers.map(normalizeText)).size !== input.answers.length
  )
    throw new ApiError(
      400,
      "QUESTION_INVALID",
      "Варианты ответа совпадают после нормализации",
    );
}
async function validateImageKey(
  db: D1Database,
  key: string | null | undefined,
) {
  if (!key) return;
  const ready = await db
    .prepare("SELECT 1 FROM media_objects WHERE key=? AND status='READY'")
    .bind(key)
    .first();
  if (!ready)
    throw new ApiError(
      400,
      "MEDIA_NOT_READY",
      "Изображение не существует или ещё не готово",
    );
}
async function writeQuestion(
  c: any,
  questionId: string,
  versionId: string,
  input: QuestionInput,
  position: number,
  revision: number,
  exists: boolean,
) {
  await validateQuestion(input);
  const timestamp = now();
  const guard = `EXISTS(SELECT 1 FROM quiz_versions v WHERE v.id=? AND v.status='DRAFT' AND v.revision=?)`;
  const statements: D1PreparedStatement[] = [];
  if (exists)
    statements.push(
      c.env.DB.prepare(
        `UPDATE questions SET type=?,text=?,points=? WHERE id=? AND quiz_version_id=? AND ${guard}`,
      ).bind(
        input.type,
        input.text,
        input.points,
        questionId,
        versionId,
        versionId,
        revision,
      ),
    );
  else
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      ).bind(
        questionId,
        versionId,
        position,
        input.type,
        input.text,
        input.points,
        timestamp,
        versionId,
        revision,
      ),
    );
  statements.push(
    c.env.DB.prepare(
      `DELETE FROM question_options WHERE question_id=? AND ${guard}`,
    ).bind(questionId, versionId, revision),
    c.env.DB.prepare(
      `DELETE FROM numeric_answer_configs WHERE question_id=? AND ${guard}`,
    ).bind(questionId, versionId, revision),
    c.env.DB.prepare(
      `DELETE FROM short_answer_variants WHERE question_id=? AND ${guard}`,
    ).bind(questionId, versionId, revision),
  );
  if (input.type === "SINGLE" || input.type === "MULTIPLE")
    input.options.forEach((o, i) =>
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO question_options(id,question_id,position,text,is_correct) SELECT ?,?,?,?,? WHERE ${guard}`,
        ).bind(
          o.id ?? uuid(),
          questionId,
          i,
          o.text,
          +o.is_correct,
          versionId,
          revision,
        ),
      ),
    );
  if (input.type === "NUMERIC")
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO numeric_answer_configs(question_id,correct_value,absolute_tolerance,numeric_kind) SELECT ?,?,?,? WHERE ${guard}`,
      ).bind(
        questionId,
        input.correct_value,
        input.absolute_tolerance,
        input.numeric_kind,
        versionId,
        revision,
      ),
    );
  if (input.type === "SHORT_TEXT")
    input.answers.forEach((a) =>
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO short_answer_variants(id,question_id,answer_normalized) SELECT ?,?,? WHERE ${guard}`,
        ).bind(uuid(), questionId, normalizeText(a), versionId, revision),
      ),
    );
  statements.push(
    c.env.DB.prepare(
      "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
    ).bind(versionId, revision),
  );
  await c.env.DB.batch(statements);
  const changed = (await c.env.DB.prepare(
    "SELECT revision FROM quiz_versions WHERE id=?",
  )
    .bind(versionId)
    .first()) as { revision: number } | null;
  if (changed?.revision !== revision + 1)
    throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
  return loadVersion(c.env.DB, versionId, true);
}

quizRoutes.post(
  "/admin/quiz-versions/:id/questions",
  zValidator("json", questionInputSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const pos = (await c.env.DB.prepare(
      "SELECT coalesce(max(position),-1)+1 p FROM questions WHERE quiz_version_id=?",
    )
      .bind(c.req.param("id"))
      .first<{ p: number }>())!.p;
    return c.json(
      await writeQuestion(
        c,
        uuid(),
        c.req.param("id"),
        c.req.valid("json"),
        pos,
        revision,
        false,
      ),
      201,
    );
  },
);
quizRoutes.put(
  "/admin/questions/:id",
  zValidator("json", questionInputSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const q = await c.env.DB.prepare(
      "SELECT quiz_version_id,position FROM questions WHERE id=?",
    )
      .bind(c.req.param("id"))
      .first<{ quiz_version_id: string; position: number }>();
    if (!q) throw new ApiError(404, "QUESTION_NOT_FOUND", "Вопрос не найден");
    return c.json(
      await writeQuestion(
        c,
        c.req.param("id"),
        q.quiz_version_id,
        c.req.valid("json"),
        q.position,
        revision,
        true,
      ),
    );
  },
);
quizRoutes.delete("/admin/questions/:id", async (c) => {
  await adminMutation(c);
  const revision = ifMatch(c.req.header("If-Match"));
  const q = await c.env.DB.prepare(
    "SELECT quiz_version_id FROM questions WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ quiz_version_id: string }>();
  if (!q) throw new ApiError(404, "QUESTION_NOT_FOUND", "Вопрос не найден");
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM questions WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
    ).bind(c.req.param("id"), q.quiz_version_id, revision),
    c.env.DB.prepare(
      "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
    ).bind(q.quiz_version_id, revision),
  ]);
  if (!res[1]?.meta.changes)
    throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
  return c.body(null, 204);
});
quizRoutes.put(
  "/admin/quiz-versions/:id/question-order",
  zValidator(
    "json",
    z.object({ ids: z.array(z.string().uuid()).max(500) }).strict(),
  ),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const ids = c.req.valid("json").ids;
    const current = (
      await c.env.DB.prepare(
        "SELECT id FROM questions WHERE quiz_version_id=? ORDER BY position",
      )
        .bind(c.req.param("id"))
        .all<{ id: string }>()
    ).results.map((x) => x.id);
    if (
      ids.length !== current.length ||
      ids.some((id) => !current.includes(id))
    )
      throw new ApiError(
        400,
        "ORDER_INVALID",
        "Список не является перестановкой вопросов",
      );
    const stmts = ids.map((id, i) =>
      c.env.DB.prepare(
        "UPDATE questions SET position=? WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
      ).bind(100000 + i, id, c.req.param("id"), revision),
    );
    stmts.push(
      ...ids.map((id, i) =>
        c.env.DB.prepare(
          "UPDATE questions SET position=? WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
        ).bind(i, id, c.req.param("id"), revision),
      ),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    );
    const res = await c.env.DB.batch(stmts);
    if (!res.at(-1)?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

quizRoutes.post(
  "/admin/quiz-versions/:id/achievements",
  zValidator("json", achievementSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const v = c.req.valid("json");
    await validateImageKey(c.env.DB, v.image_key);
    const pos = (await c.env.DB.prepare(
      "SELECT coalesce(max(position),-1)+1 p FROM achievement_rules WHERE quiz_version_id=?",
    )
      .bind(c.req.param("id"))
      .first<{ p: number }>())!.p;
    const id = uuid();
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,min_correct_answers,title,description,image_key,emoji,theme,accent_color,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
      ).bind(
        id,
        c.req.param("id"),
        pos,
        v.min_correct_answers,
        v.min_correct_answers,
        v.title,
        v.description,
        v.image_key ?? null,
        v.emoji ?? null,
        v.theme ?? null,
        v.accent_color ?? null,
        now(),
        c.req.param("id"),
        revision,
      ),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    ]);
    if (!batch[1]?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true), 201);
  },
);

quizRoutes.put(
  "/admin/achievements/:id",
  zValidator("json", achievementSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const a = await c.env.DB.prepare(
      "SELECT quiz_version_id,min_correct_answers FROM achievement_rules WHERE id=?",
    )
      .bind(c.req.param("id"))
      .first<{ quiz_version_id: string; min_correct_answers: number }>();
    if (!a)
      throw new ApiError(404, "ACHIEVEMENT_NOT_FOUND", "Achievement не найден");
    const v = c.req.valid("json");
    if (a.min_correct_answers === 0 && v.min_correct_answers !== 0)
      throw new ApiError(
        409,
        "ZERO_ACHIEVEMENT_REQUIRED",
        "Порог обязательного достижения для провала должен оставаться равным 0",
      );
    await validateImageKey(c.env.DB, v.image_key);
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE achievement_rules SET min_percent_bp=?,min_correct_answers=?,title=?,description=?,image_key=?,emoji=?,theme=?,accent_color=? WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
      ).bind(
        v.min_correct_answers,
        v.min_correct_answers,
        v.title,
        v.description,
        v.image_key ?? null,
        v.emoji ?? null,
        v.theme ?? null,
        v.accent_color ?? null,
        c.req.param("id"),
        a.quiz_version_id,
        revision,
      ),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(a.quiz_version_id, revision),
    ]);
    if (!batch[1]?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, a.quiz_version_id, true));
  },
);

quizRoutes.delete("/admin/achievements/:id", async (c) => {
  await adminMutation(c);
  const revision = ifMatch(c.req.header("If-Match"));
  const a = await c.env.DB.prepare(
    "SELECT quiz_version_id,min_correct_answers FROM achievement_rules WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ quiz_version_id: string; min_correct_answers: number }>();
  if (!a)
    throw new ApiError(404, "ACHIEVEMENT_NOT_FOUND", "Achievement не найден");
  if (a.min_correct_answers === 0)
    throw new ApiError(
      409,
      "ZERO_ACHIEVEMENT_REQUIRED",
      "Достижение для 0 правильных ответов обязательно; его можно изменить, но нельзя удалить",
    );
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM achievement_rules WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
    ).bind(c.req.param("id"), a.quiz_version_id, revision),
    c.env.DB.prepare(
      "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
    ).bind(a.quiz_version_id, revision),
  ]);
  if (!batch[1]?.meta.changes)
    throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
  return c.body(null, 204);
});

quizRoutes.put(
  "/admin/quiz-versions/:id/double-failure-achievement",
  zValidator("json", doubleFailureAchievementSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const v = c.req.valid("json");
    await validateImageKey(c.env.DB, v.image_key);
    const ruleId = uuid();
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO double_failure_rules(id,quiz_version_id,title,description,image_key,emoji,theme,accent_color,created_at)
         SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)
         ON CONFLICT(quiz_version_id) DO UPDATE SET title=excluded.title,description=excluded.description,image_key=excluded.image_key,emoji=excluded.emoji,theme=excluded.theme,accent_color=excluded.accent_color`,
      ).bind(
        ruleId,
        c.req.param("id"),
        v.title,
        v.description,
        v.image_key ?? null,
        v.emoji ?? null,
        v.theme ?? null,
        v.accent_color ?? null,
        now(),
        c.req.param("id"),
        revision,
      ),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    ]);
    if (!batch[1]?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

quizRoutes.delete(
  "/admin/quiz-versions/:id/double-failure-achievement",
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM double_failure_rules WHERE quiz_version_id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
      ).bind(c.req.param("id"), c.req.param("id"), revision),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    ]);
    if (!batch[1]?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

quizRoutes.put(
  "/admin/quiz-versions/:id/retry-success-achievement",
  zValidator("json", doubleFailureAchievementSchema),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const v = c.req.valid("json");
    await validateImageKey(c.env.DB, v.image_key);
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO retry_success_rules(id,quiz_version_id,title,description,image_key,emoji,theme,accent_color,created_at)
         SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)
         ON CONFLICT(quiz_version_id) DO UPDATE SET title=excluded.title,description=excluded.description,image_key=excluded.image_key,emoji=excluded.emoji,theme=excluded.theme,accent_color=excluded.accent_color`,
      ).bind(
        uuid(),
        c.req.param("id"),
        v.title,
        v.description,
        v.image_key ?? null,
        v.emoji ?? null,
        v.theme ?? null,
        v.accent_color ?? null,
        now(),
        c.req.param("id"),
        revision,
      ),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    ]);
    if (!batch[1]?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

quizRoutes.delete(
  "/admin/quiz-versions/:id/retry-success-achievement",
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM retry_success_rules WHERE quiz_version_id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
      ).bind(c.req.param("id"), c.req.param("id"), revision),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    ]);
    if (!batch[1]?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

quizRoutes.put(
  "/admin/quiz-versions/:id/achievement-order",
  zValidator(
    "json",
    z.object({ ids: z.array(z.string().uuid()).max(100) }).strict(),
  ),
  async (c) => {
    await adminMutation(c);
    const revision = ifMatch(c.req.header("If-Match"));
    const ids = c.req.valid("json").ids;
    const current = (
      await c.env.DB.prepare(
        "SELECT id FROM achievement_rules WHERE quiz_version_id=?",
      )
        .bind(c.req.param("id"))
        .all<{ id: string }>()
    ).results.map((x) => x.id);
    if (
      ids.length !== current.length ||
      ids.some((id) => !current.includes(id))
    )
      throw new ApiError(
        400,
        "ORDER_INVALID",
        "Список не является перестановкой achievements",
      );
    const stmts = ids.map((id, i) =>
      c.env.DB.prepare(
        "UPDATE achievement_rules SET position=? WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
      ).bind(100000 + i, id, c.req.param("id"), revision),
    );
    stmts.push(
      ...ids.map((id, i) =>
        c.env.DB.prepare(
          "UPDATE achievement_rules SET position=? WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='DRAFT' AND revision=?)",
        ).bind(i, id, c.req.param("id"), revision),
      ),
      c.env.DB.prepare(
        "UPDATE quiz_versions SET revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
      ).bind(c.req.param("id"), revision),
    );
    const res = await c.env.DB.batch(stmts);
    if (!res.at(-1)?.meta.changes)
      throw new ApiError(409, "DRAFT_CHANGED", "Draft уже изменён");
    return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
  },
);

function assertPublishable(v: any) {
  if (!v.questions.length)
    throw new ApiError(400, "PUBLISH_INVALID", "Добавьте хотя бы один вопрос");
  if (!v.achievements.some((a: any) => a.min_correct_answers === 0))
    throw new ApiError(
      400,
      "PUBLISH_INVALID",
      "Нужно achievement с порогом 0 правильных ответов",
    );
  const thresholds = v.achievements.map((a: any) => a.min_correct_answers);
  if (
    new Set(thresholds).size !== thresholds.length ||
    thresholds.some((threshold: number) => threshold > v.questions.length)
  )
    throw new ApiError(
      400,
      "PUBLISH_INVALID",
      "Пороги достижений должны быть уникальны и не превышать количество вопросов",
    );
  if (
    v.failure_barrier_enabled &&
    (v.questions.length < 2 ||
      v.success_barrier_correct_answers > v.questions.length - 1)
  )
    throw new ApiError(
      400,
      "PUBLISH_INVALID",
      "Порог успеха должен быть от 1 до количества вопросов минус один",
    );
  if (v.failure_barrier_enabled && !v.double_failure_achievement)
    throw new ApiError(
      400,
      "PUBLISH_INVALID",
      "Настройте отдельное достижение за две неудачные попытки",
    );
  if (v.failure_barrier_enabled && !v.retry_success_achievement)
    throw new ApiError(
      400,
      "PUBLISH_INVALID",
      "Настройте отдельное достижение за успех после первой неудачи",
    );
  for (const q of v.questions) {
    if (
      (q.type === "SINGLE" &&
        q.options.filter((o: any) => o.is_correct).length !== 1) ||
      (q.type === "MULTIPLE" &&
        (q.options.filter((o: any) => o.is_correct).length < 2 ||
          q.options.filter((o: any) => !o.is_correct).length < 1)) ||
      (q.type === "NUMERIC" && !q.numeric) ||
      (q.type === "SHORT_TEXT" && !q.answers.length)
    )
      throw new ApiError(
        400,
        "PUBLISH_INVALID",
        `Некорректный вопрос: ${q.text}`,
      );
  }
}
quizRoutes.post("/admin/quiz-versions/:id/publish", async (c) => {
  await adminMutation(c);
  const revision = ifMatch(c.req.header("If-Match"));
  const v: any = await loadVersion(c.env.DB, c.req.param("id"), true);
  if (v.status === "PUBLISHED") return c.json(v);
  assertPublishable(v);
  const timestamp = now();
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE quiz_versions SET status='PUBLISHED',published_at=?,revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?",
    ).bind(timestamp, v.id, revision),
    c.env.DB.prepare(
      "UPDATE quizzes SET published_version_id=?,title=?,description=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM quiz_versions WHERE id=? AND status='PUBLISHED')",
    ).bind(v.id, v.title, v.description, timestamp, v.quiz_id, v.id),
  ]);
  if (!batch[0]?.meta.changes) {
    const winner: any = await loadVersion(c.env.DB, v.id, true);
    if (winner.status === "PUBLISHED") return c.json(winner);
    throw new ApiError(409, "DRAFT_CHANGED", "Draft изменён");
  }
  await c.env.DB.prepare(
    "UPDATE quiz_publications SET quiz_version_id=?,is_active=1,updated_at=? WHERE quiz_id=?",
  ).bind(v.id, timestamp, v.quiz_id).run();
  return c.json(await loadVersion(c.env.DB, v.id, true));
});
quizRoutes.post("/admin/quizzes/:id/unpublish", async (c) => {
  await adminMutation(c);
  const row = await c.env.DB.prepare(
    "UPDATE quizzes SET published_version_id=NULL,updated_at=? WHERE id=? RETURNING *",
  )
    .bind(now(), c.req.param("id"))
    .first();
  if (!row) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
  await c.env.DB.prepare("UPDATE quiz_publications SET is_active=0,updated_at=? WHERE quiz_id=?")
    .bind(now(), c.req.param("id")).run();
  return c.json(row);
});

quizRoutes.get("/admin/quizzes/:id/publications", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT p.*,cr.name course_run_name FROM quiz_publications p
     JOIN course_runs cr ON cr.id=p.course_run_id WHERE p.quiz_id=? ORDER BY cr.name`,
  ).bind(c.req.param("id")).all<any>();
  const items = [];
  for (const row of rows.results) {
    const groups = await c.env.DB.prepare(
      "SELECT g.id,g.name,g.kind FROM quiz_publication_groups pg JOIN groups g ON g.id=pg.group_id WHERE pg.publication_id=? ORDER BY g.kind,g.name",
    ).bind(row.id).all();
    items.push({ ...row, groups: groups.results });
  }
  return c.json({ items });
});

quizRoutes.put(
  "/admin/quizzes/:id/publications",
  zValidator("json", quizPublicationSchema),
  async (c) => {
    await adminMutation(c);
    const input = c.req.valid("json"), quizId = c.req.param("id");
    const quiz = await c.env.DB.prepare(
      "SELECT published_version_id,opens_at,start_deadline_at FROM quizzes WHERE id=?",
    ).bind(quizId).first<{ published_version_id: string | null; opens_at: number | null; start_deadline_at: number | null }>();
    if (!quiz) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
    if (!quiz.published_version_id) throw new ApiError(409, "QUIZ_NOT_PUBLISHED", "Сначала опубликуйте тест");
    if (!input.target_all_course_run && input.group_ids.length) {
      const placeholders = input.group_ids.map(() => "?").join(",");
      const count = await c.env.DB.prepare(
        `SELECT count(*) n FROM groups WHERE course_run_id=? AND kind='lecture' AND id IN (${placeholders})`,
      ).bind(input.course_run_id, ...new Set(input.group_ids)).first<{ n: number }>();
      if (count?.n !== new Set(input.group_ids).size)
        throw new ApiError(400, "PUBLICATION_GROUP_INVALID", "Квизы можно назначать только лекционным группам выбранного курса");
    }
    const existing = await c.env.DB.prepare(
      "SELECT id FROM quiz_publications WHERE quiz_id=? AND course_run_id=?",
    ).bind(quizId, input.course_run_id).first<{ id: string }>();
    const id = existing?.id ?? uuid(), timestamp = now();
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `INSERT INTO quiz_publications(id,quiz_id,quiz_version_id,course_run_id,target_all_course_run,opens_at,start_deadline_at,is_active,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(quiz_id,course_run_id) DO UPDATE SET
         quiz_version_id=excluded.quiz_version_id,target_all_course_run=excluded.target_all_course_run,
         opens_at=excluded.opens_at,start_deadline_at=excluded.start_deadline_at,is_active=1,updated_at=excluded.updated_at`,
      ).bind(id, quizId, quiz.published_version_id, input.course_run_id, input.target_all_course_run ? 1 : 0, input.opens_at, input.start_deadline_at, timestamp, timestamp),
      c.env.DB.prepare("DELETE FROM quiz_publication_groups WHERE publication_id=?").bind(id),
    ];
    if (!input.target_all_course_run)
      for (const groupId of new Set(input.group_ids))
        statements.push(c.env.DB.prepare("INSERT INTO quiz_publication_groups(publication_id,group_id) VALUES(?,?)").bind(id, groupId));
    await c.env.DB.batch(statements);
    return c.json({ id, active: true });
  },
);

quizRoutes.delete("/admin/quizzes/:quizId/publications/:publicationId", async (c) => {
  await adminMutation(c);
  const result = await c.env.DB.prepare(
    "UPDATE quiz_publications SET is_active=0,updated_at=? WHERE id=? AND quiz_id=?",
  ).bind(now(), c.req.param("publicationId"), c.req.param("quizId")).run();
  if (!result.meta.changes) throw new ApiError(404, "PUBLICATION_NOT_FOUND", "Публикация не найдена");
  return c.body(null, 204);
});

async function copyAsDraft(db: D1Database, quizId: string, sourceId: string) {
  const existing = await db
    .prepare("SELECT id FROM quiz_versions WHERE quiz_id=? AND status='DRAFT'")
    .bind(quizId)
    .first<{ id: string }>();
  if (existing) return loadVersion(db, existing.id, true);
  const source: any = await loadVersion(db, sourceId, true);
  const next = (await db
    .prepare(
      "SELECT coalesce(max(version_number),0)+1 n FROM quiz_versions WHERE quiz_id=?",
    )
    .bind(quizId)
    .first<{ n: number }>())!.n;
  const timestamp = now(),
    versionId = uuid();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO quiz_versions(id,quiz_id,version_number,status,title,description,time_per_question_seconds,shuffle_questions,shuffle_options,failure_barrier_enabled,failure_barrier_threshold_bp,success_barrier_correct_answers,show_answer_review_after_submit,created_at) VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        versionId,
        quizId,
        next,
        source.title,
        source.description,
        source.time_per_question_seconds,
        source.shuffle_questions,
        source.shuffle_options,
        source.failure_barrier_enabled,
        source.success_barrier_correct_answers,
        source.success_barrier_correct_answers,
        source.show_answer_review_after_submit,
        timestamp,
      ),
  ];
  for (const q of source.questions) {
    const qid = uuid();
    statements.push(
      db
        .prepare(
          "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(qid, versionId, q.position, q.type, q.text, q.points, timestamp),
    );
    if (q.options)
      for (const o of q.options)
        statements.push(
          db
            .prepare(
              "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,?,?,?)",
            )
            .bind(uuid(), qid, o.position, o.text, o.is_correct),
        );
    if (q.numeric)
      statements.push(
        db
          .prepare(
            "INSERT INTO numeric_answer_configs(question_id,correct_value,absolute_tolerance,numeric_kind) VALUES(?,?,?,?)",
          )
          .bind(
            qid,
            q.numeric.correct_value,
            q.numeric.absolute_tolerance,
            q.numeric.numeric_kind ?? "FLOAT",
          ),
      );
    if (q.answers)
      for (const a of q.answers)
        statements.push(
          db
            .prepare(
              "INSERT INTO short_answer_variants(id,question_id,answer_normalized) VALUES(?,?,?)",
            )
            .bind(uuid(), qid, a),
        );
  }
  for (const a of source.achievements)
    statements.push(
      db
        .prepare(
          "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,min_correct_answers,title,description,image_key,emoji,theme,accent_color,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          versionId,
          a.position,
          a.min_correct_answers,
          a.min_correct_answers,
          a.title,
          a.description,
          a.image_key,
          a.emoji,
          a.theme,
          a.accent_color,
          timestamp,
        ),
    );
  if (source.double_failure_achievement) {
    const a = source.double_failure_achievement;
    statements.push(
      db
        .prepare(
          "INSERT INTO double_failure_rules(id,quiz_version_id,title,description,image_key,emoji,theme,accent_color,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          versionId,
          a.title,
          a.description,
          a.image_key,
          a.emoji,
          a.theme,
          a.accent_color,
          timestamp,
        ),
    );
  }
  if (source.retry_success_achievement) {
    const a = source.retry_success_achievement;
    statements.push(
      db
        .prepare(
          "INSERT INTO retry_success_rules(id,quiz_version_id,title,description,image_key,emoji,theme,accent_color,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          versionId,
          a.title,
          a.description,
          a.image_key,
          a.emoji,
          a.theme,
          a.accent_color,
          timestamp,
        ),
    );
  }
  try {
    await db.batch(statements);
  } catch (e) {
    const winner = await db
      .prepare(
        "SELECT id FROM quiz_versions WHERE quiz_id=? AND status='DRAFT'",
      )
      .bind(quizId)
      .first<{ id: string }>();
    if (winner) return loadVersion(db, winner.id, true);
    throw e;
  }
  return loadVersion(db, versionId, true);
}
quizRoutes.post("/admin/quizzes/:id/draft", async (c) => {
  await adminMutation(c);
  const quiz = await c.env.DB.prepare(
    "SELECT published_version_id FROM quizzes WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ published_version_id: string | null }>();
  if (!quiz) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
  const existing = await c.env.DB.prepare(
    "SELECT id FROM quiz_versions WHERE quiz_id=? AND status='DRAFT'",
  )
    .bind(c.req.param("id"))
    .first<{ id: string }>();
  if (existing) return c.json(await loadVersion(c.env.DB, existing.id, true));
  const sourceVersionId =
    quiz.published_version_id ??
    (
      await c.env.DB.prepare(
        "SELECT id FROM quiz_versions WHERE quiz_id=? AND status='PUBLISHED' ORDER BY version_number DESC LIMIT 1",
      )
        .bind(c.req.param("id"))
        .first<{ id: string }>()
    )?.id;
  if (!sourceVersionId)
    throw new ApiError(409, "NO_SOURCE_VERSION", "Нет версии для копирования");
  return c.json(
    await copyAsDraft(c.env.DB, c.req.param("id"), sourceVersionId),
    201,
  );
});

async function cloneInto(
  db: D1Database,
  sourceId: string,
  title: string,
  slug: string,
) {
  const source: any = await loadVersion(db, sourceId, true);
  const timestamp = now(),
    quizId = uuid(),
    versionId = uuid();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO quizzes(id,slug,title,description,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(quizId, slug, title, source.description, timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO quiz_versions(id,quiz_id,version_number,status,title,description,time_per_question_seconds,shuffle_questions,shuffle_options,failure_barrier_enabled,failure_barrier_threshold_bp,success_barrier_correct_answers,show_answer_review_after_submit,created_at) VALUES(?,?,1,'DRAFT',?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        versionId,
        quizId,
        title,
        source.description,
        source.time_per_question_seconds,
        source.shuffle_questions,
        source.shuffle_options,
        source.failure_barrier_enabled,
        source.success_barrier_correct_answers,
        source.success_barrier_correct_answers,
        source.show_answer_review_after_submit,
        timestamp,
      ),
  ];
  for (const q of source.questions) {
    const qid = uuid();
    statements.push(
      db
        .prepare(
          "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(qid, versionId, q.position, q.type, q.text, q.points, timestamp),
    );
    if (q.options)
      for (const o of q.options)
        statements.push(
          db
            .prepare(
              "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,?,?,?)",
            )
            .bind(uuid(), qid, o.position, o.text, o.is_correct),
        );
    if (q.numeric)
      statements.push(
        db
          .prepare(
            "INSERT INTO numeric_answer_configs(question_id,correct_value,absolute_tolerance,numeric_kind) VALUES(?,?,?,?)",
          )
          .bind(
            qid,
            q.numeric.correct_value,
            q.numeric.absolute_tolerance,
            q.numeric.numeric_kind ?? "FLOAT",
          ),
      );
    if (q.answers)
      for (const a of q.answers)
        statements.push(
          db
            .prepare(
              "INSERT INTO short_answer_variants(id,question_id,answer_normalized) VALUES(?,?,?)",
            )
            .bind(uuid(), qid, a),
        );
  }
  for (const a of source.achievements)
    statements.push(
      db
        .prepare(
          "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,min_correct_answers,title,description,image_key,emoji,theme,accent_color,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          versionId,
          a.position,
          a.min_correct_answers,
          a.min_correct_answers,
          a.title,
          a.description,
          a.image_key,
          a.emoji,
          a.theme,
          a.accent_color,
          timestamp,
        ),
    );
  if (source.double_failure_achievement) {
    const a = source.double_failure_achievement;
    statements.push(
      db
        .prepare(
          "INSERT INTO double_failure_rules(id,quiz_version_id,title,description,image_key,emoji,theme,accent_color,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          versionId,
          a.title,
          a.description,
          a.image_key,
          a.emoji,
          a.theme,
          a.accent_color,
          timestamp,
        ),
    );
  }
  if (source.retry_success_achievement) {
    const a = source.retry_success_achievement;
    statements.push(
      db
        .prepare(
          "INSERT INTO retry_success_rules(id,quiz_version_id,title,description,image_key,emoji,theme,accent_color,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          versionId,
          a.title,
          a.description,
          a.image_key,
          a.emoji,
          a.theme,
          a.accent_color,
          timestamp,
        ),
    );
  }
  await db.batch(statements);
  return {
    id: quizId,
    slug,
    draft_version_id: versionId,
    source: {
      version_id: source.id,
      version_number: source.version_number,
      status: source.status,
    },
  };
}
quizRoutes.post("/admin/quizzes/:id/duplicate", async (c) => {
  await adminMutation(c);
  const source = await c.env.DB.prepare(
    "SELECT v.id,v.title FROM quizzes q JOIN quiz_versions v ON v.id=coalesce((SELECT d.id FROM quiz_versions d WHERE d.quiz_id=q.id AND d.status='DRAFT'),q.published_version_id) WHERE q.id=?",
  )
    .bind(c.req.param("id"))
    .first<{ id: string; title: string }>();
  if (!source)
    throw new ApiError(
      409,
      "NO_SOURCE_VERSION",
      "Нет draft или текущей опубликованной версии для копирования",
    );
  const title = `${source.title} — копия`;
  const slug = await uniqueSlug(c.env.DB, title);
  return c.json(await cloneInto(c.env.DB, source.id, title, slug), 201);
});
