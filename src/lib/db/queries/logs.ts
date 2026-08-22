import { pool, db } from "../index.js";
import { eq, gte, lt, and, desc, sql, asc } from "drizzle-orm";
import { logs, logs_1m } from "../schemas/schema.js";
import { LogCursor } from "../../../utils/cursorLogUtils.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";

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

export async function storeLogs(copyRows: string[]) {
  if (copyRows.length === 0) {
    console.log("No logs to ingest.");
    return;
  }
  const client = await pool.connect();
  try {
    const copyStream = client.query(
      copyFrom(`
        COPY logs (
          "timestamp",
          level,
          service,
          message,
          attributes
        )
        FROM STDIN
        WITH (
          FORMAT text,
          DELIMITER E'\\t',
          NULL '\\N'
        )
      `),
    );
    await pipeline(Readable.from(copyRows), copyStream);
  } finally {
    client.release();
  }
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
      sql`(${logs.timestamp}, ${logs.id}) < (${new Date(cursor.timestamp)}, ${cursor.id})`,
    );
  }

  if (filters.attributes !== undefined) {
    for (const [key, value] of Object.entries(filters.attributes)) {
      conditions.push(
        sql`${logs.attributes} @> ${JSON.stringify({ [key]: value })}::jsonb`,
      );
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

export async function aggregateRollupLogs(filters: AggregateFilter) {
  const bucketIntervals = {
    "1m": sql`INTERVAL '1 minute'`,
    "5m": sql`INTERVAL '5 minutes'`,
    "1h": sql`INTERVAL '1 hour'`,
    "1d": sql`INTERVAL '1 day'`,
  };

  const interval =
    bucketIntervals[filters.bucket as keyof typeof bucketIntervals];

  const bucketStart = sql<Date>`
    time_bucket(
      ${interval},
      ${logs_1m.bucket_start}
    )
  `;

  const conditions = [
    gte(logs_1m.bucket_start, new Date(filters.since)),
    lt(logs_1m.bucket_start, new Date(filters.until)),
  ];

  if (filters.service !== undefined) {
    conditions.push(eq(logs_1m.service, filters.service));
  }

  if (filters.level !== undefined) {
    conditions.push(eq(logs_1m.level, filters.level));
  }

  if (filters.group_by === "service") {
    return db
      .select({
        start: bucketStart,
        group: logs_1m.service,
        count: sql<number>`
          SUM(${logs_1m.log_count})
        `,
      })
      .from(logs_1m)
      .where(and(...conditions))
      .groupBy(bucketStart, logs_1m.service)
      .orderBy(asc(bucketStart));
  }

  if (filters.group_by === "level") {
    return db
      .select({
        start: bucketStart,
        group: logs_1m.level,
        count: sql<number>`
          SUM(${logs_1m.log_count})
        `,
      })
      .from(logs_1m)
      .where(and(...conditions))
      .groupBy(bucketStart, logs_1m.level)
      .orderBy(asc(bucketStart));
  }

  return db
    .select({
      start: bucketStart,
      group: sql<null>`NULL`,
      count: sql<number>`
        SUM(${logs_1m.log_count})
      `,
    })
    .from(logs_1m)
    .where(and(...conditions))
    .groupBy(bucketStart)
    .orderBy(asc(bucketStart));
}

export async function aggregateRawLogs(filters: AggregateFilter) {
  const conditions = [
    gte(logs.timestamp, new Date(filters.since)),
    lt(logs.timestamp, new Date(filters.until)),
  ];
  const bucketIntervals = {
    "1m": sql`INTERVAL '1 minute'`,
    "5m": sql`INTERVAL '5 minutes'`,
    "1h": sql`INTERVAL '1 hour'`,
    "1d": sql`INTERVAL '1 day'`,
  };

  const interval =
    bucketIntervals[filters.bucket as keyof typeof bucketIntervals];

  const bucket_start = sql<Date>`
  time_bucket(
    ${interval},
    ${logs.timestamp}
  )
`;

  if (filters.level !== undefined) {
    conditions.push(eq(logs.level, filters.level));
  }
  if (filters.service !== undefined) {
    conditions.push(eq(logs.service, filters.service));
  }
  if (filters.attributes !== undefined) {
    for (const [key, value] of Object.entries(filters.attributes)) {
      conditions.push(sql`${logs.attributes}->>${key} = ${value}`);
    }
  }
  if (filters.q !== undefined) {
    conditions.push(sql`${logs.message} ILIKE ${`%${filters.q}%`}`);
  }

  if (filters.group_by === "level") {
    return db
      .select({
        start: bucket_start,
        group: logs.level,
        count: sql<number>`COUNT(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start, logs.level)
      .orderBy(asc(bucket_start));
  } else if (filters.group_by === "service") {
    return db
      .select({
        start: bucket_start,
        group: logs.service,
        count: sql<number>`COUNT(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start, logs.service)
      .orderBy(asc(bucket_start));
  }

  return db
    .select({
      start: bucket_start,
      group: sql<null>`NULL`,
      count: sql<number>`count(*)`,
    })
    .from(logs)
    .where(and(...conditions))
    .groupBy(bucket_start)
    .orderBy(asc(bucket_start));
}

export async function aggregateLogs(filters: AggregateFilter) {
  if (filters.attributes === undefined || filters.q === undefined)
    return aggregateRollupLogs(filters);
  return aggregateRawLogs(filters);
}
