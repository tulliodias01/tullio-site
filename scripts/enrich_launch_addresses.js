const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/db");

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

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildCode(externalId) {
  const id = String(externalId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!id) return "";
  return `LANC-${id.slice(0, 18)}`;
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder("latin1").decode(bytes);
}

function parseAddressData(html) {
  const data = {};
  const blockMatch = html.match(/<div id="detimo_desc"[^>]*>([\s\S]*?)<\/div>/i);
  const block = blockMatch ? blockMatch[1] : "";
  const raw = cleanText(block);

  if (raw) {
    const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^([^:]+):\s*(.+)$/);
      if (!m) continue;
      const key = normalizeKey(cleanText(m[1]));
      const val = cleanText(m[2]);

      if (key.includes("endereco")) data.endereco = val;
      else if (key.includes("bairro")) data.bairro = val;
      else if (key.includes("ponto de referencia")) data.referencia = val;
      else if (key.includes("condominio")) data.condominio = val;
      else if (key === "cep") data.cep = val;
    }
  }

  if (!data.cep) {
    const mapMatch = html.match(/\/mapa\/[^"']*?(\d{5}-?\d{3})/i);
    if (mapMatch) data.cep = mapMatch[1];
  }

  if (data.cep) data.cep = data.cep.replace(/[^\d-]/g, "");
  return data;
}

function mergeAddressIntoDescription(current, addressData) {
  const base = String(current || "")
    .replace(/(?:^|\n)Endere[cç]o do Empreendimento:[\s\S]*?(?=\n[A-Z][^:\n]{2,80}:|\s*$)/i, "")
    .trim();

  const lines = [];
  if (addressData.endereco) lines.push(`- Endereco: ${addressData.endereco}`);
  if (addressData.bairro) lines.push(`- Bairro: ${addressData.bairro}`);
  if (addressData.cep) lines.push(`- CEP: ${addressData.cep}`);
  if (addressData.referencia) lines.push(`- Referencia: ${addressData.referencia}`);
  if (addressData.condominio) lines.push(`- Condominio: ${addressData.condominio}`);
  if (!lines.length) return base;

  const block = `Endereco do Empreendimento:\n${lines.join("\n")}`;
  return `${block}\n\n${base}`.trim();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = path.resolve(args.input || "C:/Users/User/Downloads/Nova pasta (4)/data/launches_imobssa.json");
  const dryRun = !!args["dry-run"];
  const limit = Number(args.limit || 0);

  const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const items = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : []);
  const selected = limit > 0 ? items.slice(0, limit) : items;

  let updated = 0;
  let failed = 0;
  let noAddress = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    const code = buildCode(item.external_id);
    const url = String(item.url_origem || "").trim();
    if (!code || !url) continue;

    try {
      const html = await fetchHtml(url);
      const addr = parseAddressData(html);

      if (!addr.endereco && !addr.bairro && !addr.cep && !addr.referencia && !addr.condominio) {
        noAddress += 1;
        console.log(`[${i + 1}/${selected.length}] SEM_ENDERECO ${code}`);
        continue;
      }

      const current = await query("select id, description, location, cep from properties where code=$1 limit 1", [code]);
      if (!current.rows.length) continue;

      const row = current.rows[0];
      const nextDescription = mergeAddressIntoDescription(row.description, addr);
      const nextLocation = addr.bairro || row.location;
      const nextCep = addr.cep || row.cep;

      if (!dryRun) {
        await query(
          "update properties set description=$1, location=$2, cep=$3, updated_at=now() where id=$4",
          [nextDescription, nextLocation, nextCep, row.id]
        );
      }

      updated += 1;
      console.log(`[${i + 1}/${selected.length}] OK ${code} | ${addr.bairro || "-"} | ${addr.cep || "-"}`);
    } catch (err) {
      failed += 1;
      console.log(`[${i + 1}/${selected.length}] FAIL ${code}: ${String(err.message || err)}`);
    }
  }

  console.log("\nResumo endereco:");
  console.log(`- Total analisados: ${selected.length}`);
  console.log(`- Atualizados: ${updated}`);
  console.log(`- Sem endereco detectado: ${noAddress}`);
  console.log(`- Falhas: ${failed}`);
  console.log(`- Modo: ${dryRun ? "DRY-RUN" : "REAL"}`);
}

run()
  .catch((err) => {
    console.error("Erro ao enriquecer enderecos:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
