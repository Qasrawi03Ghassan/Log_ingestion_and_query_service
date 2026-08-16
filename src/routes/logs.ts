import { Router, Request, Response } from "express";
import {
  validateLogs,
  validateRequest,
  isValidTimestamp,
} from "../utils/validators/logsValidators.js";
import {
  queryLogs,
  storeLogs,
  aggregateLogs,
  AggregateFilter,
} from "../lib/db/queries/logs.js";
import {
  LogCursor,
  encodeCursor,
  decodeCursor,
} from "../utils/cursorLogUtils.js";

export const logsRouter = Router();

logsRouter.get("/", async (req: Request, res: Response) => {
  const queryParams = {
    service: req.query.service,
    level: req.query.level,
    since: req.query.since,
    until: req.query.until,
    q: req.query.q,
    limit: req.query.limit,
    cursor: req.query.cursor,
  };

  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("attr.")) {
      const attrName = key.slice(5);
      if (typeof value === "string") {
        attrs[attrName] = value;
      }
    }
  }

  if (
    queryParams.service !== undefined &&
    typeof queryParams.service !== "string"
  ) {
    return res.status(400).json({
      error: "invalid service. Must be a string",
    });
  }

  if (
    queryParams.level !== undefined &&
    typeof queryParams.level !== "string"
  ) {
    return res.status(400).json({
      error: "invalid level. Must be a string",
    });
  }

  if (
    queryParams.level !== undefined &&
    !["debug", "info", "warn", "error"].includes(queryParams.level)
  ) {
    return res.status(400).json({
      error: "invalid level. Must be debug, info, warn, or error only",
    });
  }

  if (queryParams.since !== undefined) {
    if (typeof queryParams.since !== "string") {
      return res.status(400).json({
        error: "Invalid since timestamp",
      });
    }
    const isValidSince = isValidTimestamp(queryParams.since);
    if (!isValidSince.valid) {
      return res.status(400).json({
        error: "Invalid since timestamp",
      });
    }
  }

  if (queryParams.until !== undefined) {
    if (typeof queryParams.until !== "string")
      return res.status(400).json({
        error: "Invalid until timestamp",
      });

    const isValidUntil = isValidTimestamp(queryParams.until);
    if (!isValidUntil.valid) {
      return res.status(400).json({
        error: "Invalid until timestamp",
      });
    }
  }

  if (queryParams.since !== undefined && queryParams.until !== undefined) {
    if (Date.parse(queryParams.since) > Date.parse(queryParams.until))
      return res.status(400).json({
        error:
          "Invalid range: since & until timestamps combination are invalid",
      });
  }

  if (queryParams.q !== undefined) {
    if (typeof queryParams.q !== "string") {
      return res.status(400).json({
        error: "Invalid q parameter",
      });
    }
  }

  let limit = 100;
  if (queryParams.limit !== undefined) {
    if (typeof queryParams.limit !== "string") {
      return res.status(400).json({
        error: "Invalid limit parameter",
      });
    }

    const parsedLimit = Number(queryParams.limit);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 1000
    ) {
      return res.status(400).json({
        error: "Invalid limit parameter, min:1 & max: 1000",
      });
    }

    limit = parsedLimit;
  }

  let decodedCursor: LogCursor | undefined;
  if (queryParams.cursor !== undefined) {
    if (typeof queryParams.cursor !== "string") {
      return res.status(400).json({ error: "Invalid cursor parameter" });
    }

    const cursor = decodeCursor(queryParams.cursor);
    if (cursor === null) {
      return res.status(400).json({ error: "Invalid cursor parameter" });
    }
    decodedCursor = cursor;
  }

  const filters = {
    service: queryParams.service,
    level: queryParams.level,
    since: queryParams.since,
    until: queryParams.until,
    attributes: attrs,
    q: queryParams.q?.toLowerCase(),
    limit: limit,
    cursor: decodedCursor,
  };

  try {
    const logRes = await queryLogs({
      ...filters,
      limit: limit + 1,
    });

    const hasNextPage = logRes.length > limit;
    const logs = hasNextPage ? logRes.slice(0, limit) : logRes;

    let next_cursor: string | null = null;

    if (hasNextPage) {
      const lastLog = logs.at(-1)!;

      next_cursor = encodeCursor({
        timestamp: lastLog.timestamp.toISOString(),
        id: lastLog.id,
      });
    }

    return res.status(200).json({
      logs,
      next_cursor,
    });
  } catch (error) {
    return res.status(502).json({
      error: `Cannot query logs from database; reason: ${error}`,
    });
  }
});

logsRouter.post("/", async (req: Request, res: Response) => {
  if (!validateRequest(req)) {
    res
      .status(400)
      .json({ error: "Top-level structure of the request body is not valid" });
    return;
  }

  const { validLogs, invalidLogs } = validateLogs(req.body.logs);

  if (validLogs.length > 0) {
    const timestamps: Date[] = validLogs.map((log) => new Date(log.timestamp));
    const services: string[] = validLogs.map((log) => log.service);
    const levels: string[] = validLogs.map((log) => log.level);
    const messages: string[] = validLogs.map((log) => log.message);
    const attributes: string[] = validLogs.map((log) =>
      JSON.stringify(log.attributes),
    );

    try {
      await storeLogs(timestamps, services, levels, messages, attributes);
    } catch (error) {
      console.log(error);
      res
        .status(502)
        .json({ error: `Cannot store logs to database; reason: ${error}` });
      return;
    }
  }

  res
    .status(
      (validLogs.length === 0 && invalidLogs.length === 0) ||
        validLogs.length !== 0
        ? 200
        : 400,
    )
    .json({ accepted: validLogs.length, rejected: invalidLogs });
});

logsRouter.get("/aggregate", async (req: Request, res: Response) => {
  const queryParams = {
    service: req.query.service,
    level: req.query.level,
    q: req.query.q,
    since: req.query.since,
    until: req.query.until,
    bucket: req.query.bucket,
    group_by: req.query.group_by,
  };

  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("attr.")) {
      const attrName = key.slice(5);
      if (typeof value === "string") {
        attrs[attrName] = value;
      }
    }
  }

  if (
    queryParams.service !== undefined &&
    typeof queryParams.service !== "string"
  ) {
    return res.status(400).json({
      error: "invalid service. Must be a string",
    });
  }

  if (
    queryParams.level !== undefined &&
    typeof queryParams.level !== "string"
  ) {
    return res.status(400).json({
      error: "invalid level. Must be a string",
    });
  }

  if (
    queryParams.level !== undefined &&
    !["debug", "info", "warn", "error"].includes(queryParams.level)
  ) {
    return res.status(400).json({
      error: "invalid level. Must be debug, info, warn, or error only",
    });
  }

  if (queryParams.q !== undefined) {
    if (typeof queryParams.q !== "string") {
      return res.status(400).json({
        error: "Invalid q parameter",
      });
    }
  }

  if (queryParams.since !== undefined) {
    if (typeof queryParams.since !== "string") {
      return res.status(400).json({
        error: "Invalid since timestamp",
      });
    }
    const isValidSince = isValidTimestamp(queryParams.since);
    if (!isValidSince.valid) {
      return res.status(400).json({
        error: "Invalid since timestamp",
      });
    }
  } else {
    return res
      .status(400)
      .json({ error: "since timestamp parameter is required" });
  }

  if (queryParams.until !== undefined) {
    if (typeof queryParams.until !== "string")
      return res.status(400).json({
        error: "Invalid until timestamp",
      });

    const isValidUntil = isValidTimestamp(queryParams.until);
    if (!isValidUntil.valid) {
      return res.status(400).json({
        error: "Invalid until timestamp",
      });
    }
  } else {
    return res
      .status(400)
      .json({ error: "until timestamp parameter is required" });
  }

  if (queryParams.since !== undefined && queryParams.until !== undefined) {
    if (Date.parse(queryParams.since) > Date.parse(queryParams.until))
      return res.status(400).json({
        error:
          "Invalid range: since & until timestamps combination are invalid",
      });
  }

  if (queryParams.bucket !== undefined) {
    if (typeof queryParams.bucket !== "string")
      return res.status(400).json({ error: "Invalid bucket parameter" });

    if (!["1m", "5m", "1h", "1d"].includes(queryParams.bucket))
      return res.status(400).json({
        error: `invalid bucket value: '${queryParams.bucket}'. Must be 1m, 5m, 1h, or 1d only`,
      });
  } else {
    return res.status(400).json({ error: "bucket parameter is required" });
  }

  if (queryParams.group_by !== undefined) {
    if (typeof queryParams.group_by !== "string")
      return res.status(400).json({ error: "invalid group_by parameter" });

    if (queryParams.group_by !== "level" && queryParams.group_by !== "service")
      return res.status(400).json({
        error: `invalid group_by parameter value:'${queryParams.group_by}'. Must be either level or service only`,
      });
  }

  const aggFilter: AggregateFilter = {
    since: queryParams.since!,
    until: queryParams.until!,
    bucket: queryParams.bucket!,
    service: queryParams.service,
    level: queryParams.level,
    group_by: queryParams.group_by,
    q: queryParams.q?.toLowerCase(),
    attributes: attrs,
  };

  try {
    const aggRes = await aggregateLogs(aggFilter);
    return res.status(200).json({
      buckets: aggRes.map((row) => ({
        start: new Date(row.start).toISOString(),
        group: row.group,
        count: Number(row.count),
      })),
    });
  } catch (error) {
    return res.status(502).json({
      error: `Cannot aggregate logs form db to the following error: ${error}`,
    });
  }
});
