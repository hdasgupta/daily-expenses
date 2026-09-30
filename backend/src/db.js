import pg from "pg";
import dotenv from "dotenv";
dotenv.config();
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});
export async function q(text, params = []) {
  return pool.query(text, params);
}
export async function initDb() {
  await q(
    `CREATE TABLE IF NOT EXISTS roles(id SERIAL PRIMARY KEY,name VARCHAR(50) UNIQUE NOT NULL);`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS permissions(id SERIAL PRIMARY KEY,code VARCHAR(100) UNIQUE NOT NULL);`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS role_permissions(role_id INT REFERENCES roles(id) ON DELETE CASCADE,permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,PRIMARY KEY(role_id,permission_id));`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,full_name VARCHAR(150) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,password_hash TEXT NOT NULL,role_id INT REFERENCES roles(id),is_disabled BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS survivors(id BIGSERIAL PRIMARY KEY,full_name VARCHAR(200) NOT NULL,father_name VARCHAR(200),mother_name VARCHAR(200),nickname VARCHAR(100),house_no VARCHAR(100),street VARCHAR(200),area VARCHAR(200),village_city VARCHAR(150),pincode VARCHAR(10),district VARCHAR(100),state VARCHAR(100),created_at TIMESTAMPTZ NOT NULL DEFAULT now());`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS categories(id BIGSERIAL PRIMARY KEY,name VARCHAR(150) UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS items(id BIGSERIAL PRIMARY KEY,category_id BIGINT REFERENCES categories(id) ON DELETE CASCADE,name VARCHAR(150) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(category_id,name));`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS units(id BIGSERIAL PRIMARY KEY,name VARCHAR(100) UNIQUE NOT NULL);`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS expenses(id BIGSERIAL PRIMARY KEY,expense_date DATE NOT NULL,category_id BIGINT REFERENCES categories(id),item_id BIGINT REFERENCES items(id),other_item TEXT,quantity NUMERIC,unit_id BIGINT REFERENCES units(id),total_cost NUMERIC(14,2) NOT NULL CHECK(total_cost>=0),expense_type VARCHAR(20) NOT NULL DEFAULT 'cash',proof_key TEXT,created_by BIGINT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS expense_shares(id BIGSERIAL PRIMARY KEY,expense_id BIGINT REFERENCES expenses(id) ON DELETE CASCADE,survivor_id BIGINT REFERENCES survivors(id) ON DELETE CASCADE,share_type VARCHAR(20) NOT NULL,amount NUMERIC(14,2),UNIQUE(expense_id,survivor_id));`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS report_selections(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(150) NOT NULL,config JSONB NOT NULL,UNIQUE(user_id,name));`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS pagination_settings(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,module VARCHAR(100) NOT NULL,page_size INT NOT NULL DEFAULT 10,search_text TEXT DEFAULT '',sort_column TEXT,sort_direction VARCHAR(4) DEFAULT 'asc',UNIQUE(user_id,module));`,
  );
  await q(
    `CREATE TABLE IF NOT EXISTS password_otps(id BIGSERIAL PRIMARY KEY,email VARCHAR(255) NOT NULL,otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used BOOLEAN NOT NULL DEFAULT FALSE);`,
  );
  const perms = [
    "add-expense",
    "add-survivor",
    "add-item",
    "add-unit",
    "bulk-upload-expenses",
    "bulk-upload-categories-items",
    "report",
    "dashboard",
    "add-user",
  ];
  for (const p of perms)
    await q("INSERT INTO permissions(code) VALUES($1) ON CONFLICT DO NOTHING", [
      p,
    ]);
  for (const r of ["admin", "editor", "manager"])
    await q("INSERT INTO roles(name) VALUES($1) ON CONFLICT DO NOTHING", [r]);
  const maps = {
    admin: perms,
    editor: ["add-expense"],
    manager: ["add-expense", "report", "dashboard"],
  };
  for (const [role, codes] of Object.entries(maps)) {
    for (const code of codes)
      await q(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p WHERE r.name=$1 AND p.code=$2 ON CONFLICT DO NOTHING`,
        [role, code],
      );
  }
  const bcrypt = await import("bcryptjs");
  const email = process.env.ADMIN_EMAIL || "wbffmh@gmail.com";
  const pass = process.env.ADMIN_PASSWORD || "Admin@12345";
  const hash = await bcrypt.default.hash(pass, 12);
  await q(
    `INSERT INTO users(full_name,email,password_hash,role_id) SELECT 'System Administrator',$1,$2,id FROM roles WHERE name='admin' ON CONFLICT(email) DO NOTHING`,
    [email, hash],
  );
  const defaults = [
    "Food",
    "Medicines",
    "Medical",
    "Vegetables",
    "Groceries",
    "Dairy Products",
    "Rice",
    "Poultry",
    "Non veg",
    "Water",
    "Travel",
    "Saloon",
    "Rent",
    "Others",
  ];
  for (const c of defaults)
    await q("INSERT INTO categories(name) VALUES($1) ON CONFLICT DO NOTHING", [
      c,
    ]);
  const units = [
    "piece",
    "kg",
    "g",
    "litre",
    "ml",
    "packet",
    "box",
    "bottle",
    "day",
    "month",
    "trip",
  ];
  for (const u of units)
    await q("INSERT INTO units(name) VALUES($1) ON CONFLICT DO NOTHING", [u]);
}
