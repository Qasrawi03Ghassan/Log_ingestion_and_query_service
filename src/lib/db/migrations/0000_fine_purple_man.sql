CREATE TABLE IF NOT EXISTS "logs" (
	"id" serial NOT NULL,
	"timestamp" timestamptz NOT NULL,
	"level" text NOT NULL,
	"service" text NOT NULL,
	"message" text NOT NULL,
	"attributes" jsonb,
	CONSTRAINT "logs_timestamp_id_pk" PRIMARY KEY("timestamp","id")
);

CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable(
  'logs',
  'timestamp',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Creating a materialized view based on timescaledb's continuous aggregation for aggregating logs
CREATE MATERIALIZED VIEW IF NOT EXISTS logs_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', timestamp) AS bucket_start,
    service,
    level,
    count(*) AS log_count
FROM logs
GROUP BY
    bucket_start,
    service,
    level
WITH NO DATA;

CREATE INDEX IF NOT EXISTS logs_1m_bucket_service_level_idx
ON logs_1m (bucket_start DESC, service, level);

--Defining continuous aggregation policy
SELECT add_continuous_aggregate_policy(
    'logs_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '10 seconds'
);

DROP INDEX IF EXISTS "logs_timestamp_id_idx";
CREATE INDEX IF NOT EXISTS "logs_timestamp_id_idx" ON "logs" USING btree ("timestamp" desc, "id" desc);
CREATE INDEX IF NOT EXISTS "logs_attributes_gin_idx" ON "logs" USING GIN ("attributes");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "logs_messageQ_trgm" ON "logs" USING GIN ("message" gin_trgm_ops);

--CREATE INDEX IF NOT EXISTS "logs_service_timestamp_idx" ON "logs" USING btree ("service","timestamp" desc, "id" desc);
--CREATE INDEX IF NOT EXISTS "logs_level_timestamp_idx" ON "logs" USING btree ("level","timestamp" desc, "id" desc);
