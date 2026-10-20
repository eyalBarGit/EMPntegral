import { afterAll, beforeAll, beforeEach, inject } from "vitest";

// Assigned at the top level so that every value is in place before the test
// file (and therefore src/config.js) is imported.
process.env.NODE_ENV = "test";
process.env.META_APP_SECRET = "test-app-secret";
// Set explicitly, and to a different value, for two reasons: the two channels
// really are signed with different secrets, and dotenv fills anything left unset
// from the developer's own .env, which would make the suite pass or fail
// depending on whose machine it runs on.
process.env.INSTAGRAM_APP_SECRET = "test-ig-app-secret";
process.env.WEBHOOK_VERIFY_TOKEN = "test-verify-token";
process.env.SESSION_SECRET = "test-session-secret";
process.env.DASHBOARD_PASSWORD = "test-password";
process.env.TIMEZONE = "Asia/Jerusalem";
process.env.DEFAULT_COUNTRY_CODE = "972";
process.env.AUTOMATION_ENABLED = "true";

// The WhatsApp gate stays shut in tests, mirroring production until a number
// is deliberately connected.
process.env.WHATSAPP_ENABLED = "false";

process.env.INSTAGRAM_LOGIN_MODE = "instagram_login";
process.env.INSTAGRAM_ACCESS_TOKEN = "test-ig-token";
process.env.INSTAGRAM_ACCOUNT_ID = "17841400000000000";

const uri = inject("mongoUri") ?? process.env.MONGODB_URI;
if (uri) process.env.MONGODB_URI = uri;

// Each test file gets its own database name so the files cannot collide even
// when vitest runs them in parallel against the shared server.
process.env.MONGODB_DB = `empntegral_test_${process.pid}`;

// src/db is imported lazily: a static import would be evaluated before the
// assignments above had a chance to run.
const db = async () => import("../src/db/index.js");

beforeAll(async () => {
  const { connect } = await db();
  await connect();
});

beforeEach(async () => {
  const { clearAllCollections } = await db();
  await clearAllCollections();
});

afterAll(async () => {
  const { getDb, disconnect } = await db();
  await getDb().dropDatabase();
  await disconnect();
});
