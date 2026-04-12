const { Pool } = require("pg");
const config = require("./config");

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL não configurada.");
}

const pool = new Pool({
  connectionString: config.databaseUrl
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function healthcheck() {
  const result = await query("select now() as now");
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  healthcheck
};
