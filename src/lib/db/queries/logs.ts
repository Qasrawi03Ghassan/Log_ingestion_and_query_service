import { pool, queryDB, aggDB } from "../index.js";
import { eq, gte, lt, and, desc, sql, asc } from "drizzle-orm";
import { logs } from "../schemas/schema.js";
import { LogCursor } from "../../../utils/cursorLogUtils.js";
import { log } from "../../../utils/validators/logsValidators.js";
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

function escapeCopyText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

export async function storeLogs(
  timestamps: Date[],
  services: string[],
  levels: string[],
  messages: string[],
  attributes: string[],
) {
  if (timestamps.length === 0) {
    console.log("No logs to ingest.");
    return;
  }

  if (
    timestamps.length !== services.length ||
    timestamps.length !== levels.length ||
    timestamps.length !== messages.length ||
    timestamps.length !== attributes.length
  ) {
    throw new Error("Log arrays must have same length!");
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

    const source = Readable.from(
      (function* () {
        for (let i = 0; i < timestamps.length; i++) {
          const attribute =
            attributes[i] === undefined
              ? "\\N"
              : escapeCopyText(attributes[i]!);

          yield escapeCopyText(timestamps[i]!.toISOString()) +
            "\t" +
            escapeCopyText(levels[i]!) +
            "\t" +
            escapeCopyText(services[i]!) +
            "\t" +
            escapeCopyText(messages[i]!) +
            "\t" +
            attribute +
            "\n";
        }
      })(),
    );

    await pipeline(source, copyStream);
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

  let res = await queryDB
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

  const bucket_start = sql<Date>`
  time_bucket(
    ${interval},
    ${logs.timestamp}
  )
`;

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

  if (filters.group_by === "service") {
    const result = await aggDB
      .select({
        start: bucket_start,
        group: logs.service,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start, logs.service)
      .orderBy(asc(bucket_start));

    return result;
  } else if (filters.group_by === "level") {
    const result = await aggDB
      .select({
        start: bucket_start,
        group: logs.level,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start, logs.level)
      .orderBy(asc(bucket_start));

    return result;
  } else {
    const result = await aggDB
      .select({
        start: bucket_start,
        group: sql<null>`null`,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(bucket_start)
      .orderBy(asc(bucket_start));

    return result;
  }
}
