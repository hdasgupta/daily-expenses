import bcrypt from "bcryptjs";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
import { bootstrapSql } from "../../scripts/sql/bootstrapSql.js";

const permissions = [
  "add-expense",
  "add-survivor",
  "add-item",
  "add-unit",
  "bulk-upload-expenses",
  "bulk-upload-categories-items",
  "report",
  "dashboard",
  "add-user",
  "job-status",
];

const rolePermissions = {
  admin: permissions,
  editor: ["add-expense"],
  manager: [
    "add-expense",
    "add-survivor",
    "add-item",
    "add-unit",
    "report",
    "dashboard",
    "job-status",
  ],
};

export async function seedApplication() {
  // Batch-ensure permissions, roles, and role-permission mappings in 3 queries
  // instead of 31 sequential round-trips on every cold start.
  await q(
    `INSERT INTO public.permissions (code)
     SELECT DISTINCT UNNEST($1::text[])
     ON CONFLICT (code) DO NOTHING`,
    [permissions],
  );

  const roles = Object.keys(rolePermissions);
  await q(
    `INSERT INTO public.roles (name)
     SELECT DISTINCT UNNEST($1::text[])
     ON CONFLICT (name) DO NOTHING`,
    [roles],
  );

  const pairRoles = [];
  const pairCodes = [];
  for (const [role, codes] of Object.entries(rolePermissions)) {
    for (const code of codes) {
      pairRoles.push(role);
      pairCodes.push(code);
    }
  }
  await q(
    `INSERT INTO public.role_permissions (role_id, permission_id)
     SELECT r.id, p.id
     FROM UNNEST($1::text[], $2::text[]) AS pair(role_name, perm_code)
     JOIN public.roles r ON r.name = pair.role_name
     JOIN public.permissions p ON p.code = pair.perm_code
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [pairRoles, pairCodes],
  );

  // Skip expensive bcrypt hashing when the admin account already exists.
  const existingAdmin = await q(
    `SELECT 1 FROM public.users WHERE email = $1 LIMIT 1`,
    [env.adminEmail],
  );
  if (existingAdmin.rowCount === 0) {
    const hash = await bcrypt.hash(env.adminPassword, 12);
    await q(bootstrapSql.seedAdmin, [env.adminEmail, hash]);
  }
  await backfillMissingLocationsToAjodhyaHowrah();
}

async function backfillMissingLocationsToAjodhyaHowrah() {
  let locRes = await q(
    `SELECT id
       FROM public.marketing_locations
      WHERE LOWER(TRIM(name)) = 'ajodhya, howrah'
         OR (LOWER(name) LIKE '%ajodhya%' AND LOWER(name) LIKE '%howrah%')
      ORDER BY CASE WHEN LOWER(TRIM(name)) = 'ajodhya, howrah' THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
  );

  let locationId = locRes.rows[0]?.id || null;
  if (!locationId) {
    const inserted = await q(
      `INSERT INTO public.marketing_locations (name)
       VALUES ('Ajodhya, Howrah')
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
    );
    locationId = inserted.rows[0]?.id || null;
    if (!locationId) {
      locRes = await q(
        `SELECT id FROM public.marketing_locations WHERE LOWER(TRIM(name)) = 'ajodhya, howrah' LIMIT 1`,
      );
      locationId = locRes.rows[0]?.id || null;
    }
  }

  if (!locationId) return;

  await Promise.all([
    q(`UPDATE public.expenses SET location_id = $1 WHERE location_id IS NULL`, [locationId]),
    q(`UPDATE public.marketing_list_items SET location_id = $1 WHERE location_id IS NULL`, [
      locationId,
    ]),
    q(`UPDATE public.food_chart_entries SET location_id = $1 WHERE location_id IS NULL`, [
      locationId,
    ]),
  ]);
}
