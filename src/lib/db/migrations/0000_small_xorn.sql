CREATE TABLE "logs" (
	"id" serial NOT NULL,
	"timestamp" timestamptz NOT NULL,
	"level" varchar(10) NOT NULL,
	"service" varchar(256) NOT NULL,
	"message" varchar(512) NOT NULL,
	"attributes" jsonb,
	CONSTRAINT "logs_timestamp_id_pk" PRIMARY KEY("timestamp","id")
);

CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable( 'logs', 'timestamp',if_not_exists => TRUE);

--> statement-breakpoint
CREATE INDEX "logs_service_timestamp_idx" ON "logs" USING btree ("service","timestamp" desc, "id" desc);--> statement-breakpoint
CREATE INDEX "logs_level_timestamp_idx" ON "logs" USING btree ("level","timestamp" desc, "id" desc);

CREATE INDEX "logs_attributes_gin_idx" ON "logs" USING GIN ("attributes");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "logs_messageQ_trgm" ON "logs" USING GIN ("message" gin_trgm_ops);