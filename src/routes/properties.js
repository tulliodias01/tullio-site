const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { z } = require("zod");
const { query } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { slugify } = require("../utils/slug");
const { splitSensitiveDescription, sanitizeInternalNotesText } = require("../utils/sanitizePublicDescription");
const config = require("../config");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("admin", "owner"));

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

const upload = multer({ storage });
const MAX_IMAGES_UPLOAD = 100;

const propertySchema = z.object({
  code: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  badge: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  cep: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  bedrooms: z.coerce.number().min(0).optional().nullable(),
  bathrooms: z.coerce.number().min(0).optional().nullable(),
  area: z.coerce.number().min(0).optional().nullable(),
  status: z.string().optional().nullable(),
  price: z.coerce.number().min(0).optional().nullable(),
  description: z.string().optional().nullable(),
  is_published: z.union([z.boolean(), z.string()]).optional().nullable(),
  image_urls: z.array(z.string().url()).optional().default([])
});
const visibilitySchema = z.object({
  is_published: z.union([z.boolean(), z.string()])
});

function asText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asNullableText(value) {
  const text = asText(value);
  return text || null;
}

function asNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;
  return fallback;
}

function buildFallbackCode() {
  return `imovel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizePropertyBody(raw, fallback = {}) {
  const fallbackCode = asText(fallback.code);
  const code = asText(raw.code) || fallbackCode || buildFallbackCode();
  const title = asText(raw.title) || asText(fallback.title) || "Imovel sem titulo";
  const slugBase = asText(raw.title) || title || code;
  const rawDescription = asText(raw.description) || asText(fallback.description);
  const splitDescription = splitSensitiveDescription(rawDescription);

  return {
    code,
    slug: slugify(slugBase) || slugify(code) || buildFallbackCode(),
    title,
    type: asText(raw.type) || asText(fallback.type) || "Nao informado",
    badge: asText(raw.badge) || asText(fallback.badge) || "⭐ DESTAQUE",
    location: asText(raw.location) || asText(fallback.location) || "Nao informado",
    cep: asNullableText(raw.cep),
    latitude: asNullableNumber(raw.latitude),
    longitude: asNullableNumber(raw.longitude),
    bedrooms: asNumber(raw.bedrooms, asNumber(fallback.bedrooms, 0)),
    bathrooms: asNumber(raw.bathrooms, asNumber(fallback.bathrooms, 0)),
    area: asNumber(raw.area, asNumber(fallback.area, 0)),
    status: asText(raw.status) || asText(fallback.status) || "Pronto",
    price: asNumber(raw.price, asNumber(fallback.price, 0)),
    description: splitDescription.publicDescription,
    internal_notes_from_description: splitDescription.internalDescription,
    is_published: asBoolean(raw.is_published, asBoolean(fallback.is_published, true)),
    image_urls: Array.isArray(raw.image_urls) ? raw.image_urls : []
  };
}

function mergeInternalNotes(existing, extracted) {
  const current = sanitizeInternalNotesText(asText(existing));
  const extra = sanitizeInternalNotesText(asText(extracted));
  if (!extra) return current || null;
  const block = `Descricao interna: ${extra}`;

  if (!current) return block;
  if (current === extra) return block;
  if (current.includes(extra)) return `Descricao interna: ${current}`;
  return `Descricao interna: ${current}\n\n${extra}`;
}

async function upsertPrivateInternalNotes(propertyId, extractedNotes) {
  const merged = mergeInternalNotes(null, extractedNotes);
  if (!merged) {
    await query("insert into property_private (property_id) values ($1) on conflict (property_id) do nothing", [propertyId]);
    return;
  }

  await query(
    `insert into property_private (property_id, internal_notes, updated_at)
     values ($1, $2, now())
     on conflict (property_id) do update set
       internal_notes = case
         when property_private.internal_notes is null or btrim(property_private.internal_notes) = '' then excluded.internal_notes
         when position(excluded.internal_notes in property_private.internal_notes) > 0 then property_private.internal_notes
         else property_private.internal_notes || E'\\n\\n' || excluded.internal_notes
       end,
       updated_at = now()`,
    [propertyId, merged]
  );
}

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

async function ensureUniqueSlugForUpdate(baseSlug, currentId) {
  let candidate = String(baseSlug || "").trim();
  if (!candidate) candidate = buildFallbackCode();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const check = await query(
      "select 1 from properties where slug = $1 and id <> $2 limit 1",
      [candidate, currentId]
    );
    if (!check.rows.length) return candidate;
    candidate = `${baseSlug}-${attempt + 2}`;
  }

  return `${baseSlug}-${Date.now().toString(36)}`;
}

router.get("/", async (_req, res) => {
  const propRows = await query("select * from properties order by created_at desc");
  const items = propRows.rows.map(dbToProperty);
  const imagesMap = await loadPropertyImages(items.map((p) => p.id));
  items.forEach((item) => {
    item.images = imagesMap.get(item.id) || [];
  });
  res.json({ ok: true, items });
});

router.post("/", upload.array("images", MAX_IMAGES_UPLOAD), async (req, res) => {
  try {
    const parsed = propertySchema.parse({
      ...req.body,
      image_urls: req.body.image_urls ? JSON.parse(req.body.image_urls) : []
    });
    const body = normalizePropertyBody(parsed);

    const insert = await query(
      `insert into properties
      (code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, is_published)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      returning *`,
      [
        body.code,
        body.slug,
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
    await upsertPrivateInternalNotes(property.id, body.internal_notes_from_description);

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
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados invalidos.", issues: err.issues });
    return res.status(500).json({ ok: false, message: "Erro ao criar imovel." });
  }
});

router.patch("/:id/visibility", async (req, res) => {
  try {
    const parsed = visibilitySchema.parse(req.body || {});
    const isPublished = asBoolean(parsed.is_published, true);
    const updated = await query(
      "update properties set is_published = $1, updated_at = now() where id = $2 returning *",
      [isPublished, req.params.id]
    );
    if (!updated.rows.length) return res.status(404).json({ ok: false, message: "Imovel nao encontrado." });
    await savePropertyVersion(req.params.id, req.user.sub, { action: "visibility", is_published: isPublished });
    return res.json({ ok: true, item: dbToProperty(updated.rows[0]) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados invalidos.", issues: err.issues });
    return res.status(500).json({ ok: false, message: "Erro ao atualizar publicacao." });
  }
});

router.put("/:id", upload.array("images", MAX_IMAGES_UPLOAD), async (req, res) => {
  try {
    const current = await query("select * from properties where id = $1 limit 1", [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, message: "Imovel nao encontrado." });

    const parsed = propertySchema.parse({
      ...req.body,
      image_urls: req.body.image_urls ? JSON.parse(req.body.image_urls) : []
    });
    const body = normalizePropertyBody(parsed, current.rows[0]);
    body.slug = await ensureUniqueSlugForUpdate(body.slug, req.params.id);

    const update = await query(
      `update properties
       set code=$1, slug=$2, title=$3, type=$4, badge=$5, location=$6, cep=$7, latitude=$8, longitude=$9, bedrooms=$10, bathrooms=$11, area=$12, status=$13, price=$14, description=$15, is_published=$16, updated_at=now()
       where id=$17 returning *`,
      [
        body.code,
        body.slug,
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

    const property = update.rows[0];
    await upsertPrivateInternalNotes(property.id, body.internal_notes_from_description);

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
    // eslint-disable-next-line no-console
    console.error("Erro ao atualizar imovel:", err);
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados invalidos.", issues: err.issues });
    if (String(err?.code || "") === "23505") {
      return res.status(409).json({ ok: false, message: "Conflito de cadastro (codigo ou slug duplicado). Ajuste titulo/codigo e tente novamente." });
    }
    if (String(err?.code || "") === "ENOSPC") {
      return res.status(507).json({ ok: false, message: "Sem espaco em disco para upload de imagens. Reduza quantidade/tamanho ou libere espaco." });
    }
    return res.status(500).json({ ok: false, message: "Erro ao atualizar imovel." });
  }
});

router.delete("/:id", async (req, res) => {
  const deleted = await query("delete from properties where id = $1 returning *", [req.params.id]);
  if (!deleted.rows.length) return res.status(404).json({ ok: false, message: "Imovel nao encontrado." });
  await savePropertyVersion(req.params.id, req.user.sub, { action: "delete", property: deleted.rows[0] });
  return res.json({ ok: true });
});

module.exports = router;
