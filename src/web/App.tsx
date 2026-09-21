import { useEffect, useRef, useState, type FormEvent, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, json, setCsrf } from "./api";
import { questionEditorForm, questionEditorPayload } from "./question-form";

type AnyRecord = Record<string, any>;
function Layout({ children, admin = false, teacher = false, student = false, notificationCount = 0 }: { children: ReactNode; admin?: boolean; teacher?: boolean; student?: boolean; notificationCount?: number }) {
  async function logout() {
    const kind = student ? "student" : teacher ? "teacher" : "admin";
    try {
      await api(`/api/${kind}/session`, { method: "DELETE" });
    } finally {
      setCsrf("");
      location.replace(student ? "/profile" : `/${kind}/login`);
    }
  }
  if (admin) return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" to="/admin">ITRUIM</Link>
        <nav aria-label="Администрирование">
          <span className="nav-group-label">Контент</span>
          <NavLink to="/admin" end><span aria-hidden="true">?</span>Тесты</NavLink>
          <NavLink to="/admin/assignments"><span aria-hidden="true">⌘</span>Лабораторные</NavLink>
          <NavLink to="/admin/platform-achievements"><span aria-hidden="true">★</span>Достижения</NavLink>
          <span className="nav-group-label">Учебный процесс</span>
          <NavLink to="/admin/results"><span aria-hidden="true">▥</span>Результаты</NavLink>
          <NavLink to="/admin/students"><span aria-hidden="true">●</span>Студенты</NavLink>
          <NavLink to="/admin/access"><span aria-hidden="true">◇</span>Курсы и доступы</NavLink>
        </nav>
        <button type="button" className="sidebar-logout" onClick={logout}>Выйти</button>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
  if (student) return (
    <div className="student-shell">
      <aside className="student-sidebar">
        <Link className="brand" to="/profile">ITRUIM</Link>
        <nav aria-label="Личный кабинет">
          <span className="nav-group-label">Обучение</span>
          <NavLink to="/profile" end><span aria-hidden="true">⌂</span>Главная</NavLink>
          <NavLink to="/profile/labs"><span aria-hidden="true">⌘</span>Лабораторные</NavLink>
          <span className="nav-group-label">Профиль</span>
          <NavLink to="/profile/groups"><span aria-hidden="true">●</span>Группы и настройки</NavLink>
          <NavLink to="/profile/pride"><span aria-hidden="true">★</span>Достижения</NavLink>
          <NavLink className="sidebar-notifications" to="/profile/notifications"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>Уведомления{notificationCount > 0 && <i aria-label={`${notificationCount} новых`}>{notificationCount}</i>}</NavLink>
        </nav>
        <button type="button" className="sidebar-logout" onClick={logout}>Выйти</button>
      </aside>
      <main className="student-main">{children}</main>
    </div>
  );
  if (teacher) return (
    <div className="teacher-shell">
      <aside className="teacher-sidebar">
        <Link className="brand" to="/teacher">ITRUIM</Link>
        <nav aria-label="Кабинет преподавателя">
          <span className="nav-group-label">Учебный процесс</span>
          <NavLink to="/teacher"><span aria-hidden="true">▦</span>Мои группы</NavLink>
        </nav>
        <button type="button" className="sidebar-logout" onClick={logout}>Выйти</button>
      </aside>
      <main className="teacher-main">{children}</main>
    </div>
  );
  return (
    <>
      <header>
        <Link className="brand" to="/">
          ITRUIM
        </Link>
        <nav className={`site-navigation ${admin ? "is-admin" : teacher ? "is-teacher" : "is-public"}`}>
          {teacher ? (
            <>
              <Link to="/teacher">Мои группы</Link>
              <button type="button" className="link" onClick={logout}>
                Выйти
              </button>
            </>
          ) : (
            <>
              <Link to="/register">Регистрация</Link>
              <Link to="/profile">Личный кабинет</Link>
              <Link to="/teacher/login">Преподаватель</Link>
              <Link to="/admin/login">Администратор</Link>
            </>
          )}
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
function Notice({ children, kind = "info" }: { children: ReactNode; kind?: string }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}
function ErrorBox({ error }: { error: string }) {
  return error ? <Notice kind="error">{error}</Notice> : null;
}
function LinkifiedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part}</a>
      : part,
  )}</>;
}
function Toast({ message, kind = "success", onClose, timeout = 6000 }: { message: string; kind?: "success" | "error" | "info"; onClose: () => void; timeout?: number }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!message || timeout <= 0) return;
    const timer = window.setTimeout(() => closeRef.current(), timeout);
    return () => window.clearTimeout(timer);
  }, [message, timeout]);
  if (!message) return null;
  return (
    <div className={`toast toast-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span>{message}</span>
      <button type="button" className="toast-close" aria-label="Закрыть уведомление" onClick={onClose}>×</button>
    </div>
  );
}
function Modal({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLElement | null>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]') ?? [])];
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = focusable(); if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); returnFocus.current?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</div></div>;
}
function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-list" aria-label="Загрузка">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><i /><span /></div>)}</div>;
}
const fmt = (seconds: number | null | undefined) =>
  seconds
    ? new Intl.DateTimeFormat("ru", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(seconds * 1000))
    : "—";
const localInput = (seconds: number | null | undefined) => {
  if (!seconds) return "";
  const d = new Date(seconds * 1000),
    offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

function Home() {
  return (
    <Layout>
      <section className="hero">
        <p className="eyebrow">Itruim · Iterate. Run. Improve.</p>
        <h1>
          Проверяйте знания.
          <br />
          Запускайте код.
          <br />
          Улучшайте решения.
        </h1>
        <p>Квизы после лекций, гибкая автоматическая проверка заданий по программированию и понятная обратная связь студенту.</p>
        <div className="actions">
          <Link className="button" to="/register">
            Получить код
          </Link>
          <Link className="button secondary" to="/profile">
            Личный кабинет
          </Link>
          <Link className="button secondary" to="/teacher/login">
            Преподавателю
          </Link>
        </div>
      </section>
    </Layout>
  );
}
function Register() {
  const [fio, setFio] = useState("");
  const [result, setResult] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setResult(await api("/api/public/students/register", json("POST", { fio })));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  return (
    <Layout>
      <section className="card narrow">
        <p className="eyebrow">Регистрация и восстановление</p>
        <h1>Код студента</h1>
        <p className="muted">Введите ФИО полностью. Если вы уже регистрировались, вернётся прежний код.</p>
        <form onSubmit={submit}>
          <label>
            Фамилия Имя Отчество
            <input value={fio} onChange={(e) => setFio(e.target.value)} required minLength={3} autoComplete="name" />
          </label>
          <button>Продолжить</button>
        </form>
        <ErrorBox error={error} />
        {result && (
          <div className="code-result">
            <span>{result.existing ? "Ваш прежний код" : "Ваш новый код"}</span>
            <strong>{result.student_code}</strong>
            <button className="secondary" onClick={() => navigator.clipboard.writeText(result.student_code)}>
              Скопировать
            </button>
          </div>
        )}
      </section>
    </Layout>
  );
}

function BadgeShowcase({ badges }: { badges: any[] }) {
  if (!badges.length) return <Notice>Здесь пока пусто. Медали и достижения появятся после первого завершённого задания.</Notice>;
  const medals = badges.filter((badge) => badge.badge_kind !== "assignment");
  const achievements = badges.filter((badge) => badge.badge_kind === "assignment");
  return (
    <div className="reward-showcase">
      <section className="achievement-overview" aria-label="Сводка достижений">
        <div><strong>{badges.length}</strong><span>всего наград</span></div>
        <div><strong>{achievements.length}</strong><span>достижений</span></div>
        <div><strong>{medals.length}</strong><span>медалей</span></div>
      </section>
      {!!achievements.length && !!medals.length && <nav className="reward-sections" aria-label="Разделы наград"><a href="#achievements">Достижения</a><a href="#medals">Медали</a></nav>}
      {!!achievements.length && (
        <section className="achievement-shelf" id="achievements">
          <div className="reward-heading">
            <h2>Достижения</h2>
            <span>{achievements.length} разблокировано</span>
          </div>
          <div className="steam-achievements">
            {achievements.map((achievement) => (
              <article
                className="steam-achievement"
                style={
                  {
                    "--badge-accent": achievement.accent_color || "#66c0f4",
                  } as CSSProperties
                }
                key={`assignment:${achievement.badge_id}`}
              >
                <div className="steam-achievement-icon">{achievement.image_key ? <img src={`/media/${achievement.image_key}`} alt="" /> : <span aria-hidden="true">{achievement.emoji || "✦"}</span>}</div>
                <div className="steam-achievement-copy">
                  <div className="steam-unlocked">Достижение получено</div>
                  <h3>{achievement.badge_title}</h3>
                  <p>{achievement.badge_description}</p>
                  {achievement.unlock_hint && <AchievementCondition condition={achievement.unlock_hint} />}
                  <small>
                    {achievement.quiz_title} · {fmt(achievement.finalized_at)}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!!medals.length && (
        <section id="medals">
          <div className="reward-heading">
            <h2>Медали</h2>
            <span>{medals.length} получено</span>
          </div>
          <div className="badge-wall">
            {medals.map((badge) => (
              <article
                className={`badge-tile ${badge.theme || "default"}`}
                data-theme={badge.theme || "default"}
                style={
                  {
                    "--badge-accent": badge.accent_color || "#38bdf8",
                  } as CSSProperties
                }
                key={`${badge.badge_kind ?? "quiz"}:${badge.badge_id}`}
              >
                <div className="badge-course">
                  <span className="badge-course-dot" />
                  Квиз · {badge.quiz_title}
                </div>
                <div className={`badge-art ${badge.image_key ? "has-image" : ""}`}>
                  {badge.image_key && <img src={`/media/${badge.image_key}`} alt="" />}
                  <div className="badge-emoji" aria-hidden="true">{badge.emoji || "🏅"}</div>
                </div>
                <div className="badge-copy">
                  <h2>{badge.badge_title}</h2>
                  <p>{badge.badge_description}</p>
                  <small>Получен {fmt(badge.finalized_at)}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StudentProfile() {
  const { section, labId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [groups, setGroups] = useState<any>({ memberships: [], requests: [] });
  const [activities, setActivities] = useState<any[]>([]);
  const [labActivities, setLabActivities] = useState<any[]>([]);
  const [localUploadsEnabled, setLocalUploadsEnabled] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<any>({ telegram_enabled: false, telegram_linked: false, telegram_bot_username: null });
  const [submissionDrafts, setSubmissionDrafts] = useState<
    Record<
      string,
      {
        repo: string;
        sha: string;
        email: string;
        source: "repository" | "local_upload";
        uploadId?: string;
        uploadSha?: string;
        uploadLabel?: string;
      }
    >
  >({});
  const [fio, setFio] = useState("");
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [telegramHint, setTelegramHint] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000));
  const [pendingSubmission, setPendingSubmission] = useState<string | null>(null);
  const [submissionPolicy, setSubmissionPolicy] = useState<any>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [labQuery, setLabQuery] = useState("");
  const [labStatusFilter, setLabStatusFilter] = useState("all");
  async function load() {
    try {
      await api("/api/student/session");
      const [nextProfile, nextGroups, nextActivities, nextLabs, nextSubmissions, nextNotifications, nextPreferences] = await Promise.all([api("/api/student/profile"), api("/api/student/groups"), api("/api/student/activities"), api("/api/student/assignments"), api("/api/student/submissions"), api("/api/student/notifications"), api("/api/student/notification-preferences")]);
      setProfile(nextProfile);
      setGroups(nextGroups);
      setActivities(nextActivities.items);
      setLabActivities(nextLabs.items);
      setLocalUploadsEnabled(Boolean(nextLabs.local_uploads_enabled));
      setSubmissions(nextSubmissions.items);
      setNotifications(nextNotifications.items);
      setNotificationPreferences(nextPreferences);
      setLoginRequired(false);
    } catch {
      setLoginRequired(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!profile || notificationPreferences.telegram_linked || sessionStorage.getItem("telegram-hint-dismissed")) return;
    setTelegramHint("Подключите Telegram в настройках — так вы точно не пропустите вопрос по работе или результат проверки.");
    sessionStorage.setItem("telegram-hint-dismissed", "1");
  }, [profile, notificationPreferences.telegram_linked]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/student/session", json("POST", { fio, student_code: code }));
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function joinGroup(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/student/group-requests", json("POST", { join_code: joinCode }));
      setJoinCode("");
      setGroups(await api("/api/student/groups"));
      setNotice("Заявка отправлена преподавателю");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function requestLabSubmission(publicationId: string) {
    setError("");
    try {
      setSubmissionPolicy(await api("/api/student/submission-policy"));
      setPolicyAccepted(false);
      setPendingSubmission(publicationId);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function submitLab(publicationId: string) {
    const draft = submissionDrafts[publicationId] ?? {
      repo: "",
      sha: "",
      email: "",
      source: "repository" as const,
    };
    setError("");
    try {
      await api(
        `/api/student/assignment-publications/${publicationId}/submissions`,
        json("POST", {
          source_kind: draft.source,
          ...(draft.source === "local_upload"
            ? {
                local_upload_id: draft.uploadId,
                local_upload_sha: draft.uploadSha,
              }
            : { repo_url: draft.repo }),
          client_request_id: crypto.randomUUID(),
          policy_version: submissionPolicy.version,
          policy_accepted: true,
        }),
      );
      setPendingSubmission(null);
      setNotice("Работа принята в очередь");
      setSubmissions((await api("/api/student/submissions")).items);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function uploadLocal(publicationId: string, files: FileList | null) {
    if (!files?.length) return;
    setError("");
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("files", file, (file as any).webkitRelativePath || file.name);
      const response = await fetch("http://127.0.0.1:8790/uploads", {
        method: "POST",
        body,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "Локальная загрузка не удалась");
      const current = submissionDrafts[publicationId] ?? {
        repo: "",
        sha: "",
        email: "",
        source: "local_upload" as const,
      };
      setSubmissionDrafts({
        ...submissionDrafts,
        [publicationId]: {
          ...current,
          source: "local_upload",
          uploadId: payload.upload_id,
          uploadSha: payload.sha256,
          uploadLabel: `${payload.files} файлов · ${payload.bytes} байт`,
        },
      });
      setNotice("Локальный snapshot подготовлен");
    } catch (cause) {
      setError(`${(cause as Error).message}. Проверьте, что grader-worker serve-uploads запущен.`);
    }
  }
  async function setPublic(isPublic: boolean) {
    setError("");
    try {
      setProfile(await api("/api/student/profile", json("PUT", { is_public: isPublic })));
      setNotice(isPublic ? "Публичный профиль включён" : "Профиль скрыт");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function copyProfile() {
    const url = `${location.origin}/p/${profile.share_token}`;
    await navigator.clipboard.writeText(url);
    setNotice("Ссылка на профиль скопирована");
  }
  async function rotateProfileLink() {
    setError("");
    try {
      setProfile(await api("/api/student/profile/rotate", { method: "POST" }));
      setNotice("Создана новая ссылка; старая больше не работает");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function saveNotificationPreferences(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const saved = await api("/api/student/notification-preferences", json("PUT", {
        email: null,
        email_enabled: false,
        telegram_enabled: Boolean(notificationPreferences.telegram_enabled),
      }));
      setNotificationPreferences({ ...notificationPreferences, ...saved });
      setNotice("Настройки уведомлений сохранены");
    } catch (cause) { setError((cause as Error).message); }
  }
  async function connectTelegram() {
    setError("");
    try {
      const link = await api("/api/student/notification-preferences/telegram-link", { method: "POST" });
      window.open(link.url, "_blank", "noopener,noreferrer");
      setNotice("Открыл Telegram. Нажмите Start — кабинет подтвердит привязку автоматически.");
      const started = Date.now();
      const poll = async () => {
        if (Date.now() - started > 120_000) return;
        try {
          const preferences = await api("/api/student/notification-preferences");
          setNotificationPreferences(preferences);
          if (preferences.telegram_linked) { setNotice("Telegram успешно подключён"); return; }
        } catch { /* Следующая попытка polling восстановит состояние. */ }
        window.setTimeout(() => void poll(), 2000);
      };
      window.setTimeout(() => void poll(), 1500);
    } catch (cause) { setError((cause as Error).message); }
  }
  async function unlinkTelegram() {
    if (!window.confirm("Отвязать Telegram? Новые уведомления больше не будут приходить в этот чат.")) return;
    setError("");
    try {
      await api("/api/student/notification-preferences/telegram-link", { method: "DELETE" });
      setNotificationPreferences({ ...notificationPreferences, telegram_linked: false, telegram_enabled: false });
      setNotice("Telegram отвязан");
    } catch (cause) { setError((cause as Error).message); }
  }
  async function readNotification(notification: any) {
    if (!notification.read_at) await api(`/api/student/notifications/${notification.id}/read`, { method: "POST" });
    setNotifications(notifications.map((item) => (item.id === notification.id ? { ...item, read_at: Math.floor(Date.now() / 1000) } : item)));
    if (notification.entity_kind === "submission") {
      navigate(`/profile/submissions/${notification.entity_id}`);
    }
  }
  async function readAllNotifications() {
    await api("/api/student/notifications/read-all", { method: "POST" });
    const timestamp = Math.floor(Date.now() / 1000);
    setNotifications(
      notifications.map((item) => ({
        ...item,
        read_at: item.read_at || timestamp,
      })),
    );
  }
  const cabinetSection = labId ? "labs" : section ?? "overview";
  const labStatus = (publicationId:string) => {
    const latest = submissions.filter((item:any)=>item.assignment_publication_id===publicationId).sort((a:any,b:any)=>b.attempt_number-a.attempt_number)[0];
    if (!latest) return { label:"Не сдано", tone:"neutral", score:null };
    if ((latest.status === "finalized" && (latest.deterministic_status === "failed" || latest.teacher_action === "reject")) || latest.status === "rejected_duplicate_repo") return { label:"Отклонено", tone:"rejected", score:null };
    if (latest.status === "finalized") return { label:"Зачтено", tone:"accepted", score:latest.final_score };
    return { label:"На проверке", tone:"pending", score:null };
  };
  const urgency: Record<string, number> = { rejected: 0, pending: 1, neutral: 2, accepted: 3 };
  const visibleLabs = labId ? labActivities.filter((lab:any)=>lab.publication_id===labId) : labActivities
    .filter((lab: any) => !labQuery || `${lab.title} ${lab.course_run_name}`.toLocaleLowerCase("ru").includes(labQuery.toLocaleLowerCase("ru")))
    .filter((lab: any) => labStatusFilter === "all" || labStatus(lab.publication_id).tone === labStatusFilter)
    .sort((a: any, b: any) => urgency[labStatus(a.publication_id).tone] - urgency[labStatus(b.publication_id).tone] || Number(a.due_at || Infinity) - Number(b.due_at || Infinity));
  const attentionLabs = labActivities.filter((lab: any) => labStatus(lab.publication_id).tone !== "accepted");
  return (
    <Layout student={Boolean(profile && !loginRequired)} notificationCount={notifications.filter((item) => !item.read_at).length}>
      <section className="profile-head">
        <p className="eyebrow">Студент</p>
        <h1>Личный кабинет</h1>
        <p className="muted">На стенде хранятся медали за квизы и достижения за лабораторные. Публичная ссылка не раскрывает ваше ФИО и код студента.</p>
      </section>
      {loginRequired ? (
        <form className="card narrow" onSubmit={login}>
          <h2>Войти</h2>
          <label>
            Фамилия Имя Отчество
            <input value={fio} onChange={(e) => setFio(e.target.value)} required autoComplete="name" />
          </label>
          <label>
            12-символьный код
            <input value={code} minLength={12} maxLength={12} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase())} required />
          </label>
          <button>Открыть кабинет</button>
          <ErrorBox error={error} />
        </form>
      ) : profile ? (
        <>
          <div className="toast-stack" aria-live="polite">
            <Toast message={telegramHint} kind="info" onClose={() => setTelegramHint("")} timeout={10000} />
            <Toast message={notice} kind="success" onClose={() => setNotice("")} />
            <Toast message={error} kind="error" onClose={() => setError("")} timeout={9000} />
          </div>
          {cabinetSection === "notifications" && !!notifications.length && (
            <section className="card notification-center">
              <div className="notification-heading">
                <div>
                  <p className="eyebrow">События</p>
                  <h2>Уведомления {notifications.some((item) => !item.read_at) && <span className="unread-count">{notifications.filter((item) => !item.read_at).length}</span>}</h2>
                </div>
                {notifications.some((item) => !item.read_at) && (
                  <button className="link" onClick={() => void readAllNotifications()}>
                    Прочитать все
                  </button>
                )}
              </div>
              <div className="notification-list">
                {notifications.map((item) => (
                  <button className={`notification-item ${item.read_at ? "is-read" : "is-unread"}`} key={item.id} onClick={() => void readNotification(item)}>
                    <span className="notification-symbol" aria-hidden="true">
                      {item.kind === "clarification" ? "?" : item.kind === "achievement" ? "★" : "✓"}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.message}</small>
                      <time>{fmt(item.created_at)}</time>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {cabinetSection === "notifications" && !notifications.length && <section className="card"><p className="muted">Уведомлений пока нет.</p></section>}
          {cabinetSection === "overview" && <section className="card attention-center">
            <p className="eyebrow">Главная</p>
            <h2>Что требует внимания</h2>
            <p className="muted">Здесь собраны доступные тесты и незавершённые лабораторные.</p>
            {!!notifications.filter((item) => !item.read_at).length && (
              <Link className="attention-notice" to="/profile/notifications">
                <span>Новые уведомления</span>
                <b>{notifications.filter((item) => !item.read_at).length}</b>
              </Link>
            )}
            <h3>Тесты</h3>
            <div className="access-grid">
              {activities.map((item: any) => (
                <Link className="quiz-row student-activity-card" to={`/q/${item.slug}`} key={item.quiz_id}>
                  <span className="activity-icon" aria-hidden="true">?</span><div>
                    <strong>{item.title}</strong>
                    <small>{item.course_run_name}</small>
                  </div>
                  <span className="activity-action">{item.state === "ACTIVE" ? "Продолжить" : "Начать"}<b aria-hidden="true">→</b></span>
                </Link>
              ))}
              {!activities.length && <p className="muted">Сейчас нет доступных тестов.</p>}
            </div>
            <div className="section-heading compact-heading">
              <h3>Лабораторные</h3>
              <Link to="/profile/labs">Все лабораторные →</Link>
            </div>
            <div className="student-lab-list compact-labs">
              {attentionLabs.slice(0, 4).map((lab: any) => {
                const status = labStatus(lab.publication_id);
                return <Link className={`student-lab-card lab-${status.tone}`} to={`/profile/labs/${lab.publication_id}`} key={lab.publication_id}><span className="activity-icon lab-icon" aria-hidden="true">⌘</span><span className="activity-copy"><strong>{lab.title}</strong><small>{lab.course_run_name}{lab.due_at ? ` · до ${fmt(lab.due_at)}` : ""}</small></span><span className="lab-result"><b className="lab-status">{status.label}</b><i aria-hidden="true">→</i></span></Link>;
              })}
              {!attentionLabs.length && <Notice kind="success">Все доступные лабораторные зачтены.</Notice>}
            </div>
          </section>}
          {cabinetSection === "labs" && <section className="card">
            <h2>Лабораторные</h2>
            {!labId && <p className="muted">Откройте лабораторную, чтобы прочитать условие, отправить решение и посмотреть историю попыток.</p>}
            {!labId && <div className="list-filters"><label>Поиск<input value={labQuery} onChange={(e) => setLabQuery(e.target.value)} placeholder="Лабораторная или курс" /></label><label>Статус<select value={labStatusFilter} onChange={(e) => setLabStatusFilter(e.target.value)}><option value="all">Все</option><option value="neutral">Не сдано</option><option value="rejected">Отклонено</option><option value="pending">На проверке</option><option value="accepted">Зачтено</option></select></label></div>}
            {visibleLabs.map((lab: any) => {
              const draft = submissionDrafts[lab.publication_id] ?? {
                repo: "",
                sha: "",
                email: "",
                source: "repository" as const,
              };
              const wait = Math.max(0, Number(lab.next_submission_at || 0) - clock);
              const status = labStatus(lab.publication_id);
              if (!labId) return <Link className={`student-lab-card lab-${status.tone}`} to={`/profile/labs/${lab.publication_id}`} key={lab.publication_id}><span className="activity-icon lab-icon" aria-hidden="true">⌘</span><span className="activity-copy"><strong>{lab.title}</strong><small>{lab.course_run_name}{lab.due_at ? ` · до ${fmt(lab.due_at)}` : ""}</small></span><span className="lab-result"><b className="lab-status">{status.label}</b>{status.score != null && <small>{status.score} из 100</small>}<i aria-hidden="true">→</i></span></Link>;
              return (
                <article className="assignment-card" key={lab.publication_id}>
                  <Link className="back-button" to="/profile/labs">← Вернуться к списку лабораторных</Link>
                  <h3>{lab.title}</h3>
                  <p><LinkifiedText text={lab.description} /></p>
                  <small>
                    {lab.course_run_name}
                    {lab.due_at ? ` · до ${fmt(lab.due_at)}` : ""}
                  </small>
                  <div className="lab-workspace">
                    <h3>Условие и отправка решения</h3>
                    <div className="specification">{lab.specification}</div>
                    {localUploadsEnabled && (
                      <div className="actions compact">
                        <button
                          type="button"
                          className={draft.source === "repository" ? "" : "secondary"}
                          onClick={() =>
                            setSubmissionDrafts({
                              ...submissionDrafts,
                              [lab.publication_id]: {
                                ...draft,
                                source: "repository",
                              },
                            })
                          }
                        >
                          Git repository
                        </button>
                        <button
                          type="button"
                          className={draft.source === "local_upload" ? "" : "secondary"}
                          onClick={() =>
                            setSubmissionDrafts({
                              ...submissionDrafts,
                              [lab.publication_id]: {
                                ...draft,
                                source: "local_upload",
                              },
                            })
                          }
                        >
                          Папка или ZIP локально
                        </button>
                      </div>
                    )}
                    {draft.source === "repository" ? (
                      <>
                        <label>
                          Публичный HTTPS Git repository
                          <input
                            type="url"
                            value={draft.repo}
                            onChange={(e) =>
                              setSubmissionDrafts({
                                ...submissionDrafts,
                                [lab.publication_id]: {
                                  ...draft,
                                  repo: e.target.value,
                                },
                              })
                            }
                            placeholder="https://github.com/user/repository"
                          />
                        </label>
                        <p className="muted">Платформа сама зафиксирует текущую версию репозитория в момент отправки.</p>
                      </>
                    ) : (
                      <div className="grid two">
                        <label>
                          ZIP-архив
                          <input type="file" accept=".zip,application/zip" onChange={(e) => void uploadLocal(lab.publication_id, e.target.files)} />
                        </label>
                        <label>
                          Папка с решением
                          <input type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} onChange={(e) => void uploadLocal(lab.publication_id, e.target.files)} />
                        </label>
                        {draft.uploadLabel && <Notice kind="success">Локальная копия подготовлена: {draft.uploadLabel}</Notice>}
                      </div>
                    )}
                    {wait > 0 && (
                      <p className="cooldown">
                        Следующую версию можно отправить через {Math.floor(wait / 60)} мин {wait % 60} сек · в {fmt(lab.next_submission_at)}
                      </p>
                    )}
                    <button disabled={wait > 0 || (draft.source === "local_upload" && !draft.uploadId)} onClick={() => void requestLabSubmission(lab.publication_id)}>
                      Отправить работу
                    </button>
                  </div>
                </article>
              );
            })}
            {!visibleLabs.length && <p className="muted">По выбранным условиям лабораторных нет.</p>}
            {!!labId && !!submissions.filter((s:any)=>s.assignment_publication_id===labId).length && (
              <section className="submission-history">
                <h3>История отправок</h3>
                {submissions.filter((s:any)=>s.assignment_publication_id===labId).map((s: any) => (
                  <Link className="submission-list-card" to={`/profile/submissions/${s.id}`} key={s.id}>
                    <span><strong>Попытка {s.attempt_number}</strong><small>{fmt(s.submitted_at)} · версия {String(s.commit_sha).slice(0, 8)}</small></span>
                    <span className="status-pill">{submissionLabels[s.student_status] ?? s.student_status}</span>
                  </Link>
                ))}
              </section>
            )}
          </section>}
          {pendingSubmission && submissionPolicy && (
            <div className="modal-backdrop" role="presentation">
              <section className="card consent-modal" role="dialog" aria-modal="true" aria-labelledby="submission-policy-title">
                <h2 id="submission-policy-title">{submissionPolicy.title}</h2>
                {submissionPolicy.paragraphs.map((paragraph: string) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                <label className="option consent-check">
                  <input type="checkbox" checked={policyAccepted} onChange={(e) => setPolicyAccepted(e.target.checked)} /> {submissionPolicy.acknowledgement}
                </label>
                <div className="actions">
                  <button className="secondary" onClick={() => setPendingSubmission(null)}>
                    Отмена
                  </button>
                  <button disabled={!policyAccepted} onClick={() => void submitLab(pendingSubmission)}>
                    Подтвердить и отправить
                  </button>
                </div>
              </section>
            </div>
          )}
          {cabinetSection === "groups" && <>
          <div className="settings-page-heading"><p className="eyebrow">Настройки кабинета</p><h2>Группы и связь</h2><p className="muted">Доступ к курсам и способ получения важных уведомлений.</p></div>
          <div className="settings-card-grid">
          <section className="card settings-card">
            <p className="eyebrow">Доступ к курсам</p>
            <h2>Мои группы</h2>
            <div className="access-grid">
              {groups.memberships.map((g: any) => (
                <div className="access-item" key={g.id}>
                  <strong>{g.course_run_name}</strong>
                  <span>{g.name}</span>
                </div>
              ))}
              {!groups.memberships.length && <p className="muted">Вы пока не состоите ни в одной группе.</p>}
            </div>
            <form className="inline-form" onSubmit={joinGroup}>
              <label>
                Код вступления
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} minLength={6} required />
              </label>
              <button>Подать заявку</button>
            </form>
            {groups.requests
              .filter((r: any) => r.status === "pending")
              .map((r: any) => (
                <Notice key={r.id}>
                  Заявка ожидает решения: {r.course_run_name} / {r.group_name}
                </Notice>
              ))}
          </section>
          <form className="card settings-card notification-settings" onSubmit={saveNotificationPreferences}>
            <p className="eyebrow">Связь</p>
            <h2>Уведомления в Telegram</h2>
            <p className="muted">В Telegram будут дублироваться вопросы по лабораторным, результаты проверок и другие важные события курса.</p>
            <div className={`telegram-link-state ${notificationPreferences.telegram_linked ? "is-linked" : ""}`}>
              <span><strong>Telegram</strong><small>{notificationPreferences.telegram_linked ? "Бот подключён" : "Не подключён"}</small></span>
              <div className="actions compact">
                <button type="button" className="secondary" disabled={!notificationPreferences.telegram_bot_username} onClick={() => void connectTelegram()}>{!notificationPreferences.telegram_bot_username ? "Бот пока не настроен" : notificationPreferences.telegram_linked ? "Подключить заново" : "Подключить Telegram"}</button>
                {notificationPreferences.telegram_linked && <button type="button" className="link danger-text" onClick={() => void unlinkTelegram()}>Отвязать</button>}
              </div>
            </div>
            {notificationPreferences.telegram_linked && <label className="option"><input type="checkbox" checked={notificationPreferences.telegram_enabled} onChange={(e) => setNotificationPreferences({ ...notificationPreferences, telegram_enabled: e.target.checked })} /> Получать уведомления в Telegram</label>}
            {notificationPreferences.telegram_linked && <button>Сохранить настройки</button>}
          </form>
          </div>
          </>}
          {cabinetSection === "pride" && (
            <section className="pride-wall">
              <div className="pride-wall-heading">
                <div>
                  <p className="eyebrow">Личная коллекция</p>
                  <h2>Стена достижений</h2>
                  <p className="muted">Достижения и медали собраны здесь.</p>
                </div>
                {profile.is_public && (
                  <a className="button secondary" href={`/p/${profile.share_token}`} target="_blank" rel="noreferrer">
                    Открыть публичную стену
                  </a>
                )}
              </div>
              <section className="card pride-sharing-settings">
                <div>
                  <p className="eyebrow">Публичный профиль</p>
                  <h2>Поделиться достижениями</h2>
                  {profile.is_public ? <a className="public-profile-url" href={`/p/${profile.share_token}`} target="_blank" rel="noreferrer">{location.origin}/p/{profile.share_token}</a> : <p className="muted">Сейчас коллекция видна только вам. Откройте публичный профиль, чтобы поделиться ссылкой.</p>}
                </div>
                <div className="actions compact">
                  {profile.is_public ? <><button className="secondary" onClick={copyProfile}>Скопировать ссылку</button><button className="secondary" onClick={rotateProfileLink}>Обновить ссылку</button><button className="secondary danger-text" onClick={() => setPublic(false)}>Скрыть профиль</button></> : <button onClick={() => setPublic(true)}>Открыть публичный профиль</button>}
                </div>
              </section>
              <BadgeShowcase badges={profile.badges} />
            </section>
          )}
        </>
      ) : (
        <p>Загрузка…</p>
      )}
    </Layout>
  );
}

const submissionLabels: Record<string, string> = {
  queued: "Ожидает проверки",
  processing: "Проверяется",
  blocked_duplicate_repo: "Требуется решение преподавателя",
  deterministic_failed: "Автоматическая проверка не пройдена",
  awaiting_answers: "Ожидаются ответы на вопросы",
  awaiting_clarification: "Требуется уточнение",
  awaiting_teacher_review: "Ожидает преподавателя",
  manual_defense: "Назначена ручная защита",
  finalized: "Проверка завершена",
};
const evidenceCategoryLabels: Record<string, string> = {
  unit: "Автоматический тест",
  contract: "Контракт",
  correctness: "Корректность",
  code_quality: "Качество кода",
  performance: "Производительность",
  resource: "Ресурсы",
  code: "Код",
  report: "Отчёт",
  deterministic_test: "Автотест",
  runtime_metric: "Метрика runtime",
  contract_check: "Проверка контракта",
  student_answer: "Ответ студента",
  grader_observation: "Наблюдение grader",
};
const decisionLabels: Record<string, string> = {
  approve: "Работа зачтена",
  override_score: "Выставлена итоговая оценка",
  manual_defense: "Назначена ручная защита",
  reject: "Работа отклонена",
  finalize_manual_defense: "Ручная защита завершена",
};
const lab1CheckTitles: Record<string, string> = {
  count_vowels: "Подсчёт гласных", has_unique_characters: "Уникальность символов", count_one_bits: "Единичные биты",
  multiplicative_persistence: "Мультипликативная устойчивость", mse: "Средняя квадратичная ошибка", prime_factorization: "Разложение на простые множители",
  pyramid: "Сумма квадратов", is_balanced_number: "Сбалансированное число", sum_prod: "Пакетное произведение матриц",
  binarize: "Бинаризация", unique_rows: "Уникальные значения строк", unique_columns: "Уникальные значения столбцов",
  matrix_statistics: "Статистики матрицы", chess: "Шахматная матрица", draw_rectangle: "Прямоугольник",
  draw_ellipse: "Эллипс", analyze_time_series: "Анализ временного ряда", one_hot: "One-hot кодирование",
};
function checkTitle(check: any, index: number) {
  const raw = String(check.name ?? check.id ?? "").replace(/^function:/, "");
  if (lab1CheckTitles[raw]) return lab1CheckTitles[raw];
  if (check.name) return check.name;
  const id = String(check.id ?? "");
  if (id.startsWith("function:")) return `Функция ${id.slice(9)}`;
  return id || `Проверка ${index + 1}`;
}
const lab1PythonFunctions = new Set(["count_vowels", "has_unique_characters", "count_one_bits", "multiplicative_persistence", "magic", "mse", "prime_factorization", "pyramid", "is_balanced_number"]);
function checkSection(check: any) {
  if (check.section) return String(check.section);
  const name = String(check.name ?? check.id ?? "").replace(/^function:/, "");
  return lab1PythonFunctions.has(name) ? "Python" : name ? "NumPy" : "Общие проверки";
}
function DetailsChevron() {
  return <svg className="details-chevron" aria-hidden="true" viewBox="0 0 20 20">
    <path d="m5 7.5 5 5 5-5" />
  </svg>;
}
function GroupedGraderChecks({ checks }: { checks: any[] }) {
  const passed = checks.filter((check: any) => check.passed === true || ["passed", "ok"].includes(check.status));
  const problems = checks.filter((check: any) => !passed.includes(check));
  const renderGroups = (items: any[], passedGroup: boolean) => {
    const groups = new Map<string, any[]>();
    items.forEach((item) => groups.set(checkSection(item), [...(groups.get(checkSection(item)) ?? []), item]));
    return [...groups.entries()].map(([section, sectionChecks]) => (
      <details className={`grader-check-section ${passedGroup ? "semantic-check-group" : "problem-check-section"}`} key={section} open={!passedGroup}>
        <summary><span>{section}</span><small>{sectionChecks.length}</small><DetailsChevron /></summary>
        <div className="passed-check-grid">
          {sectionChecks.map((check: any, index: number) => {
            const warning = check.severity === "warning";
            return <div className={`grader-check ${passedGroup ? "is-passed" : warning ? "is-warning" : "is-critical"}`} key={check.id ?? index}>
              <span className="check-symbol" aria-hidden="true">{passedGroup ? "✓" : warning ? "▲" : "×"}</span>
              <span><strong>{checkTitle(check, index)}</strong><small>{passedGroup ? "Пройдена" : warning ? "Есть замечание" : "Не пройдена"}</small></span>
            </div>;
          })}
        </div>
      </details>
    ));
  };
  return <section className="grader-checks">
    <h3>Результаты автопроверки</h3>
    {!!problems.length && <details className="check-result-group problem-checks" open>
      <summary><span className="check-symbol">×</span><span>Требуют внимания: {problems.length}</span><DetailsChevron /></summary>
      {renderGroups(problems, false)}
    </details>}
    {!!passed.length && <details className="check-result-group passed-checks" open={!problems.length}>
      <summary><span className="check-symbol">✓</span><span>Пройдено: {passed.length}</span><DetailsChevron /></summary>
      {renderGroups(passed, true)}
    </details>}
  </section>;
}
function SubmissionCard({ submission: s }: { submission: any }) {
  const [answer, setAnswer] = useState(""),
    [answerError, setAnswerError] = useState("");
  async function sendAnswer() {
    try {
      await api(`/api/student/clarifications/${s.clarification.id}/answer`, json("POST", { answer }));
      location.reload();
    } catch (e) {
      setAnswerError((e as Error).message);
    }
  }
  const awaiting = s.clarification && !s.clarification.answered_at && ["awaiting_answer_1", "awaiting_answer_2"].includes(s.clarification.state);
  return (
    <article className={`submission-card status-${s.student_status}`}>
      <div className="submission-head">
        <div>
          <strong>
            {s.title} · попытка {s.attempt_number}
          </strong>
          <small>
            {fmt(s.submitted_at)} · commit {String(s.commit_sha).slice(0, 10)}
          </small>
        </div>
        <span className="status-pill">{submissionLabels[s.student_status] ?? s.student_status}</span>
      </div>
      {s.status === "finalized" && s.final_score != null && (
        <div className="student-lab-score" aria-label={`Итоговый балл: ${s.final_score} из 100`}>
          <span>Итоговый балл</span>
          <strong>{s.final_score}<small> / 100</small></strong>
        </div>
      )}
      <a href={s.repo_url} target="_blank" rel="noreferrer">
        {s.repo_url}
      </a>
      {s.public_summary && <p className="submission-summary">{s.public_summary}</p>}
      {awaiting && (
        <div className="clarification-box">
          <strong>Вопрос по работе</strong>
          <p>{s.clarification.question}</p>
          <small>Ответить до {fmt(s.clarification.answer_deadline_at)}</small>
          <Notice>Ответьте по возможности быстрее: контекст этой проверки хранится ограниченное время, и быстрый ответ помогает продолжить диалог без потери деталей.</Notice>
          <textarea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Дайте содержательный ответ" />
          <button disabled={answer.trim().length < 20} onClick={() => void sendAnswer()}>
            Отправить ответ
          </button>
          <ErrorBox error={answerError} />
        </div>
      )}
      {!!s.public_diagnostics?.length && (
        <div className="diagnostic-list">
          {s.public_diagnostics.map((d: any, index: number) => (
            <div className="diagnostic" key={`${d.code}-${index}`}>
              <strong>{d.title}</strong>
              <p>{d.message}</p>
              {d.location && <code>{d.location}</code>}
              {d.expected && <small>Ожидалось: {d.expected}</small>}
              {d.actual && <small>Получено: {d.actual}</small>}
              {d.hint && <p className="hint">Что проверить: {d.hint}</p>}
            </div>
          ))}
        </div>
      )}
      {!!s.checks?.length && <GroupedGraderChecks checks={s.checks} />}
      {s.deterministic_gate === "failed" && <p className="muted">LLM-защита не запускалась, потому что автоматическая проверка не пройдена.</p>}
    </article>
  );
}

function StudentSubmissionPage() {
  const { submissionId = "" } = useParams();
  const [submission, setSubmission] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/student/session").then((session) => {
      setCsrf(session.csrf_token);
      return api("/api/student/submissions");
    }).then((payload) => {
      const found = payload.items.find((item: any) => item.id === submissionId);
      if (!found) throw new Error("Посылка не найдена или недоступна");
      setSubmission(found);
    }).catch((cause) => setError(cause.message));
  }, [submissionId]);
  return <Layout student>
    <div className="review-page-navigation"><Link className="back-button" to={submission ? `/profile/labs/${submission.assignment_publication_id}` : "/profile/labs"}>← К лабораторной</Link></div>
    <section className="profile-head"><p className="eyebrow">Лабораторная работа</p><h1>{submission?.title ?? "Посылка"}</h1><p className="muted">Результат, вопросы и этапы проверки одной отправки.</p></section>
    <ErrorBox error={error} />
    {submission ? <SubmissionCard submission={submission} /> : !error && <p>Загрузка…</p>}
  </Layout>;
}

function PublicProfile() {
  const { token = "" } = useParams();
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/api/public/profiles/${token}`)
      .then(setProfile)
      .catch((cause) => setError(cause.message));
  }, [token]);
  return (
    <Layout>
      <section className="profile-head public-profile-head">
        <p className="eyebrow">ITRUIM</p>
        <h1>Коллекция достижений</h1>
        <p className="muted">Медали и достижения курса.</p>
      </section>
      <ErrorBox error={error} />
      {profile && <BadgeShowcase badges={profile.badges} />}
    </Layout>
  );
}

function QuizPage() {
  const { slug = "" } = useParams();
  const [landing, setLanding] = useState<AnyRecord | null>(null);
  const [state, setState] = useState<AnyRecord | null>(null);
  const [code, setCode] = useState("");
  const [fio, setFio] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/api/public/quizzes/${slug}`)
      .then(setLanding)
      .catch((e) => setError(e.message));
    api("/api/student/session")
      .then((s) => {
        setCsrf(s.csrf_token);
        return api(`/api/student/quizzes/${slug}/access`);
      })
      .then(setState)
      .catch(() => {});
  }, [slug]);
  async function login(e: FormEvent) {
    e.preventDefault();
    try {
      const s = await api("/api/student/session", json("POST", { fio, student_code: code }));
      setCsrf(s.csrf_token);
      setState(await api(`/api/student/quizzes/${slug}/access`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function start() {
    try {
      setState(await api(`/api/student/quizzes/${slug}/attempts`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (error && !landing)
    return (
      <Layout>
        <Notice kind="error">{error}</Notice>
      </Layout>
    );
  return (
    <Layout>
      {!state ? (
        <section className="card narrow">
          <p className="eyebrow">{landing?.title ?? "Тест"}</p>
          <h1>Введите код студента</h1>
          <p>{landing?.description}</p>
          {landing?.start_deadline_at && <Notice>Начать можно до {fmt(landing.start_deadline_at)}</Notice>}
          <form onSubmit={login}>
            <label>
              Фамилия Имя Отчество
              <input value={fio} onChange={(e) => setFio(e.target.value)} required autoComplete="name" />
            </label>
            <label>
              Код
              <input value={code} minLength={12} maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase())} required autoCapitalize="characters" />
            </label>
            <button>Продолжить</button>
          </form>
          <ErrorBox error={error} />
        </section>
      ) : state.state === "READY" ? (
        <section className="card narrow">
          <p className="eyebrow">Готовы начать?</p>
          <h1>{state.quiz.title}</h1>
          <p>{state.quiz.description}</p>
          <dl className="facts">
            <div>
              <dt>Вопросов</dt>
              <dd>{state.quiz.question_count}</dd>
            </div>
            <div>
              <dt>Время</dt>
              <dd>{Math.ceil(state.quiz.total_time_seconds / 60)} мин</dd>
            </div>
          </dl>
          {state.quiz.start_deadline_at && <Notice>Начать можно до {fmt(state.quiz.start_deadline_at)}</Notice>}
          <button onClick={start}>Начать тест</button>
          <ErrorBox error={error} />
        </section>
      ) : state.state === "ACTIVE" ? (
        <AttemptView data={state} onResult={setState} />
      ) : state.state === "RESULT" ? (
        <ResultView data={state} onRetry={setState} />
      ) : (
        <section className="card narrow">
          <h1>{state.state === "NOT_OPEN" ? "Тест ещё не открыт" : "Приём новых попыток завершён"}</h1>
          {state.opens_at && <p>Откроется {fmt(state.opens_at)}</p>}
        </section>
      )}
    </Layout>
  );
}

function AttemptView({ data, onResult }: { data: AnyRecord; onResult: (v: any) => void }) {
  const a = data.attempt;
  const initialRemaining = Math.max(0, a.expires_at - data.server_now);
  const [answers, setAnswers] = useState<AnyRecord>(a.answers ?? {});
  const [remaining, setRemaining] = useState(initialRemaining);
  const [save, setSave] = useState("");
  const [error, setError] = useState("");
  const timers = useRef<Record<string, number>>({});
  const chains = useRef<Record<string, Promise<unknown>>>({});
  useEffect(() => {
    const started = performance.now();
    const t = setInterval(() => setRemaining(Math.max(0, initialRemaining - Math.floor((performance.now() - started) / 1000))), 250);
    return () => clearInterval(t);
  }, [a.id, initialRemaining]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  useEffect(() => {
    if (remaining === 0)
      api(`/api/student/attempts/${a.id}`)
        .then(onResult)
        .catch(() => {});
  }, [remaining]);
  function change(q: any, value: any) {
    setAnswers((current) => {
      const next = { ...current };
      value == null ? delete next[q.id] : (next[q.id] = value);
      return next;
    });
    setSave("Сохраняем…");
    clearTimeout(timers.current[q.id]);
    timers.current[q.id] = window.setTimeout(() => {
      const operation = () => api(`/api/student/attempts/${a.id}/answers/${q.id}`, value == null ? { method: "DELETE" } : json("PUT", value));
      chains.current[q.id] = (chains.current[q.id] ?? Promise.resolve())
        .catch(() => {})
        .then(operation)
        .then(() => setSave("Сохранено"))
        .catch((e) => setError((e as Error).message));
    }, 500);
  }
  async function submit() {
    try {
      Object.values(timers.current).forEach(clearTimeout);
      onResult(await api(`/api/student/attempts/${a.id}/submit`, json("POST", { answers })));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="attempt">
      <div className="attempt-top">
        <div>
          <p className="eyebrow">Попытка {a.attempt_no}</p>
          <h1>{a.version.title}</h1>
        </div>
        <div className={`timer ${remaining < 60 ? "urgent" : ""}`} aria-live="polite">
          {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
        </div>
      </div>
      <div className="save-state" aria-live="polite">
        {save}
      </div>
      {a.version.questions.map((q: any, i: number) => (
        <Question key={q.id} q={q} n={i + 1} value={answers[q.id]} onChange={(v: any) => change(q, v)} />
      ))}
      <ErrorBox error={error} />
      <button className="large" onClick={submit}>
        Завершить тест
      </button>
    </section>
  );
}
function Question({ q, n, value, onChange }: { q: any; n: number; value: any; onChange: (v: any) => void }) {
  return (
    <article className="question">
      <p className="eyebrow">
        {n} / {q.points} {q.points === 1 ? "балл" : "балла"}
      </p>
      <h2>{q.text}</h2>
      {q.type === "SINGLE" &&
        q.options.map((o: any) => (
          <label className="option" key={o.id}>
            <input type="radio" name={q.id} checked={value?.optionId === o.id} onChange={() => onChange({ type: "SINGLE", optionId: o.id })} />
            <span>{o.text}</span>
          </label>
        ))}
      {q.type === "MULTIPLE" &&
        q.options.map((o: any) => (
          <label className="option" key={o.id}>
            <input
              type="checkbox"
              checked={value?.optionIds?.includes(o.id) ?? false}
              onChange={(e) => {
                const ids = new Set(value?.optionIds ?? []);
                e.target.checked ? ids.add(o.id) : ids.delete(o.id);
                onChange(ids.size ? { type: "MULTIPLE", optionIds: [...ids] } : null);
              }}
            />
            <span>{o.text}</span>
          </label>
        ))}
      {q.type === "NUMERIC" && <input type="text" inputMode={q.numeric_kind === "INTEGER" ? "numeric" : "decimal"} placeholder={q.numeric_kind === "INTEGER" ? "Введите целое число" : "Например, 12,5"} value={value?.value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : { type: "NUMERIC", value: e.target.value })} />} {q.type === "SHORT_TEXT" && <input value={value?.text ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : { type: "SHORT_TEXT", text: e.target.value })} />}
    </article>
  );
}
function ResultView({ data, onRetry }: { data: AnyRecord; onRetry: (v: any) => void }) {
  const r = data.result;
  async function retry() {
    onRetry(
      await api(`/api/student/attempts/${r.attempt_id}/retry`, {
        method: "POST",
      }),
    );
  }
  return (
    <section className="result card">
      <p className="eyebrow">Попытка {r.attempt_no} завершена</p>
      <div className="score">
        {r.score} <span>/ {r.max_score}</span>
      </div>
      <div className="percent">{(r.percent_bp / 100).toFixed(2)}%</div>
      <p>
        Правильных ответов: <strong>{r.correct_answers}</strong> из {r.question_count}
      </p>
      {r.achievement && (
        <div className={`achievement ${r.achievement.theme ?? "default"}`} style={{ borderColor: r.achievement.accent_color ?? undefined }}>
          {r.achievement.image_key && <img src={`/media/${r.achievement.image_key}`} alt="" />}
          <div className="emoji">{r.achievement.emoji}</div>
          <h1>{r.achievement.title}</h1>
          <p>{r.achievement.description}</p>
        </div>
      )}
      {r.retry_eligible && (
        <button disabled={!r.retry_available} onClick={retry}>
          Пройти ещё раз
        </button>
      )}
      {r.retry_eligible && !r.retry_available && <Notice>Повтор разрешён, но окно начала теста уже закрыто.</Notice>}
      <div className="actions profile-cta">
        <Link className="button secondary" to="/profile">
          Открыть стенд бэджей
        </Link>
      </div>
      {r.review && (
        <details>
          <summary>Разбор ответов</summary>
          {r.review.map((x: any) => (
            <div className="review" key={x.question_id}>
              <strong>
                {x.is_correct ? "✓" : "✕"} {x.question}
              </strong>
              <p className="muted">Ваш ответ</p>
              <pre>{JSON.stringify(x.student_answer, null, 2)}</pre>
              <p className="muted">Правильный ответ</p>
              <pre>{JSON.stringify(x.correct_answer, null, 2)}</pre>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

function AdminGuard({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    api("/api/admin/session")
      .then((s) => {
        setCsrf(s.csrf_token);
        setOk(true);
      })
      .catch(() => setOk(false));
  }, []);
  if (ok === null) return <main>Загрузка…</main>;
  return ok ? <>{children}</> : <Navigate to="/admin/login" replace />;
}
function AdminLogin() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [e, setE] = useState("");
  const nav = useNavigate();
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    try {
      const s = await api("/api/admin/session", json("POST", { username: u, password: p }));
      setCsrf(s.csrf_token);
      nav("/admin");
    } catch (x) {
      setE((x as Error).message);
    }
  }
  return (
    <Layout>
      <section className="card narrow">
        <p className="eyebrow">Преподаватель</p>
        <h1>Вход</h1>
        <form onSubmit={submit}>
          <label>
            Логин
            <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Пароль
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
          </label>
          <button>Войти</button>
        </form>
        <ErrorBox error={e} />
      </section>
    </Layout>
  );
}

function AdminHome() {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [e, setE] = useState("");
  const load = () => api("/api/admin/quizzes").then((r) => setItems(r.items)).finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);
  async function create(ev: FormEvent) {
    ev.preventDefault();
    try {
      const q = await api("/api/admin/quizzes", json("POST", { title, description: "" }));
      location.href = `/admin/quizzes/${q.id}`;
    } catch (x) {
      setE((x as Error).message);
    }
  }
  return (
    <AdminGuard>
      <Layout admin>
        <div className="catalog-header">
          <div>
            <p className="eyebrow">Администрирование</p>
            <h1>Тесты</h1>
            <p className="muted">Создавайте тесты, открывайте их для редактирования и управляйте публикациями.</p>
          </div>
          <button onClick={() => setCreating(true)}>Создать тест</button>
        </div>
        <section className="entity-list" aria-label="Список тестов">
            {loading && <ListSkeleton />}
            {items.map((q) => (
              <Link className="entity-list-item" key={q.id} to={`/admin/quizzes/${q.id}`}>
                <span className="entity-icon">?</span><div className="entity-copy">
                  <strong>{q.title}</strong>
                  <small>/q/{q.slug}</small>
                </div>
                <span className="entity-status">{q.draft_version_id ? `Черновик v${q.draft_version_number}` : q.published_version_id ? `Опубликован v${q.published_version_number}` : "Без версии"}</span><b className="entity-arrow">→</b>
              </Link>
            ))}
            {!loading && !items.length && <div className="empty-state"><strong>Тестов пока нет</strong><span>Создайте первый тест, затем добавьте вопросы и опубликуйте его.</span></div>}
        </section>
        {creating && <Modal titleId="create-quiz-title" onClose={() => setCreating(false)}><form className="card create-dialog" onSubmit={create}>
            <p className="eyebrow">Новый объект</p>
            <h2 id="create-quiz-title">Новый тест</h2>
            <label>
              Название
              <input value={title} onChange={(x) => setTitle(x.target.value)} required />
            </label>
            <div className="actions"><button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button><button>Создать</button></div>
            <ErrorBox error={e} />
          </form></Modal>}
      </Layout>
    </AdminGuard>
  );
}

function AdminAssignments() {
  const [items, setItems] = useState<any[]>([]),
    [courses, setCourses] = useState<any[]>([]), [courseId, setCourseId] = useState(""),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""), [creating, setCreating] = useState(false), [loading, setLoading] = useState(true);
  const load = () => Promise.all([api("/api/admin/assignments"), api("/api/admin/courses")]).then(([x, c]) => {
    setItems(x.items); setCourses(c.items); setCourseId((current) => current || c.items[0]?.id || "");
  }).finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const x = await api("/api/admin/assignments", json("POST", { course_id: courseId, title, description: "" }));
      location.href = `/admin/assignments/${x.id}`;
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <AdminGuard>
      <Layout admin>
        <div className="catalog-header">
          <div>
            <p className="eyebrow">Учебные задания</p>
            <h1>Лабораторные</h1>
            <p className="muted">Задания с контрактами, автоматической проверкой и оцениванием.</p>
          </div>
          <button onClick={() => setCreating(true)}>Создать лабораторную</button>
        </div>
        <div className="entity-list" aria-label="Список лабораторных">
            {loading && <ListSkeleton />}
            {items.map((x) => (
              <Link className="entity-list-item" to={`/admin/assignments/${x.id}`} key={x.id}>
                <span className="entity-icon">⌘</span><div className="entity-copy">
                  <strong>{x.title}</strong>
                  <small>{x.course_title} · {x.slug}</small>
                </div>
                <span className="entity-status">{x.draft_version_id ? `Черновик v${x.draft_version_number}` : x.published_version_id ? `Опубликована v${x.published_version_number}` : "Без версии"}</span><b className="entity-arrow">→</b>
              </Link>
            ))}
            {!loading && !items.length && <div className="empty-state"><strong>Лабораторных пока нет</strong><span>Создайте задание и настройте его проверку.</span></div>}
        </div>
        {creating && <Modal titleId="create-assignment-title" onClose={() => setCreating(false)}><form className="card create-dialog" onSubmit={create}>
            <p className="eyebrow">Новое задание</p>
            <h2 id="create-assignment-title">Новая лабораторная</h2>
            <label>Курс<select required value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">Выберите курс</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label>
            <label>
              Название
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <div className="actions"><button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button><button>Создать</button></div>
            <ErrorBox error={error} />
          </form></Modal>}
      </Layout>
    </AdminGuard>
  );
}

function AssignmentAdmin() {
  const { id = "" } = useParams();
  const [assignment, setAssignment] = useState<any>(null),
    [version, setVersion] = useState<any>(null),
    [error, setError] = useState("");
  async function load() {
    const a = await api(`/api/admin/assignments/${id}`);
    setAssignment(a);
    const draft = a.versions.find((v: any) => v.status === "DRAFT");
    setVersion(draft ? await api(`/api/admin/assignment-versions/${draft.id}`) : null);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);
  async function makeDraft() {
    try {
      setVersion(await api(`/api/admin/assignments/${id}/draft`, { method: "POST" }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!assignment)
    return (
      <AdminGuard>
        <Layout admin>
          Загрузка…
          <ErrorBox error={error} />
        </Layout>
      </AdminGuard>
    );
  const published = assignment.versions.find((v: any) => v.status === "PUBLISHED");
  return (
    <AdminGuard>
      <Layout admin>
        <div className="page-head">
          <div>
            <p className="eyebrow">Лабораторная работа</p>
            <h1>{assignment.title}</h1>
          </div>
          {!version && published && <button onClick={() => void makeDraft()}>Редактировать новую версию</button>}
        </div>
        <ErrorBox error={error} />
        {version ? <AssignmentVersionEditor version={version} setVersion={setVersion} reload={load} /> : <Notice>Нет draft-версии.</Notice>}
        <AssignmentAchievementBindings assignment={assignment} />
        {published && <AssignmentPublicationEditor versionId={published.id} />}
      </Layout>
    </AdminGuard>
  );
}

function AssignmentAchievementBindings({ assignment }: { assignment: any }) {
  const [items, setItems] = useState<any[]>([]), [selected, setSelected] = useState<string[]>([]), [notice, setNotice] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    void api("/api/admin/platform-achievements").then((data) => {
      const courseItems = data.items.filter((item: any) => item.course_id === assignment.course_id);
      setItems(courseItems);
      setSelected(courseItems.filter((item: any) => JSON.parse(item.assignment_ids_json || "[]").includes(assignment.id)).map((item: any) => item.id));
    }).catch((cause) => setError(cause.message));
  }, [assignment.id, assignment.course_id]);
  async function save() {
    setError("");
    try {
      await api(`/api/admin/assignments/${assignment.id}/achievement-bindings`, json("PUT", { achievement_ids: selected }));
      setNotice("Привязки достижений сохранены");
    } catch (cause) { setError((cause as Error).message); }
  }
  return <section className="card assignment-achievement-bindings"><div className="section-heading"><div><p className="eyebrow">Достижения</p><h2>Привязка к лабораторной</h2><p className="muted">Здесь выбираются готовые достижения. Названия, правила и изображения редактируются только в общем каталоге.</p></div><Link className="button secondary" to="/admin/platform-achievements">Открыть каталог</Link></div><div className="toast-stack"><Toast message={notice} onClose={() => setNotice("")} /><Toast message={error} kind="error" onClose={() => setError("")} /></div>{items.length ? <div className="binding-list">{items.map((item) => <label className="binding-card" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /><span className="entity-icon">{item.image_key ? <img src={`/media/${item.image_key}`} alt="" /> : item.emoji}</span><span><strong>{item.title}</strong><small>{item.description}</small></span></label>)}</div> : <p className="muted">Для курса пока нет достижений.</p>}<div className="actions"><button type="button" onClick={() => void save()}>Сохранить привязки</button></div></section>;
}

function AssignmentVersionEditor({ version, setVersion, reload }: { version: any; setVersion: (x: any) => void; reload: () => Promise<void> }) {
  const contract = version.grader_contract ?? {},
    resources = version.resource_policy ?? {},
    dependencies = version.dependency_policy ?? {};
  const initial = {
    specification: version.specification ?? "",
    starter_repository_url: version.starter_repository_url ?? "",
    starter_commit_sha: version.starter_commit_sha ?? "",
    contract_directory: contract.contract_directory ?? "grader_contracts",
    contract_files: (contract.required_files ?? []).join("\n"),
    contract_functions: (contract.functions ?? []).map((x: any) => `${x.name}|${x.input_type}|${x.return_type ?? "None"}`).join("\n"),
    runtime_profile: version.runtime_profile === "GPU" ? "GPU" : "CPU",
    environment_version: version.environment_version ?? "cpu-v1",
    dependencies: (dependencies.allow ?? []).join(", "),
    cpu_threads: resources.cpu_threads ?? 1,
    ram_mb: resources.ram_mb ?? 512,
    wall_time_sec: resources.wall_time_sec ?? 60,
    pids: resources.pids ?? 64,
    gpu_count: resources.gpu?.count ?? 0,
    gpu_vram_mb: resources.gpu?.vram_mb ?? 0,
    rubric: version.rubric ?? "",
    rubric_definition: JSON.stringify(version.rubric_definition ?? { version: "v1", criteria: [] }, null, 2),
    grader_repository: version.grader_repository ?? "",
    grader_commit_sha: version.grader_commit_sha ?? "",
    grader_path: version.grader_path ?? "",
    grader_entrypoint: version.grader_entrypoint ?? "",
    private_grader_config: JSON.stringify(version.private_grader_config ?? {}, null, 2),
    review_focus: version.review_focus ?? "",
    grading_pipeline: JSON.stringify(version.grading_pipeline ?? { version: "v1", stages: [] }, null, 2),
    achievement_definitions: JSON.stringify(version.achievement_definitions ?? [], null, 2),
    llm_enabled: version.llm_pipeline?.enabled ?? true,
    llm_preset: version.llm_pipeline?.preset ?? "one_clarification",
    llm_max_rounds: version.llm_pipeline?.max_rounds ?? 1,
    llm_questions_per_round: version.llm_pipeline?.max_questions_per_round ?? 1,
    llm_answer_deadline: version.llm_pipeline?.answer_deadline_seconds ?? 86400,
    llm_final_decision: version.llm_pipeline?.final_decision ?? "teacher",
  };
  const [form, setForm] = useState(initial),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const field = (name: keyof typeof form) => ({
    value: form[name],
    onChange: (e: any) => setForm({ ...form, [name]: e.target.value }),
  });
  function payload() {
    const functions = String(form.contract_functions)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, input_type, return_type = "None"] = line.split("|").map((x) => x.trim());
        if (!name || !input_type) throw new Error(`Некорректный контракт функции: ${line}`);
        return {
          name,
          input_type,
          return_type,
          allow_additional_optional_parameters: true,
        };
      });
    return {
      specification: form.specification,
      starter_repository_url: form.starter_repository_url || null,
      starter_commit_sha: form.starter_commit_sha || null,
      grader_contract: {
        contract_directory: form.contract_directory,
        required_files: String(form.contract_files)
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
        functions,
      },
      runtime_profile: form.runtime_profile,
      environment_version: form.environment_version,
      dependency_policy: {
        allow: String(form.dependencies)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      },
      resource_policy: {
        cpu_threads: Number(form.cpu_threads),
        ram_mb: Number(form.ram_mb),
        wall_time_sec: Number(form.wall_time_sec),
        pids: Number(form.pids),
        gpu: {
          required: form.runtime_profile === "GPU",
          count: form.runtime_profile === "GPU" ? Number(form.gpu_count) : 0,
          vram_mb: form.runtime_profile === "GPU" ? Number(form.gpu_vram_mb) : 0,
        },
      },
      rubric: form.rubric,
      rubric_definition: JSON.parse(form.rubric_definition),
      grader_repository: form.grader_repository,
      grader_commit_sha: form.grader_commit_sha,
      grader_path: form.grader_path,
      grader_entrypoint: form.grader_entrypoint,
      private_grader_config: JSON.parse(form.private_grader_config),
      review_focus: form.review_focus,
      grading_pipeline: JSON.parse(form.grading_pipeline),
      achievement_definitions: JSON.parse(form.achievement_definitions),
      llm_pipeline: {
        version: "v1",
        enabled: Boolean(form.llm_enabled),
        preset: form.llm_preset,
        max_rounds: Number(form.llm_max_rounds),
        max_questions_per_round: Number(form.llm_questions_per_round),
        answer_deadline_seconds: Number(form.llm_answer_deadline),
        final_decision: form.llm_final_decision,
      },
    };
  }
  async function save() {
    setError("");
    try {
      const next = await api(`/api/admin/assignment-versions/${version.id}`, json("PUT", payload(), { "If-Match": String(version.revision) }));
      setVersion(next);
      setNotice("Черновик сохранён");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function publish() {
    setError("");
    try {
      await api(`/api/admin/assignment-versions/${version.id}/publish`, {
        method: "POST",
        headers: { "If-Match": String(version.revision) },
      });
      setNotice("Версия опубликована");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card">
      <p className="eyebrow">Черновик · версия {version.version_number}</p>
      <h2>Лабораторная и контракт</h2>
      {dirty && <Notice>Есть несохранённые изменения.</Notice>}
      <div className="toast-stack" aria-live="polite"><Toast message={notice} onClose={() => setNotice("")} /><Toast message={error} kind="error" onClose={() => setError("")} timeout={9000} /></div>
      <nav className="editor-steps" aria-label="Этапы настройки лабораторной">
        <a href="#assignment-content"><span>1</span>Задание</a>
        <a href="#assignment-contracts"><span>2</span>Контракты</a>
        <a href="#assignment-reviewer"><span>3</span>Reviewer</a>
        <a href="#assignment-pipeline"><span>4</span>Проверка</a>
        <a href="#assignment-runtime"><span>5</span>Runtime</a>
      </nav>
      <div className="editor-step" id="assignment-content">
      <p className="eyebrow">Шаг 1 · задание</p>
      <AssignmentRubricEditor value={String(form.rubric_definition)} onChange={(rubric_definition) => setForm({ ...form, rubric_definition })} />
      <label>
        Условие
        <textarea rows={10} {...field("specification")} />
      </label>
      <div className="grid two">
        <label>
          Starter repository
          <input {...field("starter_repository_url")} />
        </label>
        <label>
          Starter commit SHA
          <input {...field("starter_commit_sha")} />
        </label>
        <label>
          Среда выполнения
          <select
            value={form.runtime_profile}
            onChange={(e) =>
              setForm({
                ...form,
                runtime_profile: e.target.value,
                environment_version: e.target.value === "GPU" ? "gpu-v1" : "cpu-v1",
                gpu_count: e.target.value === "GPU" ? 1 : 0,
                gpu_vram_mb: e.target.value === "GPU" ? Math.max(Number(form.gpu_vram_mb), 4096) : 0,
              })
            }
          >
            <option value="CPU">CPU</option>
            <option value="GPU">GPU</option>
          </select>
        </label>
      </div>
      </div>
      <div className="contract-builder editor-step" id="assignment-contracts">
        <p className="eyebrow">Шаг 2 · интерфейс решения</p>
        <h3>Что обязан реализовать студент</h3>
        <p className="muted">Контракты содержат только dataclass/Pydantic-типы. Одна функция на строку: имя | входной тип | выходной тип.</p>
        <label>
          Директория контрактов
          <input {...field("contract_directory")} />
        </label>
        <label>
          Обязательные contract-файлы
          <textarea rows={4} className="code-input" {...field("contract_files")} placeholder={"grader_contracts/fit.py\ngrader_contracts/model.py"} />
        </label>
        <label>
          Функции
          <textarea rows={6} className="code-input" {...field("contract_functions")} placeholder={"fit|grader_contracts.fit.FitInput|None\ncreate_model|grader_contracts.model.ModelInput|torch.nn.Module"} />
        </label>
      </div>
      <div className="contract-builder editor-step" id="assignment-reviewer">
        <p className="eyebrow">Шаг 3 · проверка кода и диалог</p>
        <h3>Настраиваемый Code Reviewer</h3>
        <p className="muted">Reviewer видит очищенный код, создаёт warning/positive evidence и при необходимости задаёт вопросы. Единый Assessment запускается после него всегда, видит только rubric и evidence и не настраивается для лабораторной.</p>
        <label className="switch">
          <input
            type="checkbox"
            checked={Boolean(form.llm_enabled)}
            onChange={(e) =>
              setForm({
                ...form,
                llm_enabled: e.target.checked,
                llm_max_rounds: e.target.checked ? form.llm_max_rounds : 0,
                llm_preset: e.target.checked ? form.llm_preset : "deterministic_only",
              })
            }
          />{" "}
          Использовать Code Reviewer
        </label>
        <div className="grid two">
          <label>
            Режим reviewer
            <select
              value={form.llm_preset}
              onChange={(e) => {
                const preset = e.target.value;
                setForm({
                  ...form,
                  llm_preset: preset,
                  llm_max_rounds: ["deterministic_only", "review_only"].includes(preset) ? 0 : preset === "oral_defense" ? 2 : form.llm_max_rounds || 1,
                });
              }}
            >
              <option value="deterministic_only">Reviewer отключён</option>
              <option value="review_only">Review без вопросов</option>
              <option value="one_clarification">Один уточняющий круг</option>
              <option value="oral_defense">До двух кругов защиты</option>
              <option value="custom">Свои ограничения</option>
            </select>
          </label>
          <label>
            Максимум кругов
            <input type="number" min="0" max="2" value={form.llm_max_rounds} onChange={(e) => setForm({ ...form, llm_max_rounds: Number(e.target.value) })} />
          </label>
          <label>
            Вопросов за круг
            <input
              type="number"
              min="1"
              max="4"
              value={form.llm_questions_per_round}
              onChange={(e) =>
                setForm({
                  ...form,
                  llm_questions_per_round: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Срок ответа, секунд
            <input
              type="number"
              min="60"
              max="604800"
              value={form.llm_answer_deadline}
              onChange={(e) =>
                setForm({
                  ...form,
                  llm_answer_deadline: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Финальное решение
            <select value={form.llm_final_decision} onChange={(e) => setForm({ ...form, llm_final_decision: e.target.value })}>
              <option value="teacher">Всегда преподаватель</option>
              <option value="llm_recommendation">Рекомендация Assessment</option>
            </select>
          </label>
        </div>
        <Notice>Assessment engine — системный этап: исходный код и repository ему не передаются.</Notice>
      </div>
      <div className="editor-step" id="assignment-pipeline">
        <AssignmentPipelineEditor value={form.grading_pipeline} onChange={(grading_pipeline) => setForm({ ...form, grading_pipeline })} />
      </div>
      <label>
        Public rubric
        <textarea rows={6} {...field("rubric")} />
      </label>
      <details className="editor-step" id="assignment-runtime">
        <summary>Расширенные настройки grader</summary>
        <div className="grid two">
          <label>
            Версия готового образа
            <input {...field("environment_version")} />
          </label>
          <label>
            Разрешённые пакеты через запятую
            <input {...field("dependencies")} />
          </label>
          <label>
            CPU threads
            <input type="number" min="1" {...field("cpu_threads")} />
          </label>
          <label>
            RAM, MB
            <input type="number" min="64" {...field("ram_mb")} />
          </label>
          <label>
            Timeout, сек
            <input type="number" min="1" {...field("wall_time_sec")} />
          </label>
          <label>
            Максимум процессов
            <input type="number" min="1" {...field("pids")} />
          </label>
          {form.runtime_profile === "GPU" && (
            <>
              <label>
                Количество GPU
                <input type="number" min="1" {...field("gpu_count")} />
              </label>
              <label>
                VRAM, MB
                <input type="number" min="1" {...field("gpu_vram_mb")} />
              </label>
            </>
          )}
          <label>
            Private grader repository
            <input {...field("grader_repository")} />
          </label>
          <label>
            Grader commit SHA
            <input {...field("grader_commit_sha")} />
          </label>
          <label>
            Путь grader в repository
            <input {...field("grader_path")} />
          </label>
          <label>
            Private grader hook
            <input {...field("grader_entrypoint")} placeholder="grade.py" />
          </label>
        </div>
        <label>
          Private grader config
          <textarea rows={6} className="code-input" {...field("private_grader_config")} />
        </label>
        <label>
          Private review focus
          <textarea rows={5} {...field("review_focus")} />
        </label>
      </details>
      <div className="actions">
        <button onClick={() => void save()}>Сохранить draft</button>
        <button className="secondary" onClick={() => void publish()}>
          Опубликовать
        </button>
      </div>
    </section>
  );
}

function AssignmentRubricEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  let rubric: any = { version: "v1", criteria: [] };
  try { rubric = JSON.parse(value); } catch { /* Advanced JSON below remains recoverable. */ }
  const criteria = Array.isArray(rubric.criteria) ? rubric.criteria : [];
  const evidenceTypes = ["code", "report", "deterministic_test", "runtime_metric", "contract_check", "student_answer", "grader_observation"];
  const write = (next: any[]) => onChange(JSON.stringify({ ...rubric, version: rubric.version || "v1", criteria: next }, null, 2));
  const update = (index: number, patch: any) => write(criteria.map((item: any, i: number) => i === index ? { ...item, ...patch } : item));
  const maximum = criteria.reduce((sum: number, item: any) => sum + Number(item.max_score || 0), 0);
  return (
    <div className="rubric-builder">
      <div className="section-heading"><div><p className="eyebrow">Оценивание</p><h3>Критерии</h3></div><strong className={maximum === 100 ? "rubric-total is-valid" : "rubric-total"}>{maximum} / 100</strong></div>
      <p className="muted">Итоговая работа всегда оценивается из 100. Опишите критерии понятным студенту языком.</p>
      {criteria.map((criterion: any, index: number) => (
        <article className="rubric-criterion" key={`${criterion.id}:${index}`}>
          <div className="grid two">
            <label>Короткий ID<input value={criterion.id ?? ""} onChange={(e) => update(index, { id: e.target.value })} placeholder="correctness" /></label>
            <label>Название<input value={criterion.title ?? ""} onChange={(e) => update(index, { title: e.target.value })} placeholder="Корректность решения" /></label>
          </div>
          <label>Что оценивается<textarea rows={2} value={criterion.description ?? ""} onChange={(e) => update(index, { description: e.target.value })} /></label>
          <div className="grid three">
            <label>Минимум<input type="number" value={criterion.min_score ?? 0} onChange={(e) => update(index, { min_score: Number(e.target.value) })} /></label>
            <label>Максимум<input type="number" min="1" value={criterion.max_score ?? 10} onChange={(e) => update(index, { max_score: Number(e.target.value) })} /></label>
            <label>Шаг<input type="number" min="0.5" step="0.5" value={criterion.score_step ?? 1} onChange={(e) => update(index, { score_step: Number(e.target.value) })} /></label>
          </div>
          <fieldset><legend>Какие evidence подходят</legend><div className="checks">{evidenceTypes.map((type) => <label key={type}><input type="checkbox" checked={(criterion.required_evidence_types ?? []).includes(type)} onChange={(e) => update(index, { required_evidence_types: e.target.checked ? [...new Set([...(criterion.required_evidence_types ?? []), type])] : (criterion.required_evidence_types ?? []).filter((x: string) => x !== type) })} />{evidenceCategoryLabels[type] ?? type}</label>)}</div></fieldset>
          <div className="checks"><label><input type="checkbox" checked={criterion.clarification_allowed ?? true} onChange={(e) => update(index, { clarification_allowed: e.target.checked })} />Можно уточняющий вопрос</label><label><input type="checkbox" checked={criterion.student_visible ?? true} onChange={(e) => update(index, { student_visible: e.target.checked })} />Показывать студенту</label></div>
          <button type="button" className="link danger-text" onClick={() => write(criteria.filter((_: any, i: number) => i !== index))}>Удалить критерий</button>
        </article>
      ))}
      <button type="button" className="secondary" onClick={() => write([...criteria, { id: `criterion_${criteria.length + 1}`, title: "Новый критерий", description: "", min_score: 0, max_score: 10, score_step: 1, required_evidence_types: ["deterministic_test"], clarification_allowed: true, student_visible: true }])}>Добавить критерий</button>
      <details><summary>Расширенный JSON</summary><textarea rows={10} className="code-input" value={value} onChange={(e) => onChange(e.target.value)} /></details>
    </div>
  );
}

function AssignmentPipelineEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  let pipeline: any = { version: "v1", stages: [] };
  try {
    pipeline = JSON.parse(value);
  } catch {
    /* Advanced editor exposes malformed JSON. */
  }
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
  const write = (next: any[]) => onChange(JSON.stringify({ ...pipeline, version: pipeline.version || "v1", stages: next }, null, 2));
  const presets: Record<string, any[]> = {
    deterministic: [
      { id: "contracts", kind: "contracts", failure_policy: "critical" },
      { id: "tests", kind: "tests", failure_policy: "critical" },
    ],
    reviewed: [
      { id: "contracts", kind: "contracts", failure_policy: "critical" },
      { id: "static", kind: "static", failure_policy: "warning" },
      { id: "tests", kind: "tests", failure_policy: "critical" },
      { id: "llm", kind: "llm", failure_policy: "warning" },
    ],
    full: [
      { id: "contracts", kind: "contracts", failure_policy: "critical" },
      { id: "static", kind: "static", failure_policy: "warning" },
      { id: "tests", kind: "tests", failure_policy: "critical" },
      { id: "llm", kind: "llm", failure_policy: "warning" },
      { id: "teacher", kind: "teacher", failure_policy: "warning" },
    ],
  };
  function move(index: number, delta: number) {
    const next = [...stages],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    write(next);
  }
  return (
    <div className="contract-builder">
      <p className="eyebrow">Pipeline</p>
      <h3>Этапы проверки</h3>
      <p className="muted">Этапы выполняются сверху вниз. Critical останавливает проверку, warning передаёт сигнал следующим этапам.</p>
      <div className="actions compact">
        <button type="button" className="secondary" onClick={() => write(presets.deterministic)}>
          Deterministic
        </button>
        <button type="button" className="secondary" onClick={() => write(presets.reviewed)}>
          С LLM review
        </button>
        <button type="button" className="secondary" onClick={() => write(presets.full)}>
          Полная проверка
        </button>
      </div>
      <div className="pipeline-stages">
        {stages.map((stage: any, index: number) => (
          <div className="pipeline-stage" key={`${stage.id}:${index}`}>
            <span className="pipeline-index">{index + 1}</span>
            <label>
              ID
              <input value={stage.id || ""} onChange={(e) => write(stages.map((x: any, i: number) => (i === index ? { ...x, id: e.target.value } : x)))} />
            </label>
            <label>
              Тип
              <select value={stage.kind || "custom"} onChange={(e) => write(stages.map((x: any, i: number) => (i === index ? { ...x, kind: e.target.value } : x)))}>
                {["contracts", "static", "tests", "llm", "teacher", "custom"].map((kind) => (
                  <option value={kind} key={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Результат ошибки
              <select value={stage.failure_policy || "critical"} onChange={(e) => write(stages.map((x: any, i: number) => (i === index ? { ...x, failure_policy: e.target.value } : x)))}>
                <option value="critical">critical</option>
                <option value="warning">warning</option>
              </select>
            </label>
            <div className="stage-actions">
              <button type="button" className="link" disabled={!index} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className="link" disabled={index === stages.length - 1} onClick={() => move(index, 1)}>
                ↓
              </button>
              <button type="button" className="link danger-text" onClick={() => write(stages.filter((_: any, i: number) => i !== index))}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          write([
            ...stages,
            {
              id: `stage-${stages.length + 1}`,
              kind: "custom",
              failure_policy: "critical",
            },
          ])
        }
      >
        Добавить этап
      </button>
      <details>
        <summary>Расширенный JSON</summary>
        <textarea rows={10} className="code-input" value={value} onChange={(e) => onChange(e.target.value)} />
      </details>
    </div>
  );
}

const lab1AchievementPreset = [
  ["first-try", "Не в этот раз, тестировщик!", "0 failed. Тестировщик требует реванш. Выдаётся, если первый сабмит лабораторной прошёл все обязательные тесты.", "🛡️", "grader", { event: "first_submission_passed", reason_code: "first_submission_all_tests_passed" }],
  ["unexpected-set", "Никто не ожидает set!", "Главное оружие — неожиданность. И хэш-таблица. Выдаётся за проверку уникальности символов через set или frozenset без вложенного перебора.", "♠", "grader", { kind: "ast", function: "has_unique_characters" }],
  ["work-smarter", "Work smarter, not harder", "Дальше корня ходят только самые упорные. Выдаётся, если факторизация не проверяет делители дальше квадратного корня из остатка.", "√", "grader", { kind: "ast", function: "prime_factorization" }],
  ["understand-recursion", "Чтобы понять рекурсию…", "…сначала получите это достижение ещё раз. Выдаётся за корректное рекурсивное решение мультипликативной устойчивости.", "↻", "grader", { kind: "ast", function: "multiplicative_persistence" }],
  ["perfect-balance", "Идеальный баланс", "Всё как и должно быть! Выдаётся за общий алгоритм сбалансированного числа без хардкода отдельных длин.", "⚖", "grader", { kind: "ast", function: "is_balanced_number" }],
  ["einstein", "Эйнштейн вошёл в чат", "Сумму писать не будем. Выдаётся за использование np.einsum в задаче sum_prod при успешно пройденных тестах.", "Σ", "grader", { kind: "ast", function: "sum_prod", call: "np.einsum" }],
  ["convolution-brrr", "Convolution goes brrr", "Скользкое решение. Выдаётся за вычисление скользящего среднего через np.convolve при успешно пройденных тестах.", "〰", "grader", { kind: "ast", function: "analyze_time_series", call: "np.convolve" }],
  ["avx-user", "AVX user", "Циклов не видно. Значит, оптимизировано. Выдаётся за решения всех векторизуемых NumPy-задач без циклов и comprehensions.", "⚡", "grader", { kind: "ast", rule: "all_numpy_tasks_vectorized" }],
  ["works-dont-touch", "Работает — не трогай", "Такое ещё и в проде бывает. Номинируется за комментарий о временном решении или костыле, если все тесты при этом проходят.", "🩹", "llm", { kind: "semantic_comment", meaning: "temporary_workaround_with_all_tests_passed" }],
  ["developer-was-here", "Здесь был разработчик", "Через полгода вы скажете себе спасибо. Номинируется за полезный комментарий, объясняющий причину нетривиального решения или обработку краевого случая.", "✍", "llm", { kind: "semantic_comment", meaning: "explains_nontrivial_reason_or_edge_case" }],
].map(([slug, title, description, emoji, source, trigger]) => ({
  id: `assignment/lab-1/${slug}`, title, description, emoji, image_key: null,
  theme: source === "llm" ? "warning" : "success", accent_color: source === "llm" ? "#F59E0B" : "#22C55E",
  visibility: "public", repeatability: "once_per_course_run", award_policy: "automatic", allowed_sources: [source], trigger,
}));
export function AssignmentAchievementDefinitionsEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  let items: any[] = [];
  try {
    items = JSON.parse(value);
  } catch {
    /* Save will report malformed JSON. */
  }
  const empty = {
    id: "assignment/lab-1/",
    title: "",
    description: "",
    emoji: "✦",
    image_key: null,
    theme: "success",
    accent_color: "#22C55E",
    visibility: "public",
    repeatability: "once_per_course_run",
    award_policy: "automatic",
    allowed_sources: ["pipeline"],
    trigger: {},
  };
  const [draft, setDraft] = useState<any>(empty),
    [trigger, setTrigger] = useState("{}"),
    [editingIndex, setEditingIndex] = useState<number | null>(null),
    [error, setError] = useState(""),
    [drySource, setDrySource] = useState("platform"),
    [dryEvent, setDryEvent] = useState("submission.finalized");
  const dryMatches = items.filter((item) => item.allowed_sources?.includes(drySource) && (!item.trigger?.source || item.trigger.source === drySource) && (!item.trigger?.event || item.trigger.event === dryEvent) && (!item.trigger?.event_kind || item.trigger.event_kind === dryEvent));
  function toggleSource(source: string, enabled: boolean) {
    setDraft({
      ...draft,
      allowed_sources: enabled ? [...new Set([...draft.allowed_sources, source])] : draft.allowed_sources.filter((item: string) => item !== source),
    });
  }
  function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const next = { ...draft, trigger: JSON.parse(trigger) };
      onChange(JSON.stringify(editingIndex == null ? [...items, next] : items.map((item, index) => index === editingIndex ? next : item), null, 2));
      setDraft(empty);
      setTrigger("{}");
      setEditingIndex(null);
    } catch {
      setError("Trigger должен быть корректным JSON");
    }
  }
  async function upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    const media = await api("/api/admin/media", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    setDraft({ ...draft, image_key: media.key });
  }
  return (
    <div className="contract-builder">
      <p className="eyebrow">Достижения лабораторной</p>
      <h3>Редактор достижений</h3>
      <p className="muted">Создайте название, описание и правило выдачи. Изображение можно загрузить сейчас или добавить позже через кнопку «Изменить».</p>
      <button type="button" className="secondary" onClick={() => {
        const known = new Set(items.map((item) => item.id));
        onChange(JSON.stringify([...items, ...lab1AchievementPreset.filter((item) => !known.has(item.id))], null, 2));
      }}>Добавить набор достижений Lab 1</button>
      {items.map((item, index) => (
        <div className="editor-row" key={item.id}>
          <span>
            <strong>
              {item.emoji} {item.title}
            </strong>
            <small>
              {item.id} · {item.allowed_sources.join(", ")} · {item.allowed_sources.includes("llm") ? "LLM: подтверждает преподаватель" : "автоматическая выдача"}
            </small>
          </span>
          <span className="actions compact"><button type="button" className="secondary" onClick={() => { setDraft({ ...empty, ...item }); setTrigger(JSON.stringify(item.trigger ?? {}, null, 2)); setEditingIndex(index); }}>
            Изменить
          </button><button
            type="button"
            className="link danger-text"
            onClick={() =>
              onChange(
                JSON.stringify(
                  items.filter((_, i) => i !== index),
                  null,
                  2,
                ),
              )
            }
          >
            Удалить
          </button></span>
        </div>
      ))}
      <form className="subform" onSubmit={add}>
        <ErrorBox error={error} />
        <div className="grid two">
          <label>
            Системный ID
            <input required pattern="(?:common|course/[a-z0-9-]+|run/[a-z0-9-]+|assignment/[a-z0-9-]+|custom/[a-z0-9-]+)/[a-z0-9-]+" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
          </label>
          <label>
            Название
            <input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
        </div>
        <label>
          Описание
          <textarea required value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <div className="grid two">
          <label>
            Emoji
            <input value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
          </label>
          <label>
            Акцент
            <input type="color" value={draft.accent_color} onChange={(e) => setDraft({ ...draft, accent_color: e.target.value })} />
          </label>
          <label>
            Видимость
            <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}>
              <option value="public">Публичная</option>
              <option value="hidden_until_awarded">Скрыта до получения</option>
              <option value="teacher_only">Только преподавателю</option>
            </select>
          </label>
          <label>
            Повторяемость
            <select value={draft.repeatability} onChange={(e) => setDraft({ ...draft, repeatability: e.target.value })}>
              <option value="once_global">Один раз вообще</option>
              <option value="once_per_course_run">Один раз за поток</option>
              <option value="once_per_assignment">Один раз за лабораторную</option>
              <option value="repeatable">Повторяемая</option>
            </select>
          </label>
          <div className="field-note">
            <strong>Порядок выдачи</strong>
            <span>LLM-номинации подтверждает преподаватель; объективные триггеры выдаются автоматически.</span>
          </div>
          <label>
            Изображение
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        </div>
        <fieldset>
          <legend>Кто может номинировать</legend>
          {["grader", "runtime", "llm", "pipeline", "teacher", "platform"].map((source) => (
            <label className="option" key={source}>
              <input type="checkbox" checked={draft.allowed_sources.includes(source)} onChange={(e) => toggleSource(source, e.target.checked)} />
              {source}
            </label>
          ))}
        </fieldset>
        <label>
          Условие выдачи (JSON)
          <textarea rows={4} className="code-input" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder={'Для завершения лабораторной:\n{"source":"platform","event":"submission.finalized"}'} />
        </label>
        <AchievementDraftPreview value={draft} trigger={draft.id} />
        <div className="actions"><button disabled={!draft.allowed_sources.length}>{editingIndex == null ? "Добавить достижение" : "Сохранить достижение"}</button>{editingIndex != null && <button type="button" className="secondary" onClick={() => { setDraft(empty); setTrigger("{}"); setEditingIndex(null); }}>Отменить</button>}</div>
      </form>
      <div className="achievement-dry-run">
        <p className="eyebrow">Предпросмотр правила</p>
        <h4>Какие достижения подходят событию</h4>
        <div className="grid two">
          <label>
            Источник
            <select value={drySource} onChange={(e) => setDrySource(e.target.value)}>
              {["platform", "grader", "runtime", "llm", "pipeline", "teacher"].map((source) => (
                <option value={source} key={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label>
            Событие
            <input value={dryEvent} onChange={(e) => setDryEvent(e.target.value)} />
          </label>
        </div>
        {dryMatches.length ? (
          <div className="dry-run-results">
            {dryMatches.map((item) => (
              <span key={item.id}>
                {item.emoji || "✦"} {item.title} <small>{item.id}</small>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">Ни одно достижение не совпало. Это только симуляция конфигурации — награда не выдаётся.</p>
        )}
      </div>
      <details>
        <summary>JSON для точной настройки и code review</summary>
        <textarea rows={14} className="code-input" value={value} onChange={(e) => onChange(e.target.value)} />
      </details>
    </div>
  );
}

function AssignmentPublicationEditor({ versionId }: { versionId: string }) {
  const [runs, setRuns] = useState<any[]>([]),
    [groups, setGroups] = useState<any[]>([]),
    [items, setItems] = useState<any[]>([]),
    [course, setCourse] = useState(""),
    [all, setAll] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [cooldown, setCooldown] = useState(0),
    [opens, setOpens] = useState(""),
    [due, setDue] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function load() {
    const [r, g, p] = await Promise.all([api("/api/admin/course-runs"), api("/api/admin/groups"), api(`/api/admin/assignment-versions/${versionId}/publications`)]);
    setRuns(r.items);
    setGroups(g.items);
    setItems(p.items);
  }
  useEffect(() => {
    void load();
  }, [versionId]);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(
        `/api/admin/assignment-versions/${versionId}/publications`,
        json("PUT", {
          course_run_id: course,
          target_all_course_run: all,
          group_ids: all ? [] : selected,
          opens_at: opens ? Math.floor(new Date(opens).getTime() / 1000) : null,
          due_at: due ? Math.floor(new Date(due).getTime() / 1000) : null,
          submission_cooldown_seconds: cooldown,
        }),
      );
      setNotice("Лабораторная выдана");
      await load();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <section className="card">
      <p className="eyebrow">Публикация</p>
      <h2>Аудитория и сдача</h2>
      {items.map((p) => (
        <div className="access-item" key={p.id}>
          <strong>{p.course_run_name}</strong>
          <span>
            {p.target_all_course_run ? "Все участники" : p.groups.map((g: any) => g.name).join(", ")} · cooldown {Math.round(p.submission_cooldown_seconds / 3600)} ч.
          </span>
        </div>
      ))}
      <form onSubmit={save}>
        <label>
          Запуск курса
          <select
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setSelected([]);
            }}
            required
          >
            <option value="">Выберите</option>
            {runs.map((r) => (
              <option value={r.id} key={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="option">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Все участники запуска курса
        </label>
        {!all &&
          groups
            .filter((g) => g.course_run_id === course)
            .map((g) => (
              <label className="option" key={g.id}>
                <input type="checkbox" checked={selected.includes(g.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, g.id] : selected.filter((x) => x !== g.id))} />
                {g.name}
              </label>
            ))}
        <div className="grid two">
          <label>
            Открыть с
            <input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
          </label>
          <label>
            Сдать до
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label>
            Cooldown, секунд
            <input type="number" min="0" max="2592000" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} />
          </label>
        </div>
        <button>Выдать лабораторную</button>
        <div className="toast-stack" aria-live="polite"><Toast message={notice} onClose={() => setNotice("")} /><Toast message={error} kind="error" onClose={() => setError("")} timeout={9000} /></div>
      </form>
    </section>
  );
}

function QuizAdmin() {
  const { id = "" } = useParams();
  const [q, setQ] = useState<any>(null);
  const [v, setV] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [e, setE] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const load = async () => {
    const quiz = await api(`/api/admin/quizzes/${id}`);
    setQ(quiz);
    const draft = quiz.versions.find((x: any) => x.status === "DRAFT");
    setV(draft ? await api(`/api/admin/quiz-versions/${draft.id}`) : null);
  };
  useEffect(() => {
    load().catch((x) => setE(x.message));
  }, [id]);
  if (!q)
    return (
      <AdminGuard>
        <Layout admin>
          Загрузка…
          <ErrorBox error={e} />
        </Layout>
      </AdminGuard>
    );
  async function makeDraft() {
    setV(await api(`/api/admin/quizzes/${id}/draft`, { method: "POST" }));
    await load();
  }
  async function publish() {
    try {
      await api(`/api/admin/quiz-versions/${v.id}/publish`, {
        method: "POST",
        headers: { "If-Match": String(v.revision) },
      });
      await load();
    } catch (x) {
      setE((x as Error).message);
    }
  }
  async function duplicate() {
    const x = await api(`/api/admin/quizzes/${id}/duplicate`, {
      method: "POST",
    });
    location.href = `/admin/quizzes/${x.id}`;
  }
  async function unpublish() {
    if (!confirm("Закрыть тест для студентов? Редактировать тест для этого не требуется — используйте «Редактировать новую версию».")) return;
    await api(`/api/admin/quizzes/${id}/unpublish`, { method: "POST" });
    await load();
  }
  async function showPreview() {
    setPreview(await api(`/api/admin/quiz-versions/${v.id}/preview`, { method: "POST" }));
  }
  const publicUrl = `${location.origin}/q/${q.slug}`;
  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    setShareStatus("Ссылка скопирована");
    window.setTimeout(() => setShareStatus(""), 2500);
  }
  return (
    <AdminGuard>
      <Layout admin>
        <div className="page-head">
          <div>
            <p className="eyebrow">/q/{q.slug}</p>
            <h1>{q.title}</h1>
          </div>
          <div className="actions">
            <Link className="button secondary" to={`/admin/quizzes/${id}/analytics`}>
              Аналитика
            </Link>
            <button className="secondary" onClick={duplicate}>
              Дублировать
            </button>
            {q.published_version_id && !v && <button onClick={makeDraft}>Редактировать новую версию</button>}
            {!q.published_version_id && !v && <button onClick={makeDraft}>Вернуть в редактор</button>}
            {q.published_version_id && (
              <button className="link danger-text" onClick={unpublish}>
                Закрыть доступ студентам
              </button>
            )}
          </div>
        </div>
        {q.published_version_id && (
          <section className="share-card" aria-label="Ссылка на тест">
            <div>
              <span className="eyebrow">Ссылка для студентов</span>
              <a href={publicUrl} target="_blank" rel="noreferrer">
                {publicUrl}
              </a>
            </div>
            <div className="actions compact">
              <button className="secondary" onClick={copyLink}>
                Скопировать ссылку
              </button>
              {typeof navigator.share === "function" && (
                <button className="secondary" onClick={() => void navigator.share({ title: q.title, url: publicUrl }).catch(() => undefined)}>
                  Поделиться
                </button>
              )}
            </div>
            <div className="toast-stack" aria-live="polite"><Toast message={shareStatus} onClose={() => setShareStatus("")} /></div>
          </section>
        )}
        <ErrorBox error={e} />
        {v ? (
          <>
            <VersionSettings version={v} setVersion={setV} />
            <QuizMetadata quiz={q} reload={load} />
            <Availability quiz={q} reload={load} />
            <QuestionEditor version={v} setVersion={setV} />
            <AchievementEditor version={v} setVersion={setV} />
            <SpecialAchievementEditor kind="double-failure" version={v} setVersion={setV} />
            <SpecialAchievementEditor kind="retry-success" version={v} setVersion={setV} />
            <div className="actions">
              <button className="secondary" onClick={showPreview}>
                Предпросмотр
              </button>
              <button className="large" onClick={publish}>
                Опубликовать v{v.version_number}
              </button>
            </div>
            {preview && <DraftPreview data={preview} close={() => setPreview(null)} />}
          </>
        ) : (
          <Notice>Нет редактируемого черновика. Создайте новую версию: текущая опубликованная версия останется доступна студентам до новой публикации.</Notice>
        )}
        {q.published_version_id && <QuizPublications quiz={q} />}
      </Layout>
    </AdminGuard>
  );
}
function QuizMetadata({ quiz, reload }: { quiz: any; reload: () => void }) {
  const [title, setTitle] = useState(quiz.title);
  const [description, setDescription] = useState(quiz.description);
  const [slug, setSlug] = useState(quiz.slug);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError("");
    try {
      await api(`/api/admin/quizzes/${quiz.id}`, json("PATCH", { title, description, slug }));
      await reload();
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>Карточка теста</h2>
      <ErrorBox error={error} />
      <div className="toast-stack" aria-live="polite"><Toast message={saved ? "Карточка сохранена" : ""} onClose={() => setSaved(false)} /></div>
      <div className="grid two">
        <label>
          Название
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Slug
          <input pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
      </div>
      <label>
        Описание
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button>Сохранить карточку</button>
    </form>
  );
}
function DraftPreview({ data, close }: { data: any; close: () => void }) {
  return (
    <section className="card">
      <div className="page-head">
        <div>
          <p className="eyebrow">Предпросмотр draft v{data.version_number}</p>
          <h2>{data.title}</h2>
        </div>
        <button className="secondary" onClick={close}>
          Закрыть
        </button>
      </div>
      <p>{data.description}</p>
      {data.questions.map((q: any, i: number) => (
        <article className="question" key={q.id}>
          <p className="eyebrow">
            Вопрос {i + 1} · {q.points} б.
          </p>
          <h3>{q.text}</h3>
          {q.options?.map((o: any) => (
            <div className="option" key={o.id}>
              {o.text}
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}
function Availability({ quiz, reload }: { quiz: any; reload: () => void }) {
  const [opens, setOpens] = useState(localInput(quiz.opens_at));
  const [deadline, setDeadline] = useState(localInput(quiz.start_deadline_at));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError("");
    try {
      await api(
        `/api/admin/quizzes/${quiz.id}/availability`,
        json(
          "PATCH",
          {
            opens_at: opens ? Math.floor(new Date(opens).getTime() / 1000) : null,
            start_deadline_at: deadline ? Math.floor(new Date(deadline).getTime() / 1000) : null,
          },
          { "If-Match": String(quiz.availability_revision) },
        ),
      );
      await reload();
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <form className="card inline-form" onSubmit={save}>
      <h2>Доступность</h2>
      <ErrorBox error={error} />
      <div className="toast-stack" aria-live="polite"><Toast message={saved ? "Окно доступности сохранено" : ""} onClose={() => setSaved(false)} /></div>
      <label>
        Открыть с
        <input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
      </label>
      <label>
        Начать до
        <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <button>Сохранить окно</button>
    </form>
  );
}
function QuizPublications({ quiz }: { quiz: any }) {
  const [runs, setRuns] = useState<any[]>([]),
    [groups, setGroups] = useState<any[]>([]),
    [items, setItems] = useState<any[]>([]);
  const [courseRunId, setCourseRunId] = useState(""),
    [all, setAll] = useState(true),
    [selected, setSelected] = useState<string[]>([]);
  const [opens, setOpens] = useState(localInput(quiz.opens_at)),
    [deadline, setDeadline] = useState(localInput(quiz.start_deadline_at));
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function load() {
    const [r, g, p] = await Promise.all([api("/api/admin/course-runs"), api("/api/admin/groups"), api(`/api/admin/quizzes/${quiz.id}/publications`)]);
    setRuns(r.items);
    setGroups(g.items);
    setItems(p.items);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [quiz.id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      await api(
        `/api/admin/quizzes/${quiz.id}/publications`,
        json("PUT", {
          course_run_id: courseRunId,
          target_all_course_run: all,
          group_ids: all ? [] : selected,
          opens_at: opens ? Math.floor(new Date(opens).getTime() / 1000) : null,
          start_deadline_at: deadline ? Math.floor(new Date(deadline).getTime() / 1000) : null,
        }),
      );
      setNotice("Доступ к тесту сохранён");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const courseGroups = groups.filter((g) => g.course_run_id === courseRunId);
  return (
    <section className="card">
      <p className="eyebrow">Доступ по группам</p>
      <h2>Кому выдан тест</h2>
      {items.map((p) => (
        <div className="access-item" key={p.id}>
          <strong>{p.course_run_name}</strong>
          <span>
            {p.target_all_course_run ? "Все участники запуска курса" : p.groups.map((g: any) => g.name).join(", ")} · {p.is_active ? "активно" : "закрыто"}
          </span>
        </div>
      ))}
      <form onSubmit={save}>
        <label>
          Запуск курса
          <select
            value={courseRunId}
            onChange={(e) => {
              setCourseRunId(e.target.value);
              setSelected([]);
            }}
            required
          >
            <option value="">Выберите</option>
            {runs.map((r) => (
              <option value={r.id} key={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="option">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Все участники запуска курса
        </label>
        {!all && (
          <div className="checklist">
            {courseGroups.map((g) => (
              <label className="option" key={g.id}>
                <input type="checkbox" checked={selected.includes(g.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, g.id] : selected.filter((id) => id !== g.id))} />
                {g.name}
              </label>
            ))}
          </div>
        )}
        <div className="grid two">
          <label>
            Открыть с
            <input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
          </label>
          <label>
            Начать до
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
        <button>Сохранить аудиторию</button>
        <div className="toast-stack" aria-live="polite"><Toast message={notice} onClose={() => setNotice("")} /><Toast message={error} kind="error" onClose={() => setError("")} timeout={9000} /></div>
      </form>
    </section>
  );
}
function VersionSettings({ version, setVersion }: { version: any; setVersion: (v: any) => void }) {
  const [f, setF] = useState(version);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(version), [version]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    const body = {
      title: f.title,
      description: f.description,
      time_per_question_seconds: +f.time_per_question_seconds,
      shuffle_questions: !!f.shuffle_questions,
      shuffle_options: !!f.shuffle_options,
      failure_barrier_enabled: !!f.failure_barrier_enabled,
      success_barrier_correct_answers: Number(f.success_barrier_correct_answers),
      show_answer_review_after_submit: !!f.show_answer_review_after_submit,
    };
    try {
      const updated = await api(`/api/admin/quiz-versions/${version.id}`, json("PATCH", body, { "If-Match": String(version.revision) }));
      setVersion(updated);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <form className="card" onSubmit={save}>
      <p className="eyebrow">Сначала настройте правила прохождения</p>
      <h2>Базовые настройки теста</h2>
      <ErrorBox error={error} />
      <div className="toast-stack" aria-live="polite"><Toast message={saved ? "Настройки сохранены" : ""} onClose={() => setSaved(false)} /></div>
      <div className="grid two">
        <label>
          Название
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label>
          Секунд на вопрос
          <input type="number" value={f.time_per_question_seconds} onChange={(e) => setF({ ...f, time_per_question_seconds: e.target.value })} />
        </label>
      </div>
      <label>
        Описание
        <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <div className="checks">
        <label>
          <input type="checkbox" checked={!!f.shuffle_questions} onChange={(e) => setF({ ...f, shuffle_questions: e.target.checked })} /> Перемешивать вопросы
        </label>
        <label>
          <input type="checkbox" checked={!!f.shuffle_options} onChange={(e) => setF({ ...f, shuffle_options: e.target.checked })} /> Перемешивать варианты
        </label>
        <label>
          <input type="checkbox" checked={!!f.show_answer_review_after_submit} onChange={(e) => setF({ ...f, show_answer_review_after_submit: e.target.checked })} /> Показывать разбор
        </label>
        <label>
          <input type="checkbox" checked={!!f.failure_barrier_enabled} onChange={(e) => setF({ ...f, failure_barrier_enabled: e.target.checked })} /> Разрешить retry, если барьер успеха не пройден
        </label>
      </div>
      {f.failure_barrier_enabled && (
        <label>
          Для успеха нужно правильных ответов, не менее
          <input
            type="number"
            min="1"
            max={Math.max(1, version.questions.length - 1)}
            step="1"
            value={f.success_barrier_correct_answers}
            onChange={(e) =>
              setF({
                ...f,
                success_barrier_correct_answers: e.target.value,
              })
            }
          />
          <small>Допустимый максимум: {Math.max(0, version.questions.length - 1)}. Максимальный результат не требуется.</small>
        </label>
      )}
      <button>Сохранить настройки</button>
    </form>
  );
}

const emptyQuestion: any = {
  type: "SINGLE",
  text: "",
  points: 1,
  options: [
    { text: "", is_correct: true },
    { text: "", is_correct: false },
  ],
  answers: [""],
  numeric_kind: "FLOAT",
  correct_value: "",
  absolute_tolerance: 0.01,
};
function QuestionEditor({ version, setVersion }: { version: any; setVersion: (v: any) => void }) {
  const [form, setForm] = useState<any>(emptyQuestion);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const body = questionEditorPayload(form);
      const path = editing ? `/api/admin/questions/${editing}` : `/api/admin/quiz-versions/${version.id}/questions`;
      setVersion(
        await api(
          path,
          json(editing ? "PUT" : "POST", body, {
            "If-Match": String(version.revision),
          }),
        ),
      );
      setEditing(null);
      setForm(emptyQuestion);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  function edit(q: any) {
    setEditing(q.id);
    setError("");
    setForm(questionEditorForm(q));
  }
  async function remove(id: string) {
    setVersion(
      await api(`/api/admin/questions/${id}`, {
        method: "DELETE",
        headers: { "If-Match": String(version.revision) },
      }),
    );
  }
  async function move(index: number, delta: number) {
    const ids = version.questions.map((q: any) => q.id);
    const other = index + delta;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    setVersion(await api(`/api/admin/quiz-versions/${version.id}/question-order`, json("PUT", { ids }, { "If-Match": String(version.revision) })));
  }
  return (
    <section className="card">
      <h2>Вопросы</h2>
      {version.questions.map((q: any, i: number) => (
        <div className="editor-row" key={q.id}>
          <span>
            {i + 1}. {q.text}{" "}
            <small>
              {q.type}, {q.points} б.
            </small>
          </span>
          <div>
            <button className="link" disabled={i === 0} aria-label="Переместить вопрос вверх" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="link" disabled={i === version.questions.length - 1} aria-label="Переместить вопрос вниз" onClick={() => move(i, 1)}>
              ↓
            </button>
            <button className="link" onClick={() => edit(q)}>
              Изменить
            </button>
            <button className="link danger-text" onClick={() => remove(q.id)}>
              Удалить
            </button>
          </div>
        </div>
      ))}
      <form onSubmit={save} className="subform">
        <h3>{editing ? "Изменить вопрос" : "Добавить вопрос"}</h3>
        <ErrorBox error={error} />
        <label>
          Тип
          <select value={form.type} onChange={(e) => setForm({ ...emptyQuestion, type: e.target.value })}>
            <option value="SINGLE">Один вариант</option>
            <option value="MULTIPLE">Несколько вариантов</option>
            <option value="NUMERIC">Число</option>
            <option value="SHORT_TEXT">Короткий текст</option>
          </select>
        </label>
        <label>
          Текст
          <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        </label>
        <label>
          Баллы
          <input type="number" min="1" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
        </label>
        {(form.type === "SINGLE" || form.type === "MULTIPLE") && (
          <>
            {form.options.map((o: any, i: number) => (
              <div className="option-edit" key={i}>
                <input
                  value={o.text}
                  placeholder={`Вариант ${i + 1}`}
                  onChange={(e) => {
                    const x = [...form.options];
                    x[i] = { ...o, text: e.target.value };
                    setForm({ ...form, options: x });
                  }}
                />
                <label>
                  <input
                    type={form.type === "SINGLE" ? "radio" : "checkbox"}
                    name="correct"
                    checked={o.is_correct}
                    onChange={(e) => {
                      const x = form.options.map((p: any, j: number) => ({
                        ...p,
                        is_correct: form.type === "SINGLE" ? j === i : j === i ? e.target.checked : p.is_correct,
                      }));
                      setForm({ ...form, options: x });
                    }}
                  />{" "}
                  верный
                </label>
                <button
                  type="button"
                  className="link danger-text"
                  disabled={form.options.length <= 2}
                  onClick={() =>
                    setForm({
                      ...form,
                      options: form.options.filter((_: any, j: number) => j !== i),
                    })
                  }
                >
                  Удалить
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setForm({
                  ...form,
                  options: [...form.options, { text: "", is_correct: false }],
                })
              }
            >
              + вариант
            </button>
          </>
        )}
        {form.type === "NUMERIC" && (
          <div className="grid two">
            <label>
              Формат ответа
              <select
                value={form.numeric_kind ?? "FLOAT"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    numeric_kind: e.target.value,
                    absolute_tolerance: e.target.value === "INTEGER" ? 0 : (form.absolute_tolerance ?? 0.01),
                  })
                }
              >
                <option value="INTEGER">Целое число</option>
                <option value="FLOAT">Дробное число</option>
              </select>
            </label>
            <label>
              Правильное значение
              <input type="number" step={form.numeric_kind === "INTEGER" ? "1" : "any"} required value={form.correct_value ?? ""} onChange={(e) => setForm({ ...form, correct_value: e.target.value })} />
            </label>
            {form.numeric_kind !== "INTEGER" && (
              <label>
                Допуск ±
                <input type="number" min="0" step="any" required value={form.absolute_tolerance ?? 0} onChange={(e) => setForm({ ...form, absolute_tolerance: e.target.value })} />
              </label>
            )}
            {form.numeric_kind === "INTEGER" && <p className="muted numeric-note">Для целого ответа допуск всегда равен 0.</p>}
          </div>
        )}
        {form.type === "SHORT_TEXT" && (
          <label>
            Допустимые ответы, по одному на строку
            <textarea
              value={(form.answers ?? []).join("\n")}
              onChange={(e) =>
                setForm({
                  ...form,
                  answers: e.target.value.split("\n").filter(Boolean),
                })
              }
            />
          </label>
        )}
        <button>{editing ? "Сохранить вопрос" : "Добавить вопрос"}</button>
      </form>
    </section>
  );
}

function AchievementEditor({ version, setVersion }: { version: any; setVersion: (v: any) => void }) {
  const [form, setForm] = useState<any>({
    min_correct_answers: 0,
    title: "",
    description: "",
    theme: "default",
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const path = editing ? `/api/admin/achievements/${editing}` : `/api/admin/quiz-versions/${version.id}/achievements`;
    try {
      setVersion(
        await api(
          path,
          json(
            editing ? "PUT" : "POST",
            {
              min_correct_answers: Number(form.min_correct_answers),
              title: form.title,
              description: form.description ?? "",
              image_key: form.image_key || null,
              emoji: form.emoji || null,
              theme: form.theme || null,
              accent_color: form.accent_color || null,
            },
            { "If-Match": String(version.revision) },
          ),
        ),
      );
      setEditing(null);
      setForm({
        min_correct_answers: 0,
        title: "",
        description: "",
        theme: "default",
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const m = await api("/api/admin/media", {
      method: "POST",
      body: fd,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    setForm({ ...form, image_key: m.key });
  }
  async function remove(id: string) {
    setVersion(
      await api(`/api/admin/achievements/${id}`, {
        method: "DELETE",
        headers: { "If-Match": String(version.revision) },
      }),
    );
  }
  async function move(index: number, delta: number) {
    const ids = version.achievements.map((a: any) => a.id);
    const other = index + delta;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    setVersion(await api(`/api/admin/quiz-versions/${version.id}/achievement-order`, json("PUT", { ids }, { "If-Match": String(version.revision) })));
  }
  return (
    <section className="card">
      <h2>Медали за квиз</h2>
      {version.achievements.map((a: any, i: number) => (
        <div className="editor-row" key={a.id}>
          <span className="achievement-summary">
            <strong>{a.min_correct_answers}+ правильных</strong> {a.emoji} {a.title}
            <small>{a.description || "Описание не задано"}</small>
          </span>
          <div>
            <button className="link" disabled={i === 0} aria-label="Переместить медаль вверх" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="link" disabled={i === version.achievements.length - 1} aria-label="Переместить медаль вниз" onClick={() => move(i, 1)}>
              ↓
            </button>
            <button
              className="link"
              onClick={() => {
                setEditing(a.id);
                setForm(a);
              }}
            >
              Изменить
            </button>
            <button className="link danger-text" disabled={a.min_correct_answers === 0} title={a.min_correct_answers === 0 ? "Обязательную медаль за провал можно изменить, но нельзя удалить" : undefined} onClick={() => remove(a.id)}>
              Удалить
            </button>
          </div>
        </div>
      ))}
      <form className="subform" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="grid two">
          <label>
            Минимум правильных ответов
            <input
              type="number"
              min="0"
              max={version.questions.length}
              step="1"
              value={form.min_correct_answers}
              onChange={(e) =>
                setForm({
                  ...form,
                  min_correct_answers: e.target.value,
                })
              }
            />
          </label>
          <label>
            Заголовок
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
        </div>
        <label>
          Описание
          <textarea required placeholder="Что означает эта медаль и за что она выдана" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="grid two">
          <label>
            Emoji
            <input value={form.emoji ?? ""} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          </label>
          <label>
            Тема
            <select value={form.theme ?? "default"} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
              <option>default</option>
              <option>success</option>
              <option>warning</option>
              <option>danger</option>
              <option>info</option>
            </select>
          </label>
        </div>
        <label>
          Accent color
          <input type="color" value={form.accent_color ?? "#3155d9"} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
        </label>
        <label>
          Изображение
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {form.image_key && (
          <>
            <img className="thumb" src={`/media/${form.image_key}`} alt="Предпросмотр медали" />
            <button type="button" className="secondary" onClick={() => setForm({ ...form, image_key: null })}>
              Убрать изображение
            </button>
          </>
        )}
        <AchievementDraftPreview value={form} kind="medal" />
        <button>{editing ? "Сохранить" : "Добавить"}</button>
      </form>
    </section>
  );
}

function AchievementDraftPreview({ value, trigger = "", kind = "achievement" }: { value: any; trigger?: string; kind?: "achievement" | "medal" }) {
  const theme = value.theme || "default";
  const accent = value.accent_color || "#38bdf8";
  return (
    <aside className="achievement-preview-panel" aria-live="polite">
      <div className="achievement-preview-heading">
        <span className="preview-dot" />
        Предпросмотр для студента
      </div>
      <div className={`achievement achievement-preview ${theme}`} data-theme={theme} style={{ "--achievement-accent": accent } as CSSProperties}>
        <p className="eyebrow">{kind === "medal" ? "Медаль" : "Достижение"}</p>
        {value.image_key && <img src={`/media/${value.image_key}`} alt="" />}
        <div className="emoji" aria-hidden="true">
          {value.emoji || "✦"}
        </div>
        <h1>{value.title?.trim() || "Название награды"}</h1>
        <p>{value.description?.trim() || "Описание награды появится здесь."}</p>
        {kind === "achievement" && trigger.trim() && <AchievementCondition condition={trigger} />}
      </div>
      <small>Карточка обновляется сразу, сохранять черновик не нужно.</small>
    </aside>
  );
}

function AchievementCondition({ condition }: { condition: string }) {
  return <details className="achievement-spoiler"><summary>{condition}</summary></details>;
}

function SpecialAchievementEditor({ kind, version, setVersion }: { kind: "double-failure" | "retry-success"; version: any; setVersion: (v: any) => void }) {
  const isFailure = kind === "double-failure";
  const field = isFailure ? "double_failure_achievement" : "retry_success_achievement";
  const existing = version[field];
  const [form, setForm] = useState<any>(
    existing ?? {
      title: isFailure ? "Двойной промах" : "Камбэк",
      description: isFailure ? "Обе попытки завершены ниже порога успеха." : "Порог успеха пройден со второй попытки.",
      emoji: isFailure ? "🫠" : "↗️",
      theme: isFailure ? "danger" : "success",
      accent_color: isFailure ? "#b53939" : "#4f7d32",
      image_key: null,
    },
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (version[field]) setForm(version[field]);
  }, [version[field], field]);

  async function upload(file: File) {
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const media = await api("/api/admin/media", {
        method: "POST",
        body: fd,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setForm({ ...form, image_key: media.key });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError("");
    try {
      const updated = await api(
        `/api/admin/quiz-versions/${version.id}/${kind}-achievement`,
        json(
          "PUT",
          {
            title: form.title,
            description: form.description,
            image_key: form.image_key || null,
            emoji: form.emoji || null,
            theme: form.theme || null,
            accent_color: form.accent_color || null,
          },
          { "If-Match": String(version.revision) },
        ),
      );
      setVersion(updated);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <section className={`card special-achievement-card ${isFailure ? "double-failure-card" : "retry-success-card"}`}>
      <p className="eyebrow">Финал второй попытки</p>
      <h2>{isFailure ? "Медаль за двойной провал" : "Медаль за успех после провала"}</h2>
      <p className="muted">{isFailure ? "Выдаётся, если вторая, последняя попытка тоже ниже порога. Превалирует над обычной медалью за неудачу." : "Выдаётся за любой результат второй попытки, достигший порога успеха. Превалирует над обычной пороговой медалью."}</p>
      <form className="subform" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="toast-stack" aria-live="polite"><Toast message={saved ? "Медаль сохранена" : ""} onClose={() => setSaved(false)} /></div>
        <div className="grid two">
          <label>
            Заголовок
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label>
            Emoji
            <input value={form.emoji ?? ""} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          </label>
        </div>
        <label>
          Описание
          <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="grid two">
          <label>
            Тема
            <select value={form.theme ?? (isFailure ? "danger" : "success")} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
              <option>default</option>
              <option>success</option>
              <option>warning</option>
              <option>danger</option>
              <option>info</option>
            </select>
          </label>
          <label>
            Акцентный цвет
            <input type="color" value={form.accent_color ?? (isFailure ? "#b53939" : "#4f7d32")} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
          </label>
        </div>
        <label>
          Изображение
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {form.image_key && (
          <div className="media-preview">
            <img className="thumb" src={`/media/${form.image_key}`} alt={`Предпросмотр: ${form.title}`} />
            <button type="button" className="secondary" onClick={() => setForm({ ...form, image_key: null })}>
              Убрать изображение
            </button>
          </div>
        )}
        <AchievementDraftPreview value={form} kind="medal" />
        <button>{existing ? "Сохранить" : "Настроить медаль"}</button>
      </form>
    </section>
  );
}

function Results() {
  const [rows, setRows] = useState<any[]>([]);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [names, setNames] = useState(false);
  const [filters, setFilters] = useState({
    quiz_id: "",
    version_id: "",
    achievement_id: "",
    student: "",
    attempt_no: "",
    min_percent_bp: "",
    max_percent_bp: "",
    view: "best",
  });
  const load = () => {
    const p = new URLSearchParams({
      include_names: String(names),
      view: filters.view,
    });
    for (const [k, v] of Object.entries(filters)) if (v && k !== "view") p.set(k, k.includes("percent") ? String(Math.round(+v * 100)) : v);
    api(`/api/admin/results?${p}`).then((r) => setRows(r.items));
  };
  useEffect(() => {
    void load();
  }, [names]);
  useEffect(() => {
    api("/api/admin/quizzes").then((r) => setQuizzes(r.items));
  }, []);
  async function selectQuiz(quizId: string) {
    setFilters({
      ...filters,
      quiz_id: quizId,
      version_id: "",
      achievement_id: "",
    });
    setAchievements([]);
    if (!quizId) {
      setVersions([]);
      return;
    }
    const q = await api(`/api/admin/quizzes/${quizId}`);
    setVersions(q.versions);
    const all = (await Promise.all(q.versions.map((v: any) => api(`/api/admin/quiz-versions/${v.id}`)))).flatMap((v: any) => [...v.achievements, ...(v.double_failure_achievement ? [v.double_failure_achievement] : []), ...(v.retry_success_achievement ? [v.retry_success_achievement] : [])]);
    setAchievements(all);
  }
  return (
    <AdminGuard>
      <Layout admin>
        <div className="page-head">
          <h1>Результаты</h1>
          <label className="switch">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Показать имена
          </label>
        </div>
        <form
          className="card inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <label>
            Тест
            <select value={filters.quiz_id} onChange={(e) => void selectQuiz(e.target.value)}>
              <option value="">Все</option>
              {quizzes.map((q) => (
                <option value={q.id} key={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Версия
            <select value={filters.version_id} onChange={(e) => setFilters({ ...filters, version_id: e.target.value })}>
              <option value="">Все</option>
              {versions.map((v) => (
                <option value={v.id} key={v.id}>
                  v{v.version_number} · {v.status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Медаль
            <select value={filters.achievement_id} onChange={(e) => setFilters({ ...filters, achievement_id: e.target.value })}>
              <option value="">Все</option>
              {achievements.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Студент
            <input value={filters.student} onChange={(e) => setFilters({ ...filters, student: e.target.value })} />
          </label>
          <label>
            Попытка
            <select value={filters.attempt_no} onChange={(e) => setFilters({ ...filters, attempt_no: e.target.value })}>
              <option value="">Все</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
          <label>
            От, %
            <input type="number" min="0" max="100" value={filters.min_percent_bp} onChange={(e) => setFilters({ ...filters, min_percent_bp: e.target.value })} />
          </label>
          <label>
            До, %
            <input type="number" min="0" max="100" value={filters.max_percent_bp} onChange={(e) => setFilters({ ...filters, max_percent_bp: e.target.value })} />
          </label>
          <label>
            Режим
            <select value={filters.view} onChange={(e) => setFilters({ ...filters, view: e.target.value })}>
              <option value="best">Лучший результат</option>
              <option value="attempts">Все попытки</option>
            </select>
          </label>
          <button>Применить</button>
        </form>
        <div className="actions">
          <a className="button secondary" href="/api/admin/exports/summary.csv">
            Summary CSV
          </a>
          <a className="button secondary" href="/api/admin/exports/questions.csv">
            Question CSV
          </a>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Студент</th>
                <th>Тест</th>
                <th>Попытка</th>
                <th>Результат</th>
                {filters.view === "best" && <th>Первая / retry / лучшая</th>}
                <th>Медаль</th>
                <th>Завершено</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.student_code}
                    {names && <small>{r.fio_display}</small>}
                  </td>
                  <td>
                    {r.quiz_title} v{r.version_number}
                  </td>
                  <td>{r.attempt_no}</td>
                  <td>
                    {r.score}/{r.max_score} · {(r.percent_bp / 100).toFixed(2)}%
                    <small>
                      Правильно: {r.correct_answers}/{r.question_count}
                    </small>
                  </td>
                  {filters.view === "best" && (
                    <td>
                      {r.first_score ?? "—"} / {r.retry_score ?? "—"} / {r.best_score ?? "—"}
                    </td>
                  )}
                  <td>{r.achievement_title}</td>
                  <td>{fmt(r.finalized_at)}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Layout>
    </AdminGuard>
  );
}

function Analytics() {
  const { id = "" } = useParams();
  const [mode, setMode] = useState("first_attempts");
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api(`/api/admin/quizzes/${id}/analytics?mode=${mode}`).then(setData);
  }, [id, mode]);
  const percent = (v: any) => (v == null ? "—" : (v / 100).toFixed(1) + "%");
  return (
    <AdminGuard>
      <Layout admin>
        <div className="page-head">
          <h1>Аналитика</h1>
          <label>
            Набор данных
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="first_attempts">Первые попытки</option>
              <option value="all_attempts">Все попытки</option>
              <option value="best_attempt_per_student">Лучшие попытки</option>
            </select>
          </label>
        </div>
        {data && (
          <>
            <dl className="facts">
              <div>
                <dt>Участников</dt>
                <dd>{data.participants_count}</dd>
              </div>
              <div>
                <dt>Сдано / истекло</dt>
                <dd>
                  {data.submitted_count} / {data.expired_count}
                </dd>
              </div>
              <div>
                <dt>Retry</dt>
                <dd>{data.retries_count}</dd>
              </div>
              <div>
                <dt>Среднее</dt>
                <dd>{percent(data.mean)}</dd>
              </div>
              <div>
                <dt>Медиана</dt>
                <dd>{percent(data.median)}</dd>
              </div>
              <div>
                <dt>Стд. отклонение</dt>
                <dd>{percent(data.standard_deviation)}</dd>
              </div>
              <div>
                <dt>Мин. / макс.</dt>
                <dd>
                  {percent(data.min)} / {percent(data.max)}
                </dd>
              </div>
            </dl>
            <section className="card">
              <h2>Медали</h2>
              {Object.entries(data.achievement_distribution).map(([k, v]) => (
                <div className="editor-row" key={k}>
                  <span>{k}</span>
                  <strong>{String(v)}</strong>
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Вопросы</h2>
              {data.questions.map((q: any) => (
                <div className="analytics-question" key={q.question_id}>
                  <div className="editor-row">
                    <span>
                      {q.text}
                      <small>
                        Верно {q.correct}, неверно {q.incorrect}, без ответа {q.unanswered}
                      </small>
                    </span>
                    <strong>{(q.correct_percent / 100).toFixed(1)}%</strong>
                  </div>
                  {q.option_distribution?.map((o: any) => (
                    <div className="option-stat" key={o.id}>
                      <span>{o.text}</span>
                      <strong>{o.count}</strong>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </>
        )}
      </Layout>
    </AdminGuard>
  );
}
function Students() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/api/admin/students?include_names=true").then((r) => setRows(r.items)).finally(() => setLoading(false));
  }, []);
  return (
    <AdminGuard>
      <Layout admin>
        <div className="catalog-header"><div><p className="eyebrow">Участники платформы</p><h1>Студенты</h1><p className="muted">Откройте карточку студента, чтобы посмотреть историю результатов.</p></div></div>
        {loading && <ListSkeleton rows={4} />}
        <div className="entity-grid student-directory">{rows.map((s) => (
          <Link className="entity-card student-card" to={`/admin/students/${s.id}`} key={s.id}>
            <span className="student-avatar" aria-hidden="true">{String(s.fio_display || "?").trim().charAt(0)}</span><div className="entity-copy"><h2>{s.fio_display}</h2><small>Код студента · {s.student_code}</small></div><b className="entity-arrow">→</b>
          </Link>
        ))}</div>
        {!loading && !rows.length && <div className="empty-state"><strong>Студентов пока нет</strong><span>Они появятся после первой регистрации.</span></div>}
      </Layout>
    </AdminGuard>
  );
}
function StudentHistory() {
  const { id = "" } = useParams();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api(`/api/admin/students/${id}/history`).then(setData);
  }, [id]);
  return (
    <AdminGuard>
      <Layout admin>
        {data && (
          <>
            <h1>{data.student.student_code}</h1>
            <p>{data.student.fio_display}</p>
            {data.attempts.map((a: any) => (
              <div className="quiz-row" key={a.id}>
                {a.quiz_title}: {a.score}/{a.max_score}, попытка {a.attempt_no}
              </div>
            ))}
          </>
        )}
      </Layout>
    </AdminGuard>
  );
}

function PlatformAchievements() {
  const [items, setItems] = useState<any[]>([]), [students, setStudents] = useState<any[]>([]), [courses, setCourses] = useState<any[]>([]), [assignments, setAssignments] = useState<any[]>([]);
  const [creating, setCreating] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState(""), [query, setQuery] = useState(""), [courseFilter, setCourseFilter] = useState(""), [scopeFilter, setScopeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedAchievement, setSelectedAchievement] = useState<any>(null);
  const emptyAchievement = { course_id: "", title: "", description: "", unlock_hint: "", emoji: "✦", accent_color: "#38BDF8", image_key: null as string | null, applicability_scope: "selected_assignments", required_capability: "any", source_kind: "grader", repeatability: "once_per_course", trigger: {}, assignment_ids: [] as string[] };
  const [draft, setDraft] = useState<{ assignment_ids: string[]; [key: string]: any }>(emptyAchievement);
  const [awards, setAwards] = useState<Record<string, { student_id: string; reason: string }>>({});
  async function load() {
    const [definitions, people, courseData, assignmentData] = await Promise.all([api("/api/admin/platform-achievements"), api("/api/admin/students?include_names=true"), api("/api/admin/courses"), api("/api/admin/assignments")]);
    setItems(definitions.items); setStudents(people.items); setCourses(courseData.items); setAssignments(assignmentData.items);
    setDraft((current: any) => ({ ...current, course_id: current.course_id || courseData.items[0]?.id || "" })); setLoading(false);
  }
  useEffect(() => { void load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function create(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      await api(editingId ? `/api/admin/platform-achievements/${editingId}` : "/api/admin/platform-achievements", json(editingId ? "PUT" : "POST", draft));
      setDraft({ ...emptyAchievement, course_id: draft.course_id }); setCreating(false); setEditingId(""); setNotice(editingId ? "Достижение обновлено" : "Достижение создано"); await load();
    } catch (cause) { setError((cause as Error).message); }
  }
  async function uploadImage(file: File) {
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const media = await api("/api/admin/media", { method: "POST", body, headers: { "Idempotency-Key": crypto.randomUUID() } });
      setDraft((current: any) => ({ ...current, image_key: media.key }));
    } catch (cause) { setError((cause as Error).message); }
  }
  async function award(id: string) {
    const value = awards[id]; if (!value?.student_id) return; setError("");
    try {
      await api(`/api/admin/platform-achievements/${id}/award`, json("POST", value));
      setAwards({ ...awards, [id]: { student_id: "", reason: "" } }); setNotice("Достижение выдано"); await load();
    } catch (cause) { setError((cause as Error).message); }
  }
  function edit(item: any) {
    setEditingId(item.id); setSelectedAchievement(null); setDraft({ course_id:item.course_id,title:item.title,description:item.description,unlock_hint:item.unlock_hint || "",emoji:item.emoji,accent_color:item.accent_color,image_key:item.image_key,
      applicability_scope:item.applicability_scope,required_capability:item.required_capability,source_kind:item.source_kind,repeatability:item.repeatability,trigger:item.definition_json ? JSON.parse(item.definition_json).trigger || {} : {},assignment_ids:JSON.parse(item.assignment_ids_json || "[]") }); setCreating(true);
  }
  const visibleItems = items.filter((item) => (!query || `${item.title} ${item.description}`.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))) && (!courseFilter || item.course_id === courseFilter) && (!scopeFilter || item.applicability_scope === scopeFilter));
  return <AdminGuard><Layout admin>
    <div className="catalog-header"><div><p className="eyebrow">Каталог курса</p><h1>Достижения</h1><p className="muted">Создавайте достижения курса и подключайте их ко всем или выбранным лабораторным.</p></div><button onClick={() => setCreating(true)}>Создать достижение</button></div>
    <div className="toast-stack"><Toast message={notice} onClose={() => setNotice("")} /><Toast message={error} kind="error" onClose={() => setError("")} /></div>
    <div className="list-filters"><label>Поиск<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название или описание" /></label><label>Курс<select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}><option value="">Все курсы</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label><label>Привязка<select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}><option value="">Все</option><option value="global_course">Глобальные по курсу</option><option value="selected_assignments">Для выбранных лабораторных</option></select></label></div>
    <div className="entity-grid">
      {loading && <ListSkeleton />}
      {visibleItems.map((item) => { const boundIds: string[] = JSON.parse(item.assignment_ids_json || "[]"); const boundAssignments = assignments.filter((assignment) => boundIds.includes(assignment.id)); return <article className="entity-card achievement-definition-card" key={item.id} style={{ "--badge-accent": item.accent_color } as CSSProperties}>
        <span className={`entity-icon ${item.image_key ? "has-image" : ""}`}>{item.image_key ? <img src={`/media/${item.image_key}`} alt="" /> : item.emoji}</span><div className="entity-copy"><h2>{item.title}</h2><p>{item.description}</p><div className="achievement-binding-tags">{item.applicability_scope === "global_course" ? <span>Весь курс</span> : boundAssignments.map((assignment) => <span key={assignment.id}>{assignment.title}</span>)}</div><small>{item.course_title} · выдано: {item.award_count}</small></div>
        <div className="actions"><button className="secondary" onClick={() => edit(item)}>Редактировать</button><button className="secondary" onClick={() => setSelectedAchievement(item)}>Выдать</button></div>
      </article>; })}
      {!loading && !items.length && <div className="empty-state"><strong>Достижений пока нет</strong><span>Создайте первое платформенное достижение.</span></div>}
    </div>
    {creating && <Modal titleId="create-platform-achievement-title" onClose={() => setCreating(false)}><form className="card create-dialog" onSubmit={create}><p className="eyebrow">Новое</p><h2 id="create-platform-achievement-title">Создать достижение</h2><label>Курс<select required value={draft.course_id} onChange={(e) => setDraft({ ...draft, course_id: e.target.value, assignment_ids: [] })}><option value="">Выберите курс</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label><label>Название<input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label><label>Описание<textarea required value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label><label>Условие получения (будет скрыто спойлером)<textarea required value={draft.unlock_hint} onChange={(e) => setDraft({ ...draft, unlock_hint: e.target.value })} /></label><div className="grid two"><label>Область<select value={draft.applicability_scope} onChange={(e) => setDraft({ ...draft, applicability_scope: e.target.value })}><option value="global_course">Глобальное по курсу</option><option value="selected_assignments">Выбранные лабораторные</option></select></label><label>Требование<select value={draft.required_capability} onChange={(e) => setDraft({ ...draft, required_capability: e.target.value })}><option value="any">Любая лабораторная</option><option value="grader">Есть grader</option><option value="llm">Есть LLM-review</option></select></label></div>{draft.applicability_scope === "selected_assignments" && <fieldset><legend>Лабораторные</legend>{assignments.filter((item) => item.course_id === draft.course_id).map((item) => <label className="check" key={item.id}><input type="checkbox" checked={draft.assignment_ids.includes(item.id)} onChange={(e) => setDraft({ ...draft, assignment_ids: e.target.checked ? [...draft.assignment_ids,item.id] : draft.assignment_ids.filter((id) => id !== item.id) })} />{item.title}</label>)}</fieldset>}<div className="grid two"><label>Источник<select value={draft.source_kind} onChange={(e) => setDraft({ ...draft, source_kind: e.target.value })}><option value="grader">Grader</option><option value="llm">LLM</option><option value="pipeline">Pipeline</option><option value="runtime">Runtime</option><option value="platform">Платформа</option><option value="teacher">Преподаватель</option></select></label><label>Повторяемость<select value={draft.repeatability} onChange={(e) => setDraft({ ...draft, repeatability: e.target.value })}><option value="once_per_course">Один раз за курс</option><option value="once_per_assignment">Один раз за лабораторную</option><option value="repeatable">Повторяемое</option></select></label></div><div className="grid two"><label>Значок<input maxLength={16} value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} /></label><label>Цвет<input type="color" value={draft.accent_color} onChange={(e) => setDraft({ ...draft, accent_color: e.target.value })} /></label></div><label>Изображение<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0])} /></label>{draft.image_key && <div className="media-preview"><img className="thumb" src={`/media/${draft.image_key}`} alt="Предпросмотр достижения" /><button type="button" className="secondary" onClick={() => setDraft({ ...draft, image_key: null })}>Убрать изображение</button></div>}<AchievementDraftPreview value={{ ...draft, theme: "info" }} trigger={draft.unlock_hint} /><div className="actions"><button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button><button>Создать</button></div></form></Modal>}
    {selectedAchievement && (() => { const value = awards[selectedAchievement.id] ?? { student_id: "", reason: "" }; return <Modal titleId="platform-achievement-detail-title" onClose={() => setSelectedAchievement(null)}><section className="card achievement-detail-dialog"><div className="achievement-detail-heading"><span className={`entity-icon ${selectedAchievement.image_key ? "has-image" : ""}`}>{selectedAchievement.image_key ? <img src={`/media/${selectedAchievement.image_key}`} alt="" /> : selectedAchievement.emoji}</span><div><p className="eyebrow">Платформенное достижение</p><h2 id="platform-achievement-detail-title">{selectedAchievement.title}</h2></div></div><p>{selectedAchievement.description}</p><dl className="facts"><div><dt>Получили</dt><dd>{selectedAchievement.award_count}</dd></div></dl><div className="dialog-section"><h3>Выдать студенту</h3><div className="award-form"><select value={value.student_id} onChange={(e) => setAwards({ ...awards, [selectedAchievement.id]: { ...value, student_id: e.target.value } })}><option value="">Выберите студента</option>{students.map((student) => <option value={student.id} key={student.id}>{student.fio_display}</option>)}</select><input value={value.reason} placeholder="За что выдаётся" onChange={(e) => setAwards({ ...awards, [selectedAchievement.id]: { ...value, reason: e.target.value } })} /><button disabled={!value.student_id || value.reason.trim().length < 3} onClick={() => void award(selectedAchievement.id)}>Выдать</button></div></div><button className="secondary" onClick={() => setSelectedAchievement(null)}>Закрыть</button></section></Modal>; })()}
  </Layout></AdminGuard>;
}

function AdminAccess() {
  const [courses, setCourses] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [runName, setRunName] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [runCourseId, setRunCourseId] = useState("");
  const [group, setGroup] = useState({
    course_run_id: "",
    name: "",
    kind: "lecture",
  });
  const [teacher, setTeacher] = useState({
    username: "",
    display_name: "",
    password: "",
  });
  const [assignment, setAssignment] = useState({
    teacher_id: "",
    group_id: "",
  });
  const [workerName, setWorkerName] = useState("grader-worker"),
    [workerToken, setWorkerToken] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function load() {
    const [c, r, g, t, q] = await Promise.all([api("/api/admin/courses"), api("/api/admin/course-runs"), api("/api/admin/groups"), api("/api/admin/teachers"), api("/api/admin/group-requests")]);
    setCourses(c.items); setRunCourseId((current) => current || c.items[0]?.id || "");
    setRuns(r.items);
    setGroups(g.items);
    setTeachers(t.items);
    setRequests(q.items);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(work: () => Promise<unknown>, message: string) {
    setError("");
    try {
      await work();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <AdminGuard>
      <Layout admin>
        <div className="page-head">
          <div>
            <p className="eyebrow">Разделение доступа</p>
            <h1>Курсы, группы и преподаватели</h1>
          </div>
        </div>
        <nav className="section-navigation" aria-label="Разделы настроек"><a href="#course-structure">Курсы и группы</a><a href="#teaching-team">Преподаватели</a><a href="#grading-service">Сервис проверки</a><a href="#access-requests">Заявки</a></nav>
        <div className="toast-stack" aria-live="polite"><Toast message={notice} onClose={() => setNotice("")} /><Toast message={error} kind="error" onClose={() => setError("")} timeout={9000} /></div>
        <div className="admin-access-grid">
          <div className="admin-section-title" id="course-structure"><span>1</span><div><h2>Структура курса</h2><p>Запуски курса и входящие в них учебные группы.</p></div></div>
          <section className="card">
            <h2>Курс</h2>
            <form onSubmit={(e) => { e.preventDefault(); void action(() => api("/api/admin/courses", json("POST", { title: courseTitle })), "Курс создан"); }}>
              <label>Название<input value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} required placeholder="Название курса" /></label><button>Создать курс</button>
            </form>
            {courses.map((course) => <div className="access-item" key={course.id}><strong>{course.title}</strong><span>Запусков: {course.run_count} · лабораторных: {course.assignment_count}</span></div>)}
          </section>
          <section className="card">
            <h2>Запуск курса</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => api("/api/admin/course-runs", json("POST", { course_id: runCourseId, name: runName })), "Запуск курса создан");
              }}
            >
              <label>Курс<select required value={runCourseId} onChange={(e) => setRunCourseId(e.target.value)}><option value="">Выберите</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label>
              <label>
                Название
                <input value={runName} onChange={(e) => setRunName(e.target.value)} required placeholder="Курс 26–27" />
              </label>
              <button>Создать</button>
            </form>
            {runs.map((r) => (
              <div className="access-item" key={r.id}>
                <strong>{r.course_title} / {r.name}</strong>
                <span>Групп: {r.group_count}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Группа</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => api("/api/admin/groups", json("POST", { ...group, join_requests_enabled: true })), "Группа создана");
              }}
            >
              <label>
                Курс
                <select value={group.course_run_id} onChange={(e) => setGroup({ ...group, course_run_id: e.target.value })} required>
                  <option value="">Выберите</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Тип
                <select value={group.kind} onChange={(e) => setGroup({ ...group, kind: e.target.value })}>
                  <option value="lecture">Лекции</option>
                  <option value="practice">Практики</option>
                </select>
              </label>
              <label>
                Название
                <input value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} required />
              </label>
              <button>Создать</button>
            </form>
            {groups.map((g) => (
              <div className="access-item" key={g.id}>
                <strong>
                  {g.course_run_name} / {g.name}
                </strong>
                <span>
                  {g.kind} · код {g.join_code} · студентов {g.member_count}
                </span>
              </div>
            ))}
          </section>
          <div className="admin-section-title" id="teaching-team"><span>2</span><div><h2>Команда и доступ</h2><p>Учётные записи преподавателей и назначение на группы.</p></div></div>
          <section className="card">
            <h2>Преподаватель</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => api("/api/admin/teachers", json("POST", teacher)), "Преподаватель создан");
              }}
            >
              <label>
                Имя
                <input value={teacher.display_name} onChange={(e) => setTeacher({ ...teacher, display_name: e.target.value })} required />
              </label>
              <label>
                Логин
                <input value={teacher.username} onChange={(e) => setTeacher({ ...teacher, username: e.target.value })} required />
              </label>
              <label>
                Временный пароль
                <input type="password" minLength={12} value={teacher.password} onChange={(e) => setTeacher({ ...teacher, password: e.target.value })} required />
              </label>
              <button>Создать</button>
            </form>
            {teachers.map((t) => (
              <div className="access-item" key={t.id}>
                <strong>{t.display_name}</strong>
                <span>
                  {t.username} · групп: {t.group_count}
                </span>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Назначение на группу</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => api(`/api/admin/teachers/${assignment.teacher_id}/groups/${assignment.group_id}`, { method: "PUT" }), "Доступ назначен");
              }}
            >
              <label>
                Преподаватель
                <select value={assignment.teacher_id} onChange={(e) => setAssignment({ ...assignment, teacher_id: e.target.value })} required>
                  <option value="">Выберите</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Группа
                <select value={assignment.group_id} onChange={(e) => setAssignment({ ...assignment, group_id: e.target.value })} required>
                  <option value="">Выберите</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.course_run_name} / {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <button>Назначить</button>
            </form>
          </section>
          <div className="admin-section-title" id="grading-service"><span>3</span><div><h2>Инфраструктура проверки</h2><p>Служебные учётные данные локального сервиса проверки.</p></div></div>
          <section className="card">
            <h2>Подключение сервиса проверки</h2>
            <p className="muted">Токен показывается только один раз. Сохраните его в секретах локального сервиса проверки.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                void api("/api/admin/grader-workers", json("POST", { name: workerName }))
                  .then((x) => {
                    setWorkerToken(x.token);
                    setNotice("Токен создан");
                  })
                  .catch((x) => setError(x.message));
              }}
            >
              <label>
                Имя Worker
                <input value={workerName} onChange={(e) => setWorkerName(e.target.value)} required />
              </label>
              <button>Создать токен</button>
            </form>
            {workerToken && (
              <div className="code-result">
                <strong>{workerToken}</strong>
                <button className="secondary" onClick={() => navigator.clipboard.writeText(workerToken)}>
                  Скопировать
                </button>
              </div>
            )}
          </section>
        </div>
        <section className="card" id="access-requests">
          <h2>Заявки</h2>
          {requests
            .filter((r) => r.status === "pending")
            .map((r) => (
              <div className="request-row" key={r.id}>
                <span>
                  <strong>{r.fio_display}</strong> → {r.course_run_name} / {r.group_name}
                </span>
                <div className="actions compact">
                  <button onClick={() => void action(() => api(`/api/admin/group-requests/${r.id}/resolve`, json("POST", { decision: "approved" })), "Заявка одобрена")}>Одобрить</button>
                  <button className="secondary" onClick={() => void action(() => api(`/api/admin/group-requests/${r.id}/resolve`, json("POST", { decision: "rejected" })), "Заявка отклонена")}>
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          {!requests.some((r) => r.status === "pending") && <p className="muted">Новых заявок нет.</p>}
        </section>
      </Layout>
    </AdminGuard>
  );
}

function TeacherGuard({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    api("/api/teacher/session")
      .then((s) => {
        setCsrf(s.csrf_token);
        setOk(true);
      })
      .catch(() => setOk(false));
  }, []);
  if (ok === null) return <main>Загрузка…</main>;
  return ok ? <>{children}</> : <Navigate to="/teacher/login" replace />;
}
function TeacherLogin() {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState("");
  const nav = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const s = await api("/api/teacher/session", json("POST", { username, password }));
      setCsrf(s.csrf_token);
      nav("/teacher");
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <Layout>
      <section className="card narrow">
        <p className="eyebrow">Преподаватель</p>
        <h1>Вход</h1>
        <form onSubmit={submit}>
          <label>
            Логин
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <button>Войти</button>
        </form>
        <ErrorBox error={error} />
      </section>
    </Layout>
  );
}
function TeacherSubmissionReview({ submission: s, refresh }: { submission: any; refresh: () => Promise<void> }) {
  const assessment = s.llm_result?.assessment;
  const rubricCriteria = s.rubric_definition?.criteria ?? [];
  const [comment, setComment] = useState(""),
    [earned, setEarned] = useState(assessment?.total_score != null ? String(assessment.total_score) : ""),
    [criterionScores, setCriterionScores] = useState<Record<string, number>>(() => Object.fromEntries(rubricCriteria.map((criterion: any) => [criterion.id, Number(assessment?.criteria?.find((item: any) => item.criterion_id === criterion.id)?.proposed_score ?? criterion.min_score)]))),
    [defenseAt, setDefenseAt] = useState(""),
    [defenseLocation, setDefenseLocation] = useState(""),
    [error, setError] = useState("");
  async function decide(action: "override_score" | "manual_defense" | "reject" | "finalize_manual_defense") {
    setError("");
    try {
      const score = ["override_score", "finalize_manual_defense"].includes(action) ? { earned: Number(earned), maximum: 100 as const, criteria: criterionScores } : undefined;
      const manual_defense = action === "manual_defense" ? { at: Math.floor(new Date(defenseAt).getTime() / 1000), location: defenseLocation } : undefined;
      await api(`/api/teacher/submissions/${s.id}/review-decision`, json("POST", { action, comment, ...(score ? { score } : {}), ...(manual_defense ? { manual_defense } : {}) }));
      setComment("");
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  const reviewable = ["awaiting_teacher_review", "manual_defense"].includes(s.status);
  const rubric = new Map((s.rubric_definition?.criteria ?? []).map((item: any) => [item.id, item]));
  const evidence = Object.entries(assessment?.evidence_report ?? {}).flatMap(([severity, items]: any) => (items ?? []).map((item: any) => ({ ...item, severity })));
  const graderChecks = s.grader_result?.checks ?? [];
  const sourceLabels: Record<string, string> = {
    grader: "Автопроверка",
    runtime: "Среда выполнения",
    llm: "LLM-рецензент",
    pipeline: "Пайплайн",
    teacher: "Преподаватель",
    platform: "Платформа",
  };
  const recommendationLabels: Record<string, string> = {
    accept: "Можно зачесть",
    revise: "Нужна доработка",
    manual_defense: "Нужна защита",
    reject: "Отклонить",
  };
  return (
    <article className="submission-card submission-detail">
      <div className="submission-head">
        <div>
          <strong>
            {s.fio_display} · {s.title}
          </strong>
          <small>
            Репозиторий: {s.repo_url} · версия {s.commit_sha.slice(0, 8)}
          </small>
        </div>
        <span className="status-pill">{submissionLabels[s.status] ?? s.status}</span>
      </div>
      {s.public_summary && <p>{s.public_summary}</p>}
      {s.grader_result?.score && (
        <p>
          <strong>Автопроверка:</strong> {s.grader_result.score.earned} / {s.grader_result.score.maximum}
        </p>
      )}
      {!!s.grader_result?.checks?.length && (
        <GroupedGraderChecks checks={graderChecks} />
      )}
      {!!s.clarifications?.length && (
        <section className="clarification-review">
          <div className="clarification-review-heading">
            <div>
              <p className="eyebrow">Диалог проверки</p>
              <h3>Ответы на вопросы по лабораторной</h3>
            </div>
            <span className="item-count">{s.clarifications.length}</span>
          </div>
          <div className="clarification-thread">
            {s.clarifications.map((item: any) => (
              <article className="clarification-exchange" key={item.question_number}>
                <div className="clarification-message is-model">
                  <div className="clarification-role"><span aria-hidden="true">ИИ</span><strong>Вопрос проверяющей модели</strong></div>
                  <p>{item.question}</p>
                  {item.asked_at && <small>Задан {fmt(item.asked_at)}</small>}
                </div>
                <div className={`clarification-message is-student ${item.answer ? "" : "is-pending"}`}>
                  <div className="clarification-role"><span aria-hidden="true">С</span><strong>Ответ студента</strong></div>
                  <p>{item.answer ?? "Ответ пока не получен"}</p>
                  {item.answered_at && <small>Получен {fmt(item.answered_at)}</small>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {assessment && (
        <section className="assessment-card">
          <p className="eyebrow">Итоговая рекомендация</p>
          <div className="submission-head">
            <h3>{assessment.total_score} из 100</h3>
            <span className="status-pill">{recommendationLabels[assessment.recommendation] ?? assessment.recommendation}</span>
          </div>
          <p>{assessment.teacher_summary}</p>
          <div className="table-wrap criteria-table">
            <table>
              <thead>
                <tr>
                  <th>Критерий</th>
                  <th>Пояснение</th>
                  <th>Балл</th>
                  <th>Максимум</th>
                </tr>
              </thead>
              <tbody>
                {assessment.criteria?.map((item: any) => {
                  const definition: any = rubric.get(item.criterion_id);
                  return (
                    <tr key={item.criterion_id}>
                      <td>
                        <strong>{definition?.title ?? item.criterion_id}</strong>
                      </td>
                      <td>{item.rationale}</td>
                      <td>{item.proposed_score}</td>
                      <td>{definition?.max_score ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!!evidence.length && (
        <section className="evidence-panel">
          <div className="section-heading">
            <div><h3>Основания оценки</h3><p className="muted">Подробности свёрнуты и сгруппированы по смыслу.</p></div>
            <span className="status-pill">Всего: {evidence.length}</span>
          </div>
          {(["critical", "warning", "positive"] as const).map((severity) => {
            const entries = evidence.filter((item: any) => item.severity === severity);
            if (!entries.length) return null;
            const label = severity === "critical" ? "Критические основания" : severity === "warning" ? "Замечания" : "Сильные стороны";
            return <details className={`evidence-group evidence-${severity}`} key={severity} open={severity === "critical"}>
              <summary><span className="check-symbol">{severity === "critical" ? "×" : severity === "warning" ? "▲" : "✓"}</span>{label}<b>{entries.length}</b></summary>
              <div className="evidence-list">{entries.map((item: any) => <div className={`evidence-item evidence-${severity}`} key={item.id}>
                <span className="check-symbol">{severity === "critical" ? "×" : severity === "warning" ? "▲" : "✓"}</span>
                <span><strong>{item.summary || "Основание оценки"}</strong><small>{item.category ? evidenceCategoryLabels[item.category] ?? item.category : ""}</small></span>
              </div>)}</div>
            </details>;
          })}
        </section>
      )}
      {!!s.achievement_nominations?.length && (
        <section className="review-information-panel achievement-nominations-panel">
          <div className="section-heading"><div><p className="eyebrow">Награды за лабораторную</p><h3>Номинации на достижения</h3><p className="muted">Объективные проверки выдают достижения автоматически. Номинации LLM подтверждаются преподавателем вместе с итоговым решением.</p></div><span className="item-count">{s.achievement_nominations.length}</span></div>
          <div className="review-information-list">{s.achievement_nominations.map((item: any, index: number) => {
            const definition = s.achievement_definitions?.find((x: any) => x.id === item.achievement_id);
            const source = String(item.source).split(":")[0];
            return (
              <article className="review-information-item achievement-nomination" key={`${item.achievement_id}-${index}`}>
                <span tabIndex={0}>
                  <strong>
                    {definition?.image_key ? <img className="nomination-icon" src={`/media/${definition.image_key}`} alt="" /> : <span className="nomination-emoji" aria-hidden="true">{definition?.emoji || "✦"}</span>} {definition?.title ?? item.achievement_id}
                  </strong>
                  <small>Назначил: {sourceLabels[source] ?? source}</small>
                  <span className="achievement-tooltip">
                    <b>{definition?.title ?? item.achievement_id}</b>
                    <span>{definition?.description ?? "Описание не задано"}</span>
                    <span className="tooltip-icon">{definition?.image_key ? <img src={`/media/${definition.image_key}`} alt="" /> : definition?.emoji || "✦"}</span>
                  </span>
                </span>
                <span className="status-pill">{item.status === "accepted" ? "Выдано автоматически" : item.status === "rejected" ? "Отклонено" : "Подтвердит преподаватель"}</span>
              </article>
            );
          })}</div>
        </section>
      )}
      {!!s.decisions?.length && (
        <section className="review-information-panel decision-history-panel">
          <div className="section-heading"><div><p className="eyebrow">Ход проверки</p><h3>История решений</h3></div><span className="item-count">{s.decisions.length}</span></div>
          <div className="decision-timeline">{s.decisions.map((item: any, index: number) => (
            <article className="decision-entry" key={index}>
              <span className="decision-marker" aria-hidden="true" />
              <div><div className="decision-entry-heading"><strong>{decisionLabels[item.action] ?? item.action}</strong><time>{fmt(item.created_at)}</time></div><p>{item.comment}</p>{item.defense_at && <small>Защита: {fmt(item.defense_at)} · {item.defense_location}</small>}</div>
            </article>
          ))}</div>
        </section>
      )}
      {s.status === "manual_defense" && <Notice>Назначена ручная защита. Новые отправки этой лабораторной для студента заблокированы до итогового решения преподавателя. После защиты выставьте балл или отклоните работу.</Notice>}
      {reviewable && (
        <div className="review-controls">
          <label>
            Комментарий преподавателя
            <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <label>
            Итоговый балл из 100
            <input type="number" min="0" max="100" value={earned} readOnly />
          </label>
          {!!rubricCriteria.length && <div className="criterion-score-editor"><strong>Баллы по критериям</strong>{rubricCriteria.map((criterion: any) => <label key={criterion.id}>{criterion.title}<span><input type="number" min={criterion.min_score} max={criterion.max_score} step={criterion.score_step} value={criterionScores[criterion.id] ?? criterion.min_score} onChange={(e) => { const next = { ...criterionScores, [criterion.id]: Number(e.target.value) }; setCriterionScores(next); setEarned(String((Object.values(next) as number[]).reduce((sum, value) => sum + Number(value), 0))); }} /><small>из {criterion.max_score}</small></span></label>)}</div>}
          {s.status !== "manual_defense" && <div className="grid two"><label>Дата и время защиты<input type="datetime-local" value={defenseAt} onChange={(e) => setDefenseAt(e.target.value)} /></label><label>Место или ссылка<input value={defenseLocation} onChange={(e) => setDefenseLocation(e.target.value)} placeholder="Аудитория или ссылка" /></label></div>}
          <div className="actions compact">
            <button disabled={comment.trim().length < 3 || earned === ""} onClick={() => void decide("override_score")}>
              Сохранить итог и отправить в архив
            </button>
            <button className="secondary" disabled={comment.trim().length < 3 || !defenseAt || !defenseLocation.trim()} onClick={() => void decide("manual_defense")}>
              Назначить ручную защиту
            </button>
            {s.status === "manual_defense" && (
              <button disabled={comment.trim().length < 3 || earned === ""} onClick={() => void decide("finalize_manual_defense")}>
                Завершить защиту
              </button>
            )}
            <button className="danger" disabled={comment.trim().length < 3} onClick={() => void decide("reject")}>
              Отклонить работу
            </button>
          </div>
          <ErrorBox error={error} />
        </div>
      )}
    </article>
  );
}
function TeacherSubmissionPage() {
  const { id = "" } = useParams(),
    nav = useNavigate();
  const query = new URLSearchParams(location.search),
    sourceTab = query.get("from") === "archive" ? "archive" : "pending",
    sourceGroup = query.get("group") ?? "";
  const [submission, setSubmission] = useState<any>(null),
    [nextPending, setNextPending] = useState<any>(null),
    [error, setError] = useState("");
  async function load() {
    try {
      const next = await api(`/api/teacher/submissions/${id}`);
      setSubmission(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    if (sourceGroup) {
      void api(`/api/teacher/groups/${sourceGroup}/submissions`)
        .then((data) => setNextPending(data.items.find((item: any) => item.id !== id && !["finalized", "rejected_duplicate_repo", "blocked_duplicate_repo"].includes(item.status)) ?? null))
        .catch(() => setNextPending(null));
    }
  }, [id, sourceGroup]);
  return (
    <TeacherGuard>
      <Layout teacher>
        <div className="review-page-navigation">
          <button className="link back-link" onClick={() => nav(sourceGroup ? `/teacher/groups/${sourceGroup}?tab=${sourceTab}` : "/teacher")}>
            ← К очереди проверок
          </button>
          {nextPending && <Link to={`/teacher/submissions/${nextPending.id}?from=pending&group=${sourceGroup}`}>Следующая работа →</Link>}
        </div>
        <div className="page-head">
          <div>
            <p className="eyebrow">Проверка лабораторной</p>
            <h1>{submission?.title ?? "Загрузка…"}</h1>
          </div>
        </div>
        <ErrorBox error={error} />
        {submission && (
          <TeacherSubmissionReview
            submission={submission}
            refresh={async () => {
              const next = await load();
              const nextTab = next?.status === "finalized" || next?.status === "rejected_duplicate_repo" ? "archive" : "pending";
              if (nextTab === "archive" && nextPending) nav(`/teacher/submissions/${nextPending.id}?from=pending&group=${sourceGroup}`);
              else nav(sourceGroup ? `/teacher/groups/${sourceGroup}?tab=${nextTab}` : "/teacher");
            }}
          />
        )}
      </Layout>
    </TeacherGuard>
  );
}
function TeacherHome() {
  const teacherNavigate = useNavigate();
  const { groupId: routeGroupId } = useParams();
  const [groups, setGroups] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [students] = useState<any[]>([]),
    [requests] = useState<any[]>([]),
    [labSubmissions, setLabSubmissions] = useState<any[]>([]),
    [quizGradebook, setQuizGradebook] = useState<any>({ students: [], quizzes: [], attempts: [], best: [] }),
    [courseAchievements] = useState<any[]>([]),
    [achievementDraft, setAchievementDraft] = useState({
      title: "",
      description: "",
      emoji: "✦",
      accent_color: "#38BDF8",
    }),
    [awardDraft, setAwardDraft] = useState<Record<string, { student_id: string; reason: string }>>({}),
    [error, setError] = useState(""),
    [teacherView] = useState<"reviews" | "students" | "achievements">("reviews"),
    [reviewTab, setReviewTab] = useState<"pending" | "archive">(new URLSearchParams(location.search).get("tab") === "archive" ? "archive" : "pending"),
    [openedSubmission, setOpenedSubmission] = useState<string | null>(null),
    [reviewQuery, setReviewQuery] = useState(""),
    [reviewStatus, setReviewStatus] = useState("all");
  async function loadGroups() {
    const data = await api("/api/teacher/groups");
    setGroups(data.items);
  }
  async function openGroup(id: string, catalog = groups) {
    setSelected(id);
    const group = catalog.find((item: any) => item.id === id);
    if (!group) throw new Error("Группа не найдена или доступ к ней отозван");
    if (group.kind === "lecture") {
      const gradebook = await api(`/api/teacher/groups/${id}/quiz-gradebook`);
      setQuizGradebook(gradebook);
      setLabSubmissions([]);
    } else {
      const labs = await api(`/api/teacher/groups/${id}/submissions`);
      setLabSubmissions(labs.items);
      setQuizGradebook({ students: [], quizzes: [], attempts: [], best: [] });
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const data = await api("/api/teacher/groups");
        setGroups(data.items);
        if (!routeGroupId) { setSelected(""); setLabSubmissions([]); return; }
        await openGroup(routeGroupId, data.items);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [routeGroupId]);
  async function resolve(id: string, decision: "approved" | "rejected") {
    try {
      await api(`/api/teacher/group-requests/${id}/resolve`, json("POST", { decision }));
      await openGroup(selected);
      await loadGroups();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function resolveDuplicate(id: string, decision: "allow" | "reject") {
    try {
      await api(`/api/teacher/submissions/${id}/duplicate-decision`, json("POST", { decision }));
      await openGroup(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function createCourseAchievement(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/teacher/groups/${selected}/achievements`, json("POST", achievementDraft));
      setAchievementDraft({
        title: "",
        description: "",
        emoji: "✦",
        accent_color: "#38BDF8",
      });
      await openGroup(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function awardCourseAchievement(id: string) {
    const draft = awardDraft[id] ?? { student_id: "", reason: "" };
    try {
      await api(`/api/teacher/groups/${selected}/achievements/${id}/award`, json("POST", draft));
      setAwardDraft({ ...awardDraft, [id]: { student_id: "", reason: "" } });
      await openGroup(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const pending = labSubmissions.filter((s) => s.status !== "finalized" && s.status !== "rejected_duplicate_repo");
  const archive = labSubmissions.filter((s) => s.status === "finalized" || s.status === "rejected_duplicate_repo");
  const visible = (reviewTab === "pending" ? pending : archive)
    .filter((submission) => !reviewQuery || `${submission.fio_display} ${submission.title}`.toLocaleLowerCase("ru").includes(reviewQuery.toLocaleLowerCase("ru")))
    .filter((submission) => reviewStatus === "all" || submission.status === reviewStatus)
    .sort((a, b) => Number(a.submitted_at) - Number(b.submitted_at));
  const opened = visible.find((s) => s.id === openedSubmission);
  const selectedGroup = groups.find((group) => group.id === selected);
  const bestByStudentQuiz = new Map(quizGradebook.best.map((row: any) => [`${row.student_id}:${row.quiz_id}`, row]));
  return (
    <TeacherGuard>
      <Layout teacher>
        <div className="page-head">
          <div>
            <p className="eyebrow">Преподаватель</p>
            <h1>{selected ? groups.find((group) => group.id === selected)?.name ?? "Проверка работ" : "Мои группы"}</h1>
          </div>
          {selected && <button className="secondary" onClick={() => teacherNavigate("/teacher")}>← К группам</button>}
        </div>
        <ErrorBox error={error} />
        {!selected && <div className="teacher-groups">
          {groups.map((g) => (
            <button
              className="secondary"
              key={g.id}
              onClick={() => {
                setOpenedSubmission(null);
                teacherNavigate(`/teacher/groups/${g.id}`);
              }}
            >
              {g.course_run_name} / {g.name}
              <small>{g.member_count} студентов</small>
            </button>
          ))}
        </div>}
        {selected && (
          <>
            {selectedGroup?.kind === "lecture" && (
              <div className="teacher-lecture-workspace">
                <details className="card gradebook-card teacher-collapsible" open>
                  <summary><div><p className="eyebrow">Лекционная группа</p><h2>Табель по квизам</h2><p className="muted">В ячейке показан лучший результат студента.</p></div><span className="status-pill">{quizGradebook.students.length} студентов</span><DetailsChevron /></summary>
                  <div className="gradebook-actions"><a className="button secondary" href={`/api/teacher/groups/${selected}/quiz-gradebook.csv`}>Скачать табель CSV</a></div>
                  {!quizGradebook.quizzes.length ? <div className="empty-state"><strong>Результатов пока нет</strong><span>После прохождения квиза здесь появится табель группы.</span></div> : <div className="table-wrap"><table className="gradebook-table"><thead><tr><th>Студент</th>{quizGradebook.quizzes.map((quiz: any) => <th key={quiz.id}>{quiz.title}</th>)}</tr></thead><tbody>{quizGradebook.students.map((student: any) => <tr key={student.id}><td><strong>{student.fio_display}</strong><small>{student.student_code}</small></td>{quizGradebook.quizzes.map((quiz: any) => { const result: any = bestByStudentQuiz.get(`${student.id}:${quiz.id}`); return <td key={quiz.id}>{result ? <><strong>{result.best_score}/{result.max_score}</strong><small>{(result.best_percent_bp / 100).toFixed(1)}%</small></> : <span className="muted">—</span>}</td>; })}</tr>)}</tbody></table></div>}
                </details>
                <details className="card quiz-results-card teacher-collapsible">
                  <summary><div><p className="eyebrow">Все попытки</p><h2>Результаты тестов</h2><p className="muted">Первая и повторная попытки каждого студента.</p></div><span className="status-pill">{quizGradebook.attempts.length}</span><DetailsChevron /></summary>
                  {!quizGradebook.attempts.length ? <p className="muted">Завершённых попыток пока нет.</p> : <div className="table-wrap"><table><thead><tr><th>Студент</th><th>Квиз</th><th>Попытка</th><th>Результат</th><th>Завершено</th></tr></thead><tbody>{quizGradebook.attempts.map((attempt: any) => <tr key={attempt.id}><td>{attempt.fio_display}</td><td>{attempt.quiz_title}</td><td>{attempt.attempt_no}</td><td><strong>{attempt.score}/{attempt.max_score}</strong><small>{(attempt.percent_bp / 100).toFixed(1)}%</small></td><td>{fmt(attempt.finalized_at)}</td></tr>)}</tbody></table></div>}
                </details>
              </div>
            )}
            {selectedGroup?.kind === "practice" && (<>
            {teacherView === "students" && (
            <div className="admin-access-grid">
              <section className="card">
                <h2>Студенты</h2>
                {students.map((s) => (
                  <div className="access-item" key={s.id}>
                    <strong>{s.fio_display}</strong>
                  </div>
                ))}
                {!students.length && <p className="muted">Группа пуста.</p>}
              </section>
              <section className="card">
                <h2>Заявки</h2>
                {requests
                  .filter((r) => r.status === "pending")
                  .map((r) => (
                    <div className="request-row" key={r.id}>
                      <strong>{r.fio_display}</strong>
                      <div className="actions compact">
                        <button onClick={() => void resolve(r.id, "approved")}>Одобрить</button>
                        <button className="secondary" onClick={() => void resolve(r.id, "rejected")}>
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                {!requests.some((r) => r.status === "pending") && <p className="muted">Новых заявок нет.</p>}
              </section>
            </div>
            )}
            {teacherView === "achievements" && (
            <section className="card course-achievements">
              <p className="eyebrow">Награды курса</p>
              <h2>Общие достижения</h2>
              <p className="muted">Не привязаны к конкретной лабораторной. Создайте достижение один раз и выдавайте студентам курса.</p>
              <form className="achievement-create-form" onSubmit={createCourseAchievement}>
                <div className="grid two">
                  <label>
                    Название
                    <input
                      value={achievementDraft.title}
                      onChange={(e) =>
                        setAchievementDraft({
                          ...achievementDraft,
                          title: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    Значок
                    <input
                      value={achievementDraft.emoji}
                      onChange={(e) =>
                        setAchievementDraft({
                          ...achievementDraft,
                          emoji: e.target.value,
                        })
                      }
                      maxLength={16}
                    />
                  </label>
                  <label>
                    Описание
                    <textarea
                      value={achievementDraft.description}
                      onChange={(e) =>
                        setAchievementDraft({
                          ...achievementDraft,
                          description: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    Цвет
                    <input
                      type="color"
                      value={achievementDraft.accent_color}
                      onChange={(e) =>
                        setAchievementDraft({
                          ...achievementDraft,
                          accent_color: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <button>Создать достижение</button>
              </form>
              <div className="course-achievement-list">
                {courseAchievements.map((a) => {
                  const draft = awardDraft[a.id] ?? {
                    student_id: "",
                    reason: "",
                  };
                  return (
                    <article className="course-achievement-card" style={{ "--badge-accent": a.accent_color } as CSSProperties} key={a.id}>
                      <div className="course-achievement-icon">{a.emoji}</div>
                      <div>
                        <h3>{a.title}</h3>
                        <p>{a.description}</p>
                        <small>Выдана студентам: {a.award_count}</small>
                      </div>
                      <div className="award-form">
                        <select
                          value={draft.student_id}
                          onChange={(e) =>
                            setAwardDraft({
                              ...awardDraft,
                              [a.id]: { ...draft, student_id: e.target.value },
                            })
                          }
                        >
                          <option value="">Выберите студента</option>
                          {students.map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.fio_display}
                            </option>
                          ))}
                        </select>
                        <input
                          placeholder="За что выдаётся"
                          value={draft.reason}
                          onChange={(e) =>
                            setAwardDraft({
                              ...awardDraft,
                              [a.id]: { ...draft, reason: e.target.value },
                            })
                          }
                        />
                        <button type="button" disabled={!draft.student_id || draft.reason.trim().length < 3} onClick={() => void awardCourseAchievement(a.id)}>
                          Выдать
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            )}
            {teacherView === "reviews" && (
            <section className="card review-workspace">
              <div className="section-heading">
                <h2>Проверка лабораторных</h2>
                <div className="review-tabs">
                  <button
                    className={reviewTab === "pending" ? "active" : "secondary"}
                    onClick={() => {
                      setReviewTab("pending");
                      setOpenedSubmission(null);
                    }}
                  >
                    Запросы на проверку <b>{pending.length}</b>
                  </button>
                  <button
                    className={reviewTab === "archive" ? "active" : "secondary"}
                    onClick={() => {
                      setReviewTab("archive");
                      setOpenedSubmission(null);
                    }}
                  >
                    Проверенные <b>{archive.length}</b>
                  </button>
                </div>
              </div>
              <div className="list-filters"><label>Поиск<input value={reviewQuery} onChange={(e) => setReviewQuery(e.target.value)} placeholder="Студент или лабораторная" /></label><label>Статус<select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}><option value="all">Все</option><option value="awaiting_teacher_review">Ожидает проверки</option><option value="awaiting_clarification">Ожидает ответа</option><option value="manual_defense">Ручная защита</option><option value="blocked_duplicate_repo">Совпавший репозиторий</option><option value="finalized">Проверено</option></select></label></div>
              {opened ? (
                <>
                  <button className="link back-link" onClick={() => setOpenedSubmission(null)}>
                    ← К списку отправок
                  </button>
                  <TeacherSubmissionReview
                    submission={opened}
                    refresh={async () => {
                      await openGroup(selected);
                      setOpenedSubmission(null);
                    }}
                  />
                </>
              ) : (
                <div className="submission-list">
                  {visible.map((s) =>
                    s.status === "blocked_duplicate_repo" ? (
                      <div className="submission-list-card" key={s.id}>
                        <div>
                          <strong>
                            {s.fio_display} · {s.title}
                          </strong>
                          <small>Попытка {s.attempt_number} · совпадающий репозиторий</small>
                        </div>
                        <div className="actions compact">
                          <button onClick={() => void resolveDuplicate(s.id, "allow")}>Разрешить проверку</button>
                          <button className="secondary" onClick={() => void resolveDuplicate(s.id, "reject")}>
                            Отклонить
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Link className="submission-list-card" key={s.id} to={`/teacher/submissions/${s.id}?from=${reviewTab}&group=${selected}`}>
                        <span>
                          <strong>
                            {s.fio_display} · {s.title}
                          </strong>
                          <small>
                            Попытка {s.attempt_number} · {fmt(s.submitted_at)}
                          </small>
                        </span>
                        <span className="status-pill">{submissionLabels[s.status] ?? s.status}</span>
                      </Link>
                    ),
                  )}
                  {!visible.length && <p className="muted">В этом разделе пока нет отправок.</p>}
                </div>
              )}
            </section>
            )}
            </>)}
          </>
        )}
      </Layout>
    </TeacherGuard>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/register" element={<Register />} />
      <Route path="/profile" element={<StudentProfile />} />
      <Route path="/profile/:section" element={<StudentProfile />} />
      <Route path="/profile/labs/:labId" element={<StudentProfile />} />
      <Route path="/profile/submissions/:submissionId" element={<StudentSubmissionPage />} />
      <Route path="/p/:token" element={<PublicProfile />} />
      <Route path="/q/:slug" element={<QuizPage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminHome />} />
      <Route path="/admin/quizzes/:id" element={<QuizAdmin />} />
      <Route path="/admin/assignments" element={<AdminAssignments />} />
      <Route path="/admin/assignments/:id" element={<AssignmentAdmin />} />
      <Route path="/admin/quizzes/:id/analytics" element={<Analytics />} />
      <Route path="/admin/results" element={<Results />} />
      <Route path="/admin/students" element={<Students />} />
      <Route path="/admin/students/:id" element={<StudentHistory />} />
      <Route path="/admin/platform-achievements" element={<PlatformAchievements />} />
      <Route path="/admin/access" element={<AdminAccess />} />
      <Route path="/teacher/login" element={<TeacherLogin />} />
      <Route path="/teacher" element={<TeacherHome />} />
      <Route path="/teacher/groups/:groupId" element={<TeacherHome />} />
      <Route path="/teacher/submissions/:id" element={<TeacherSubmissionPage />} />
      <Route
        path="*"
        element={
          <Layout>
            <section className="card">
              <h1>Страница не найдена</h1>
            </section>
          </Layout>
        }
      />
    </Routes>
  );
}
