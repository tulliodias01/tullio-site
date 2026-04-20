const { query, pool } = require("../src/db");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function repairMojibake(value) {
  const text = String(value || "");
  if (!/[ÃÂ]/.test(text) && !/CORSáRIO/.test(text)) return text;
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
  return text
    .replace(/Ã.|Â./g, (chunk) => map[chunk] || chunk)
    .replace(/Â(?![A-Za-zÀ-ÿ0-9])/g, "")
    .replace(/CORSáRIO/g, "CORSÁRIO");
}

function isNoiseLine(line) {
  const t = normalizeText(line);
  if (!t) return true;
  const noise = [
    "visao geral:",
    "descricao do imovel",
    "mapa de localizacao",
    "central de negocios",
    "proposta",
    "informacoes",
    "newsletter",
    "enviar",
    "imobssa.com.br",
    "codigo ao lado",
    "repita",
    "telefone",
    "e-mail",
    "email",
    "nome",
    "fale com",
    "creci",
    "contato@",
    "rua luis eduardo magalhaes"
  ];
  return noise.some((n) => t.includes(n));
}

function toBullets(lines, max = 8) {
  const clean = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = String(raw || "").replace(/^[-•*]\s*/, "").trim();
    if (!line) continue;
    const key = normalizeText(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push(`- ${line}`);
    if (clean.length >= max) break;
  }
  return clean;
}

function splitLines(raw) {
  return repairMojibake(String(raw || ""))
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildProfessionalDescription(item) {
  const raw = String(item.description || "");
  const lines = splitLines(raw).filter((line) => !isNoiseLine(line));
  const sections = {
    geral: [],
    diferenciais: [],
    lazer: [],
    localizacao: [],
    condicoes: [],
    resumo: []
  };

  let current = "geral";
  for (const line of lines) {
    const t = normalizeText(line);
    if (t.includes("resumo tecnico")) {
      current = "resumo";
      continue;
    }
    if (
      t.includes("diferenciais") ||
      t.includes("acabamentos confirmados") ||
      t.includes("o que esse imovel tem de melhor")
    ) {
      current = "diferenciais";
      continue;
    }
    if (t.includes("itens de lazer") || t === "lazer" || t.includes("o que esse produto tem de melhor")) {
      current = "lazer";
      continue;
    }
    if (t.includes("veja a localizacao") || t.includes("o que esta perto") || t.includes("vias de acesso")) {
      current = "localizacao";
      continue;
    }
    if (
      t.includes("minha casa minha vida") ||
      t.includes("fgts") ||
      t.includes("financiamento") ||
      t.includes("caixa economica")
    ) {
      current = "condicoes";
    }
    sections[current].push(line);
  }

  const title = item.title || "Lançamento";
  const local = item.location || "Salvador";
  const price = Number(item.price || 0);
  const priceText = price > 0 ? price.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }) : "Consulte";

  const out = [];
  out.push("Visão Geral:");
  const geralText = sections.geral.join(" ").replace(/\s+/g, " ").trim();
  out.push(geralText || `${title} em ${local}.`);
  out.push("");

  if (sections.diferenciais.length) {
    out.push("Diferenciais:");
    out.push(...toBullets(sections.diferenciais, 10));
    out.push("");
  }

  if (sections.lazer.length) {
    out.push("Lazer:");
    out.push(...toBullets(sections.lazer, 12));
    out.push("");
  }

  if (sections.localizacao.length) {
    out.push("Localização e Mobilidade:");
    out.push(...toBullets(sections.localizacao, 10));
    out.push("");
  }

  if (sections.condicoes.length) {
    out.push("Condições e Financiamento:");
    out.push(...toBullets(sections.condicoes, 8));
    out.push("");
  }

  out.push("Resumo Técnico:");
  out.push(`- Tipo: Lançamento`);
  out.push(`- Bairro: ${local}`);
  out.push(`- Preço: ${priceText}`);
  out.push("");
  out.push("Atendimento:");
  out.push("- Fale no WhatsApp para tabela atualizada, disponibilidade e simulação.");

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function run() {
  const rows = await query(
    "select id, code, title, location, price, description from properties where code like 'LANC-%' order by code asc"
  );
  let updated = 0;
  for (const item of rows.rows) {
    const next = buildProfessionalDescription(item);
    await query("update properties set description = $1, updated_at = now() where id = $2", [next, item.id]);
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log("NORMALIZADOS=", updated);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro ao normalizar descrições:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
