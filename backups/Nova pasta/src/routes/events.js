const express = require("express");
const { z } = require("zod");
const { query } = require("../db");

const router = express.Router();

const eventSchema = z.object({
  event_name: z.string().min(2),
  page_url: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  payload: z.any().optional()
});

router.post("/", async (req, res) => {
  try {
    const data = eventSchema.parse(req.body);
    await query(
      "insert into analytics_events (event_name, page_url, referrer, payload, user_agent, ip_address) values ($1,$2,$3,$4::jsonb,$5,$6)",
      [
        data.event_name,
        data.page_url || null,
        data.referrer || null,
        JSON.stringify(data.payload || {}),
        req.headers["user-agent"] || null,
        req.ip || null
      ]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Evento inválido.", issues: err.issues });
    return res.status(500).json({ ok: false, message: "Erro ao registrar evento." });
  }
});

module.exports = router;
