#!/bin/bash

# Script para tentar restaurar a sessão do WhatsApp sem deslogar
# Uso: ./scripts/restore-session.sh

cd /root/zapflow-saas---whatsapp-management

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== TENTANDO RESTAURAR SESSÃO WHATSAPP ===${NC}\n"

# Verificar se há sessão salva
if [ -d "server/.wwebjs_auth/session" ]; then
    SESSION_SIZE=$(du -sh server/.wwebjs_auth/session 2>/dev/null | cut -f1)
    echo -e "${GREEN}✓ Sessão encontrada ($SESSION_SIZE)${NC}"
    echo -e "${YELLOW}Tentando restaurar sem deslogar...${NC}\n"
else
    echo -e "${RED}✗ Nenhuma sessão encontrada${NC}"
    exit 1
fi

# Verificar status atual
echo -e "${YELLOW}1. Verificando status atual...${NC}"
STATUS=$(curl -s http://localhost:3001/api/status 2>/dev/null)
echo "$STATUS" | grep -q "CONNECTED" && echo -e "${GREEN}✓ Já está conectado!${NC}" && exit 0

# Se não estiver conectado, apenas reiniciar o servidor sem limpar sessão
echo -e "${YELLOW}2. Reiniciando servidor para tentar restaurar sessão...${NC}"
echo -e "${YELLOW}   (A sessão será preservada)${NC}"

# Parar apenas processos travados, não todos
pkill -TERM -f "chrome.*wwebjs_auth" 2>/dev/null
sleep 2

# Limpar apenas locks
find server/.wwebjs_auth -name "*.lock" -delete 2>/dev/null
rm -rf /tmp/.org.chromium.Chromium.* 2>/dev/null

# Aguardar e verificar
sleep 5
STATUS=$(curl -s http://localhost:3001/api/status 2>/dev/null)
if echo "$STATUS" | grep -q "CONNECTED"; then
    echo -e "${GREEN}✓ Sessão restaurada com sucesso!${NC}"
elif echo "$STATUS" | grep -q "QR_READY"; then
    echo -e "${YELLOW}⚠ Sessão não pôde ser restaurada automaticamente${NC}"
    echo -e "${YELLOW}   Será necessário escanear o QR code novamente${NC}"
else
    echo -e "${YELLOW}⚠ Aguardando conexão...${NC}"
fi

echo ""
