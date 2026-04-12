const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/db");

async function run() {
  const migrationsDir = path.join(process.cwd(), "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await query(sql);
    // eslint-disable-next-line no-console
    console.log(`Migração aplicada: ${file}`);
  }

  await pool.end();
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("Erro na migração:", err.message);
  await pool.end();
  process.exit(1);
});
