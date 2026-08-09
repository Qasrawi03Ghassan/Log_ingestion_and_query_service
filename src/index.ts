import express, { Request, Response } from "express";
import envs from "./envs/envs.js";
import cors from "cors";
import healthRouter from "./routes/health.js";

const app = express();
const PORT = envs.mainPort;

app.use(express.json());
app.use("/health", healthRouter);
app.use("/logs", healthRouter);

app.use(cors());

app.get("/", (req: Request, res: Response) => {
  res.status(200).redirect("/health");
});

app.listen(PORT, () => {
  console.log(`Log service started on http://localhost:${PORT} ...`);
});

export default app;
