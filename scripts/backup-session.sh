#!/bin/bash

# Script para fazer backup manual da sessão
# Uso: ./scripts/backup-session.sh

cd /root/zapflow-saas---whatsapp-management

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== BACKUP DE SESSÃO WHATSAPP ===${NC}\n"

# Verificar se servidor está rodando
if ! curl -s http://localhost:3001/api/status > /dev/null 2>&1; then
    echo -e "${RED}✗ Servidor não está rodando${NC}"
    echo -e "${YELLOW}  Inicie o servidor primeiro${NC}"
    exit 1
fi

# Fazer backup via API
echo -e "${YELLOW}Fazendo backup da sessão...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:3001/api/session/backup)

if echo "$RESPONSE" | grep -q "success.*true"; then
    echo -e "${GREEN}✓ Backup criado com sucesso!${NC}\n"
    
    # Listar backups
    echo -e "${YELLOW}Backups disponíveis:${NC}"
    curl -s http://localhost:3001/api/session/backups | grep -o '"name":"[^"]*"' | sed 's/"name":"//g' | sed 's/"//g' | head -5
else
    echo -e "${RED}✗ Erro ao criar backup${NC}"
    echo "$RESPONSE"
    exit 1
fi

echo ""
