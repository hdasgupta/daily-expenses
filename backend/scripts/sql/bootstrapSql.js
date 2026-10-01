export const bootstrapSql = {
  insertPermission: "INSERT INTO public.permissions(code) VALUES($1) ON CONFLICT(code) DO NOTHING",
  insertRole: "INSERT INTO public.roles(name) VALUES($1) ON CONFLICT(name) DO NOTHING",
  linkRolePermission: `INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT r.id,p.id FROM public.roles r,public.permissions p
    WHERE r.name=$1 AND p.code=$2 ON CONFLICT DO NOTHING`,
  seedAdmin: `INSERT INTO public.users(full_name,email,password_hash,role_id)
    SELECT 'System Administrator',$1,$2,id FROM public.roles WHERE name='admin'
    ON CONFLICT(email) DO NOTHING`,
};
