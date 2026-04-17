const jwt = require("jsonwebtoken");
const config = require("../config");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) return res.status(401).json({ ok: false, message: "Token ausente." });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Token inválido." });
  }
}

module.exports = { requireAuth };
