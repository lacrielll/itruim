import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  answerInputSchema,
  submitSchema,
  type AnswerInput,
} from "../shared/contracts";
import type { Bindings, Variables } from "./env";
import { requireStudent } from "./auth";
import { ApiError, normalizeText, now, shuffle, uuid, verifyCsrf } from "./lib";
import { loadVersion } from "./quizzes";
import { notificationStatements } from "./notifications";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const attemptRoutes = new Hono<AppEnv>();
type Attempt = {
  id: string;
  quiz_id: string;
  quiz_version_id: string;
  student_id: string;
  attempt_no: number;
  status: "STARTED" | "SUBMITTED" | "EXPIRED";
  started_at: number;
  expires_at: number;
  submitted_at: number | null;
  finalized_at: number | null;
  score: number | null;
  max_score: number;
  percent_bp: number | null;
  correct_answers: number | null;
  achievement_rule_id: string | null;
  double_failure_rule_id: string | null;
  retry_success_rule_id: string | null;
  question_order_json: string;
  option_order_json: string;
  quiz_publication_id: string | null;
  group_id: string | null;
};

async function studentMutation(c: any) {
  const s = await requireStudent(c);
  await verifyCsrf(c, s);
  return s;
}
async function owned(db: D1Database, id: string, studentId: string) {
  const a = await db
    .prepare("SELECT * FROM quiz_attempts WHERE id=? AND student_id=?")
    .bind(id, studentId)
    .first<Attempt>();
  if (!a) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Попытка не найдена");
  return a;
}

async function assertAttemptMembership(db: D1Database, a: Attempt, studentId: string) {
  if (!a.group_id) return;
  const membership = await db.prepare(
    "SELECT 1 FROM group_memberships WHERE student_id=? AND group_id=?",
  ).bind(studentId, a.group_id).first();
  if (!membership) throw new ApiError(403, "GROUP_FORBIDDEN", "Доступ к группе попытки отозван");
}

async function publicationAccess(db: D1Database, quizId: string, studentId: string) {
  return db.prepare(
    `SELECT p.*,
      (SELECT gm.group_id FROM group_memberships gm JOIN groups g ON g.id=gm.group_id
       WHERE gm.student_id=? AND g.course_run_id=p.course_run_id AND g.kind='lecture' AND
       (p.target_all_course_run=1 OR EXISTS(
         SELECT 1 FROM quiz_publication_groups pg WHERE pg.publication_id=p.id AND pg.group_id=gm.group_id
       )) ORDER BY g.kind,g.name LIMIT 1) group_id
     FROM quiz_publications p
     WHERE p.quiz_id=? AND p.is_active=1 AND EXISTS(
       SELECT 1 FROM group_memberships gm JOIN groups g ON g.id=gm.group_id
       WHERE gm.student_id=? AND g.course_run_id=p.course_run_id AND g.kind='lecture' AND
       (p.target_all_course_run=1 OR EXISTS(
         SELECT 1 FROM quiz_publication_groups pg WHERE pg.publication_id=p.id AND pg.group_id=gm.group_id
       ))
     ) ORDER BY p.created_at LIMIT 1`,
  ).bind(studentId, quizId, studentId).first<any>();
}

function publicVersion(v: any) {
  return {
    version_id: v.id,
    version_number: v.version_number,
    title: v.title,
    description: v.description,
    time_per_question_seconds: v.time_per_question_seconds,
    show_answer_review_after_submit: !!v.show_answer_review_after_submit,
    questions: v.questions.map((q: any) => ({
      id: q.id,
      position: q.position,
      type: q.type,
      text: q.text,
      points: q.points,
      ...(q.numeric ? { numeric_kind: q.numeric.numeric_kind } : {}),
      ...(q.options
        ? {
            options: q.options.map((o: any) => ({
              id: o.id,
              position: o.position,
              text: o.text,
            })),
          }
        : {}),
    })),
  };
}

async function hydrate(db: D1Database, a: Attempt) {
  if (a.status !== "STARTED") return resultPayload(db, a);
  const v: any = await loadVersion(db, a.quiz_version_id, false);
  const order: string[] = JSON.parse(a.question_order_json);
  const optionOrder: Record<string, string[]> = JSON.parse(a.option_order_json);
  const qmap = new Map(v.questions.map((q: any) => [q.id, q]));
  const questions = order
    .map((id) => {
      const q: any = qmap.get(id);
      if (q?.options) {
        const map = new Map(q.options.map((o: any) => [o.id, o]));
        return {
          ...q,
          options: (optionOrder[id] ?? q.options.map((o: any) => o.id))
            .map((oid: string) => map.get(oid))
            .filter(Boolean),
        };
      }
      return q;
    })
    .filter(Boolean);
  const answers = await db
    .prepare(
      "SELECT question_id,answer_json,updated_at FROM attempt_answers WHERE attempt_id=?",
    )
    .bind(a.id)
    .all<{ question_id: string; answer_json: string; updated_at: number }>();
  return {
    state: "ACTIVE",
    attempt: {
      id: a.id,
      attempt_no: a.attempt_no,
      status: a.status,
      started_at: a.started_at,
      expires_at: a.expires_at,
      max_score: a.max_score,
      version: { ...publicVersion(v), questions },
      answers: Object.fromEntries(
        answers.results.map((x) => [x.question_id, JSON.parse(x.answer_json)]),
      ),
    },
    server_now: now(),
  };
}

function parseNumeric(value: string, kind: "INTEGER" | "FLOAT") {
  const normalized = value
    .trim()
    .replaceAll("−", "-")
    .replaceAll(/\s/gu, "")
    .replaceAll(",", ".");
  const pattern =
    kind === "INTEGER"
      ? /^[+-]?\d+$/
      : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!pattern.test(normalized))
    throw new ApiError(
      400,
      "ANSWER_INVALID",
      kind === "INTEGER"
        ? "Введите целое число без дробной части"
        : "Введите корректное число",
    );
  const parsed = Number(normalized);
  if (
    !Number.isFinite(parsed) ||
    (kind === "INTEGER" && !Number.isInteger(parsed))
  )
    throw new ApiError(400, "ANSWER_INVALID", "Введите конечное число");
  return parsed;
}

function canonical(input: AnswerInput, numericValue?: number) {
  if (input.type === "SINGLE")
    return JSON.stringify({ optionId: input.optionId });
  if (input.type === "MULTIPLE")
    return JSON.stringify({ optionIds: [...new Set(input.optionIds)].sort() });
  if (input.type === "NUMERIC") return JSON.stringify({ value: numericValue! });
  return JSON.stringify({
    text: input.text,
    normalized: normalizeText(input.text),
  });
}

async function validateAnswer(
  db: D1Database,
  a: Attempt,
  qid: string,
  input: AnswerInput,
) {
  const q = await db
    .prepare("SELECT type FROM questions WHERE id=? AND quiz_version_id=?")
    .bind(qid, a.quiz_version_id)
    .first<{ type: string }>();
  if (!q || q.type !== input.type)
    throw new ApiError(400, "ANSWER_INVALID", "Ответ не соответствует вопросу");
  if (input.type === "SINGLE" || input.type === "MULTIPLE") {
    const ids =
      input.type === "SINGLE"
        ? [input.optionId]
        : [...new Set(input.optionIds)];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const row = await db
        .prepare(
          `SELECT count(*) n FROM question_options WHERE question_id=? AND id IN (${placeholders})`,
        )
        .bind(qid, ...ids)
        .first<{ n: number }>();
      if (row?.n !== ids.length)
        throw new ApiError(400, "ANSWER_INVALID", "Неизвестный вариант ответа");
    }
  }
  if (input.type === "NUMERIC") {
    const config = await db
      .prepare(
        "SELECT numeric_kind FROM numeric_answer_configs WHERE question_id=?",
      )
      .bind(qid)
      .first<{ numeric_kind: "INTEGER" | "FLOAT" }>();
    if (!config)
      throw new ApiError(400, "ANSWER_INVALID", "Не настроен числовой ответ");
    return canonical(input, parseNumeric(input.value, config.numeric_kind));
  }
  return canonical(input);
}

const correctExpression = `CASE q.type
 WHEN 'SINGLE' THEN EXISTS(SELECT 1 FROM question_options o WHERE o.question_id=q.id AND o.id=json_extract(aa.answer_json,'$.optionId') AND o.is_correct=1)
 WHEN 'MULTIPLE' THEN (SELECT count(*) FROM json_each(aa.answer_json,'$.optionIds'))=(SELECT count(*) FROM question_options o WHERE o.question_id=q.id AND o.is_correct=1) AND NOT EXISTS(SELECT 1 FROM json_each(aa.answer_json,'$.optionIds') j LEFT JOIN question_options o ON o.id=j.value AND o.question_id=q.id WHERE o.id IS NULL OR o.is_correct=0)
 WHEN 'NUMERIC' THEN CASE WHEN (SELECT numeric_kind FROM numeric_answer_configs n WHERE n.question_id=q.id)='INTEGER' THEN CAST(json_extract(aa.answer_json,'$.value') AS INTEGER)=json_extract(aa.answer_json,'$.value') AND CAST(json_extract(aa.answer_json,'$.value') AS INTEGER)=(SELECT CAST(correct_value AS INTEGER) FROM numeric_answer_configs n WHERE n.question_id=q.id) ELSE abs(CAST(json_extract(aa.answer_json,'$.value') AS REAL)-(SELECT correct_value FROM numeric_answer_configs n WHERE n.question_id=q.id)) <= (SELECT absolute_tolerance FROM numeric_answer_configs n WHERE n.question_id=q.id) END
 WHEN 'SHORT_TEXT' THEN EXISTS(SELECT 1 FROM short_answer_variants s WHERE s.question_id=q.id AND s.answer_normalized=json_extract(aa.answer_json,'$.normalized'))
 ELSE 0 END`;

function gradingStatement(
  db: D1Database,
  attemptId: string,
  studentId: string,
  timestamp: number,
  mode: "submit" | "expire",
) {
  const timeGuard =
    mode === "submit" ? "? < a.expires_at" : "? >= a.expires_at";
  return db
    .prepare(
      `WITH graded AS (SELECT aa.id,q.points,${correctExpression} correct FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id JOIN quiz_attempts a ON a.id=aa.attempt_id WHERE a.id=? AND a.student_id=? AND a.status='STARTED' AND ${timeGuard}) UPDATE attempt_answers SET is_correct=(SELECT correct FROM graded WHERE graded.id=attempt_answers.id),awarded_score=CASE WHEN (SELECT correct FROM graded WHERE graded.id=attempt_answers.id) THEN (SELECT points FROM graded WHERE graded.id=attempt_answers.id) ELSE 0 END,updated_at=? WHERE id IN(SELECT id FROM graded)`,
    )
    .bind(attemptId, studentId, timestamp, timestamp);
}
function finalAttemptStatement(
  db: D1Database,
  attemptId: string,
  studentId: string,
  timestamp: number,
  mode: "submit" | "expire",
) {
  const guard = mode === "submit" ? "? < expires_at" : "? >= expires_at";
  const status = mode === "submit" ? "SUBMITTED" : "EXPIRED";
  const score = `coalesce((SELECT sum(awarded_score) FROM attempt_answers WHERE attempt_id=quiz_attempts.id),0)`;
  const pct = `CAST(round((${score})*10000.0/max_score) AS INTEGER)`;
  const correctAnswers = `coalesce((SELECT sum(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) FROM attempt_answers WHERE attempt_id=quiz_attempts.id),0)`;
  const isDoubleFailure = `attempt_no=2 AND ${correctAnswers}<(SELECT success_barrier_correct_answers FROM quiz_versions WHERE id=quiz_attempts.quiz_version_id) AND EXISTS(SELECT 1 FROM double_failure_rules dfr WHERE dfr.quiz_version_id=quiz_attempts.quiz_version_id)`;
  const isRetrySuccess = `attempt_no=2 AND ${correctAnswers}>=(SELECT success_barrier_correct_answers FROM quiz_versions WHERE id=quiz_attempts.quiz_version_id) AND EXISTS(SELECT 1 FROM retry_success_rules rsr WHERE rsr.quiz_version_id=quiz_attempts.quiz_version_id)`;
  return db
    .prepare(
      `UPDATE quiz_attempts SET status='${status}',submitted_at=${mode === "submit" ? "?" : "NULL"},finalized_at=?,score=${score},percent_bp=${pct},correct_answers=${correctAnswers},achievement_rule_id=CASE WHEN ${isDoubleFailure} OR ${isRetrySuccess} THEN NULL ELSE (SELECT ar.id FROM achievement_rules ar WHERE ar.quiz_version_id=quiz_attempts.quiz_version_id AND ar.min_correct_answers<=${correctAnswers} ORDER BY ar.min_correct_answers DESC LIMIT 1) END,double_failure_rule_id=CASE WHEN ${isDoubleFailure} THEN (SELECT dfr.id FROM double_failure_rules dfr WHERE dfr.quiz_version_id=quiz_attempts.quiz_version_id) ELSE NULL END,retry_success_rule_id=CASE WHEN ${isRetrySuccess} THEN (SELECT rsr.id FROM retry_success_rules rsr WHERE rsr.quiz_version_id=quiz_attempts.quiz_version_id) ELSE NULL END,updated_at=? WHERE id=? AND student_id=? AND status='STARTED' AND ${guard}`,
    )
    .bind(
      ...(mode === "submit"
        ? [timestamp, timestamp, timestamp, attemptId, studentId, timestamp]
        : [timestamp, timestamp, attemptId, studentId, timestamp]),
    );
}

export async function finalize(
  db: D1Database,
  a: Attempt,
  studentId: string,
  mode: "submit" | "expire",
  snapshot?: Record<string, AnswerInput>,
) {
  const timestamp = now();
  const statements: D1PreparedStatement[] = [];
  if (mode === "submit") {
    statements.push(
      db
        .prepare(
          "DELETE FROM attempt_answers WHERE attempt_id=? AND EXISTS(SELECT 1 FROM quiz_attempts WHERE id=? AND student_id=? AND status='STARTED' AND ? < expires_at)",
        )
        .bind(a.id, a.id, studentId, timestamp),
    );
    if (timestamp < a.expires_at && snapshot) {
      for (const [qid, input] of Object.entries(snapshot)) {
        const value = await validateAnswer(db, a, qid, input);
        statements.push(
          db
            .prepare(
              "INSERT INTO attempt_answers(id,attempt_id,question_id,answer_json,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_attempts x JOIN questions q ON q.quiz_version_id=x.quiz_version_id WHERE x.id=? AND x.student_id=? AND x.status='STARTED' AND ? < x.expires_at AND q.id=?)",
            )
            .bind(
              uuid(),
              a.id,
              qid,
              value,
              timestamp,
              timestamp,
              a.id,
              studentId,
              timestamp,
              qid,
            ),
        );
      }
    }
  }
  const effectiveMode =
    mode === "submit" && timestamp < a.expires_at ? "submit" : "expire";
  statements.push(
    gradingStatement(db, a.id, studentId, timestamp, effectiveMode),
    finalAttemptStatement(db, a.id, studentId, timestamp, effectiveMode),
  );
  await db.batch(statements);
  const terminal = await owned(db, a.id, studentId);
  if (terminal.status === "STARTED")
    throw new ApiError(409, "ATTEMPT_CHANGED", "Попытка уже изменена");
  const quiz = await db.prepare("SELECT title FROM quizzes WHERE id=?").bind(terminal.quiz_id).first<{title:string}>();
  await db.batch(notificationStatements(db,{ id:uuid(),studentId,kind:"submission_result",title:`Результат теста «${quiz?.title ?? "Тест"}»`,message:`Правильных ответов: ${terminal.correct_answers}. Результат сохранён в личном кабинете.`,entityKind:"quiz_attempt",entityId:terminal.id,dedupeKey:`quiz-attempt:${terminal.id}:finalized`,timestamp }));
  return resultPayload(db, terminal);
}

async function maybeExpire(db: D1Database, a: Attempt, studentId: string) {
  if (a.status === "STARTED" && now() >= a.expires_at) {
    await finalize(db, a, studentId, "expire");
    return owned(db, a.id, studentId);
  }
  return a;
}

async function review(db: D1Database, a: Attempt) {
  const v = await db
    .prepare(
      "SELECT show_answer_review_after_submit FROM quiz_versions WHERE id=?",
    )
    .bind(a.quiz_version_id)
    .first<{ show_answer_review_after_submit: number }>();
  if (!v?.show_answer_review_after_submit) return undefined;
  const questions = await db
    .prepare(
      "SELECT id,type,text,points FROM questions WHERE quiz_version_id=? ORDER BY position",
    )
    .bind(a.quiz_version_id)
    .all<any>();
  const out = [];
  for (const q of questions.results) {
    const aa = await db
      .prepare(
        "SELECT answer_json,is_correct,awarded_score FROM attempt_answers WHERE attempt_id=? AND question_id=?",
      )
      .bind(a.id, q.id)
      .first<any>();
    let correct: any;
    if (q.type === "SINGLE" || q.type === "MULTIPLE")
      correct = (
        await db
          .prepare(
            "SELECT id,text FROM question_options WHERE question_id=? AND is_correct=1 ORDER BY position",
          )
          .bind(q.id)
          .all()
      ).results;
    else if (q.type === "NUMERIC")
      correct = await db
        .prepare(
          "SELECT correct_value,absolute_tolerance FROM numeric_answer_configs WHERE question_id=?",
        )
        .bind(q.id)
        .first();
    else
      correct = (
        await db
          .prepare(
            "SELECT answer_normalized FROM short_answer_variants WHERE question_id=?",
          )
          .bind(q.id)
          .all()
      ).results.map((x: any) => x.answer_normalized);
    out.push({
      question_id: q.id,
      question: q.text,
      student_answer: aa ? JSON.parse(aa.answer_json) : null,
      is_correct: !!aa?.is_correct,
      awarded_score: aa?.awarded_score ?? 0,
      correct_answer: correct,
    });
  }
  return out;
}

export async function resultPayload(db: D1Database, a: Attempt) {
  const achievement = a.retry_success_rule_id
    ? await db
        .prepare(
          "SELECT id,title,description,image_key,emoji,theme,accent_color,'RETRY_SUCCESS' kind FROM retry_success_rules WHERE id=?",
        )
        .bind(a.retry_success_rule_id)
        .first()
    : a.double_failure_rule_id
      ? await db
          .prepare(
            "SELECT id,title,description,image_key,emoji,theme,accent_color,'DOUBLE_FAILURE' kind FROM double_failure_rules WHERE id=?",
          )
          .bind(a.double_failure_rule_id)
          .first()
      : a.achievement_rule_id
        ? await db
            .prepare(
              "SELECT id,title,description,image_key,emoji,theme,accent_color,'THRESHOLD' kind FROM achievement_rules WHERE id=?",
            )
            .bind(a.achievement_rule_id)
            .first()
        : null;
  const quiz = await db
    .prepare(
      "SELECT published_version_id,opens_at,start_deadline_at FROM quizzes WHERE id=?",
    )
    .bind(a.quiz_id)
    .first<{
      published_version_id: string | null;
      opens_at: number | null;
      start_deadline_at: number | null;
    }>();
  const publication = a.quiz_publication_id
    ? await db.prepare("SELECT is_active,opens_at,start_deadline_at FROM quiz_publications WHERE id=?")
        .bind(a.quiz_publication_id).first<{ is_active: number; opens_at: number | null; start_deadline_at: number | null }>()
    : null;
  let eligible = false,
    available = false;
  if (a.attempt_no === 1 && a.status !== "STARTED") {
    const v = await db
      .prepare(
        "SELECT failure_barrier_enabled,success_barrier_correct_answers FROM quiz_versions WHERE id=?",
      )
      .bind(a.quiz_version_id)
      .first<{
        failure_barrier_enabled: number;
        success_barrier_correct_answers: number;
      }>();
    eligible =
      !!v?.failure_barrier_enabled &&
      a.correct_answers! < v!.success_barrier_correct_answers;
    const timestamp = now();
    available =
      eligible &&
      !!quiz?.published_version_id &&
      (!publication || !!publication.is_active) &&
      (!(publication?.opens_at ?? quiz.opens_at) || timestamp >= (publication?.opens_at ?? quiz.opens_at)!) &&
      (!(publication?.start_deadline_at ?? quiz.start_deadline_at) || timestamp < (publication?.start_deadline_at ?? quiz.start_deadline_at)!) &&
      !(await db
        .prepare(
          "SELECT 1 FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND attempt_no=2",
        )
        .bind(a.quiz_id, a.student_id)
        .first());
  }
  return {
    state: "RESULT",
    result: {
      attempt_id: a.id,
      attempt_no: a.attempt_no,
      status: a.status,
      score: a.score,
      max_score: a.max_score,
      percent_bp: a.percent_bp,
      correct_answers: a.correct_answers,
      question_count: JSON.parse(a.question_order_json).length,
      started_at: a.started_at,
      expires_at: a.expires_at,
      submitted_at: a.submitted_at,
      finalized_at: a.finalized_at,
      achievement,
      retry_eligible: eligible,
      retry_available: available,
      review: await review(db, a),
    },
    server_now: now(),
  };
}

async function createAttempt(
  db: D1Database,
  quiz: any,
  studentId: string,
  attemptNo: 1 | 2,
  versionId: string,
  publication?: any,
) {
  const v: any = await loadVersion(db, versionId, false);
  const timestamp = now();
  const opensAt = publication ? publication.opens_at : quiz.opens_at;
  const deadlineAt = publication ? publication.start_deadline_at : quiz.start_deadline_at;
  if (opensAt != null && timestamp < opensAt)
    throw new ApiError(409, "QUIZ_NOT_OPEN", "Тест ещё не открыт");
  if (deadlineAt != null && timestamp >= deadlineAt)
    throw new ApiError(409, "START_CLOSED", "Приём новых попыток завершён");
  const questionIds = v.questions.map((q: any) => q.id);
  const qorder = v.shuffle_questions ? shuffle(questionIds) : questionIds;
  const optionOrder: Record<string, string[]> = {};
  for (const q of v.questions)
    if (q.options) {
      const ids = q.options.map((o: any) => o.id);
      optionOrder[q.id] = v.shuffle_options ? shuffle(ids) : ids;
    }
  const duration = v.questions.length * v.time_per_question_seconds;
  const max = v.questions.reduce((s: number, q: any) => s + q.points, 0);
  const id = uuid();
  let result: D1Result;
  if (attemptNo === 1)
    result = await db
      .prepare(
        `INSERT INTO quiz_attempts(id,quiz_id,quiz_version_id,student_id,attempt_no,status,started_at,expires_at,max_score,question_order_json,option_order_json,created_at,updated_at,quiz_publication_id,group_id)
         SELECT ?,q.id,v.id,?,1,'STARTED',?,?,?,?,?,?,?,?,? FROM quizzes q JOIN quiz_versions v ON v.id=q.published_version_id
         WHERE q.id=? AND v.id=?
         AND (? IS NULL OR EXISTS(SELECT 1 FROM quiz_publications p JOIN group_memberships gm ON gm.group_id=? AND gm.student_id=? WHERE p.id=? AND p.quiz_id=q.id AND p.quiz_version_id=v.id AND p.is_active=1 AND (p.opens_at IS NULL OR ?>=p.opens_at) AND (p.start_deadline_at IS NULL OR ?<p.start_deadline_at)))
         AND (? IS NOT NULL OR ((q.opens_at IS NULL OR ?>=q.opens_at) AND (q.start_deadline_at IS NULL OR ?<q.start_deadline_at)))
         AND NOT EXISTS(SELECT 1 FROM quiz_attempts WHERE quiz_id=q.id AND student_id=? AND attempt_no=1)`,
      )
      .bind(
        id,
        studentId,
        timestamp,
        timestamp + duration,
        max,
        JSON.stringify(qorder),
        JSON.stringify(optionOrder),
        timestamp,
        timestamp,
        publication?.id ?? null,
        publication?.group_id ?? null,
        quiz.id,
        versionId,
        publication?.id ?? null,
        publication?.group_id ?? null,
        studentId,
        publication?.id ?? null,
        timestamp,
        timestamp,
        publication?.id ?? null,
        timestamp,
        timestamp,
        studentId,
      )
      .run();
  else
    result = await db
      .prepare(
        `INSERT INTO quiz_attempts(id,quiz_id,quiz_version_id,student_id,attempt_no,status,started_at,expires_at,max_score,question_order_json,option_order_json,created_at,updated_at,quiz_publication_id,group_id)
         SELECT ?,a.quiz_id,a.quiz_version_id,a.student_id,2,'STARTED',?,?,?,?,?,?,?,a.quiz_publication_id,a.group_id
         FROM quiz_attempts a JOIN quiz_versions v ON v.id=a.quiz_version_id JOIN quizzes q ON q.id=a.quiz_id
         LEFT JOIN quiz_publications p ON p.id=a.quiz_publication_id
         WHERE a.id=? AND a.student_id=? AND a.attempt_no=1 AND a.status IN('SUBMITTED','EXPIRED')
         AND q.published_version_id IS NOT NULL AND v.failure_barrier_enabled=1 AND a.correct_answers<v.success_barrier_correct_answers
         AND (a.quiz_publication_id IS NULL OR (p.is_active=1 AND (p.opens_at IS NULL OR ?>=p.opens_at) AND (p.start_deadline_at IS NULL OR ?<p.start_deadline_at) AND EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.student_id=a.student_id AND gm.group_id=a.group_id)))
         AND (a.quiz_publication_id IS NOT NULL OR ((q.opens_at IS NULL OR ?>=q.opens_at) AND (q.start_deadline_at IS NULL OR ?<q.start_deadline_at)))
         AND NOT EXISTS(SELECT 1 FROM quiz_attempts WHERE quiz_id=a.quiz_id AND student_id=a.student_id AND attempt_no=2)`,
      )
      .bind(
        id,
        timestamp,
        timestamp + duration,
        max,
        JSON.stringify(qorder),
        JSON.stringify(optionOrder),
        timestamp,
        timestamp,
        quiz.first_attempt_id,
        studentId,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();
  if (!result.meta.changes)
    throw new ApiError(409, "START_FORBIDDEN", "Новая попытка недоступна");
  return (await db
    .prepare("SELECT * FROM quiz_attempts WHERE id=?")
    .bind(id)
    .first<Attempt>())!;
}

attemptRoutes.get("/student/activities", async (c) => {
  const s = await requireStudent(c), timestamp = now();
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT q.id quiz_id,q.slug,v.title,v.description,p.id publication_id,
       p.opens_at,p.start_deadline_at,cr.name course_run_name,
       CASE WHEN a.status='STARTED' THEN 'ACTIVE' ELSE 'READY' END state,
       a.id attempt_id,a.expires_at
     FROM quiz_publications p JOIN quizzes q ON q.id=p.quiz_id
     JOIN quiz_versions v ON v.id=p.quiz_version_id
     JOIN course_runs cr ON cr.id=p.course_run_id
     JOIN group_memberships gm ON gm.student_id=?
     JOIN groups g ON g.id=gm.group_id AND g.course_run_id=p.course_run_id AND g.kind='lecture'
     LEFT JOIN quiz_attempts a ON a.quiz_id=q.id AND a.student_id=gm.student_id AND a.status='STARTED'
     WHERE p.is_active=1 AND q.published_version_id=p.quiz_version_id
       AND (p.target_all_course_run=1 OR EXISTS(SELECT 1 FROM quiz_publication_groups pg WHERE pg.publication_id=p.id AND pg.group_id=gm.group_id))
       AND ((p.opens_at IS NULL OR ?>=p.opens_at) AND (p.start_deadline_at IS NULL OR ?<p.start_deadline_at) OR a.id IS NOT NULL)
     ORDER BY cr.name,v.title`,
  ).bind(s.studentId!, timestamp, timestamp).all();
  return c.json({ items: rows.results, server_now: timestamp });
});

attemptRoutes.get("/student/quizzes/:slug/access", async (c) => {
  const s = await requireStudent(c);
  const quiz = await c.env.DB.prepare("SELECT * FROM quizzes WHERE slug=?")
    .bind(c.req.param("slug"))
    .first<any>();
  if (!quiz) throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
  const attempts = await c.env.DB.prepare(
    "SELECT * FROM quiz_attempts WHERE quiz_id=? AND student_id=? ORDER BY attempt_no DESC",
  )
    .bind(quiz.id, s.studentId!)
    .all<Attempt>();
  if (attempts.results[0]) {
    const a = attempts.results[0];
    await assertAttemptMembership(c.env.DB, a, s.studentId!);
    if (a.status === "STARTED")
      return c.json(
        await hydrate(
          c.env.DB,
          (await maybeExpire(c.env.DB, a, s.studentId!)) as Attempt,
        ),
      );
    return c.json(await resultPayload(c.env.DB, a));
  }
  if (!quiz.published_version_id) return c.json({ state: "NOT_AVAILABLE" });
  const publicationCount = await c.env.DB.prepare("SELECT count(*) n FROM quiz_publications WHERE quiz_id=?")
    .bind(quiz.id).first<{ n: number }>();
  const publication = publicationCount?.n ? await publicationAccess(c.env.DB, quiz.id, s.studentId!) : null;
  if (publicationCount?.n && !publication) return c.json({ state: "NOT_AVAILABLE" });
  const v: any = await loadVersion(c.env.DB, quiz.published_version_id, false);
  const timestamp = now();
  const opensAt = publication ? publication.opens_at : quiz.opens_at;
  const deadlineAt = publication ? publication.start_deadline_at : quiz.start_deadline_at;
  if (opensAt != null && timestamp < opensAt)
    return c.json({
      state: "NOT_OPEN",
      opens_at: opensAt,
      start_deadline_at: deadlineAt,
      server_now: timestamp,
    });
  if (deadlineAt != null && timestamp >= deadlineAt)
    return c.json({
      state: "START_CLOSED",
      start_deadline_at: deadlineAt,
      server_now: timestamp,
    });
  return c.json({
    state: "READY",
    quiz: {
      id: quiz.id,
      slug: quiz.slug,
      title: v.title,
      description: v.description,
      question_count: v.questions.length,
      total_time_seconds: v.questions.length * v.time_per_question_seconds,
      shuffle_questions: !!v.shuffle_questions,
      shuffle_options: !!v.shuffle_options,
      opens_at: opensAt,
      start_deadline_at: deadlineAt,
    },
    server_now: timestamp,
  });
});

attemptRoutes.post("/student/quizzes/:slug/attempts", async (c) => {
  const s = await studentMutation(c);
  const quiz = await c.env.DB.prepare("SELECT * FROM quizzes WHERE slug=?")
    .bind(c.req.param("slug"))
    .first<any>();
  if (!quiz || !quiz.published_version_id)
    throw new ApiError(404, "QUIZ_NOT_FOUND", "Тест не найден");
  const existing = await c.env.DB.prepare(
    "SELECT * FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND attempt_no=1",
  )
    .bind(quiz.id, s.studentId!)
    .first<Attempt>();
  if (existing) {
    await assertAttemptMembership(c.env.DB, existing, s.studentId!);
    return c.json(await hydrate(c.env.DB, existing));
  }
  const publicationCount = await c.env.DB.prepare("SELECT count(*) n FROM quiz_publications WHERE quiz_id=?")
    .bind(quiz.id).first<{ n: number }>();
  const publication = publicationCount?.n ? await publicationAccess(c.env.DB, quiz.id, s.studentId!) : null;
  if (publicationCount?.n && !publication) throw new ApiError(403, "QUIZ_FORBIDDEN", "Тест не назначен вашим группам");
  try {
    const a = await createAttempt(
      c.env.DB,
      quiz,
      s.studentId!,
      1,
      quiz.published_version_id,
      publication,
    );
    return c.json(await hydrate(c.env.DB, a), 201);
  } catch (error) {
    const winner = await c.env.DB.prepare(
      "SELECT * FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND attempt_no=1",
    )
      .bind(quiz.id, s.studentId!)
      .first<Attempt>();
    if (winner) {
      await assertAttemptMembership(c.env.DB, winner, s.studentId!);
      return c.json(await hydrate(c.env.DB, winner));
    }
    throw error;
  }
});
attemptRoutes.get("/student/attempts/:id", async (c) => {
  const s = await requireStudent(c);
  let a = await owned(c.env.DB, c.req.param("id"), s.studentId!);
  await assertAttemptMembership(c.env.DB, a, s.studentId!);
  if (a.status === "STARTED" && now() >= a.expires_at) {
    await finalize(c.env.DB, a, s.studentId!, "expire");
    a = await owned(c.env.DB, a.id, s.studentId!);
  }
  return c.json(await hydrate(c.env.DB, a));
});
attemptRoutes.put(
  "/student/attempts/:id/answers/:qid",
  zValidator("json", answerInputSchema),
  async (c) => {
    const s = await studentMutation(c);
    const a = await owned(c.env.DB, c.req.param("id"), s.studentId!);
    await assertAttemptMembership(c.env.DB, a, s.studentId!);
    const timestamp = now();
    if (a.status !== "STARTED" || timestamp >= a.expires_at) {
      if (a.status === "STARTED")
        await finalize(c.env.DB, a, s.studentId!, "expire");
      throw new ApiError(409, "ATTEMPT_TERMINAL", "Время попытки истекло");
    }
    const value = await validateAnswer(
      c.env.DB,
      a,
      c.req.param("qid"),
      c.req.valid("json"),
    );
    const res = await c.env.DB.prepare(
      `INSERT INTO attempt_answers(id,attempt_id,question_id,answer_json,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_attempts x JOIN questions q ON q.quiz_version_id=x.quiz_version_id WHERE x.id=? AND x.student_id=? AND x.status='STARTED' AND ? < x.expires_at AND q.id=?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET answer_json=excluded.answer_json,is_correct=NULL,awarded_score=NULL,updated_at=excluded.updated_at WHERE EXISTS(SELECT 1 FROM quiz_attempts WHERE id=excluded.attempt_id AND status='STARTED' AND ? < expires_at)`,
    )
      .bind(
        uuid(),
        a.id,
        c.req.param("qid"),
        value,
        timestamp,
        timestamp,
        a.id,
        s.studentId!,
        timestamp,
        c.req.param("qid"),
        timestamp,
      )
      .run();
    if (!res.meta.changes)
      throw new ApiError(
        409,
        "ATTEMPT_TERMINAL",
        "Ответ больше нельзя изменить",
      );
    return c.json({ saved_at: timestamp });
  },
);
attemptRoutes.delete("/student/attempts/:id/answers/:qid", async (c) => {
  const s = await studentMutation(c);
  const a = await owned(c.env.DB, c.req.param("id"), s.studentId!);
  await assertAttemptMembership(c.env.DB, a, s.studentId!);
  const timestamp = now();
  if (a.status !== "STARTED" || timestamp >= a.expires_at) {
    if (a.status === "STARTED")
      await finalize(c.env.DB, a, s.studentId!, "expire");
    throw new ApiError(409, "ATTEMPT_TERMINAL", "Время попытки истекло");
  }
  const belongs = await c.env.DB.prepare(
    "SELECT 1 FROM questions WHERE id=? AND quiz_version_id=?",
  )
    .bind(c.req.param("qid"), a.quiz_version_id)
    .first();
  if (!belongs)
    throw new ApiError(400, "ANSWER_INVALID", "Вопрос не относится к попытке");
  await c.env.DB.prepare(
    "DELETE FROM attempt_answers WHERE attempt_id=? AND question_id=? AND EXISTS(SELECT 1 FROM quiz_attempts WHERE id=? AND student_id=? AND status='STARTED' AND ? < expires_at)",
  )
    .bind(a.id, c.req.param("qid"), a.id, s.studentId!, timestamp)
    .run();
  return c.json({ saved_at: timestamp });
});
attemptRoutes.post(
  "/student/attempts/:id/submit",
  zValidator("json", submitSchema),
  async (c) => {
    const s = await studentMutation(c);
    const a = await owned(c.env.DB, c.req.param("id"), s.studentId!);
    await assertAttemptMembership(c.env.DB, a, s.studentId!);
    if (a.status !== "STARTED") return c.json(await resultPayload(c.env.DB, a));
    return c.json(
      await finalize(
        c.env.DB,
        a,
        s.studentId!,
        "submit",
        c.req.valid("json").answers,
      ),
    );
  },
);
attemptRoutes.post("/student/attempts/:id/retry", async (c) => {
  const s = await studentMutation(c);
  let first = await owned(c.env.DB, c.req.param("id"), s.studentId!);
  await assertAttemptMembership(c.env.DB, first, s.studentId!);
  if (first.status === "STARTED" && now() >= first.expires_at) {
    await finalize(c.env.DB, first, s.studentId!, "expire");
    first = await owned(c.env.DB, first.id, s.studentId!);
  }
  if (first.attempt_no !== 1 || first.status === "STARTED")
    throw new ApiError(409, "RETRY_FORBIDDEN", "Повторная попытка недоступна");
  const existing = await c.env.DB.prepare(
    "SELECT * FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND attempt_no=2",
  )
    .bind(first.quiz_id, s.studentId!)
    .first<Attempt>();
  if (existing) return c.json(await hydrate(c.env.DB, existing));
  const quiz = await c.env.DB.prepare(
    "SELECT *,? first_attempt_id FROM quizzes WHERE id=?",
  )
    .bind(first.id, first.quiz_id)
    .first<any>();
  try {
    const a = await createAttempt(
      c.env.DB,
      quiz,
      s.studentId!,
      2,
      first.quiz_version_id,
    );
    return c.json(await hydrate(c.env.DB, a), 201);
  } catch (error) {
    const winner = await c.env.DB.prepare(
      "SELECT * FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND attempt_no=2",
    )
      .bind(first.quiz_id, s.studentId!)
      .first<Attempt>();
    if (winner) return c.json(await hydrate(c.env.DB, winner));
    throw error;
  }
});

export async function expireOverdue(db: D1Database, limit = 50) {
  const rows = await db
    .prepare(
      "SELECT * FROM quiz_attempts WHERE status='STARTED' AND expires_at<=? ORDER BY expires_at LIMIT ?",
    )
    .bind(now(), limit)
    .all<Attempt>();
  let count = 0;
  for (const a of rows.results) {
    try {
      await finalize(db, a, a.student_id, "expire");
      count++;
    } catch (e) {
      console.error("expire_failed", a.id, String(e));
    }
  }
  return count;
}
