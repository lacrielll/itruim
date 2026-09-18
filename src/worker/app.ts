import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { authRoutes } from "./auth";
import { quizRoutes } from "./quizzes";
import { attemptRoutes } from "./attempts";
import { resultRoutes } from "./results";
import { mediaRoutes } from "./media";
import { profileRoutes } from "./profiles";
import { groupRoutes } from "./groups";
import { assignmentRoutes } from "./assignments";
import { notificationRoutes } from "./notifications";
import { jsonError, uuid } from "./lib";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.use("*", async (c, next) => {
  c.set("requestId", uuid());
  await next();
  c.header("X-Request-Id", c.get("requestId"));
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  if (new URL(c.req.url).protocol === "https:")
    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
});
app.get("/api/health", (c) =>
  c.json({ ok: true, time: Math.floor(Date.now() / 1000) }),
);
app.route("/api", authRoutes);
app.route("/api", quizRoutes);
app.route("/api", attemptRoutes);
app.route("/api", resultRoutes);
app.route("/api", mediaRoutes);
app.route("/api", profileRoutes);
app.route("/api", groupRoutes);
app.route("/api", assignmentRoutes);
app.route("/api", notificationRoutes);
app.route("/", mediaRoutes);
app.notFound((c) =>
  c.req.path.startsWith("/api/") || c.req.path.startsWith("/media/")
    ? c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Маршрут не найден",
            request_id: c.get("requestId"),
          },
        },
        404,
      )
    : c.text("Not found", 404),
);
app.onError((error, c) => jsonError(c, error));
