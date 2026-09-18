import type { Bindings } from "./env";

export type StoredMedia = {
  body: ReadableStream<Uint8Array> | null;
  etag: string | null;
};

export interface MediaStorage {
  put(
    key: string,
    body: ArrayBuffer,
    metadata: { contentType: string; sha256: string },
  ): Promise<void>;
  get(key: string): Promise<StoredMedia | null>;
  delete(key: string): Promise<void>;
}

const encoder = new TextEncoder();
const emptySha256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(key: ArrayBuffer, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

async function sha256Hex(value: string | ArrayBuffer) {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string"
        ? (encoder.encode(value).buffer as ArrayBuffer)
        : value,
    ),
  );
}

function objectPath(bucket: string, key: string) {
  return `/${encodeURIComponent(bucket)}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export type B2Config = {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
};

export class B2MediaStorage implements MediaStorage {
  private readonly endpoint: URL;

  constructor(private readonly config: B2Config) {
    const configuredEndpoint = config.endpoint.trim();
    this.endpoint = new URL(
      /^https?:\/\//i.test(configuredEndpoint)
        ? configuredEndpoint
        : `https://${configuredEndpoint}`,
    );
    if (this.endpoint.protocol !== "https:")
      throw new Error("B2_ENDPOINT must use HTTPS");
    if (this.endpoint.pathname !== "/" || this.endpoint.search)
      throw new Error("B2_ENDPOINT must not contain a path or query");
  }

  private async request(
    method: "GET" | "PUT" | "DELETE",
    key: string,
    body?: ArrayBuffer,
    extraHeaders: Record<string, string> = {},
  ) {
    const instant = new Date();
    const amzDate = instant.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = body ? await sha256Hex(body) : emptySha256;
    const path = objectPath(this.config.bucket, key);
    const headers: Record<string, string> = {
      host: this.endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };
    const headerNames = Object.keys(headers).sort();
    const canonicalHeaders = headerNames
      .map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, " ")}\n`)
      .join("");
    const signedHeaders = headerNames.join(";");
    const canonicalRequest = [
      method,
      path,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${shortDate}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await sha256Hex(canonicalRequest),
    ].join("\n");
    const dateKey = await hmac(
      encoder.encode(`AWS4${this.config.applicationKey}`).buffer as ArrayBuffer,
      shortDate,
    );
    const regionKey = await hmac(dateKey, this.config.region);
    const serviceKey = await hmac(regionKey, "s3");
    const signingKey = await hmac(serviceKey, "aws4_request");
    const signature = hex(await hmac(signingKey, stringToSign));
    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.config.keyId.trim()}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return fetch(new URL(path, this.endpoint), {
      method,
      headers,
      body: body ?? undefined,
    });
  }

  async put(
    key: string,
    body: ArrayBuffer,
    metadata: { contentType: string; sha256: string },
  ) {
    const response = await this.request("PUT", key, body, {
      "content-type": metadata.contentType,
      "x-amz-meta-sha256": metadata.sha256,
    });
    if (!response.ok)
      throw new Error(
        `B2 PUT failed with status ${response.status}: ${(
          await response.text()
        ).slice(0, 1200)}`,
      );
  }

  async get(key: string): Promise<StoredMedia | null> {
    const response = await this.request("GET", key);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `B2 GET failed with status ${response.status}: ${(
          await response.text()
        ).slice(0, 1200)}`,
      );
    return { body: response.body, etag: response.headers.get("etag") };
  }

  async delete(key: string) {
    const response = await this.request("DELETE", key);
    if (!response.ok && response.status !== 404)
      throw new Error(
        `B2 DELETE failed with status ${response.status}: ${(
          await response.text()
        ).slice(0, 1200)}`,
      );
  }
}

class R2TestMediaStorage implements MediaStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async put(
    key: string,
    body: ArrayBuffer,
    metadata: { contentType: string; sha256: string },
  ) {
    await this.bucket.put(key, body, {
      httpMetadata: { contentType: metadata.contentType },
      customMetadata: { sha256: metadata.sha256 },
    });
  }

  async get(key: string): Promise<StoredMedia | null> {
    const object = await this.bucket.get(key);
    return object ? { body: object.body, etag: object.httpEtag } : null;
  }

  async delete(key: string) {
    await this.bucket.delete(key);
  }
}

export function mediaStorage(env: Bindings): MediaStorage {
  if (
    env.B2_ENDPOINT &&
    env.B2_REGION &&
    env.B2_BUCKET &&
    env.B2_KEY_ID &&
    env.B2_APPLICATION_KEY
  )
    return new B2MediaStorage({
      endpoint: env.B2_ENDPOINT,
      region: env.B2_REGION,
      bucket: env.B2_BUCKET,
      keyId: env.B2_KEY_ID,
      applicationKey: env.B2_APPLICATION_KEY,
    });
  if (env.MEDIA) return new R2TestMediaStorage(env.MEDIA);
  throw new Error("Backblaze B2 media storage is not configured");
}
