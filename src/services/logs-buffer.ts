import { storeLogs } from "../lib/db/queries/logs.js";

const FLUSH_ROWS = 10000; // 10000 (reached 15k logs/s)

// Hard upper bound on data waiting in memory.
const MAX_QUEUE_ROWS = 10000;
const MAX_QUEUE_BYTES = 2 * 1024 * 1024;

const FLUSH_INTERVAL_MS = 100;

let buffer: string[] = [];
let bufferBytes = 0;

let flushInProgress = false;
let flushTimer: NodeJS.Timeout | undefined;

const spaceWaiters: Array<() => void> = [];

export async function enqueueCopyRows(rows: string[]): Promise<void> {
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
