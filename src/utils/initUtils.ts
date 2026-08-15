import { db } from "../lib/db/index.js";
import { sql } from "drizzle-orm";

export let isServiceReady = false;

export async function initService() {
  try {
    await checkDbConn();
    isServiceReady = true;
  } catch (error) {
    console.log(`Service not ready due to following errors:\n\t${error}`);
  }
}

async function checkDbConn() {
  await db.execute(sql`SELECT 1`);
}

export function turnHrsToMs(hours: number) {
  return hours * 60 * 60 * 1000;
}
