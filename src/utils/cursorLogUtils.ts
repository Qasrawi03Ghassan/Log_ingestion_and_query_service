import { isValidTimestamp } from "./validators/logsValidators.js";

export type LogCursor = {
  timestamp: string;
  id: string;
};

export function encodeCursor(cursor: LogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(cursor: string): LogCursor | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);

    if (typeof parsed.timestamp !== "string" || typeof parsed.id !== "string") {
      return null;
    }

    if (!isValidTimestamp(parsed.timestamp).valid) {
      return null;
    }

    return {
      timestamp: parsed.timestamp,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}
