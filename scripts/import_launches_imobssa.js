const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/db");
const config = require("../src/config");
const { slugify } = require("../src/utils/slug");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function parsePriceBRL(raw) {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function loadInputJson(inputFile) {
  const raw = fs.readFileSync(inputFile, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;
  return [];
}

function buildCode(externalId) {
  const id = String(externalId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!id) return `LANC-${Date.now().toString(36).toUpperCase()}`;
  return `LANC-${id.slice(0, 18)}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyPhotoToProject(sourceRoot, photoRef) {
  const rel = toPosix(String(photoRef || "").replace(/^\/+/, ""));
  const srcAbs = path.resolve(sourceRoot, rel);
  if (!fs.existsSync(srcAbs)) return null;

  const dstAbs = path.resolve(config.uploadsDir, rel.replace(/^uploads\//, ""));
  ensureDir(path.dirname(dstAbs));
  fs.copyFileSync(srcAbs, dstAbs);

  const dstRelFromProject = toPosix(path.relative(process.cwd(), dstAbs));
  return `/${dstRelFromProject}`;
}

async function propertyByCode(code) {
  const row = await query("select id from properties where code = $1 limit 1", [code]);
  return row.rows[0] || null;
}

async function ensureUniqueSlug(baseSlug, currentId = null) {
  let candidate = String(baseSlug || "").trim() || `lanc-${Date.now().toString(36)}`;
  for (let i = 0; i < 30; i += 1) {
    const check = await query(
      "select id from properties where slug = $1 and ($2::uuid is null or id <> $2) limit 1",
      [candidate, currentId]
    );
    if (!check.rows.length) return candidate;
    candidate = `${baseSlug}-${i + 2}`;
  }
  return `${baseSlug}-${Date.now().toString(36)}`;
}

async function upsertLaunch(item, options) {
  const externalId = String(item.external_id || "").trim();
  if (!externalId) throw new Error("Item sem external_id.");

  const title = String(item.titulo || "").trim() || `Lançamento ${externalId.slice(0, 8)}`;
  const location = String(item.bairro_localizacao || "").trim() || "Salvador";
  const description = String(item.descricao || "").trim() || "Lançamento disponível. Consulte detalhes.";
  const price = parsePriceBRL(item.preco);
  const code = buildCode(externalId);
  const baseSlug = slugify(`${title}-${externalId.slice(0, 8)}`) || slugify(title) || code.toLowerCase();
  const found = await propertyByCode(code);
  const slug = await ensureUniqueSlug(baseSlug, found ? found.id : null);

  const propertyPayload = {
    code,
    slug,
    title,
    type: "Lançamento",
    badge: "🆕 NOVO",
    location,
    cep: null,
    latitude: null,
    longitude: null,
    bedrooms: 0,
    bathrooms: 0,
    area: 0,
    status: "Lançamento",
    price,
    description,
    is_published: true
  };

  if (options.dryRun) {
    return {
      action: found ? "update" : "insert",
      id: found ? found.id : null,
      code,
      title
    };
  }

  let propertyId = found ? found.id : null;
  if (!found) {
    const insert = await query(
      `insert into properties
        (code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, is_published)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning id`,
      [
        propertyPayload.code,
        propertyPayload.slug,
        propertyPayload.title,
        propertyPayload.type,
        propertyPayload.badge,
        propertyPayload.location,
        propertyPayload.cep,
        propertyPayload.latitude,
        propertyPayload.longitude,
        propertyPayload.bedrooms,
        propertyPayload.bathrooms,
        propertyPayload.area,
        propertyPayload.status,
        propertyPayload.price,
        propertyPayload.description,
        propertyPayload.is_published
      ]
    );
    propertyId = insert.rows[0].id;
  } else {
    await query(
      `update properties
       set slug=$1, title=$2, type=$3, badge=$4, location=$5, cep=$6, latitude=$7, longitude=$8,
           bedrooms=$9, bathrooms=$10, area=$11, status=$12, price=$13, description=$14, is_published=$15, updated_at=now()
       where id=$16`,
      [
        propertyPayload.slug,
        propertyPayload.title,
        propertyPayload.type,
        propertyPayload.badge,
        propertyPayload.location,
        propertyPayload.cep,
        propertyPayload.latitude,
        propertyPayload.longitude,
        propertyPayload.bedrooms,
        propertyPayload.bathrooms,
        propertyPayload.area,
        propertyPayload.status,
        propertyPayload.price,
        propertyPayload.description,
        propertyPayload.is_published,
        propertyId
      ]
    );
  }

  await query("insert into property_private (property_id) values ($1) on conflict (property_id) do nothing", [propertyId]);

  const sourceRoot = options.sourceRoot;
  const photos = Array.isArray(item.fotos) ? item.fotos : [];
  const imageUrls = [];
  const missingPhotos = [];
  photos.forEach((ref) => {
    const copied = copyPhotoToProject(sourceRoot, ref);
    if (copied) imageUrls.push(copied);
    else missingPhotos.push(String(ref));
  });

  await query("delete from property_images where property_id = $1", [propertyId]);
  for (let i = 0; i < imageUrls.length; i += 1) {
    await query(
      "insert into property_images (property_id, image_url, is_cover, sort_order) values ($1,$2,$3,$4)",
      [propertyId, imageUrls[i], i === 0, i]
    );
  }

  return {
    action: found ? "update" : "insert",
    id: propertyId,
    code,
    title,
    images: imageUrls.length,
    missingPhotos
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = path.resolve(
    args.input || "C:/Users/User/Downloads/Nova pasta (4)/data/launches_imobssa.json"
  );
  const sourceRoot = path.resolve(args["source-root"] || path.dirname(path.dirname(inputFile)));
  const limit = Number(args.limit || 0);
  const dryRun = !!args["dry-run"];

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Arquivo nao encontrado: ${inputFile}`);
  }

  const items = loadInputJson(inputFile);
  const selected = limit > 0 ? items.slice(0, limit) : items;

  ensureDir(config.uploadsDir);
  ensureDir(path.join(config.uploadsDir, "imobssa"));

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let missingPhotoCount = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    try {
      const result = await upsertLaunch(item, { dryRun, sourceRoot });
      if (result.action === "insert") inserted += 1;
      else updated += 1;
      missingPhotoCount += Array.isArray(result.missingPhotos) ? result.missingPhotos.length : 0;
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${selected.length}] ${result.action.toUpperCase()} ${result.code} - ${result.title}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[${i + 1}/${selected.length}] FALHA: ${String(err.message || err)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\nResumo:");
  // eslint-disable-next-line no-console
  console.log(`- Total lidos: ${selected.length}`);
  // eslint-disable-next-line no-console
  console.log(`- Inseridos: ${inserted}`);
  // eslint-disable-next-line no-console
  console.log(`- Atualizados: ${updated}`);
  // eslint-disable-next-line no-console
  console.log(`- Falhas: ${failed}`);
  // eslint-disable-next-line no-console
  console.log(`- Fotos ausentes na origem: ${missingPhotoCount}`);
  // eslint-disable-next-line no-console
  console.log(`- Modo: ${dryRun ? "DRY-RUN (sem gravar no banco)" : "IMPORTACAO REAL"}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro na importacao de lancamentos:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
