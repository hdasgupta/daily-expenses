export const userSql = {
  findById: `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.password_hash,
      u.is_disabled,
      r.name AS role,
      COALESCE(
        ARRAY_AGG(p.code ORDER BY p.code)
          FILTER (WHERE p.code IS NOT NULL),
        '{}'
      ) AS permissions
    FROM public.users u
    JOIN public.roles r
      ON r.id = u.role_id
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
    LEFT JOIN public.permissions p
      ON p.id = rp.permission_id
    WHERE u.id = $1
    GROUP BY u.id, r.name
  `,

  findByEmail: `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.password_hash,
      u.is_disabled,
      r.name AS role,
      COALESCE(
        ARRAY_AGG(p.code ORDER BY p.code)
          FILTER (WHERE p.code IS NOT NULL),
        '{}'
      ) AS permissions
    FROM public.users u
    JOIN public.roles r
      ON r.id = u.role_id
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
    LEFT JOIN public.permissions p
      ON p.id = rp.permission_id
    WHERE lower(u.email) = lower($1)
    GROUP BY u.id, r.name
  `,

  userCount: `
    SELECT COUNT(*)
    FROM public.users u
    JOIN public.roles r
      ON r.id = u.role_id
    WHERE u.full_name ILIKE $1
       OR u.email ILIKE $1
       OR r.name ILIKE $1
  `,

  userList: (sort, dir) => `
    SELECT
      u.id,
      u.full_name,
      u.email,
      r.name AS role,
      u.is_disabled,
      u.created_at
    FROM public.users u
    JOIN public.roles r
      ON r.id = u.role_id
    WHERE u.full_name ILIKE $1
       OR u.email ILIKE $1
       OR r.name ILIKE $1
    ORDER BY ${sort} ${dir}
    LIMIT $2
    OFFSET $3
  `,

  create: `
    INSERT INTO public.users(
      full_name,
      email,
      password_hash,
      role_id
    )
    SELECT
      $1,
      $2,
      $3,
      id
    FROM public.roles
    WHERE name = $4
    RETURNING id, full_name, email, role_id
  `,

  roleByName: "SELECT id FROM public.roles WHERE name=$1",

  update:
    "UPDATE public.users SET full_name=$1,email=$2,role_id=$3,is_disabled=$4,updated_at=now() WHERE id=$5",

  updatePassword: "UPDATE public.users SET password_hash=$1,updated_at=now() WHERE id=$2",

  delete: "DELETE FROM public.users WHERE id=$1",

  roles: "SELECT id,name FROM public.roles ORDER BY name",

  managers:
    "SELECT DISTINCT LOWER(BTRIM(u.email)) AS email FROM public.users u JOIN public.roles r ON r.id=u.role_id WHERE LOWER(BTRIM(r.name)) IN ('manager', 'admin') AND u.is_disabled=false AND NULLIF(BTRIM(u.email), '') IS NOT NULL ORDER BY email",
};
