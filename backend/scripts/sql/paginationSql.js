export const paginationSql = {
  get: "SELECT page_size,search_text,sort_column,sort_direction FROM pagination_settings WHERE user_id=$1 AND module=$2",
  save: `INSERT INTO pagination_settings(user_id,module,page_size,search_text,sort_column,sort_direction)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(user_id,module) DO UPDATE SET
      page_size=EXCLUDED.page_size,search_text=EXCLUDED.search_text,
      sort_column=EXCLUDED.sort_column,sort_direction=EXCLUDED.sort_direction,updated_at=now()
    RETURNING page_size,search_text,sort_column,sort_direction`,
};
