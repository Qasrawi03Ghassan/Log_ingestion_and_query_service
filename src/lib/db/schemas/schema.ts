import { desc } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  timestamp,
  varchar,
  serial,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const logs = pgTable(
  "logs",
  {
    id: serial("id").notNull(),
    timestamp: timestamp("timestamp", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    level: varchar("level", { length: 10 }).notNull(),
    service: varchar("service", { length: 256 }).notNull(),
    message: varchar("message", { length: 512 }).notNull(),
    attributes: jsonb("attributes"),
  },
  (table) => [
    primaryKey({ columns: [table.timestamp, table.id] }),
    index("logs_service_timestamp_idx").on(
      table.service,
      desc(table.timestamp),
    ),
    index("logs_level_timestamp_idx").on(table.level, desc(table.timestamp)),
  ],
);
