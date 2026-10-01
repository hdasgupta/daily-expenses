const unitSortMap = { name: "name", created_at: "created_at" };

export const masterDataSql = {
  categories: "SELECT id,name FROM categories ORDER BY name",
  addCategory: "INSERT INTO categories(name) VALUES($1) RETURNING id,name",
  updateCategory: "UPDATE categories SET name=$1,updated_at=now() WHERE id=$2 RETURNING id,name",
  deleteCategory: "DELETE FROM categories WHERE id=$1",
  itemSearchCondition: "i.name ILIKE $1",
  itemCategoryCondition: (index) => `i.category_id=$${index}`,
  itemCount: (where) => `SELECT COUNT(*) FROM items i WHERE ${where}`,
  items: (where, orderBy, limitParam, offsetParam) =>
    `SELECT i.id,i.name,i.category_id,c.name AS category FROM items i JOIN categories c ON c.id=i.category_id WHERE ${where} ORDER BY ${orderBy} LIMIT ${limitParam} OFFSET ${offsetParam}`,
  addItem: "INSERT INTO items(category_id,name) VALUES($1,$2) RETURNING id,category_id,name",
  updateItem:
    "UPDATE items SET category_id=$1,name=$2,updated_at=now() WHERE id=$3 RETURNING id,category_id,name",
  deleteItem: "DELETE FROM items WHERE id=$1",
  unitCount: "SELECT COUNT(*) FROM units WHERE name ILIKE $1",
  units: (sortColumn = "name", direction = "asc") => {
    const sort = unitSortMap[sortColumn] || unitSortMap.name;
    const dir = String(direction).toLowerCase() === "desc" ? "DESC" : "ASC";
    return `SELECT id,name,created_at FROM units WHERE name ILIKE $1 ORDER BY ${sort} ${dir} LIMIT $2 OFFSET $3`;
  },
  addUnit: "INSERT INTO units(name) VALUES($1) RETURNING id,name",
  updateUnit: "UPDATE units SET name=$1,updated_at=now() WHERE id=$2 RETURNING id,name",
  deleteUnit: "DELETE FROM units WHERE id=$1",
  metaItems: "SELECT id,name FROM items WHERE category_id=$1 ORDER BY name",
  metaUnits: "SELECT id,name FROM units ORDER BY name",
};
