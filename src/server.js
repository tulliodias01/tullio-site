const express = require("express");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const { healthcheck, query } = require("./db");
const config = require("./config");
const { sanitizePublicDescription } = require("./utils/sanitizePublicDescription");

const authRoutes = require("./routes/auth");
const propertyRoutes = require("./routes/properties");
const publicRoutes = require("./routes/public");
const leadRoutes = require("./routes/leads");
const eventRoutes = require("./routes/events");
const adminRoutes = require("./routes/admin");

const app = express();

if (!fs.existsSync(config.uploadsDir)) fs.mkdirSync(config.uploadsDir, { recursive: true });
if (!fs.existsSync(config.backupsDir)) fs.mkdirSync(config.backupsDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

function requireAdminPanelAuth(req, res, next) {
  const user = String(config.adminPanelUser || "").trim();
  const pass = String(config.adminPanelPassword || "").trim();

  if (!user || !pass) {
    return res.status(503).send("Admin indisponÃ­vel: configure ADMIN_PANEL_USER e ADMIN_PANEL_PASSWORD.");
  }

  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Tullio Dias"');
    return res.status(401).send("AutenticaÃ§Ã£o obrigatÃ³ria.");
  }

  const raw = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const [inputUser = "", inputPass = ""] = raw.split(":");
  if (inputUser !== user || inputPass !== pass) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Tullio Dias"');
    return res.status(401).send("Credenciais invÃ¡lidas.");
  }

  return next();
}

app.use("/uploads", express.static(config.uploadsDir));
app.get("/public/admin.html", (_req, res) => res.status(404).send("Not found"));
app.use("/public", express.static(path.join(process.cwd(), "public")));
app.get("/robots.txt", (_req, res) => res.sendFile(path.join(process.cwd(), "public", "robots.txt")));

app.get("/api/health", async (_req, res) => {
  try {
    const db = await healthcheck();
    return res.json({ ok: true, status: "up", db_time: db.now });
  } catch (err) {
    return res.status(500).json({ ok: false, status: "down", message: "Falha no banco." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/admin", adminRoutes);

function analyticsSnippet() {
  const snippets = [];
  if (config.ga4Id) {
    snippets.push(`
<script async src="https://www.googletagmanager.com/gtag/js?id=${config.ga4Id}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${config.ga4Id}');
</script>`);
  }
  if (config.metaPixelId) {
    snippets.push(`
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${config.metaPixelId}');
fbq('track', 'PageView');
</script>`);
  }
  return snippets.join("\n");
}

function renderPropertyPage(property, images) {
  const safeDescription = sanitizePublicDescription(property.description);
  const cover = images.find((img) => img.is_cover)?.image_url || images[0]?.image_url || config.defaultMetaImage || "";
  const pageUrl = `${config.siteUrl}/imoveis/${property.slug}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: property.title,
    description: safeDescription,
    image: images.map((i) => `${config.siteUrl}${i.image_url}`),
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: String(property.price),
      availability: "https://schema.org/InStock",
      url: pageUrl
    }
  };

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${property.title} | ${config.siteName}</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${property.title}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${cover ? `${config.siteUrl}${cover}` : ""}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  ${analyticsSnippet()}
  <style>
    body{font-family:Arial,sans-serif;margin:0;background:#f8f8f8;color:#1f2f3e}
    .wrap{max-width:980px;margin:24px auto;padding:0 16px}
    .card{background:#fff;border-radius:12px;box-shadow:0 10px 20px rgba(0,0,0,.08);overflow:hidden}
    .hero{height:420px;background-size:cover;background-position:center}
    .content{padding:20px}
    .price{font-size:32px;color:#1e3a5f;font-weight:700}
    .btn{display:inline-block;padding:12px 18px;background:#25d366;color:#083b20;border-radius:10px;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero" style="background-image:url('${cover}');"></div>
      <div class="content">
        <h1>${property.title}</h1>
        <p>${property.location} ${property.cep ? `â€¢ CEP ${property.cep}` : ""}</p>
        <p>${safeDescription}</p>
        <p class="price">${Number(property.price).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:0})}</p>
        <p>${property.bedrooms} quartos â€¢ ${property.bathrooms} banheiros â€¢ ${property.area}mÂ²</p>
        <a class="btn" target="_blank" href="https://wa.me/5571992697769?text=${encodeURIComponent(`OlÃ¡! Tenho interesse no imÃ³vel ${property.title} (${property.code}).`) }">Falar no WhatsApp</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

app.get("/admin", requireAdminPanelAuth, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "admin.html"));
});
app.get("/admin/agendamentos", requireAdminPanelAuth, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "agendamentos.html"));
});

app.get("/imoveis/:slug", async (req, res) => {
  const row = await query("select slug, code from properties where slug = $1 and is_published = true limit 1", [req.params.slug]);
  if (!row.rows.length) return res.status(404).send("Imovel nao encontrado.");

  const ref = String(row.rows[0].code || row.rows[0].slug || "").trim();
  if (!ref) return res.status(404).send("Imovel nao encontrado.");

  return res.redirect(302, `/?imovel=${encodeURIComponent(ref)}`);
});

app.get("/", (_req, res) => {
  return res.sendFile(path.join(process.cwd(), "tullio_dias_corretor.html"));
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor rodando em http://localhost:${config.port}`);
});


