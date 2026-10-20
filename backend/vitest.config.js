import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    globalSetup: ["tests/global-setup.js"],
    setupFiles: ["tests/setup.js"],
    // Each file gets its own process so the mocked channel modules and the
    // per-file database never leak between suites.
    isolate: true,
    pool: "forks",
    // Downloading the mongod binary on a cold cache can take a while.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
