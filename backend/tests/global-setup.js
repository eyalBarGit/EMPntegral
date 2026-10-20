import { MongoMemoryServer } from "mongodb-memory-server";

let server;

/**
 * Starts one throwaway MongoDB for the whole run. Tests must never touch the
 * real Atlas cluster, so the URI is injected here rather than read from .env.
 */
export async function setup({ provide }) {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();

  process.env.MONGODB_URI = uri;
  provide("mongoUri", uri);
}

export async function teardown() {
  await server?.stop();
}
