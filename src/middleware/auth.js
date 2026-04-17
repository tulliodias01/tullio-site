const jwt = require("jsonwebtoken");
const config = require("../config");

function readCookieToken(req) {
  const cookieHeader = req.headers.cookie || "";
  if (!cookieHeader) return "";
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.trim().split("=");
    if (rawKey === "admin_token") {
      return decodeURIComponent(rest.join("=") || "");
    }
  }
  return "";
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const cookieToken = readCookieToken(req);
  const token = bearerToken || cookieToken;

  if (!token) return res.status(401).json({ ok: false, message: "Token ausente." });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Token inválido." });
  }
}

function requireRole(...allowedRoles) {
  const normalized = allowedRoles.map((role) => String(role || "").toLowerCase()).filter(Boolean);
  return (req, res, next) => {
    const role = String(req.user?.role || "").toLowerCase();
    if (!role || !normalized.includes(role)) {
      return res.status(403).json({ ok: false, message: "Acesso negado." });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
