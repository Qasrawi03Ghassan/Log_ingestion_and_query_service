import { test, expect, describe } from "vitest";
import app from "../src/index";
import { isServiceReady } from "../src/utils/initUtils";
import request from "supertest";

describe("/health endpoint tests:", () => {
  test("GET /health Endpoint must return 200 status code when database is started, 502 if not", async () => {
    const req = await request(app).get("/health");
    isServiceReady
      ? expect(req.status).toEqual(200)
      : expect(req.status).toEqual(502);
  });
});
