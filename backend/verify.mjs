import dns from "node:dns";
import "dotenv/config";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

dns.setServers(
  (process.env.DNS_SERVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

const { connect, disconnect, getDb, leads, messages, processedEvents } = await import(
  "./src/db/index.js"
);
const leadsRepo = await import("./src/db/leads.js");

await connect();

// --- is this really Atlas, and which one? ---------------------------------
const hello = await getDb().admin().command({ hello: 1 });
check("connected to a replica set", Boolean(hello.setName), `setName=${hello.setName}`);
check("has a primary", Boolean(hello.primary), hello.primary ?? "");
check(
  "target database name",
  getDb().databaseName === process.env.MONGODB_DB,
  getDb().databaseName,
);

const build = await getDb().admin().command({ buildInfo: 1 });
check("server version reported", Boolean(build.version), `MongoDB ${build.version}`);

// --- were the indexes actually created? ----------------------------------
const leadIndexes = (await leads().indexes()).map((i) => i.name);
check(
  "unique partial index on ig_id",
  leadIndexes.includes("uniq_ig_id"),
  leadIndexes.join(", "),
);
check("unique partial index on phone", leadIndexes.includes("uniq_phone"));

const msgIndexes = (await messages().indexes()).map((i) => i.name);
check("unique index on external_id", msgIndexes.includes("uniq_external_id"));

const ttl = (await processedEvents().indexes()).find((i) => i.name === "ttl_created_at");
check("TTL index on processed_events", Boolean(ttl), `expireAfterSeconds=${ttl?.expireAfterSeconds}`);

// --- can we actually read and write? -------------------------------------
const probeIg = `__verify_${Date.now()}`;
const { lead, created } = await leadsRepo.getOrCreateByIgId({ igId: probeIg, source: "verify" });
check("write: lead created", created && typeof lead.id === "number", `id=${lead.id}`);

const readBack = await leadsRepo.findByIgId(probeIg);
check("read: lead found again", readBack?.id === lead.id);

const again = await leadsRepo.getOrCreateByIgId({ igId: probeIg, source: "verify" });
check("duplicate protection: no second lead", !again.created && again.lead.id === lead.id);

const phone = `+97250${String(Date.now()).slice(-7)}`;
const withPhone = await leadsRepo.attachPhone(lead.id, phone);
check("write: phone attached", withPhone?.phone === phone, phone);

const second = await leadsRepo.getOrCreateByIgId({ igId: `${probeIg}_b`, source: "verify" });
const rejected = await leadsRepo.attachPhone(second.lead.id, phone);
check("unique phone index rejects a duplicate", rejected === null);

// --- clean up after ourselves --------------------------------------------
const removed = await leads().deleteMany({ source: "verify" });
check("cleanup removed the probe leads", removed.deletedCount === 2, `deleted=${removed.deletedCount}`);

await disconnect();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
