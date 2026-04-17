const db = require("../src/db");

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.MAPS_API_KEY ||
  process.env.GMAPS_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  "AIzaSyBqlPOcPH8zOI2TiwZdwRs_KJUePHrtFEo";

function normalizeCepDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9"
    },
    cache: "no-store"
  });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function viaCepLookup(cepDigits) {
  const data = await fetchJson(`https://viacep.com.br/ws/${cepDigits}/json/`);
  if (!data || data.erro) return null;
  return {
    rua: String(data.logradouro || "").trim(),
    bairro: String(data.bairro || "").trim(),
    cidade: String(data.localidade || "").trim(),
    uf: String(data.uf || "").trim()
  };
}

async function geocodeNominatim(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
  const data = await fetchJson(url);
  const best = Array.isArray(data) ? data[0] : null;
  if (!best) return null;
  const lat = Number(best.lat);
  const lng = Number(best.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function geocodeGoogle(query) {
  const q = String(query || "").trim();
  if (!q || !GOOGLE_MAPS_API_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=br&language=pt-BR&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const data = await fetchJson(url);
  if (!data || data.status !== "OK" || !Array.isArray(data.results) || !data.results.length) return null;
  const best = data.results[0];
  const types = Array.isArray(best.types) ? best.types : [];
  const formattedAddress = String(best.formatted_address || "").trim().toLowerCase();
  const isCountryOnly = types.includes("country") && types.length <= 2;
  if (isCountryOnly || formattedAddress === "brasil") return null;
  const lat = Number(best.geometry?.location?.lat);
  const lng = Number(best.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function buildCandidates({ cepDigits, rua, bairro, cidade, uf, location }) {
  return [
    [rua, bairro, cidade, uf, "Brasil"].filter(Boolean).join(", "),
    [bairro, cidade, uf, cepDigits, "Brasil"].filter(Boolean).join(", "),
    [cepDigits, cidade, uf, "Brasil"].filter(Boolean).join(", "),
    [location, cidade, uf, "Brasil"].filter(Boolean).join(", "),
    [cepDigits, "Brasil"].filter(Boolean).join(", ")
  ].filter(Boolean);
}

async function resolveCoordsByCep(cepDigits, location = "") {
  const viaCep = await viaCepLookup(cepDigits);
  const base = {
    cepDigits,
    rua: viaCep?.rua || "",
    bairro: viaCep?.bairro || "",
    cidade: viaCep?.cidade || "",
    uf: viaCep?.uf || "",
    location: String(location || "").trim()
  };

  for (const query of buildCandidates(base)) {
    const coords = await geocodeNominatim(query) || await geocodeGoogle(query);
    if (coords) return { ...coords, source: query };
    await sleep(250);
  }
  return null;
}

async function main() {
  const force = process.argv.includes("--force");
  const where = force
    ? "where cep is not null and trim(cep) <> ''"
    : "where cep is not null and trim(cep) <> '' and (latitude is null or longitude is null)";

  const { rows } = await db.query(
    `select id, code, title, cep, location, latitude, longitude from properties ${where} order by created_at asc`
  );

  console.log(`[geocode] Imoveis na fila: ${rows.length} | force=${force}`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i];
    const cepDigits = normalizeCepDigits(item.cep);
    const prefix = `[${i + 1}/${rows.length}] ${item.code || item.id}`;

    if (cepDigits.length !== 8) {
      skipped += 1;
      console.log(`${prefix} CEP invalido: ${item.cep || "(vazio)"}`);
      continue;
    }

    try {
      const resolved = await resolveCoordsByCep(cepDigits, item.location);
      if (!resolved) {
        notFound += 1;
        console.log(`${prefix} sem coordenada para CEP ${cepDigits}`);
        continue;
      }

      await db.query(
        "update properties set latitude = $1, longitude = $2, updated_at = now() where id = $3",
        [resolved.lat, resolved.lng, item.id]
      );
      updated += 1;
      console.log(`${prefix} atualizado -> ${resolved.lat.toFixed(7)}, ${resolved.lng.toFixed(7)} | ${resolved.source}`);

      await sleep(900);
    } catch (error) {
      errors += 1;
      console.log(`${prefix} erro: ${error.message}`);
      await sleep(900);
    }
  }

  console.log("\nResumo:");
  console.log(`- atualizados: ${updated}`);
  console.log(`- sem coordenada: ${notFound}`);
  console.log(`- CEP invalido/pulado: ${skipped}`);
  console.log(`- erros: ${errors}`);

  process.exit(0);
}

main().catch((error) => {
  console.error("Falha geral:", error);
  process.exit(1);
});
