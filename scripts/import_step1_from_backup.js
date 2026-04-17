const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/db');
const { slugify } = require('../src/utils/slug');

const DEFAULT_BACKUP_DIR = "C:/Users/User/Downloads/Nova pasta (3)/Backup A&S SupremoCRM - 20260415";

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTable(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const rowMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows = rowMatches.map((m) => {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => {
      const noTags = c[1].replace(/<[^>]*>/g, '');
      return decodeHtmlEntities(noTags);
    });
    return cells;
  }).filter((r) => r.length > 0);

  if (!rows.length) return { headers: [], data: [] };
  const headers = rows[0].map((h) => String(h || '').trim());
  const data = rows.slice(1);
  return { headers, data };
}

function findHeaderIndex(headers, candidates) {
  const normalized = headers.map(normalizeText);
  for (const candidate of candidates) {
    const c = normalizeText(candidate);
    const exact = normalized.findIndex((h) => h === c);
    if (exact >= 0) return exact;
  }
  for (const candidate of candidates) {
    const c = normalizeText(candidate);
    const includes = normalized.findIndex((h) => h.includes(c));
    if (includes >= 0) return includes;
  }
  return -1;
}

function valueAt(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  return String(row[idx] || '').trim();
}

function parseNumber(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9,.-]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned.replace(',', '.');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(raw, fallback = 0) {
  const n = parseNumber(raw);
  if (n === null) return fallback;
  return Math.max(0, Math.round(n));
}

function parseDateTime(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return s;
  return null;
}

async function upsertProperty(item) {
  let slug = item.slug;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await query(
        `insert into properties
          (code, slug, title, type, badge, location, cep, latitude, longitude, bedrooms, bathrooms, area, status, price, description, is_published)
         values
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (code) do update set
          slug = excluded.slug,
          title = excluded.title,
          type = excluded.type,
          badge = excluded.badge,
          location = excluded.location,
          cep = excluded.cep,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          bedrooms = excluded.bedrooms,
          bathrooms = excluded.bathrooms,
          area = excluded.area,
          status = excluded.status,
          price = excluded.price,
          description = excluded.description,
          is_published = excluded.is_published,
          updated_at = now()
         returning id, slug, code`,
        [
          item.code,
          slug,
          item.title,
          item.type,
          item.badge,
          item.location,
          item.cep,
          item.latitude,
          item.longitude,
          item.bedrooms,
          item.bathrooms,
          item.area,
          item.status,
          item.price,
          item.description,
          item.is_published
        ]
      );

      await query(
        'insert into property_private (property_id) values ($1) on conflict (property_id) do nothing',
        [result.rows[0].id]
      );

      return result.rows[0];
    } catch (err) {
      if (!String(err.message || '').includes('properties_slug_key')) throw err;
      slug = `${item.slug}-${attempt + 2}`;
    }
  }

  throw new Error(`Nao foi possivel gerar slug unico para ${item.code}`);
}

async function importProperties(backupDir) {
  const filePath = path.join(backupDir, 'imoveis.xls');
  const { headers, data } = parseTable(filePath);

  const idx = {
    legacyId: findHeaderIndex(headers, ['ID']),
    title: findHeaderIndex(headers, ['Nome']),
    type: findHeaderIndex(headers, ['Tipo Nome']),
    location: findHeaderIndex(headers, ['Bairro Nome']),
    city: findHeaderIndex(headers, ['Cidade Nome']),
    cep: findHeaderIndex(headers, ['CEP']),
    status: findHeaderIndex(headers, ['Status']),
    propertyState: findHeaderIndex(headers, ['Situacao']),
    price: findHeaderIndex(headers, ['Preco']),
    bedrooms: findHeaderIndex(headers, ['Quartos']),
    bathrooms: findHeaderIndex(headers, ['Banheiros']),
    areaTotal: findHeaderIndex(headers, ['Area Total']),
    areaBuilt: findHeaderIndex(headers, ['Area Construida']),
    latitude: findHeaderIndex(headers, ['Latitude']),
    longitude: findHeaderIndex(headers, ['Longitude']),
    description: findHeaderIndex(headers, ['Descricao']),
    descriptionInternal: findHeaderIndex(headers, ['Descricao Interna'])
  };

  const legacyToProperty = new Map();
  let imported = 0;

  for (const row of data) {
    const legacyId = valueAt(row, idx.legacyId);
    const title = valueAt(row, idx.title) || `Imovel ${legacyId || ''}`.trim();
    const code = legacyId ? `SUP-${legacyId}` : `SUP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const slug = slugify(title) || slugify(code) || `imovel-${Date.now()}`;
    const bairro = valueAt(row, idx.location);
    const cidade = valueAt(row, idx.city);
    const location = [bairro, cidade].filter(Boolean).join(' - ') || 'Nao informado';
    const rawStatus = valueAt(row, idx.status);
    const status = valueAt(row, idx.propertyState) || rawStatus || 'Pronto';
    const isPublished = !['inativo', 'inativa', 'despublicado'].includes(normalizeText(rawStatus));

    const areaTotal = parseNumber(valueAt(row, idx.areaTotal));
    const areaBuilt = parseNumber(valueAt(row, idx.areaBuilt));

    const descriptionParts = [valueAt(row, idx.description), valueAt(row, idx.descriptionInternal)].filter(Boolean);

    const property = {
      code,
      slug,
      title,
      type: valueAt(row, idx.type) || 'Nao informado',
      badge: '⭐ DESTAQUE',
      location,
      cep: valueAt(row, idx.cep) || null,
      latitude: parseNumber(valueAt(row, idx.latitude)),
      longitude: parseNumber(valueAt(row, idx.longitude)),
      bedrooms: parseIntSafe(valueAt(row, idx.bedrooms), 0),
      bathrooms: parseIntSafe(valueAt(row, idx.bathrooms), 0),
      area: areaTotal || areaBuilt || 0,
      status,
      price: parseNumber(valueAt(row, idx.price)) || 0,
      description: descriptionParts.join('\n\n').slice(0, 12000),
      is_published: isPublished
    };

    const saved = await upsertProperty(property);
    if (legacyId) legacyToProperty.set(legacyId, saved);
    imported += 1;
  }

  return { imported, legacyToProperty };
}

async function importPhotos(backupDir, legacyToProperty) {
  const filePath = path.join(backupDir, 'imofotos.xls');
  const { headers, data } = parseTable(filePath);

  const idxProperty = findHeaderIndex(headers, ['ID Imovel', 'ID Imóvel']);
  const idxOrder = findHeaderIndex(headers, ['Ordem']);
  const idxUrl = findHeaderIndex(headers, ['URL']);

  let inserted = 0;

  for (const row of data) {
    const legacyId = valueAt(row, idxProperty);
    const url = valueAt(row, idxUrl);
    if (!legacyId || !url) continue;

    const property = legacyToProperty.get(legacyId);
    if (!property) continue;

    const exists = await query(
      'select 1 from property_images where property_id = $1 and image_url = $2 limit 1',
      [property.id, url]
    );
    if (exists.rows.length) continue;

    const order = parseIntSafe(valueAt(row, idxOrder), 0);
    const hasCover = await query('select 1 from property_images where property_id = $1 and is_cover = true limit 1', [property.id]);

    await query(
      'insert into property_images (property_id, image_url, is_cover, sort_order) values ($1,$2,$3,$4)',
      [property.id, url, hasCover.rows.length === 0, order]
    );
    inserted += 1;
  }

  return { inserted };
}

async function importLeads(backupDir, legacyToProperty) {
  const filePath = path.join(backupDir, 'leads_1.xls');
  const { headers, data } = parseTable(filePath);

  const idx = {
    leadId: findHeaderIndex(headers, ['Lead ID']),
    name: findHeaderIndex(headers, ['Pessoa Nome']),
    phone: findHeaderIndex(headers, ['Pessoa Telefone']),
    email: findHeaderIndex(headers, ['Pessoa Email']),
    source: findHeaderIndex(headers, ['Origem Nome']),
    message: findHeaderIndex(headers, ['Interesses']),
    notes: findHeaderIndex(headers, ['Anotacoes', 'Anotações']),
    propertyLegacyId: findHeaderIndex(headers, ['Imovel ID', 'Imóvel ID']),
    createdAt: findHeaderIndex(headers, ['Data Captura'])
  };

  let inserted = 0;

  for (const row of data) {
    const name = valueAt(row, idx.name) || 'Lead sem nome';
    const phone = valueAt(row, idx.phone) || 'Nao informado';
    const email = valueAt(row, idx.email) || null;
    const source = valueAt(row, idx.source) || 'supremo_crm';
    const leadId = valueAt(row, idx.leadId);

    const message = [valueAt(row, idx.message), valueAt(row, idx.notes)].filter(Boolean).join('\n\n').slice(0, 10000) || 'Sem mensagem';
    const createdAt = parseDateTime(valueAt(row, idx.createdAt));

    const legacyPropertyId = valueAt(row, idx.propertyLegacyId);
    const mappedProperty = legacyPropertyId ? legacyToProperty.get(legacyPropertyId) : null;

    const duplicate = leadId
      ? await query('select 1 from leads where source = $1 and message like $2 limit 1', [source, `%Lead ID ${leadId}%`])
      : { rows: [] };
    if (duplicate.rows.length) continue;

    const finalMessage = leadId ? `Lead ID ${leadId}\n\n${message}` : message;

    await query(
      `insert into leads
        (property_id, property_slug, name, phone, email, message, source, created_at)
       values
        ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()))`,
      [
        mappedProperty?.id || null,
        mappedProperty?.slug || null,
        name,
        phone,
        email,
        finalMessage,
        source,
        createdAt
      ]
    );
    inserted += 1;
  }

  return { inserted };
}

async function main() {
  const backupDirArg = process.argv[2];
  const backupDir = backupDirArg ? path.resolve(backupDirArg) : DEFAULT_BACKUP_DIR;

  if (!fs.existsSync(backupDir)) {
    throw new Error(`Diretorio de backup nao encontrado: ${backupDir}`);
  }

  console.log(`IMPORTANDO DE: ${backupDir}`);

  const properties = await importProperties(backupDir);
  const photos = await importPhotos(backupDir, properties.legacyToProperty);
  const leads = await importLeads(backupDir, properties.legacyToProperty);

  console.log('--- RESUMO ---');
  console.log(`Imoveis processados: ${properties.imported}`);
  console.log(`Fotos inseridas: ${photos.inserted}`);
  console.log(`Leads inseridos: ${leads.inserted}`);
}

main()
  .catch((err) => {
    console.error('ERRO IMPORTACAO:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
