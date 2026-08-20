import envs from "../../envs/envs.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: envs.dbURL,
  max: 8, //10 ==> about 9.5k // 5 ==> about ?? // 8 ==> about ??*/
});

export const db = drizzle({ client: pool });
