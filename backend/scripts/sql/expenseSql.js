const listSortMap = {
  expense_date: "e.expense_date",
  category: "c.name",
  item: "COALESCE(i.name,e.other_item,'Total')",
  total_cost: "e.total_cost",
  expense_type: "e.expense_type",
};

export const expenseSql = {
  countByDate: `SELECT COUNT(*)
    FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN items i ON i.id=e.item_id
    WHERE e.expense_date=$1
      AND (c.name ILIKE $2 OR COALESCE(i.name,'') ILIKE $2 OR COALESCE(e.other_item,'') ILIKE $2
           OR COALESCE(e.comment,'') ILIKE $2)`,
  listByDate: (sortColumn = "expense_date", direction = "desc") => {
    const sort = listSortMap[sortColumn] || listSortMap.expense_date;
    const dir = String(direction).toLowerCase() === "asc" ? "ASC" : "DESC";
    return `SELECT e.*, c.name AS category, i.name AS item, u.name AS unit,
      COALESCE(json_agg(json_build_object(
        'survivorId',s.id,'survivorName',s.full_name,'shareType',es.share_type,'amount',es.amount
      ) ORDER BY s.full_name) FILTER (WHERE s.id IS NOT NULL),'[]') AS shares
    FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN items i ON i.id=e.item_id
    LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN expense_shares es ON es.expense_id=e.id
    LEFT JOIN survivors s ON s.id=es.survivor_id
    WHERE e.expense_date=$1
      AND (c.name ILIKE $2 OR COALESCE(i.name,'') ILIKE $2 OR COALESCE(e.other_item,'') ILIKE $2
           OR COALESCE(e.comment,'') ILIKE $2)
    GROUP BY e.id,c.name,i.name,u.name ORDER BY ${sort} ${dir} LIMIT $3 OFFSET $4`;
  },
  find: `SELECT e.*, c.name AS category, i.name AS item, u.name AS unit,
      COALESCE(json_agg(json_build_object(
        'survivorId',s.id,'survivorName',s.full_name,'shareType',es.share_type,'amount',es.amount
      ) ORDER BY s.full_name) FILTER (WHERE s.id IS NOT NULL),'[]') AS shares
    FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN items i ON i.id=e.item_id
    LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN expense_shares es ON es.expense_id=e.id
    LEFT JOIN survivors s ON s.id=es.survivor_id WHERE e.id=$1 GROUP BY e.id,c.name,i.name,u.name`,
  create: `INSERT INTO expenses(expense_date,category_id,item_id,other_item,quantity,unit_id,total_cost,expense_type,comment,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
  update: `UPDATE expenses SET expense_date=$1,category_id=$2,item_id=$3,other_item=$4,quantity=$5,unit_id=$6,
    total_cost=$7,expense_type=$8,comment=$9,updated_at=now() WHERE id=$10 RETURNING id`,
  deleteShares: "DELETE FROM expense_shares WHERE expense_id=$1",
  insertShare:
    "INSERT INTO expense_shares(expense_id,survivor_id,share_type,amount) VALUES($1,$2,$3,$4)",
  delete: "DELETE FROM expenses WHERE id=$1",
  setProof: `UPDATE expenses SET proof_key=$1,updated_at=now() WHERE id=$2 RETURNING id,proof_key`,
  clearProof: "UPDATE expenses SET proof_key=NULL,updated_at=now() WHERE id=$1",
  setBulkSource: `UPDATE expenses SET proof_google_docs_id=$1,contract_download_url=$2,updated_at=now() WHERE id=$3`,
};
