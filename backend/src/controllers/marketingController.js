import crypto from "node:crypto";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
import { sendMarketingListEmail } from "../services/mailService.js";

const itemSelect = `SELECT m.*, c.name AS category_name, u.name AS unit_name,
 l.name AS location_name, pu.name AS purchased_unit_name
 FROM public.marketing_list_items m
 LEFT JOIN public.categories c ON c.id=m.category_id
 LEFT JOIN public.units u ON u.id=m.unit_id
 LEFT JOIN public.marketing_locations l ON l.id=m.location_id
 LEFT JOIN public.units pu ON pu.id=m.purchased_unit_id`;
const dateIST = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export async function listItems(req, res) {
 const result = await q(`${itemSelect} ORDER BY m.purchase_date DESC, m.id DESC`);
 res.json(result.rows);
}
export async function createItem(req, res) {
 const b=req.body||{};
 if (!String(b.itemName||"").trim() || !b.purchaseDate) return res.status(400).json({error:"Item name and purchase date are required"});
 const result=await q(`INSERT INTO public.marketing_list_items(category_id,item_id,item_name,quantity,unit_id,purchase_date,location_id,created_by,updated_by)
 VALUES(NULLIF($1,'')::bigint,NULLIF($2,'')::bigint,$3,NULLIF($4,'')::numeric,NULLIF($5,'')::bigint,$6,NULLIF($7,'')::bigint,$8,$8) RETURNING *`,[String(b.categoryId||""),String(b.itemId||""),String(b.itemName).trim(),String(b.quantity??""),String(b.unitId||""),b.purchaseDate,String(b.locationId||""),req.user.id]);
 res.status(201).json(result.rows[0]);
}
export async function updateItem(req,res) {
 const b=req.body||{};
 const existing=await q("SELECT status FROM public.marketing_list_items WHERE id=$1",[req.params.id]);
 if(!existing.rowCount) return res.status(404).json({error:"Marketing item not found"});
 if(existing.rows[0].status!=="pending") return res.status(409).json({error:"Purchased or removed items are read-only"});
 if(!String(b.itemName||"").trim()||!b.purchaseDate) return res.status(400).json({error:"Item name and purchase date are required"});
 const r=await q(`UPDATE public.marketing_list_items SET category_id=NULLIF($2,'')::bigint,item_id=NULLIF($3,'')::bigint,item_name=$4,quantity=NULLIF($5,'')::numeric,unit_id=NULLIF($6,'')::bigint,purchase_date=$7,location_id=NULLIF($8,'')::bigint,updated_by=$9,updated_at=now() WHERE id=$1 RETURNING *`,[req.params.id,String(b.categoryId||""),String(b.itemId||""),String(b.itemName).trim(),String(b.quantity??""),String(b.unitId||""),b.purchaseDate,String(b.locationId||""),req.user.id]);
 res.json(r.rows[0]);
}
export async function removeItem(req, res) {
 const result = await q(`UPDATE public.marketing_list_items
 SET status='removed', updated_by=$2, updated_at=now()
 WHERE id=$1 AND status='pending' RETURNING id,status`, [req.params.id, req.user.id]);
 if (!result.rowCount) {
  const existing = await q("SELECT status FROM public.marketing_list_items WHERE id=$1", [req.params.id]);
  if (!existing.rowCount) return res.status(404).json({ error: "Marketing item not found" });
  return res.status(409).json({ error: "Purchased or already removed items cannot be removed again" });
 }
 res.json({ ok: true, ...result.rows[0] });
}

export async function markPurchased(req,res) {
 const b=req.body||{};
 const r=await q(`UPDATE public.marketing_list_items SET status='purchased',expense_id=$2,expense_price=$3,purchased_quantity=NULLIF($4,'')::numeric,purchased_unit_id=NULLIF($5,'')::bigint,updated_by=$6,updated_at=now() WHERE id=$1 AND status='pending' RETURNING *`,[req.params.id,b.expenseId,b.price,String(b.quantity??""),String(b.unitId||""),req.user.id]);
 if(!r.rowCount) return res.status(409).json({error:"Item is no longer pending or does not exist"});
 res.json(r.rows[0]);
}
export async function markPurchasedBulk(req, res) {
 const b = req.body || {};
 const ids = [...new Set((Array.isArray(b.itemIds) ? b.itemIds : []).map((id) => String(id)).filter((id) => /^\d+$/.test(id)))];
 if (!ids.length || !b.expenseId) return res.status(400).json({ error: "Item IDs and expense ID are required" });
 const result = await q(`UPDATE public.marketing_list_items
 SET status='purchased', expense_id=$2, expense_price=$3,
     purchased_quantity=quantity, purchased_unit_id=unit_id,
     updated_by=$4, updated_at=now()
 WHERE id = ANY($1::bigint[]) AND status='pending'
   AND (SELECT COUNT(*) FROM public.marketing_list_items WHERE id = ANY($1::bigint[]) AND status='pending') = cardinality($1::bigint[])
 RETURNING id`, [ids, b.expenseId, Number(b.price || 0), req.user.id]);
 if (result.rowCount !== ids.length) return res.status(409).json({ error: "One or more selected items are no longer pending. Refresh the Marketing List and try again." });
 res.json({ ok: true, purchasedCount: result.rowCount, itemIds: result.rows.map((row) => row.id) });
}

export async function listLocations(req,res) { const r=await q("SELECT id,name,address FROM public.marketing_locations ORDER BY name"); res.json(r.rows); }
export async function createLocation(req,res) { const name=String(req.body?.name||"").trim(); if(!name) return res.status(400).json({error:"Location name is required"}); const r=await q("INSERT INTO public.marketing_locations(name,address,created_by) VALUES($1,$2,$3) RETURNING *",[name,String(req.body?.address||"").trim()||null,req.user.id]); res.status(201).json(r.rows[0]); }
export async function updateLocation(req,res) { const name=String(req.body?.name||"").trim(); if(!name) return res.status(400).json({error:"Location name is required"}); const r=await q("UPDATE public.marketing_locations SET name=$2,address=$3,updated_at=now() WHERE id=$1 RETURNING *",[req.params.id,name,String(req.body?.address||"").trim()||null]); if(!r.rowCount) return res.status(404).json({error:"Location not found"}); res.json(r.rows[0]); }
export async function deleteLocation(req,res) { const r=await q("DELETE FROM public.marketing_locations WHERE id=$1",[req.params.id]); res.json({ok:true,deleted:r.rowCount}); }
export async function sendScheduledEmail(req,res) {
 const expected=String(env.marketingListCronSecret||""); const supplied=String(req.headers["x-marketing-cron-secret"]||"");
 if(!expected || !supplied || expected.length!==supplied.length || !crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(supplied))) return res.status(401).json({error:"Invalid cron secret"});
 const purchaseDate=String(req.body?.date||dateIST(new Date(Date.now()+24*60*60*1000)));
 const key=`marketing-list-email:${purchaseDate}`; const started=Date.now();
 const claim=await q(`INSERT INTO public.scheduler_job_executions(job_name,scheduled_key,status,started_at) VALUES('marketing-list-email',$1,'running',now()) ON CONFLICT (job_name,scheduled_key) WHERE scheduled_key IS NOT NULL DO UPDATE SET status='running',started_at=now(),completed_at=NULL,duration_ms=NULL,error_message=NULL WHERE public.scheduler_job_executions.status='failed' RETURNING id`,[key]);
 if(!claim.rowCount) return res.json({ok:true,duplicate:true,date:purchaseDate});
 try {
  const items=(await q(`${itemSelect} WHERE m.status='pending' AND m.purchase_date=$1::date ORDER BY c.name,m.item_name`,[purchaseDate])).rows;
  if(!items.length) { await q("UPDATE public.scheduler_job_executions SET status='skipped',completed_at=now(),duration_ms=$2,error_message='No items scheduled for this date' WHERE id=$1",[claim.rows[0].id,Date.now()-started]); return res.json({ok:true,status:"skipped",reason:"no-items",date:purchaseDate,itemCount:0,recipientCount:0}); }
  const recipients=(await q(`SELECT email FROM public.users u JOIN public.roles r ON r.id=u.role_id WHERE r.name IN ('manager','admin') AND u.is_disabled=false ORDER BY CASE WHEN r.name='manager' THEN 1 ELSE 2 END,u.email`)).rows;
  for(const recipient of recipients) await sendMarketingListEmail(recipient.email,purchaseDate,items);
  await q("UPDATE public.scheduler_job_executions SET status='completed',completed_at=now(),duration_ms=$2,error_message=$3 WHERE id=$1",[claim.rows[0].id,Date.now()-started,`recipients=${recipients.length}; items=${items.length}; date=${purchaseDate}`]);
  res.json({ok:true,status:"completed",date:purchaseDate,itemCount:items.length,recipientCount:recipients.length});
 } catch(error) { await q("UPDATE public.scheduler_job_executions SET status='failed',completed_at=now(),duration_ms=$2,error_message=$3 WHERE id=$1",[claim.rows[0].id,Date.now()-started,String(error?.message||error).slice(0,2000)]); throw error; }
}
