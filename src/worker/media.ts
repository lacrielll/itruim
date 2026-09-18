import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { requireAdmin } from "./auth";
import { ApiError, now, sha256, uuid, verifyCsrf } from "./lib";
import { mediaStorage, type MediaStorage } from "./media-storage";

type AppEnv = { Bindings: Bindings; Variables: Variables };
export const mediaRoutes = new Hono<AppEnv>();
const allowed = new Map([
  [
    "image/png",
    { ext: "png", sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  ["image/jpeg", { ext: "jpg", sig: [0xff, 0xd8, 0xff] }],
  ["image/webp", { ext: "webp", sig: [0x52, 0x49, 0x46, 0x46] }],
]);
function validSignature(type: string, data: Uint8Array) {
  const item = allowed.get(type);
  if (!item || !item.sig.every((v, i) => data[i] === v)) return false;
  if (
    type === "image/webp" &&
    new TextDecoder().decode(data.slice(8, 12)) !== "WEBP"
  )
    return false;
  return true;
}

mediaRoutes.post("/admin/media", async (c) => {
  const session = await requireAdmin(c);
  await verifyCsrf(c, session);
  const idem = c.req.header("Idempotency-Key");
  if (!idem || idem.length < 16 || idem.length > 200)
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Требуется Idempotency-Key",
    );
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    throw new ApiError(400, "FILE_REQUIRED", "Выберите изображение");
  if (file.size <= 0 || file.size > 5 * 1024 * 1024)
    throw new ApiError(413, "FILE_TOO_LARGE", "Максимальный размер — 5 МБ");
  const info = allowed.get(file.type);
  if (!info)
    throw new ApiError(415, "MEDIA_TYPE_INVALID", "Разрешены PNG, JPEG и WebP");
  const bytes = await file.arrayBuffer();
  if (!validSignature(file.type, new Uint8Array(bytes)))
    throw new ApiError(
      415,
      "MEDIA_SIGNATURE_INVALID",
      "Содержимое файла не соответствует формату",
    );
  const digest = await sha256(bytes),
    idemHash = await sha256(idem),
    requestHash = await sha256(`${file.type}:${file.size}:${digest}`);
  const proposed = `achievement/${uuid()}.${info.ext}`;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO idempotency_records(scope,actor_id,key_hash,request_hash,resource_type,resource_id,created_at,expires_at) VALUES('media',?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
    ).bind(
      session.id,
      idemHash,
      requestHash,
      "media",
      proposed,
      timestamp,
      timestamp + 7 * 86400,
    ),
    c.env.DB.prepare(
      "INSERT INTO media_objects(key,status,content_type,byte_size,sha256,created_by_admin_session_id,created_at) SELECT ?,'PENDING',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM idempotency_records WHERE scope='media' AND actor_id=? AND key_hash=? AND request_hash=? AND resource_id=?) ON CONFLICT DO NOTHING",
    ).bind(
      proposed,
      file.type,
      file.size,
      digest,
      session.id,
      timestamp,
      session.id,
      idemHash,
      requestHash,
      proposed,
    ),
  ]);
  const record = await c.env.DB.prepare(
    "SELECT request_hash,resource_id FROM idempotency_records WHERE scope='media' AND actor_id=? AND key_hash=?",
  )
    .bind(session.id, idemHash)
    .first<{ request_hash: string; resource_id: string }>();
  if (!record || record.request_hash !== requestHash)
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Этот Idempotency-Key уже использован с другим файлом",
    );
  const key = record.resource_id;
  const media = await c.env.DB.prepare(
    "SELECT status,content_type,byte_size FROM media_objects WHERE key=?",
  )
    .bind(key)
    .first<any>();
  if (media?.status === "READY")
    return c.json({
      key,
      url: `/media/${key}`,
      content_type: media.content_type,
      byte_size: media.byte_size,
    });
  try {
    await mediaStorage(c.env).put(key, bytes, {
      contentType: file.type,
      sha256: digest,
    });
    await c.env.DB.prepare(
      "UPDATE media_objects SET status='READY',ready_at=? WHERE key=? AND status='PENDING'",
    )
      .bind(now(), key)
      .run();
  } catch (e) {
    console.error("media_upload_failed", key, String(e));
    throw new ApiError(
      503,
      "MEDIA_UPLOAD_FAILED",
      "Не удалось сохранить изображение",
    );
  }
  return c.json(
    {
      key,
      url: `/media/${key}`,
      content_type: file.type,
      byte_size: file.size,
    },
    201,
  );
});

mediaRoutes.get("/media/*", async (c) => {
  const key = c.req.path.slice("/media/".length);
  const row = await c.env.DB.prepare(
    "SELECT m.*,(EXISTS(SELECT 1 FROM achievement_rules ar JOIN quiz_versions v ON v.id=ar.quiz_version_id WHERE ar.image_key=m.key AND v.status='PUBLISHED') OR EXISTS(SELECT 1 FROM double_failure_rules dfr JOIN quiz_versions v ON v.id=dfr.quiz_version_id WHERE dfr.image_key=m.key AND v.status='PUBLISHED') OR EXISTS(SELECT 1 FROM retry_success_rules rsr JOIN quiz_versions v ON v.id=rsr.quiz_version_id WHERE rsr.image_key=m.key AND v.status='PUBLISHED') OR EXISTS(SELECT 1 FROM assignment_versions av,json_each(av.achievement_definitions_json) d WHERE av.status='PUBLISHED' AND json_extract(d.value,'$.image_key')=m.key) OR EXISTS(SELECT 1 FROM course_achievements ca WHERE ca.image_key=m.key)) published FROM media_objects m WHERE m.key=? AND m.status='READY'",
  )
    .bind(key)
    .first<any>();
  if (!row)
    throw new ApiError(404, "MEDIA_NOT_FOUND", "Изображение не найдено");
  if (!row.published && !(await requireAdmin(c).catch(() => null)))
    throw new ApiError(404, "MEDIA_NOT_FOUND", "Изображение не найдено");
  const object = await mediaStorage(c.env).get(key);
  if (!object)
    throw new ApiError(404, "MEDIA_NOT_FOUND", "Изображение не найдено");
  const headers = new Headers();
  headers.set("Content-Type", row.content_type);
  headers.set("Content-Length", String(row.byte_size));
  if (object.etag) headers.set("ETag", object.etag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Disposition",
    `inline; filename="achievement.${row.content_type.split("/")[1]}"`,
  );
  headers.set(
    "Cache-Control",
    row.published ? "public, max-age=31536000, immutable" : "private, no-store",
  );
  return new Response(object.body, { headers });
});

export async function cleanupMedia(db: D1Database, storage: MediaStorage) {
  const cutoff = now() - 86400;
  const pending = await db
    .prepare(
      "SELECT key FROM media_objects WHERE status='PENDING' AND created_at<? LIMIT 50",
    )
    .bind(cutoff)
    .all<{ key: string }>();
  for (const row of pending.results) {
    await storage.delete(row.key);
    await db
      .prepare("DELETE FROM media_objects WHERE key=? AND status='PENDING'")
      .bind(row.key)
      .run();
  }
  const orphan = await db
    .prepare(
      "SELECT key FROM media_objects m WHERE status='READY' AND created_at<? AND NOT EXISTS(SELECT 1 FROM achievement_rules WHERE image_key=m.key) AND NOT EXISTS(SELECT 1 FROM double_failure_rules WHERE image_key=m.key) AND NOT EXISTS(SELECT 1 FROM retry_success_rules WHERE image_key=m.key) AND NOT EXISTS(SELECT 1 FROM assignment_versions av,json_each(av.achievement_definitions_json) d WHERE json_extract(d.value,'$.image_key')=m.key) AND NOT EXISTS(SELECT 1 FROM course_achievements ca WHERE ca.image_key=m.key) LIMIT 50",
    )
    .bind(cutoff - 6 * 86400)
    .all<{ key: string }>();
  for (const row of orphan.results) {
    const check = await db
      .prepare(
        "SELECT 1 FROM achievement_rules WHERE image_key=? UNION ALL SELECT 1 FROM double_failure_rules WHERE image_key=? UNION ALL SELECT 1 FROM retry_success_rules WHERE image_key=? UNION ALL SELECT 1 FROM assignment_versions av,json_each(av.achievement_definitions_json) d WHERE json_extract(d.value,'$.image_key')=? UNION ALL SELECT 1 FROM course_achievements WHERE image_key=? LIMIT 1",
      )
      .bind(row.key, row.key, row.key, row.key, row.key)
      .first();
    if (!check) {
      await storage.delete(row.key);
      await db
        .prepare(
          "DELETE FROM media_objects WHERE key=? AND NOT EXISTS(SELECT 1 FROM achievement_rules WHERE image_key=?) AND NOT EXISTS(SELECT 1 FROM double_failure_rules WHERE image_key=?) AND NOT EXISTS(SELECT 1 FROM retry_success_rules WHERE image_key=?) AND NOT EXISTS(SELECT 1 FROM assignment_versions av,json_each(av.achievement_definitions_json) d WHERE json_extract(d.value,'$.image_key')=?) AND NOT EXISTS(SELECT 1 FROM course_achievements WHERE image_key=?)",
        )
        .bind(row.key, row.key, row.key, row.key, row.key, row.key)
        .run();
    }
  }
}
