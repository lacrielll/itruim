import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { normalizeDisplay, normalizeText, shuffle } from "../src/worker/lib";
import { B2MediaStorage } from "../src/worker/media-storage";
import { hashPassword, verifyPassword } from "../src/worker/auth";
import { achievementNominationStatus, canonicalRepository, enforceCriticalGate, graderInfrastructureRetryDelaySeconds } from "../src/worker/assignments";
import {
  questionEditorForm,
  questionEditorPayload,
} from "../src/web/question-form";

const origin = "http://quiz.test";

it("creates Cloudflare-compatible teacher password hashes", async () => {
  const hash = await hashPassword("Strong-teacher-password");
  expect(hash.startsWith("pbkdf2-sha256$100000$")).toBe(true);
  expect(await verifyPassword(hash, "Strong-teacher-password")).toBe(true);
  expect(await verifyPassword(hash, "wrong-password")).toBe(false);
});

it("blocks LLM whenever grader reports a critical failure", () => {
  const result = enforceCriticalGate({ checks: [{ severity: "critical", status: "failed" }], public_diagnostics: [], deterministic_gate: "passed" as const, llm_eligible: true });
  expect(result.deterministic_gate).toBe("failed");
  expect(result.llm_eligible).toBe(false);
  const warning = enforceCriticalGate({ checks: [{ severity: "warning", status: "failed" }], public_diagnostics: [], deterministic_gate: "passed" as const, llm_eligible: true });
  expect(warning.deterministic_gate).toBe("passed");
  expect(warning.llm_eligible).toBe(true);
});
it("requires teacher approval for LLM achievements and auto-awards objective achievements", () => {
  expect(achievementNominationStatus("llm:review")).toBe("pending_teacher");
  expect(achievementNominationStatus("grader:ast")).toBe("accepted");
  expect(achievementNominationStatus("runtime:limits")).toBe("accepted");
  expect(achievementNominationStatus("pipeline:custom")).toBe("accepted");
  expect(achievementNominationStatus("platform:submission.finalized")).toBe("accepted");
});
it("backs off infrastructure retries forever without exceeding one hour", () => {
  expect(graderInfrastructureRetryDelaySeconds(1)).toBe(15);
  expect(graderInfrastructureRetryDelaySeconds(2)).toBe(30);
  expect(graderInfrastructureRetryDelaySeconds(4)).toBe(120);
  expect(graderInfrastructureRetryDelaySeconds(9)).toBe(3600);
  expect(graderInfrastructureRetryDelaySeconds(1000)).toBe(3600);
});
let studentIp = 20;
async function call(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${origin}${path}`, init);
}
async function student(name: string) {
  const reg = await call("/api/public/students/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": `10.2.0.${studentIp++}`,
    },
    body: JSON.stringify({ fio: name }),
  });
  const data: any = await reg.json();
  const login = await call("/api/student/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fio: name, student_code: data.student_code }),
  });
  const auth: any = await login.json();
  return {
    name,
    code: data.student_code,
    cookie: login.headers.get("set-cookie")!.split(";")[0]!,
    csrf: auth.csrf_token,
  };
}

async function teacherLogin(username: string, password: string) {
  const login = await call("/api/teacher/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.8.0.${studentIp++}` },
    body: JSON.stringify({ username, password }),
  });
  const body: any = await login.json();
  return {
    status: login.status,
    cookie: login.headers.get("set-cookie")?.split(";")[0],
    csrf: body.csrf_token,
  };
}
function authHeaders(s: any, jsonBody = true) {
  return {
    Cookie: s.cookie,
    "X-CSRF-Token": s.csrf,
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
}
async function admin() {
  const login = await call("/api/admin/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "10.9.9.9",
    },
    body: JSON.stringify({
      username: "admin",
      password: "correct-horse-battery-staple",
    }),
  });
  const body: any = await login.json();
  return {
    cookie: login.headers.get("set-cookie")!.split(";")[0]!,
    csrf: body.csrf_token,
  };
}

describe("normalization and shuffle", () => {
  it("normalizes FIO and short text consistently", () => {
    expect(normalizeDisplay("  Иванов   Иван  ")).toBe("Иванов Иван");
    expect(normalizeText(" ЁЖ  Машинное  обучение ")).toBe(
      "еж машинное обучение",
    );
  });
  it("canonicalizes HTTPS and SSH spellings of the same repository", () => {
    expect(canonicalRepository("git@github.com:Foo/Bar.git").identity).toBe("github.com/foo/bar");
    expect(canonicalRepository("https://github.com/foo/bar/").identity).toBe("github.com/foo/bar");
    expect(() => canonicalRepository("http://127.0.0.1/repo/code")).toThrow("HTTPS");
  });
  it("returns a permutation without mutating input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(input);
  });
});

describe("student notification inbox", () => {
  it("lists notifications and lets only the owner mark them read", async () => {
    const s = await student("Уведомления Тестовый Студент");
    const row: any = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(s.code).first();
    await env.DB.prepare("INSERT INTO student_notifications(id,student_id,kind,title,message,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind("notification-test-1", row.id, "system", "Проверка", "Новое событие", "test:notification:1", 1).run();
    const inbox: any = await (await call("/api/student/notifications", { headers: { Cookie: s.cookie } })).json();
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0].title).toBe("Проверка");
    const read = await call("/api/student/notifications/notification-test-1/read", { method: "POST", headers: authHeaders(s, false) });
    expect(read.status).toBe(200);
    const updated: any = await (await call("/api/student/notifications", { headers: { Cookie: s.cookie } })).json();
    expect(updated.unread).toBe(0);
  });
  it("stores notification preferences without exposing Telegram chat IDs", async () => {
    const s = await student("Настройки Уведомлений Студент");
    const saved = await call("/api/student/notification-preferences", {
      method: "PUT", headers: authHeaders(s), body: JSON.stringify({ email: "student@example.test", email_enabled: true, telegram_enabled: false }),
    });
    expect(saved.status).toBe(200);
    const preferences: any = await (await call("/api/student/notification-preferences", { headers: { Cookie: s.cookie } })).json();
    expect(preferences).toMatchObject({ email: "student@example.test", email_enabled: true, telegram_enabled: false, telegram_linked: false });
    expect(preferences.telegram_chat_id).toBeUndefined();
    const row: any = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(s.code).first();
    await env.DB.prepare("UPDATE student_notification_preferences SET telegram_chat_id='123456789',telegram_enabled=1 WHERE student_id=?").bind(row.id).run();
    const unlinked = await call("/api/student/notification-preferences/telegram-link", { method: "DELETE", headers: authHeaders(s, false) });
    expect(unlinked.status).toBe(200);
    const after: any = await (await call("/api/student/notification-preferences", { headers: { Cookie: s.cookie } })).json();
    expect(after).toMatchObject({ telegram_linked: false, telegram_enabled: false });
  });
});

describe("Backblaze B2 storage adapter", () => {
  it("signs S3 requests without exposing credentials in object URLs", async () => {
    const requests: Request[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(init?.method === "GET" ? "image" : null, {
          status: 200,
          headers: { etag: '\"object-etag\"' },
        });
      },
    );
    try {
      const storage = new B2MediaStorage({
        endpoint: "https://s3.us-east-005.backblazeb2.com",
        region: "us-east-005",
        bucket: "private-quiz-media",
        keyId: "test-key-id",
        applicationKey: "test-application-key",
      });
      const bytes = new TextEncoder().encode("png").buffer as ArrayBuffer;
      await storage.put("achievement/id.png", bytes, {
        contentType: "image/png",
        sha256: "digest",
      });
      const object = await storage.get("achievement/id.png");
      await storage.delete("achievement/id.png");

      expect(requests.map((request) => request.method)).toEqual([
        "PUT",
        "GET",
        "DELETE",
      ]);
      expect(requests[0]!.url).toBe(
        "https://s3.us-east-005.backblazeb2.com/private-quiz-media/achievement/id.png",
      );
      expect(requests[0]!.headers.get("authorization")).toMatch(
        /^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/us-east-005\/s3\/aws4_request, SignedHeaders=.*?, Signature=[0-9a-f]{64}$/,
      );
      expect(requests[0]!.headers.get("x-amz-meta-sha256")).toBe("digest");
      expect(requests[0]!.url).not.toContain("test-application-key");
      expect(object?.etag).toBe('\"object-etag\"');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("rejects an insecure endpoint", () => {
    expect(
      () =>
        new B2MediaStorage({
          endpoint: "http://s3.example.test",
          region: "test",
          bucket: "bucket",
          keyId: "key",
          applicationKey: "secret",
        }),
    ).toThrow("HTTPS");
  });

  it("accepts the scheme-less endpoint displayed by Backblaze", () => {
    expect(
      () =>
        new B2MediaStorage({
          endpoint: "s3.us-east-005.backblazeb2.com",
          region: "us-east-005",
          bucket: "bucket",
          keyId: "key",
          applicationKey: "secret",
        }),
    ).not.toThrow();
  });
});

describe("question editor adapter", () => {
  it("converts D1 option rows to the strict mutation contract", () => {
    const id = crypto.randomUUID();
    const form = questionEditorForm({
      id: crypto.randomUUID(),
      position: 0,
      type: "SINGLE",
      text: "Вопрос",
      points: 1,
      options: [
        { id, position: 0, text: "Да", is_correct: 1 },
        { id: crypto.randomUUID(), position: 1, text: "Нет", is_correct: 0 },
      ],
    });
    const payload = questionEditorPayload(form);
    expect(payload.options).toEqual([
      { id, text: "Да", is_correct: true },
      { id: expect.any(String), text: "Нет", is_correct: false },
    ]);
    expect(payload.options[0]).not.toHaveProperty("position");
  });
});

describe("registration", () => {
  it("is idempotent and concurrency-safe by normalized FIO", async () => {
    const request = () =>
      call("/api/public/students/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "10.1.1.1",
        },
        body: JSON.stringify({ fio: "Параллельный   Студент Тестович" }),
      });
    const responses = await Promise.all(Array.from({ length: 5 }, request));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const rows = await Promise.all(
      responses.map((r) => r.json() as Promise<any>),
    );
    expect(new Set(rows.map((x) => x.student_code)).size).toBe(1);
    expect(rows[0].student_code).toMatch(
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/,
    );
    const count = await env.DB.prepare(
      "SELECT count(*) n FROM students WHERE fio_normalized=?",
    )
      .bind("параллельный студент тестович")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect((await request()).status).toBe(429);
  });
});

describe("group foundation and role isolation", () => {
  it("requires FIO together with the student code", async () => {
    const s = await student(`Студент Авторизация ${crypto.randomUUID()}`);
    const response = await call("/api/student/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.7.0.${studentIp++}` },
      body: JSON.stringify({ fio: "Совершенно Другой Человек", student_code: s.code }),
    });
    expect(response.status).toBe(401);
    expect((await response.json() as any).error.code).toBe("INVALID_STUDENT_CREDENTIALS");
  });

  it("isolates students and teachers despite forged group and request IDs", async () => {
    const a = await admin(), suffix = crypto.randomUUID().slice(0, 8);
    const courseResponse = await call("/api/admin/courses", {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ title: `Курс ${suffix}` }),
    });
    expect(courseResponse.status).toBe(201);
    const course: any = await courseResponse.json();
    const runResponse = await call("/api/admin/course-runs", {
      method: "POST", headers: authHeaders(a),
      body: JSON.stringify({ course_id: course.id, name: `Курс ролей ${suffix}` }),
    });
    expect(runResponse.status).toBe(201);
    const run: any = await runResponse.json();
    const createGroup = async (name: string, kind: "practice" | "lecture" = "practice") => {
      const response = await call("/api/admin/groups", {
        method: "POST", headers: authHeaders(a),
        body: JSON.stringify({ course_run_id: run.id, name, kind, join_requests_enabled: true }),
      });
      expect(response.status).toBe(201);
      return response.json() as Promise<any>;
    };
    const groupA = await createGroup(`Группа A ${suffix}`), groupB = await createGroup(`Группа B ${suffix}`, "lecture");
    const createTeacher = async (label: string) => {
      const username = `teacher-${label}-${suffix}`, password = `Strong-password-${label}-${suffix}`;
      const response = await call("/api/admin/teachers", {
        method: "POST", headers: authHeaders(a),
        body: JSON.stringify({ username, display_name: `Teacher ${label}`, password }),
      });
      expect(response.status).toBe(201);
      return { ...(await response.json() as any), username, password };
    };
    const teacherA = await createTeacher("a"), teacherB = await createTeacher("b");
    for (const [teacherId, groupId] of [[teacherA.id, groupA.id], [teacherB.id, groupB.id]]) {
      expect((await call(`/api/admin/teachers/${teacherId}/groups/${groupId}`, {
        method: "PUT", headers: authHeaders(a, false),
      })).status).toBe(204);
    }
    const ta = await teacherLogin(teacherA.username, teacherA.password);
    const tb = await teacherLogin(teacherB.username, teacherB.password);
    expect(ta.status).toBe(200); expect(tb.status).toBe(200);
    const teacherGroups: any = await (await call("/api/teacher/groups", { headers: { Cookie: ta.cookie! } })).json();
    expect(teacherGroups.items).toHaveLength(1);
    expect(teacherGroups.items[0].join_code).toBeUndefined();
    expect((await call(`/api/teacher/groups/${groupA.id}/submissions`, { headers: { Cookie: ta.cookie! } })).status).toBe(200);
    expect((await call(`/api/teacher/groups/${groupA.id}/quiz-gradebook`, { headers: { Cookie: ta.cookie! } })).status).toBe(404);
    expect((await call(`/api/teacher/groups/${groupB.id}/quiz-gradebook`, { headers: { Cookie: tb.cookie! } })).status).toBe(200);
    const gradebookCsv = await call(`/api/teacher/groups/${groupB.id}/quiz-gradebook.csv`, { headers: { Cookie: tb.cookie! } });
    expect(gradebookCsv.status).toBe(200);
    expect(gradebookCsv.headers.get("content-type")).toContain("text/csv");
    expect(await gradebookCsv.text()).toContain("Код студента");
    expect((await call(`/api/teacher/groups/${groupB.id}/submissions`, { headers: { Cookie: tb.cookie! } })).status).toBe(404);
    expect((await call(`/api/teacher/groups/${groupA.id}/students`, { headers: { Cookie: ta.cookie! } })).status).toBe(404);
    expect((await call("/api/admin/groups", { headers: { Cookie: ta.cookie! } })).status).toBe(401);

    const studentA = await student(`Ученик Группы А ${suffix}`), studentB = await student(`Ученик Группы Б ${suffix}`);
    const requestJoin = async (s: any, joinCode: string) => {
      const response = await call("/api/student/group-requests", {
        method: "POST", headers: authHeaders(s), body: JSON.stringify({ join_code: joinCode }),
      });
      expect(response.status).toBe(201);
      return response.json() as Promise<any>;
    };
    const requestA = await requestJoin(studentA, groupA.join_code);
    const requestB = await requestJoin(studentB, groupB.join_code);
    expect((await call(`/api/teacher/group-requests/${requestB.id}/resolve`, {
      method: "POST", headers: authHeaders(ta), body: JSON.stringify({ decision: "approved" }),
    })).status).toBe(404);
    expect((await call(`/api/teacher/group-requests/${requestA.id}/resolve`, {
      method: "POST", headers: authHeaders(ta), body: JSON.stringify({ decision: "approved" }),
    })).status).toBe(404);
    expect((await call(`/api/admin/group-requests/${requestA.id}/resolve`, {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ decision: "approved" }),
    })).status).toBe(200);
    const groupsA: any = await (await call("/api/student/groups", { headers: { Cookie: studentA.cookie } })).json();
    const groupsB: any = await (await call("/api/student/groups", { headers: { Cookie: studentB.cookie } })).json();
    expect(groupsA.memberships.map((g: any) => g.id)).toContain(groupA.id);
    expect(groupsA.memberships.map((g: any) => g.id)).not.toContain(groupB.id);
    expect(groupsB.memberships).toHaveLength(0);
    expect((await call(`/api/student/group-requests/${requestB.id}/cancel`, {
      method: "POST", headers: authHeaders(studentA, false),
    })).status).toBe(404);
    expect((await call(`/api/teacher/groups/${groupB.id}/requests`, { headers: { Cookie: tb.cookie! } })).status).toBe(404);
    expect((await call("/api/admin/group-requests", { headers: { Cookie: a.cookie } })).status).toBe(200);
    expect((await call(`/api/teacher/groups/${groupA.id}/achievements`, { headers: { Cookie: ta.cookie! } })).status).toBe(404);
    const achievementResponse = await call(`/api/admin/platform-achievements`, {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ course_id: course.id, title: "Помощник потока", description: "Помогает другим разобраться в материале", unlock_hint: "Помочь одногруппникам", emoji: "🤝", accent_color: "#38BDF8", image_key: null, applicability_scope: "global_course", required_capability: "any", source_kind: "teacher", repeatability: "once_per_course", trigger: {}, assignment_ids: [] }),
    });
    expect(achievementResponse.status).toBe(201);
    const achievement: any = await achievementResponse.json();
    const studentRow = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(studentA.code).first<any>();
    expect((await call(`/api/admin/platform-achievements/${achievement.id}/award`, {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ student_id: studentRow.id, reason: "Помощь одногруппникам" }),
    })).status).toBe(200);
    const profile: any = await (await call("/api/student/profile", { headers: { Cookie: studentA.cookie } })).json();
    expect(profile.badges.some((badge: any) => badge.badge_title === "Помощник потока")).toBe(true);
  });

  it("publishes a quiz to selected groups and to all CourseRun participants", async () => {
    const a = await admin(), suffix = crypto.randomUUID().slice(0, 8), t = Math.floor(Date.now() / 1000);
    const ids = await seedQuiz(`group-quiz-${suffix}`, { opens: null, deadline: null });
    const runId = crypto.randomUUID(), groupA = crypto.randomUUID(), groupB = crypto.randomUUID();
    const sA = await student(`Публикация Студент А ${suffix}`), sB = await student(`Публикация Студент Б ${suffix}`);
    const rowA = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(sA.code).first<{ id: string }>();
    const rowB = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(sB.code).first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO course_runs(id,name,created_at,updated_at) VALUES(?,?,?,?)").bind(runId, `Курс публикаций ${suffix}`, t, t),
      env.DB.prepare("INSERT INTO groups(id,course_run_id,name,kind,join_code,created_at,updated_at) VALUES(?,?,?,'lecture',?,?,?)").bind(groupA, runId, "Поток A", `A${suffix}`, t, t),
      env.DB.prepare("INSERT INTO groups(id,course_run_id,name,kind,join_code,created_at,updated_at) VALUES(?,?,?,'lecture',?,?,?)").bind(groupB, runId, "Поток B", `B${suffix}`, t, t),
      env.DB.prepare("INSERT INTO group_memberships(id,student_id,group_id,created_at,created_by_kind) VALUES(?,?,?,?,'admin')").bind(crypto.randomUUID(), rowA!.id, groupA, t),
      env.DB.prepare("INSERT INTO group_memberships(id,student_id,group_id,created_at,created_by_kind) VALUES(?,?,?,?,'admin')").bind(crypto.randomUUID(), rowB!.id, groupB, t),
    ]);
    let publish = await call(`/api/admin/quizzes/${ids.qid}/publications`, {
      method: "PUT", headers: authHeaders(a),
      body: JSON.stringify({ course_run_id: runId, target_all_course_run: false, group_ids: [groupA], opens_at: null, start_deadline_at: null }),
    });
    expect(publish.status).toBe(200);
    expect((await call(`/api/student/quizzes/group-quiz-${suffix}/access`, { headers: { Cookie: sA.cookie } })).status).toBe(200);
    expect((await (await call(`/api/student/quizzes/group-quiz-${suffix}/access`, { headers: { Cookie: sB.cookie } })).json() as any).state).toBe("NOT_AVAILABLE");
    expect((await call(`/api/student/quizzes/group-quiz-${suffix}/attempts`, { method: "POST", headers: authHeaders(sB, false) })).status).toBe(403);
    const activitiesA: any = await (await call("/api/student/activities", { headers: { Cookie: sA.cookie } })).json();
    const activitiesB: any = await (await call("/api/student/activities", { headers: { Cookie: sB.cookie } })).json();
    expect(activitiesA.items.some((x: any) => x.quiz_id === ids.qid)).toBe(true);
    expect(activitiesB.items.some((x: any) => x.quiz_id === ids.qid)).toBe(false);

    publish = await call(`/api/admin/quizzes/${ids.qid}/publications`, {
      method: "PUT", headers: authHeaders(a),
      body: JSON.stringify({ course_run_id: runId, target_all_course_run: true, group_ids: [], opens_at: null, start_deadline_at: null }),
    });
    expect(publish.status).toBe(200);
    expect((await (await call(`/api/student/quizzes/group-quiz-${suffix}/access`, { headers: { Cookie: sB.cookie } })).json() as any).state).toBe("READY");
    const started: any = await (await call(`/api/student/quizzes/group-quiz-${suffix}/attempts`, { method: "POST", headers: authHeaders(sB, false) })).json();
    expect(started.state).toBe("ACTIVE");
    const stored = await env.DB.prepare("SELECT quiz_publication_id,group_id FROM quiz_attempts WHERE id=?").bind(started.attempt.id).first<any>();
    expect(stored.quiz_publication_id).toBeTruthy();
    expect(stored.group_id).toBe(groupB);
    await env.DB.prepare("UPDATE quiz_publications SET start_deadline_at=? WHERE id=?").bind(t - 1, stored.quiz_publication_id).run();
    expect((await call(`/api/student/attempts/${started.attempt.id}`, { headers: { Cookie: sB.cookie } })).status).toBe(200);
    await env.DB.prepare("DELETE FROM group_memberships WHERE student_id=? AND group_id=?").bind(rowB!.id, groupB).run();
    expect((await call(`/api/student/attempts/${started.attempt.id}`, { headers: { Cookie: sB.cookie } })).status).toBe(403);
  });
});

describe("coding assignment control plane", () => {
  it("enforces immutable versions, cooldown, duplicate repos and atomic worker claims", async () => {
    const a = await admin(), suffix = crypto.randomUUID().slice(0, 8), timestamp = Math.floor(Date.now() / 1000);
    const courseId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO courses(id,slug,title,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(courseId, `assignment-${suffix}`, `Assignment ${suffix}`, timestamp, timestamp).run();
    const createdResponse = await call("/api/admin/assignments", {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ course_id: courseId, title: `Lab ${suffix}`, description: "Контрольная лабораторная" }),
    });
    expect(createdResponse.status).toBe(201);
    const created: any = await createdResponse.json();
    let version: any = await (await call(`/api/admin/assignment-versions/${created.draft_version_id}`, { headers: { Cookie: a.cookie } })).json();
    const versionInput = {
      specification: "Реализуйте функцию решения.", starter_repository_url: null, starter_commit_sha: null,
      grader_contract: { entrypoints: { solution: "solution:create" } }, runtime_profile: "CPU", environment_version: "cpu-v1",
      dependency_policy: { allow: ["numpy"] },
      resource_policy: { cpu_threads: 1, ram_mb: 512, wall_time_sec: 30, pids: 32, gpu: { required: false, count: 0, vram_mb: 0 } },
      rubric: "60 баллов за deterministic checks", grader_repository: "https://github.com/course/private-graders",
      grader_commit_sha: "a".repeat(40), grader_path: "lab1/v1", grader_entrypoint: "grade.py",
      private_grader_config: { dataset: "hidden-v1" }, review_focus: "hardcoding",
      achievement_definitions: [
        { id: "assignment/lab-1/all-functions", title: "Полный комплект", description: "Все функции прошли", allowed_sources: ["pipeline"], trigger: {} },
        { id: "assignment/lab-1/explainer", title: "Объясняет ясно", description: "Содержательное объяснение", allowed_sources: ["llm"], trigger: {} },
        { id: "assignment/lab-1/completed", title: "Лабораторная завершена", description: "Работа окончательно принята", allowed_sources: ["platform"], trigger: { source: "platform", event: "submission.finalized" } },
      ],
    };
    const saved = await call(`/api/admin/assignment-versions/${version.id}`, {
      method: "PUT", headers: authHeaders(a), body: JSON.stringify(versionInput),
    });
    expect(saved.status).toBe(428);
    version = await (await call(`/api/admin/assignment-versions/${version.id}`, {
      method: "PUT", headers: { ...authHeaders(a), "If-Match": String(version.revision) }, body: JSON.stringify(versionInput),
    })).json();
    const publishedResponse = await call(`/api/admin/assignment-versions/${version.id}/publish`, {
      method: "POST", headers: { ...authHeaders(a, false), "If-Match": String(version.revision) },
    });
    expect(publishedResponse.status).toBe(200);
    expect((await call(`/api/admin/assignment-versions/${version.id}`, {
      method: "PUT", headers: { ...authHeaders(a), "If-Match": String(version.revision + 1) }, body: JSON.stringify(versionInput),
    })).status).toBe(409);
    const nextDraftResponse = await call(`/api/admin/assignments/${created.id}/draft`, {
      method: "POST", headers: authHeaders(a, false),
    });
    expect(nextDraftResponse.status).toBe(201);
    const nextDraft: any = await nextDraftResponse.json();
    expect(nextDraft.version_number).toBe(2);
    expect(nextDraft.status).toBe("DRAFT");
    expect(nextDraft.private_grader_config).toEqual(versionInput.private_grader_config);
    const sameDraft: any = await (await call(`/api/admin/assignments/${created.id}/draft`, {
      method: "POST", headers: authHeaders(a, false),
    })).json();
    expect(sameDraft.id).toBe(nextDraft.id);

    const runId = crypto.randomUUID(), groupId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO course_runs(id,course_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").bind(runId, courseId, `Assignment course ${suffix}`, timestamp, timestamp),
      env.DB.prepare("INSERT INTO groups(id,course_run_id,name,kind,join_code,created_at,updated_at) VALUES(?,?,?,'practice',?,?,?)")
        .bind(groupId, runId, `Practice ${suffix}`, `L${suffix}`, timestamp, timestamp),
    ]);
    const publicationResponse = await call(`/api/admin/assignment-versions/${version.id}/publications`, {
      method: "PUT", headers: authHeaders(a), body: JSON.stringify({ course_run_id: runId, target_all_course_run: true, group_ids: [], opens_at: null, due_at: null, submission_cooldown_seconds: 3600 }),
    });
    expect(publicationResponse.status).toBe(200);
    const publication: any = await publicationResponse.json();
    const s1 = await student(`Assignment Первый ${suffix}`), s2 = await student(`Assignment Второй ${suffix}`);
    const student1 = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(s1.code).first<{ id: string }>();
    const student2 = await env.DB.prepare("SELECT id FROM students WHERE student_code=?").bind(s2.code).first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO group_memberships(id,student_id,group_id,created_at,created_by_kind) VALUES(?,?,?,?,'admin')").bind(crypto.randomUUID(), student1!.id, groupId, timestamp),
      env.DB.prepare("INSERT INTO group_memberships(id,student_id,group_id,created_at,created_by_kind) VALUES(?,?,?,?,'admin')").bind(crypto.randomUUID(), student2!.id, groupId, timestamp),
    ]);
    const requestId = crypto.randomUUID();
    const submit = (studentAuth: any, repository: string, clientRequestId = crypto.randomUUID()) => call(`/api/student/assignment-publications/${publication.id}/submissions`, {
      method: "POST", headers: authHeaders(studentAuth), body: JSON.stringify({ repo_url: repository, commit_sha: "b".repeat(40), client_request_id: clientRequestId, policy_version: "2026-09-16-v1", policy_accepted: true, email: "student@example.test" }),
    });
    const first = await submit(s1, "https://github.com/Student/Solution.git", requestId);
    expect(first.status).toBe(201);
    const firstBody: any = await first.json();
    expect(firstBody.status).toBe("queued");
    const replay: any = await (await submit(s1, "https://github.com/student/solution", requestId)).json();
    expect(replay.id).toBe(firstBody.id);
    expect((await submit(s1, "https://github.com/student/different", requestId)).status).toBe(409);
    const cooled = await submit(s1, "https://github.com/student/second");
    expect(cooled.status).toBe(409);
    expect((await cooled.json() as any).error.code).toBe("SUBMISSION_COOLDOWN");
    await env.DB.prepare("INSERT INTO submission_cooldown_overrides(id,student_id,assignment_publication_id,waived_until,reason,created_by_kind,created_by_id,created_at) VALUES(?,?,?,?,?,'admin',?,?)")
      .bind(crypto.randomUUID(), student1!.id, publication.id, timestamp + 3600, "test", a.cookie, timestamp).run();
    expect((await submit(s1, "https://github.com/student/second")).status).toBe(201);
    const duplicate: any = await (await submit(s2, "https://github.com/student/solution.git")).json();
    expect(duplicate.status).toBe("blocked_duplicate_repo");
    expect(duplicate).not.toHaveProperty("duplicate_of_submission_id");
    expect((await env.DB.prepare("SELECT duplicate_of_submission_id FROM submissions WHERE id=?").bind(duplicate.id).first<any>()).duplicate_of_submission_id).toBe(firstBody.id);
    expect((await call(`/api/admin/submissions/${duplicate.id}/duplicate-decision`, {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ decision: "allow", comment: "Проверено вручную" }),
    })).status).toBe(200);
    expect((await call(`/api/admin/submissions/${duplicate.id}/duplicate-decision`, {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ decision: "reject" }),
    })).status).toBe(409);

    async function createWorker(name: string) {
      const response = await call("/api/admin/grader-workers", { method: "POST", headers: authHeaders(a), body: JSON.stringify({ name }) });
      expect(response.status).toBe(201); return response.json() as Promise<any>;
    }
    const w1 = await createWorker(`worker-a-${suffix}`), w2 = await createWorker(`worker-b-${suffix}`);
    for (const worker of [w1, w2]) expect((await call("/api/grader/readiness", {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ready: true, capabilities: ["CPU"], environment: { cpu_image: "test@sha256:abc" } }),
    })).status).toBe(200);
    const candidateResponse = await call("/api/grader/jobs/candidates", { headers: { Authorization: `Bearer ${w1.token}` } });
    expect(candidateResponse.status).toBe(200);
    const candidates: any = await candidateResponse.json();
    const job = candidates.items.find((x: any) => x.job_id && x.resource_policy.ram_mb === 512);
    expect(job).toBeTruthy();
    const claim = (worker: any) => call(`/api/grader/jobs/${job.job_id}/claim`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ lease_seconds: 120 }),
    });
    const claims = await Promise.all([claim(w1), claim(w2)]);
    expect(claims.map((x) => x.status).sort()).toEqual([200, 409]);
    const winnerIndex = claims[0].status === 200 ? 0 : 1, worker = winnerIndex === 0 ? w1 : w2;
    const claimed: any = await claims[winnerIndex].json();
    expect(claimed.commit_sha).toBe("b".repeat(40));
    expect(claimed.grader_commit_sha).toBe("a".repeat(40));
    expect(claimed.achievement_definitions[0].id).toBe("assignment/lab-1/all-functions");
    expect((await call(`/api/grader/jobs/${job.job_id}/progress`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "contracts", message: "Проверяется структура контрактов и функций" }),
    })).status).toBe(200);
    const activeHistory: any = await (await call("/api/student/submissions", { headers: { Cookie: s1.cookie } })).json();
    expect(activeHistory.items.find((item: any) => item.id === firstBody.id).student_status).toBe("checking_contracts");
    expect((await call(`/api/grader/jobs/${job.job_id}/heartbeat`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": "wrong", "Content-Type": "application/json" }, body: JSON.stringify({ lease_seconds: 120 }),
    })).status).toBe(409);
    expect((await call(`/api/grader/jobs/${job.job_id}/heartbeat`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" }, body: JSON.stringify({ lease_seconds: 120 }),
    })).status).toBe(200);
    const resultBody = { schema_version: 1, outcome: "completed", score: { earned: 50, maximum: 60 }, checks: [], metrics: {}, resource_events: [], achievement_triggers: [
      { achievement_id: "assignment/lab-1/all-functions", evidence_ids: ["check:functions"], reason_code: "all_required_functions_passed", source: "pipeline:test" },
    ],
      deterministic_gate: "passed", llm_eligible: true, public_summary: "Все обязательные тесты пройдены", public_diagnostics: [], private_diagnostics: [], evidence: { passed: 18 } };
    const initialLlm = { schema_version: 1, review_stage: "initial", criteria: [], next_action: "ask_student",
      clarification: { criterion_ids: [], question: "Объясните выбор алгоритма и его граничные случаи.", expected_topics: ["сложность"] },
      student_feedback: { summary: "Нужно уточнение", strengths: [], improvements: [] },
      teacher_report: { summary: "Нужно уточнение", recommendation: "manual_review", recommended_score: 50, attention_required: false, attention_reasons: [] },
      achievement_nominations: [{ achievement_id: "assignment/lab-1/explainer", confidence: "high", evidence_ids: ["check:functions"], rationale: "Аргументация проверена" }] };
    expect((await call(`/api/grader/jobs/${job.job_id}/llm-initial`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" },
      body: JSON.stringify({ deterministic_gate: "passed", result: initialLlm, provider: "test", model: "test-model", input_hash: "c".repeat(64), prompt_version: "test-v1", attempts: [] }),
    })).status).toBe(200);
    expect((await call(`/api/grader/jobs/${job.job_id}/result`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" }, body: JSON.stringify(resultBody),
    })).status).toBe(200);
    const resultReplay: any = await (await call(`/api/grader/jobs/${job.job_id}/result`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" }, body: JSON.stringify(resultBody),
    })).json();
    expect(resultReplay.replay).toBe(true);
    expect((await call(`/api/grader/jobs/${job.job_id}/result`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" }, body: JSON.stringify({ ...resultBody, outcome: "different" }),
    })).status).toBe(409);
    expect((await call(`/api/grader/jobs/${job.job_id}/result`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": claimed.lease_token, "Content-Type": "application/json" },
      body: JSON.stringify({ ...resultBody, deterministic_gate: "failed", llm_eligible: true }),
    })).status).toBe(400);
    let answerHistory: any = await (await call("/api/student/submissions", { headers: { Cookie: s1.cookie } })).json();
    const clarification = answerHistory.items.find((item: any) => item.id === firstBody.id).clarification;
    expect(clarification.question).toContain("алгоритма");
    expect((await call(`/api/student/clarifications/${clarification.id}/answer`, {
      method: "POST", headers: authHeaders(s1), body: JSON.stringify({ answer: "Я выбрал алгоритм из-за линейной сложности и явно обработал пустой вход." }),
    })).status).toBe(200);
    const reviewCandidates: any = await (await call("/api/grader/llm-reviews/candidates", { headers: { Authorization: `Bearer ${worker.token}` } })).json();
    const reviewCandidate = reviewCandidates.items.find((item: any) => item.state === "reviewing_answer_1");
    expect(reviewCandidate).toBeTruthy();
    const reviewClaim: any = await (await call(`/api/grader/llm-reviews/${reviewCandidate.id}/claim`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ lease_seconds: 120 }),
    })).json();
    expect(reviewClaim.answer).toContain("линейной сложности");
    const finalLlm = { ...initialLlm, review_stage: "answer_evaluation", answer_number: 1,
      answer_quality: { status: "sufficient", rationale: "Ответ конкретный" }, next_action: "finalize", clarification: undefined,
      student_feedback: { summary: "Ответ принят", strengths: ["Аргументация"], improvements: [] },
      teacher_report: { summary: "Понимание подтверждено", recommendation: "accept", recommended_score: 60, attention_required: false, attention_reasons: [] } };
    const assessment = { result: { schema_version: 1, criteria: [], total_score: 60, blocking_evidence_ids: [], recommendation: "accept", teacher_summary: "Работа соответствует критериям" }, provider: "test", model: "assessment-model", input_hash: "e".repeat(64), prompt_version: "platform-assessment-v1", attempts: [] };
    expect((await call(`/api/grader/llm-reviews/${reviewCandidate.id}/result`, {
      method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "X-Grader-Lease": reviewClaim.lease_token, "Content-Type": "application/json" },
      body: JSON.stringify({ answer_number: 1, result: finalLlm, provider: "test", model: "test-model", input_hash: "d".repeat(64), prompt_version: "test-followup-v1", attempts: [], assessment }),
    })).status).toBe(200);
    const submissionHistory: any = await (await call("/api/student/submissions", { headers: { Cookie: s1.cookie } })).json();
    const graded = submissionHistory.items.find((item: any) => item.id === firstBody.id);
    expect(graded.student_status).toBe("awaiting_teacher_review");
    expect(graded.public_summary).toBe("Все обязательные тесты пройдены");
    expect(graded.stages.map((stage: any) => stage.stage)).toContain("tests");
    const award = await env.DB.prepare("SELECT achievement_id,reason_code FROM assignment_achievement_awards WHERE submission_id=? AND achievement_id='assignment/lab-1/all-functions'").bind(firstBody.id).first<any>();
    expect(award).toMatchObject({ achievement_id: "assignment/lab-1/all-functions", reason_code: "all_required_functions_passed" });
    expect((await env.DB.prepare("SELECT count(*) count FROM assignment_achievement_awards WHERE submission_id=?").bind(firstBody.id).first<any>()).count).toBe(1);
    expect((await env.DB.prepare("SELECT status FROM assignment_achievement_nominations WHERE submission_id=? AND source LIKE 'llm:%'").bind(firstBody.id).first<any>()).status).toBe("pending_teacher");
    const achievementProfile: any = await (await call("/api/student/profile", { headers: { Cookie: s1.cookie } })).json();
    expect(achievementProfile.badges.some((badge: any) => badge.badge_kind === "assignment" && badge.badge_title === "Полный комплект")).toBe(true);
    expect((await call(`/api/admin/submissions/${firstBody.id}/review-decision`, {
      method: "POST", headers: authHeaders(a), body: JSON.stringify({ action: "approve", comment: "Работа принята после проверки" }),
    })).status).toBe(200);
    const completionAward = await env.DB.prepare("SELECT source,reason_code FROM assignment_achievement_awards WHERE submission_id=? AND achievement_id='assignment/lab-1/completed'").bind(firstBody.id).first<any>();
    expect(completionAward).toMatchObject({ source: "platform:submission.finalized", reason_code: "submission_finalized" });
    expect((await env.DB.prepare("SELECT count(*) count FROM assignment_achievement_awards WHERE submission_id=?").bind(firstBody.id).first<any>()).count).toBe(3);
    await env.DB.prepare("INSERT INTO submission_cooldown_overrides(id,student_id,assignment_publication_id,waived_until,reason,created_by_kind,created_by_id,created_at) VALUES(?,?,?,?,?,'admin',?,?)")
      .bind(crypto.randomUUID(), student1!.id, publication.id, timestamp + 7200, "local upload test", a.cookie, timestamp).run();
    await env.DB.prepare("UPDATE grader_workers SET environment_json='{\"llm_capacity_available\":true}' WHERE id=?").bind(worker.id).run();
    (env as any).LOCAL_DEV_UPLOADS = "true";
    const localResponse = await call(`/api/student/assignment-publications/${publication.id}/submissions`, {
      method: "POST", headers: authHeaders(s1), body: JSON.stringify({ source_kind: "local_upload", local_upload_id: "LocalUploadToken1234567890", local_upload_sha: "e".repeat(64), client_request_id: crypto.randomUUID(), policy_version: "2026-09-16-v1", policy_accepted: true, email: "student@example.test" }),
    });
    delete (env as any).LOCAL_DEV_UPLOADS;
    expect(localResponse.status).toBe(201);
    const localSubmission: any = await localResponse.json();
    const localStored = await env.DB.prepare("SELECT repo_url,commit_sha FROM submissions WHERE id=?").bind(localSubmission.id).first<any>();
    expect(localStored).toEqual({ repo_url: "local-upload://LocalUploadToken1234567890", commit_sha: "e".repeat(64) });
  });
});

async function seedQuiz(
  slug: string,
  availability: { opens: number | null; deadline: number | null },
  barrier = false,
) {
  const t = Math.floor(Date.now() / 1000),
    qid = crypto.randomUUID(),
    vid = crypto.randomUUID(),
    question = crypto.randomUUID(),
    correct = crypto.randomUUID(),
    wrong = crypto.randomUUID(),
    achievement = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO quizzes(id,slug,title,description,published_version_id,opens_at,start_deadline_at,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?,?,?)",
    ).bind(
      qid,
      slug,
      "Тест",
      "",
      availability.opens,
      availability.deadline,
      t,
      t,
    ),
    env.DB.prepare(
      "INSERT INTO quiz_versions(id,quiz_id,version_number,status,title,description,time_per_question_seconds,failure_barrier_enabled,failure_barrier_threshold_bp,created_at,published_at) VALUES(?,?,1,'PUBLISHED','Тест','',60,?,?,?,?)",
    ).bind(vid, qid, +barrier, 5000, t, t),
    env.DB.prepare(
      "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,0,'SINGLE','Ответ?',1,?)",
    ).bind(question, vid, t),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,0,'Да',1)",
    ).bind(correct, question),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,1,'Нет',0)",
    ).bind(wrong, question),
    env.DB.prepare(
      "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,title,description,created_at) VALUES(?,?,0,0,'Готово','',?)",
    ).bind(achievement, vid, t),
    env.DB.prepare("UPDATE quizzes SET published_version_id=? WHERE id=?").bind(
      vid,
      qid,
    ),
  ]);
  return { qid, vid, question, correct, wrong };
}

async function seedAllTypes(slug: string) {
  const t = Math.floor(Date.now() / 1000),
    qid = crypto.randomUUID(),
    vid = crypto.randomUUID(),
    achievement = crypto.randomUUID();
  const single = crypto.randomUUID(),
    multiple = crypto.randomUUID(),
    numeric = crypto.randomUUID(),
    short = crypto.randomUUID();
  const singleCorrect = crypto.randomUUID(),
    singleWrong = crypto.randomUUID(),
    multiA = crypto.randomUUID(),
    multiB = crypto.randomUUID(),
    multiWrong = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO quizzes(id,slug,title,description,published_version_id,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?)",
    ).bind(qid, slug, "Все типы", "", t, t),
    env.DB.prepare(
      "INSERT INTO quiz_versions(id,quiz_id,version_number,status,title,description,time_per_question_seconds,show_answer_review_after_submit,created_at,published_at) VALUES(?,?,1,'PUBLISHED','Все типы','',60,1,?,?)",
    ).bind(vid, qid, t, t),
    env.DB.prepare(
      "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,0,'SINGLE','Single',2,?)",
    ).bind(single, vid, t),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,0,'Верно',1)",
    ).bind(singleCorrect, single),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,1,'Нет',0)",
    ).bind(singleWrong, single),
    env.DB.prepare(
      "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,1,'MULTIPLE','Multiple',3,?)",
    ).bind(multiple, vid, t),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,0,'A',1)",
    ).bind(multiA, multiple),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,1,'B',1)",
    ).bind(multiB, multiple),
    env.DB.prepare(
      "INSERT INTO question_options(id,question_id,position,text,is_correct) VALUES(?,?,2,'C',0)",
    ).bind(multiWrong, multiple),
    env.DB.prepare(
      "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,2,'NUMERIC','Numeric',4,?)",
    ).bind(numeric, vid, t),
    env.DB.prepare(
      "INSERT INTO numeric_answer_configs(question_id,correct_value,absolute_tolerance) VALUES(?,10,0.25)",
    ).bind(numeric),
    env.DB.prepare(
      "INSERT INTO questions(id,quiz_version_id,position,type,text,points,created_at) VALUES(?,?,3,'SHORT_TEXT','Short',5,?)",
    ).bind(short, vid, t),
    env.DB.prepare(
      "INSERT INTO short_answer_variants(id,question_id,answer_normalized) VALUES(?,?,?)",
    ).bind(crypto.randomUUID(), short, "машинное обучение"),
    env.DB.prepare(
      "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,title,description,created_at) VALUES(?,?,0,0,'Готово','',?)",
    ).bind(achievement, vid, t),
    env.DB.prepare("UPDATE quizzes SET published_version_id=? WHERE id=?").bind(
      vid,
      qid,
    ),
  ]);
  return {
    qid,
    vid,
    single,
    multiple,
    numeric,
    short,
    singleCorrect,
    multiA,
    multiB,
    multiWrong,
  };
}

describe("availability, attempts, grading and retry", () => {
  it("enforces start boundaries but never truncates an active attempt", async () => {
    const s = await student("Оконный Студент Первый");
    const t = Math.floor(Date.now() / 1000);
    await seedQuiz("not-open", { opens: t + 100, deadline: null });
    let r = await call("/api/student/quizzes/not-open/attempts", {
      method: "POST",
      headers: authHeaders(s, false),
    });
    expect(r.status).toBe(409);
    const ids = await seedQuiz("open-now", { opens: null, deadline: t + 100 });
    r = await call("/api/student/quizzes/open-now/attempts", {
      method: "POST",
      headers: authHeaders(s, false),
    });
    expect(r.status).toBe(201);
    const started: any = await r.json();
    expect(started.state).toBe("ACTIVE");
    await env.DB.prepare("UPDATE quizzes SET start_deadline_at=? WHERE id=?")
      .bind(t, ids.qid)
      .run();
    r = await call(`/api/student/attempts/${started.attempt.id}`, {
      headers: { Cookie: s.cookie },
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).state).toBe("ACTIVE");
  });

  it("grades server-side, makes submit idempotent, and a new version grants no attempt", async () => {
    const s = await student("Оценочный Студент Второй");
    const ids = await seedQuiz("grading", { opens: null, deadline: null });
    const start = await call("/api/student/quizzes/grading/attempts", {
      method: "POST",
      headers: authHeaders(s, false),
    });
    const active: any = await start.json();
    const body = {
      answers: { [ids.question]: { type: "SINGLE", optionId: ids.correct } },
    };
    const first = await call(
      `/api/student/attempts/${active.attempt.id}/submit`,
      { method: "POST", headers: authHeaders(s), body: JSON.stringify(body) },
    );
    const result: any = await first.json();
    expect(result.result.score).toBe(1);
    expect(result.result.percent_bp).toBe(10000);
    const again: any = await (
      await call(`/api/student/attempts/${active.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify(body),
      })
    ).json();
    expect(again.result).toEqual(result.result);
    const t = Math.floor(Date.now() / 1000),
      v2 = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO quiz_versions(id,quiz_id,version_number,status,title,description,time_per_question_seconds,created_at,published_at) VALUES(?,?,2,'PUBLISHED','Новая версия','',60,?,?)",
      ).bind(v2, ids.qid, t, t),
      env.DB.prepare(
        "UPDATE quizzes SET published_version_id=? WHERE id=?",
      ).bind(v2, ids.qid),
    ]);
    const replay: any = await (
      await call("/api/student/quizzes/grading/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    expect(replay.result.attempt_id).toBe(active.attempt.id);
    const count = await env.DB.prepare(
      "SELECT count(*) n FROM quiz_attempts WHERE quiz_id=? AND student_id=(SELECT id FROM students WHERE student_code=?)",
    )
      .bind(ids.qid, s.code)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("allows exactly one retry only below the threshold", async () => {
    const s = await student("Повторный Студент Третий");
    const ids = await seedQuiz("retry", { opens: null, deadline: null }, true);
    const start: any = await (
      await call("/api/student/quizzes/retry/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    const failed: any = await (
      await call(`/api/student/attempts/${start.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: { [ids.question]: { type: "SINGLE", optionId: ids.wrong } },
        }),
      })
    ).json();
    expect(failed.result.retry_available).toBe(true);
    const [a, b] = await Promise.all([
      call(`/api/student/attempts/${start.attempt.id}/retry`, {
        method: "POST",
        headers: authHeaders(s, false),
      }),
      call(`/api/student/attempts/${start.attempt.id}/retry`, {
        method: "POST",
        headers: authHeaders(s, false),
      }),
    ]);
    expect([a.status, b.status].every((x) => x === 200 || x === 201)).toBe(
      true,
    );
    const retry: any = await a.clone().json();
    expect(
      (
        await call(`/api/student/attempts/${retry.attempt.id}/retry`, {
          method: "POST",
          headers: authHeaders(s, false),
        })
      ).status,
    ).toBe(409);
    const count = await env.DB.prepare(
      "SELECT count(*) n FROM quiz_attempts WHERE quiz_id=? AND student_id=(SELECT id FROM students WHERE student_code=?) AND attempt_no=2",
    )
      .bind(ids.qid, s.code)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("awards the dedicated achievement only after a second failure", async () => {
    const s = await student("Двойной Провал Студент");
    const ids = await seedQuiz(
      "double-failure",
      { opens: null, deadline: null },
      true,
    );
    const ruleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO double_failure_rules(id,quiz_version_id,title,description,emoji,theme,created_at) VALUES(?,?, 'Двойной промах','Обе попытки ниже порога','🫠','danger',?)",
    )
      .bind(ruleId, ids.vid, Math.floor(Date.now() / 1000))
      .run();
    const first: any = await (
      await call("/api/student/quizzes/double-failure/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    const failedOnce: any = await (
      await call(`/api/student/attempts/${first.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: { [ids.question]: { type: "SINGLE", optionId: ids.wrong } },
        }),
      })
    ).json();
    expect(failedOnce.result.achievement.kind).toBe("THRESHOLD");
    const retry: any = await (
      await call(`/api/student/attempts/${first.attempt.id}/retry`, {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    const failedTwice: any = await (
      await call(`/api/student/attempts/${retry.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: { [ids.question]: { type: "SINGLE", optionId: ids.wrong } },
        }),
      })
    ).json();
    expect(failedTwice.result.achievement).toMatchObject({
      id: ruleId,
      title: "Двойной промах",
      kind: "DOUBLE_FAILURE",
    });
    expect(failedTwice.result.retry_available).toBe(false);
    const row = await env.DB.prepare(
      "SELECT achievement_rule_id,double_failure_rule_id FROM quiz_attempts WHERE id=?",
    )
      .bind(retry.attempt.id)
      .first<any>();
    expect(row).toEqual({
      achievement_rule_id: null,
      double_failure_rule_id: ruleId,
    });
  });

  it("awards a separate pass-after-failure badge for any passing retry", async () => {
    const s = await student("Успешный Камбэк Студент");
    const ids = await seedQuiz(
      "retry-success",
      { opens: null, deadline: null },
      true,
    );
    const ruleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO retry_success_rules(id,quiz_version_id,title,description,emoji,theme,created_at) VALUES(?,?,'Камбэк','Успех после первой неудачи','↗️','success',?)",
    )
      .bind(ruleId, ids.vid, Math.floor(Date.now() / 1000))
      .run();
    const first: any = await (
      await call("/api/student/quizzes/retry-success/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    await call(`/api/student/attempts/${first.attempt.id}/submit`, {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({
        answers: { [ids.question]: { type: "SINGLE", optionId: ids.wrong } },
      }),
    });
    const retry: any = await (
      await call(`/api/student/attempts/${first.attempt.id}/retry`, {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    const passed: any = await (
      await call(`/api/student/attempts/${retry.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: {
            [ids.question]: { type: "SINGLE", optionId: ids.correct },
          },
        }),
      })
    ).json();
    expect(passed.result.achievement).toMatchObject({
      id: ruleId,
      title: "Камбэк",
      kind: "RETRY_SUCCESS",
    });
    const row = await env.DB.prepare(
      "SELECT achievement_rule_id,double_failure_rule_id,retry_success_rule_id FROM quiz_attempts WHERE id=?",
    )
      .bind(retry.attempt.id)
      .first<any>();
    expect(row).toEqual({
      achievement_rule_id: null,
      double_failure_rule_id: null,
      retry_success_rule_id: ruleId,
    });
  });

  it("publishes an opt-in badge wall without exposing identity credentials", async () => {
    const s = await student("Публичный Профиль Студент");
    const ids = await seedQuiz("profile-wall", {
      opens: null,
      deadline: null,
    });
    const start: any = await (
      await call("/api/student/quizzes/profile-wall/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    await call(`/api/student/attempts/${start.attempt.id}/submit`, {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({
        answers: { [ids.question]: { type: "SINGLE", optionId: ids.correct } },
      }),
    });
    const privateProfile = await call("/api/student/profile", {
      headers: { Cookie: s.cookie },
    });
    expect(privateProfile.status).toBe(200);
    expect(((await privateProfile.json()) as any).is_public).toBe(false);
    const enabled: any = await (
      await call("/api/student/profile", {
        method: "PUT",
        headers: authHeaders(s),
        body: JSON.stringify({ is_public: true }),
      })
    ).json();
    expect(enabled.share_token).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    const response = await call(`/api/public/profiles/${enabled.share_token}`);
    const publicProfile: any = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(publicProfile.badges).toHaveLength(1);
    expect(publicProfile.badges[0]).toMatchObject({
      quiz_title: "Тест",
      badge_title: "Готово",
    });
    expect(JSON.stringify(publicProfile)).not.toContain(s.code);
    expect(JSON.stringify(publicProfile)).not.toContain("Публичный Профиль");
    const rotated: any = await (
      await call("/api/student/profile/rotate", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    expect(rotated.share_token).not.toBe(enabled.share_token);
    expect(
      (await call(`/api/public/profiles/${enabled.share_token}`)).status,
    ).toBe(404);
    expect(
      (await call(`/api/public/profiles/${rotated.share_token}`)).status,
    ).toBe(200);
    await call("/api/student/profile", {
      method: "PUT",
      headers: authHeaders(s),
      body: JSON.stringify({ is_public: false }),
    });
    expect(
      (await call(`/api/public/profiles/${rotated.share_token}`)).status,
    ).toBe(404);
  });

  it("grades all four types, strict multiple choice, tolerance boundary and review", async () => {
    const s = await student("Четыре Типа Четвёртый");
    const ids = await seedAllTypes("all-types");
    const startResponse = await call(
      "/api/student/quizzes/all-types/attempts",
      { method: "POST", headers: authHeaders(s, false) },
    );
    const raw = await startResponse.clone().text();
    expect(raw).not.toMatch(
      /is_correct|correct_value|absolute_tolerance|answer_normalized/,
    );
    const active: any = await startResponse.json();
    const submitted: any = await (
      await call(`/api/student/attempts/${active.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: {
            [ids.single]: { type: "SINGLE", optionId: ids.singleCorrect },
            [ids.multiple]: {
              type: "MULTIPLE",
              optionIds: [ids.multiB, ids.multiA],
            },
            [ids.numeric]: { type: "NUMERIC", value: "10,25" },
            [ids.short]: { type: "SHORT_TEXT", text: "  МАШИННОЕ   ОБУЧЕНИЕ " },
          },
        }),
      })
    ).json();
    expect(submitted.result.score).toBe(14);
    expect(submitted.result.percent_bp).toBe(10000);
    expect(submitted.result.review).toHaveLength(4);
  });

  it("parses integer numeric answers exactly and accepts comma decimals for floats", async () => {
    const s = await student("Числовой Формат Студент");
    const ids = await seedAllTypes("numeric-kinds");
    await env.DB.prepare(
      "UPDATE numeric_answer_configs SET correct_value=7,absolute_tolerance=0,numeric_kind='INTEGER' WHERE question_id=?",
    )
      .bind(ids.numeric)
      .run();
    const active: any = await (
      await call("/api/student/quizzes/numeric-kinds/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    const decimalForInteger = await call(
      `/api/student/attempts/${active.attempt.id}/answers/${ids.numeric}`,
      {
        method: "PUT",
        headers: authHeaders(s),
        body: JSON.stringify({ type: "NUMERIC", value: "7,0" }),
      },
    );
    expect(decimalForInteger.status).toBe(400);
    const integer = await call(
      `/api/student/attempts/${active.attempt.id}/answers/${ids.numeric}`,
      {
        method: "PUT",
        headers: authHeaders(s),
        body: JSON.stringify({ type: "NUMERIC", value: "007" }),
      },
    );
    expect(integer.status).toBe(200);
    const result: any = await (
      await call(`/api/student/attempts/${active.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: { [ids.numeric]: { type: "NUMERIC", value: "7" } },
        }),
      })
    ).json();
    expect(result.result.score).toBe(4);
    expect(result.result.correct_answers).toBe(1);
  });

  it("selects achievements by correct-answer count, independently of points", async () => {
    const s = await student("Порог Ответов Двенадцатый");
    const ids = await seedAllTypes("count-threshold");
    await env.DB.prepare(
      "INSERT INTO achievement_rules(id,quiz_version_id,position,min_percent_bp,min_correct_answers,title,description,created_at) VALUES(?,?,1,1,1,'Есть один','',?)",
    )
      .bind(crypto.randomUUID(), ids.vid, Math.floor(Date.now() / 1000))
      .run();
    const active: any = await (
      await call("/api/student/quizzes/count-threshold/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    const submitted: any = await (
      await call(`/api/student/attempts/${active.attempt.id}/submit`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({
          answers: {
            [ids.short]: { type: "SHORT_TEXT", text: "машинное обучение" },
          },
        }),
      })
    ).json();
    expect(submitted.result.correct_answers).toBe(1);
    expect(submitted.result.score).toBe(5);
    expect(submitted.result.achievement.title).toBe("Есть один");
  });

  it("lazily expires and grades only the previously saved answers", async () => {
    const s = await student("Истёкший Студент Пятый");
    const ids = await seedQuiz("lazy-expire", { opens: null, deadline: null });
    const active: any = await (
      await call("/api/student/quizzes/lazy-expire/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    expect(
      (
        await call(
          `/api/student/attempts/${active.attempt.id}/answers/${ids.question}`,
          {
            method: "PUT",
            headers: authHeaders(s),
            body: JSON.stringify({ type: "SINGLE", optionId: ids.correct }),
          },
        )
      ).status,
    ).toBe(200);
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "UPDATE quiz_attempts SET started_at=?,expires_at=? WHERE id=?",
    )
      .bind(t - 100, t - 1, active.attempt.id)
      .run();
    const result: any = await (
      await call(`/api/student/attempts/${active.attempt.id}`, {
        headers: { Cookie: s.cookie },
      })
    ).json();
    expect(result.result.status).toBe("EXPIRED");
    expect(result.result.score).toBe(1);
    const row = await env.DB.prepare(
      "SELECT count(*) n FROM quiz_attempts WHERE id=? AND status='EXPIRED'",
    )
      .bind(active.attempt.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("forbids starts exactly at the deadline and permits one just before it", async () => {
    const s = await student("Граница Дедлайна Шестой");
    const t = Math.floor(Date.now() / 1000);
    await seedQuiz("deadline-exact", { opens: null, deadline: t });
    expect(
      (
        await call("/api/student/quizzes/deadline-exact/attempts", {
          method: "POST",
          headers: authHeaders(s, false),
        })
      ).status,
    ).toBe(409);
    const ids = await seedQuiz("deadline-before", {
      opens: null,
      deadline: t + 5,
    });
    const allowed: any = await (
      await call("/api/student/quizzes/deadline-before/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      })
    ).json();
    expect(allowed.attempt.started_at).toBeLessThan(t + 5);
    await env.DB.prepare("UPDATE quizzes SET start_deadline_at=? WHERE id=?")
      .bind(t, ids.qid)
      .run();
    expect(
      (
        await call(`/api/student/attempts/${allowed.attempt.id}`, {
          headers: { Cookie: s.cookie },
        })
      ).status,
    ).toBe(200);
  });

  it("returns the same attempt for concurrent and post-deadline start replays", async () => {
    const s = await student("Идемпотентный Старт Одиннадцатый");
    const ids = await seedQuiz("concurrent-start", {
      opens: null,
      deadline: Math.floor(Date.now() / 1000) + 60,
    });
    const request = () =>
      call("/api/student/quizzes/concurrent-start/attempts", {
        method: "POST",
        headers: authHeaders(s, false),
      });
    const responses = await Promise.all([request(), request(), request()]);
    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(
      true,
    );
    const payloads = await Promise.all(
      responses.map((r) => r.json() as Promise<any>),
    );
    expect(new Set(payloads.map((p) => p.attempt.id)).size).toBe(1);
    await env.DB.prepare("UPDATE quizzes SET start_deadline_at=? WHERE id=?")
      .bind(Math.floor(Date.now() / 1000), ids.qid)
      .run();
    const replay: any = await (await request()).json();
    expect(replay.attempt.id).toBe(payloads[0].attempt.id);
  });

  it("forbids retry at or above threshold and after a closed deadline", async () => {
    const passedStudent = await student("Барьер Успех Седьмой");
    const passed = await seedQuiz(
      "barrier-pass",
      { opens: null, deadline: null },
      true,
    );
    const pa: any = await (
      await call("/api/student/quizzes/barrier-pass/attempts", {
        method: "POST",
        headers: authHeaders(passedStudent, false),
      })
    ).json();
    await call(`/api/student/attempts/${pa.attempt.id}/submit`, {
      method: "POST",
      headers: authHeaders(passedStudent),
      body: JSON.stringify({
        answers: {
          [passed.question]: { type: "SINGLE", optionId: passed.correct },
        },
      }),
    });
    expect(
      (
        await call(`/api/student/attempts/${pa.attempt.id}/retry`, {
          method: "POST",
          headers: authHeaders(passedStudent, false),
        })
      ).status,
    ).toBe(409);
    const equalStudent = await student("Барьер Равен Восьмой");
    const equal = await seedQuiz(
      "barrier-equal",
      { opens: null, deadline: null },
      true,
    );
    await env.DB.prepare(
      "UPDATE quiz_versions SET success_barrier_correct_answers=1 WHERE id=?",
    )
      .bind(equal.vid)
      .run();
    const ea: any = await (
      await call("/api/student/quizzes/barrier-equal/attempts", {
        method: "POST",
        headers: authHeaders(equalStudent, false),
      })
    ).json();
    await call(`/api/student/attempts/${ea.attempt.id}/submit`, {
      method: "POST",
      headers: authHeaders(equalStudent),
      body: JSON.stringify({
        answers: {
          [equal.question]: { type: "SINGLE", optionId: equal.correct },
        },
      }),
    });
    expect(
      (
        await call(`/api/student/attempts/${ea.attempt.id}/retry`, {
          method: "POST",
          headers: authHeaders(equalStudent, false),
        })
      ).status,
    ).toBe(409);
    const closedStudent = await student("Барьер Закрыт Девятый");
    const closed = await seedQuiz(
      "barrier-closed",
      { opens: null, deadline: null },
      true,
    );
    const ca: any = await (
      await call("/api/student/quizzes/barrier-closed/attempts", {
        method: "POST",
        headers: authHeaders(closedStudent, false),
      })
    ).json();
    await call(`/api/student/attempts/${ca.attempt.id}/submit`, {
      method: "POST",
      headers: authHeaders(closedStudent),
      body: JSON.stringify({
        answers: {
          [closed.question]: { type: "SINGLE", optionId: closed.wrong },
        },
      }),
    });
    await env.DB.prepare("UPDATE quizzes SET start_deadline_at=? WHERE id=?")
      .bind(Math.floor(Date.now() / 1000), closed.qid)
      .run();
    expect(
      (
        await call(`/api/student/attempts/${ca.attempt.id}/retry`, {
          method: "POST",
          headers: authHeaders(closedStudent, false),
        })
      ).status,
    ).toBe(409);
  });
});

describe("security contracts", () => {
  it("revokes an admin session and expires its cookie on logout", async () => {
    const a = await admin();
    const logout = await call("/api/admin/session", {
      method: "DELETE",
      headers: authHeaders(a, false),
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toMatch(
      /quiz_admin=;.*(?:Max-Age=0|Expires=)/i,
    );
    expect(
      (
        await call("/api/admin/session", {
          headers: { Cookie: a.cookie },
        })
      ).status,
    ).toBe(401);
  });

  it("requires CSRF, emits security headers, and uses a secure HttpOnly cookie on HTTPS", async () => {
    const reg: any = await (
      await call("/api/public/students/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "10.2.2.2",
        },
        body: JSON.stringify({ fio: "Безопасный Студент Десятый" }),
      })
    ).json();
    const login = await exports.default.fetch(
      `https://quiz.test/api/student/session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "10.2.2.2",
        },
        body: JSON.stringify({
          fio: "Безопасный Студент Десятый",
          student_code: reg.student_code,
        }),
      },
    );
    expect(login.headers.get("set-cookie")).toMatch(
      /__Host-quiz_student=.*HttpOnly.*Secure.*SameSite=Lax/i,
    );
    expect(login.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    const ids = await seedQuiz("csrf-check", { opens: null, deadline: null });
    expect(
      (
        await exports.default.fetch(
          `https://quiz.test/api/student/quizzes/csrf-check/attempts`,
          {
            method: "POST",
            headers: {
              Cookie: login.headers.get("set-cookie")!.split(";")[0]!,
            },
          },
        )
      ).status,
    ).toBe(403);
    expect(ids.qid).toBeTruthy();
  });
});

describe("admin authoring, immutable versions and object storage", () => {
  it("limits success barrier to question_count minus one", async () => {
    const a = await admin();
    const created: any = await (
      await call("/api/admin/quizzes", {
        method: "POST",
        headers: authHeaders(a),
        body: JSON.stringify({ title: "Барьер по ответам", description: "" }),
      })
    ).json();
    let draft: any = await (
      await call(`/api/admin/quiz-versions/${created.draft_version_id}`, {
        headers: { Cookie: a.cookie },
      })
    ).json();
    for (const text of ["Первый", "Второй"]) {
      draft = await (
        await call(`/api/admin/quiz-versions/${draft.id}/questions`, {
          method: "POST",
          headers: {
            ...authHeaders(a),
            "If-Match": String(draft.revision),
          },
          body: JSON.stringify({
            type: "SINGLE",
            text,
            points: 1,
            options: [
              { text: "Да", is_correct: true },
              { text: "Нет", is_correct: false },
            ],
          }),
        })
      ).json();
    }
    const settings = (threshold: number) => ({
      title: draft.title,
      description: draft.description,
      time_per_question_seconds: draft.time_per_question_seconds,
      shuffle_questions: false,
      shuffle_options: false,
      failure_barrier_enabled: true,
      success_barrier_correct_answers: threshold,
      show_answer_review_after_submit: false,
    });
    expect(
      (
        await call(`/api/admin/quiz-versions/${draft.id}`, {
          method: "PATCH",
          headers: {
            ...authHeaders(a),
            "If-Match": String(draft.revision),
          },
          body: JSON.stringify(settings(2)),
        })
      ).status,
    ).toBe(400);
    const saved: any = await (
      await call(`/api/admin/quiz-versions/${draft.id}`, {
        method: "PATCH",
        headers: {
          ...authHeaders(a),
          "If-Match": String(draft.revision),
        },
        body: JSON.stringify(settings(1)),
      })
    ).json();
    expect(saved.questions).toHaveLength(2);
    expect(saved.achievements).toHaveLength(1);
    const withDoubleFailure: any = await (
      await call(
        `/api/admin/quiz-versions/${draft.id}/double-failure-achievement`,
        {
          method: "PUT",
          headers: {
            ...authHeaders(a),
            "If-Match": String(saved.revision),
          },
          body: JSON.stringify({
            title: "Две попытки исчерпаны",
            description: "Обе попытки ниже порога успеха",
            emoji: "🫠",
            theme: "danger",
            accent_color: "#b53939",
            image_key: null,
          }),
        },
      )
    ).json();
    expect(withDoubleFailure.double_failure_achievement).toMatchObject({
      title: "Две попытки исчерпаны",
      description: "Обе попытки ниже порога успеха",
    });
    const withRetrySuccess: any = await (
      await call(
        `/api/admin/quiz-versions/${draft.id}/retry-success-achievement`,
        {
          method: "PUT",
          headers: {
            ...authHeaders(a),
            "If-Match": String(withDoubleFailure.revision),
          },
          body: JSON.stringify({
            title: "Камбэк",
            description: "Порог пройден после первой неудачи",
            emoji: "↗️",
            theme: "success",
            accent_color: "#4f7d32",
            image_key: null,
          }),
        },
      )
    ).json();
    expect(withRetrySuccess.retry_success_achievement).toMatchObject({
      title: "Камбэк",
      description: "Порог пройден после первой неудачи",
    });
    expect(
      (
        await call(`/api/admin/quiz-versions/${draft.id}/publish`, {
          method: "POST",
          headers: {
            ...authHeaders(a, false),
            "If-Match": String(withRetrySuccess.revision),
          },
        })
      ).status,
    ).toBe(200);
  });

  it("publishes idempotently, rejects published mutations, and keeps availability operational", async () => {
    const a = await admin();
    const created: any = await (
      await call("/api/admin/quizzes", {
        method: "POST",
        headers: authHeaders(a),
        body: JSON.stringify({ title: "Контракт публикации", description: "" }),
      })
    ).json();
    let draft: any = await (
      await call(`/api/admin/quiz-versions/${created.draft_version_id}`, {
        headers: { Cookie: a.cookie },
      })
    ).json();
    draft = await (
      await call(`/api/admin/quiz-versions/${draft.id}/questions`, {
        method: "POST",
        headers: { ...authHeaders(a), "If-Match": String(draft.revision) },
        body: JSON.stringify({
          type: "SINGLE",
          text: "Вопрос",
          points: 1,
          options: [
            { text: "Да", is_correct: true },
            { text: "Нет", is_correct: false },
          ],
        }),
      })
    ).json();
    const published = await call(
      `/api/admin/quiz-versions/${draft.id}/publish`,
      {
        method: "POST",
        headers: {
          ...authHeaders(a, false),
          "If-Match": String(draft.revision),
        },
      },
    );
    expect(published.status).toBe(200);
    const canonical: any = await published.json();
    const replay = await call(`/api/admin/quiz-versions/${draft.id}/publish`, {
      method: "POST",
      headers: { ...authHeaders(a, false), "If-Match": String(draft.revision) },
    });
    expect(replay.status).toBe(200);
    const nextDraftResponse = await call(
      `/api/admin/quizzes/${created.id}/draft`,
      { method: "POST", headers: authHeaders(a, false) },
    );
    expect(nextDraftResponse.status).toBe(201);
    const nextDraft: any = await nextDraftResponse.json();
    expect(nextDraft.status).toBe("DRAFT");
    expect(nextDraft.version_number).toBe(2);
    const stillPublished: any = await (
      await call(`/api/admin/quizzes/${created.id}`, {
        headers: { Cookie: a.cookie },
      })
    ).json();
    expect(stillPublished.published_version_id).toBe(canonical.id);
    expect((await call(`/api/public/quizzes/${stillPublished.slug}`)).status).toBe(
      200,
    );
    const mutate = await call(
      `/api/admin/questions/${canonical.questions[0].id}`,
      {
        method: "PUT",
        headers: { ...authHeaders(a), "If-Match": String(canonical.revision) },
        body: JSON.stringify({
          type: "SINGLE",
          text: "Подмена",
          points: 1,
          options: [
            { text: "Да", is_correct: true },
            { text: "Нет", is_correct: false },
          ],
        }),
      },
    );
    expect(mutate.status).toBe(409);
    const before = await env.DB.prepare(
      "SELECT count(*) n FROM quiz_versions WHERE quiz_id=?",
    )
      .bind(created.id)
      .first<{ n: number }>();
    const quiz: any = await (
      await call(`/api/admin/quizzes/${created.id}`, {
        headers: { Cookie: a.cookie },
      })
    ).json();
    const changed = await call(
      `/api/admin/quizzes/${created.id}/availability`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(a),
          "If-Match": String(quiz.availability_revision),
        },
        body: JSON.stringify({
          opens_at: null,
          start_deadline_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      },
    );
    expect(changed.status).toBe(200);
    const after = await env.DB.prepare(
      "SELECT count(*) n FROM quiz_versions WHERE quiz_id=?",
    )
      .bind(created.id)
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("validates image signatures and replays an idempotent immutable object upload", async () => {
    const a = await admin();
    const invalid = new FormData();
    invalid.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "fake.png", { type: "image/png" }),
    );
    expect(
      (
        await call("/api/admin/media", {
          method: "POST",
          headers: {
            ...authHeaders(a, false),
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: invalid,
        })
      ).status,
    ).toBe(415);
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const key = crypto.randomUUID();
    const upload = () => {
      const data = new FormData();
      data.append(
        "file",
        new File([bytes], "ignored.png", { type: "image/png" }),
      );
      return call("/api/admin/media", {
        method: "POST",
        headers: { ...authHeaders(a, false), "Idempotency-Key": key },
        body: data,
      });
    };
    const first: any = await (await upload()).json();
    const second: any = await (await upload()).json();
    expect(second.key).toBe(first.key);
    expect(first.key).toMatch(/^achievement\/[0-9a-f-]+\.png$/);
    expect(await env.MEDIA!.head(first.key)).not.toBeNull();
  });
});
