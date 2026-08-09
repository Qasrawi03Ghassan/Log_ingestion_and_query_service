import express, { Request, Response } from "express";
import envs from "./envs/envs.js";
import cors from "cors";

const app = express();
const PORT = envs.mainPort;

app.use(express.json());
app.use(cors());

app.get("/", (req: Request, res: Response) => {
  res.status(200).redirect("/health");
});

app.get("/health", async (req: Request, res: Response) => {
  res.status(200).json({ Message: "Service is up!" });
});

app.listen(PORT, () => {
  console.log(`Log service started on http://localhost:${PORT} ...`);
});

export default app;
