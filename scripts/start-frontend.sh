#!/bin/bash

# Script para iniciar apenas o Frontend com monitoramento
# Uso: ./scripts/start-frontend.sh

cd /root/zapflow-saas---whatsapp-management

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

LOG_DIR="logs"
FRONTEND_LOG="$LOG_DIR/frontend-$(date +%Y-%m-%d).log"

# Criar diretório de logs
mkdir -p "$LOG_DIR"

echo -e "${BLUE}=== ZAPFLOW - INICIANDO FRONTEND ===${NC}\n"

# Verificar se já está rodando
if netstat -tlnp 2>/dev/null | grep -q ":3000" || ss -tlnp 2>/dev/null | grep -q ":3000"; then
    echo -e "${YELLOW}⚠ Frontend já está rodando na porta 3000${NC}"
    echo -e "${BLUE}Monitorando logs existentes...${NC}\n"
    
    if [ -f "$FRONTEND_LOG" ]; then
        tail -f "$FRONTEND_LOG"
    else
        echo -e "${YELLOW}Aguardando criação do arquivo de log...${NC}"
        while [ ! -f "$FRONTEND_LOG" ]; do
            sleep 1
        done
        tail -f "$FRONTEND_LOG"
    fi
    exit 0
fi

# Função para limpar ao sair
cleanup() {
    echo -e "\n${YELLOW}Encerrando Frontend...${NC}"
    kill $FRONTEND_PID 2>/dev/null
    pkill -P $$ 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar Frontend
echo -e "${GREEN}Iniciando Frontend na porta 3000...${NC}\n"

npm run dev >> "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

# Aguardar um pouco para o servidor iniciar
sleep 3

# Verificar se o processo ainda está rodando
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${RED}Erro ao iniciar o Frontend${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Frontend iniciado (PID: $FRONTEND_PID)${NC}"
echo -e "${GREEN}✓ Acesse: http://localhost:3000${NC}"
echo -e "${BLUE}=== MONITORANDO LOGS EM TEMPO REAL ===${NC}"
echo -e "${YELLOW}Pressione Ctrl+C para parar${NC}\n"

# Aguardar arquivo ser criado e então seguir em tempo real
while [ ! -f "$FRONTEND_LOG" ]; do
    sleep 0.5
done

# Mostrar últimas linhas e depois seguir em tempo real
tail -n 20 "$FRONTEND_LOG"
echo ""
tail -f "$FRONTEND_LOG"
