import { defineConfig } from "drizzle-kit";
import envs from "../../../envs/envs.js";

export default defineConfig({
  out: "./src/lib/db/migrations",
  schema: "./src/lib/db/schemas/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: envs.dbURL,
  },
});
