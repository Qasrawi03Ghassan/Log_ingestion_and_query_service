import { db } from "../index.js";
import { eq, gte, lt, and, desc, or, sql } from "drizzle-orm";
import { logs } from "../schemas/schema.js";
import { log } from "../../../utils/validators/logsValidators.js";
import { LogCursor } from "../../../utils/cursorLogUtils.js";

type QueryFilter = {
  service?: string | undefined;
  level?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  attributes?: Record<string, string>;
  q?: string | undefined;
  limit: number;
  cursor?: LogCursor | undefined;
};

export type AggregateFilter = {
  service?: string | undefined;
  level?: string | undefined;
  attributes?: Record<string, string>;
  q?: string | undefined;
  since: string;
  until: string;
  bucket: string;
  group_by?: string | undefined;
};

export async function storeLogs(
  timestamps: Date[],
  services: string[],
  levels: string[],
  messages: string[],
  attributes: (JSON | undefined)[],
  //validLogs: log[],
) {
  await db.execute(sql`
  INSERT INTO logs ("timestamp", level, service, message, attributes)
  SELECT *
  FROM unnest(
    ${timestamps},
    ${levels},
    ${services},
    ${messages},
    ${attributes}::jsonb[]
  ) AS t("timestamp", level, service, message, attributes)
`);
  //await db.insert(logs).values(validLogs);
}

export async function queryLogs(filters: QueryFilter) {
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

export async function aggregateLogs(filters: AggregateFilter) {
  const conditions = [];
  const bucketIntervals = {
    "1m": sql`INTERVAL '1 minute'`,
    "5m": sql`INTERVAL '5 minutes'`,
    "1h": sql`INTERVAL '1 hour'`,
    "1d": sql`INTERVAL '1 day'`,
  };

  const interval =
    bucketIntervals[filters.bucket as keyof typeof bucketIntervals];

  const bucket_start = sql<Date>`date_bin(${interval},${logs.timestamp},TIMESTAMP '1970-01-01 00:00:00')`;

  if (filters.service !== undefined)
    conditions.push(eq(logs.service, filters.service));

  if (filters.level !== undefined)
    conditions.push(eq(logs.level, filters.level));

  conditions.push(gte(logs.timestamp, new Date(filters.since)));
  conditions.push(lt(logs.timestamp, new Date(filters.until)));

  if (filters.attributes !== undefined) {
    for (const [key, value] of Object.entries(filters.attributes)) {
      conditions.push(sql`${logs.attributes}->>${key} = ${value}`);
    }
  }

  if (filters.q !== undefined) {
    conditions.push(sql`${logs.message} ILIKE ${`%${filters.q}%`}`);
  }

  console.log("Running aggregate query...");

  if (filters.group_by === "service") {
    const result = await db
      .select({
        start: bucket_start,
        group: logs.service,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start, logs.service)
      .orderBy(bucket_start);

    return result;
  } else if (filters.group_by === "level") {
    const result = await db
      .select({
        start: bucket_start,
        group: logs.level,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start, logs.level)
      .orderBy(bucket_start);

    return result;
  } else {
    const result = await db
      .select({
        start: bucket_start,
        group: sql<null>`null`,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start)
      .orderBy(bucket_start);

    return result;
  }
}
