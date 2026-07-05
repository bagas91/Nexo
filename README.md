<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ZapFlow SaaS - WhatsApp Management

Sistema completo de gerenciamento de WhatsApp com interface moderna e backend real usando `whatsapp-web.js`.

## 🚀 Estrutura do Projeto

- **Frontend**: React + TypeScript + Vite (porta 3000)
- **Backend**: Node.js + Express + whatsapp-web.js (porta 3001)

## 📋 Pré-requisitos

- Node.js 18+
- Google Chrome ou Chromium instalado
- NPM ou Yarn

## 🔧 Instalação

1. **Instalar dependências do frontend e backend:**
   ```bash
   npm run install:all
   ```

   Ou manualmente:
   ```bash
   npm install
   cd server && npm install
   ```

2. **Configurar variáveis de ambiente (opcional):**
   - Frontend: edite `.env.local` para `GEMINI_API_KEY` (se usar IA).
   - Backend: crie `server/.env` para alertas (veja seção Alertas abaixo).

## 🎯 Como Usar

### ⭐ Modo simples (recomendado) — uma coisa só rodando

O backend sobe com **PM2** e já serve a interface. Você só acessa **http://localhost:3001**.

| Quando | O que rodar |
|--------|-------------|
| **Primeira vez** (ou depois de `git pull`) | `npm run install:all` → `npm run build` → `npm run pm2:start` |
| **Todo dia** (servidor já está no ar) | Só abrir **http://localhost:3001** |
| **Reiniciou o PC** / PM2 parou | `npm run pm2:start` |
| **Mudou código** (você ou alguém alterou o projeto) | `npm run build` → `npm run pm2:restart` |

**Resumo dos comandos que você pode precisar:**

| Comando | O que faz |
|---------|-----------|
| `npm run pm2:start` | Liga o sistema (backend + interface). Depois acesse http://localhost:3001 |
| `npm run pm2:restart` | Reinicia o sistema (use depois de mudar código e rodar `build`) |
| `npm run pm2:stop` | Desliga o sistema |
| `npm run build` | Gera a versão nova do frontend (rode antes de `pm2:restart` quando mudar código) |
| `npm run install:all` | Instala dependências (só quando clonar o projeto ou adicionar pacotes) |
| `npm run logs:live` | Mostra os logs do backend em tempo real (para debug) |
| `npm run fix:browser-lock` | Se der erro "browser is already running": para o backend, roda isso, depois `pm2:start` de novo |

---

### Desenvolvimento (dois terminais: frontend + backend)

1. **Terminal 1 – backend:**
   ```bash
   npm run server:dev
   ```

2. **Terminal 2 – frontend:**
   ```bash
   npm run dev
   ```

3. **Acessar:** http://localhost:3000 (frontend) e API em http://localhost:3001/api

### Produção (sem PM2: um processo só)

1. **Build do frontend:** `npm run build`
2. **Iniciar servidor:** `npm run server`
3. **Acessar:** http://localhost:3001

## 📱 Funcionalidades

- ✅ Conexão com WhatsApp via QR Code
- ✅ Listagem de grupos e canais
- ✅ Envio de mensagens agendadas
- ✅ Dashboard com estatísticas
- ✅ Interface moderna e responsiva
- ✅ Sincronização otimizada (pronto aos 10%)

## 🔌 API Endpoints

- `GET /api/status` - Status da conexão
- `GET /api/health` - Saúde do sistema (ok, whatsapp, schedulesPending); útil para Uptime Robot etc.
- `GET /api/qr` - QR Code para conexão
- `GET /api/chats` - Lista de grupos/canais
- `POST /api/send` - Enviar mensagem (um grupo)
- `POST /api/send-bulk` - Enviar para vários grupos em fila (um por vez, com intervalo; retry em falhas tipo "detached Frame")
- `GET /api/schedules` - Listar agendamentos (persistentes no backend)
- `POST /api/schedules` - Criar agendamento (executado pelo worker a cada 1 min)
- `DELETE /api/schedules/:id` - Cancelar agendamento pendente
- `POST /api/disconnect` - Desconectar
- `POST /api/reconnect` - Reconectar
- `POST /api/clear-session` - Limpar sessão
- `POST /api/login` - Login (mock)

## 🛠️ Tecnologias

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS
- **Backend**: Node.js, Express, whatsapp-web.js
- **Autenticação**: LocalAuth (whatsapp-web.js)

## 📝 Notas

- O sistema usa `syncFullHistory: false` para conexão mais rápida
- O sistema fica pronto aos 10% de sincronização
- A sessão é salva automaticamente em `.wwebjs_auth`
- Processos órfãos do Chrome são limpos automaticamente
- **Agendamentos** são gravados no backend (SQLite) e executados pelo worker a cada 60 s; não dependem do navegador aberto

## 🔔 Alertas (Discord / WhatsApp)

Para receber notificações quando houver erro ou falha em envio, configure no `server/.env`:

- `DISCORD_WEBHOOK_URL` — URL do webhook do Discord (POST de mensagens em um canal)
- `ALERT_WHATSAPP_NUMBER` — Número no formato internacional (ex.: 5511999999999) para receber alertas via WhatsApp quando o cliente estiver conectado

Erros gravados no log (nível ERROR), falhas em envio em massa e evento "WhatsApp desconectado" disparam alerta (Discord sempre que configurado; WhatsApp se o cliente estiver conectado).

## ⚠️ Limites e boas práticas

- **Grupos muito grandes (500+ pessoas):** o WhatsApp pode atrasar a entrega; o envio é registrado assim que aceito.
- **Anexos em agendamentos:** limite de 10 MB por arquivo; armazenados em `server/uploads/schedule_<id>/` até o envio.
- **Muitos grupos no mesmo minuto:** prefira espaçar agendamentos para evitar picos.
- **Reinício do backend:** agendamentos permanecem no banco; o worker volta a processar após o restart.

## 🐛 Troubleshooting

**Erro "browser is already running":**
```bash
pkill -f chrome
pkill -f chromium
```

**QR Code não aparece:**
- Aguarde 10-20 segundos
- Verifique os logs do backend
- Tente limpar a sessão: `POST /api/clear-session`

**Porta já em uso:**
- Altere a porta no `vite.config.ts` (frontend) ou `server.js` (backend)

## 📄 Licença

MIT
