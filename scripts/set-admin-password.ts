import { pbkdf2 as pbkdf2Callback, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Callback);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("New admin password: ");
const confirmation = await rl.question("Repeat admin password: ");
rl.close();

if (password.length < 12) throw new Error("Use at least 12 characters");
if (password !== confirmation) throw new Error("Passwords do not match");

// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
const iterations = 100_000;
const salt = randomBytes(16);
const hash = await pbkdf2(password, salt, iterations, 32, "sha256");
const encoded = `pbkdf2-sha256$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`;
const result = spawnSync(
  "npx",
  ["wrangler", "secret", "put", "ADMIN_PASSWORD_HASH"],
  { input: `${encoded}\n`, stdio: ["pipe", "inherit", "inherit"] },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Wrangler exited with status ${result.status ?? "unknown"}`);

process.stdout.write("Admin password hash was generated and uploaded.\n");
