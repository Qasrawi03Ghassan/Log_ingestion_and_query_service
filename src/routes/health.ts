import { Router, Request, Response } from "express";
import { isServiceReady, initService } from "../utils/utils.js";

const healthRouter = Router();

healthRouter.get("/", (req: Request, res: Response) => {
  if (!isServiceReady)
    res.status(502).json({ Message: "Service is not ready yet" });
  else {
    res
      .status(200)
      .json({ Message: "Service is up and ready to receive logs" });
  }
});

export default healthRouter;
