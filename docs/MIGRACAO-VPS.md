# Migração para outra VPS

Guia rápido para levar o **Zapflow / saas_disparo** para sua VPS pessoal.

## 1. O que levar no git / rsync

- Todo o código do repositório
- **Não** commitar: `server/.env`, `server/.wwebjs_auth/`, `node_modules/`, `dist/`

## 2. O que copiar manualmente (se quiser manter WhatsApp conectado)

| Origem | Destino | Observação |
|--------|---------|------------|
| `server/.env` | mesmo caminho | Secrets, chaves IA, admin |
| `server/.wwebjs_auth/` | mesmo caminho | Sessão WhatsApp — **parar PM2 antes** de copiar |
| `server/chats.db` | `server/chats.db` | SQLite: grupos, agendamentos, inbox, platform |

> Se **não** copiar a sessão, vai precisar escanear QR ou código de pareamento de novo na VPS nova.

## 3. Setup na VPS nova

```bash
# Dependências sistema (exemplo Ubuntu)
sudo apt update
sudo apt install -y nodejs npm ffmpeg  # ffmpeg = conversão áudio Palavra do Dia

cd saas_disparo
npm run install:all
cp server/.env.example server/.env   # editar com valores reais
npm run build
npm run pm2:start
pm2 save
pm2 startup   # seguir instrução para boot automático
```

## 4. Frontend em produção

- Build gera `dist/` — servir via Nginx/Apache apontando para `dist/index.html`
- API deve proxy para `http://127.0.0.1:3001`
- Variável frontend: `.env.local` com URL da API se diferente de relativo

## 5. Cursor / IA ciente do projeto

Ao abrir o workspace na nova máquina:

1. **`AGENTS.md`** na raiz — contexto completo para o agente
2. **`.cursor/rules/zapflow-project.mdc`** — regras sempre ativas no Cursor
3. No primeiro chat, pode dizer: *"Leia o AGENTS.md e me ajude com X"*

## 6. Pós-migração

```bash
npm run check:ops
curl -s http://localhost:3001/api/health
```

- Conectar WhatsApp no painel (se sessão não foi migrada)
- Testar envio em **1 grupo de teste** antes de disparo oficial
- Conferir `pm2 logs zapflow-backend`

## 7. Checklist

- [ ] Node 18+ instalado
- [ ] `ffmpeg` instalado (áudio)
- [ ] `server/.env` configurado
- [ ] `npm run build` executado
- [ ] PM2 rodando (`zapflow-backend`)
- [ ] Nginx/proxy apontando para API :3001
- [ ] WhatsApp conectado
- [ ] Chaves Gemini/OpenAI válidas
- [ ] `AGENTS.md` revisado (URL, usuário admin)
