export const reportModelSql = {
  list: "SELECT id,name,config,created_at,updated_at FROM public.report_selections WHERE user_id=$1 ORDER BY name",
  save: `INSERT INTO public.report_selections(user_id,name,config) VALUES($1,$2,$3)
    ON CONFLICT(user_id,name) DO UPDATE SET config=EXCLUDED.config,updated_at=now() RETURNING id,name,config`,
  delete: "DELETE FROM public.report_selections WHERE id=$1 AND user_id=$2",
};
