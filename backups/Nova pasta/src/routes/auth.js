const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { query } = require("../db");
const { verifyPassword } = require("../utils/password");
const config = require("../config");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const userResult = await query(
      "select id, name, email, password_hash, role from admin_users where email = $1 and is_active = true limit 1",
      [email.toLowerCase()]
    );

    if (!userResult.rows.length) {
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    }

    const user = userResult.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ ok: false, message: "Dados inválidos.", issues: err.issues });
    }
    return res.status(500).json({ ok: false, message: "Erro no login." });
  }
});

module.exports = router;
