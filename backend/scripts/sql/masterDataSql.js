export const masterDataSql = {
  categories: "SELECT id,name FROM public.categories ORDER BY name",
  addCategory: "INSERT INTO public.categories(name) VALUES($1) RETURNING id,name",
  updateCategory:
    "UPDATE public.categories SET name=$1,updated_at=now() WHERE id=$2 RETURNING id,name",
  deleteCategory: "DELETE FROM public.categories WHERE id=$1",
  itemSearchCondition: "i.name ILIKE $1",
  itemCategoryCondition: (index) => `i.category_id=$${index}`,
  itemCount: (where) => `SELECT COUNT(*) FROM public.items i WHERE ${where}`,
  items: (where, orderBy, limitParam, offsetParam) =>
    `SELECT i.id,i.name,i.category_id,c.name AS category FROM public.items i JOIN public.categories c ON c.id=i.category_id WHERE ${where} ORDER BY ${orderBy} LIMIT ${limitParam} OFFSET ${offsetParam}`,
  addItem: "INSERT INTO public.items(category_id,name) VALUES($1,$2) RETURNING id,category_id,name",
  updateItem:
    "UPDATE public.items SET category_id=$1,name=$2,updated_at=now() WHERE id=$3 RETURNING id,category_id,name",
  deleteItem: "DELETE FROM public.items WHERE id=$1",
  unitCount: "SELECT COUNT(*) FROM public.units WHERE name ILIKE $1",
  units: (sort, dir) =>
    `SELECT id,name,created_at FROM public.units WHERE name ILIKE $1 ORDER BY ${sort} ${dir} LIMIT $2 OFFSET $3`,
  addUnit: "INSERT INTO public.units(name) VALUES($1) RETURNING id,name",
  updateUnit: "UPDATE public.units SET name=$1,updated_at=now() WHERE id=$2 RETURNING id,name",
  deleteUnit: "DELETE FROM public.units WHERE id=$1",
  metaItems: `
    SELECT i.id,
           i.name,
           COALESCE(m.order_count, 0)::int AS order_count,
           COALESCE(e.expense_count, 0)::int AS expense_count
      FROM public.items i
      LEFT JOIN (
        SELECT item_id, COUNT(*)::int AS order_count
          FROM public.marketing_list_items
         WHERE status <> 'removed' AND item_id IS NOT NULL
         GROUP BY item_id
      ) m ON m.item_id = i.id
      LEFT JOIN (
        SELECT item_id, COUNT(*)::int AS expense_count
          FROM public.expenses
         WHERE item_id IS NOT NULL
         GROUP BY item_id
      ) e ON e.item_id = i.id
     WHERE i.category_id = $1
     ORDER BY COALESCE(m.order_count, 0) DESC, COALESCE(e.expense_count, 0) DESC, LOWER(i.name) ASC, i.id ASC
  `,
  metaUnits: "SELECT id,name FROM public.units ORDER BY name",
};
