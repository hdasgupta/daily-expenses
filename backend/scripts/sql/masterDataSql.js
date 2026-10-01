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
  metaItems: "SELECT id,name FROM public.items WHERE category_id=$1 ORDER BY name",
  metaUnits: "SELECT id,name FROM public.units ORDER BY name",
};
