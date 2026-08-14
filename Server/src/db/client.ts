import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://param@localhost:5432/exchange",
  max: 20,
});

pool.on("error", (err) => {
  console.error("Unexpected pg pool error", err);
});

export const db = drizzle(pool, { schema });
export { schema };
