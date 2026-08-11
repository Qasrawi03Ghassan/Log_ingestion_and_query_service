import { Router, Request, Response } from "express";
import {
  validateLogs,
  validateRequest,
} from "../utils/validators/logsValidators.js";

export const logsRouter = Router();

logsRouter.get("/", (req: Request, res: Response) => {
  res.status(200).json({ Message: "Must get all logs" });
});

logsRouter.post("/", (req: Request, res: Response) => {
  if (!validateRequest(req)) {
    res
      .status(400)
      .json({ Error: "Top-level structure of the request body is not valid" });
    return;
  }

  const { validLogs, invalidLogs } = validateLogs(req.body.logs);

  res
    .status(
      (validLogs.length === 0 && invalidLogs.length === 0) ||
        validLogs.length !== 0
        ? 200
        : 400,
    )
    .json({ accepted: validLogs.length, rejected: invalidLogs });
});

logsRouter.get("/aggregate", (req: Request, res: Response) => {
  res.status(200).json({ Message: "Must return time-bucketed log counts" });
});
