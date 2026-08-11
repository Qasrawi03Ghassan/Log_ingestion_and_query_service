import { db } from "../index.js";
import { logs } from "../schemas/schema.js";
import { log } from "../../../utils/validators/logsValidators.js";

export async function storeLogs(validLogs: log[]) {
  await db.insert(logs).values(validLogs);
}
