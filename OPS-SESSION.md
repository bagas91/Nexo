# Operação — sessão WhatsApp (Nexo / Zapflow)

Playbook rápido para não perder fila de disparo nem forçar QR.

## Regras de ouro

1. **Nunca** `client.logout()` / desconectar pelo WhatsApp no celular “só pra testar” se a fila está viva.
2. Preferir **`pm2 reload`** a `pm2 restart` quando só mudou código Node (menos chance de derrubar Chrome).
3. **`instances: 1`** no PM2 — nunca escalar (duplica worker e agendamentos).
4. Após crash, agendamentos `sending` voltam a `pending` **com checkpoint** (retomam do grupo N, não do zero).

## Comandos

```bash
cd /home/bagas/disparo_wpp/saas_disparo

# Preferido após deploy de código (graceful)
npm run pm2:reload

# Se reload não bastar
npm run pm2:restart

# Backup da sessão (IndexedDB/Local Storage — sem caches Chrome)
npm run backup:session
# ou: curl -X POST http://localhost:3001/api/session/backup

# Restore SEM logout (destroy → copiar backup → initialize)
npm run restore:session
```

## Sintomas → ação

| Sintoma | Ação |
|---------|------|
| QR aparece de novo inesperadamente | Parar, `restore:session`, `pm2:reload`. Não escanear QR novo se o backup for bom. |
| “detached Frame” no meio do disparo | Aguardar reconexão automática; checkpoint preserva enviados. Se travar: `pm2:reload`. |
| Parada de emergência | Dashboard → **Reativar disparos** ou **Reativar tudo** (também unpause schedules). |
| Agendamento “sending” após crash | No boot já vira `pending` + progressJson; worker retoma restantes. |
| RAM altíssima / Chrome zumbi | `npm run fix:browser-lock` depois `pm2:reload`. |

## Env úteis

```env
# Opcional: inicia com disparos pausados
DISPATCH_PAUSED=0

# Timeout Puppeteer para mídia pesada (ms)
PUPPETEER_PROTOCOL_TIMEOUT_MS=300000

# Detalhe Bling para rastreio (máx. GETs)
BLING_TRACKING_FETCH_MAX=5
```

## O que NÃO fazer

- `pm2 delete` + start sem backup
- `rm -rf server/.wwebjs_auth` sem backup
- Rodar dois processos na mesma sessão LocalAuth
