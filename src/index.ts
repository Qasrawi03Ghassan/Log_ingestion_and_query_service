import express, { NextFunction, Request, Response } from "express";
import envs from "./envs/envs.js";
import cors from "cors";
import healthRouter from "./routes/health.js";
import { logsRouter } from "./routes/logs.js";

const app = express();
const PORT = envs.mainPort;

app.use(express.json());
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      Error: "Invalid request, malformed JSON detected",
    });
  }

  next(err);
});
app.use("/health", healthRouter);
app.use("/logs", logsRouter);

app.use(cors());

app.get("/", (req: Request, res: Response) => {
  res.status(200).redirect("/health");
});

app.listen(PORT, () => {
  console.log(`Log service started on http://localhost:${PORT} ...`);
});

export default app;
