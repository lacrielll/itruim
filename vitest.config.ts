import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest(async()=>({
    wrangler:{configPath:"./wrangler.jsonc"},
    miniflare:{r2Buckets:["MEDIA"],bindings:{
      TEST_MIGRATIONS:await readD1Migrations(path.join(import.meta.dirname,"migrations")),
      ADMIN_USERNAME:"admin",
      ADMIN_PASSWORD_HASH:"pbkdf2-sha256$100000$6BR73guXBK7v4zcAy2eQRA==$ljsIByjTpRODbg7A6t2bmdyoBI07YabaPtXP1EizH14=",
      CSRF_SECRET:"test-csrf-secret-at-least-thirty-two-bytes",
      RATE_LIMIT_PEPPER:"test-rate-secret-at-least-thirty-two-bytes"
    }}
  }))],
  test:{setupFiles:["./tests/apply-migrations.ts"],sequence:{concurrent:false}}
});
