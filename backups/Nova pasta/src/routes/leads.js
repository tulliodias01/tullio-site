const express = require("express");
const { z } = require("zod");
const { query } = require("../db");

const router = express.Router();

const leadSchema = z.object({
  property_id: z.string().uuid().optional().nullable(),
  property_slug: z.string().optional().nullable(),
  name: z.string().min(2),
  phone: z.string().min(8),
  email: z.string().email().optional().nullable(),
  message: z.string().min(3),
  source: z.string().optional().default("website"),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable()
});

router.post("/", async (req, res) => {
  try {
    const data = leadSchema.parse(req.body);
    await query(
      `insert into leads
      (property_id, property_slug, name, phone, email, message, source, utm_source, utm_medium, utm_campaign)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        data.property_id || null,
        data.property_slug || null,
        data.name,
        data.phone,
        data.email || null,
        data.message,
        data.source,
        data.utm_source || null,
        data.utm_medium || null,
        data.utm_campaign || null
      ]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ ok: false, message: "Dados inválidos.", issues: err.issues });
    return res.status(500).json({ ok: false, message: "Erro ao registrar lead." });
  }
});

module.exports = router;
