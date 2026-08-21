import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { logs_1m } from "../schemas/schema.js";

export async function insertAgg1mLogs(aggRows: any[]) {
  try {
    await db
      .insert(logs_1m)
      .values(aggRows)
      .onConflictDoUpdate({
        target: [logs_1m.bucket_start, logs_1m.service, logs_1m.level],
        set: {
          log_count: sql`${logs_1m.log_count} + EXCLUDED.log_count`,
        },
      });
  } catch (error) {
    console.log(`Cannot insert agg logs due to: ${error}`);
  }
}
