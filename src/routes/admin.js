const express = require("express");
const fs = require("fs");
const path = require("path");
const { requireAuth } = require("../middleware/auth");
const { query } = require("../db");
const config = require("../config");

const router = express.Router();
router.use(requireAuth);

router.get("/leads", async (_req, res) => {
  const result = await query("select * from leads order by created_at desc limit 300");
  return res.json({ ok: true, items: result.rows });
});

router.get("/analytics", async (_req, res) => {
  const result = await query("select * from analytics_events order by created_at desc limit 500");
  return res.json({ ok: true, items: result.rows });
});

router.get("/backup/export", async (_req, res) => {
  const [properties, images, leads] = await Promise.all([
    query("select * from properties order by created_at desc"),
    query("select * from property_images order by created_at desc"),
    query("select * from leads order by created_at desc")
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    properties: properties.rows,
    property_images: images.rows,
    leads: leads.rows
  };

  if (!fs.existsSync(config.backupsDir)) fs.mkdirSync(config.backupsDir, { recursive: true });
  const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(config.backupsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");

  await query("insert into backups (file_name, file_path, payload_summary) values ($1,$2,$3::jsonb)", [
    fileName,
    filePath,
    JSON.stringify({
      properties: payload.properties.length,
      images: payload.property_images.length,
      leads: payload.leads.length
    })
  ]);

  return res.json({ ok: true, file: fileName, path: filePath });
});

router.get("/backup/list", async (_req, res) => {
  const result = await query("select * from backups order by created_at desc limit 200");
  return res.json({ ok: true, items: result.rows });
});

module.exports = router;
