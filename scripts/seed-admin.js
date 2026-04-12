const { query, pool } = require("../src/db");
const config = require("../src/config");
const { hashPassword } = require("../src/utils/password");

async function run() {
  if (!config.adminEmail || !config.adminPassword) {
    throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente antes de criar o admin.");
  }

  const exists = await query("select id from admin_users where email = $1 limit 1", [config.adminEmail.toLowerCase()]);
  if (exists.rows.length) {
    // eslint-disable-next-line no-console
    console.log("Admin já existe.");
    await pool.end();
    return;
  }

  const hash = await hashPassword(config.adminPassword);
  await query(
    "insert into admin_users (name, email, password_hash, role, is_active) values ($1,$2,$3,'owner',true)",
    [config.adminName, config.adminEmail.toLowerCase(), hash]
  );
  // eslint-disable-next-line no-console
  console.log("Admin criado com sucesso.");
  await pool.end();
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("Erro ao criar admin:", err.message);
  await pool.end();
  process.exit(1);
});
