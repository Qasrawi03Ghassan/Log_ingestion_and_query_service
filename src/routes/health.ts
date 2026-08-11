import { Router, Request, Response } from "express";
import { isServiceReady, initService } from "../utils/initUtils.js";

const healthRouter = Router();

healthRouter.get("/", async (req: Request, res: Response) => {
  await initService();
  if (!isServiceReady)
    res.status(502).json({ Error: "Service is not ready yet" });
  else {
    res
      .status(200)
      .json({ Message: "Service is up and ready to receive logs" });
  }
});

export default healthRouter;
