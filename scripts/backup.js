const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/db");
const config = require("../src/config");

async function run() {
  if (!fs.existsSync(config.backupsDir)) fs.mkdirSync(config.backupsDir, { recursive: true });
  const [properties, images, leads, events, propertyPrivate] = await Promise.all([
    query("select * from properties"),
    query("select * from property_images"),
    query("select * from leads"),
    query("select * from analytics_events"),
    query("select * from property_private")
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    properties: properties.rows,
    property_images: images.rows,
    property_private: propertyPrivate.rows,
    leads: leads.rows,
    analytics_events: events.rows
  };

  const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(config.backupsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Backup salvo em ${filePath}`);
  await pool.end();
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("Erro no backup:", err.message);
  await pool.end();
  process.exit(1);
});
