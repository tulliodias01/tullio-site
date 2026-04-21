const { query, pool } = require("../src/db");

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCep(value) {
  const d = onlyDigits(value);
  if (d.length !== 8) return null;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function isValidCep(value) {
  return onlyDigits(value).length === 8;
}

function extractLabelValue(text, label) {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`, "i");
  const m = String(text || "").match(re);
  return m ? m[1].trim() : "";
}

function cleanDescription(raw) {
  let text = String(raw || "");

  // Remove blocos CSS/estilo que vieram junto da descrição.
  text = text
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/(?:^|\s)[.#][\w-]+(?:\s+[.#][\w-]+)?\s*\{[^{}]*\}/g, " ")
    .replace(/\b[a-z-]+\s*:\s*[^;{}]+;/gi, " ");

  // Remove linhas de interface/formulário que não pertencem ao anúncio.
  const noiseTerms = [
    "proposta / informações",
    "proposta/informações",
    "newsletter",
    "repita o código",
    "para enviar",
    "enviar",
    "nome",
    "e-mail",
    "telefone",
    "central de negócios",
    "imprimir página",
    "indicar imóvel",
    "fale com paty",
    "mapa de localização",
    "clique para navegar no mapa"
  ];

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => {
      const n = normalizeKey(line);
      if (!n) return false;
      return !noiseTerms.some((term) => n.includes(term));
    });

  text = lines.join("\n");

  // Organiza os blocos principais em parágrafos.
  const headings = [
    "Endereco do Empreendimento:",
    "Visão Geral:",
    "Diferenciais:",
    "Lazer:",
    "Localização e Mobilidade:",
    "Condições e Financiamento:",
    "Resumo Técnico:",
    "Atendimento:"
  ];
  for (const h of headings) {
    const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\s*${escaped}\\s*`, "gi"), `\n\n${h}\n`);
  }

  // Quebra listas em linhas.
  text = text
    .replace(/\n\s*-\s+/g, "\n- ")
    .replace(/\n-\s+([a-zà-ÿ])/g, " $1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await query(
    "select id, code, location, cep, description from properties where code like 'LANC-%' order by code asc"
  );

  let updated = 0;
  let cepFixed = 0;
  let locationFixed = 0;

  for (const row of rows.rows) {
    const cleaned = cleanDescription(row.description);
    const cepFromText = formatCep(extractLabelValue(cleaned, "cep")) || formatCep(cleaned.match(/\b\d{5}-?\d{3}\b/)?.[0]);
    const bairroFromText = extractLabelValue(cleaned, "bairro");

    const nextCep = isValidCep(row.cep) ? row.cep : (cepFromText || row.cep);
    const nextLocation = (row.location && row.location.trim()) ? row.location : (bairroFromText || row.location);

    const changedDesc = cleaned !== String(row.description || "");
    const changedCep = (nextCep || "") !== (row.cep || "");
    const changedLocation = (nextLocation || "") !== (row.location || "");

    if (!changedDesc && !changedCep && !changedLocation) continue;

    if (!dryRun) {
      await query(
        "update properties set description=$1, cep=$2, location=$3, updated_at=now() where id=$4",
        [cleaned, nextCep || null, nextLocation || null, row.id]
      );
    }

    updated += 1;
    if (changedCep) cepFixed += 1;
    if (changedLocation) locationFixed += 1;
    console.log(`OK ${row.code} | cep:${changedCep ? "fix" : "-"} | bairro:${changedLocation ? "fix" : "-"}`);
  }

  console.log("\nResumo:");
  console.log(`- Total lancamentos: ${rows.rows.length}`);
  console.log(`- Atualizados: ${updated}`);
  console.log(`- CEP corrigido/preenchido: ${cepFixed}`);
  console.log(`- Bairro corrigido/preenchido: ${locationFixed}`);
  console.log(`- Modo: ${dryRun ? "DRY-RUN" : "REAL"}`);
}

run()
  .catch((err) => {
    console.error("Erro:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
