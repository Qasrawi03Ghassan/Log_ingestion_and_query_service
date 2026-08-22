# Log Ingestion & Query Service

A high-throughput log ingestion and querying service built with **TypeScript, Express, PostgreSQL, TimescaleDB, and Drizzle ORM**.

The service is designed to ingest high volumes of structured application logs in batches, stores them efficiently, provide filtered log queries and time-bucketed aggregations, and automatically enforce log retention. It works as a simplified version of DataDog or Grafana Loki.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Setup and Usage](#setup-and-usage)
- [API Documentation](#api-documentation)
  - [Health Check](#get-health---health-check)
  - [Ingest Logs](#post-logs---ingest-logs)
  - [Query Logs](#get-logs---query-logs)
  - [Aggregate Logs](#get-logsaggregate---aggregate-logs)

- [Database Design](#database-design)
  - [Schema](#schema)
  - [Hypertable Design](#hypertable-design)
  - [Indexes](#indexes)
  - [Aggregation Design](#aggregation-design)
  - [Attribute Storage](#attribute-storage-strategy)
  - [Retention Strategy](#retention-strategy)

- [Load-test methodology](#load-test-methodology)
  - [Test environment](#test-environment)
  - [Dataset](#dataset)
  - [Database container configuration](#database-container-configuration)

- [Discovered bottlenecks and pre-optimization results](#discovered-bottlenecks-and-pre-optimization-results)
- [Final Measured performance results](#final-measured-performance-results)
- [Known limitations](#known-limitations)

---

# Overview

This project implements a log ingestion and query service similar in concept to systems such as Datadog or Grafana Loki.

Each log contains:

- `timestamp`
- `level`
- `service`
- `message`
- `attributes`

The service supports:

- Batch log ingestion
- Per-log validation
- Partial acceptance of batches
- Bulk database ingestion using PostgreSQL `COPY`
- Asynchronous buffering of incoming logs
- Time-bucketed aggregation
- Service and level filtering
- Attribute filtering
- Message search
- Automatic retention
- Cursor-based log pagination
- TimescaleDB hypertables and continuous aggregates

---

# Architecture

```text
                         ┌─────────────────────┐
                         │      Client         │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Express API       │
                         │                     │
                         │ Request validation  │
                         └──────────┬──────────┘
                                    │
                         ┌──────────┴──────────┐
                         │                     │
                         ▼                     ▼
                  Valid logs              Invalid logs
                         │                     │
                         ▼                     ▼
                 COPY row buffer          HTTP response
                         │
                         ▼
                ┌──────────────────┐
                │ Logs Buffer      │
                │                  │
                │ Row limit        │
                │ Byte limit       │
                │ Flush timer      │
                └────────┬─────────┘
                         │
                         │ COPY
                         ▼
                ┌──────────────────┐
                │   TimescaleDB    │
                │                  │
                │ logs hypertable  │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │ Continuous       │
                │ Aggregates       │
                │                  │
                │ 1 minute buckets │
                └────────┬─────────┘
                         │
                         ▼
                GET /logs/aggregate
```

---

# Technology Stack

| Component        | Technology                  |
| ---------------- | --------------------------- |
| Runtime          | Node.js                     |
| Language         | TypeScript                  |
| HTTP framework   | Express                     |
| ORM              | Drizzle ORM                 |
| Database         | PostgreSQL 16 + TimescaleDB |
| Containerization | Docker / Docker Compose     |
| Testing          | Vitest                      |

---

# Setup and Usage

## Requirements

- Docker
- Docker Compose
- Node.js / npm for local development

## Starting the service

```bash
docker compose up --build
```

The service starts after:

1. PostgreSQL/TimescaleDB becomes healthy.
2. Database migrations are applied.
3. Automated tests run.
4. The service starts and becomes ready to accept logs on:

```text
 http://localhost:8080
```

## Stopping the service

```bash
docker compose down
```

To remove the database volume as well:

```bash
docker compose down -v
```

> **Warning:** Removing the volume deletes the database contents.

---

# API Documentation

# `GET /health` - Health check

Returns HTTP 200 with any response body once the service is ready to accept traffic.
The service report itself as healthy only after:

- The database connection has been established
- Database migrations have been applied
- The service is ready to accept logs

### Successful response

```http
200 OK
```

With response body:

```json
{ "Message": "Service is up and ready to receive logs" }
```

### Unsuccessful response

```http
502 Bad Gateway
```

With response body:

```json
{ "error": "Service is not ready" }
```

---

# `POST /logs` - Ingest Logs

Accepts a batch of logs. A batch containing one log entry is valid.

### Request example

```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "region": "eu-west",
        "retries": 3
      }
    }
  ]
}
```

### Validation Rules

Each log entry is validated independently according to the following rules:

- **`timestamp`** — Required
  - Must be a valid ISO 8601 timestamp.
  - Must not be more than **5 minutes in the future**.

- **`level`** — Required
  - Must be one of:
    - `debug`
    - `info`
    - `warn`
    - `error`

- **`service`** — Required
  - Must be a non-empty string.

- **`message`** — Required
  - Must be a non-empty string.

- **`attributes`** — Optional
  - Must be a flat object.
  - Values may be:
    - Strings
    - Numbers
    - Booleans
  - Nested objects and arrays are not allowed.

### Partial acceptance

A request can contain both valid and invalid logs, since an invalid entry must not cause the entire batch to fail.

The service does the following regarding batch behavior:

- Accept valid entries
- Reject invalid entries
- Return the array index and rejection reason for each invalid entry

#### Response

Returns HTTP `200 OK` when at least one entry is accepted.
Returns HTTP `400 Bad Request` when:

- All entries are rejected
- The request body contains malformed JSON
- The request does not match the expected top-level structure

Example Response:

```json
{
  "accepted": 9,
  "rejected": [
    {
      "index": 3,
      "reason": "invalid level: 'critical'. Use info, debug, error, or warn only"
    }
  ]
}
```

---

# `GET /logs` - Query logs

Supports filtering and pagination.

Example:

```text
GET /logs?service=api&level=error&since=2026-08-22T00:00:00.000Z
```

Supported filters (All query parameters are optional and may be freely combined):

| Parameter    | Meaning                                                  | Example                      |
| ------------ | -------------------------------------------------------- | ---------------------------- |
| `service`    | Exact service-name match                                 | `service=checkout`           |
| `level`      | Exact level match                                        | `level=error`                |
| `since`      | Inclusive start of the time range                        | `since=2026-07-20T14:00:00Z` |
| `until`      | Exclusive end of the time range                          | `until=2026-07-20T15:00:00Z` |
| `attr.<key>` | Attribute equality, compared as strings                  | `attr.user_id=42`            |
| `q`          | Case-insensitive substring match on `message`            | `q=declined`                 |
| `limit`      | Maximum number of results; default `100`, maximum `1000` | `limit=500`                  |
| `cursor`     | Opaque cursor returned by a previous response            | `cursor=eyJpZCI6...`         |

Results are sorted by timestamp in descending order and the ordering remains deterministic when multiple logs have the same timestamp.

### Example response

```json
{
  "logs": [
    {
      "id": "any-unique-id",
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42"
      }
    }
  ],
  "next_cursor": "eyJpZCI6..."
}
```

`next_cursor` becomes null when no additional results are available.

### Invalid parameters

Returns HTTP `400 Bad Request` with the following structure when query parameters are invalid:

```json
{
  "error": "<description>"
}
```

Invalid input scenarios include:

- Invalid timestamps
- `until` earlier than `since`
- Unsupported log levels
- Non-numeric limits
- Limits outside the supported range
- Invalid or malformed cursors

---

# `GET /logs/aggregate` - Aggregate logs

Returns time-bucketed log counts.

Supports same query parameters as `GET /logs`:

- `service`
- `level`
- `attr.<key>`
- `q`

- `since`
- `until`
- `bucket`

It also accepts the following aggregation parameters:

| Parameter  | Required | Meaning                                  | Example                      |
| ---------- | -------- | ---------------------------------------- | ---------------------------- |
| `since`    | Yes      | Inclusive start of the aggregation range | `since=2026-07-20T14:00:00Z` |
| `until`    | Yes      | Exclusive end of the aggregation range   | `until=2026-07-20T15:00:00Z` |
| `bucket`   | Yes      | Bucket size: `1m`, `5m`, `1h`, or `1d`   | `bucket=1m`                  |
| `group_by` | No       | Group results by `service` or `level`    | `group_by=service`           |

### Example

```text
GET /logs/aggregate?since=2026-08-22T00:00:00.000Z&until=2026-08-22T01:00:00.000Z&bucket=1m&group_by=service
```

### Response structure

Returns one row for each bucket and group combination.
Results are ordered by bucket start time in ascending order.
Empty buckets are omitted.
When `group_by` is not provided, `group` must be `null`.

Example response:

```json
{
  "buckets": [
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "checkout",
      "count": 118
    },
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "auth",
      "count": 42
    },
    {
      "start": "2026-07-20T14:01:00Z",
      "group": "checkout",
      "count": 97
    }
  ]
}
```

Invalid parameters return HTTP `400 Bad Request` using the same error format as `GET /logs`.

---

# Database Design

## Schema

The primary logs table is:

```sql
CREATE TABLE IF NOT EXISTS "logs" (
    "id" serial NOT NULL,
    "timestamp" timestamptz NOT NULL,
    "level" text NOT NULL,
    "service" text NOT NULL,
    "message" text NOT NULL,
    "attributes" jsonb,
    CONSTRAINT "logs_timestamp_id_pk"
        PRIMARY KEY("timestamp", "id")
);
```

| Column       | Type          | Purpose                                              |
| ------------ | ------------- | ---------------------------------------------------- |
| `id`         | `serial`      | Unique row identifier within the timestamp           |
| `timestamp`  | `timestamptz` | Log event time and hypertable partitioning dimension |
| `level`      | `text`        | Log severity                                         |
| `service`    | `text`        | Originating service                                  |
| `message`    | `text`        | Log message                                          |
| `attributes` | `jsonb`       | Optional structured metadata                         |

---

# Hypertable Design

The `logs` table is converted into a TimescaleDB hypertable which allows for faster ingestion and querying:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
    'logs',
    'timestamp',
    if_not_exists => TRUE,
    migrate_data => TRUE
);
```

The timestamp is used as the primary time dimension.

This allows TimescaleDB to partition the log data into time chunks and makes time-range queries and time-series workloads more suitable for the database.

---

# Indexes

The primary index is provided by:

```sql
PRIMARY KEY ("timestamp", "id")
```

is dropped:

```sql
DROP INDEX IF EXISTS "logs_timestamp_id_idx";
```

An explicit timestamp index was created with `desc` constraint on `timestamp` and `id` columns:

```sql
CREATE INDEX IF NOT EXISTS "logs_timestamp_id_idx"
ON "logs" USING btree ("timestamp" DESC, "id" DESC);
```

The following indexes were tested and provided noticable improvements when querying based on `attr.<key>` and / or `q` query parameters:

```sql
CREATE INDEX "logs_attributes_gin_idx"
ON "logs" USING GIN ("attributes");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "logs_messageQ_trgm" ON "logs" USING GIN ("message" gin_trgm_ops);
```

However two indexes were proposed for `level` and `service` query parameters which were improving querying before using TimescaleDB's continuous aggregation but proved to have some noticable impact on throughput after applying it:

```sql
CREATE INDEX IF NOT EXISTS "logs_service_timestamp_idx" ON "logs" USING btree ("service","timestamp" desc, "id" desc);
CREATE INDEX IF NOT EXISTS "logs_level_timestamp_idx" ON "logs" USING btree ("level","timestamp" desc, "id" desc);
```

So they were not included in final configuration.

Another index was used for continuous aggregation:

```sql

CREATE INDEX IF NOT EXISTS logs_1m_bucket_service_level_idx
ON logs_1m (bucket_start DESC, service, level);
```

**So the final implemented indexes are**:

```sql
DROP INDEX IF EXISTS "logs_timestamp_id_idx";
CREATE INDEX IF NOT EXISTS "logs_timestamp_id_idx" ON "logs" USING btree ("timestamp" desc, "id" desc);
CREATE INDEX IF NOT EXISTS "logs_attributes_gin_idx" ON "logs" USING GIN ("attributes");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "logs_messageQ_trgm" ON "logs" USING GIN ("message" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS logs_1m_bucket_service_level_idx
ON logs_1m (bucket_start DESC, service, level);
```

---

# Aggregation Design

Aggregation originally used direct custom aggregation over the `logs` hypertable:

```sql
SELECT
    time_bucket('1 minute', timestamp),
    service,
    count(*)
FROM logs
WHERE ...
GROUP BY 1, service;
```

At one point the aggregate endpoint was observed to push PostgreSQL to approximately **100% CPU**, becoming a major benchmark bottleneck.

## Aggregation final approach

TimescaleDB continuous aggregates are used instead of maintaining a custom aggregation table and manually updating counts during ingestion.

Conceptually:

```text
logs hypertable
      │
      ▼
TimescaleDB continuous aggregate
      │
      ▼
precomputed time buckets
      │
      ▼
GET /logs/aggregate
```

This avoids recalculating `COUNT(*)` across a large number of raw log rows for every aggregation request.

The exact TimescaleDB's continuous aggregate definition:

```sql
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
```

The refresh policy used:

```sql
--Defining continuous aggregation policy
SELECT add_continuous_aggregate_policy(
    'logs_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '10 seconds'
);
```

`end_offset` and `schedule_interval` values make newly ingested logs ready for querying and aggregation within at most 20 seconds as requested.

---

# Attribute storage strategy

The `attributes` field is stored as PostgreSQL `JSONB`:

```sql
"attributes" jsonb
```

Example:

```json
{
  "region": "eu-west",
  "retries": 3,
  "cached": true,
  "user_id": "42"
}
```

`JSONB` was chosen because log attributes are optional and can vary between log records.They don't have fixed fields too which made `JSONB` the right decision for storing them.

The application validates attribute values before insertion.

Supported values:

- strings
- numbers
- booleans

The GIN index on `attributes` was tested:

```sql
CREATE INDEX logs_attributes_gin_idx
ON logs USING GIN (attributes);
```

And it was observable that queries run faster with it using `EXPLAIN ANALYZE` command in postgresql.

---

# Retention Strategy

Logs are automatically removed after the configured retention period.

The service maintains three environment variables that can be configured to handle retention, following is default values to control it:

```.env
RETENTION_DAYS=30
RETENTION__CHECK_PERIOD_HOURS=24
RETENTION_BATCH_MAX_SIZE=10000
```

The application currently performs retention cleanup during service startup / scheduled retention processing based on `RETENTION__CHECK_PERIOD_HOURS`. It checks whether a timestamp is older than current time timestamp more than 30 days (1 month) since the database should have logs for about 1 month of data.

---

# Load-test methodology

For testing and benchmarking, local tests were run under the following docker properties on a Windows 11 (`wsl2`) machine:

```text
[wsl2]
memory=6GB
processors=8
```

benchmarks were done locally via the following tool (provided by FTS) on the root folder of the project:

```shell
npx --yes github:Ahmad-Abbas-Foothill/logs-benchmark-cli --compose ./docker-compose.yml --full --seed 6122026 --runner docker --json benchmark-report.json --generator-cpus 6
```

`--generated-cpus` option was set to 6 instead of 4 to use 7.5 CPUs out of 8 that docker provided for maximum possible load-generator accurate results on the machine.

measured machine speed: 0.34x - 0.37x for each test

**WARNING: It's best to close all applciations other than the benchmark terminal window**

**For every performance optimization, 3 to 5 tests were conducted to ensure accurate results.**

## Test environment

The service `docker compose up [--build]` produces two Docker containers, one for the application and one for the postgres database. They have the following constraints which the benchmark also applies:

| Container                                   | CPU | MEM     |
| ------------------------------------------- | --- | ------- |
| app                                         | 0.5 | 256 MiB |
| pg-db (`timescale/timescaledb:latest-pg16`) | 1   | 1 GiB   |

## Dataset

The benchmark seeds the database with 1,000,000 rows before starting the load test so the tests run on a pre-loaded database.

## Database container configuration

The `docker-compose.yml` file specifies the settings that were used on the `pg-db` container for whole testing process, so postgres database settings are always the following:

- shared_buffers=256MB
- effective_cache_size=512MB
- work_mem=4MB
- wal_buffers=16MB
- min_wal_size=256MB
- max_wal_size=1GB
- checkpoint_timeout=15min
- checkpoint_completion_target=0.9
- synchronous_commit=off

# Discovered bottlenecks and pre-optimization results

There were two main discovered bottlenecks that made the service struggle:

1. Multiple small bulk `COPY` operations and timescaledb hypertable extension:
   For ingesting huge numbers of batches, the first approach was using bulk `INSERT` on multiple rows instead of looping through all logs and insert them one by one, which managed to get ~ **6.8K logs / s** throughput on the raw logs table, so instead `COPY` operation was used along with `STDIN` to bulk insert huge numbers of logs and using TimescaleDB's hypertable for the logs table increased throughput to around **8K logs/s** throughput but it was far from goal. The changing point was checking the number of logs copied ber batch which was only 100 (batch size was 100 logs / request), so the bottleneck was solved by implementing a queue buffering system for `COPY` operations. But introducing it was not easy because of the memory limitation of the app container (256 MiB) which caused the container to crash, so the solution was to design the queue to take max logs count / batch and wait for an interval of 100ms (tested multiple intervals and found 100ms is best) for the buffer instead of adding all "copy rows" and after the bulk `COPY` operations and then flush the queue to maintain both high ingestion load and stability. After optimization throughput reached **~11.5k logs / s**.

2. Aggregation from raw logs table:
   Aggregation was the main problem of the system since it caused the postgresql database container to be most of the time at **~100% CPU** usage due to continuous calculation of number of raws that apply to the aggregation query parameters. Solution was to implement a rollup table to store the counts, so TimescaleDB's continuous aggregation was implemented which is designed for this purpose with the suitable aggregation policy to ensure consistency, low p95 aggregate for ingestion and querying. the aggregation policy can be found above in the [Aggregation Design](#aggregation-design) section.

**Pre-optimization performance results:**

Benchmark results:

| Correctness | Performance | Queries  | Reliability | **Total**      |
| ----------- | ----------- | -------- | ----------- | -------------- |
| 15.0 / 15.0 | 25.7 / 50   | 6.0 / 15 | 20 / 20     | **66.7 / 100** |

Performance and queries metrics results:

| Throughput          | Ingestion P95 latency | Aggregate P95 latency |
| ------------------- | --------------------- | --------------------- |
| **~ 8038 logs / s** | 1450 ms               | 2175 ms               |

Resources usage during benchmark:

| Container | CPU (Avg.) | CPU (Max) | MEM (Avg) | MEM (Max)        |
| --------- | ---------- | --------- | --------- | ---------------- |
| app       | ~ 17.22%   | 50%       | ~ 20.13%  | 51.24% (152 MiB) |
| database  | ~ 76.52%   | 100%      | ~ 15.23%  | 32.12% (327 MiB) |

# Final Measured performance results

Benchmark results:

| Correctness | Performance | Queries   | Reliability | **Total**      |
| ----------- | ----------- | --------- | ----------- | -------------- |
| 15.0 / 15.0 | 45.0 / 50   | 12.5 / 15 | 20 / 20     | **92.5 / 100** |

Performance and queries metrics results:

| Throughput         | Ingestion P95 latency | Aggregate P95 latency |
| ------------------ | --------------------- | --------------------- |
| **15000 logs / s** | 49ms                  | 55 ms                 |

Resources usage during benchmark:

| Container | CPU (Avg.) | CPU (Max) | MEM (Avg) | MEM (Max)           |
| --------- | ---------- | --------- | --------- | ------------------- |
| app       | ~ 32.14%   | 50%       | ~ 42.53%  | 70.43% (180.31 MiB) |
| database  | ~ 40.84%   | 64%       | ~ 20.74%  | 44.53% (456 MiB)    |

# Known limitations

- **Fixed resource constraints**
  - The benchmark environment limits the application container to 0.5 CPU and 256 MiB RAM.
  - The PostgreSQL/TimescaleDB container is limited to 1 CPU and 1 GiB RAM.
  - Performance outside these resource limits may differ from the measured results.

- **In-memory ingestion buffer**
  - Incoming COPY rows are temporarily buffered in application memory before being flushed to PostgreSQL.
  - The buffer has explicit row and memory limits to prevent the application from exceeding its 256 MiB memory limit.
  - If PostgreSQL becomes unavailable for an extended period, ingestion throughput is eventually limited by the configured buffer capacity.

- **Retention cleanup is not instantaneous**
  - Retention is performed as a cleanup operation rather than automatically removing every expired row at the exact moment it reaches the retention threshold.
  - Therefore, expired records may remain in the database temporarily until the next retention check.

- **No rate limiting**
  - The API does not currently enforce per-client or global request-rate limits.
  - A client can therefore send requests at a rate higher than the system's sustained ingestion capacity.
  - The ingestion buffer provides backpressure for the in memory logs buffer when its configured limits are reached, but it does not reject requests based on a predefined rate limit.

- **Aggregation freshness depends on TimescaleDB continuous aggregates**
  - Aggregation results are precomputed using TimescaleDB continuous aggregates rather than calculated directly from the raw logs table for every request.
  - Therefore, aggregation results can have a small refresh delay depending on the continuous aggregate refresh policy.
  - This is a deliberate trade-off between aggregation latency and ingestion performance.

- **Aggregation is optimized for the supported bucket sizes**
  - The aggregation API supports the defined bucket sizes (`1m`, `5m`, `1h`, and `1d`).
  - Other arbitrary bucket intervals are not supported by the API contract.

  - **Asynchronous buffering introduces a small ingestion delay**
  - Logs are buffered before being sent to PostgreSQL in larger COPY batches.
  - This improves throughput significantly compared with issuing a COPY operation for every small request, but means logs may not become queryable immediately after the HTTP request is received.
  - The implementation is designed to keep newly ingested data queryable within the required 20-second consistency window.

- **JSONB attribute queries are less predictable than indexed scalar filters**
  - Attributes are stored as JSONB because their structure is dynamic.
  - Attribute filtering can be more expensive than filtering by fixed columns such as `service` or `level`, particularly when many different attribute keys are queried.
  - A GIN index can improve attribute-query performance, but maintaining the index adds ingestion overhead.

- **Message substring searches are inherently more expensive**
  - The `q` parameter performs case-insensitive substring matching against `message`.
  - Trigram indexing can improve these queries, but the index increases storage requirements and write overhead.

- **Indexes require a read/write trade-off**
  - Additional indexes can improve query latency but increase the amount of work PostgreSQL performs during ingestion.
  - During benchmarking, indexes on `service` and `level` combined with timestamp were found to negatively affect ingestion throughput and were therefore excluded from the final configuration. :contentReference[oaicite:1]{index=1}
