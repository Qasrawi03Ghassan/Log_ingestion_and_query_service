import { sql } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  timestamp,
  text,
  serial,
  primaryKey,
  bigint,
} from "drizzle-orm/pg-core";

export const logs = pgTable(
  "logs",
  {
    id: serial("id").notNull(),
    timestamp: timestamp("timestamp", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    level: text("level").notNull(),
    service: text("service").notNull(),
    message: text("message").notNull(),
    attributes: jsonb("attributes"),
  },
  (table) => [primaryKey({ columns: [table.timestamp, table.id] })],
);

export const logs_1m = pgTable(
  "logs_1m",
  {
    bucket_start: timestamp("bucket_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    level: text("level").notNull(),
    service: text("service").notNull(),
    log_count: bigint({ mode: "bigint" })
      .default(sql`0`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucket_start, table.service, table.level] }),
  ],
);
