import envs from "../../envs/envs.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: envs.dbURL,
});

export const db = drizzle({ client: pool });
