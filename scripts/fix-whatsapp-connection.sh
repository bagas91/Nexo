#!/bin/bash

# Script para corrigir problemas de conexão do WhatsApp
# Uso: ./scripts/fix-whatsapp-connection.sh

cd /root/zapflow-saas---whatsapp-management

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== CORRIGINDO CONEXÃO WHATSAPP ===${NC}\n"
echo -e "${RED}⚠ ATENÇÃO: Este script pode deslogar você do WhatsApp!${NC}"
echo -e "${YELLOW}   Use apenas se o sistema estiver completamente travado.${NC}"
echo -e "${YELLOW}   Para tentar restaurar sem deslogar, use: npm run restore:session${NC}\n"
echo -e "${YELLOW}Pressione Ctrl+C para cancelar ou aguarde 5 segundos...${NC}"
sleep 5
echo ""

# 1. Verificar se realmente precisa parar processos
echo -e "${YELLOW}1. Verificando processos do Chrome/Puppeteer...${NC}"
CHROME_COUNT=$(ps aux | grep -E "chrome.*wwebjs_auth" | grep -v grep | wc -l)
if [ "$CHROME_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}  Encontrados $CHROME_COUNT processos Chrome do WhatsApp${NC}"
    echo -e "${YELLOW}  Tentando parar graciosamente primeiro...${NC}"
    # Tentar parar graciosamente primeiro
    pkill -TERM -f "chrome.*wwebjs_auth" 2>/dev/null
    sleep 3
    
    # Se ainda estiver rodando, verificar se está travado
    CHROME_COUNT=$(ps aux | grep -E "chrome.*wwebjs_auth" | grep -v grep | wc -l)
    if [ "$CHROME_COUNT" -gt 0 ]; then
        echo -e "${YELLOW}  Processos ainda rodando, verificando se estão travados...${NC}"
        # Verificar se os processos estão realmente travados (usando CPU há muito tempo)
        # Se não estiverem travados, não matar para preservar sessão
        echo -e "${YELLOW}  ⚠ Preservando sessão - apenas limpando locks${NC}"
    else
        echo -e "${GREEN}✓ Processos parados graciosamente${NC}"
    fi
else
    echo -e "${GREEN}✓ Nenhum processo Chrome do WhatsApp encontrado${NC}"
fi

# Limpar apenas locks, não a sessão
echo -e "${YELLOW}  Limpando locks do Chrome...${NC}"
find /root/zapflow-saas---whatsapp-management/server/.wwebjs_auth -name "*.lock" -delete 2>/dev/null
rm -rf /tmp/.org.chromium.Chromium.* 2>/dev/null
rm -rf /tmp/.com.google.Chrome.* 2>/dev/null
echo -e "${GREEN}✓ Locks limpos (sessão preservada)${NC}\n"

# 2. Verificar e preservar sessão
echo -e "${YELLOW}2. Verificando sessão do WhatsApp...${NC}"
if [ -d "server/.wwebjs_auth/session" ]; then
    SESSION_SIZE=$(du -sh server/.wwebjs_auth/session 2>/dev/null | cut -f1)
    echo -e "${GREEN}✓ Sessão encontrada ($SESSION_SIZE)${NC}"
    echo -e "${YELLOW}  ⚠ Sessão será preservada para evitar novo login${NC}"
else
    echo -e "${YELLOW}⚠ Nenhuma sessão encontrada${NC}"
fi
echo ""

# 3. Verificar conectividade
echo -e "${YELLOW}3. Verificando conectividade com web.whatsapp.com...${NC}"
if curl -I https://web.whatsapp.com/ --max-time 10 2>&1 | grep -q "HTTP"; then
    echo -e "${GREEN}✓ Conectividade OK${NC}\n"
else
    echo -e "${RED}✗ Problema de conectividade detectado${NC}"
    echo -e "${YELLOW}  Verifique sua conexão com a internet${NC}\n"
fi

# 4. Reconectar via API
echo -e "${YELLOW}4. Forçando reconexão via API...${NC}"
curl -X POST http://localhost:3001/api/reconnect 2>/dev/null > /dev/null
sleep 3
echo -e "${GREEN}✓ Reconexão solicitada${NC}\n"

# 5. Verificar status
echo -e "${YELLOW}5. Verificando status atual...${NC}"
STATUS=$(curl -s http://localhost:3001/api/status 2>/dev/null)
echo "$STATUS" | grep -q "CONNECTED" && echo -e "${GREEN}✓ Conectado!${NC}" || echo -e "${YELLOW}⚠ Ainda conectando...${NC}"
echo ""

echo -e "${BLUE}=== PRÓXIMOS PASSOS ===${NC}"
echo -e "1. Aguarde alguns segundos para o WhatsApp gerar o QR Code"
echo -e "2. Verifique os logs: ${YELLOW}npm run logs:live${NC}"
echo -e "3. Se o problema persistir, limpe a sessão:"
echo -e "   ${YELLOW}rm -rf server/.wwebjs_auth/session${NC}"
echo ""
