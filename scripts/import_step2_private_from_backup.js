const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/db');

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
  return { headers: rows[0].map((h) => String(h || '').trim()), data: rows.slice(1) };
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
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) normalized = cleaned.replace(/,/g, '');
  else normalized = cleaned.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function asNullableText(v) {
  const s = String(v || '').trim();
  return s ? s : null;
}

function ownerTypeFromDocument(doc) {
  const digits = String(doc || '').replace(/\D/g, '');
  if (digits.length === 11) return 'PF';
  if (digits.length === 14) return 'PJ';
  return null;
}

function compactLines(lines) {
  const text = lines.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
  return text ? text.slice(0, 10000) : null;
}

async function main() {
  const backupDirArg = process.argv[2];
  const backupDir = backupDirArg ? path.resolve(backupDirArg) : DEFAULT_BACKUP_DIR;
  const filePath = path.join(backupDir, 'imoveis.xls');

  if (!fs.existsSync(filePath)) throw new Error(`Arquivo nao encontrado: ${filePath}`);

  const { headers, data } = parseTable(filePath);

  const idx = {
    legacyId: findHeaderIndex(headers, ['ID']),
    ownerName: findHeaderIndex(headers, ['Proprietario Nome', 'Proprietário Nome']),
    ownerEmail: findHeaderIndex(headers, ['Proprietario Email', 'Proprietário Email']),
    ownerPhone: findHeaderIndex(headers, ['Proprietario Celular', 'Proprietário Celular']),
    ownerDocument: findHeaderIndex(headers, ['Proprietario Documento', 'Proprietário Documento']),
    keyLocation: findHeaderIndex(headers, ['Chave']),
    commissionSale: findHeaderIndex(headers, ['Comissao de Venda', 'Comissão de Venda']),
    internalDescription: findHeaderIndex(headers, ['Descricao Interna', 'Descrição Interna']),
    status: findHeaderIndex(headers, ['Status']),
    situation: findHeaderIndex(headers, ['Situacao', 'Situação']),
    purpose: findHeaderIndex(headers, ['Finalidade']),
    captorName: findHeaderIndex(headers, ['Corretor Captador Nome']),
    captorEmail: findHeaderIndex(headers, ['Corretor Captador Email']),
    captorPhone: findHeaderIndex(headers, ['Corretor Captador Celular']),
    respName: findHeaderIndex(headers, ['Corretor Resposavel Nome', 'Corretor Resposável Nome']),
    respEmail: findHeaderIndex(headers, ['Corretor Resposavel Email', 'Corretor Resposável Email']),
    respPhone: findHeaderIndex(headers, ['Corretor Resposavel Celular', 'Corretor Resposável Celular']),
    rawDescription: findHeaderIndex(headers, ['Descricao', 'Descrição'])
  };

  let updated = 0;
  let found = 0;

  for (const row of data) {
    const legacyId = valueAt(row, idx.legacyId);
    if (!legacyId) continue;
    const code = `SUP-${legacyId}`;

    const property = await query('select id from properties where code = $1 limit 1', [code]);
    if (!property.rows.length) continue;
    found += 1;

    const ownerDocument = asNullableText(valueAt(row, idx.ownerDocument));
    const ownerName = asNullableText(valueAt(row, idx.ownerName));
    const ownerEmail = asNullableText(valueAt(row, idx.ownerEmail));
    const ownerPhone = asNullableText(valueAt(row, idx.ownerPhone));

    const contractStatus = [
      asNullableText(valueAt(row, idx.status)),
      asNullableText(valueAt(row, idx.situation)),
      asNullableText(valueAt(row, idx.purpose))
    ].filter(Boolean).join(' | ') || null;

    const internalNotes = compactLines([
      asNullableText(valueAt(row, idx.internalDescription)) ? `Descricao interna: ${valueAt(row, idx.internalDescription)}` : '',
      asNullableText(valueAt(row, idx.rawDescription)) ? `Resumo anuncio: ${valueAt(row, idx.rawDescription).slice(0, 1200)}` : '',
      asNullableText(valueAt(row, idx.captorName)) ? `Corretor captador: ${valueAt(row, idx.captorName)} | ${valueAt(row, idx.captorEmail)} | ${valueAt(row, idx.captorPhone)}` : '',
      asNullableText(valueAt(row, idx.respName)) ? `Corretor responsavel: ${valueAt(row, idx.respName)} | ${valueAt(row, idx.respEmail)} | ${valueAt(row, idx.respPhone)}` : ''
    ]);

    const commissionSale = parseNumber(valueAt(row, idx.commissionSale));
    const keysLocation = asNullableText(valueAt(row, idx.keyLocation));

    await query(
      `insert into property_private (
         property_id, owner_name, owner_phone, owner_email, owner_document, owner_type,
         internal_notes, commission_sale, contract_status, keys_location, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       on conflict (property_id) do update set
         owner_name = excluded.owner_name,
         owner_phone = excluded.owner_phone,
         owner_email = excluded.owner_email,
         owner_document = excluded.owner_document,
         owner_type = excluded.owner_type,
         internal_notes = excluded.internal_notes,
         commission_sale = excluded.commission_sale,
         contract_status = excluded.contract_status,
         keys_location = excluded.keys_location,
         updated_at = now()`,
      [
        property.rows[0].id,
        ownerName,
        ownerPhone,
        ownerEmail,
        ownerDocument,
        ownerTypeFromDocument(ownerDocument),
        internalNotes,
        commissionSale,
        contractStatus,
        keysLocation
      ]
    );

    updated += 1;
  }

  const stats = await query(`
    select
      count(*)::int as total_private,
      count(*) filter (where owner_name is not null)::int as with_owner_name,
      count(*) filter (where owner_email is not null)::int as with_owner_email,
      count(*) filter (where owner_phone is not null)::int as with_owner_phone,
      count(*) filter (where owner_document is not null)::int as with_owner_document,
      count(*) filter (where internal_notes is not null)::int as with_internal_notes,
      count(*) filter (where commission_sale is not null)::int as with_commission_sale,
      count(*) filter (where keys_location is not null)::int as with_keys_location
    from property_private
  `);

  console.log('--- PASSO 2 RESUMO ---');
  console.log(`Imoveis SUP encontrados: ${found}`);
  console.log(`Registros private atualizados: ${updated}`);
  console.log(JSON.stringify(stats.rows[0], null, 2));
}

main()
  .catch((err) => {
    console.error('ERRO PASSO 2:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
