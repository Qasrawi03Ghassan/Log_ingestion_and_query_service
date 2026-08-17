import envs from "../../envs/envs.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: envs.dbURL,
  min: 1,
  max: 8, //10 ==> about 7k // 5 ==> about 8K // 8 ==> about 8.4K
});

export const db = drizzle({ client: pool });
