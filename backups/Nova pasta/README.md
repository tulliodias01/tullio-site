# Plataforma Profissional de Imóveis (1 a 10)

Este projeto implementa os 10 itens que você pediu, com base pronta para produção.

## O que já está implementado

1. **Login de admin**  
Rota `POST /api/auth/login` com JWT e usuário administrador em tabela `admin_users`.

2. **Backend/API**  
Servidor Node/Express em `src/server.js` com rotas:
- `/api/properties` (CRUD admin)
- `/api/public/properties` (vitrine pública)
- `/api/leads` (captação de leads)
- `/api/events` (eventos analytics)
- `/api/admin/*` (operação/admin)

3. **Banco de dados**  
PostgreSQL com migração em `migrations/001_init.sql`.

4. **Upload de imagens**  
`multer` com upload local em `/uploads` e múltiplas imagens por imóvel.

5. **Página de detalhe do imóvel**  
Rota `GET /imoveis/:slug` renderizada no servidor com dados do imóvel.

6. **Lead tracking / CRM básico**  
Tabela `leads` + endpoint de captura.

7. **Analytics**  
Tabela `analytics_events` + endpoint `/api/events`; placeholders GA4/Meta via `.env`.

8. **SEO técnico**  
`sitemap.xml` em `/api/public/sitemap.xml`, `robots.txt`, Open Graph e JSON-LD no detalhe.

9. **Backup e versionamento**  
Backup JSON (`scripts/backup.js`, `/api/admin/backup/export`) + histórico de versões em `property_versions`.

10. **Deploy com domínio, SSL e monitoramento**  
`docker-compose.yml`, `Dockerfile`, Nginx com SSL (`deploy/nginx/default.conf`) e PM2 (`ecosystem.config.js`) + healthcheck (`/api/health`).

---

## Como rodar local

1. Copie variáveis:
```bash
cp .env.example .env
```

2. Suba banco + app:
```bash
docker compose up -d db
npm install
npm run migrate
npm run seed:admin
npm run dev
```

3. Acessos:
- Site: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`
- Health: `http://localhost:3000/api/health`

---

## Automação futura

- Import/export JSON já disponível no admin e via API de backup.
- Estrutura de dados normalizada (`code`, `slug`, imagens separadas, histórico).
- Fácil integração com CRM externo, WhatsApp API, pipelines de marketing e BI.
