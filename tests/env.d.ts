declare module "cloudflare:workers" {
  interface ProvidedEnv extends import("../src/worker/env").Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}

