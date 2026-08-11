import { db } from "../index.js";
import { eq, gte, lt, and, desc, or, sql } from "drizzle-orm";
import { logs } from "../schemas/schema.js";
import { log } from "../../../utils/validators/logsValidators.js";
import { decodeCursor } from "../../../utils/cursorLogUtils.js";

export async function storeLogs(validLogs: log[]) {
  await db.insert(logs).values(validLogs);
}

export async function queryLogs(filters: any) {
  const conditions = [];

  if (filters.service !== undefined) {
    conditions.push(eq(logs.service, filters.service));
  }

  if (filters.level !== undefined) {
    conditions.push(eq(logs.level, filters.level));
  }

  if (filters.since !== undefined) {
    conditions.push(gte(logs.timestamp, new Date(filters.since)));
  }

  if (filters.until !== undefined) {
    conditions.push(lt(logs.timestamp, new Date(filters.until)));
  }

  if (filters.cursor !== undefined) {
    const cursor = filters.cursor;

    conditions.push(
      or(
        lt(logs.timestamp, new Date(cursor.timestamp)),
        and(
          eq(logs.timestamp, new Date(cursor.timestamp)),
          lt(logs.id, cursor.id),
        ),
      ),
    );
  }

  if (filters.attributes !== undefined) {
    for (const [key, value] of Object.entries(filters.attributes)) {
      conditions.push(sql`${logs.attributes}->>${key} = ${value}`);
    }
  }

  if (filters.q !== undefined) {
    conditions.push(sql`${logs.message} ILIKE ${`%${filters.q}%`}`);
  }

  let res = await db
    .select()
    .from(logs)
    .where(and(...conditions))
    .orderBy(desc(logs.timestamp), desc(logs.id))
    .limit(filters.limit + 1);

  return res;
}
