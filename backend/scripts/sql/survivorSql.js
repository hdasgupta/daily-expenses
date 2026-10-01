export const survivorSql = {
  count: `SELECT COUNT(*) FROM public.survivors
    WHERE full_name ILIKE $1 OR COALESCE(nickname,'') ILIKE $1 OR COALESCE(pincode,'') ILIKE $1
      OR COALESCE(district,'') ILIKE $1 OR COALESCE(state,'') ILIKE $1`,
  list: (sort, dir) => `SELECT * FROM public.survivors
    WHERE full_name ILIKE $1 OR COALESCE(nickname,'') ILIKE $1 OR COALESCE(pincode,'') ILIKE $1
      OR COALESCE(district,'') ILIKE $1 OR COALESCE(state,'') ILIKE $1
    ORDER BY ${sort} ${dir} LIMIT $2 OFFSET $3`,
  create: `INSERT INTO public.survivors(full_name,father_name,mother_name,nickname,house_no,street,area,village_city,pincode,district,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  update: `UPDATE public.survivors SET full_name=$1,father_name=$2,mother_name=$3,nickname=$4,house_no=$5,street=$6,
    area=$7,village_city=$8,pincode=$9,district=$10,state=$11,updated_at=now() WHERE id=$12 RETURNING *`,
  delete: "DELETE FROM public.survivors WHERE id=$1",
  meta: "SELECT id,full_name,nickname FROM public.survivors ORDER BY full_name",
};
