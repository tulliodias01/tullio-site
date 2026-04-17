const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

module.exports = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "change_me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  databaseUrl: process.env.DATABASE_URL,
  siteUrl: process.env.SITE_URL || "http://localhost:3000",
  siteName: process.env.SITE_NAME || "Tullio Dias Imóveis",
  defaultMetaImage: process.env.META_DEFAULT_IMAGE || "",
  ga4Id: process.env.GA4_ID || "",
  metaPixelId: process.env.META_PIXEL_ID || "",
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminName: process.env.ADMIN_NAME || "Administrador",
  adminPanelUser: process.env.ADMIN_PANEL_USER || "",
  adminPanelPassword: process.env.ADMIN_PANEL_PASSWORD || "",
  uploadsDir: path.join(process.cwd(), "uploads"),
  backupsDir: path.join(process.cwd(), "backups")
};
