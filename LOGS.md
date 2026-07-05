# Sistema de Logs - ZapFlow SaaS

## 📋 Visão Geral

O sistema ZapFlow agora possui um sistema completo de logging que salva todos os eventos em arquivos de log organizados por data.

## 📁 Localização dos Logs

Os logs são salvos em: `/root/zapflow-saas---whatsapp-management/logs/`

Formato dos arquivos: `zapflow-YYYY-MM-DD.log`

## 🛠️ Como Usar

### ⚡ Monitoramento em Tempo Real (Recomendado)

#### Iniciar Servidor e Monitorar Simultaneamente
```bash
./scripts/start-with-monitor.sh
# ou para modo desenvolvimento:
./scripts/start-with-monitor.sh dev
# ou para produção:
./scripts/start-with-monitor.sh prod
```

Este comando:
- ✅ Inicia o servidor automaticamente
- ✅ Monitora os logs em tempo real no terminal
- ✅ Salva todos os logs em arquivo
- ✅ Para com Ctrl+C

#### Monitorar Logs de um Servidor Já Rodando
```bash
./scripts/monitor-live.sh
```

Este comando monitora os logs em tempo real sem iniciar o servidor.

### Script de Monitoramento (Análise)

O script `scripts/monitor-logs.sh` oferece várias opções para visualizar e monitorar os logs:

#### Ver Status do Sistema
```bash
./scripts/monitor-logs.sh --status
# ou
./scripts/monitor-logs.sh -s
```

Mostra:
- Processos Node.js rodando
- Status da porta 3001
- Status da API
- Arquivos de log disponíveis
- Status da sessão WhatsApp

#### Ver Logs de Hoje
```bash
./scripts/monitor-logs.sh --today
# ou
./scripts/monitor-logs.sh -t
```

#### Ver Todos os Logs
```bash
./scripts/monitor-logs.sh --all
# ou
./scripts/monitor-logs.sh -a
```

#### Seguir Logs em Tempo Real
```bash
./scripts/monitor-logs.sh --follow
# ou
./scripts/monitor-logs.sh -f
```

#### Ver Processos Node.js
```bash
./scripts/monitor-logs.sh --process
# ou
./scripts/monitor-logs.sh -p
```

## 📊 Tipos de Logs

O sistema registra os seguintes tipos de eventos:

- **INFO**: Informações gerais do sistema
- **ERROR**: Erros e exceções
- **WARN**: Avisos e situações que requerem atenção
- **DEBUG**: Informações de depuração

## 🔍 Exemplos de Logs

```
[2026-01-31T20:45:00.000Z] [INFO] Servidor Backend ✅ Rodando na porta 3001
[2026-01-31T20:45:01.000Z] [INFO] WhatsApp Inicializando cliente...
[2026-01-31T20:45:05.000Z] [INFO] WhatsApp: QR Code recebido - Limpando cache de grupos antigo
[2026-01-31T20:45:30.000Z] [INFO] WhatsApp: ✅ Cliente conectado!
[2026-01-31T20:45:35.000Z] [INFO] API: Enviando mensagem {"chatId":"...","hasAttachments":false}
```

## 🔄 Integração Automática

O logger está integrado automaticamente em:
- `server/server.js` - Servidor Express
- `server/services/whatsappClient.js` - Cliente WhatsApp

Todos os `console.log` e `console.error` foram substituídos pelo logger, que salva tanto no console quanto em arquivos.

## 📝 Notas

- Os logs são criados automaticamente quando o servidor inicia
- Um novo arquivo é criado a cada dia
- Os logs são anexados ao arquivo do dia atual
- O sistema continua funcionando mesmo se houver erro ao escrever logs

## 🚀 Próximos Passos

Para ver os logs em tempo real enquanto o sistema está rodando:

```bash
cd /root/zapflow-saas---whatsapp-management
./scripts/monitor-logs.sh --follow
```

Para verificar o status completo do sistema:

```bash
./scripts/monitor-logs.sh --status
```
