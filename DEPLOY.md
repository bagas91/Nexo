# ZapFlow — Deploy e produção

## PM2: uma única instância

O worker de agendamentos roda dentro do mesmo processo do backend. **Só pode haver uma instância** do app rodando.

- No `ecosystem.config.cjs` está definido `instances: 1`.
- Se você usar `pm2 scale zapflow-backend 2` (ou mais), o mesmo agendamento será executado por cada instância e as mensagens serão enviadas em duplicata.
- Comando para garantir uma instância: `pm2 scale zapflow-backend 1`

## Variáveis de ambiente (server/.env)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DISCORD_WEBHOOK_URL` | Recomendado em produção | Webhook do Discord para alertas (erros, auth_failure, disco cheio, falhas de envio). |
| `ALERT_WHATSAPP_NUMBER` | Não | Número (internacional, só dígitos) que recebe alertas via WhatsApp. |
| `API_KEY` | Recomendado em produção | Se definida, as rotas da API (exceto status, health, login, qr) exigem header `X-API-Key` ou `Authorization: Bearer <API_KEY>`. |
| `WAIT_FOR_READY_MS` | Não | Tempo em ms para aguardar o cliente WhatsApp ficar pronto após reconexão (default: 120000). |

Copie `server/.env.example` para `server/.env` e preencha os valores.

## Disco

- Backups da sessão WhatsApp e anexos de agendamentos ficam em disco. Se o disco encher:
  - O backup da sessão pode falhar (alerta no Discord, se configurado).
  - Anexos de agendamentos podem falhar ao salvar (resposta de erro na API).
- Monitore espaço em disco no servidor e limpe logs/backups antigos se necessário.

## Após muitos dias sem uso

Se o sistema ficar dias sem enviar, a sessão do WhatsApp Web pode ficar inválida (frame detach). O backend tenta reconectar sozinho e pode manter o agendamento como `pending` por até 3 tentativas. Se mesmo assim falhar, o cliente deve reconectar (ou escanear o QR novamente) e criar um novo agendamento se necessário.
