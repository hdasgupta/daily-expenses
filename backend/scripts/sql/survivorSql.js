export const survivorSql = {
  count: `SELECT COUNT(*) FROM survivors
    WHERE full_name ILIKE $1 OR COALESCE(nickname,'') ILIKE $1 OR COALESCE(pincode,'') ILIKE $1
      OR COALESCE(district,'') ILIKE $1 OR COALESCE(state,'') ILIKE $1`,
  list: (sortColumn = "full_name", direction = "asc") => {
    const sortMap = {
      full_name: "full_name",
      nickname: "nickname",
      district: "district",
      state: "state",
      pincode: "pincode",
      created_at: "created_at",
    };
    const sort = sortMap[sortColumn] || sortMap.full_name;
    const dir = String(direction).toLowerCase() === "desc" ? "DESC" : "ASC";
    return `SELECT * FROM survivors
      WHERE full_name ILIKE $1 OR COALESCE(nickname,'') ILIKE $1 OR COALESCE(pincode,'') ILIKE $1
        OR COALESCE(district,'') ILIKE $1 OR COALESCE(state,'') ILIKE $1
      ORDER BY ${sort} ${dir} LIMIT $2 OFFSET $3`;
  },
  create: `INSERT INTO survivors(full_name,father_name,mother_name,nickname,house_no,street,area,village_city,pincode,district,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  update: `UPDATE survivors SET full_name=$1,father_name=$2,mother_name=$3,nickname=$4,house_no=$5,street=$6,
    area=$7,village_city=$8,pincode=$9,district=$10,state=$11,updated_at=now() WHERE id=$12 RETURNING *`,
  delete: "DELETE FROM survivors WHERE id=$1",
  meta: "SELECT id,full_name,nickname FROM survivors ORDER BY full_name",
};
