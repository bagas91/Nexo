# Tutorial de Instalacao - ZapFlow SaaS

Este guia mostra como instalar e subir o sistema ZapFlow em um servidor Linux.

## 1) O que precisa antes

- Node.js 18+ (recomendado Node.js 20 LTS)
- npm
- Google Chrome ou Chromium instalado (necessario para o `whatsapp-web.js`)
- Porta `3001` liberada no firewall (modo producao)

Opcional:
- PM2 (recomendado para manter o sistema rodando em producao)

```bash
npm install -g pm2
```

## 2) Receber e extrair o pacote

Depois de baixar o arquivo `zapflow-sistema-fonte.zip`:

```bash
unzip zapflow-sistema-fonte.zip
cd zapflow-saas---whatsapp-management
```

## 3) Instalar dependencias

Na raiz do projeto:

```bash
npm run install:all
```

Esse comando instala as dependencias do frontend (raiz) e backend (`server`).

## 4) Configurar ambiente

### Backend

Criar arquivo `.env` no backend a partir do exemplo:

```bash
cp server/.env.example server/.env
```

Edite o arquivo `server/.env` conforme necessario (API key, webhook do Discord, etc.).

### Frontend (opcional)

Se usar recursos de IA:

- criar/editar `.env.local` na raiz e definir `GEMINI_API_KEY`.

## 5) Rodar em desenvolvimento (2 terminais)

Terminal 1 (backend):

```bash
npm run server:dev
```

Terminal 2 (frontend):

```bash
npm run dev
```

Acesso:
- Frontend: `http://localhost:3000`
- API backend: `http://localhost:3001/api`

## 6) Rodar em producao (recomendado com PM2)

Gerar build do frontend:

```bash
npm run build
```

Subir com PM2:

```bash
npm run pm2:start
```

Comandos uteis:

```bash
npm run pm2:restart
npm run pm2:stop
npm run logs:live
```

Acesso em producao:
- `http://localhost:3001`

## 7) Checklist rapido de validacao

- API responde em `GET /api/health`
- Tela principal abre em `http://localhost:3001`
- QR Code do WhatsApp aparece
- Conexao WhatsApp fica como ativa apos leitura do QR

## 8) Problemas comuns

### Erro "browser is already running"

```bash
npm run fix:browser-lock
```

Se necessario:

```bash
pkill -f chrome
pkill -f chromium
```

### Porta em uso

- Ajustar porta do frontend em `vite.config.ts`
- Ajustar porta do backend em `server/server.js` (ou arquivo principal do backend)

### QR nao aparece

- Verificar logs: `npm run logs:live`
- Aguardar alguns segundos apos iniciar
- Reiniciar backend: `npm run pm2:restart`

