const express = require("express");
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { query } = require("../db");
const config = require("../config");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("admin", "owner"));

const privateSchema = z.object({
  owner_name: z.string().trim().max(160).optional().nullable(),
  owner_phone: z.string().trim().max(40).optional().nullable(),
  owner_email: z.string().trim().email().max(180).optional().nullable(),
  owner_document: z.string().trim().max(40).optional().nullable(),
  owner_type: z.string().trim().max(20).optional().nullable(),
  internal_notes: z.string().trim().max(10000).optional().nullable(),
  commission_sale: z.coerce.number().min(0).max(100).optional().nullable(),
  commission_rent: z.coerce.number().min(0).max(100).optional().nullable(),
  contract_status: z.string().trim().max(80).optional().nullable(),
  keys_location: z.string().trim().max(200).optional().nullable()
});

function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

router.get("/leads", async (_req, res) => {
  const result = await query("select * from leads order by created_at desc");
  return res.json({ ok: true, items: result.rows });
});

router.get("/analytics", async (_req, res) => {
  const result = await query("select * from analytics_events order by created_at desc limit 500");
  return res.json({ ok: true, items: result.rows });
});

router.get("/backup/export", async (_req, res) => {
  const [properties, images, leads, propertyPrivate] = await Promise.all([
    query("select * from properties order by created_at desc"),
    query("select * from property_images order by created_at desc"),
    query("select * from leads order by created_at desc"),
    query("select * from property_private order by created_at desc")
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    properties: properties.rows,
    property_images: images.rows,
    leads: leads.rows,
    property_private: propertyPrivate.rows
  };

  if (!fs.existsSync(config.backupsDir)) fs.mkdirSync(config.backupsDir, { recursive: true });
  const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(config.backupsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");

  await query("insert into backups (file_name, file_path, payload_summary) values ($1,$2,$3::jsonb)", [
    fileName,
    filePath,
    JSON.stringify({
      properties: payload.properties.length,
      images: payload.property_images.length,
      leads: payload.leads.length,
      property_private: payload.property_private.length
    })
  ]);

  return res.json({ ok: true, file: fileName, path: filePath });
});

router.get("/backup/list", async (_req, res) => {
  const result = await query("select * from backups order by created_at desc limit 200");
  return res.json({ ok: true, items: result.rows });
});

router.get("/properties/:id/private", async (req, res) => {
  const found = await query("select id from properties where id = $1 limit 1", [req.params.id]);
  if (!found.rows.length) return res.status(404).json({ ok: false, message: "Imóvel não encontrado." });

  const row = await query("select * from property_private where property_id = $1 limit 1", [req.params.id]);
  return res.json({ ok: true, item: row.rows[0] || null });
});

router.put("/properties/:id/private", async (req, res) => {
  try {
    const exists = await query("select id from properties where id = $1 limit 1", [req.params.id]);
    if (!exists.rows.length) return res.status(404).json({ ok: false, message: "Imóvel não encontrado." });

    const data = privateSchema.parse(req.body || {});
    const result = await query(
      `insert into property_private (
        property_id, owner_name, owner_phone, owner_email, owner_document, owner_type, internal_notes,
        commission_sale, commission_rent, contract_status, keys_location, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      on conflict (property_id) do update set
        owner_name = excluded.owner_name,
        owner_phone = excluded.owner_phone,
        owner_email = excluded.owner_email,
        owner_document = excluded.owner_document,
        owner_type = excluded.owner_type,
        internal_notes = excluded.internal_notes,
        commission_sale = excluded.commission_sale,
        commission_rent = excluded.commission_rent,
        contract_status = excluded.contract_status,
        keys_location = excluded.keys_location,
        updated_at = now()
      returning *`,
      [
        req.params.id,
        toNullableString(data.owner_name),
        toNullableString(data.owner_phone),
        toNullableString(data.owner_email),
        toNullableString(data.owner_document),
        toNullableString(data.owner_type),
        toNullableString(data.internal_notes),
        toNullableNumber(data.commission_sale),
        toNullableNumber(data.commission_rent),
        toNullableString(data.contract_status),
        toNullableString(data.keys_location)
      ]
    );

    return res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, message: "Dados privados inválidos.", issues: err.issues });
    }
    return res.status(500).json({ ok: false, message: "Erro ao salvar dados privados." });
  }
});

module.exports = router;
