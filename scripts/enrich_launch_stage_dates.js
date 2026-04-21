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

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&atilde;/gi, "ã")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ecirc;/gi, "ê")
    .replace(/&ocirc;/gi, "ô")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Atilde;/g, "Ã")
    .replace(/&Otilde;/g, "Õ");
}

function normalizeStage(raw) {
  const t = decodeEntities(String(raw || "")).toLowerCase();
  if (t.includes("em obras")) return "Em Obras";
  if (t.includes("lancamento") || t.includes("lançamento")) return "Lançamento";
  if (t.includes("entregue")) return "Entregue";
  if (t.includes("pronto")) return "Pronto";
  return "";
}

function normalizeMonthYear(raw) {
  const text = decodeEntities(String(raw || "")).trim();
  const m = text.match(
    /(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(\d{4})/i
  );
  if (m) {
    const month = m[1].toLowerCase();
    const map = {
      janeiro: "Janeiro",
      fevereiro: "Fevereiro",
      março: "Março",
      marco: "Março",
      abril: "Abril",
      maio: "Maio",
      junho: "Junho",
      julho: "Julho",
      agosto: "Agosto",
      setembro: "Setembro",
      outubro: "Outubro",
      novembro: "Novembro",
      dezembro: "Dezembro"
    };
    return `${map[month] || m[1]}/${m[2]}`;
  }
  const y = text.match(/\b(20\d{2})\b/);
  if (y) return y[1];
  return "";
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder("latin1").decode(bytes);
}

function extractStageAndDelivery(html) {
  const blockMatch = html.match(/<div id="detimo_descricao3"[^>]*>([\s\S]*?)<\/div>/i);
  const block = blockMatch ? blockMatch[1] : "";
  const text = decodeEntities(block)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  let stageRaw = "";
  const lowerBlock = String(block || "").toLowerCase();
  const obraIndex = lowerBlock.indexOf("obra:");
  if (obraIndex >= 0) {
    const chunk = decodeEntities(block.slice(obraIndex + "obra:".length))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    stageRaw = chunk;
  }
  if (!stageRaw) {
    stageRaw = (
      text.match(
        /Est.{0,6}gio da Obra\s*:\s*([^\n|]+?)(?=(?:\s*\||\s*(?:T.{0,3}rmino em|Previs[aã]o de entrega|Entrega em)\s*:|$))/i
      ) || []
    )[1] || "";
  }

  const deliveryRaw = (
    text.match(/(?:T.{0,3}rmino em|Previs[aã]o de entrega|Entrega em)\s*:\s*([^\n|]+)/i) || []
  )[1] || "";

  const stage = normalizeStage(stageRaw);
  const delivery = normalizeMonthYear(deliveryRaw);
  const headRaw = (block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i) || [])[1] || "";
  const headText = decodeEntities(headRaw).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const devCandidate = headText.includes("|") ? headText.split("|").slice(1).join("|").trim() : "";
  const developer = devCandidate || "";
  return { stage, delivery, developer };
}

function upsertTimelineBlock(description, stage, delivery, developer = "") {
  const base = String(description || "")
    .replace(/(?:^|\n)Andamento da Obra:[\s\S]*?(?:\n{2,}|$)/i, "\n")
    .trim();

  const lines = [];
  lines.push(`- Etapa: ${stage || "Não informado"}`);
  if (developer) lines.push(`- Construtora: ${developer}`);
  if (stage === "Em Obras") lines.push("- Situação: Obra iniciada");
  else if (stage === "Lançamento") lines.push("- Situação: Pré-obra / lançamento");
  else if (stage === "Entregue" || stage === "Pronto") lines.push("- Situação: Entregue");
  if (delivery) lines.push(`- Entrega prevista: ${delivery}`);

  const block = `Andamento da Obra:\n${lines.join("\n")}`;
  return `${block}\n\n${base}`.trim();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = path.resolve(args.input || "C:/Users/User/Downloads/Nova pasta (4)/data/launches_imobssa.json");
  const dryRun = !!args["dry-run"];
  const limit = Number(args.limit || 0);

  const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const items = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : []);
  const selected = limit > 0 ? items.slice(0, limit) : items;

  let updated = 0;
  let failed = 0;
  let noStage = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    const code = buildCode(item.external_id);
    const url = String(item.url_origem || "").trim();
    if (!code || !url) continue;

    try {
      const html = await fetchHtml(url);
      const { stage, delivery, developer } = extractStageAndDelivery(html);
      const current = await query("select id, description, status from properties where code=$1 limit 1", [code]);
      if (!current.rows.length) continue;
      const row = current.rows[0];
      const stageFinal = stage || normalizeStage(row.status) || "";
      if (!stageFinal) {
        noStage += 1;
        console.log(`[${i + 1}/${selected.length}] SEM_ETAPA ${code}`);
        continue;
      }
      const nextDescription = upsertTimelineBlock(row.description, stageFinal, delivery, developer);

      if (!dryRun) {
        await query(
          "update properties set status=$1, badge=$2, description=$3, updated_at=now() where id=$4",
          [stageFinal, stageFinal, nextDescription, row.id]
        );
      }
      updated += 1;
      console.log(`[${i + 1}/${selected.length}] OK ${code} | etapa=${stageFinal} | entrega=${delivery || "-"}`);
    } catch (err) {
      failed += 1;
      console.log(`[${i + 1}/${selected.length}] FAIL ${code}: ${String(err.message || err)}`);
    }
  }

  console.log("\nResumo etapa/entrega:");
  console.log(`- Total analisados: ${selected.length}`);
  console.log(`- Atualizados: ${updated}`);
  console.log(`- Sem etapa detectada: ${noStage}`);
  console.log(`- Falhas: ${failed}`);
  console.log(`- Modo: ${dryRun ? "DRY-RUN" : "REAL"}`);
}

run()
  .catch((err) => {
    console.error("Erro ao enriquecer etapa/entrega:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
