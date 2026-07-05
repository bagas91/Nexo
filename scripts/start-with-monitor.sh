#!/bin/bash

# Script para iniciar o servidor e monitorar logs em tempo real
# Uso: ./scripts/start-with-monitor.sh [dev|prod]

cd /root/zapflow-saas---whatsapp-management

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

MODE=${1:-dev}
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/zapflow-$(date +%Y-%m-%d).log"

# Criar diretório de logs
mkdir -p "$LOG_DIR"

echo -e "${BLUE}=== ZAPFLOW - INICIANDO SERVIDOR COM MONITORAMENTO ===${NC}\n"

# Verificar se já está rodando
if netstat -tlnp 2>/dev/null | grep -q ":3001" || ss -tlnp 2>/dev/null | grep -q ":3001"; then
    echo -e "${YELLOW}⚠ Servidor já está rodando na porta 3001${NC}"
    echo -e "${BLUE}Monitorando logs existentes...${NC}\n"
    
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo -e "${YELLOW}Aguardando criação do arquivo de log...${NC}"
        while [ ! -f "$LOG_FILE" ]; do
            sleep 1
        done
        tail -f "$LOG_FILE"
    fi
    exit 0
fi

# Função para limpar ao sair
cleanup() {
    echo -e "\n${YELLOW}Encerrando monitoramento...${NC}"
    kill $SERVER_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar servidor em background
echo -e "${GREEN}Iniciando servidor em modo: $MODE${NC}\n"

# Iniciar servidor redirecionando saída para arquivo
if [ "$MODE" = "dev" ]; then
    cd server
    node --watch server.js >> "../$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    cd ..
else
    cd server
    node server.js >> "../$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    cd ..
fi

# Aguardar um pouco para o servidor iniciar
sleep 2

# Verificar se o processo ainda está rodando
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${RED}Erro ao iniciar o servidor${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Servidor iniciado (PID: $SERVER_PID)${NC}"
echo -e "${BLUE}=== MONITORANDO LOGS EM TEMPO REAL ===${NC}"
echo -e "${YELLOW}Pressione Ctrl+C para parar${NC}\n"

# Limpar ao sair
cleanup() {
    echo -e "\n${YELLOW}Encerrando servidor e monitoramento...${NC}"
    kill $SERVER_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Aguardar arquivo ser criado e então seguir em tempo real
while [ ! -f "$LOG_FILE" ]; do
    sleep 0.5
done

# Mostrar últimas linhas e depois seguir em tempo real
tail -n 20 "$LOG_FILE"
echo ""
tail -f "$LOG_FILE"
