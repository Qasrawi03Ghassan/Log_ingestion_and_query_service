import { Router, Request, Response } from "express";

export const logsRouter = Router();

logsRouter.get("/", (req: Request, res: Response) => {
  res.status(200).json({ Message: "Must get all logs" });
});

logsRouter.post("/", (req: Request, res: Response) => {
  res.status(200).json({ Message: "Must ingest received logs batch" });
});

logsRouter.get("/aggregate", (req: Request, res: Response) => {
  res.status(200).json({ Message: "Must return time-bucketed log counts" });
});
