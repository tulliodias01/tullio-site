const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { z } = require("zod");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { slugify } = require("../utils/slug");
const config = require("../config");

const router = express.Router();

if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, config.uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext || ".jpg"}`;
    cb(null, safe);
  }
});

const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024, files: 20 } });

const propertySchema = z.object({
  code: z.string().min(1),
  title: z.string().min(3),
  type: z.string().min(2),
  badge: z.string().optional().default("⭐ DESTAQUE"),
  location: z.string().min(3),
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/, "CEP invalido. Use 00000-000."),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  bedrooms: z.coerce.number().min(0),
  bathrooms: z.coerce.number().min(0),
  area: z.coerce.number().min(1),
  status: z.string().optional().default("Pronto"),
  price: z.coerce.number().min(1),
  description: z.string().min(10),
  is_published: z.coerce.boolean().optional().default(true),
  image_urls: z.array(z.string().url()).optional().default([])
});

function dbToProperty(row) {
  return {
    id: row.id,
    code: row.code,
    slug: row.slug,
    title: row.title,
    type: row.type,
    badge: row.badge,
    location: row.location,
    cep: row.cep,
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    bedrooms: Number(row.bedrooms),
    bathrooms: Number(row.bathrooms),
    area: Number(row.area),
    status: row.status,
    price: Number(row.price),
    description: row.description,
    is_published: row.is_published,
    created_at: row.created_at,
    updated_at: row.updated_at,
    images: []
  };
}

async function loadPropertyImages(propertyIds) {
  if (!propertyIds.length) return new Map();
  const rows = await query(
    "select property_id, image_url, is_cover, sort_order from property_images where property_id = any($1::uuid[]) order by sort_order asc, created_at asc",
    [propertyIds]
  );
  const map = new Map();
  rows.rows.forEach((img) => {
    if (!map.has(img.property_id)) map.set(img.property_id, []);
    map.get(img.property_id).push({
      url: img.image_url,
      is_cover: img.is_cover
    });
  });
  return map;
}

async function savePropertyVersion(propertyId, changedBy, payload) {
  await query(
    "insert into property_versions (property_id, changed_by, payload) values ($1, $2, $3::jsonb)",
    [propertyId, changedBy || null, JSON.stringify(payload)]
  );
}

router.get("/", requireAuth, async (_req, res) => {
  const propRows = await query("select * from properties order by created_at desc");
  const items = propRows.rows.map(dbToProperty);
  const imagesMap = await loadPropertyImages(items.map((p) => p.id));
  items.forEach((item) => {
    item.images = imagesMap.get(item.id) || [];
  });
  res.json({ ok: true, items });
});

router.post("/", requireAuth, upload.array("images", 20), async (req, res) => {
  try {
    const body = propertySchema.parse({
      ...req.body,
      image_urls: req.body.image_urls ? JSON.parse(req.body.image_urls) : []
    });

    const slug = slugify(body.title);
    const insert = await query(
      `insert into properties
      (code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, is_published)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      returning *`,
      [
        body.code,
        slug,
        body.title,
        body.type,
        body.badge,
        body.location,
        body.cep,
        body.latitude,
        body.longitude,
        body.bedrooms,
        body.bathrooms,
        body.area,
        body.status,
        body.price,
        body.description,
        body.is_published
      ]
    );

    const property = insert.rows[0];

    const uploaded = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const mergedImages = [...body.image_urls, ...uploaded];
    for (let i = 0; i < mergedImages.length; i += 1) {
      await query(
        "insert into property_images (property_id, image_url, is_cover, sort_order) values ($1,$2,$3,$4)",
        [property.id, mergedImages[i], i === 0, i]
      );
    }

    await savePropertyVersion(property.id, req.user.sub, { action: "create", property });
    return res.status(201).json({ ok: true, item: dbToProperty(property) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados inválidos.", issues: err.issues });
    return res.status(500).json({ ok: false, message: "Erro ao criar imóvel." });
  }
});

router.put("/:id", requireAuth, upload.array("images", 20), async (req, res) => {
  try {
    const body = propertySchema.parse({
      ...req.body,
      image_urls: req.body.image_urls ? JSON.parse(req.body.image_urls) : []
    });

    const slug = slugify(body.title);
    const update = await query(
      `update properties
       set code=$1, slug=$2, title=$3, type=$4, badge=$5, location=$6, cep=$7, latitude=$8, longitude=$9, bedrooms=$10, bathrooms=$11, area=$12, status=$13, price=$14, description=$15, is_published=$16, updated_at=now()
       where id=$17 returning *`,
      [
        body.code,
        slug,
        body.title,
        body.type,
        body.badge,
        body.location,
        body.cep,
        body.latitude,
        body.longitude,
        body.bedrooms,
        body.bathrooms,
        body.area,
        body.status,
        body.price,
        body.description,
        body.is_published,
        req.params.id
      ]
    );
    if (!update.rows.length) return res.status(404).json({ ok: false, message: "Imóvel não encontrado." });

    const property = update.rows[0];
    const uploaded = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const mergedImages = [...body.image_urls, ...uploaded];
    await query("delete from property_images where property_id = $1", [property.id]);
    for (let i = 0; i < mergedImages.length; i += 1) {
      await query(
        "insert into property_images (property_id, image_url, is_cover, sort_order) values ($1,$2,$3,$4)",
        [property.id, mergedImages[i], i === 0, i]
      );
    }

    await savePropertyVersion(property.id, req.user.sub, { action: "update", property });
    return res.json({ ok: true, item: dbToProperty(property) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados inválidos.", issues: err.issues });
    return res.status(500).json({ ok: false, message: "Erro ao atualizar imóvel." });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const deleted = await query("delete from properties where id = $1 returning *", [req.params.id]);
  if (!deleted.rows.length) return res.status(404).json({ ok: false, message: "Imóvel não encontrado." });
  await savePropertyVersion(req.params.id, req.user.sub, { action: "delete", property: deleted.rows[0] });
  return res.json({ ok: true });
});

module.exports = router;
