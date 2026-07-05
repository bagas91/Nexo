# BRIEFING — Nexo Dev / ZapFlow SaaS (VPS Cristian)

> **Esta cópia do código roda em DEV:** `https://cristian.vps-kinghost.net` — branding **Cristian Dev / Nexo**, sem referências Virginia na UI.
>
> **Produção do cliente (referência histórica):** `https://virginiaarruda.vps-kinghost.net` — não confundir.
>
> **Dev:** VPS separada onde novas features serão construídas, testadas e depois promovidas para produção.

---

## 1. ESTRATÉGIA DUAL-VPS (PROD vs DEV)

| Ambiente | Função | Regra |
|----------|--------|-------|
| **Produção** (KingHost) | Cliente Virginia Arruda em uso real | Só recebe updates testados e estáveis |
| **Desenvolvimento** (outra VPS) | Laboratório, multi-tenant, bot, billing | Onde 90% do código novo nasce |

**Fluxo de deploy recomendado:**

```
Dev VPS → testes → git tag/release → pull na Prod → npm run build → pm2:restart
```

**Nunca desenvolver direto em produção** exceto hotfix crítico.

---

## 2. O QUE JÁ FOI FEITO NA VPS DE PRODUÇÃO

### Infraestrutura

- [x] Node.js 20 + PM2 (`zapflow-backend`, 1 instância)
- [x] Chrome/Puppeteer instalado para `whatsapp-web.js`
- [x] Build frontend (`dist/`) servido pelo backend na porta 3001
- [x] Nginx reverse proxy na porta 80
- [x] HTTPS Let's Encrypt em `virginiaarruda.vps-kinghost.net`
- [x] Redirect HTTP → HTTPS automático
- [x] PM2 + Nginx com auto-start no boot

### Correções críticas

- [x] **Bug grupos não carregavam:** removida verificação obsoleta `window.Store.Chat` em `server/services/whatsappClient.js` — a lib `whatsapp-web.js` 1.34.7 usa `WWebJS.getChats()` / `WAWebCollections`
- [x] Atualizado `whatsapp-web.js` para 1.34.7
- [x] Permissões corrigidas em binários do `node_modules` após cópia do projeto

### Branding (uso único Virginia Arruda)

- [x] Nome alterado de "VAGROUP/ZapFlow" para **"Virginia Arruda"**
- [x] Arquivos: `index.html`, `metadata.json`, `Login.tsx`, `Sidebar.tsx`

### Logout manual vs desconexão automática

- [x] Botão **Desconectar** agora limpa **tudo** para próximo login:
  - grupos/canais (cache SQLite)
  - agendamentos + anexos (`uploads/schedule_*`)
  - histórico de envios
  - categorias
  - log de disparos
  - sessão WhatsApp (novo QR obrigatório)
- [x] Desconexão **automática** (falha/erro): **mantém backup** da sessão e tenta reconectar — comportamento preservado no evento `disconnected`

### Arquivos alterados em produção (referência para portar no dev)

```
server/services/whatsappClient.js   → fix getChats + logout manual
server/db/database.js             → clearAllOperationalData()
server/server.js                  → /api/disconnect com limpeza total
index.html, metadata.json
components/Login.tsx, Sidebar.tsx
App.tsx                           → limpa schedules no disconnect
/etc/nginx/sites-available/zapflow
```

---

## 3. INVENTÁRIO DO SISTEMA ATUAL (BASE)

### Stack

- **Frontend:** React 19 + TypeScript + Vite + TailwindCSS
- **Backend:** Node.js + Express + SQLite (`better-sqlite3`)
- **WhatsApp:** `whatsapp-web.js` + LocalAuth + Puppeteer headless
- **Process manager:** PM2
- **IA (parcial):** Google Gemini — só gera rascunho de mensagem (`services/geminiService.ts`)
- **Evolution API (opcional/não ativo em prod):** `server/services/evolutionService.js` — adapter preparado mas não usado

### Funcionalidades já existentes

| Módulo | Status |
|--------|--------|
| Conexão QR + sessão persistente | ✅ |
| Backup/restauração sessão WhatsApp | ✅ |
| Listagem grupos/canais + paginação | ✅ |
| Envio em massa com fila + intervalo | ✅ |
| Agendamentos (worker 60s, SQLite) | ✅ |
| Categorias de grupos | ✅ |
| Histórico de envios + export CSV | ✅ |
| Log de disparos (auditoria) | ✅ |
| Alertas Discord webhook | ✅ |
| Healthcheck + restart preventivo diário | ✅ |
| Login mock (usuários estáticos em env) | ✅ fraco |
| Multi-cliente / billing | ❌ |
| Bot / auto-resposta | ❌ |
| CRM / inbox de conversas | ❌ |
| API pública documentada | ⚠️ parcial |
| Painel super-admin | ❌ |

### Banco SQLite atual (single-tenant)

Tabelas: `chats`, `history`, `categories`, `dispatches`, `schedules`

**Problema para SaaS:** tudo é global, sem `tenant_id` / `user_id`.

### API principal

Ver `API.md` — rotas `/api/status`, `/api/chats`, `/api/send-bulk`, `/api/schedules`, `/api/disconnect`, etc.

---

## 4. VISÃO DO PRODUTO FINAL ("SISTEMA GRANDIOSO")

### Nome comercial sugerido

**Virginia Arruda Platform** (white-label por cliente) ou marca própria tipo **ZapFlow Pro**

### Pilares do produto

1. **Disparos** — grupos, agendamentos, categorias, relatórios (já existe)
2. **Robô / Atendimento** — respostas automáticas, fluxos, IA, horário comercial
3. **CRM leve** — inbox, tags, notas, histórico por contato
4. **SaaS multi-tenant** — 1 instância, N clientes pagantes
5. **Painel admin** — planos, faturamento, limites, suporte

### Modelo de negócio (venda mensal)

| Plano | Preço sugerido | Limites |
|-------|----------------|---------|
| **Starter** | R$ 97/mês | 1 WhatsApp, 500 msgs/mês, sem bot |
| **Pro** | R$ 197/mês | 1 WhatsApp, 3.000 msgs, bot básico |
| **Business** | R$ 397/mês | 2 WhatsApp, 10.000 msgs, bot + IA |
| **Enterprise** | sob consulta | instância dedicada, SLA |

---

## 5. ROADMAP DE DESENVOLVIMENTO (FASES)

### FASE 0 — Sincronizar DEV com PROD (1–2 dias)

**Objetivo:** dev igual à produção antes de novas features.

**Tarefas:**

1. Clonar/copiar código da prod para dev
2. Aplicar patches listados na seção 2
3. `npm run install:all` → `npm run build` → `pm2:start`
4. Validar: QR, grupos, disparo, agendamento, disconnect limpa tudo
5. Criar repositório Git com branches `main` (prod) e `develop` (dev)

**Critério de aceite:** dev reproduz 100% do comportamento atual de prod.

---

### FASE 1 — Fundação SaaS Multi-Tenant (2–3 semanas)

**Objetivo:** vários clientes no mesmo sistema, isolados.

#### 1.1 Banco de dados

Migrar SQLite → **PostgreSQL** (recomendado para SaaS) ou SQLite com `tenant_id` em todas as tabelas.

Novas tabelas:

```sql
tenants (id, name, slug, plan, status, created_at)
users (id, tenant_id, email, password_hash, role)
whatsapp_sessions (id, tenant_id, status, phone, session_path)
subscriptions (id, tenant_id, plan, status, expires_at)
usage_metrics (tenant_id, month, messages_sent, api_calls)
```

Adicionar `tenant_id` em: chats, schedules, history, categories, dispatches.

#### 1.2 Autenticação real

- Substituir login mock por JWT + bcrypt
- Roles: `super_admin`, `tenant_admin`, `operator`
- Middleware: todo request carrega `req.tenantId` do token
- Rotas públicas isoladas por tenant: `/{slug}/login` ou subdomínio `cliente.plataforma.com`

#### 1.3 Isolamento WhatsApp

**Decisão arquitetural crítica** — escolher 1:

| Opção | Prós | Contras |
|-------|------|---------|
| **A) 1 Chrome por tenant** | Simples, código atual | RAM alta (~300MB/cliente) |
| **B) Evolution API** | Escala melhor, já tem adapter | Infra extra (Docker) |
| **C) Filas + workers** | Escala horizontal | Complexo |

**Recomendação MVP:** Opção A até ~20 clientes, depois migrar para B.

Estrutura:

```
server/sessions/tenant_{id}/.wwebjs_auth/
server/workers/whatsappWorker.js  → 1 processo PM2 por tenant OU pool
```

#### 1.4 Painel Super-Admin

- CRUD de tenants
- Ativar/suspender cliente
- Ver consumo (msgs enviadas)
- Impersonate (entrar como cliente para suporte)

**Critério de aceite:** 2 tenants logados simultaneamente sem ver dados um do outro.

---

### FASE 2 — Billing e Planos (1–2 semanas)

**Objetivo:** cobrança mensal automática.

**Integrações sugeridas (Brasil):**

- **Stripe** (cartão internacional)
- **Asaas** ou **Mercado Pago** (PIX/boleto BR)

**Fluxo:**

1. Cadastro → escolhe plano → checkout
2. Webhook confirma pagamento → `tenant.status = active`
3. Não pagou → `suspended` → bloqueia envios (mantém dados 30 dias)
4. Dashboard cliente: plano atual, renovação, upgrade

**Limites por plano (middleware):**

```javascript
if (tenant.messagesThisMonth >= plan.limit) throw new Error('Limite atingido');
```

**Critério de aceite:** cliente novo paga → recebe acesso → no mês seguinte sem pagar é bloqueado.

---

### FASE 3 — Módulo ROBÔ / Auto-Resposta (3–4 semanas)

**Objetivo:** sistema responde WhatsApp automaticamente.

#### 3.1 Listener de mensagens (não existe hoje)

Em `whatsappClient.js`, adicionar:

```javascript
client.on('message', async (msg) => {
  if (msg.fromMe) return;
  await botEngine.handleIncoming(tenantId, msg);
});
```

#### 3.2 Motor de regras (`server/services/botEngine.js`)

Tipos de automação:

| Tipo | Exemplo |
|------|---------|
| **Palavra-chave** | "preço" → envia tabela |
| **Fora do horário** | 22h–8h → "Retornamos amanhã" |
| **Boas-vindas** | primeiro contato → mensagem padrão |
| **Fluxo (menu)** | "1 - Vendas, 2 - Suporte" |
| **IA (Gemini)** | pergunta livre → resposta contextual |
| **Handoff humano** | após 3 msgs → notifica operador |

#### 3.3 Novas tabelas

```sql
bot_rules (id, tenant_id, trigger_type, trigger_value, response, active)
bot_conversations (id, tenant_id, contact_id, state, last_message_at)
bot_flows (id, tenant_id, name, steps_json)
contacts (id, tenant_id, phone, name, tags)
```

#### 3.4 UI nova

- **Inbox** — conversas em tempo real
- **Editor de fluxos** — arrastar blocos (fase avançada)
- **Config do robô** — on/off, horário, mensagens padrão
- **Treinamento IA** — FAQ da empresa (RAG simples)

#### 3.5 Integração com disparos

- Bot e disparos compartilham mesma sessão WhatsApp
- Fila unificada: prioridade bot < agendamento < manual
- Rate limit anti-ban: máx X msgs/minuto por tenant

**Critério de aceite:** mensagem recebida → robô responde em < 5s conforme regra configurada.

---

### FASE 4 — CRM + Relatórios Avançados (2–3 semanas)

- Tags em contatos
- Notas internas por conversa
- Funil: lead → cliente → inativo
- Relatórios: taxa resposta, horários pico, msgs por operador
- Export PDF para cliente final

---

### FASE 5 — Escala e White-Label (contínuo)

- Subdomínio por cliente: `empresaX.suaplataforma.com`
- Logo/cores por tenant
- API pública com API keys por tenant
- Webhooks outbound (cliente integra com sistema dele)
- App mobile (PWA primeiro)
- Kubernetes / Docker quando passar de 50 tenants

---

## 6. ARQUITETURA ALVO

```
                    ┌─────────────────┐
                    │   Nginx + SSL   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────┐  ┌──────▼──────┐  ┌───▼────────┐
     │  Frontend   │  │  API Gateway │  │ Super-Admin│
     │  React SPA  │  │  Express     │  │   Panel    │
     └─────────────┘  └──────┬───────┘  └────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
  ┌──────▼──────┐   ┌────────▼────────┐  ┌──────▼──────┐
  │ Auth/JWT    │   │  Tenant Service │  │  Billing    │
  │ + RBAC      │   │  (isolamento)   │  │  Stripe/MP  │
  └─────────────┘   └────────┬────────┘  └─────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
┌───▼────┐  ┌────────▼────────┐  ┌─────────▼─────────┐
│Disparos│  │   Bot Engine    │  │  Schedule Worker  │
│ Queue  │  │  (auto-reply)   │  │  (cron 60s)       │
└───┬────┘  └────────┬────────┘  └─────────┬─────────┘
    │                │                      │
    └────────────────┼──────────────────────┘
                     │
          ┌──────────▼──────────┐
          │  WhatsApp Manager   │
          │  (1 sessão/tenant)  │
          │  whatsapp-web.js    │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │  PostgreSQL / Redis │
          │  (dados + filas)    │
          └─────────────────────┘
```

---

## 7. PRIORIDADES (ORDEM DE EXECUÇÃO)

```
1. [URGENTE]  Sincronizar dev com patches de produção (seção 2)
2. [ALTA]     Git + branches main/develop
3. [ALTA]     tenant_id em todas as tabelas + auth JWT
4. [ALTA]     Isolamento WhatsApp por tenant
5. [MÉDIA]    Painel super-admin
6. [MÉDIA]    Billing (Asaas ou Stripe)
7. [MÉDIA]    Bot: listener message + regras palavra-chave
8. [MÉDIA]    Bot: horário comercial + boas-vindas
9. [BAIXA]    Bot: fluxos visuais + IA avançada
10. [BAIXA]   White-label + subdomínios
```

---

## 8. COMANDOS ÚTEIS

```bash
# Instalar tudo
npm run install:all

# Dev (2 terminais)
npm run server:dev    # backend :3001
npm run dev           # frontend :3000

# Produção
npm run build
npm run pm2:start
npm run pm2:restart

# Logs
pm2 logs zapflow-backend
npm run logs:live

# Health
curl https://SEU_DOMINIO/api/health
```

---

## 9. PROMPT PARA O OUTRO CHAT DO CURSOR

```
Estou desenvolvendo o Virginia Arruda Platform (fork do ZapFlow SaaS).

CONTEXTO:
- Produção estável em https://virginiaarruda.vps-kinghost.net (single-tenant, Virginia Arruda)
- Esta VPS é DEV/STAGING para evoluir o sistema
- Stack: React 19 + Vite + Express + whatsapp-web.js + SQLite + PM2
- Leia o arquivo ROADMAP-SAAS.md na raiz do projeto

JÁ FEITO EM PROD (portar para cá primeiro):
1. Fix getChats: remover check window.Store.Chat obsoleto em whatsappClient.js
2. Logout manual (/api/disconnect): limpar chats, schedules, history, categories, dispatches, uploads e sessão WWebJS
3. Desconexão automática: manter backup e reconectar
4. Branding "Virginia Arruda"

PRÓXIMO OBJETIVO (FASE 1):
Implementar multi-tenant com tenant_id, auth JWT real, isolamento de sessão WhatsApp por cliente, e painel super-admin.

DEPOIS (FASE 3):
Módulo robô: client.on('message') + botEngine com regras (palavra-chave, horário, boas-vindas, IA Gemini).

Siga o roadmap completo no ROADMAP-SAAS.md. Comece pela FASE 0 (sincronizar com prod) e depois FASE 1.
Priorize código limpo, mínimo diff, reutilizar padrões existentes do projeto.
```

---

## 10. RISCOS E CUIDADOS

| Risco | Mitigação |
|-------|-----------|
| Ban WhatsApp por spam | Rate limit, intervalo entre msgs, warm-up de número |
| RAM estoura com N tenants | Limitar clientes por VPS ou migrar Evolution API |
| Sessão cai após dias | Backup automático (já existe) + healthcheck |
| LGPD | Política de privacidade, consentimento, retenção de dados |
| Cobrança sem entregar | Trial 7 dias, onboarding guiado |

---

*Última atualização: junho/2026 — VPS produção Virginia Arruda (KingHost)*
