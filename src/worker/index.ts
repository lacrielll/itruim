import { app } from "./app";
import type { Bindings } from "./env";
import { expireOverdue } from "./attempts";
import { cleanupMedia } from "./media";
import { mediaStorage } from "./media-storage";
import { now } from "./lib";
import { deliverNotificationOutbox } from "./notifications";

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        const expired = await expireOverdue(env.DB, 100);
        await cleanupMedia(env.DB, mediaStorage(env));
        const notifications = await deliverNotificationOutbox(env);
        const cutoff = now() - 8 * 86400;
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM admin_sessions WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)",
          ).bind(cutoff, cutoff),
          env.DB.prepare(
            "DELETE FROM student_sessions WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)",
          ).bind(cutoff, cutoff),
          env.DB.prepare(
            "DELETE FROM idempotency_records WHERE expires_at<?",
          ).bind(now()),
          env.DB.prepare(
            "DELETE FROM rate_limit_buckets WHERE updated_at<?",
          ).bind(now() - 2 * 86400),
        ]);
        console.log(JSON.stringify({ job: "maintenance", expired, notifications }));
      })(),
    );
  },
} satisfies ExportedHandler<Bindings>;
