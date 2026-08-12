import { Request } from "express";

export type log = {
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  message: string;
  attributes?: JSON;
};

export function validateRequest(req: Request): boolean {
  const reqBody = req.body;
  const logsArr: log[] = reqBody.logs;
  if (!logsArr || !Array.isArray(logsArr)) return false;
  return true;
}

export function validateLogs(logs: log[]) {
  let validLogs: log[] = [];
  let invalidLogs: {
    index: number;
    reason: string;
  }[] = [];

  for (let [index, log] of logs.entries()) {
    let item = validateLog(log);
    if (item.valid === true) {
      validLogs.push(log);
    } else invalidLogs.push({ index, reason: item.reason });
  }
  return { validLogs, invalidLogs };
}

function validateLog(log: log) {
  let timestamp = log.timestamp;
  let level = log.level;
  let service_name = log.service;
  let message = log.message;
  let attributes = log.attributes;

  if (!timestamp || !level || !service_name || !message)
    return {
      valid: false,
      reason: "one or more of the required parameters are missing or empty",
    };

  const isValidTs = isValidTimestamp(timestamp, true);
  if (!isValidTs.valid) {
    return isValidTs;
  }

  if (
    level !== "debug" &&
    level !== "info" &&
    level !== "error" &&
    level !== "warn"
  )
    return {
      valid: false,
      reason: `Invalid level: '${level}'. Use info, debug, error, or warn only`,
    };
  if (typeof service_name !== "string")
    return {
      valid: false,
      reason: "service name has invalid input format",
    };
  if (typeof message !== "string")
    return {
      valid: false,
      reason: "message has invalid input format",
    };

  if (attributes !== undefined) {
    return isValidAttributes(attributes);
  }

  return {
    valid: true,
    reason: "ok",
  };
}

export function isValidTimestamp(
  timestamp: unknown,
  isIngest: boolean = false,
): {
  valid: boolean;
  reason: string;
} {
  if (
    typeof timestamp !== "string" ||
    timestamp === null ||
    Array.isArray(timestamp)
  ) {
    return { valid: false, reason: "Invalid timestamp input format" };
  }

  const timestampRegex: RegExp =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!timestampRegex.test(timestamp)) {
    return {
      valid: false,
      reason: "Invalid timestamp input format",
    };
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    return {
      valid: false,
      reason: "Invalid timestamp input format",
    };
  }

  if (isIngest && !isFutureValid(timestamp, 5 * 60 * 1000))
    return {
      valid: false,
      reason: "Invalid timestamp, must not exceed 5 minutes in the future",
    };

  return { valid: true, reason: "ok" };
}

function isFutureValid(timestamp: string, durationMs: number) {
  const mDate = Date.parse(timestamp);
  return mDate <= Date.now() + durationMs;
}

function isValidAttributes(attributes: unknown): {
  valid: boolean;
  reason: string;
} {
  if (attributes === undefined)
    return {
      valid: true,
      reason: "ok",
    };

  if (
    typeof attributes !== "object" ||
    attributes === null ||
    Array.isArray(attributes)
  ) {
    return { valid: false, reason: "Invalid attributes object format" };
  }

  for (let [key, value] of Object.entries(attributes)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return {
        valid: false,
        reason: `Invalid input format for attribute '${key}', must be a number, a string, or a boolean only`,
      };
    }
  }

  return { valid: true, reason: "ok" };
}
