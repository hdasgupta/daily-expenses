export const bootstrapSql = {
  insertPermission: "INSERT INTO permissions(code) VALUES($1) ON CONFLICT(code) DO NOTHING",
  insertRole: "INSERT INTO roles(name) VALUES($1) ON CONFLICT(name) DO NOTHING",
  linkRolePermission: `INSERT INTO role_permissions(role_id,permission_id)
    SELECT r.id,p.id FROM roles r,permissions p
    WHERE r.name=$1 AND p.code=$2 ON CONFLICT DO NOTHING`,
  seedAdmin: `INSERT INTO users(full_name,email,password_hash,role_id)
    SELECT 'System Administrator',$1,$2,id FROM roles WHERE name='admin'
    ON CONFLICT(email) DO NOTHING`,
};
