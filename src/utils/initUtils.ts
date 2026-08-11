import { sql } from "drizzle-orm";
import { db } from "../lib/db/index.js";

export let isServiceReady = false;

export async function initService() {
  try {
    await checkDbConn();
    await runMigs();
    await verifyDb();

    isServiceReady = true;
  } catch (error) {
    console.log(`Service not ready due to following errors:\n\t${error}`);
  }
}

async function checkDbConn() {
  await db.execute(sql`SELECT 1`);
}

async function runMigs() {}

async function verifyDb() {}
