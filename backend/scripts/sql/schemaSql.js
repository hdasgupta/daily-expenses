export const transactionSql = {
  begin: "BEGIN",
  commit: "COMMIT",
  rollback: "ROLLBACK",
  savepoint: "SAVEPOINT csv_row",
  rollbackSavepoint: "ROLLBACK TO SAVEPOINT csv_row",
  releaseSavepoint: "RELEASE SAVEPOINT csv_row",
};

export const schemaSql = `
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INT NOT NULL REFERENCES roles(id),
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS survivors (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  father_name VARCHAR(200),
  mother_name VARCHAR(200),
  nickname VARCHAR(100),
  house_no VARCHAR(100),
  street VARCHAR(200),
  area VARCHAR(200),
  village_city VARCHAR(150),
  pincode VARCHAR(10),
  district VARCHAR(100),
  state VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category_id, name)
);
CREATE TABLE IF NOT EXISTS units (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_date DATE NOT NULL,
  category_id BIGINT NOT NULL REFERENCES categories(id),
  item_id BIGINT REFERENCES items(id),
  other_item TEXT,
  quantity NUMERIC(14, 4),
  unit_id BIGINT REFERENCES units(id),
  total_cost NUMERIC(14, 2) NOT NULL CHECK(total_cost >= 0),
  expense_type VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK(expense_type IN ('cash', 'online')),
  comment TEXT,
  proof_key TEXT,
  proof_google_docs_id TEXT,
  contract_download_url TEXT,
  source_added_by TEXT,
  source_added_on TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expense_shares (
  id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  survivor_id BIGINT NOT NULL REFERENCES survivors(id),
  share_type VARCHAR(20) NOT NULL CHECK(share_type IN ('fixed', 'average', 'remaining')),
  amount NUMERIC(14, 2) NOT NULL CHECK(amount >= 0),
  UNIQUE(expense_id, survivor_id)
);
CREATE TABLE IF NOT EXISTS report_selections (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS pagination_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module VARCHAR(100) NOT NULL,
  page_size INT NOT NULL DEFAULT 10 CHECK(page_size IN (5,10,20,50)),
  search_text TEXT NOT NULL DEFAULT '',
  sort_column TEXT,
  sort_direction VARCHAR(4) NOT NULL DEFAULT 'asc' CHECK(sort_direction IN ('asc','desc')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, module)
);
CREATE TABLE IF NOT EXISTS password_otps (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS proof_google_docs_id TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS contract_download_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_added_by TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_added_on TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_shares_expense ON expense_shares(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_shares_survivor ON expense_shares(survivor_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_remaining_share_per_expense ON expense_shares(expense_id) WHERE share_type = 'remaining';
`;
