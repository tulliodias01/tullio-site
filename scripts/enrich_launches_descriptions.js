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

function buildCode(externalId) {
  const id = String(externalId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!id) return "";
  return `LANC-${id.slice(0, 18)}`;
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = Number.parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&Ccedil;/g, "Ç")
    .replace(/&atilde;/gi, "ã")
    .replace(/&Atilde;/g, "Ã")
    .replace(/&aacute;/gi, "á")
    .replace(/&Aacute;/g, "Á")
    .replace(/&agrave;/gi, "à")
    .replace(/&Agrave;/g, "À")
    .replace(/&acirc;/gi, "â")
    .replace(/&Acirc;/g, "Â")
    .replace(/&eacute;/gi, "é")
    .replace(/&Eacute;/g, "É")
    .replace(/&ecirc;/gi, "ê")
    .replace(/&Ecirc;/g, "Ê")
    .replace(/&iacute;/gi, "í")
    .replace(/&Iacute;/g, "Í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&ocirc;/gi, "ô")
    .replace(/&Ocirc;/g, "Ô")
    .replace(/&otilde;/gi, "õ")
    .replace(/&Otilde;/g, "Õ")
    .replace(/&uacute;/gi, "ú")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&ordm;/gi, "º")
    .replace(/&sup2;/gi, "²")
    .replace(/&sup3;/gi, "³")
    .replace(/&deg;/gi, "°")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, " - ")
    .replace(/&ldquo;|&rdquo;/gi, "\"")
    .replace(/&lsquo;|&rsquo;/gi, "'");
}

function repairMojibake(value) {
  const text = String(value || "");
  if (!/[ÃÂ]/.test(text)) return text;
  const map = {
    "Ã¡": "á", "Ãà": "à", "Ãâ": "â", "Ãã": "ã", "Ãä": "ä",
    "Ãé": "é", "Ãè": "è", "Ãê": "ê", "Ãë": "ë",
    "Ãí": "í", "Ãì": "ì", "Ãî": "î", "Ãï": "ï",
    "Ãó": "ó", "Ãò": "ò", "Ãô": "ô", "Ãõ": "õ", "Ãö": "ö",
    "Ãú": "ú", "Ãù": "ù", "Ãû": "û", "Ãü": "ü",
    "Ãç": "ç", "Ãñ": "ñ",
    "Ã": "Á", "Ã€": "À", "Ã‚": "Â", "Ãƒ": "Ã", "Ã„": "Ä",
    "Ã‰": "É", "Ãˆ": "È", "ÃŠ": "Ê", "Ã‹": "Ë",
    "Ã": "Í", "ÃŒ": "Ì", "ÃŽ": "Î", "Ã": "Ï",
    "Ã“": "Ó", "Ã’": "Ò", "Ã”": "Ô", "Ã•": "Õ", "Ã–": "Ö",
    "Ãš": "Ú", "Ã™": "Ù", "Ã›": "Û", "Ãœ": "Ü",
    "Ã‡": "Ç", "Ã‘": "Ñ"
  };
  return text.replace(/Ã.|Â./g, (chunk) => map[chunk] || chunk).replace(/Â(?![A-Za-zÀ-ÿ0-9])/g, "");
}

function htmlToText(html) {
  let text = String(html || "");
  text = decodeHtmlEntities(text);
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function normalizeDescription(text) {
  return repairMojibake(String(text || ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLongDescriptionBlock(html) {
  const positions = [];
  const re = /id="detimo_descricao3"/g;
  let m;
  while ((m = re.exec(html))) positions.push(m.index);
  if (!positions.length) return "";
  // Em geral: 1º = resumo do empreendimento, 2º = descrição longa.
  const targetIndex = positions[1] ?? positions[0];
  const nextIndex = positions.find((p) => p > targetIndex) ?? html.length;
  const openTagEnd = html.indexOf(">", targetIndex);
  if (openTagEnd < 0) return "";
  const raw = html.slice(openTagEnd + 1, nextIndex);
  const cutAtMap = raw.search(/Mapa de Localiza|Central de Neg[oó]cios|Proposta \/ Informa/i);
  return cutAtMap > 0 ? raw.slice(0, cutAtMap) : raw;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder("latin1").decode(bytes);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = path.resolve(
    args.input || "C:/Users/User/Downloads/Nova pasta (4)/data/launches_imobssa.json"
  );
  const dryRun = !!args["dry-run"];
  const limit = Number(args.limit || 0);

  const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const items = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : []);
  const selected = limit > 0 ? items.slice(0, limit) : items;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    const code = buildCode(item.external_id);
    const url = String(item.url_origem || "").trim();
    if (!code || !url) {
      skipped += 1;
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${selected.length}] SKIP sem code/url`);
      continue;
    }

    try {
      const html = await fetchHtml(url);
      const block = extractLongDescriptionBlock(html);
      const text = normalizeDescription(htmlToText(block));
      if (!text || text.length < 120) {
        skipped += 1;
        // eslint-disable-next-line no-console
        console.log(`[${i + 1}/${selected.length}] SKIP ${code} descrição curta/ausente`);
        continue;
      }

      if (!dryRun) {
        await query("update properties set description = $1, updated_at = now() where code = $2", [text, code]);
      }
      updated += 1;
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${selected.length}] OK ${code} (${text.length} chars)`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${selected.length}] FAIL ${code}: ${String(err.message || err)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\nResumo enriquecimento:");
  // eslint-disable-next-line no-console
  console.log(`- Total analisados: ${selected.length}`);
  // eslint-disable-next-line no-console
  console.log(`- Atualizados: ${updated}`);
  // eslint-disable-next-line no-console
  console.log(`- Ignorados: ${skipped}`);
  // eslint-disable-next-line no-console
  console.log(`- Falhas: ${failed}`);
  // eslint-disable-next-line no-console
  console.log(`- Modo: ${dryRun ? "DRY-RUN" : "REAL"}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro no enriquecimento:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
