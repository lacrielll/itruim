import { z } from "zod";

export const questionTypeSchema = z.enum([
  "SINGLE",
  "MULTIPLE",
  "NUMERIC",
  "SHORT_TEXT",
]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const fioSchema = z
  .object({ fio: z.string().trim().min(3).max(240) })
  .strict();
export const studentLoginSchema = z
  .object({
    fio: z.string().trim().min(3).max(240),
    student_code: z.string().trim().length(12),
  })
  .strict();
export const courseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,99}$/).optional(),
}).strict();
export const courseRunSchema = z
  .object({ course_id: z.string().uuid(), name: z.string().trim().min(1).max(200) })
  .strict();
export const groupSchema = z
  .object({
    course_run_id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["lecture", "practice"]),
    join_requests_enabled: z.boolean().default(true),
  })
  .strict();
export const teacherCreateSchema = z
  .object({
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
    display_name: z.string().trim().min(1).max(200),
    password: z.string().min(12).max(1024),
  })
  .strict();
export const joinCodeSchema = z
  .object({ join_code: z.string().trim().min(6).max(32) })
  .strict();
export const membershipResolutionSchema = z
  .object({ decision: z.enum(["approved", "rejected"]) })
  .strict();
export const quizPublicationSchema = z
  .object({
    course_run_id: z.string().uuid(),
    target_all_course_run: z.boolean(),
    group_ids: z.array(z.string().uuid()).max(200),
    opens_at: z.number().int().nullable(),
    start_deadline_at: z.number().int().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.target_all_course_run && value.group_ids.length === 0)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["group_ids"], message: "Выберите хотя бы одну группу или аудиторию «Все»" });
    if (value.opens_at != null && value.start_deadline_at != null && value.opens_at >= value.start_deadline_at)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["start_deadline_at"], message: "Время закрытия должно быть позже открытия" });
  });
const gitShaSchema = z.string().trim().toLowerCase().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const rubricDefinitionSchema = z.object({
  version: z.string().trim().min(1).max(100),
  criteria: z.array(z.object({
    id: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/), title: z.string().trim().min(1).max(300), description: z.string().max(4000),
    min_score: z.number().finite(), max_score: z.number().finite(), score_step: z.number().finite().positive(),
    required_evidence_types: z.array(z.enum(["code", "report", "deterministic_test", "runtime_metric", "contract_check", "student_answer", "grader_observation"])).max(20),
    clarification_allowed: z.boolean().default(true), student_visible: z.boolean().default(true),
  }).strict().refine((item) => item.max_score > item.min_score, { message: "max_score должен быть больше min_score" })).max(100),
}).strict().superRefine((value, ctx) => { const ids = value.criteria.map((item) => item.id); if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["criteria"], message: "ID критериев должны быть уникальны" }); });
const achievementIdSchema = z.string().trim().max(200).regex(/^(?:common|course\/[a-z0-9][a-z0-9-]*|run\/[a-z0-9][a-z0-9-]*|assignment\/[a-z0-9][a-z0-9-]*|custom\/[a-z0-9][a-z0-9-]*)\/[a-z0-9][a-z0-9-]*$/);
const assignmentAchievementSchema = z.object({
  id: achievementIdSchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(5000),
  unlock_hint: z.string().trim().max(5000).default(""),
  emoji: z.string().max(32).nullable().default(null),
  image_key: z.string().max(300).nullable().default(null),
  theme: z.enum(["default", "success", "warning", "danger", "info"]).default("default"),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#38BDF8"),
  visibility: z.enum(["public", "hidden_until_awarded", "teacher_only"]).default("public"),
  repeatability: z.enum(["once_global", "once_per_course", "once_per_course_run", "once_per_assignment", "repeatable"]).default("once_per_course"),
  award_policy: z.enum(["automatic", "teacher_confirmation"]).default("automatic"),
  allowed_sources: z.array(z.enum(["grader", "runtime", "llm", "pipeline", "teacher", "platform"])).min(1).max(6),
  trigger: jsonObjectSchema.default({}),
}).strict();
const gradingPipelineSchema = z.object({
  version: z.string().min(1).max(100).default("v1"),
  stages: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    kind: z.enum(["contracts", "static", "tests", "runtime", "llm", "teacher", "custom"]),
    failure_policy: z.enum(["continue", "stop_on_critical", "teacher_review"]),
    handler: z.string().max(500).optional(),
  }).strict()).min(1).max(30),
}).strict();
const llmPipelineSchema = z.object({
  version: z.string().min(1).max(100).default("v1"),
  enabled: z.boolean(),
  preset: z.enum(["deterministic_only", "review_only", "one_clarification", "oral_defense", "custom"]),
  max_rounds: z.number().int().min(0).max(2),
  max_questions_per_round: z.number().int().min(1).max(4),
  answer_deadline_seconds: z.number().int().min(60).max(604800),
  final_decision: z.enum(["teacher", "llm_recommendation"]),
}).strict().superRefine((value, ctx) => {
  if ((!value.enabled || value.preset === "deterministic_only" || value.preset === "review_only") && value.max_rounds !== 0)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["max_rounds"], message: "В выбранном режиме вопросы отключены" });
});
export const assignmentCreateSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).default(""),
  slug: z.string().trim().optional(),
}).strict();
export const assignmentVersionSchema = z.object({
  specification: z.string().min(1).max(100000),
  starter_repository_url: z.string().url().max(2000).nullable(),
  starter_commit_sha: gitShaSchema.nullable(),
  grader_contract: jsonObjectSchema,
  runtime_profile: z.enum(["CPU", "GPU"]),
  environment_version: z.string().trim().min(1).max(100).default("cpu-v1"),
  dependency_policy: jsonObjectSchema,
  resource_policy: z.object({
    cpu_threads: z.number().int().min(1).max(64),
    ram_mb: z.number().int().min(64).max(262144),
    wall_time_sec: z.number().int().min(1).max(7200),
    pids: z.number().int().min(1).max(4096),
    gpu: z.object({
      required: z.boolean(),
      count: z.number().int().min(0).max(8),
      vram_mb: z.number().int().min(0).max(196608),
    }).strict(),
  }).strict(),
  rubric: z.string().max(50000),
  rubric_definition: rubricDefinitionSchema.default({ version: "v1", criteria: [] }),
  grading_pipeline: gradingPipelineSchema.default({ version: "v1", stages: [
    { id: "contracts", kind: "contracts", failure_policy: "stop_on_critical" },
    { id: "tests", kind: "tests", failure_policy: "stop_on_critical" },
    { id: "llm", kind: "llm", failure_policy: "teacher_review" },
  ] }),
  llm_pipeline: llmPipelineSchema.default({ version: "v1", enabled: true, preset: "one_clarification", max_rounds: 1, max_questions_per_round: 1, answer_deadline_seconds: 86400, final_decision: "teacher" }),
  achievement_definitions: z.array(assignmentAchievementSchema).max(100).superRefine((value, ctx) => {
    const ids = value.map((item) => item.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ID ачивок должны быть уникальны" });
  }).default([]),
  grader_repository: z.string().trim().min(1).max(2000),
  grader_commit_sha: gitShaSchema,
  grader_path: z.string().trim().min(1).max(500),
  grader_entrypoint: z.string().trim().min(1).max(500),
  private_grader_config: jsonObjectSchema,
  review_focus: z.string().max(20000),
}).strict().refine((v) => (v.starter_repository_url == null) === (v.starter_commit_sha == null), {
  message: "Starter repository и commit SHA задаются вместе",
});
export const assignmentPublicationSchema = z.object({
  course_run_id: z.string().uuid(),
  target_all_course_run: z.boolean(),
  group_ids: z.array(z.string().uuid()).max(200),
  opens_at: z.number().int().nullable(),
  due_at: z.number().int().nullable(),
  submission_cooldown_seconds: z.number().int().min(0).max(2592000),
}).strict().superRefine((value, ctx) => {
  if (!value.target_all_course_run && value.group_ids.length === 0)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["group_ids"], message: "Выберите аудиторию" });
  if (value.opens_at != null && value.due_at != null && value.opens_at >= value.due_at)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["due_at"], message: "Срок сдачи должен быть позже открытия" });
});
export const submissionCreateSchema = z.object({
  source_kind: z.enum(["repository", "local_upload"]).default("repository"),
  repo_url: z.string().trim().min(1).max(2000).optional(),
  commit_sha: gitShaSchema.optional(),
  local_upload_id: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/).optional(),
  local_upload_sha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  client_request_id: z.string().uuid(),
  policy_version: z.string().trim().min(1).max(100),
  policy_accepted: z.literal(true),
  email: z.string().trim().email().max(320).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.source_kind === "repository" && !value.repo_url)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Для repository нужен URL" });
  if (value.source_kind === "local_upload" && (!value.local_upload_id || !value.local_upload_sha))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Для локальной загрузки нужны upload ID и SHA" });
});

export const notificationPreferencesSchema = z.object({
  email: z.string().trim().email().max(320).nullable(),
  email_enabled: z.boolean(),
  telegram_enabled: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.email_enabled && !value.email) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Укажите email" });
});

export const clarificationAnswerSchema = z.object({
  answer: z.string().trim().min(20).max(20000),
}).strict();
export const courseAchievementCreateSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  unlock_hint: z.string().trim().min(1).max(2000),
  emoji: z.string().trim().min(1).max(16).default("✦"),
  accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#38BDF8"),
  image_key: z.string().max(300).nullable().default(null),
  applicability_scope: z.enum(["global_course", "selected_assignments"]),
  required_capability: z.enum(["any", "grader", "llm"]).default("any"),
  source_kind: z.enum(["grader", "runtime", "llm", "pipeline", "teacher", "platform"]),
  repeatability: z.enum(["once_per_course", "once_per_assignment", "repeatable"]).default("once_per_course"),
  trigger: jsonObjectSchema.default({}),
  assignment_ids: z.array(z.string().uuid()).max(200).default([]),
}).strict();
export const courseAchievementAwardSchema = z.object({
  student_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
}).strict();
export const assignmentAchievementBindingsSchema = z.object({
  achievement_ids: z.array(z.string().uuid()).max(200),
}).strict();
export const teacherSubmissionDecisionSchema = z.object({
  action: z.enum(["approve", "override_score", "manual_defense", "reject", "finalize_manual_defense"]),
  comment: z.string().trim().min(3).max(4000),
  score: z.object({ earned: z.number().finite().min(0).max(100), maximum: z.literal(100), criteria: z.record(z.string(), z.number().finite()).default({}) }).strict().optional(),
  manual_defense: z.object({ at: z.number().int(), location: z.string().trim().min(1).max(1000) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (["override_score", "finalize_manual_defense"].includes(value.action) && !value.score)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["score"], message: "Для этого решения требуется оценка" });
  if (value.action === "manual_defense" && !value.manual_defense)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manual_defense"], message: "Укажите время и место защиты" });
});
export const cooldownOverrideSchema = z.object({
  student_id: z.string().uuid(),
  assignment_publication_id: z.string().uuid(),
  waived_until: z.number().int(),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export const graderWorkerCreateSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const graderClaimSchema = z.object({ lease_seconds: z.number().int().min(30).max(300).default(120) }).strict();
export const graderHeartbeatSchema = z.object({ lease_seconds: z.number().int().min(30).max(300).default(120) }).strict();
export const graderReadinessSchema = z.object({
  ready: z.boolean(),
  capabilities: z.array(z.enum(["CPU", "GPU"])).min(1).max(2),
  environment: jsonObjectSchema.default({}),
}).strict();
export const graderProgressSchema = z.object({
  stage: z.enum(["repository", "contracts", "tests"]),
  message: z.string().trim().min(1).max(500),
}).strict();
export const publicDiagnosticSchema = z.object({
  code: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(4000),
  location: z.string().max(500).optional(),
  expected: z.string().max(2000).optional(),
  actual: z.string().max(2000).optional(),
  hint: z.string().max(2000).optional(),
  stage: z.enum(["repository", "contract", "import", "test", "resource", "artifact"]),
  severity: z.enum(["info", "warning", "critical"]).default("critical"),
}).strict();
const graderCheckSchema = z.object({
  id: z.string().max(200).optional(),
  name: z.string().max(300).optional(),
  category: z.string().max(100).optional(),
  severity: z.enum(["info", "warning", "critical"]).default("critical"),
  passed: z.boolean().optional(),
  status: z.string().max(100).optional(),
}).catchall(z.unknown());
export const gradingResultSchema = z.object({
  schema_version: z.literal(1),
  outcome: z.string().trim().min(1).max(100),
  score: z.object({ earned: z.number().finite().nonnegative(), maximum: z.number().finite().positive() }).strict().optional(),
  checks: z.array(graderCheckSchema).max(1000).default([]),
  metrics: jsonObjectSchema.default({}),
  resource_events: z.array(jsonObjectSchema).max(1000).default([]),
  achievement_triggers: z.array(z.object({
    achievement_id: achievementIdSchema,
    evidence_ids: z.array(z.string().min(1).max(300)).min(1).max(100),
    reason_code: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
    source: z.string().regex(/^(?:grader|runtime|llm|pipeline)(?::[a-zA-Z0-9_.-]+)?$/),
  }).strict()).max(100).default([]),
  deterministic_gate: z.enum(["passed", "failed"]).default("failed"),
  llm_eligible: z.boolean().default(false),
  public_summary: z.string().max(4000).default(""),
  public_diagnostics: z.array(publicDiagnosticSchema).max(200).default([]),
  private_diagnostics: z.array(jsonObjectSchema).max(200).default([]),
  evidence: jsonObjectSchema.default({}),
}).strict().superRefine((value, ctx) => {
  if (value.deterministic_gate !== "passed" && value.llm_eligible)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["llm_eligible"], message: "LLM запрещён без пройденного deterministic gate" });
});
export const graderInfraFailureSchema = z.object({ code: z.string().trim().min(1).max(100) }).strict();
export const graderSecurityEventsSchema = z.object({ events: z.array(z.object({
  severity: z.enum(["info", "warning", "critical"]),
  code: z.string().trim().min(1).max(100),
  stage: z.string().trim().min(1).max(100),
  source_path: z.string().max(500).optional(),
  source_line: z.number().int().positive().optional(),
  details: jsonObjectSchema.default({}),
}).strict()).min(1).max(200) }).strict();
export const graderLlmInitialSchema = z.object({
  deterministic_gate: z.literal("passed"),
  result: jsonObjectSchema,
  provider: z.string().min(1).max(100), model: z.string().min(1).max(300),
  input_hash: z.string().regex(/^[0-9a-f]{64}$/), prompt_version: z.string().min(1).max(100),
  attempts: z.array(jsonObjectSchema).max(20),
  assessment: z.object({ result: jsonObjectSchema, provider: z.string().min(1).max(100), model: z.string().min(1).max(300), input_hash: z.string().regex(/^[0-9a-f]{64}$/), prompt_version: z.string().min(1).max(100), attempts: z.array(jsonObjectSchema).max(20) }).strict().optional(),
}).strict();
export const graderLlmFollowupSchema = graderLlmInitialSchema.omit({ deterministic_gate: true }).extend({
  answer_number: z.number().int().min(1).max(2),
}).strict();
export const duplicateDecisionSchema = z.object({
  decision: z.enum(["allow", "reject"]),
  comment: z.string().trim().max(2000).optional(),
}).strict();
export const adminLoginSchema = z
  .object({
    username: z.string().min(1).max(100),
    password: z.string().min(1).max(1024),
  })
  .strict();
export const teacherLoginSchema = adminLoginSchema;

const optionSchema = z
  .object({
    id: z.string().uuid().optional(),
    text: z.string().trim().min(1).max(1000),
    is_correct: z.boolean(),
  })
  .strict();
export const questionInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SINGLE"),
      text: z.string().trim().min(1).max(5000),
      points: z.number().int().positive().max(10000),
      options: z.array(optionSchema).min(2).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("MULTIPLE"),
      text: z.string().trim().min(1).max(5000),
      points: z.number().int().positive().max(10000),
      options: z.array(optionSchema).min(3).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("NUMERIC"),
      text: z.string().trim().min(1).max(5000),
      points: z.number().int().positive().max(10000),
      numeric_kind: z.enum(["INTEGER", "FLOAT"]),
      correct_value: z.number().finite(),
      absolute_tolerance: z.number().finite().nonnegative(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.numeric_kind !== "INTEGER") return;
      if (!Number.isInteger(value.correct_value))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correct_value"],
          message: "Для целого ответа нужно целое правильное значение",
        });
      if (value.absolute_tolerance !== 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["absolute_tolerance"],
          message: "Для целого ответа допуск всегда равен 0",
        });
    }),
  z
    .object({
      type: z.literal("SHORT_TEXT"),
      text: z.string().trim().min(1).max(5000),
      points: z.number().int().positive().max(10000),
      answers: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
    })
    .strict(),
]);
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const quizCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10000).default(""),
    slug: z.string().trim().optional(),
  })
  .strict();
export const versionSettingsSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10000),
    time_per_question_seconds: z.number().int().min(5).max(3600),
    shuffle_questions: z.boolean(),
    shuffle_options: z.boolean(),
    failure_barrier_enabled: z.boolean(),
    success_barrier_correct_answers: z.number().int().positive().max(500),
    show_answer_review_after_submit: z.boolean(),
  })
  .strict();
export const availabilitySchema = z
  .object({
    opens_at: z.number().int().nullable(),
    start_deadline_at: z.number().int().nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.opens_at == null ||
      v.start_deadline_at == null ||
      v.opens_at < v.start_deadline_at,
    { message: "opens_at должен быть раньше start_deadline_at" },
  );
export const achievementSchema = z
  .object({
    min_correct_answers: z.number().int().min(0).max(500),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(5000),
    emoji: z.string().max(32).nullable().optional(),
    theme: z
      .enum(["default", "success", "warning", "danger", "info"])
      .nullable()
      .optional(),
    accent_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    image_key: z.string().max(200).nullable().optional(),
  })
  .strict();

export const doubleFailureAchievementSchema = achievementSchema.omit({
  min_correct_answers: true,
});

export const profileVisibilitySchema = z
  .object({ is_public: z.boolean() })
  .strict();

export const answerInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SINGLE"), optionId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal("MULTIPLE"),
      optionIds: z.array(z.string().uuid()).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("NUMERIC"),
      value: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({ type: z.literal("SHORT_TEXT"), text: z.string().max(5000) })
    .strict(),
]);
export type AnswerInput = z.infer<typeof answerInputSchema>;
export const submitSchema = z
  .object({ answers: z.record(z.string().uuid(), answerInputSchema) })
  .strict();

export const resultFiltersSchema = z.object({
  quiz_id: z.string().uuid().optional(),
  version_id: z.string().uuid().optional(),
  student: z.string().max(240).optional(),
  attempt_no: z.coerce.number().int().min(1).max(2).optional(),
  min_percent_bp: z.coerce.number().int().min(0).max(10000).optional(),
  max_percent_bp: z.coerce.number().int().min(0).max(10000).optional(),
  achievement_id: z.string().uuid().optional(),
  include_names: z.enum(["true", "false"]).default("false"),
  view: z.enum(["best", "attempts"]).default("best"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    request_id: string;
    fields?: unknown;
  };
};
