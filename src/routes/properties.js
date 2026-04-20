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

let ensureHomeFeaturedSchemaPromise = null;

async function ensureHomeFeaturedSchema() {
  if (!ensureHomeFeaturedSchemaPromise) {
    ensureHomeFeaturedSchemaPromise = (async () => {
      await query("alter table properties add column if not exists home_featured boolean not null default false");
      await query("alter table properties add column if not exists home_featured_order smallint");
      await query("drop index if exists idx_properties_home_featured_order_unique");
      await query(
        "create unique index if not exists idx_properties_home_featured_order_unique on properties(home_featured_order) where home_featured = true and home_featured_order is not null"
      );
    })().catch((err) => {
      ensureHomeFeaturedSchemaPromise = null;
      throw err;
    });
  }
  return ensureHomeFeaturedSchemaPromise;
}

router.use(async (_req, res, next) => {
  try {
    await ensureHomeFeaturedSchema();
    next();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Erro ao preparar schema de destaque home:", err);
    res.status(500).json({ ok: false, message: "Falha ao preparar schema de destaque da home." });
  }
});

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
  home_featured: z.union([z.boolean(), z.string()]).optional().nullable(),
  home_featured_order: z.union([z.coerce.number().int().min(1).max(3), z.literal(""), z.null()]).optional().nullable(),
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

function asNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num)) return null;
  return num;
}

function normalizePropertyBody(raw, fallback = {}) {
  const fallbackCode = asText(fallback.code);
  const code = asText(raw.code) || fallbackCode || buildFallbackCode();
  const title = asText(raw.title) || asText(fallback.title) || "Imovel sem titulo";
  const slugBase = asText(raw.title) || title || code;
  const rawDescription = asText(raw.description) || asText(fallback.description);
  const splitDescription = splitSensitiveDescription(rawDescription);

  const homeFeatured = asBoolean(raw.home_featured, asBoolean(fallback.home_featured, false));
  const homeFeaturedOrderRaw = asNullableInt(raw.home_featured_order);
  const fallbackOrder = asNullableInt(fallback.home_featured_order);
  const homeFeaturedOrder = homeFeatured ? (homeFeaturedOrderRaw ?? fallbackOrder ?? null) : null;

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
    home_featured: homeFeatured,
    home_featured_order: homeFeaturedOrder,
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
    home_featured: !!row.home_featured,
    home_featured_order: row.home_featured_order !== null ? Number(row.home_featured_order) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    images: []
  };
}

async function assignFeaturedOrderIfNeeded(inputOrder, currentPropertyId = null) {
  if (Number.isInteger(inputOrder) && inputOrder >= 1 && inputOrder <= 3) return inputOrder;
  const rows = await query(
    `select home_featured_order
     from properties
     where home_featured = true
       and home_featured_order is not null
       and ($1::uuid is null or id <> $1)`,
    [currentPropertyId]
  );
  const used = new Set(rows.rows.map((r) => Number(r.home_featured_order)).filter((n) => Number.isInteger(n)));
  for (let slot = 1; slot <= 3; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
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
  try {
    await query(
      "insert into property_versions (property_id, changed_by, payload) values ($1, $2, $3::jsonb)",
      [propertyId, changedBy || null, JSON.stringify(payload)]
    );
  } catch (err) {
    // Se o usuario do token nao existir mais na tabela admin_users, nao bloqueia o cadastro/edicao.
    if (String(err?.code || "") === "23503") {
      await query(
        "insert into property_versions (property_id, changed_by, payload) values ($1, $2, $3::jsonb)",
        [propertyId, null, JSON.stringify(payload)]
      );
      return;
    }
    throw err;
  }
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
    if (body.home_featured) {
      body.home_featured_order = await assignFeaturedOrderIfNeeded(body.home_featured_order, null);
      if (!body.home_featured_order) {
        return res.status(409).json({ ok: false, message: "Ja existem 3 imoveis em destaque na home. Desmarque um deles ou altere a ordem." });
      }
    } else {
      body.home_featured_order = null;
    }

    const insert = await query(
      `insert into properties
      (code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, is_published, home_featured, home_featured_order)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
        body.is_published,
        body.home_featured,
        body.home_featured_order
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
    // eslint-disable-next-line no-console
    console.error("Erro ao criar imovel:", err);
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados invalidos.", issues: err.issues });
    if (String(err?.code || "") === "ENOSPC") {
      return res.status(507).json({ ok: false, message: "Sem espaco em disco para upload de imagens." });
    }
    if (String(err?.code || "") === "23505") {
      return res.status(409).json({ ok: false, message: "Conflito de destaque na home. Escolha outra ordem (1, 2 ou 3)." });
    }
    const code = String(err?.code || "SEM_COD");
    const detail = String(err?.detail || "").trim();
    return res.status(500).json({ ok: false, message: `Erro ao criar imovel [${code}]${detail ? `: ${detail}` : ""}` });
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
    if (body.home_featured) {
      body.home_featured_order = await assignFeaturedOrderIfNeeded(body.home_featured_order, req.params.id);
      if (!body.home_featured_order) {
        return res.status(409).json({ ok: false, message: "Ja existem 3 imoveis em destaque na home. Desmarque um deles ou altere a ordem." });
      }
    } else {
      body.home_featured_order = null;
    }

    const update = await query(
      `update properties
       set code=$1, slug=$2, title=$3, type=$4, badge=$5, location=$6, cep=$7, latitude=$8, longitude=$9, bedrooms=$10, bathrooms=$11, area=$12, status=$13, price=$14, description=$15, is_published=$16, home_featured=$17, home_featured_order=$18, updated_at=now()
       where id=$19 returning *`,
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
        body.home_featured,
        body.home_featured_order,
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
      const detail = String(err?.detail || "").toLowerCase();
      if (detail.includes("home_featured_order")) {
        return res.status(409).json({ ok: false, message: "Conflito de destaque na home. Escolha outra ordem (1, 2 ou 3)." });
      }
      return res.status(409).json({ ok: false, message: "Conflito de cadastro (codigo ou slug duplicado). Ajuste titulo/codigo e tente novamente." });
    }
    if (String(err?.code || "") === "ENOSPC") {
      return res.status(507).json({ ok: false, message: "Sem espaco em disco para upload de imagens. Reduza quantidade/tamanho ou libere espaco." });
    }
    const code = String(err?.code || "SEM_COD");
    const detail = String(err?.detail || "").trim();
    return res.status(500).json({ ok: false, message: `Erro ao atualizar imovel [${code}]${detail ? `: ${detail}` : ""}` });
  }
});

router.delete("/:id", async (req, res) => {
  const deleted = await query("delete from properties where id = $1 returning *", [req.params.id]);
  if (!deleted.rows.length) return res.status(404).json({ ok: false, message: "Imovel nao encontrado." });
  await savePropertyVersion(req.params.id, req.user.sub, { action: "delete", property: deleted.rows[0] });
  return res.json({ ok: true });
});

module.exports = router;
