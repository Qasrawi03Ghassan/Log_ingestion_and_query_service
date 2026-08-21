import { storeLogs } from "../lib/db/queries/logs.js";
import { insertAgg1mLogs } from "../lib/db/queries/logs_agg_1m.js";
import { aggInput } from "../utils/validators/logsValidators.js";

type aggRow = {
  bucket_start: Date | undefined;
  level: string | undefined;
  service: string | undefined;
  count: number;
}[];

const FLUSH_ROWS = 15000; // 10000 (reached 15k logs/s)

// Hard upper bound on data waiting in memory.
const MAX_QUEUE_ROWS = 15000; //10000
const MAX_QUEUE_BYTES = 3 * 1024 * 1024; // 2MB

const FLUSH_INTERVAL_MS = 150; //100

let buffer: string[] = [];
let bufferBytes = 0;

let flushInProgress = false;
let flushTimer: NodeJS.Timeout | undefined;

const spaceWaiters: Array<() => void> = [];

let aggMap: Map<string, number> = new Map<string, number>();
function getBucket1m(timestamp: Date): Date {
  const ms = timestamp.getTime();
  return new Date(Math.floor(ms / 60000) * 60000);
}

function addToAggMap(input: aggInput) {
  const bucket = getBucket1m(input.timestamp);
  const key = `${bucket.toISOString()}\t${input.service}\t${input.level}`;
  aggMap.set(key, (aggMap.get(key) ?? 0) + 1);
}

export async function enqueueCopyRows(
  rows: string[],
  aggInput: aggInput[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  let offset = 0;

  while (offset < rows.length) {
    const row = rows[offset]!;
    const rowBytes = Buffer.byteLength(row);

    /*
     * Queue is full.
     * Wait until the COPY worker removes some rows.
     */
    if (
      buffer.length >= MAX_QUEUE_ROWS ||
      bufferBytes + rowBytes > MAX_QUEUE_BYTES
    ) {
      await waitForSpace();
      continue;
    }

    buffer.push(row);
    bufferBytes += rowBytes;

    //todo: custom agg rollup updating aggregation
    //addToAggMap(aggInput[offset]!);

    offset++;

    /*
     * Start COPY immediately when we have enough rows.
     */
    if (buffer.length >= FLUSH_ROWS) {
      void flush();
    } else {
      scheduleFlush();
    }
  }
}

function waitForSpace(): Promise<void> {
  return new Promise<void>((resolve) => {
    spaceWaiters.push(resolve);
  });
}

function notifySpaceWaiters(): void {
  if (spaceWaiters.length === 0) {
    return;
  }

  const waiters = spaceWaiters.splice(0);

  for (const resolve of waiters) {
    resolve();
  }
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
  if (flushInProgress || buffer.length === 0) {
    return;
  }

  flushInProgress = true;

  /*
   * Take exactly one COPY batch.
   */
  const batch = buffer.splice(0, FLUSH_ROWS);

  let batchBytes = 0;

  for (const row of batch) {
    batchBytes += Buffer.byteLength(row);
  }

  bufferBytes -= batchBytes;

  //todo: custom agg rollup
  /*const aggMapHandler = aggMap;
  aggMap = new Map();

  const aggRows = [];
  for (const [key, count] of aggMapHandler) {
    const rows = key.split("\t");

    const bucket_start = new Date(rows[0]!);
    const level = rows[1];
    const service = rows[2];

    aggRows.push({ bucket_start, level, service, count });
  }*/

  /*
   * We removed rows from the queue, so blocked requests
   * can try to enqueue again.
   */
  notifySpaceWaiters();

  try {
    const start = performance.now();
    await storeLogs(batch);
    const elapsed = performance.now() - start;

    console.log(
      `COPY: ${batch.length} rows in ${elapsed.toFixed(1)}ms ` +
        `(${((batch.length / elapsed) * 1000).toFixed(0)} rows/sec)`,
    );

    //await insertAgg1mLogs(aggRows); // todo: gets logs_1m ready for aggregation
  } catch (error) {
    console.error("Cannot store logs:", error);

    /*
     * Don't lose data if COPY fails.
     */
    buffer.unshift(...batch);
    bufferBytes += batchBytes;

    scheduleFlush();
  } finally {
    flushInProgress = false;
  }

  /*
   * Process another batch if rows accumulated while
   * the previous COPY was running.
   */
  if (buffer.length >= FLUSH_ROWS) {
    void flush();
  } else if (buffer.length > 0) {
    scheduleFlush();
  }
}
