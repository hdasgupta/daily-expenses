import pg from "pg";
import { env } from "../config/env.js";
import { schemaSql, transactionSql } from "../../scripts/sql/schemaSql.js";

const { Pool } = pg;
export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export function q(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query(transactionSql.begin);
    const result = await work(client);
    await client.query(transactionSql.commit);
    return result;
  } catch (error) {
    await client.query(transactionSql.rollback);
    throw error;
  } finally {
    client.release();
  }
}

export async function initDb() {
  await q(schemaSql);
}
