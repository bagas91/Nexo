# ⚠️ Avisos Importantes - ZapFlow

## 🔐 Preservação de Sessão WhatsApp

### ⚠️ IMPORTANTE: Evite Deslogar

Quando o sistema precisa ser reiniciado ou há problemas de conexão, **sempre tente primeiro** preservar a sessão do WhatsApp.

### 📋 Scripts Disponíveis (em ordem de preferência)

#### 1. **Restaurar Sessão (RECOMENDADO)** ⭐
```bash
npm run restore:session
```
- ✅ Tenta restaurar a sessão sem deslogar
- ✅ Preserva a autenticação
- ✅ Use quando o sistema estiver lento mas ainda funcionando

#### 2. **Corrigir Conexão (ÚLTIMO RECURSO)** ⚠️
```bash
npm run fix:whatsapp
```
- ⚠️ **PODE DESLOGAR VOCÊ DO WHATSAPP**
- ⚠️ Use apenas se o sistema estiver completamente travado
- ⚠️ Será necessário escanear QR code novamente

### 🔄 O que aconteceu hoje?

Quando o sistema estava travado em "CONNECTING", foi necessário:
1. Matar processos Chrome travados
2. Limpar locks de arquivo
3. Reiniciar o servidor

Infelizmente, quando processos são encerrados de forma forçada, o WhatsApp pode invalidar a sessão por segurança, exigindo novo login.

### 💡 Como Evitar no Futuro

1. **Sempre use primeiro**: `npm run restore:session`
2. **Monitore os logs**: `npm run logs:live` para detectar problemas cedo
3. **Evite matar processos**: Deixe o sistema tentar se recuperar sozinho
4. **Backup da sessão**: Considere fazer backup de `server/.wwebjs_auth/` periodicamente

### 🛠️ Solução de Problemas

#### Sistema travado mas ainda respondendo:
```bash
npm run restore:session
```

#### Sistema completamente travado:
```bash
npm run fix:whatsapp
# Depois escanear QR code novamente
```

#### Verificar status:
```bash
npm run logs:status
```

### 📝 Notas Técnicas

- A sessão é salva em `server/.wwebjs_auth/session/`
- O LocalAuth tenta restaurar automaticamente ao iniciar
- Matar processos Chrome com `kill -9` pode corromper a sessão
- O WhatsApp pode invalidar sessões por segurança se detectar comportamento anormal
