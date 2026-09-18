import { createInterface } from "node:readline/promises";
import { randomBytes, pbkdf2 as pbkdf2Callback } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Callback);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Admin password: ");
rl.close();
if (password.length < 12) throw new Error("Use at least 12 characters");
// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
const iterations = 100_000; const salt = randomBytes(16);
const hash = await pbkdf2(password, salt, iterations, 32, "sha256");
process.stdout.write(`pbkdf2-sha256$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}\n`);
