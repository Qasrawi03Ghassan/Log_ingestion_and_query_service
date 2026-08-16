CREATE TABLE "logs" (
	"id" serial NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"level" varchar(10) NOT NULL,
	"service" varchar(256) NOT NULL,
	"message" varchar(512) NOT NULL,
	"attributes" jsonb,
	CONSTRAINT "logs_timestamp_id_pk" PRIMARY KEY("timestamp","id")
);
--> statement-breakpoint
CREATE INDEX "logs_service_timestamp_idx" ON "logs" USING btree ("service","timestamp" desc);--> statement-breakpoint
CREATE INDEX "logs_level_timestamp_idx" ON "logs" USING btree ("level","timestamp" desc);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "logs_messageQ_trgm" ON "logs" USING GIN ("message" gin_trgm_ops);