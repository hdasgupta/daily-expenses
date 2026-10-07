export const reportModelSql = {
  list: `
    SELECT
      rs.id,
      rs.name,
      rs.config,
      rs.created_at,
      rs.updated_at,
      rs.user_id AS owner_id,
      owner.full_name AS owner_name,
      (rs.user_id = $1) AS is_owner
    FROM public.report_selections rs
    JOIN public.users owner
      ON owner.id = rs.user_id
    LEFT JOIN public.report_selection_shares rss
      ON rss.selection_id = rs.id
     AND rss.user_id = $1
    WHERE rs.user_id = $1 OR rss.user_id IS NOT NULL
    ORDER BY rs.created_at ASC, rs.id ASC
  `,
  save: `INSERT INTO public.report_selections(user_id,name,config) VALUES($1,$2,$3)
    ON CONFLICT(user_id,name) DO UPDATE SET config=EXCLUDED.config,updated_at=now() RETURNING id,name,config`,
  delete: "DELETE FROM public.report_selections WHERE id=$1 AND user_id=$2",
  shareableUsers: `
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.is_disabled,
      EXISTS (
        SELECT 1
        FROM public.report_selection_shares rss
        WHERE rss.selection_id = $1
          AND rss.user_id = u.id
      ) AS shared
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id <> $2
      AND r.name = 'manager'
      AND (
        u.is_disabled = false
        OR EXISTS (
          SELECT 1
          FROM public.report_selection_shares current_share
          WHERE current_share.selection_id = $1
            AND current_share.user_id = u.id
        )
      )
    ORDER BY u.is_disabled, u.full_name, u.email
  `,
  selectionOwner: `
    SELECT user_id
    FROM public.report_selections
    WHERE id = $1
  `,
  validateShareUsers: `
    SELECT id
    FROM public.users
    WHERE id = ANY($1::bigint[])
      AND id <> $2
      AND (
        is_disabled = false
        OR EXISTS (
          SELECT 1
          FROM public.report_selection_shares current_share
          WHERE current_share.selection_id = $3
            AND current_share.user_id = public.users.id
        )
      )
  `,
  deleteShares: "DELETE FROM public.report_selection_shares WHERE selection_id = $1",
  insertShare: `
    INSERT INTO public.report_selection_shares(selection_id, user_id, shared_by_user_id)
    VALUES($1, $2, $3)
  `,
  deleteOwnShare: `
    DELETE FROM public.report_selection_shares
    WHERE selection_id = $1 AND user_id = $2
  `,
};
