# AGENTS.md — Contexto do projeto (leia primeiro)

> **Para o assistente de IA no Cursor:** ao abrir este workspace, leia este arquivo antes de alterar código ou rodar comandos destrutivos. Resume o estado atual do **Nexo / Zapflow** nesta VPS de **desenvolvimento**.

## Ambiente

| | Esta VPS (dev) | Produção (cliente — NÃO confundir) |
|---|----------------|-------------------------------------|
| URL | `https://cristian.vps-kinghost.net` | `https://virginiaarruda.vps-kinghost.net` |
| Tenant | **Cristian Dev** | Virginia Arruda |
| Branding UI | Nexo Dev | Virginia Arruda |

## O que é

Plataforma de gestão WhatsApp: disparos em massa, Palavra do Dia, agendamentos, inbox, agente de IA no atendimento, integrações Woo/Bling (parcial).

- **Repo:** `saas_disparo` (nome npm: zapflow-saas)
- **Branding central:** `config/branding.ts` (frontend) e `server/utils/branding.js` (backend)
- **Tom do produto (dev):** pastoral genérico / WhatsApp — sem marca Virginia

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19 + Vite + Tailwind (`/components`, `/services`) |
| Backend | Node.js Express, porta **3001** (`/server`) |
| DB | SQLite (`server/db/database.js`) |
| WhatsApp | **whatsapp-web.js** (1 sessão, Puppeteer/Chrome) |
| IA | Gemini/OpenAI (`server/utils/aiService.js`) |
| Processo | systemd `zapflow.service` ou PM2 `zapflow-backend` |

## Regras operacionais críticas

1. **Apenas 1 WhatsApp conectado** — não há failover multi-número hoje.
2. **Evitar restart desnecessário** — desconecta WhatsApp; preferir reload só quando mudou código do backend.
3. **Frontend:** `npm run build` na raiz — seguro, não mata sessão.
4. **PM2 instances = 1** — nunca escalar instâncias (duplica agendamentos).
5. **Sessão WhatsApp:** `server/.wwebjs_auth/session` — backup em `backup/`.
6. **Não commitar** `.env`, sessão WhatsApp, nem secrets.

## Variáveis de ambiente

Ver `server/.env.example`. Mínimo:

- `GEMINI_API_KEY` e/ou `OPENAI_API_KEY`
- `AUTH_SECRET`, `ADMIN_USER`, `ADMIN_PASS`
- `NOTIFY_SYSTEM_NAME=Nexo Dev` (alertas Discord)
- `DISCORD_WEBHOOK_URL` (recomendado)

Branding opcional via env: `BRAND_PRODUCT_NAME`, `BRAND_TENANT_NAME`, `BRAND_STORE_URL`, etc.

## Comandos úteis

```bash
npm run install:all
npm run build
systemctl restart zapflow   # ou npm run pm2:start
curl -s http://localhost:3001/api/health
npm run check:ops
```

## Limitações conhecidas

- Flows / Follow Ups: UI pronta, **não executam**
- Webhooks Woo/Bling: logam evento, **não disparam WhatsApp**
- Multi-WhatsApp: **não implementado**

---

*Última atualização: julho/2026 — VPS dev Cristian (KingHost)*
