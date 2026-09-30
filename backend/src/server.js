import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import multer from "multer";
import crypto from "crypto";
import { initDb, q } from "./db.js";
import { auth, permit, signUser, userWithPermissions } from "./auth.js";
import { uploadProof, signedProof } from "./storage.js";
dotenv.config();
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "10mb" }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const today = () => new Date().toISOString().slice(0, 10);
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = await userWithPermissionsByEmail(email);
    if (!u || u.is_disabled)
      return res.status(401).json({ error: "Invalid credentials" });
    if (!(await bcrypt.compare(password, u.password_hash)))
      return res.status(401).json({ error: "Invalid credentials" });
    const token = signUser(u, u.permissions);
    res.json({
      token,
      user: {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        role: u.role,
        permissions: u.permissions,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
async function userWithPermissionsByEmail(email) {
  const r = await q(
    `SELECT u.id,u.email,u.full_name,u.password_hash,u.is_disabled,r.name role,COALESCE(array_agg(p.code) FILTER(WHERE p.code IS NOT NULL),'{}') permissions FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE lower(u.email)=lower($1) GROUP BY u.id,r.name`,
    [email],
  );
  return r.rows[0];
}
app.get("/api/me", auth, (req, res) => res.json(req.user));
app.get("/api/meta/categories", auth, async (req, res) => {
  const r = await q("SELECT id,name FROM categories ORDER BY name");
  res.json(r.rows);
});
app.get("/api/meta/units", auth, async (req, res) => {
  const r = await q("SELECT id,name FROM units ORDER BY name");
  res.json(r.rows);
});
app.get("/api/meta/items/:categoryId", auth, async (req, res) => {
  const r = await q(
    "SELECT id,name FROM items WHERE category_id=$1 ORDER BY name",
    [req.params.categoryId],
  );
  res.json(r.rows);
});
app.get("/api/meta/survivors", auth, async (req, res) => {
  const r = await q(
    "SELECT id,full_name,nickname FROM survivors ORDER BY full_name",
  );
  res.json(r.rows);
});
app.get("/api/pincode/:pincode", auth, async (req, res) => {
  const pin = String(req.params.pincode || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(pin))
    return res.status(400).json({ error: "Invalid Indian pincode" });
  try {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    if (!response.ok) throw new Error("Pincode service unavailable");
    const data = await response.json();
    const post = data?.[0];
    if (post?.Status !== "Success" || !post.PostOffice?.length)
      return res.status(404).json({ error: "Pincode not found" });
    const po = post.PostOffice[0];
    res.json({
      district: po.District || "",
      state: po.State || "",
      city: po.District || po.Name || "",
    });
  } catch (e) {
    res.status(502).json({ error: "Unable to lookup pincode" });
  }
});
function listQuery(table, req) {
  const page = Math.max(1, Number(req.query.page) || 1),
    size = [5, 10, 20, 50].includes(Number(req.query.pageSize))
      ? Number(req.query.pageSize)
      : 10,
    search = req.query.search || "";
  return { page, size, search, offset: (page - 1) * size };
}
app.get("/api/survivors", auth, permit("add-survivor"), async (req, res) => {
  const { page, size, search, offset } = listQuery("survivors", req);
  const like = `%${search}%`;
  const count = await q(
    "SELECT count(*) FROM survivors WHERE full_name ILIKE $1 OR COALESCE(nickname,'') ILIKE $1",
    [like],
  );
  const rows = await q(
    `SELECT
       id,
       full_name AS "fullName",
       father_name AS "fatherName",
       mother_name AS "motherName",
       nickname,
       house_no AS "houseNo",
       street,
       area,
       village_city AS "villageCity",
       pincode,
       district,
       state
     FROM survivors
     WHERE
       full_name ILIKE $1
       OR father_name ILIKE $1
       OR mother_name ILIKE $1
       OR nickname ILIKE $1
     ORDER BY full_name
     LIMIT $2 OFFSET $3`,
    [like, size, offset],
  );
  res.json({
    rows: rows.rows,
    total: Number(count.rows[0].count),
    page,
    pageSize: size,
  });
});
app.post("/api/survivors", auth, permit("add-survivor"), async (req, res) => {
  const b = req.body;
  if (!b.fullName)
    return res.status(400).json({ error: "Full name is required" });
  const r = await q(
    `INSERT INTO survivors(full_name,father_name,mother_name,nickname,house_no,street,area,village_city,pincode,district,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      b.fullName,
      b.fatherName,
      b.motherName,
      b.nickname,
      b.houseNo,
      b.street,
      b.area,
      b.villageCity,
      b.pincode,
      b.district,
      b.state,
    ],
  );
  res.status(201).json(r.rows[0]);
});
app.put(
  "/api/survivors/:id",
  auth,
  permit("add-survivor"),
  async (req, res) => {
    const b = req.body;
    const r = await q(
      `UPDATE survivors SET full_name=$1,father_name=$2,mother_name=$3,nickname=$4,house_no=$5,street=$6,area=$7,village_city=$8,pincode=$9,district=$10,state=$11 WHERE id=$12 RETURNING *`,
      [
        b.fullName,
        b.fatherName,
        b.motherName,
        b.nickname,
        b.houseNo,
        b.street,
        b.area,
        b.villageCity,
        b.pincode,
        b.district,
        b.state,
        req.params.id,
      ],
    );
    res.json(r.rows[0]);
  },
);
app.delete(
  "/api/survivors/:id",
  auth,
  permit("add-survivor"),
  async (req, res) => {
    await q("DELETE FROM survivors WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  },
);
app.get("/api/categories", auth, permit("add-item"), async (req, res) => {
  const r = await q("SELECT * FROM categories ORDER BY name");
  res.json(r.rows);
});
app.post("/api/categories", auth, permit("add-item"), async (req, res) => {
  const r = await q("INSERT INTO categories(name) VALUES($1) RETURNING *", [
    req.body.name,
  ]);
  res.status(201).json(r.rows[0]);
});
app.put("/api/categories/:id", auth, permit("add-item"), async (req, res) => {
  const r = await q("UPDATE categories SET name=$1 WHERE id=$2 RETURNING *", [
    req.body.name,
    req.params.id,
  ]);
  res.json(r.rows[0]);
});
app.delete(
  "/api/categories/:id",
  auth,
  permit("add-item"),
  async (req, res) => {
    await q("DELETE FROM categories WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  },
);
app.get("/api/items", auth, permit("add-item"), async (req, res) => {
  const { page, size, search, offset } = listQuery("items", req);
  const cat = req.query.categoryId;

  const args = cat
    ? [cat, `%${search}%`]
    : [`%${search}%`];

  const where = cat
    ? "WHERE i.category_id=$1 AND i.name ILIKE $2"
    : "WHERE i.name ILIKE $1";

  const count = await q(
    `SELECT count(*)
     FROM items i
     ${where}`,
    args,
  );

  const rows = await q(
    `SELECT
       i.*,
       c.name AS category
     FROM items i
     JOIN categories c ON c.id = i.category_id
     ${where}
     ORDER BY i.name
     LIMIT $${args.length + 1}
     OFFSET $${args.length + 2}`,
    [...args, size, offset],
  );

  res.json({
    rows: rows.rows,
    total: Number(count.rows[0].count),
    page,
    pageSize: size,
  });
});
app.post("/api/items", auth, permit("add-item"), async (req, res) => {
  const r = await q(
    "INSERT INTO items(category_id,name) VALUES($1,$2) RETURNING *",
    [req.body.categoryId, req.body.name],
  );
  res.status(201).json(r.rows[0]);
});
app.put("/api/items/:id", auth, permit("add-item"), async (req, res) => {
  const r = await q(
    "UPDATE items SET category_id=$1,name=$2 WHERE id=$3 RETURNING *",
    [req.body.categoryId, req.body.name, req.params.id],
  );
  res.json(r.rows[0]);
});
app.delete("/api/items/:id", auth, permit("add-item"), async (req, res) => {
  await q("DELETE FROM items WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});
app.get("/api/units", auth, permit("add-unit"), async (req, res) => {
  const { page, size, search, offset } = listQuery("units", req);
  const like = `%${search}%`;
  const c = await q("SELECT count(*) FROM units WHERE name ILIKE $1", [like]);
  const r = await q(
    "SELECT * FROM units WHERE name ILIKE $1 ORDER BY name LIMIT $2 OFFSET $3",
    [like, size, offset],
  );
  res.json({
    rows: r.rows,
    total: Number(c.rows[0].count),
    page,
    pageSize: size,
  });
});
app.post("/api/units", auth, permit("add-unit"), async (req, res) => {
  const r = await q("INSERT INTO units(name) VALUES($1) RETURNING *", [
    req.body.name,
  ]);
  res.status(201).json(r.rows[0]);
});
app.put("/api/units/:id", auth, permit("add-unit"), async (req, res) => {
  const r = await q("UPDATE units SET name=$1 WHERE id=$2 RETURNING *", [
    req.body.name,
    req.params.id,
  ]);
  res.json(r.rows[0]);
});
app.delete("/api/units/:id", auth, permit("add-unit"), async (req, res) => {
  await q("DELETE FROM units WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});
app.get("/api/expenses", auth, permit("add-expense"), async (req, res) => {
  const date = req.query.date || today(),
    { page, size, search, offset } = listQuery("expenses", req);
  const like = `%${search}%`;
  const c = await q(
    `SELECT count(*) FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN items i ON i.id=e.item_id WHERE e.expense_date=$1 AND (c.name ILIKE $2 OR COALESCE(i.name,'') ILIKE $2 OR COALESCE(e.other_item,'') ILIKE $2)`,
    [date, like],
  );
  const r = await q(
    `SELECT e.*,c.name category,i.name item,u.name unit,COALESCE(json_agg(json_build_object('survivorId',s.id,'survivorName',s.full_name,'shareType',es.share_type,'amount',es.amount)) FILTER(WHERE s.id IS NOT NULL),'[]') shares FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN items i ON i.id=e.item_id LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN expense_shares es ON es.expense_id=e.id LEFT JOIN survivors s ON s.id=es.survivor_id WHERE e.expense_date=$1 AND (c.name ILIKE $2 OR COALESCE(i.name,'') ILIKE $2 OR COALESCE(e.other_item,'') ILIKE $2) GROUP BY e.id,c.name,i.name,u.name ORDER BY e.id DESC LIMIT $3 OFFSET $4`,
    [date, like, size, offset],
  );
  res.json({
    rows: r.rows,
    total: Number(c.rows[0].count),
    page,
    pageSize: size,
    date,
  });
});
async function saveExpense(b, userId, id = null) {
  if (!b.expenseDate || !b.categoryId || !b.totalCost)
    throw new Error("Date, category and total cost are required");
  if (!Array.isArray(b.shares) || !b.shares.length)
    throw new Error("At least one survivor share is required");
  const client = await import("./db.js").then((x) => x.pool.connect());
  try {
    await client.query("BEGIN");
    let r;
    if (id)
      r = await client.query(
        `UPDATE expenses SET expense_date=$1,category_id=$2,item_id=$3,other_item=$4,quantity=$5,unit_id=$6,total_cost=$7,expense_type=$8,updated_at=now() WHERE id=$9 RETURNING *`,
        [
          b.expenseDate,
          b.categoryId,
          b.itemId && b.itemId !== "other" ? b.itemId : null,
          b.otherItem || null,
          b.quantity || null,
          b.unitId || null,
          b.totalCost,
          b.expenseType || "cash",
          id,
        ],
      );
    else
      r = await client.query(
        `INSERT INTO expenses(expense_date,category_id,item_id,other_item,quantity,unit_id,total_cost,expense_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          b.expenseDate,
          b.categoryId,
          b.itemId && b.itemId !== "other" ? b.itemId : null,
          b.otherItem || null,
          b.quantity || null,
          b.unitId || null,
          b.totalCost,
          b.expenseType || "cash",
          userId,
        ],
      );
    const eid = r.rows[0].id;
    await client.query("DELETE FROM expense_shares WHERE expense_id=$1", [eid]);
    for (const s of b.shares)
      await client.query(
        "INSERT INTO expense_shares(expense_id,survivor_id,share_type,amount) VALUES($1,$2,$3,$4)",
        [eid, s.survivorId, s.shareType, s.amount ?? null],
      );
    await client.query("COMMIT");
    return r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
app.post("/api/expenses", auth, permit("add-expense"), async (req, res) => {
  try {
    res.status(201).json(await saveExpense(req.body, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.put("/api/expenses/:id", auth, permit("add-expense"), async (req, res) => {
  try {
    res.json(await saveExpense(req.body, req.user.id, req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete(
  "/api/expenses/:id",
  auth,
  permit("add-expense"),
  async (req, res) => {
    await q("DELETE FROM expenses WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  },
);
app.post(
  "/api/expenses/:id/proof",
  auth,
  permit("add-expense"),
  upload.single("proof"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "File required" });
    const ext =
      req.file.mimetype === "application/pdf"
        ? "pdf"
        : req.file.mimetype.split("/")[1] || "bin";
    const key = `proofs/${req.params.id}/${crypto.randomUUID()}.${ext}`;
    await uploadProof(req.file, key);
    await q("UPDATE expenses SET proof_key=$1 WHERE id=$2", [
      key,
      req.params.id,
    ]);
    res.json({ ok: true, key });
  },
);
app.get("/api/expenses/:id/proof", auth, async (req, res) => {
  const r = await q("SELECT proof_key FROM expenses WHERE id=$1", [
    req.params.id,
  ]);
  if (!r.rows[0]?.proof_key) return res.status(404).json({ error: "No proof" });
  const url = await signedProof(r.rows[0].proof_key);
  if (!url) return res.status(503).json({ error: "S3 storage not configured" });
  res.redirect(url);
});
app.post("/api/users", auth, permit("add-user"), async (req, res) => {
  const { fullName, email, password, role } = req.body;
  const hash = await bcrypt.hash(password, 12);
  const r = await q(
    `INSERT INTO users(full_name,email,password_hash,role_id) SELECT $1,$2,$3,id FROM roles WHERE name=$4 RETURNING id,full_name,email,role_id,is_disabled`,
    [fullName, email, hash, role],
  );
  res.status(201).json(r.rows[0]);
});
app.get("/api/users", auth, permit("add-user"), async (req, res) => {
  const { page, size, search, offset } = listQuery("users", req);
  const like = `%${search}%`;
  const c = await q(
    `SELECT count(*) FROM users WHERE full_name ILIKE $1 OR email ILIKE $1`,
    [like],
  );
  const r = await q(
    `SELECT u.id,u.full_name,email,r.name role,u.is_disabled FROM users u JOIN roles r ON r.id=u.role_id WHERE u.full_name ILIKE $1 OR u.email ILIKE $1 ORDER BY u.full_name LIMIT $2 OFFSET $3`,
    [like, size, offset],
  );
  res.json({
    rows: r.rows,
    total: Number(c.rows[0].count),
    page,
    pageSize: size,
  });
});
app.delete("/api/users/:id", auth, permit("add-user"), async (req, res) => {
  if (String(req.user.id) === String(req.params.id))
    return res.status(400).json({ error: "Cannot remove current user" });
  await q("DELETE FROM users WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i],
      next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => r.map((v) => v.trim()));
}

app.post(
  "/api/bulk-upload/categories-items",
  auth,
  permit("bulk-upload-categories-items"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      return res.status(400).json({ error: "CSV file is required" });
    if (
      !/csv|comma-separated-values|text\/plain/i.test(
        req.file.mimetype || "",
      ) &&
      !/\.csv$/i.test(req.file.originalname || "")
    )
      return res.status(400).json({ error: "Please upload a CSV file" });
    try {
      const rows = parseCsv(
        req.file.buffer.toString("utf8").replace(/^\uFEFF/, ""),
      );
      if (!rows.length)
        return res.status(400).json({ error: "CSV file is empty" });
      const categories = rows[0];
      if (!categories.length || categories.every((x) => !x))
        return res
          .status(400)
          .json({ error: "First row must contain category names" });
      const client = await import("./db.js").then((x) => x.pool.connect());
      let categoryCount = 0,
        itemCount = 0;
      try {
        await client.query("BEGIN");
        const categoryIds = [];
        for (let c = 0; c < categories.length; c++) {
          const name = categories[c];
          if (!name) {
            categoryIds[c] = null;
            continue;
          }
          const r = await client.query(
            "INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
            [name],
          );
          categoryIds[c] = r.rows[0].id;
          categoryCount++;
        }
        for (let r = 1; r < rows.length; r++) {
          const cells = rows[r];
          for (let c = 0; c < categories.length; c++) {
            const item = String(cells[c] || "").trim();
            const categoryId = categoryIds[c];
            if (!item || !categoryId) continue;
            await client.query(
              "INSERT INTO items(category_id,name) VALUES($1,$2) ON CONFLICT(category_id,name) DO NOTHING",
              [categoryId, item],
            );
            itemCount++;
          }
        }
        await client.query("COMMIT");
        res.json({ categories: categoryCount, items: itemCount });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error("[BULK CATEGORIES ITEMS]", e);
      res.status(400).json({ error: e.message || "Unable to import CSV" });
    }
  },
);

app.get("/api/reports/data", auth, permit("report"), async (req, res) => {
  const { from, to, categoryIds = "", survivorIds = "", hasProof } = req.query;
  let where = ["e.expense_date BETWEEN $1 AND $2"],
    params = [from || "2000-01-01", to || today()];
  if (categoryIds) {
    params.push(categoryIds.split(",").map(Number));
    where.push(`e.category_id=ANY($${params.length})`);
  }
  if (hasProof === "true") where.push("e.proof_key IS NOT NULL");
  if (survivorIds) {
    params.push(survivorIds.split(",").map(Number));
    where.push(
      `EXISTS(SELECT 1 FROM expense_shares sx WHERE sx.expense_id=e.id AND sx.survivor_id=ANY($${params.length}))`,
    );
  }
  const r = await q(
    `SELECT e.id,e.expense_date,e.total_cost,e.expense_type,c.name category,COALESCE(i.name,e.other_item,'Total') item,COALESCE(string_agg(s.full_name,', '),'') survivors,e.proof_key FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN items i ON i.id=e.item_id LEFT JOIN expense_shares es ON es.expense_id=e.id LEFT JOIN survivors s ON s.id=es.survivor_id WHERE ${where.join(" AND ")} GROUP BY e.id,c.name,i.name ORDER BY e.expense_date DESC,e.id DESC`,
    params,
  );
  res.json(r.rows);
});
app.get("/api/report-selections", auth, permit("report"), async (req, res) => {
  const r = await q(
    "SELECT id,name,config FROM report_selections WHERE user_id=$1 ORDER BY name",
    [req.user.id],
  );
  res.json(r.rows);
});
app.post("/api/report-selections", auth, permit("report"), async (req, res) => {
  const r = await q(
    `INSERT INTO report_selections(user_id,name,config) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO UPDATE SET config=EXCLUDED.config RETURNING *`,
    [req.user.id, req.body.name, req.body.config],
  );
  res.json(r.rows[0]);
});
app.post("/api/auth/request-reset", async (req, res) => {
  const u = await userWithPermissionsByEmail(req.body.email);
  if (u) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const hash = await bcrypt.hash(otp, 10);
    await q(
      "INSERT INTO password_otps(email,otp_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [u.email, hash],
    );
    console.log(`Password reset OTP for ${u.email}: ${otp}`);
  }
  res.json({ message: "If the email exists, an OTP has been issued." });
});
app.post("/api/auth/reset", async (req, res) => {
  const { email, otp, password } = req.body;
  const r = await q(
    "SELECT * FROM password_otps WHERE lower(email)=lower($1) AND used=false AND expires_at>now() ORDER BY id DESC LIMIT 1",
    [email],
  );
  if (!r.rows[0] || !(await bcrypt.compare(otp, r.rows[0].otp_hash)))
    return res.status(400).json({ error: "Invalid or expired OTP" });
  const hash = await bcrypt.hash(password, 12);
  await q(
    "UPDATE users SET password_hash=$1,updated_at=now() WHERE lower(email)=lower($2)",
    [hash, email],
  );
  await q("UPDATE password_otps SET used=true WHERE id=$1", [r.rows[0].id]);
  res.json({ ok: true });
});
app.use((e, req, res, next) => {
  console.error(e);
  res.status(500).json({ error: e.message || "Server error" });
});
const port = Number(process.env.PORT) || 4000;
initDb()
  .then(() =>
    app.listen(port, "0.0.0.0", () => console.log(`API listening on ${port}`)),
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
