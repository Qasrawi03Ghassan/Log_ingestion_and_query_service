import {
  jsonb,
  pgTable,
  timestamp,
  varchar,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const logs = pgTable(
  "logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    timestamp: timestamp("timestamp", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    level: varchar("level", { length: 10 }).notNull(),
    service: varchar("service", { length: 256 }).notNull(),
    message: varchar("message", { length: 512 }).notNull(),
    attributes: jsonb("attributes"),
  },
  (table) => [index("logs_timestamp_idx").on(table.timestamp)],
);
