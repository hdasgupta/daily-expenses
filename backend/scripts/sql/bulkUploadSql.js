export const bulkUploadSql = {
  categoryByName: "SELECT id FROM public.categories WHERE lower(name)=lower($1)",
  itemByName: "SELECT id FROM public.items WHERE category_id=$1 AND lower(name)=lower($2)",
  unitByName: "SELECT id FROM public.units WHERE lower(name)=lower($1)",
  survivors: "SELECT id,full_name FROM public.survivors ORDER BY full_name",
  insertExpense: `INSERT INTO public.expenses(expense_date,category_id,item_id,other_item,quantity,unit_id,total_cost,expense_type,comment,created_by,source_added_by,source_added_on)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  insertShare:
    "INSERT INTO public.expense_shares(expense_id,survivor_id,share_type,amount) VALUES($1,$2,$3,$4)",
  categoryUpsert: `INSERT INTO public.categories(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET updated_at=now() RETURNING id`,
  itemIgnore:
    "INSERT INTO public.items(category_id,name) VALUES($1,$2) ON CONFLICT(category_id,name) DO NOTHING",
};
