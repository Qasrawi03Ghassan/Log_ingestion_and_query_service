import envs from "../../envs/envs.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: envs.dbURL,
  max: 10, //10 ==> about 9.5k // 5 ==> about ?? // 8 ==> about ??*/
});

export const queryPool = new Pool({
  connectionString: envs.dbURL,
  max: 4,
});

export const db = drizzle({ client: pool });
export const queryDB = drizzle({ client: queryPool });
