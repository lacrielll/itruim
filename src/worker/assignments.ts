import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  assignmentCreateSchema,
  assignmentPublicationSchema,
  assignmentVersionSchema,
  clarificationAnswerSchema,
  courseAchievementCreateSchema,
  courseAchievementAwardSchema,
  assignmentAchievementBindingsSchema,
  teacherSubmissionDecisionSchema,
  cooldownOverrideSchema,
  duplicateDecisionSchema,
  graderClaimSchema,
  graderHeartbeatSchema,
  graderLlmInitialSchema,
  graderLlmFollowupSchema,
  graderInfraFailureSchema,
  graderSecurityEventsSchema,
  graderProgressSchema,
  graderReadinessSchema,
  graderWorkerCreateSchema,
  gradingResultSchema,
  submissionCreateSchema,
} from "../shared/contracts";

export const SUBMISSION_POLICY = {
  version: "2026-09-16-v1",
  title: "Перед отправкой работы",
  paragraphs: [
    "Код из выбранного commit будет автоматически загружен и выполнен в изолированной среде проверки.",
    "Используйте среду только для выполнения задания. Запрещены попытки обхода ограничений sandbox, доступа к инфраструктуре платформы, данным других пользователей, файлам и процессам host-системы, сети и иным не предоставленным ресурсам.",
    "Для обеспечения безопасности платформа сохраняет отправленный исходный код, результаты статического анализа и технические события выполнения и связывает их с вашей учётной записью. Подозрительные действия могут быть переданы преподавателю и администрации и повлечь меры по правилам университета и применимому законодательству.",
  ],
  acknowledgement: "Я прочитал(а) условия и подтверждаю, что отправляю код только для выполнения задания.",
} as const;
import type { Bindings, Variables } from "./env";
import { requireAdmin, requireStudent, requireTeacher } from "./auth";
import { requireTeacherGroupKind } from "./groups";
import { ApiError, normalizeText, now, randomToken, reservedSlugs, secureEqual, sha256, slugify, uuid, validateSlug, verifyCsrf } from "./lib";
import { notificationStatements } from "./notifications";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const assignmentRoutes = new Hono<AppEnv>();

export function enforceCriticalGate<T extends { checks: any[]; public_diagnostics: any[]; deterministic_gate: "passed" | "failed"; llm_eligible: boolean }>(received: T): T {
  const hasCritical = received.checks.some((check) => check.severity === "critical" && (check.passed === false || check.status === "failed"))
    || received.public_diagnostics.some((diagnostic) => diagnostic.severity === "critical");
  return hasCritical ? { ...received, deterministic_gate: "failed", llm_eligible: false } : received;
}

export function achievementNominationStatus(source: string): "accepted" | "pending_teacher" {
  return source.split(":", 1)[0] === "llm" ? "pending_teacher" : "accepted";
}

export function graderInfrastructureRetryDelaySeconds(retryCount: number): number {
  const exponent = Math.min(Math.max(Math.trunc(retryCount) - 1, 0), 8);
  return Math.min(3600, 15 * 2 ** exponent);
}

async function adminMutation(c: any) { const s = await requireAdmin(c); await verifyCsrf(c, s); return s; }
async function studentMutation(c: any) { const s = await requireStudent(c); await verifyCsrf(c, s); return s; }
async function teacherMutation(c: any) { const s = await requireTeacher(c); await verifyCsrf(c, s); return s; }
const json = (value: unknown) => JSON.stringify(value);

async function llmAchievementStatements(db: D1Database, submissionId: string, result: any, stage: string, timestamp: number) {
  const nominations = Array.isArray(result?.achievement_nominations) ? result.achievement_nominations : [];
  if (!nominations.length) return [] as D1PreparedStatement[];
  const context = await db.prepare(
    `SELECT sub.student_id,sub.assignment_version_id,av.assignment_id,ap.course_run_id,av.achievement_definitions_json
     FROM submissions sub JOIN assignment_versions av ON av.id=sub.assignment_version_id
     JOIN assignment_publications ap ON ap.id=sub.assignment_publication_id WHERE sub.id=?`,
  ).bind(submissionId).first<any>();
  const definitions = new Map<string, any>((JSON.parse(context.achievement_definitions_json) as any[]).map((item) => [item.id, item]));
  const statements: D1PreparedStatement[] = [];
  for (const nomination of nominations.slice(0, 20)) {
    const definition = definitions.get(nomination?.achievement_id);
    const evidenceIds = Array.isArray(nomination?.evidence_ids) ? nomination.evidence_ids.filter((item: any) => typeof item === "string").slice(0, 100) : [];
    if (!definition || !definition.allowed_sources.includes("llm") || !evidenceIds.length) continue;
    const status = "pending_teacher", source = `llm:${stage}`, reason = "llm_evidence_nomination";
    statements.push(db.prepare(
      `INSERT INTO assignment_achievement_nominations(id,submission_id,achievement_id,source,reason_code,evidence_ids_json,status,created_at)
       VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(submission_id,achievement_id,source,reason_code) DO NOTHING`,
    ).bind(uuid(), submissionId, nomination.achievement_id, source, reason, json(evidenceIds), status, timestamp));
  }
  return statements;
}

async function completionAchievementStatements(db: D1Database, submissionId: string, decisionId: string, action: string, timestamp: number) {
  const context = await db.prepare(
    `SELECT sub.student_id,sub.assignment_version_id,av.assignment_id,av.achievement_definitions_json,ap.course_run_id,cr.course_id
     FROM submissions sub JOIN assignment_versions av ON av.id=sub.assignment_version_id
     JOIN assignment_publications ap ON ap.id=sub.assignment_publication_id JOIN course_runs cr ON cr.id=ap.course_run_id WHERE sub.id=?`,
  ).bind(submissionId).first<any>();
  const statements: D1PreparedStatement[] = [];
  for (const definition of JSON.parse(context.achievement_definitions_json) as any[]) {
    const trigger = definition.trigger ?? {}, actions = Array.isArray(trigger.actions) ? trigger.actions : null;
    if (!definition.allowed_sources.includes("platform") || trigger.source !== "platform" || trigger.event !== "submission.finalized" || (actions && !actions.includes(action))) continue;
    const evidenceIds = [`teacher_decision:${decisionId}`], source = "platform:submission.finalized", reason = "submission_finalized";
    statements.push(db.prepare(
      `INSERT INTO assignment_achievement_nominations(id,submission_id,achievement_id,source,reason_code,evidence_ids_json,status,created_at)
       VALUES(?,?,?,?,?,?,'accepted',?) ON CONFLICT(submission_id,achievement_id,source,reason_code) DO NOTHING`,
    ).bind(uuid(), submissionId, definition.id, source, reason, json(evidenceIds), timestamp));
    const idempotencyKey = definition.repeatability === "once_global" ? `${context.student_id}:${definition.id}`
      : definition.repeatability === "once_per_course" ? `${context.student_id}:${context.course_id}:${definition.id}`
      : definition.repeatability === "once_per_course_run" ? `${context.student_id}:${context.course_run_id}:${definition.id}`
      : definition.repeatability === "once_per_assignment" ? `${context.student_id}:${context.assignment_id}:${definition.id}`
      : `${submissionId}:${definition.id}:${source}:${reason}`;
    statements.push(db.prepare(
      `INSERT INTO assignment_achievement_awards(id,student_id,submission_id,assignment_version_id,course_run_id,achievement_id,namespace,
       definition_snapshot_json,evidence_ids_json,source,reason_code,idempotency_key,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    ).bind(uuid(), context.student_id, submissionId, context.assignment_version_id, context.course_run_id, definition.id,
      definition.id.slice(0, definition.id.lastIndexOf("/")), json(definition), json(evidenceIds), source, reason, idempotencyKey, timestamp));
  }
  return statements;
}
function studentSubmission(row: any) {
  const { request_hash: _requestHash, repo_identity: _repoIdentity, duplicate_of_submission_id: _duplicate, ...safe } = row;
  return safe;
}

function revision(header: string | undefined) {
  const value = Number(header?.replaceAll('"', ""));
  if (!Number.isInteger(value) || value < 1) throw new ApiError(428, "REVISION_REQUIRED", "Требуется корректный If-Match");
  return value;
}

async function catalogAchievementSnapshot(db: D1Database, version: any) {
  const rows = await db.prepare(
    `SELECT ca.definition_json,ca.applicability_scope,ca.required_capability,
      EXISTS(SELECT 1 FROM assignment_achievement_bindings aab WHERE aab.achievement_id=ca.id AND aab.assignment_id=?) bound
     FROM course_achievements ca JOIN assignments a ON a.course_id=ca.course_id
     WHERE a.id=? AND ca.definition_json IS NOT NULL ORDER BY ca.created_at`,
  ).bind(version.assignment_id, version.assignment_id).all<any>();
  if (!rows.results.length) return null;
  const llm = JSON.parse(version.llm_pipeline_json || "{}");
  const hasGrader = Boolean(version.grader_repository && version.grader_entrypoint);
  return rows.results.filter((row) => {
    const available = row.applicability_scope === "global_course" || Boolean(row.bound);
    const capable = row.required_capability === "any" || (row.required_capability === "grader" && hasGrader)
      || (row.required_capability === "llm" && llm.enabled === true);
    return available && capable;
  }).map((row) => JSON.parse(row.definition_json));
}

async function uniqueAssignmentSlug(db: D1Database, title: string, preferred?: string) {
  const base = slugify(preferred || title); validateSlug(base);
  for (let i = 0; i < 1000; i++) {
    const candidate = i ? `${base}-${i + 1}` : base;
    if (reservedSlugs.has(candidate)) continue;
    if (!(await db.prepare("SELECT 1 FROM assignments WHERE slug=?").bind(candidate).first())) return candidate;
  }
  throw new ApiError(409, "SLUG_UNAVAILABLE", "Не удалось подобрать slug");
}

export function canonicalRepository(input: string) {
  const ssh = input.match(/^git@([^:/\s]+):([^?#]+?)(?:\.git)?\/?$/i);
  if (ssh) input = `https://${ssh[1]}/${ssh[2]}`;
  let url: URL;
  try { url = new URL(input); } catch { throw new ApiError(400, "REPOSITORY_INVALID", "Некорректный URL репозитория"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443"))
    throw new ApiError(400, "REPOSITORY_INVALID", "Разрешён только публичный HTTPS repository без credentials, query и fragment");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0" || /^[\d.]+$/.test(host) || host.includes(":"))
    throw new ApiError(400, "REPOSITORY_INVALID", "Локальные и IP-адреса запрещены");
  let path = url.pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
  if (!path || path === "/" || path.split("/").filter(Boolean).length < 2)
    throw new ApiError(400, "REPOSITORY_INVALID", "URL должен указывать на repository");
  if (host === "github.com" || host === "gitlab.com") path = path.toLowerCase();
  return { url: `https://${host}${path}`, identity: `${host}${path}` };
}

async function resolveRepositoryHead(repositoryUrl: string) {
  const url = new URL(repositoryUrl), path = url.pathname.replace(/^\//, "");
  let endpoint: string;
  if (url.hostname === "github.com") endpoint = `https://api.github.com/repos/${path}/commits/HEAD`;
  else if (url.hostname === "gitlab.com") endpoint = `https://gitlab.com/api/v4/projects/${encodeURIComponent(path)}/repository/commits/HEAD`;
  else throw new ApiError(400, "REPOSITORY_HOST_UNSUPPORTED", "Автоматическая фиксация версии сейчас поддерживает GitHub и GitLab");
  const response = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": "Itruim" } });
  if (!response.ok) throw new ApiError(400, "REPOSITORY_HEAD_UNAVAILABLE", "Не удалось прочитать публичный репозиторий. Проверьте ссылку и доступность проекта");
  const payload = await response.json<any>(), sha = String(payload.sha ?? payload.id ?? "").toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new ApiError(400, "REPOSITORY_HEAD_INVALID", "Хостинг вернул некорректную версию репозитория");
  return sha;
}

async function loadVersion(db: D1Database, id: string, privateFields: boolean) {
  const row = await db.prepare("SELECT * FROM assignment_versions WHERE id=?").bind(id).first<any>();
  if (!row) throw new ApiError(404, "ASSIGNMENT_VERSION_NOT_FOUND", "Версия лабораторной не найдена");
  const out: any = {
    ...row,
    grader_contract: JSON.parse(row.grader_contract_json),
    dependency_policy: JSON.parse(row.dependency_policy_json),
    resource_policy: JSON.parse(row.resource_policy_json),
    rubric_definition: JSON.parse(row.rubric_definition_json),
    grading_pipeline: JSON.parse(row.grading_pipeline_json),
    llm_pipeline: JSON.parse(row.llm_pipeline_json),
    achievement_definitions: JSON.parse(row.achievement_definitions_json),
  };
  delete out.grader_contract_json; delete out.dependency_policy_json; delete out.resource_policy_json; delete out.rubric_definition_json;
  delete out.grading_pipeline_json; delete out.llm_pipeline_json; delete out.achievement_definitions_json;
  if (privateFields) {
    out.private_grader_config = JSON.parse(row.private_grader_config_json); delete out.private_grader_config_json;
  } else {
    delete out.grader_repository; delete out.grader_commit_sha; delete out.grader_path;
    delete out.grader_entrypoint; delete out.private_grader_config_json; delete out.review_focus;
  }
  return out;
}

function editableVersion(value: any) {
  return {
    specification: value.specification,
    starter_repository_url: value.starter_repository_url,
    starter_commit_sha: value.starter_commit_sha,
    grader_contract: value.grader_contract,
    runtime_profile: value.runtime_profile,
    environment_version: value.environment_version,
    dependency_policy: value.dependency_policy,
    resource_policy: value.resource_policy,
    rubric: value.rubric,
    rubric_definition: value.rubric_definition,
    grading_pipeline: value.grading_pipeline,
    llm_pipeline: value.llm_pipeline,
    achievement_definitions: value.achievement_definitions,
    grader_repository: value.grader_repository,
    grader_commit_sha: value.grader_commit_sha,
    grader_path: value.grader_path,
    grader_entrypoint: value.grader_entrypoint,
    private_grader_config: value.private_grader_config,
    review_focus: value.review_focus,
  };
}

assignmentRoutes.get("/admin/assignments", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT a.*,c.title course_title,
      (SELECT id FROM assignment_versions WHERE assignment_id=a.id AND status='PUBLISHED' ORDER BY version_number DESC LIMIT 1) published_version_id,
      (SELECT version_number FROM assignment_versions WHERE assignment_id=a.id AND status='PUBLISHED' ORDER BY version_number DESC LIMIT 1) published_version_number,
      (SELECT id FROM assignment_versions WHERE assignment_id=a.id AND status='DRAFT' LIMIT 1) draft_version_id,
      (SELECT version_number FROM assignment_versions WHERE assignment_id=a.id AND status='DRAFT' LIMIT 1) draft_version_number
     FROM assignments a JOIN courses c ON c.id=a.course_id
     ORDER BY a.updated_at DESC`,
  ).all();
  return c.json({ items: rows.results });
});

assignmentRoutes.post("/admin/assignments", zValidator("json", assignmentCreateSchema), async (c) => {
  await adminMutation(c); const input = c.req.valid("json"), timestamp = now();
  const id = uuid(), versionId = uuid(), slug = await uniqueAssignmentSlug(c.env.DB, input.title, input.slug);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO assignments(id,course_id,slug,title,description,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM courses WHERE id=?)")
      .bind(id, input.course_id, slug, input.title, input.description, timestamp, timestamp, input.course_id),
    c.env.DB.prepare(
      `INSERT INTO assignment_versions(id,assignment_id,version_number,status,specification,runtime_profile,environment_version,resource_policy_json,created_at)
       VALUES(?,?,1,'DRAFT','','CPU','cpu-v1',?,?)`,
    ).bind(versionId, id, json({ cpu_threads: 1, ram_mb: 512, wall_time_sec: 60, pids: 64, gpu: { required: false, count: 0, vram_mb: 0 } }), timestamp),
  ]);
  return c.json({ id, slug, draft_version_id: versionId }, 201);
});

assignmentRoutes.get("/admin/assignments/:id", async (c) => {
  await requireAdmin(c);
  const assignment = await c.env.DB.prepare("SELECT * FROM assignments WHERE id=?").bind(c.req.param("id")).first();
  if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Лабораторная не найдена");
  const versions = await c.env.DB.prepare("SELECT id,version_number,status,revision,published_at FROM assignment_versions WHERE assignment_id=? ORDER BY version_number DESC")
    .bind(c.req.param("id")).all();
  return c.json({ ...assignment, versions: versions.results });
});

assignmentRoutes.get("/admin/assignment-versions/:id", async (c) => {
  await requireAdmin(c); return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
});

assignmentRoutes.post("/admin/assignments/:id/draft", async (c) => {
  await adminMutation(c); const assignmentId = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM assignment_versions WHERE assignment_id=? AND status='DRAFT'")
    .bind(assignmentId).first<{ id: string }>();
  if (existing) return c.json(await loadVersion(c.env.DB, existing.id, true));
  const source = await c.env.DB.prepare("SELECT * FROM assignment_versions WHERE assignment_id=? AND status='PUBLISHED' ORDER BY version_number DESC LIMIT 1")
    .bind(assignmentId).first<any>();
  if (!source) throw new ApiError(409, "NO_SOURCE_VERSION", "Нет опубликованной версии для копирования");
  const next = await c.env.DB.prepare("SELECT coalesce(max(version_number),0)+1 n FROM assignment_versions WHERE assignment_id=?")
    .bind(assignmentId).first<{ n: number }>();
  const id = uuid(), timestamp = now();
  await c.env.DB.prepare(
    `INSERT INTO assignment_versions(id,assignment_id,version_number,status,specification,starter_repository_url,starter_commit_sha,
     grader_contract_json,runtime_profile,dependency_policy_json,resource_policy_json,rubric,rubric_definition_json,grader_repository,grader_commit_sha,
     grader_path,grader_entrypoint,private_grader_config_json,review_focus,environment_version,grading_pipeline_json,llm_pipeline_json,achievement_definitions_json,created_at)
     VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, assignmentId, next!.n, source.specification, source.starter_repository_url, source.starter_commit_sha,
    source.grader_contract_json, source.runtime_profile, source.dependency_policy_json, source.resource_policy_json, source.rubric, source.rubric_definition_json,
    source.grader_repository, source.grader_commit_sha, source.grader_path, source.grader_entrypoint,
    source.private_grader_config_json, source.review_focus, source.environment_version, source.grading_pipeline_json,
    source.llm_pipeline_json, source.achievement_definitions_json, timestamp).run();
  return c.json(await loadVersion(c.env.DB, id, true), 201);
});

assignmentRoutes.put("/admin/assignment-versions/:id", zValidator("json", assignmentVersionSchema), async (c) => {
  await adminMutation(c); const rev = revision(c.req.header("If-Match")), input = c.req.valid("json");
  const result = await c.env.DB.prepare(
    `UPDATE assignment_versions SET specification=?,starter_repository_url=?,starter_commit_sha=?,grader_contract_json=?,runtime_profile=?,environment_version=?,
     dependency_policy_json=?,resource_policy_json=?,rubric=?,rubric_definition_json=?,grader_repository=?,grader_commit_sha=?,grader_path=?,grader_entrypoint=?,
     private_grader_config_json=?,review_focus=?,grading_pipeline_json=?,llm_pipeline_json=?,achievement_definitions_json=?,revision=revision+1
     WHERE id=? AND status='DRAFT' AND revision=?`,
  ).bind(input.specification, input.starter_repository_url, input.starter_commit_sha, json(input.grader_contract), input.runtime_profile, input.environment_version,
    json(input.dependency_policy), json(input.resource_policy), input.rubric, json(input.rubric_definition), input.grader_repository, input.grader_commit_sha,
    input.grader_path, input.grader_entrypoint, json(input.private_grader_config), input.review_focus, json(input.grading_pipeline),
    json(input.llm_pipeline), json(input.achievement_definitions), c.req.param("id"), rev).run();
  if (!result.meta.changes) throw new ApiError(409, "DRAFT_CHANGED", "Draft опубликован или изменён");
  return c.json(await loadVersion(c.env.DB, c.req.param("id"), true));
});

assignmentRoutes.post("/admin/assignment-versions/:id/publish", async (c) => {
  await adminMutation(c); const rev = revision(c.req.header("If-Match"));
  const version = await loadVersion(c.env.DB, c.req.param("id"), true);
  if (version.status === "PUBLISHED") return c.json(version);
  const parsed = assignmentVersionSchema.safeParse(editableVersion(version));
  if (!parsed.success) throw new ApiError(400, "PUBLISH_INVALID", "Спецификация версии заполнена не полностью", parsed.error.flatten());
  const timestamp = now();
  const catalogSnapshot = await catalogAchievementSnapshot(c.env.DB, version);
  const result = await c.env.DB.prepare("UPDATE assignment_versions SET status='PUBLISHED',published_at=?,achievement_definitions_json=?,revision=revision+1 WHERE id=? AND status='DRAFT' AND revision=?")
    .bind(timestamp, json(catalogSnapshot ?? version.achievement_definitions), version.id, rev).run();
  if (!result.meta.changes) throw new ApiError(409, "DRAFT_CHANGED", "Draft изменён");
  await c.env.DB.prepare("UPDATE assignments SET updated_at=? WHERE id=?").bind(timestamp, version.assignment_id).run();
  return c.json(await loadVersion(c.env.DB, version.id, true));
});

assignmentRoutes.put("/admin/assignment-versions/:id/publications", zValidator("json", assignmentPublicationSchema), async (c) => {
  await adminMutation(c); const input = c.req.valid("json"), timestamp = now();
  const version = await c.env.DB.prepare("SELECT assignment_id,status FROM assignment_versions WHERE id=?")
    .bind(c.req.param("id")).first<{ assignment_id: string; status: string }>();
  if (!version || version.status !== "PUBLISHED") throw new ApiError(409, "VERSION_NOT_PUBLISHED", "Версия не опубликована");
  const sameCourse = await c.env.DB.prepare(
    "SELECT 1 FROM assignments a JOIN course_runs cr ON cr.course_id=a.course_id WHERE a.id=? AND cr.id=?",
  ).bind(version.assignment_id, input.course_run_id).first();
  if (!sameCourse) throw new ApiError(400, "PUBLICATION_COURSE_MISMATCH", "Запуск относится к другому курсу");
  const groupIds = [...new Set(input.group_ids)];
  if (!input.target_all_course_run && groupIds.length) {
    const count = await c.env.DB.prepare(`SELECT count(*) n FROM groups WHERE course_run_id=? AND kind='practice' AND id IN (${groupIds.map(() => "?").join(",")})`)
      .bind(input.course_run_id, ...groupIds).first<{ n: number }>();
    if (count?.n !== groupIds.length) throw new ApiError(400, "PUBLICATION_GROUP_INVALID", "Лабораторные можно назначать только практическим группам выбранного курса");
  }
  const existing = await c.env.DB.prepare("SELECT id FROM assignment_publications WHERE assignment_version_id=? AND course_run_id=?")
    .bind(c.req.param("id"), input.course_run_id).first<{ id: string }>();
  const id = existing?.id ?? uuid();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO assignment_publications(id,assignment_version_id,course_run_id,target_all_course_run,opens_at,due_at,submission_cooldown_seconds,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_version_id,course_run_id) DO UPDATE SET target_all_course_run=excluded.target_all_course_run,
       opens_at=excluded.opens_at,due_at=excluded.due_at,submission_cooldown_seconds=excluded.submission_cooldown_seconds,is_active=1,updated_at=excluded.updated_at`,
    ).bind(id, c.req.param("id"), input.course_run_id, input.target_all_course_run ? 1 : 0, input.opens_at, input.due_at, input.submission_cooldown_seconds, timestamp, timestamp),
    c.env.DB.prepare("DELETE FROM assignment_publication_groups WHERE publication_id=?").bind(id),
  ];
  if (!input.target_all_course_run) for (const groupId of groupIds)
    statements.push(c.env.DB.prepare("INSERT INTO assignment_publication_groups(publication_id,group_id) VALUES(?,?)").bind(id, groupId));
  await c.env.DB.batch(statements); return c.json({ id }, 200);
});

assignmentRoutes.get("/admin/assignment-versions/:id/publications", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT ap.*,cr.name course_run_name FROM assignment_publications ap JOIN course_runs cr ON cr.id=ap.course_run_id
     WHERE ap.assignment_version_id=? ORDER BY cr.name`,
  ).bind(c.req.param("id")).all<any>();
  const items = [];
  for (const row of rows.results) {
    const groups = await c.env.DB.prepare("SELECT g.id,g.name,g.kind FROM assignment_publication_groups pg JOIN groups g ON g.id=pg.group_id WHERE pg.publication_id=? ORDER BY g.kind,g.name")
      .bind(row.id).all(); items.push({ ...row, groups: groups.results });
  }
  return c.json({ items });
});

assignmentRoutes.get("/student/assignments", async (c) => {
  const s = await requireStudent(c), timestamp = now();
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT a.id,a.slug,a.title,a.description,av.id assignment_version_id,av.specification,av.runtime_profile,
       ap.id publication_id,ap.opens_at,ap.due_at,ap.submission_cooldown_seconds,cr.name course_run_name,
       (SELECT max(submitted_at) FROM submissions x WHERE x.student_id=? AND x.assignment_publication_id=ap.id) last_submitted_at,
       coalesce((SELECT max(submitted_at) FROM submissions x WHERE x.student_id=? AND x.assignment_publication_id=ap.id),0)+ap.submission_cooldown_seconds next_submission_at
     FROM assignment_publications ap JOIN assignment_versions av ON av.id=ap.assignment_version_id
     JOIN assignments a ON a.id=av.assignment_id JOIN course_runs cr ON cr.id=ap.course_run_id
     JOIN group_memberships gm ON gm.student_id=? JOIN groups g ON g.id=gm.group_id AND g.course_run_id=ap.course_run_id AND g.kind='practice'
     WHERE ap.is_active=1 AND (ap.opens_at IS NULL OR ?>=ap.opens_at) AND (ap.due_at IS NULL OR ?<ap.due_at)
       AND (ap.target_all_course_run=1 OR EXISTS(SELECT 1 FROM assignment_publication_groups pg WHERE pg.publication_id=ap.id AND pg.group_id=gm.group_id))
     ORDER BY cr.name,a.title`,
  ).bind(s.studentId!, s.studentId!, s.studentId!, timestamp, timestamp).all();
  return c.json({ items: rows.results, server_now: timestamp, local_uploads_enabled: c.env.LOCAL_DEV_UPLOADS === "true" });
});

async function studentPublication(db: D1Database, publicationId: string, studentId: string) {
  return db.prepare(
    `SELECT ap.*,av.assignment_id,av.id assignment_version_id,
      (SELECT gm.group_id FROM group_memberships gm JOIN groups g ON g.id=gm.group_id
       WHERE gm.student_id=? AND g.course_run_id=ap.course_run_id AND g.kind='practice' AND
       (ap.target_all_course_run=1 OR EXISTS(SELECT 1 FROM assignment_publication_groups pg WHERE pg.publication_id=ap.id AND pg.group_id=gm.group_id))
       ORDER BY g.kind,g.name LIMIT 1) group_id
     FROM assignment_publications ap JOIN assignment_versions av ON av.id=ap.assignment_version_id
     WHERE ap.id=? AND ap.is_active=1 AND EXISTS(
       SELECT 1 FROM group_memberships gm JOIN groups g ON g.id=gm.group_id
       WHERE gm.student_id=? AND g.course_run_id=ap.course_run_id AND g.kind='practice' AND
       (ap.target_all_course_run=1 OR EXISTS(SELECT 1 FROM assignment_publication_groups pg WHERE pg.publication_id=ap.id AND pg.group_id=gm.group_id)))`,
  ).bind(studentId, publicationId, studentId).first<any>();
}

assignmentRoutes.post("/student/assignment-publications/:id/submissions", zValidator("json", submissionCreateSchema), async (c) => {
  const student = await studentMutation(c), input = c.req.valid("json"), timestamp = now();
  if (input.policy_version !== SUBMISSION_POLICY.version)
    throw new ApiError(409, "SUBMISSION_POLICY_CHANGED", "Условия отправки изменились. Прочитайте их и подтвердите снова");
  const publication = await studentPublication(c.env.DB, c.req.param("id"), student.studentId!);
  if (!publication) throw new ApiError(403, "ASSIGNMENT_FORBIDDEN", "Лабораторная не назначена вашим группам");
  const workerCapacity = await c.env.DB.prepare("SELECT count(*) total,sum(CASE WHEN is_ready=1 AND json_extract(environment_json,'$.llm_capacity_available')=1 THEN 1 ELSE 0 END) ready FROM grader_workers WHERE is_active=1").first<{ total: number; ready: number }>();
  if ((workerCapacity?.total ?? 0) > 0 && !(workerCapacity?.ready ?? 0))
    throw new ApiError(503, "LLM_CAPACITY_EXHAUSTED", "Лимит автоматической проверки временно исчерпан. Попробуйте отправить работу позже");
  if (publication.opens_at != null && timestamp < publication.opens_at) throw new ApiError(409, "ASSIGNMENT_NOT_OPEN", "Приём ещё не открыт");
  if (publication.due_at != null && timestamp >= publication.due_at) throw new ApiError(409, "ASSIGNMENT_CLOSED", "Срок сдачи завершён");
  if (await c.env.DB.prepare("SELECT 1 FROM assignment_student_holds WHERE assignment_id=? AND student_id=? AND released_at IS NULL").bind(publication.assignment_id, student.studentId!).first())
    throw new ApiError(409, "ASSIGNMENT_MANUAL_DEFENSE_HOLD", "Новые отправки заблокированы до завершения ручной защиты");
  const localUpload = input.source_kind === "local_upload";
  if (localUpload && c.env.LOCAL_DEV_UPLOADS !== "true")
    throw new ApiError(403, "LOCAL_UPLOADS_DISABLED", "Локальная загрузка доступна только в dev-режиме");
  const canonical = localUpload
    ? { url: `local-upload://${input.local_upload_id!}`, identity: `local-upload/${input.local_upload_id!}` }
    : canonicalRepository(input.repo_url!);
  const commitSha = localUpload ? input.local_upload_sha! : input.commit_sha ?? await resolveRepositoryHead(canonical.url);
  const preferences = await c.env.DB.prepare("SELECT email,email_enabled,telegram_chat_id,telegram_enabled FROM student_notification_preferences WHERE student_id=?")
    .bind(student.studentId!).first<{ email: string | null; email_enabled: number; telegram_chat_id: string | null; telegram_enabled: number }>();
  const contactEmail = (input.email ?? preferences?.email ?? "").trim().toLowerCase() || null;
  if (!input.email && !((preferences?.email_enabled && preferences.email) || (preferences?.telegram_enabled && preferences.telegram_chat_id)))
    throw new ApiError(409, "NOTIFICATION_CONTACT_REQUIRED", "Подключите Telegram в настройках профиля перед отправкой работы");
  const contactEmailHash = contactEmail ? await sha256(`${c.env.RATE_LIMIT_PEPPER}:${contactEmail}`) : null;
  const policyHash = await sha256(json(SUBMISSION_POLICY));
  const requestHash = await sha256(json({ repo: canonical.identity, commit: commitSha, policy: input.policy_version, email: contactEmail }));
  const replay = await c.env.DB.prepare("SELECT * FROM submissions WHERE student_id=? AND assignment_publication_id=? AND client_request_id=?")
    .bind(student.studentId!, publication.id, input.client_request_id).first<any>();
  if (replay) {
    if (replay.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Этот client_request_id уже использован с другими данными");
    return c.json(studentSubmission(replay));
  }
  const latest = await c.env.DB.prepare("SELECT submitted_at FROM submissions WHERE student_id=? AND assignment_publication_id=? ORDER BY submitted_at DESC LIMIT 1")
    .bind(student.studentId!, publication.id).first<{ submitted_at: number }>();
  const override = await c.env.DB.prepare(
    "SELECT id FROM submission_cooldown_overrides WHERE student_id=? AND assignment_publication_id=? AND consumed_at IS NULL AND waived_until>=? ORDER BY created_at LIMIT 1",
  ).bind(student.studentId!, publication.id, timestamp).first<{ id: string }>();
  const nextAt = latest ? latest.submitted_at + publication.submission_cooldown_seconds : 0;
  if (!override && timestamp < nextAt) throw new ApiError(409, "SUBMISSION_COOLDOWN", "Следующая отправка пока недоступна", { next_submission_at: nextAt });
  const id = uuid();
  const claim = c.env.DB.prepare(
    "INSERT INTO assignment_repository_claims(assignment_id,repo_identity,student_id,first_submission_id,claimed_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
  ).bind(publication.assignment_id, canonical.identity, student.studentId!, id, timestamp);
  const insert = c.env.DB.prepare(
    `INSERT INTO submissions(id,student_id,group_id,assignment_version_id,assignment_publication_id,repo_url,repo_identity,commit_sha,attempt_number,client_request_id,request_hash,status,submitted_at,duplicate_of_submission_id,contact_email,contact_email_hash)
     SELECT ?,?,?,?,?,?,?,?,coalesce((SELECT max(attempt_number)+1 FROM submissions WHERE student_id=? AND assignment_publication_id=?),1),?,?,
       CASE WHEN (SELECT student_id FROM assignment_repository_claims WHERE assignment_id=? AND repo_identity=?)<>? THEN 'blocked_duplicate_repo' ELSE 'queued' END,
       ?,CASE WHEN (SELECT student_id FROM assignment_repository_claims WHERE assignment_id=? AND repo_identity=?)<>? THEN
         (SELECT first_submission_id FROM assignment_repository_claims WHERE assignment_id=? AND repo_identity=?) ELSE NULL END,?,?
     WHERE NOT EXISTS(SELECT 1 FROM assignment_student_holds h WHERE h.assignment_id=? AND h.student_id=? AND h.released_at IS NULL)
       AND (NOT EXISTS(SELECT 1 FROM submissions recent WHERE recent.student_id=? AND recent.assignment_publication_id=? AND recent.submitted_at>?)
        OR EXISTS(SELECT 1 FROM submission_cooldown_overrides o WHERE o.student_id=? AND o.assignment_publication_id=? AND o.consumed_at IS NULL AND o.waived_until>=?))`,
  ).bind(id, student.studentId!, publication.group_id, publication.assignment_version_id, publication.id, canonical.url, canonical.identity,
    commitSha, student.studentId!, publication.id, input.client_request_id, requestHash,
    publication.assignment_id, canonical.identity, student.studentId!, timestamp,
    publication.assignment_id, canonical.identity, student.studentId!, publication.assignment_id, canonical.identity,
    contactEmail, contactEmailHash, publication.assignment_id, student.studentId!, student.studentId!, publication.id, timestamp - publication.submission_cooldown_seconds,
    student.studentId!, publication.id, timestamp);
  const job = c.env.DB.prepare(
    "INSERT INTO grading_jobs(submission_id,status,created_at) SELECT id,'queued',? FROM submissions WHERE id=? AND status='queued'",
  ).bind(timestamp, id);
  const releaseUnusedClaim = c.env.DB.prepare(
    "DELETE FROM assignment_repository_claims WHERE first_submission_id=? AND NOT EXISTS(SELECT 1 FROM submissions WHERE id=?)",
  ).bind(id, id);
  const stage = c.env.DB.prepare(
    "INSERT INTO submission_stage_events(submission_id,stage,outcome,public_summary,created_at) SELECT id,'submitted','passed','Отправка принята',? FROM submissions WHERE id=?",
  ).bind(timestamp, id);
  const acceptance = c.env.DB.prepare(
    "INSERT INTO submission_policy_acceptances(submission_id,student_id,policy_version,policy_text_sha256,accepted_at) SELECT id,student_id,?,?,? FROM submissions WHERE id=? ON CONFLICT DO NOTHING",
  ).bind(input.policy_version, policyHash, timestamp, id);
  const statements: D1PreparedStatement[] = [claim, insert, releaseUnusedClaim, job, stage, acceptance];
  if (override) statements.push(c.env.DB.prepare("UPDATE submission_cooldown_overrides SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM submissions WHERE id=?)").bind(timestamp, override.id, id));
  try { await c.env.DB.batch(statements); }
  catch (error) {
    const winner = await c.env.DB.prepare("SELECT * FROM submissions WHERE student_id=? AND assignment_publication_id=? AND client_request_id=?")
      .bind(student.studentId!, publication.id, input.client_request_id).first<any>();
    if (winner?.request_hash === requestHash) return c.json(studentSubmission(winner));
    if (winner) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Этот client_request_id уже использован с другими данными");
    throw error;
  }
  const created = await c.env.DB.prepare("SELECT * FROM submissions WHERE id=?").bind(id).first<any>();
  if (!created) {
    if (await c.env.DB.prepare("SELECT 1 FROM assignment_student_holds WHERE assignment_id=? AND student_id=? AND released_at IS NULL").bind(publication.assignment_id, student.studentId!).first())
      throw new ApiError(409, "ASSIGNMENT_MANUAL_DEFENSE_HOLD", "Новые отправки заблокированы до завершения ручной защиты");
    const current = await c.env.DB.prepare("SELECT submitted_at FROM submissions WHERE student_id=? AND assignment_publication_id=? ORDER BY submitted_at DESC LIMIT 1")
      .bind(student.studentId!, publication.id).first<{ submitted_at: number }>();
    throw new ApiError(409, "SUBMISSION_COOLDOWN", "Следующая отправка пока недоступна", { next_submission_at: (current?.submitted_at ?? timestamp) + publication.submission_cooldown_seconds });
  }
  return c.json(studentSubmission(created), 201);
});

assignmentRoutes.get("/student/submission-policy", async (c) => {
  await requireStudent(c);
  return c.json({ ...SUBMISSION_POLICY, sha256: await sha256(json(SUBMISSION_POLICY)) });
});

assignmentRoutes.get("/student/submissions", async (c) => {
  const s = await requireStudent(c);
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE llm_review_sessions SET state='expired',updated_at=? WHERE id IN(SELECT review_session_id FROM llm_clarifications WHERE answered_at IS NULL AND answer_deadline_at<=?) AND state IN ('awaiting_answer_1','awaiting_answer_2')").bind(timestamp, timestamp),
    c.env.DB.prepare("UPDATE submissions SET status='awaiting_teacher_review' WHERE id IN(SELECT submission_id FROM llm_review_sessions WHERE state='expired') AND student_id=? AND status='awaiting_clarification'").bind(s.studentId!),
  ]);
  const rows = await c.env.DB.prepare(
    `SELECT sub.id,sub.assignment_publication_id,sub.status,sub.deterministic_status,sub.attempt_number,sub.repo_url,sub.commit_sha,sub.submitted_at,a.title,ap.due_at,
       sub.submitted_at+ap.submission_cooldown_seconds next_submission_at,j.current_stage,j.public_stage_message,j.infra_retry_count,j.next_retry_at,
       gr.public_summary,gr.public_diagnostics_json,gr.deterministic_gate,gr.llm_eligible,gr.result_json,
       (SELECT action FROM submission_teacher_decisions d WHERE d.submission_id=sub.id ORDER BY d.created_at DESC LIMIT 1) teacher_action,
       coalesce((SELECT json_extract(score_json,'$.earned') FROM submission_teacher_decisions d WHERE d.submission_id=sub.id AND score_json IS NOT NULL ORDER BY d.created_at DESC LIMIT 1),
         json_extract((SELECT final_result_json FROM llm_review_sessions l WHERE l.submission_id=sub.id),'$.assessment.total_score')) final_score
     FROM submissions sub JOIN assignment_versions av ON av.id=sub.assignment_version_id
     JOIN assignments a ON a.id=av.assignment_id JOIN assignment_publications ap ON ap.id=sub.assignment_publication_id
     LEFT JOIN grading_jobs j ON j.submission_id=sub.id LEFT JOIN grading_results gr ON gr.grading_job_id=j.id
     WHERE sub.student_id=? ORDER BY sub.submitted_at DESC`,
  ).bind(s.studentId!).all<any>();
  const items = [];
  for (const row of rows.results) {
    const events = await c.env.DB.prepare(
      "SELECT stage,outcome,public_summary,created_at FROM submission_stage_events WHERE submission_id=? ORDER BY id",
    ).bind(row.id).all();
    const clarification = await c.env.DB.prepare(
      `SELECT lc.id,lc.question_number,lc.question,lc.asked_at,lc.answer_deadline_at,lc.answered_at,lrs.state
       FROM llm_review_sessions lrs JOIN llm_clarifications lc ON lc.review_session_id=lrs.id
       WHERE lrs.submission_id=? ORDER BY lc.question_number DESC LIMIT 1`,
    ).bind(row.id).first<any>();
    let studentStatus = row.status;
    if (row.deterministic_status === "failed") studentStatus = "deterministic_failed";
    else if (["queued", "grading"].includes(row.status)) studentStatus = "processing";
    const publicResult = row.result_json ? JSON.parse(row.result_json) : null;
    const { current_stage: _currentStage, public_stage_message: _stageMessage, infra_retry_count: _retryCount, next_retry_at: _nextRetryAt, ...studentRow } = row;
    items.push({ ...studentRow, student_status: studentStatus, public_diagnostics: JSON.parse(row.public_diagnostics_json ?? "[]"),
      checks: publicResult?.checks ?? [], public_diagnostics_json: undefined, result_json: undefined, clarification,
      stages: events.results.filter((event: any) => event.stage !== "infrastructure") });
  }
  return c.json({ items, server_now: now() });
});

assignmentRoutes.post("/student/clarifications/:id/answer", zValidator("json", clarificationAnswerSchema), async (c) => {
  const student = await studentMutation(c), timestamp = now(), input = c.req.valid("json"), id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `UPDATE llm_clarifications SET answer=?,answered_at=? WHERE id=? AND answer IS NULL AND answer_deadline_at>?
     AND review_session_id IN(SELECT lrs.id FROM llm_review_sessions lrs JOIN submissions s ON s.id=lrs.submission_id WHERE s.student_id=? AND lrs.state IN ('awaiting_answer_1','awaiting_answer_2'))`,
  ).bind(input.answer, timestamp, id, timestamp, student.studentId!).run();
  if (!result.meta.changes) throw new ApiError(409, "CLARIFICATION_UNAVAILABLE", "Вопрос не найден, уже отвечен или срок ответа истёк");
  await c.env.DB.prepare(
    `UPDATE llm_review_sessions SET state=CASE question_count WHEN 1 THEN 'reviewing_answer_1' ELSE 'reviewing_answer_2' END,updated_at=?
     WHERE id=(SELECT review_session_id FROM llm_clarifications WHERE id=?)`,
  ).bind(timestamp, id).run();
  await c.env.DB.prepare(
    `INSERT INTO submission_stage_events(submission_id,stage,outcome,public_summary,created_at)
     SELECT lrs.submission_id,'llm','running','Ответ на уточняющий вопрос отправлен',? FROM llm_review_sessions lrs
     JOIN llm_clarifications lc ON lc.review_session_id=lrs.id WHERE lc.id=?`,
  ).bind(timestamp, id).run();
  return c.json({ accepted: true, answered_at: timestamp });
});

assignmentRoutes.get("/teacher/groups/:groupId/submissions", async (c) => {
  await requireTeacherGroupKind(c, c.req.param("groupId"), "practice");
  const rows = await c.env.DB.prepare(
    `SELECT sub.*,s.fio_display,a.title,av.rubric_definition_json,av.achievement_definitions_json,gr.result_json,gr.public_summary,lrs.state llm_state,lrs.final_result_json
     FROM submissions sub JOIN students s ON s.id=sub.student_id
     JOIN assignment_versions av ON av.id=sub.assignment_version_id JOIN assignments a ON a.id=av.assignment_id
     LEFT JOIN grading_jobs gj ON gj.submission_id=sub.id LEFT JOIN grading_results gr ON gr.grading_job_id=gj.id
     LEFT JOIN llm_review_sessions lrs ON lrs.submission_id=sub.id
     WHERE sub.group_id=? ORDER BY sub.submitted_at DESC`,
  ).bind(c.req.param("groupId")).all<any>();
  const items = [];
  for (const row of rows.results) {
    const clarifications = await c.env.DB.prepare("SELECT question_number,question,asked_at,answer_deadline_at,answer,answered_at,answer_evaluation_json FROM llm_clarifications WHERE review_session_id=(SELECT id FROM llm_review_sessions WHERE submission_id=?) ORDER BY question_number").bind(row.id).all<any>();
    const decisions = await c.env.DB.prepare("SELECT action,score_json,comment,actor_kind,defense_at,defense_location,created_at FROM submission_teacher_decisions WHERE submission_id=? ORDER BY created_at").bind(row.id).all<any>();
    const nominations = await c.env.DB.prepare("SELECT achievement_id,source,reason_code,evidence_ids_json,status,created_at FROM assignment_achievement_nominations WHERE submission_id=? ORDER BY created_at").bind(row.id).all<any>();
    const rawResult = row.result_json ? JSON.parse(row.result_json) : null;
    const graderResult = rawResult ? { ...rawResult, private_diagnostics: undefined, evidence: undefined } : null;
    items.push({ ...row, rubric_definition: JSON.parse(row.rubric_definition_json), achievement_definitions: JSON.parse(row.achievement_definitions_json), grader_result: graderResult,
      llm_result: row.final_result_json ? JSON.parse(row.final_result_json) : null, clarifications: clarifications.results.map((x) => ({ ...x, answer_evaluation: x.answer_evaluation_json ? JSON.parse(x.answer_evaluation_json) : null, answer_evaluation_json: undefined })),
      achievement_nominations: nominations.results.map((x) => ({ ...x, evidence_ids: JSON.parse(x.evidence_ids_json), evidence_ids_json: undefined })),
      decisions: decisions.results.map((x) => ({ ...x, score: x.score_json ? JSON.parse(x.score_json) : null, score_json: undefined })), rubric_definition_json: undefined, achievement_definitions_json: undefined, result_json: undefined, final_result_json: undefined });
  }
  return c.json({ items });
});

assignmentRoutes.get("/teacher/submissions/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT sub.*,s.fio_display,a.title,av.rubric_definition_json,av.achievement_definitions_json,gr.result_json,gr.public_summary,lrs.state llm_state,lrs.final_result_json
     FROM submissions sub JOIN students s ON s.id=sub.student_id
     JOIN assignment_versions av ON av.id=sub.assignment_version_id JOIN assignments a ON a.id=av.assignment_id
     LEFT JOIN grading_jobs gj ON gj.submission_id=sub.id LEFT JOIN grading_results gr ON gr.grading_job_id=gj.id
     LEFT JOIN llm_review_sessions lrs ON lrs.submission_id=sub.id WHERE sub.id=?`,
  ).bind(c.req.param("id")).first<any>();
  if (!row) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Отправка не найдена");
  await requireTeacherGroupKind(c, row.group_id, "practice");
  const [clarifications, decisions, nominations] = await Promise.all([
    c.env.DB.prepare("SELECT question_number,question,asked_at,answer_deadline_at,answer,answered_at,answer_evaluation_json FROM llm_clarifications WHERE review_session_id=(SELECT id FROM llm_review_sessions WHERE submission_id=?) ORDER BY question_number").bind(row.id).all<any>(),
    c.env.DB.prepare("SELECT action,score_json,comment,actor_kind,defense_at,defense_location,created_at FROM submission_teacher_decisions WHERE submission_id=? ORDER BY created_at").bind(row.id).all<any>(),
    c.env.DB.prepare("SELECT achievement_id,source,reason_code,evidence_ids_json,status,created_at FROM assignment_achievement_nominations WHERE submission_id=? ORDER BY created_at").bind(row.id).all<any>(),
  ]);
  const rawResult = row.result_json ? JSON.parse(row.result_json) : null;
  return c.json({ ...row, rubric_definition: JSON.parse(row.rubric_definition_json), achievement_definitions: JSON.parse(row.achievement_definitions_json),
    grader_result: rawResult ? { ...rawResult, private_diagnostics: undefined, evidence: undefined } : null,
    llm_result: row.final_result_json ? JSON.parse(row.final_result_json) : null,
    clarifications: clarifications.results.map((x) => ({ ...x, answer_evaluation: x.answer_evaluation_json ? JSON.parse(x.answer_evaluation_json) : null, answer_evaluation_json: undefined })),
    achievement_nominations: nominations.results.map((x) => ({ ...x, evidence_ids: JSON.parse(x.evidence_ids_json), evidence_ids_json: undefined })),
    decisions: decisions.results.map((x) => ({ ...x, score: x.score_json ? JSON.parse(x.score_json) : null, score_json: undefined })),
    rubric_definition_json: undefined, achievement_definitions_json: undefined, result_json: undefined, final_result_json: undefined });
});

assignmentRoutes.get("/admin/submissions", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT sub.*,s.fio_display,a.title,g.name group_name FROM submissions sub JOIN students s ON s.id=sub.student_id
     JOIN groups g ON g.id=sub.group_id JOIN assignment_versions av ON av.id=sub.assignment_version_id
     JOIN assignments a ON a.id=av.assignment_id ORDER BY sub.submitted_at DESC LIMIT 500`,
  ).all(); return c.json({ items: rows.results });
});

async function duplicateDecision(c: any, actorKind: "admin" | "teacher", actorId: string) {
  const input = c.req.valid("json") as { decision: "allow" | "reject"; comment?: string };
  const submissionId = c.req.param("id"), timestamp = now(), next = input.decision === "allow" ? "queued" : "rejected_duplicate_repo";
  const action = input.decision === "allow" ? "allow_duplicate_grading" : "reject_duplicate";
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("UPDATE submissions SET status=? WHERE id=? AND status='blocked_duplicate_repo'").bind(next, submissionId),
    c.env.DB.prepare(
      `INSERT INTO submission_review_actions(id,submission_id,action,actor_kind,actor_id,comment,created_at)
       SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM submissions WHERE id=? AND status=?)
       AND NOT EXISTS(SELECT 1 FROM submission_review_actions WHERE submission_id=? AND action IN ('allow_duplicate_grading','reject_duplicate'))`,
    ).bind(uuid(), submissionId, action, actorKind, actorId, input.comment ?? null, timestamp, submissionId, next, submissionId),
  ];
  if (input.decision === "allow") statements.push(
    c.env.DB.prepare("INSERT INTO grading_jobs(submission_id,status,created_at) SELECT id,'queued',? FROM submissions WHERE id=? AND status='queued' AND NOT EXISTS(SELECT 1 FROM grading_jobs WHERE submission_id=?)")
      .bind(timestamp, submissionId, submissionId),
  );
  const results = await c.env.DB.batch(statements);
  if (!results[0]?.meta.changes) throw new ApiError(409, "DUPLICATE_ALREADY_RESOLVED", "Решение по этой отправке уже принято");
  return c.json({ id: submissionId, status: next });
}

assignmentRoutes.post("/admin/submissions/:id/duplicate-decision", zValidator("json", duplicateDecisionSchema), async (c) => {
  const admin = await adminMutation(c); return duplicateDecision(c, "admin", admin.id);
});

assignmentRoutes.post("/teacher/submissions/:id/duplicate-decision", zValidator("json", duplicateDecisionSchema), async (c) => {
  const teacher = await teacherMutation(c);
  const submission = await c.env.DB.prepare("SELECT group_id FROM submissions WHERE id=?").bind(c.req.param("id")).first<{ group_id: string }>();
  if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Отправка не найдена");
  await requireTeacherGroupKind(c, submission.group_id, "practice");
  return duplicateDecision(c, "teacher", teacher.teacherId!);
});

async function teacherReviewDecision(c: any, actorKind: "admin" | "teacher", actorId: string) {
  const input = c.req.valid("json"), submissionId = c.req.param("id"), timestamp = now();
  const submission = await c.env.DB.prepare(
    `SELECT sub.*,av.rubric_definition_json,a.id assignment_id FROM submissions sub
     JOIN assignment_versions av ON av.id=sub.assignment_version_id JOIN assignments a ON a.id=av.assignment_id WHERE sub.id=?`,
  ).bind(submissionId).first() as any;
  if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Отправка не найдена");
  if (actorKind === "teacher") await requireTeacherGroupKind(c, submission.group_id, "practice");
  if (input.score) {
    const rubric = JSON.parse(submission.rubric_definition_json), criteria = new Map(rubric.criteria.map((item: any) => [item.id, item]));
    if (Object.keys(input.score.criteria).length !== criteria.size || [...criteria.keys()].some((criterionId) => !((criterionId as string) in input.score.criteria)))
      throw new ApiError(400, "RUBRIC_SCORE_INCOMPLETE", "Заполните оценку по каждому критерию");
    let criterionTotal = 0;
    for (const [criterionId, score] of Object.entries(input.score.criteria)) {
      const criterion: any = criteria.get(criterionId);
      if (!criterion || Number(score) < criterion.min_score || Number(score) > criterion.max_score || Math.abs((Number(score) - criterion.min_score) / criterion.score_step - Math.round((Number(score) - criterion.min_score) / criterion.score_step)) > 1e-8)
        throw new ApiError(400, "RUBRIC_SCORE_INVALID", `Оценка критерия ${criterionId} не соответствует rubric`);
      criterionTotal += Number(score);
    }
    if (Math.abs(criterionTotal - Number(input.score.earned)) > 1e-8 || input.score.maximum !== 100)
      throw new ApiError(400, "RUBRIC_TOTAL_INVALID", "Итоговый балл должен равняться сумме критериев из 100");
  }
  const targetStatus = input.action === "manual_defense" ? "manual_defense" : "finalized", decisionId = uuid();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("UPDATE submissions SET status=? WHERE id=? AND status IN ('awaiting_teacher_review','manual_defense')").bind(targetStatus, submissionId),
    c.env.DB.prepare("INSERT INTO submission_teacher_decisions(id,submission_id,action,score_json,comment,actor_kind,actor_id,defense_at,defense_location,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(decisionId, submissionId, input.action, input.score ? json(input.score) : null, input.comment, actorKind, actorId, input.manual_defense?.at ?? null, input.manual_defense?.location ?? null, timestamp),
  ];
  if (input.action === "reject") {
    statements.push(c.env.DB.prepare("UPDATE assignment_achievement_nominations SET status='rejected' WHERE submission_id=? AND status='pending_teacher'").bind(submissionId));
  } else if (input.action !== "manual_defense") {
    statements.push(...await completionAchievementStatements(c.env.DB, submissionId, decisionId, input.action, timestamp));
    const pending = await c.env.DB.prepare("SELECT * FROM assignment_achievement_nominations WHERE submission_id=? AND status='pending_teacher'").bind(submissionId).all();
    const awardContext = await c.env.DB.prepare(
      `SELECT sub.student_id,sub.assignment_version_id,av.assignment_id,av.achievement_definitions_json,ap.course_run_id,cr.course_id
       FROM submissions sub JOIN assignment_versions av ON av.id=sub.assignment_version_id
       JOIN assignment_publications ap ON ap.id=sub.assignment_publication_id JOIN course_runs cr ON cr.id=ap.course_run_id WHERE sub.id=?`,
    ).bind(submissionId).first() as any;
    const definitions = new Map<string, any>((JSON.parse(awardContext.achievement_definitions_json) as any[]).map((item) => [item.id, item]));
    for (const nomination of pending.results) {
      const definition = definitions.get(nomination.achievement_id);
      if (!definition) continue;
      const idempotencyKey = definition.repeatability === "once_global" ? `${awardContext.student_id}:${nomination.achievement_id}`
        : definition.repeatability === "once_per_course" ? `${awardContext.student_id}:${awardContext.course_id}:${nomination.achievement_id}`
        : definition.repeatability === "once_per_course_run" ? `${awardContext.student_id}:${awardContext.course_run_id}:${nomination.achievement_id}`
        : definition.repeatability === "once_per_assignment" ? `${awardContext.student_id}:${awardContext.assignment_id}:${nomination.achievement_id}`
        : `${submissionId}:${nomination.achievement_id}:${nomination.source}:${nomination.reason_code}`;
      statements.push(c.env.DB.prepare(
        `INSERT INTO assignment_achievement_awards(id,student_id,submission_id,assignment_version_id,course_run_id,achievement_id,namespace,
         definition_snapshot_json,evidence_ids_json,source,reason_code,idempotency_key,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(uuid(), awardContext.student_id, submissionId, awardContext.assignment_version_id, awardContext.course_run_id,
        nomination.achievement_id, nomination.achievement_id.slice(0, nomination.achievement_id.lastIndexOf("/")), json(definition),
        nomination.evidence_ids_json, nomination.source, nomination.reason_code, idempotencyKey, timestamp));
    }
    statements.push(c.env.DB.prepare("UPDATE assignment_achievement_nominations SET status='accepted' WHERE submission_id=? AND status='pending_teacher'").bind(submissionId));
  }
  if (input.action === "manual_defense") statements.push(c.env.DB.prepare(
    "INSERT INTO assignment_student_holds(id,assignment_id,student_id,source_submission_id,reason,created_by_kind,created_by_id,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  ).bind(uuid(), submission.assignment_id, submission.student_id, submissionId, input.comment, actorKind, actorId, timestamp));
  else statements.push(c.env.DB.prepare(
    "UPDATE assignment_student_holds SET released_at=?,released_by_kind=?,released_by_id=?,release_reason=? WHERE assignment_id=? AND student_id=? AND released_at IS NULL",
  ).bind(timestamp, actorKind, actorId, input.comment, submission.assignment_id, submission.student_id));
  statements.push(c.env.DB.prepare(
    "INSERT INTO submission_stage_events(submission_id,stage,outcome,public_summary,created_at) VALUES(?,?,?,?,?)",
  ).bind(submissionId, "teacher_review", input.action === "manual_defense" ? "running" : input.action === "reject" ? "failed" : "passed", input.action === "manual_defense" ? "Назначена ручная защита" : input.action === "reject" ? "Преподаватель вернул работу" : "Работа принята преподавателем", timestamp));
  statements.push(...notificationStatements(c.env.DB, {
    id: uuid(), studentId: submission.student_id, kind: "submission_result", title: "Решение по лабораторной",
    message: input.action === "manual_defense" ? `Преподаватель назначил ручную защиту на ${new Date(input.manual_defense.at * 1000).toISOString()}. ${input.manual_defense.location}` : input.action === "reject" ? "Работа возвращена преподавателем. Откройте историю отправок." : "Работа принята. Полученные ачивки уже появились в профиле.",
    entityKind: "submission", entityId: submissionId, dedupeKey: `submission:${submissionId}:teacher:${decisionId}`, timestamp,
  }));
  const results = await c.env.DB.batch(statements);
  if (!results[0]?.meta.changes) throw new ApiError(409, "REVIEW_STATE_CHANGED", "Решение уже принято или состояние отправки изменилось");
  return c.json({ accepted: true, status: targetStatus });
}

assignmentRoutes.post("/teacher/submissions/:id/review-decision", zValidator("json", teacherSubmissionDecisionSchema), async (c) => {
  const teacher = await teacherMutation(c); return teacherReviewDecision(c, "teacher", teacher.teacherId!);
});
assignmentRoutes.post("/admin/submissions/:id/review-decision", zValidator("json", teacherSubmissionDecisionSchema), async (c) => {
  const admin = await adminMutation(c); return teacherReviewDecision(c, "admin", admin.id);
});

assignmentRoutes.get("/admin/platform-achievements", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT ca.*,c.title course_title,count(DISTINCT caa.id) award_count,count(DISTINCT aab.assignment_id) binding_count,
      (SELECT json_group_array(assignment_id) FROM assignment_achievement_bindings WHERE achievement_id=ca.id) assignment_ids_json
     FROM course_achievements ca JOIN courses c ON c.id=ca.course_id
     LEFT JOIN course_achievement_awards caa ON caa.achievement_id=ca.id
     LEFT JOIN assignment_achievement_bindings aab ON aab.achievement_id=ca.id
     GROUP BY ca.id ORDER BY ca.created_at DESC`,
  ).all();
  return c.json({ items: rows.results });
});

assignmentRoutes.put("/admin/assignments/:id/achievement-bindings", zValidator("json", assignmentAchievementBindingsSchema), async (c) => {
  await adminMutation(c);
  const assignmentId = c.req.param("id"), achievementIds = [...new Set(c.req.valid("json").achievement_ids)], timestamp = now();
  const assignment = await c.env.DB.prepare("SELECT course_id FROM assignments WHERE id=?").bind(assignmentId).first<{ course_id: string }>();
  if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Лабораторная не найдена");
  if (achievementIds.length) {
    const count = await c.env.DB.prepare(`SELECT count(*) n FROM course_achievements WHERE course_id=? AND id IN (${achievementIds.map(() => "?").join(",")})`)
      .bind(assignment.course_id, ...achievementIds).first<{ n: number }>();
    if (count?.n !== achievementIds.length) throw new ApiError(400, "ACHIEVEMENT_BINDING_INVALID", "Достижение относится к другому курсу или не существует");
  }
  const statements = [c.env.DB.prepare("DELETE FROM assignment_achievement_bindings WHERE assignment_id=?").bind(assignmentId)];
  for (const achievementId of achievementIds) statements.push(c.env.DB.prepare("INSERT INTO assignment_achievement_bindings(assignment_id,achievement_id,created_at) VALUES(?,?,?)").bind(assignmentId,achievementId,timestamp));
  await c.env.DB.batch(statements);
  return c.json({ achievement_ids: achievementIds });
});

assignmentRoutes.post("/admin/platform-achievements", zValidator("json", courseAchievementCreateSchema), async (c) => {
  const admin = await adminMutation(c);
  const input = c.req.valid("json"), id = uuid(), base = slugify(input.title) || `achievement-${id.slice(0,8)}`;
  const course = await c.env.DB.prepare("SELECT slug FROM courses WHERE id=?").bind(input.course_id).first<{ slug: string }>();
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден");
  if (input.image_key) {
    const media = await c.env.DB.prepare("SELECT 1 FROM media_objects WHERE key=? AND status='READY'").bind(input.image_key).first();
    if (!media) throw new ApiError(400, "MEDIA_NOT_READY", "Изображение не существует или ещё не готово");
  }
  const assignmentIds = [...new Set(input.assignment_ids)];
  if (input.applicability_scope === "selected_assignments" && !assignmentIds.length)
    throw new ApiError(400, "ACHIEVEMENT_ASSIGNMENTS_REQUIRED", "Выберите хотя бы одну лабораторную");
  if (assignmentIds.length) {
    const placeholders = assignmentIds.map(() => "?").join(",");
    const count = await c.env.DB.prepare(`SELECT count(*) n FROM assignments WHERE course_id=? AND id IN (${placeholders})`)
      .bind(input.course_id, ...assignmentIds).first<{ n: number }>();
    if (count?.n !== assignmentIds.length) throw new ApiError(400, "ACHIEVEMENT_ASSIGNMENT_INVALID", "Лабораторная относится к другому курсу");
  }
  let slug = base;
  for (let suffix = 2; await c.env.DB.prepare("SELECT 1 FROM course_achievements WHERE course_id=? AND slug=?").bind(input.course_id, slug).first(); suffix++) slug = `${base}-${suffix}`;
  const definition = {
    id: `course/${course.slug}/${slug}`, title: input.title, description: input.description, unlock_hint: input.unlock_hint,
    emoji: input.emoji, image_key: input.image_key, theme: input.source_kind === "llm" ? "warning" : "success",
    accent_color: input.accent_color, visibility: "public", repeatability: input.repeatability,
    award_policy: input.source_kind === "llm" ? "teacher_confirmation" : "automatic",
    allowed_sources: [input.source_kind], trigger: input.trigger,
  };
  const timestamp = now();
  const statements = [c.env.DB.prepare(
    `INSERT INTO course_achievements(id,course_run_id,course_id,slug,title,description,unlock_hint,emoji,accent_color,image_key,
     applicability_scope,required_capability,source_kind,repeatability,definition_json,created_by_kind,created_by_id,created_at)
     VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,'admin',?,?)`,
  ).bind(id, input.course_id, slug, input.title, input.description, input.unlock_hint, input.emoji, input.accent_color, input.image_key,
    input.applicability_scope, input.required_capability, input.source_kind, input.repeatability, json(definition), admin.id, timestamp)];
  if (input.applicability_scope === "selected_assignments") for (const assignmentId of assignmentIds)
    statements.push(c.env.DB.prepare("INSERT INTO assignment_achievement_bindings(assignment_id,achievement_id,created_at) VALUES(?,?,?)").bind(assignmentId,id,timestamp));
  await c.env.DB.batch(statements);
  return c.json({ id, slug }, 201);
});

assignmentRoutes.put("/admin/platform-achievements/:id", zValidator("json", courseAchievementCreateSchema), async (c) => {
  const admin = await adminMutation(c), input = c.req.valid("json"), id = c.req.param("id"), timestamp = now();
  const existing = await c.env.DB.prepare("SELECT slug FROM course_achievements WHERE id=? AND course_id=?").bind(id,input.course_id).first<{ slug: string }>();
  const course = await c.env.DB.prepare("SELECT slug FROM courses WHERE id=?").bind(input.course_id).first<{ slug: string }>();
  if (!existing || !course) throw new ApiError(404,"ACHIEVEMENT_NOT_FOUND","Достижение курса не найдено");
  const assignmentIds = [...new Set(input.assignment_ids)];
  if (input.applicability_scope === "selected_assignments" && !assignmentIds.length)
    throw new ApiError(400,"ACHIEVEMENT_ASSIGNMENTS_REQUIRED","Выберите хотя бы одну лабораторную");
  if (assignmentIds.length) {
    const count = await c.env.DB.prepare(`SELECT count(*) n FROM assignments WHERE course_id=? AND id IN (${assignmentIds.map(() => "?").join(",")})`)
      .bind(input.course_id,...assignmentIds).first<{ n:number }>();
    if (count?.n !== assignmentIds.length) throw new ApiError(400,"ACHIEVEMENT_ASSIGNMENT_INVALID","Лабораторная относится к другому курсу");
  }
  const definition = { id:`course/${course.slug}/${existing.slug}`,title:input.title,description:input.description,unlock_hint:input.unlock_hint,
    emoji:input.emoji,image_key:input.image_key,theme:input.source_kind === "llm" ? "warning" : "success",accent_color:input.accent_color,
    visibility:"public",repeatability:input.repeatability,award_policy:input.source_kind === "llm" ? "teacher_confirmation" : "automatic",
    allowed_sources:[input.source_kind],trigger:input.trigger };
  const statements = [c.env.DB.prepare(`UPDATE course_achievements SET title=?,description=?,unlock_hint=?,emoji=?,accent_color=?,image_key=?,
    applicability_scope=?,required_capability=?,source_kind=?,repeatability=?,definition_json=? WHERE id=? AND course_id=?`)
    .bind(input.title,input.description,input.unlock_hint,input.emoji,input.accent_color,input.image_key,input.applicability_scope,input.required_capability,
      input.source_kind,input.repeatability,json(definition),id,input.course_id),
    c.env.DB.prepare("DELETE FROM assignment_achievement_bindings WHERE achievement_id=?").bind(id)];
  if (input.applicability_scope === "selected_assignments") for (const assignmentId of assignmentIds)
    statements.push(c.env.DB.prepare("INSERT INTO assignment_achievement_bindings(assignment_id,achievement_id,created_at) VALUES(?,?,?)").bind(assignmentId,id,timestamp));
  await c.env.DB.batch(statements);
  return c.json({ id, updated_by: admin.id });
});

assignmentRoutes.post("/admin/platform-achievements/:id/award", zValidator("json", courseAchievementAwardSchema), async (c) => {
  const admin = await adminMutation(c); const input = c.req.valid("json"), timestamp = now();
  const allowed = await c.env.DB.prepare(
    `SELECT ca.title FROM course_achievements ca
     WHERE ca.id=? AND EXISTS(SELECT 1 FROM students WHERE id=?)`,
  ).bind(c.req.param("id"), input.student_id).first<{ title: string }>();
  if (!allowed) throw new ApiError(404, "ACHIEVEMENT_OR_STUDENT_NOT_FOUND", "Достижение или студент не найдены");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO course_achievement_awards(id,achievement_id,student_id,awarded_by_kind,awarded_by_id,reason,awarded_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(achievement_id,student_id) DO NOTHING")
      .bind(uuid(), c.req.param("id"), input.student_id, "admin", admin.id, input.reason, timestamp),
    ...notificationStatements(c.env.DB, {
      id: uuid(), studentId: input.student_id, kind: "achievement", title: `Получена ачивка «${allowed.title}»`,
      message: input.reason || "Администратор выдал вам новую ачивку.", entityKind: "course_achievement", entityId: c.req.param("id"),
      dedupeKey: `course-achievement:${c.req.param("id")}:${input.student_id}`, timestamp,
    }),
  ]);
  return c.json({ awarded: true, awarded_at: timestamp });
});

assignmentRoutes.post("/admin/grading-jobs/:id/requeue", async (c) => {
  const admin = await adminMutation(c), id = Number(c.req.param("id")), timestamp = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE grading_jobs SET status='queued',current_stage='queued',public_stage_message=NULL,worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,heartbeat_at=NULL,started_at=NULL,finished_at=NULL,next_retry_at=NULL,infra_error_code=NULL WHERE id=? AND status='infra_failed'").bind(id),
    c.env.DB.prepare("UPDATE submissions SET status='queued' WHERE id=(SELECT submission_id FROM grading_jobs WHERE id=? AND status='queued')").bind(id),
    c.env.DB.prepare(
      `INSERT INTO submission_review_actions(id,submission_id,action,actor_kind,actor_id,created_at)
       SELECT ?,submission_id,'requeue_infra_failure','admin',?,? FROM grading_jobs WHERE id=? AND status='queued'
       AND NOT EXISTS(SELECT 1 FROM submission_review_actions sra WHERE sra.submission_id=grading_jobs.submission_id AND sra.action='requeue_infra_failure' AND sra.created_at=?)`,
    ).bind(uuid(), admin.id, timestamp, id, timestamp),
  ]);
  if (!results[0]?.meta.changes) throw new ApiError(409, "JOB_NOT_REQUEUEABLE", "Job не находится в infra_failed");
  return c.json({ id, status: "queued" });
});

assignmentRoutes.post("/admin/submission-cooldown-overrides", zValidator("json", cooldownOverrideSchema), async (c) => {
  const admin = await adminMutation(c), input = c.req.valid("json"), id = uuid(), timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO submission_cooldown_overrides(id,student_id,assignment_publication_id,waived_until,reason,created_by_kind,created_by_id,created_at) VALUES(?,?,?,?,?,'admin',?,?)",
  ).bind(id, input.student_id, input.assignment_publication_id, input.waived_until, input.reason, admin.id, timestamp).run();
  return c.json({ id }, 201);
});

assignmentRoutes.post("/teacher/submission-cooldown-overrides", zValidator("json", cooldownOverrideSchema), async (c) => {
  const teacher = await teacherMutation(c), input = c.req.valid("json");
  const publication = await c.env.DB.prepare("SELECT course_run_id FROM assignment_publications WHERE id=?").bind(input.assignment_publication_id).first<{ course_run_id: string }>();
  const group = publication && await c.env.DB.prepare(
    `SELECT gm.group_id FROM group_memberships gm
     JOIN groups g ON g.id=gm.group_id
     JOIN teacher_group_access tga ON tga.group_id=gm.group_id
     JOIN assignment_publications ap ON ap.id=? AND ap.course_run_id=g.course_run_id
     WHERE gm.student_id=? AND g.course_run_id=? AND tga.teacher_id=?
       AND (ap.target_all_course_run=1 OR EXISTS(
         SELECT 1 FROM assignment_publication_groups pg WHERE pg.publication_id=ap.id AND pg.group_id=gm.group_id
       )) LIMIT 1`,
  ).bind(input.assignment_publication_id, input.student_id, publication.course_run_id, teacher.teacherId!).first();
  if (!group) throw new ApiError(403, "GROUP_FORBIDDEN", "Student не относится к доступной вам аудитории лабораторной");
  const id = uuid(), timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO submission_cooldown_overrides(id,student_id,assignment_publication_id,waived_until,reason,created_by_kind,created_by_id,created_at) VALUES(?,?,?,?,?,'teacher',?,?)",
  ).bind(id, input.student_id, input.assignment_publication_id, input.waived_until, input.reason, teacher.teacherId!, timestamp).run();
  return c.json({ id }, 201);
});

assignmentRoutes.post("/admin/grader-workers", zValidator("json", graderWorkerCreateSchema), async (c) => {
  await adminMutation(c); const input = c.req.valid("json"), token = randomToken(48), id = uuid(), timestamp = now();
  await c.env.DB.prepare("INSERT INTO grader_workers(id,name,token_hash,created_at) VALUES(?,?,?,?)")
    .bind(id, input.name, await sha256(token), timestamp).run();
  return c.json({ id, name: input.name, token }, 201);
});

async function requireGrader(c: any) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new ApiError(401, "GRADER_UNAUTHENTICATED", "Требуется credential grader-worker");
  const worker = await c.env.DB.prepare("SELECT id,name,capabilities_json,is_ready FROM grader_workers WHERE token_hash=? AND is_active=1")
    .bind(await sha256(token)).first() as { id: string; name: string; capabilities_json: string; is_ready: number } | null;
  if (!worker) throw new ApiError(401, "GRADER_UNAUTHENTICATED", "Недействительный credential grader-worker");
  await c.env.DB.prepare("UPDATE grader_workers SET last_seen_at=? WHERE id=?").bind(now(), worker.id).run(); return worker;
}

assignmentRoutes.post("/grader/readiness", zValidator("json", graderReadinessSchema), async (c) => {
  const worker = await requireGrader(c), input = c.req.valid("json"), timestamp = now();
  await c.env.DB.prepare("UPDATE grader_workers SET capabilities_json=?,is_ready=?,environment_json=?,last_seen_at=? WHERE id=?")
    .bind(json(input.capabilities), input.ready ? 1 : 0, json(input.environment), timestamp, worker.id).run();
  return c.json({ accepted: true });
});
async function verifyLease(c: any, jobId: number, workerId: string) {
  const token = c.req.header("X-Grader-Lease") ?? "";
  const tokenHash = await sha256(token);
  const job = await c.env.DB.prepare("SELECT lease_token_hash,lease_expires_at FROM grading_jobs WHERE id=? AND worker_id=? AND status='running'")
    .bind(jobId, workerId).first() as { lease_token_hash: string; lease_expires_at: number } | null;
  if (!job || now() >= job.lease_expires_at || !secureEqual(new TextEncoder().encode(tokenHash), new TextEncoder().encode(job.lease_token_hash)))
    throw new ApiError(409, "LEASE_INVALID", "Lease отсутствует или истёк");
  return { ...job, tokenHash };
}

assignmentRoutes.get("/grader/jobs/candidates", async (c) => {
  const worker = await requireGrader(c); const timestamp = now();
  if (!worker.is_ready) return c.json({ items: [] });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE submissions SET status='queued' WHERE id IN(SELECT submission_id FROM grading_jobs WHERE status='running' AND lease_expires_at<=?)").bind(timestamp),
    c.env.DB.prepare("UPDATE grading_jobs SET status='queued',current_stage='queued',public_stage_message='Проверка возвращена в очередь',worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,heartbeat_at=NULL,started_at=NULL WHERE status='running' AND lease_expires_at<=?").bind(timestamp),
  ]);
  const rows = await c.env.DB.prepare(
    `SELECT j.id job_id,j.created_at,av.runtime_profile,av.environment_version,av.grader_path,av.resource_policy_json resource_policy
     FROM grading_jobs j JOIN submissions sub ON sub.id=j.submission_id JOIN assignment_versions av ON av.id=sub.assignment_version_id
     WHERE j.status='queued' AND (j.next_retry_at IS NULL OR j.next_retry_at<=?)
       AND av.runtime_profile IN (SELECT value FROM json_each(?)) ORDER BY j.id LIMIT 50`,
  ).bind(timestamp, worker.capabilities_json).all<any>();
  return c.json({ items: rows.results.map((r) => ({ ...r, resource_policy: JSON.parse(r.resource_policy), resource_policy_json: undefined })) });
});

assignmentRoutes.post("/grader/jobs/:id/claim", zValidator("json", graderClaimSchema), async (c) => {
  const worker = await requireGrader(c), lease = randomToken(32), timestamp = now(), seconds = c.req.valid("json").lease_seconds;
  const result = await c.env.DB.prepare(
    `UPDATE grading_jobs SET status='running',worker_id=?,lease_token_hash=?,lease_expires_at=?,heartbeat_at=?,started_at=coalesce(started_at,?),claim_attempts=claim_attempts+1
     WHERE id=? AND status='queued' AND (next_retry_at IS NULL OR next_retry_at<=?)
       AND EXISTS(SELECT 1 FROM submissions sub JOIN assignment_versions av ON av.id=sub.assignment_version_id
         WHERE sub.id=grading_jobs.submission_id AND av.runtime_profile IN (SELECT value FROM json_each(?)))`,
  ).bind(worker.id, await sha256(lease), timestamp + seconds, timestamp, timestamp, Number(c.req.param("id")), timestamp, worker.capabilities_json).run();
  if (!result.meta.changes) throw new ApiError(409, "JOB_ALREADY_CLAIMED", "Job уже забрана другим Worker");
  await c.env.DB.prepare("UPDATE submissions SET status='grading' WHERE id=(SELECT submission_id FROM grading_jobs WHERE id=?)")
    .bind(Number(c.req.param("id"))).run();
  const payload = await c.env.DB.prepare(
    `SELECT j.id job_id,sub.id submission_id,sub.repo_url,sub.commit_sha,sub.attempt_number,av.id assignment_version_id,
      av.grader_contract_json,av.runtime_profile,av.dependency_policy_json,av.resource_policy_json,
      av.grader_repository,av.grader_commit_sha,av.grader_path,av.grader_entrypoint,av.private_grader_config_json,av.review_focus,av.rubric_definition_json,
      av.grading_pipeline_json,av.llm_pipeline_json,av.achievement_definitions_json,a.title,a.description
     FROM grading_jobs j JOIN submissions sub ON sub.id=j.submission_id JOIN assignment_versions av ON av.id=sub.assignment_version_id
     JOIN assignments a ON a.id=av.assignment_id WHERE j.id=?`,
  ).bind(Number(c.req.param("id"))).first<any>();
  return c.json({ ...payload, grader_contract: JSON.parse(payload.grader_contract_json), dependency_policy: JSON.parse(payload.dependency_policy_json),
    resource_policy: JSON.parse(payload.resource_policy_json), private_grader_config: JSON.parse(payload.private_grader_config_json), rubric_definition: JSON.parse(payload.rubric_definition_json),
    grading_pipeline: JSON.parse(payload.grading_pipeline_json), llm_pipeline: JSON.parse(payload.llm_pipeline_json), achievement_definitions: JSON.parse(payload.achievement_definitions_json),
    grader_contract_json: undefined, dependency_policy_json: undefined, resource_policy_json: undefined, private_grader_config_json: undefined, rubric_definition_json: undefined,
    grading_pipeline_json: undefined, llm_pipeline_json: undefined, achievement_definitions_json: undefined,
    lease_token: lease, lease_expires_at: timestamp + seconds });
});

assignmentRoutes.post("/grader/jobs/:id/heartbeat", zValidator("json", graderHeartbeatSchema), async (c) => {
  const worker = await requireGrader(c), id = Number(c.req.param("id")); const lease = await verifyLease(c, id, worker.id);
  const timestamp = now(), expires = timestamp + c.req.valid("json").lease_seconds;
  const result = await c.env.DB.prepare("UPDATE grading_jobs SET heartbeat_at=?,lease_expires_at=? WHERE id=? AND worker_id=? AND status='running' AND lease_token_hash=? AND lease_expires_at>?")
    .bind(timestamp, expires, id, worker.id, lease.tokenHash, timestamp).run();
  if (!result.meta.changes) throw new ApiError(409, "LEASE_INVALID", "Lease изменён или истёк");
  return c.json({ lease_expires_at: expires });
});

assignmentRoutes.post("/grader/jobs/:id/progress", zValidator("json", graderProgressSchema), async (c) => {
  const worker = await requireGrader(c), id = Number(c.req.param("id")), input = c.req.valid("json");
  const lease = await verifyLease(c, id, worker.id), timestamp = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE grading_jobs SET current_stage=?,public_stage_message=? WHERE id=? AND worker_id=? AND status='running' AND lease_token_hash=? AND lease_expires_at>?")
      .bind(input.stage, input.message, id, worker.id, lease.tokenHash, timestamp),
    c.env.DB.prepare(
      `INSERT INTO submission_stage_events(submission_id,grading_job_id,stage,outcome,public_summary,created_at)
       SELECT submission_id,id,?,'running',?,? FROM grading_jobs WHERE id=? AND worker_id=? AND status='running' AND lease_token_hash=? AND lease_expires_at>?`,
    ).bind(input.stage, input.message, timestamp, id, worker.id, lease.tokenHash, timestamp),
  ]);
  if (!results[0]?.meta.changes) throw new ApiError(409, "LEASE_INVALID", "Lease изменён или истёк");
  return c.json({ accepted: true });
});

assignmentRoutes.post("/grader/jobs/:id/security-events", zValidator("json", graderSecurityEventsSchema), async (c) => {
  const worker = await requireGrader(c), id = Number(c.req.param("id")), input = c.req.valid("json");
  const lease = await verifyLease(c, id, worker.id), timestamp = now();
  const statements = input.events.map((event) => c.env.DB.prepare(
    `INSERT INTO submission_security_events(id,submission_id,grading_job_id,severity,code,stage,source_path,source_line,private_details_json,created_at)
     SELECT ?,submission_id,id,?,?,?,?,?,?,? FROM grading_jobs
     WHERE id=? AND worker_id=? AND status='running' AND lease_token_hash=? AND lease_expires_at>?`,
  ).bind(uuid(), event.severity, event.code, event.stage, event.source_path ?? null, event.source_line ?? null,
    json(event.details), timestamp, id, worker.id, lease.tokenHash, timestamp));
  const results = await c.env.DB.batch(statements);
  if (!results.some((result) => result.meta.changes)) throw new ApiError(409, "LEASE_INVALID", "Lease изменён или истёк");
  return c.json({ accepted: results.reduce((sum, result) => sum + Number(result.meta.changes), 0) });
});

assignmentRoutes.post("/grader/jobs/:id/llm-initial", zValidator("json", graderLlmInitialSchema), async (c) => {
  const worker = await requireGrader(c), id = Number(c.req.param("id")), input = c.req.valid("json"), timestamp = now();
  const lease = await verifyLease(c, id, worker.id), action = String(input.result.next_action ?? "");
  if (!["ask_student", "finalize"].includes(action)) throw new ApiError(400, "LLM_RESULT_INVALID", "Недопустимое действие initial review");
  const job = await c.env.DB.prepare("SELECT submission_id FROM grading_jobs WHERE id=?").bind(id).first<{ submission_id: string }>();
  const version = await c.env.DB.prepare("SELECT rubric_definition_json,llm_pipeline_json FROM assignment_versions WHERE id=(SELECT assignment_version_id FROM submissions WHERE id=?)").bind(job!.submission_id).first<{ rubric_definition_json: string; llm_pipeline_json: string }>();
  const rubricVersion = JSON.parse(version!.rubric_definition_json).version, sessionId = uuid();
  const state = action === "ask_student" ? "awaiting_answer_1" : "completed";
  if (action === "finalize" && !input.assessment) throw new ApiError(400, "ASSESSMENT_REQUIRED", "Для финального review требуется единый assessment");
  const finalResult = action === "finalize" ? { reviewer: input.result, assessment: input.assessment!.result, assessment_meta: { provider: input.assessment!.provider, model: input.assessment!.model, prompt_version: input.assessment!.prompt_version, input_hash: input.assessment!.input_hash } } : null;
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO llm_review_sessions(id,submission_id,state,rubric_version,prompt_version,provider,model,question_count,input_hash,final_result_json,state_json,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(sessionId, job!.submission_id, state, rubricVersion, input.prompt_version, input.provider, input.model, action === "ask_student" ? 1 : 0, input.input_hash, finalResult ? json(finalResult) : null, json({ steps: [input.result] }), timestamp, timestamp, action === "finalize" ? timestamp : null),
    c.env.DB.prepare("INSERT INTO llm_review_steps(id,review_session_id,step_number,stage,input_hash,provider,model,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(uuid(), sessionId, 0, "initial", input.input_hash, input.provider, input.model, json(input.result), timestamp),
    c.env.DB.prepare("UPDATE submissions SET status=? WHERE id=? AND status='grading'").bind(action === "ask_student" ? "awaiting_clarification" : "awaiting_teacher_review", job!.submission_id),
    c.env.DB.prepare("INSERT INTO submission_stage_events(submission_id,grading_job_id,stage,outcome,public_summary,created_at) VALUES(?,?,?,?,?,?)")
      .bind(job!.submission_id, id, "llm", action === "ask_student" ? "running" : "passed", action === "ask_student" ? "LLM сформировал уточняющий вопрос" : "LLM завершил анализ работы", timestamp),
  ];
  const llmPipeline = JSON.parse(version!.llm_pipeline_json);
  const configuredDeadline = Number(llmPipeline.answer_deadline_seconds ?? c.env.LLM_ANSWER_DEADLINE_SECONDS ?? "86400");
  const answerWindow = Number.isInteger(configuredDeadline) && configuredDeadline >= 60 && configuredDeadline <= 604800 ? configuredDeadline : 86400;
  if (action === "ask_student") {
    if (!llmPipeline.enabled || Number(llmPipeline.max_rounds ?? 0) < 1)
      throw new ApiError(400, "LLM_RESULT_INVALID", "Вопросы отключены настройками LLM pipeline");
    const clarification: any = input.result.clarification;
    if (!clarification || typeof clarification.question !== "string" || clarification.question.length < 10) throw new ApiError(400, "LLM_RESULT_INVALID", "LLM не сформировала корректный вопрос");
    statements.push(c.env.DB.prepare("INSERT INTO llm_clarifications(id,review_session_id,question_number,question,private_expected_topics_json,asked_at,answer_deadline_at) VALUES(?,?,?,?,?,?,?)")
      .bind(uuid(), sessionId, 1, clarification.question, json(clarification.expected_topics ?? []), timestamp, timestamp + answerWindow));
    const submission = await c.env.DB.prepare("SELECT student_id FROM submissions WHERE id=?").bind(job!.submission_id).first<{ student_id: string }>();
    statements.push(...notificationStatements(c.env.DB, { id: uuid(), studentId: submission!.student_id, kind: "clarification", title: "Новый вопрос по лабораторной", message: `Лучше ответить как можно быстрее: контекст проверки хранится ограниченное время. Крайний срок — ${new Date((timestamp + answerWindow) * 1000).toISOString()}.`, entityKind: "submission", entityId: job!.submission_id, dedupeKey: `submission:${job!.submission_id}:question:1`, timestamp }));
  }
  for (const attempt of input.attempts) statements.push(c.env.DB.prepare("INSERT INTO llm_provider_attempts(id,review_session_id,stage,provider,model,outcome,input_hash,prompt_version,input_tokens,output_tokens,latency_ms,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uuid(), sessionId, "initial", String(attempt.provider ?? "unknown"), String(attempt.model ?? "unknown"), String(attempt.outcome ?? "unknown"), input.input_hash, input.prompt_version, attempt.input_tokens ?? null, attempt.output_tokens ?? null, attempt.latency_ms ?? null, attempt.error_code ?? null, timestamp));
  for (const attempt of input.assessment?.attempts ?? []) statements.push(c.env.DB.prepare("INSERT INTO llm_provider_attempts(id,review_session_id,stage,provider,model,outcome,input_hash,prompt_version,input_tokens,output_tokens,latency_ms,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uuid(), sessionId, "assessment", String(attempt.provider ?? "unknown"), String(attempt.model ?? "unknown"), String(attempt.outcome ?? "unknown"), input.assessment!.input_hash, input.assessment!.prompt_version, attempt.input_tokens ?? null, attempt.output_tokens ?? null, attempt.latency_ms ?? null, attempt.error_code ?? null, timestamp));
  statements.push(...await llmAchievementStatements(c.env.DB, job!.submission_id, input.result, "initial", timestamp));
  await c.env.DB.batch(statements);
  return c.json({ accepted: true, state, answer_deadline_at: action === "ask_student" ? timestamp + answerWindow : null });
});

assignmentRoutes.get("/grader/llm-reviews/candidates", async (c) => {
  const worker = await requireGrader(c), timestamp = now();
  if (!worker.is_ready) return c.json({ items: [] });
  const rows = await c.env.DB.prepare(
    `SELECT lrs.id,lrs.state,lrs.updated_at,av.runtime_profile
     FROM llm_review_sessions lrs JOIN submissions sub ON sub.id=lrs.submission_id
     JOIN assignment_versions av ON av.id=sub.assignment_version_id
     WHERE lrs.state IN('reviewing_answer_1','reviewing_answer_2')
       AND (lrs.lease_expires_at IS NULL OR lrs.lease_expires_at<=?)
       AND av.runtime_profile IN (SELECT value FROM json_each(?))
     ORDER BY lrs.updated_at LIMIT 50`,
  ).bind(timestamp, worker.capabilities_json).all();
  return c.json({ items: rows.results });
});

assignmentRoutes.post("/grader/llm-reviews/:id/claim", zValidator("json", graderClaimSchema), async (c) => {
  const worker = await requireGrader(c), timestamp = now(), lease = randomToken(32), seconds = c.req.valid("json").lease_seconds;
  const updated = await c.env.DB.prepare(
    `UPDATE llm_review_sessions SET worker_id=?,lease_token_hash=?,lease_expires_at=?,updated_at=?
     WHERE id=? AND state IN('reviewing_answer_1','reviewing_answer_2') AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
  ).bind(worker.id, await sha256(lease), timestamp + seconds, timestamp, c.req.param("id"), timestamp).run();
  if (!updated.meta.changes) throw new ApiError(409, "LLM_REVIEW_ALREADY_CLAIMED", "LLM review уже обрабатывается");
  const payload = await c.env.DB.prepare(
    `SELECT lrs.id review_session_id,lrs.state,lrs.question_count,lrs.state_json,sub.id submission_id,sub.repo_url,sub.commit_sha,
      av.rubric_definition_json,av.llm_pipeline_json,av.achievement_definitions_json,a.description,
      gr.result_json deterministic_result_json,lc.id clarification_id,lc.question,lc.answer,lc.private_expected_topics_json
     FROM llm_review_sessions lrs JOIN submissions sub ON sub.id=lrs.submission_id
     JOIN assignment_versions av ON av.id=sub.assignment_version_id JOIN assignments a ON a.id=av.assignment_id
     JOIN grading_jobs gj ON gj.submission_id=sub.id JOIN grading_results gr ON gr.grading_job_id=gj.id
     JOIN llm_clarifications lc ON lc.review_session_id=lrs.id AND lc.question_number=lrs.question_count
     WHERE lrs.id=?`,
  ).bind(c.req.param("id")).first<any>();
  return c.json({ ...payload, state_snapshot: JSON.parse(payload.state_json), rubric_definition: JSON.parse(payload.rubric_definition_json),
    llm_pipeline: JSON.parse(payload.llm_pipeline_json), achievement_definitions: JSON.parse(payload.achievement_definitions_json),
    deterministic_result: JSON.parse(payload.deterministic_result_json), expected_topics: JSON.parse(payload.private_expected_topics_json),
    state_json: undefined, rubric_definition_json: undefined, llm_pipeline_json: undefined, achievement_definitions_json: undefined,
    deterministic_result_json: undefined, private_expected_topics_json: undefined, lease_token: lease, lease_expires_at: timestamp + seconds });
});

assignmentRoutes.post("/grader/llm-reviews/:id/result", zValidator("json", graderLlmFollowupSchema), async (c) => {
  const worker = await requireGrader(c), input = c.req.valid("json"), timestamp = now(), token = c.req.header("X-Grader-Lease");
  if (!token) throw new ApiError(409, "LEASE_INVALID", "Lease отсутствует");
  const session = await c.env.DB.prepare(
    `SELECT lrs.*,av.llm_pipeline_json FROM llm_review_sessions lrs JOIN submissions sub ON sub.id=lrs.submission_id
     JOIN assignment_versions av ON av.id=sub.assignment_version_id WHERE lrs.id=?`,
  ).bind(c.req.param("id")).first<any>();
  if (!session || session.worker_id !== worker.id || !session.lease_token_hash || timestamp >= Number(session.lease_expires_at) ||
      !secureEqual(new TextEncoder().encode(await sha256(token)), new TextEncoder().encode(session.lease_token_hash)))
    throw new ApiError(409, "LEASE_INVALID", "Lease отсутствует или истёк");
  if (input.answer_number !== session.question_count || session.state !== `reviewing_answer_${input.answer_number}`)
    throw new ApiError(409, "LLM_REVIEW_STATE_CHANGED", "Ответ уже обработан или изменился");
  const pipeline = JSON.parse(session.llm_pipeline_json), action = String(input.result.next_action ?? "");
  if (!['ask_student_again','finalize'].includes(action)) throw new ApiError(400, "LLM_RESULT_INVALID", "Недопустимый переход LLM review");
  if (action === "ask_student_again" && input.answer_number >= Number(pipeline.max_rounds ?? 0))
    throw new ApiError(400, "LLM_MAX_ROUNDS_REACHED", "Достигнут предел кругов вопросов");
  const nextQuestion = action === "ask_student_again" ? input.answer_number + 1 : input.answer_number;
  const nextState = action === "ask_student_again" ? `awaiting_answer_${nextQuestion}` : "completed";
  if (action === "finalize" && !input.assessment) throw new ApiError(400, "ASSESSMENT_REQUIRED", "Для финального review требуется единый assessment");
  const finalResult = action === "finalize" ? { reviewer: input.result, assessment: input.assessment!.result, assessment_meta: { provider: input.assessment!.provider, model: input.assessment!.model, prompt_version: input.assessment!.prompt_version, input_hash: input.assessment!.input_hash } } : null;
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE llm_review_sessions SET state=?,question_count=?,provider=?,model=?,prompt_version=?,input_hash=?,
       final_result_json=?,state_json=json_insert(state_json,'$.steps[#]',json(?)),updated_at=?,completed_at=?,worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL
       WHERE id=? AND state=? AND worker_id=? AND lease_token_hash=? AND lease_expires_at>?`,
    ).bind(nextState, nextQuestion, input.provider, input.model, input.prompt_version, input.input_hash,
      finalResult ? json(finalResult) : null, json(input.result), timestamp, action === "finalize" ? timestamp : null,
      session.id, session.state, worker.id, session.lease_token_hash, timestamp),
    c.env.DB.prepare("INSERT INTO llm_review_steps(id,review_session_id,step_number,stage,input_hash,provider,model,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(uuid(), session.id, input.answer_number, `answer_${input.answer_number}`, input.input_hash, input.provider, input.model, json(input.result), timestamp),
    c.env.DB.prepare("UPDATE llm_clarifications SET answer_evaluation_json=? WHERE review_session_id=? AND question_number=?")
      .bind(json(input.result), session.id, input.answer_number),
    c.env.DB.prepare("UPDATE submissions SET status=? WHERE id=?")
      .bind(action === "finalize" ? "awaiting_teacher_review" : "awaiting_clarification", session.submission_id),
    c.env.DB.prepare("INSERT INTO submission_stage_events(submission_id,stage,outcome,public_summary,created_at) VALUES(?,?,?,?,?)")
      .bind(session.submission_id, "llm", action === "finalize" ? "passed" : "running", action === "finalize" ? "Ответ разобран, анализ LLM завершён" : "Ответ разобран, задан дополнительный вопрос", timestamp),
  ];
  if (action === "ask_student_again") {
    const clarification: any = input.result.clarification;
    if (!clarification || typeof clarification.question !== "string" || clarification.question.length < 10)
      throw new ApiError(400, "LLM_RESULT_INVALID", "LLM не сформировала следующий вопрос");
    const deadline = Number(pipeline.answer_deadline_seconds ?? 86400);
    statements.push(c.env.DB.prepare("INSERT INTO llm_clarifications(id,review_session_id,question_number,question,private_expected_topics_json,asked_at,answer_deadline_at) VALUES(?,?,?,?,?,?,?)")
      .bind(uuid(), session.id, nextQuestion, clarification.question, json(clarification.expected_topics ?? []), timestamp, timestamp + deadline));
    const submission = await c.env.DB.prepare("SELECT student_id FROM submissions WHERE id=?").bind(session.submission_id).first<{ student_id: string }>();
    statements.push(...notificationStatements(c.env.DB, { id: uuid(), studentId: submission!.student_id, kind: "clarification", title: "Дополнительный вопрос по лабораторной", message: `Лучше ответить как можно быстрее: контекст проверки хранится ограниченное время. Крайний срок — ${new Date((timestamp + deadline) * 1000).toISOString()}.`, entityKind: "submission", entityId: session.submission_id, dedupeKey: `submission:${session.submission_id}:question:${nextQuestion}`, timestamp }));
  }
  for (const attempt of input.attempts) statements.push(c.env.DB.prepare("INSERT INTO llm_provider_attempts(id,review_session_id,stage,provider,model,outcome,input_hash,prompt_version,input_tokens,output_tokens,latency_ms,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uuid(), session.id, `answer_${input.answer_number}`, String(attempt.provider ?? "unknown"), String(attempt.model ?? "unknown"), String(attempt.outcome ?? "unknown"), input.input_hash, input.prompt_version, attempt.input_tokens ?? null, attempt.output_tokens ?? null, attempt.latency_ms ?? null, attempt.error_code ?? null, timestamp));
  for (const attempt of input.assessment?.attempts ?? []) statements.push(c.env.DB.prepare("INSERT INTO llm_provider_attempts(id,review_session_id,stage,provider,model,outcome,input_hash,prompt_version,input_tokens,output_tokens,latency_ms,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uuid(), session.id, "assessment", String(attempt.provider ?? "unknown"), String(attempt.model ?? "unknown"), String(attempt.outcome ?? "unknown"), input.assessment!.input_hash, input.assessment!.prompt_version, attempt.input_tokens ?? null, attempt.output_tokens ?? null, attempt.latency_ms ?? null, attempt.error_code ?? null, timestamp));
  statements.push(...await llmAchievementStatements(c.env.DB, session.submission_id, input.result, `answer_${input.answer_number}`, timestamp));
  const results = await c.env.DB.batch(statements);
  if (!results[0]?.meta.changes) throw new ApiError(409, "LLM_REVIEW_STATE_CHANGED", "Ответ уже обработан");
  return c.json({ accepted: true, state: nextState });
});

assignmentRoutes.post("/grader/jobs/:id/result", zValidator("json", gradingResultSchema), async (c) => {
  const worker = await requireGrader(c), id = Number(c.req.param("id")), received = c.req.valid("json");
  const input = enforceCriticalGate(received);
  const body = json(input);
  const existing = await c.env.DB.prepare(
    "SELECT gr.result_json,j.worker_id FROM grading_results gr JOIN grading_jobs j ON j.id=gr.grading_job_id WHERE gr.grading_job_id=?",
  ).bind(id).first<{ result_json: string; worker_id: string }>();
  if (existing) {
    if (existing.worker_id !== worker.id || existing.result_json !== body)
      throw new ApiError(409, "RESULT_CONFLICT", "Для Job уже сохранён другой результат");
    return c.json({ accepted: true, replay: true });
  }
  const lease = await verifyLease(c, id, worker.id), timestamp = now(), resultId = uuid();
  const achievementContext = await c.env.DB.prepare(
    `SELECT sub.id submission_id,sub.student_id,sub.assignment_version_id,av.assignment_id,ap.course_run_id,cr.course_id,av.achievement_definitions_json
     FROM grading_jobs j JOIN submissions sub ON sub.id=j.submission_id
     JOIN assignment_versions av ON av.id=sub.assignment_version_id
     JOIN assignment_publications ap ON ap.id=sub.assignment_publication_id JOIN course_runs cr ON cr.id=ap.course_run_id WHERE j.id=?`,
  ).bind(id).first<any>();
  const definitions = new Map<string, any>((JSON.parse(achievementContext.achievement_definitions_json) as any[]).map((item) => [item.id, item]));
  const achievementStatements: D1PreparedStatement[] = [];
  for (const trigger of input.achievement_triggers) {
    const definition = definitions.get(trigger.achievement_id);
    const sourceKind = trigger.source.split(":", 1)[0];
    if (!definition || !definition.allowed_sources.includes(sourceKind)) {
      achievementStatements.push(c.env.DB.prepare(
        `INSERT INTO submission_security_events(id,submission_id,grading_job_id,severity,code,stage,private_details_json,created_at)
         VALUES(?,?,?,'warning','ACHIEVEMENT_TRIGGER_UNAVAILABLE','achievements',?,?)`,
      ).bind(uuid(), achievementContext.submission_id, id, json({ achievement_id: trigger.achievement_id, source: sourceKind }), timestamp));
      continue;
    }
    const status = achievementNominationStatus(trigger.source);
    achievementStatements.push(c.env.DB.prepare(
      `INSERT INTO assignment_achievement_nominations(id,submission_id,achievement_id,source,reason_code,evidence_ids_json,status,created_at)
       VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(submission_id,achievement_id,source,reason_code) DO NOTHING`,
    ).bind(uuid(), achievementContext.submission_id, trigger.achievement_id, trigger.source, trigger.reason_code, json(trigger.evidence_ids), status, timestamp));
    if (status !== "accepted") continue;
    const idempotencyKey = definition.repeatability === "once_global"
      ? `${achievementContext.student_id}:${trigger.achievement_id}`
      : definition.repeatability === "once_per_course"
        ? `${achievementContext.student_id}:${achievementContext.course_id}:${trigger.achievement_id}`
      : definition.repeatability === "once_per_course_run"
        ? `${achievementContext.student_id}:${achievementContext.course_run_id}:${trigger.achievement_id}`
        : definition.repeatability === "once_per_assignment"
          ? `${achievementContext.student_id}:${achievementContext.assignment_id}:${trigger.achievement_id}`
          : `${achievementContext.submission_id}:${trigger.achievement_id}:${trigger.source}:${trigger.reason_code}`;
    achievementStatements.push(c.env.DB.prepare(
      `INSERT INTO assignment_achievement_awards(id,student_id,submission_id,assignment_version_id,course_run_id,achievement_id,namespace,
       definition_snapshot_json,evidence_ids_json,source,reason_code,idempotency_key,awarded_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
    ).bind(uuid(), achievementContext.student_id, achievementContext.submission_id, achievementContext.assignment_version_id,
      achievementContext.course_run_id, trigger.achievement_id, trigger.achievement_id.slice(0, trigger.achievement_id.lastIndexOf("/")),
      json(definition), json(trigger.evidence_ids), trigger.source, trigger.reason_code, idempotencyKey, timestamp));
  }
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO grading_results(id,grading_job_id,schema_version,outcome,result_json,received_at,public_summary,public_diagnostics_json,
       private_diagnostics_json,evidence_json,deterministic_gate,llm_eligible)
       SELECT ?,j.id,?,?,?,?,?,?,?,?,?,? FROM grading_jobs j WHERE j.id=? AND j.worker_id=? AND j.status='running' AND j.lease_token_hash=? AND j.lease_expires_at>?
       ON CONFLICT(grading_job_id) DO NOTHING`,
    ).bind(resultId, input.schema_version, input.outcome, body, timestamp, input.public_summary, json(input.public_diagnostics),
      json(input.private_diagnostics), json(input.evidence), input.deterministic_gate, input.llm_eligible ? 1 : 0,
      id, worker.id, lease.tokenHash, timestamp),
    c.env.DB.prepare("UPDATE grading_jobs SET status='completed',current_stage='completed',finished_at=?,lease_token_hash=NULL,lease_expires_at=NULL,heartbeat_at=NULL,next_retry_at=NULL WHERE id=? AND worker_id=? AND status='running' AND lease_token_hash=? AND lease_expires_at>?")
      .bind(timestamp, id, worker.id, lease.tokenHash, timestamp),
    c.env.DB.prepare("UPDATE submissions SET status=CASE WHEN ?='failed' THEN 'finalized' WHEN EXISTS(SELECT 1 FROM llm_review_sessions lrs WHERE lrs.submission_id=submissions.id AND lrs.state='awaiting_answer_1') THEN 'awaiting_clarification' ELSE 'awaiting_teacher_review' END,deterministic_status=? WHERE id=(SELECT submission_id FROM grading_jobs WHERE id=? AND status='completed') AND EXISTS(SELECT 1 FROM grading_results WHERE grading_job_id=?)")
      .bind(input.deterministic_gate, input.deterministic_gate, id, id),
    c.env.DB.prepare(
      `INSERT INTO submission_stage_events(submission_id,grading_job_id,stage,outcome,public_summary,created_at)
       SELECT submission_id,id,'tests',?,?,? FROM grading_jobs WHERE id=? AND status='completed'`,
    ).bind(input.deterministic_gate, input.public_summary || (input.deterministic_gate === "passed" ? "Автоматические тесты пройдены" : "Автоматические тесты не пройдены"), timestamp, id),
    ...achievementStatements,
  ]);
  if (!results[0]?.meta.changes) {
    const stored = await c.env.DB.prepare("SELECT result_json FROM grading_results WHERE grading_job_id=?").bind(id).first<{ result_json: string }>();
    if (stored?.result_json === body) return c.json({ accepted: true, replay: true });
    throw new ApiError(409, "LEASE_INVALID", "Lease изменён или истёк");
  }
  return c.json({ accepted: true, replay: false });
});

assignmentRoutes.post("/grader/jobs/:id/infra-failure", zValidator("json", graderInfraFailureSchema), async (c) => {
  const worker = await requireGrader(c), id = Number(c.req.param("id")); const lease = await verifyLease(c, id, worker.id); const timestamp = now();
  const job = await c.env.DB.prepare("SELECT infra_retry_count FROM grading_jobs WHERE id=?").bind(id).first<{ infra_retry_count: number }>();
  const retryCount = (job?.infra_retry_count ?? 0) + 1;
  const retryAt = timestamp + graderInfrastructureRetryDelaySeconds(retryCount);
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE grading_jobs SET status='queued',current_stage='infrastructure_retry',public_stage_message='Проверка ожидает исправный grader и будет продолжена автоматически',infra_retry_count=?,next_retry_at=?,infra_error_code=?,finished_at=?,worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,heartbeat_at=NULL WHERE id=? AND worker_id=? AND status='running' AND lease_token_hash=? AND lease_expires_at>?")
      .bind(retryCount, retryAt, c.req.valid("json").code, timestamp, id, worker.id, lease.tokenHash, timestamp),
    c.env.DB.prepare("UPDATE submissions SET status='queued' WHERE id=(SELECT submission_id FROM grading_jobs WHERE id=?)").bind(id),
    c.env.DB.prepare(
      `INSERT INTO submission_stage_events(submission_id,grading_job_id,stage,outcome,public_summary,created_at)
       SELECT submission_id,id,'infrastructure','waiting','Проверка ожидает исправный grader и будет продолжена автоматически',?
       FROM grading_jobs WHERE id=? AND NOT EXISTS(
         SELECT 1 FROM submission_stage_events event
         WHERE event.grading_job_id=grading_jobs.id AND event.stage='infrastructure' AND event.outcome='waiting'
       )`,
    ).bind(timestamp, id),
  ]);
  if (!results[0]?.meta.changes) throw new ApiError(409, "LEASE_INVALID", "Lease изменён или истёк");
  return c.json({ accepted: true, retrying: true, next_retry_at: retryAt });
});
