import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { resultFiltersSchema } from "../shared/contracts";
import type { Bindings, Variables } from "./env";
import { requireAdmin } from "./auth";
import { requireTeacherGroupKind } from "./groups";
import { ApiError, verifyCsrf } from "./lib";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const resultRoutes = new Hono<AppEnv>();
const baseQuery = `SELECT a.*,json_array_length(a.question_order_json) question_count,s.student_code,s.fio_display,q.title quiz_title,v.version_number,coalesce(rsr.title,dfr.title,ar.title) achievement_title FROM quiz_attempts a JOIN students s ON s.id=a.student_id JOIN quizzes q ON q.id=a.quiz_id JOIN quiz_versions v ON v.id=a.quiz_version_id LEFT JOIN achievement_rules ar ON ar.id=a.achievement_rule_id LEFT JOIN double_failure_rules dfr ON dfr.id=a.double_failure_rule_id LEFT JOIN retry_success_rules rsr ON rsr.id=a.retry_success_rule_id`;

function bestRows(rows: any[]) {
  const grouped = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.quiz_id}:${r.student_id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }
  return [...grouped.values()].map((attempts) => {
    const first = attempts.find((r) => r.attempt_no === 1);
    const retry = attempts.find((r) => r.attempt_no === 2);
    const best = [...attempts].sort(
      (a, b) =>
        (b.percent_bp ?? -1) - (a.percent_bp ?? -1) ||
        b.attempt_no - a.attempt_no,
    )[0];
    const outcome =
      retry?.double_failure_rule_id || retry?.retry_success_rule_id
        ? retry
        : best;
    return {
      ...best,
      achievement_rule_id: outcome?.achievement_rule_id ?? null,
      double_failure_rule_id: outcome?.double_failure_rule_id ?? null,
      retry_success_rule_id: outcome?.retry_success_rule_id ?? null,
      achievement_title: outcome?.achievement_title ?? null,
      first_score: first?.score ?? null,
      retry_score: retry?.score ?? null,
      best_score: best?.score ?? null,
      first_percent_bp: first?.percent_bp ?? null,
      retry_percent_bp: retry?.percent_bp ?? null,
      best_percent_bp: best?.percent_bp ?? null,
    };
  });
}
function stats(values: number[]) {
  if (!values.length)
    return {
      mean: null,
      median: null,
      standard_deviation: null,
      min: null,
      max: null,
    };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return {
    mean,
    median,
    standard_deviation: Math.sqrt(
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length,
    ),
    min: sorted[0],
    max: sorted.at(-1),
  };
}
function filtered(rows: any[], f: any) {
  return rows.filter(
    (r) =>
      (!f.quiz_id || r.quiz_id === f.quiz_id) &&
      (!f.version_id || r.quiz_version_id === f.version_id) &&
      (!f.student ||
        r.student_code.includes(f.student.toUpperCase()) ||
        r.fio_display
          .toLocaleLowerCase("ru")
          .includes(f.student.toLocaleLowerCase("ru"))) &&
      (!f.attempt_no || r.attempt_no === f.attempt_no) &&
      (f.min_percent_bp == null || r.percent_bp >= f.min_percent_bp) &&
      (f.max_percent_bp == null || r.percent_bp <= f.max_percent_bp) &&
      (!f.achievement_id ||
        r.achievement_rule_id === f.achievement_id ||
        r.double_failure_rule_id === f.achievement_id ||
        r.retry_success_rule_id === f.achievement_id),
  );
}

resultRoutes.get(
  "/admin/results",
  zValidator("query", resultFiltersSchema),
  async (c) => {
    await requireAdmin(c);
    const f = c.req.valid("query");
    let rows = (
      await c.env.DB.prepare(
        `${baseQuery} WHERE a.status IN('SUBMITTED','EXPIRED') ORDER BY coalesce(a.finalized_at,0) DESC`,
      ).all()
    ).results as any[];
    rows = filtered(rows, f);
    if (f.view === "best") rows = bestRows(rows);
    const total = rows.length;
    rows = rows.slice(f.offset, f.offset + f.limit).map((r) => {
      if (f.include_names === "true") return r;
      const { fio_display: _name, ...safe } = r;
      return safe;
    });
    return c.json({ items: rows, total, limit: f.limit, offset: f.offset });
  },
);

async function teacherGradebook(db: D1Database, groupId: string) {
  const students = (await db.prepare(
    `SELECT s.id,s.fio_display,s.student_code FROM group_memberships gm
     JOIN students s ON s.id=gm.student_id WHERE gm.group_id=? ORDER BY s.fio_normalized`,
  ).bind(groupId).all<any>()).results;
  const attempts = (await db.prepare(
    `${baseQuery} JOIN group_memberships gm ON gm.student_id=a.student_id
     WHERE gm.group_id=? AND a.status IN('SUBMITTED','EXPIRED')
     ORDER BY q.title,s.fio_normalized,a.attempt_no`,
  ).bind(groupId).all<any>()).results;
  const best = bestRows(attempts);
  const quizzes = [...new Map(attempts.map((row: any) => [row.quiz_id, { id: row.quiz_id, title: row.quiz_title }])).values()];
  return { students, quizzes, attempts, best };
}

resultRoutes.get("/teacher/groups/:groupId/quiz-gradebook", async (c) => {
  const groupId = c.req.param("groupId");
  await requireTeacherGroupKind(c, groupId, "lecture");
  return c.json(await teacherGradebook(c.env.DB, groupId));
});

resultRoutes.get("/teacher/groups/:groupId/quiz-gradebook.csv", async (c) => {
  const groupId = c.req.param("groupId");
  await requireTeacherGroupKind(c, groupId, "lecture");
  const data = await teacherGradebook(c.env.DB, groupId);
  const byStudentQuiz = new Map(data.best.map((row: any) => [`${row.student_id}:${row.quiz_id}`, row]));
  const header: unknown[] = ["ФИО", "Код студента"];
  for (const quiz of data.quizzes as any[]) header.push(`${quiz.title}: первая`, `${quiz.title}: повторная`, `${quiz.title}: лучшая`, `${quiz.title}: максимум`, `${quiz.title}: лучший %`);
  const rows = (data.students as any[]).map((student) => {
    const row: unknown[] = [student.fio_display, student.student_code];
    for (const quiz of data.quizzes as any[]) {
      const result: any = byStudentQuiz.get(`${student.id}:${quiz.id}`);
      row.push(result?.first_score ?? "", result?.retry_score ?? "", result?.best_score ?? "", result?.max_score ?? "", result ? (result.best_percent_bp / 100).toFixed(2) : "");
    }
    return row;
  });
  return csvResponse([header, ...rows], `quiz-gradebook-${groupId}.csv`);
});

resultRoutes.get("/admin/students", async (c) => {
  await requireAdmin(c);
  const include = c.req.query("include_names") === "true";
  const search = c.req.query("q") ?? "";
  const rows = await c.env.DB.prepare(
    `SELECT id,student_code${include ? ",fio_display" : ""},created_at FROM students WHERE student_code LIKE ? OR fio_normalized LIKE ? ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(`%${search.toUpperCase()}%`, `%${search.toLocaleLowerCase("ru")}%`)
    .all();
  return c.json({ items: rows.results });
});
resultRoutes.post("/admin/students/:id/code-view", async (c) => {
  const s = await requireAdmin(c);
  await verifyCsrf(c, s);
  const row = await c.env.DB.prepare(
    "SELECT student_code,fio_display FROM students WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!row) throw new ApiError(404, "STUDENT_NOT_FOUND", "Студент не найден");
  return c.json(row);
});
resultRoutes.get("/admin/students/:id/history", async (c) => {
  await requireAdmin(c);
  const student = await c.env.DB.prepare(
    "SELECT id,student_code,fio_display FROM students WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!student)
    throw new ApiError(404, "STUDENT_NOT_FOUND", "Студент не найден");
  const rows = await c.env.DB.prepare(
    `${baseQuery} WHERE a.student_id=? AND a.status IN('SUBMITTED','EXPIRED') ORDER BY a.finalized_at DESC`,
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ student, attempts: rows.results });
});

resultRoutes.get("/admin/quizzes/:id/analytics", async (c) => {
  await requireAdmin(c);
  const mode = c.req.query("mode") ?? "first_attempts";
  if (
    !["first_attempts", "all_attempts", "best_attempt_per_student"].includes(
      mode,
    )
  )
    throw new ApiError(400, "MODE_INVALID", "Неизвестный режим аналитики");
  const all = (
    await c.env.DB.prepare(
      `${baseQuery} WHERE a.quiz_id=? AND a.status IN('SUBMITTED','EXPIRED') ORDER BY a.attempt_no`,
    )
      .bind(c.req.param("id"))
      .all()
  ).results as any[];
  const selected =
    mode === "first_attempts"
      ? all.filter((a) => a.attempt_no === 1)
      : mode === "best_attempt_per_student"
        ? bestRows(all)
        : all;
  const achievements = new Map<string, number>();
  for (const a of selected)
    achievements.set(
      a.achievement_title ?? "Без достижения",
      (achievements.get(a.achievement_title ?? "Без достижения") ?? 0) + 1,
    );
  const participantCount = new Set(all.map((a) => a.student_id)).size;
  const questionRows = (
    await c.env.DB.prepare(
      "SELECT id,quiz_version_id,text,type,position FROM questions WHERE quiz_version_id IN(SELECT id FROM quiz_versions WHERE quiz_id=?) ORDER BY quiz_version_id,position",
    )
      .bind(c.req.param("id"))
      .all()
  ).results as any[];
  const questions = [];
  for (const q of questionRows) {
    const relevant = selected.filter(
      (a) => a.quiz_version_id === q.quiz_version_id,
    );
    const ids = relevant.map((a) => a.id);
    const answerRows = ids.length
      ? ((
          await c.env.DB.prepare(
            `SELECT aa.answer_json,aa.is_correct FROM attempt_answers aa WHERE aa.question_id=? AND aa.attempt_id IN(${ids.map(() => "?").join(",")})`,
          )
            .bind(q.id, ...ids)
            .all()
        ).results as any[])
      : [];
    const correct = answerRows.filter((a) => a.is_correct === 1).length;
    let optionDistribution: any[] = [];
    if (q.type === "SINGLE" || q.type === "MULTIPLE") {
      const counts: Record<string, number> = {};
      for (const a of answerRows) {
        const parsed = JSON.parse(a.answer_json);
        for (const id of parsed.optionIds ??
          (parsed.optionId ? [parsed.optionId] : []))
          counts[id] = (counts[id] ?? 0) + 1;
      }
      const options = (
        await c.env.DB.prepare(
          "SELECT id,text,position FROM question_options WHERE question_id=? ORDER BY position",
        )
          .bind(q.id)
          .all()
      ).results as any[];
      optionDistribution = options.map((o) => ({
        ...o,
        count: counts[o.id] ?? 0,
      }));
    }
    questions.push({
      question_id: q.id,
      quiz_version_id: q.quiz_version_id,
      text: q.text,
      type: q.type,
      total: relevant.length,
      correct,
      incorrect: answerRows.length - correct,
      unanswered: relevant.length - answerRows.length,
      correct_percent: relevant.length
        ? Math.round((correct * 10000) / relevant.length)
        : 0,
      option_distribution: optionDistribution,
    });
  }
  return c.json({
    mode,
    participants_count: participantCount,
    submitted_count: all.filter((a) => a.status === "SUBMITTED").length,
    expired_count: all.filter((a) => a.status === "EXPIRED").length,
    retries_count: all.filter((a) => a.attempt_no === 2).length,
    ...stats(selected.map((a) => a.percent_bp)),
    achievement_distribution: Object.fromEntries(achievements),
    questions,
  });
});

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csvResponse(rows: unknown[][], filename: string) {
  const body =
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
resultRoutes.get("/admin/exports/summary.csv", async (c) => {
  await requireAdmin(c);
  const rows = (
    await c.env.DB.prepare(
      `${baseQuery} WHERE a.status IN('SUBMITTED','EXPIRED') ORDER BY q.title,s.student_code,a.attempt_no`,
    ).all()
  ).results as any[];
  return csvResponse(
    [
      [
        "student_code",
        "fio",
        "quiz",
        "quiz_version",
        "attempt",
        "score",
        "max_score",
        "percent",
        "achievement",
        "started_at",
        "submitted_at",
        "status",
      ],
      ...rows.map((r) => [
        r.student_code,
        r.fio_display,
        r.quiz_title,
        r.version_number,
        r.attempt_no,
        r.score,
        r.max_score,
        (r.percent_bp / 100).toFixed(2),
        r.achievement_title,
        r.started_at,
        r.submitted_at,
        r.status,
      ]),
    ],
    "quiz-summary.csv",
  );
});
resultRoutes.get("/admin/exports/questions.csv", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT s.student_code,qz.title quiz,v.version_number,a.attempt_no,q.id question_id,q.text question_text,aa.answer_json,aa.is_correct,coalesce(aa.awarded_score,0) awarded_score FROM quiz_attempts a JOIN students s ON s.id=a.student_id JOIN quiz_versions v ON v.id=a.quiz_version_id JOIN quizzes qz ON qz.id=a.quiz_id JOIN questions q ON q.quiz_version_id=a.quiz_version_id LEFT JOIN attempt_answers aa ON aa.attempt_id=a.id AND aa.question_id=q.id WHERE a.status IN('SUBMITTED','EXPIRED') ORDER BY qz.title,s.student_code,a.attempt_no,q.position`,
  ).all<any>();
  return csvResponse(
    [
      [
        "student_code",
        "quiz",
        "quiz_version",
        "attempt",
        "question_id",
        "question_text",
        "answer",
        "is_correct",
        "awarded_score",
      ],
      ...rows.results.map((r) => [
        r.student_code,
        r.quiz,
        r.version_number,
        r.attempt_no,
        r.question_id,
        r.question_text,
        r.answer_json,
        r.is_correct,
        r.awarded_score,
      ]),
    ],
    "quiz-questions.csv",
  );
});
