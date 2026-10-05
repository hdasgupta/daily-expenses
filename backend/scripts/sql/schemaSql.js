export const transactionSql = {
  begin: "BEGIN",
  commit: "COMMIT",
  rollback: "ROLLBACK",
  savepoint: "SAVEPOINT csv_row",
  rollbackSavepoint: "ROLLBACK TO SAVEPOINT csv_row",
  releaseSavepoint: "RELEASE SAVEPOINT csv_row",
};

export const schemaSql = `
CREATE TABLE IF NOT EXISTS public.roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS public.permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id INT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INT NOT NULL REFERENCES public.roles(id),
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.survivors (
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
CREATE TABLE IF NOT EXISTS public.categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.items (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category_id, name)
);
CREATE TABLE IF NOT EXISTS public.units (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_date DATE NOT NULL,
  category_id BIGINT NOT NULL REFERENCES public.categories(id),
  item_id BIGINT REFERENCES public.items(id),
  other_item TEXT,
  quantity NUMERIC(14, 4),
  unit_id BIGINT REFERENCES public.units(id),
  total_cost NUMERIC(14, 2) NOT NULL CHECK(total_cost >= 0),
  expense_type VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK(expense_type IN ('cash', 'online')),
  comment TEXT,
  proof_key TEXT,
  proof_google_docs_id TEXT,
  contract_download_url TEXT,
  source_added_by TEXT,
  source_added_on TIMESTAMPTZ,
  created_by BIGINT REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.expense_shares (
  id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  survivor_id BIGINT NOT NULL REFERENCES public.survivors(id),
  share_type VARCHAR(20) NOT NULL CHECK(share_type IN ('fixed', 'average', 'remaining')),
  amount NUMERIC(14, 2) NOT NULL CHECK(amount >= 0),
  UNIQUE(expense_id, survivor_id)
);
CREATE TABLE IF NOT EXISTS public.report_selections (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS public.pagination_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  module VARCHAR(100) NOT NULL,
  page_size INT NOT NULL DEFAULT 10 CHECK(page_size IN (5,10,20,50)),
  search_text TEXT NOT NULL DEFAULT '',
  sort_column TEXT,
  sort_direction VARCHAR(4) NOT NULL DEFAULT 'asc' CHECK(sort_direction IN ('asc','desc')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, module)
);
CREATE TABLE IF NOT EXISTS public.scheduler_job_runs (
  job_name VARCHAR(100) NOT NULL,
  scheduled_key VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK(status IN ('running','completed','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  PRIMARY KEY (job_name, scheduled_key)
);
ALTER TABLE public.scheduler_job_runs ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE public.scheduler_job_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.scheduler_job_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE public.scheduler_job_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.scheduler_job_runs ALTER COLUMN completed_at DROP NOT NULL;
UPDATE public.scheduler_job_runs
SET status = COALESCE(status, 'completed'),
    started_at = COALESCE(started_at, completed_at, now())
WHERE status IS NULL OR started_at IS NULL;
CREATE TABLE IF NOT EXISTS public.scheduler_job_executions (
  id BIGSERIAL PRIMARY KEY,
  job_name VARCHAR(100) NOT NULL,
  scheduled_key VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','completed','failed','skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_scheduler_job_executions_started_at
  ON public.scheduler_job_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_job_executions_job_name
  ON public.scheduler_job_executions(job_name, started_at DESC);
-- Keep one persisted execution record per common job and reporting period.
-- Older failed retries may have produced duplicate rows, so retain the latest row before adding the constraint.
DELETE FROM public.scheduler_job_executions e
WHERE e.scheduled_key IS NOT NULL
  AND e.id IN (
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY job_name, scheduled_key
               ORDER BY CASE WHEN status = 'completed' THEN 0 ELSE 1 END, id DESC
             ) AS row_number
      FROM public.scheduler_job_executions
      WHERE scheduled_key IS NOT NULL
    ) ranked
    WHERE row_number > 1
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduler_job_executions_period
  ON public.scheduler_job_executions(job_name, scheduled_key)
  WHERE scheduled_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.scheduled_report_jobs (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  report_key VARCHAR(100) NOT NULL,
  frequency VARCHAR(10) NOT NULL CHECK(frequency IN ('daily','weekly','monthly','yearly')),
  time_of_day TIME NOT NULL,
  day_of_week SMALLINT CHECK(day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  day_of_month SMALLINT CHECK(day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),
  month_of_year SMALLINT CHECK(month_of_year IS NULL OR (month_of_year >= 1 AND month_of_year <= 12)),
  cron_expression VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_report_jobs_owner
  ON public.scheduled_report_jobs(owner_user_id, active);
CREATE INDEX IF NOT EXISTS idx_scheduled_report_jobs_active
  ON public.scheduled_report_jobs(active, frequency, time_of_day);
CREATE TABLE IF NOT EXISTS public.password_otps (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS proof_google_docs_id TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS contract_download_url TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS source_added_by TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS source_added_on TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_shares_expense ON public.expense_shares(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_shares_survivor ON public.expense_shares(survivor_id);
CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_started_at
  ON public.scheduler_job_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_job_name
  ON public.scheduler_job_runs(job_name, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_remaining_share_per_expense ON public.expense_shares(expense_id) WHERE share_type = 'remaining';
`;
