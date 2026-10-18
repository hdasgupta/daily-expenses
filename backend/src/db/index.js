import pg from "pg";
import { env } from "../config/env.js";
import { schemaSql, transactionSql } from "../../scripts/sql/schemaSql.js";

const { Pool, types } = pg;

// Return PostgreSQL DATE columns (OID 1082) as YYYY-MM-DD strings rather than
// JavaScript Date objects so backend services and PDF builders never corrupt
// dates via Date.prototype.toString().slice(0, 10).
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: env.databaseUrl,
  options: "-c timezone=Asia/Kolkata",
  ssl: env.databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  // Vercel may create many short-lived instances concurrently. A large pool
  // per instance can exhaust the database connection limit and make pool.connect
  // time out during startup. Keep the serverless default small; allow an explicit
  // DB_POOL_MAX override when the database plan supports it.
  max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL === "1" ? 2 : 10)),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
});

pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "database_pool_error",
      message: error?.message || String(error),
      stack: error?.stack,
    }),
  );
});

export function q(text, params = []) {
  return pool.query(text, params);
}

export async function checkDbConnection() {
  const startedAt = Date.now();
  try {
    await pool.query("SELECT 1");
    return {
      ok: true,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "database_health_check_failed",
        durationMs: Date.now() - startedAt,
        message: error?.message || String(error),
      }),
    );
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  }
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
