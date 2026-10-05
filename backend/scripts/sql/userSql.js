export const userSql = {
  findById: `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.password_hash,
      u.is_disabled,
      u.whatsapp_number,
      u.whatsapp_verified_at,
      u.whatsapp_pending_number,
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
      u.whatsapp_number,
      u.whatsapp_verified_at,
      u.whatsapp_pending_number,
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
      u.whatsapp_number,
      u.whatsapp_verified_at,
      u.whatsapp_pending_number,
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
  updateProfileName: "UPDATE public.users SET full_name=$1,updated_at=now() WHERE id=$2",

  delete: "DELETE FROM public.users WHERE id=$1",

  roles: "SELECT id,name FROM public.roles ORDER BY name",

  setPendingWhatsApp:
    "UPDATE public.users SET whatsapp_pending_number=$1,updated_at=now() WHERE id=$2",
  setVerifiedWhatsApp:
    "UPDATE public.users SET whatsapp_number=$1,whatsapp_verified_at=now(),whatsapp_pending_number=NULL,updated_at=now() WHERE id=$2",
  clearWhatsApp:
    "UPDATE public.users SET whatsapp_number=NULL,whatsapp_verified_at=NULL,whatsapp_pending_number=NULL,updated_at=now() WHERE id=$1",
  findVerifiedWhatsAppOwner:
    "SELECT id FROM public.users WHERE whatsapp_number=$1 AND id<>$2 LIMIT 1",
  createWhatsAppOtp:
    "INSERT INTO public.whatsapp_otps(user_id,phone_number,otp_hash,expires_at,purpose) VALUES($1,$2,$3,$4,$5)",
  invalidateWhatsAppOtps:
    "UPDATE public.whatsapp_otps SET used=true WHERE user_id=$1 AND used=false",
  latestWhatsAppOtp:
    "SELECT id,created_at FROM public.whatsapp_otps WHERE user_id=$1 AND used=false ORDER BY created_at DESC LIMIT 1",
  latestWhatsAppOtpForNumber:
    "SELECT id,otp_hash,attempts FROM public.whatsapp_otps WHERE user_id=$1 AND phone_number=$2 AND purpose=$3 AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
  incrementWhatsAppOtpAttempts:
    "UPDATE public.whatsapp_otps SET attempts=attempts+1 WHERE id=$1",
  markWhatsAppOtpUsed:
    "UPDATE public.whatsapp_otps SET used=true WHERE id=$1",

  managers:
    "SELECT email FROM public.users u JOIN public.roles r ON r.id=u.role_id WHERE r.name IN ('manager', 'admin') AND u.is_disabled=false ORDER BY CASE WHEN r.name='manager' THEN 1 WHEN r.name='admin' THEN 2 ELSE 3 END, u.email",
};
