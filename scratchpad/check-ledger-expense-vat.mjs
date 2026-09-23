import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const id = "1ca7e0d2-b298-4c5b-9033-3a35d9b2d918";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
  `select * from ledger_expense where id = $1`,
  [id],
);

console.log(JSON.stringify(rows, null, 2));
await client.end();
