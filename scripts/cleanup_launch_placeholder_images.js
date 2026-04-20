const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/db");

function isPlaceholder(url) {
  const text = String(url || "").toLowerCase();
  const base = text.split("/").pop() || "";
  if (base === "02.png" || base === "03.jpg") return true;
  if (text.includes("logo_site") || text.includes("placeholder")) return true;
  const ext = path.extname(base);
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return false;
  const localPath = path.resolve(process.cwd(), text.replace(/^\/+/, ""));
  if (!fs.existsSync(localPath)) return false;
  const size = fs.statSync(localPath).size;
  // Ícones/logo/template da origem costumam vir muito pequenos.
  if (size > 0 && size <= 22000) return true;
  return false;
}

async function run() {
  const props = await query(
    "select id, code, title from properties where code like 'LANC-%' order by code asc"
  );

  let updatedProps = 0;
  let deletedImages = 0;

  for (const p of props.rows) {
    const imgs = await query(
      "select id, image_url, sort_order from property_images where property_id = $1 order by sort_order asc, created_at asc",
      [p.id]
    );
    if (!imgs.rows.length) continue;

    const bad = imgs.rows.filter((img) => isPlaceholder(img.image_url));
    if (!bad.length) continue;

    const keep = imgs.rows.filter((img) => !isPlaceholder(img.image_url));
    if (!keep.length) continue;

    const badIds = bad.map((x) => x.id);
    await query("delete from property_images where id = any($1::uuid[])", [badIds]);
    deletedImages += badIds.length;

    for (let i = 0; i < keep.length; i += 1) {
      await query(
        "update property_images set sort_order = $1, is_cover = $2 where id = $3",
        [i, i === 0, keep[i].id]
      );
    }

    updatedProps += 1;
    // eslint-disable-next-line no-console
    console.log(`OK ${p.code} - removidas ${bad.length} imagem(ns) placeholder`);
  }

  // eslint-disable-next-line no-console
  console.log("\nResumo limpeza imagens:");
  // eslint-disable-next-line no-console
  console.log(`- Lançamentos analisados: ${props.rows.length}`);
  // eslint-disable-next-line no-console
  console.log(`- Imóveis ajustados: ${updatedProps}`);
  // eslint-disable-next-line no-console
  console.log(`- Imagens removidas: ${deletedImages}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro ao limpar placeholders de imagem:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
