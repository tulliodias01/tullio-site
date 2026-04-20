const express = require("express");
const { query } = require("../db");
const config = require("../config");
const { sanitizePublicDescription } = require("../utils/sanitizePublicDescription");

const router = express.Router();

let ensureHomeFeaturedSchemaPromise = null;

async function ensureHomeFeaturedSchema() {
  if (!ensureHomeFeaturedSchemaPromise) {
    ensureHomeFeaturedSchemaPromise = (async () => {
      await query("alter table properties add column if not exists home_featured boolean not null default false");
      await query("alter table properties add column if not exists home_featured_order smallint");
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
    console.error("Erro ao preparar schema publico de destaque home:", err);
    res.status(500).json({ ok: false, message: "Falha ao carregar propriedades." });
  }
});

router.get("/properties", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 24), 100);
  const rows = await query(
    "select id, code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, home_featured, home_featured_order, created_at, updated_at from properties where is_published = true order by created_at desc limit $1",
    [limit]
  );
  const ids = rows.rows.map((r) => r.id);
  let imagesMap = new Map();
  if (ids.length) {
    const imgs = await query(
      "select property_id, image_url, is_cover, sort_order from property_images where property_id = any($1::uuid[]) order by sort_order asc, created_at asc",
      [ids]
    );
    imagesMap = new Map();
    imgs.rows.forEach((img) => {
      if (!imagesMap.has(img.property_id)) imagesMap.set(img.property_id, []);
      imagesMap.get(img.property_id).push({ url: img.image_url, is_cover: img.is_cover });
    });
  }

  const items = rows.rows.map((item) => ({
    ...item,
    description: sanitizePublicDescription(item.description),
    images: imagesMap.get(item.id) || []
  }));
  return res.json({ ok: true, items });
});

router.get("/properties/:slug", async (req, res) => {
  const row = await query(
    "select id, code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, home_featured, home_featured_order, created_at, updated_at from properties where slug = $1 and is_published = true limit 1",
    [req.params.slug]
  );
  if (!row.rows.length) return res.status(404).json({ ok: false, message: "Imóvel não encontrado." });
  const property = row.rows[0];
  property.description = sanitizePublicDescription(property.description);
  const imgs = await query(
    "select image_url, is_cover, sort_order from property_images where property_id = $1 order by sort_order asc",
    [property.id]
  );
  property.images = imgs.rows;
  return res.json({ ok: true, item: property });
});

router.get("/sitemap.xml", async (_req, res) => {
  const rows = await query("select slug, updated_at from properties where is_published = true");
  const urls = [
    `${config.siteUrl}/`
  ];
  rows.rows.forEach((r) => urls.push(`${config.siteUrl}/imoveis/${r.slug}`));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
  res.type("application/xml").send(xml);
});

module.exports = router;
