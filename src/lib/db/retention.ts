import { db } from "./index.js";
import { sql } from "drizzle-orm";
import envs from "../../envs/envs.js";

export async function initRetention() {
  const cutoff = new Date(Date.now() - turnDaysToMs(envs.retentionDays));

  let deletedLogs = 0;
  while (true) {
    const result = await db.execute(sql`
      DELETE FROM logs
      WHERE id IN (
        SELECT id
        FROM logs
        WHERE "timestamp" < ${cutoff}
        ORDER BY "timestamp", id
        LIMIT ${envs.retentionBatchMaxSize}
      )
    `);

    const deleted = Number(result.rowCount ?? 0);
    if (deleted < envs.retentionBatchMaxSize) {
      break;
    }

    deletedLogs += deleted;
  }

  console.log(
    `Retention completed: deleted ${deletedLogs} logs older than ${cutoff.toISOString()}`,
  );
}

function turnDaysToMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}
