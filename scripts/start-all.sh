#!/bin/bash

# Script para iniciar Frontend e Backend com monitoramento
# Uso: ./scripts/start-all.sh

cd /root/zapflow-saas---whatsapp-management

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

LOG_DIR="logs"
LOG_FILE="$LOG_DIR/zapflow-$(date +%Y-%m-%d).log"
FRONTEND_LOG="$LOG_DIR/frontend-$(date +%Y-%m-%d).log"

# Criar diretório de logs
mkdir -p "$LOG_DIR"

echo -e "${BLUE}=== ZAPFLOW - INICIANDO FRONTEND E BACKEND ===${NC}\n"

# Verificar se já estão rodando
BACKEND_RUNNING=false
FRONTEND_RUNNING=false

if netstat -tlnp 2>/dev/null | grep -q ":3001" || ss -tlnp 2>/dev/null | grep -q ":3001"; then
    BACKEND_RUNNING=true
    echo -e "${YELLOW}⚠ Backend já está rodando na porta 3001${NC}"
fi

if netstat -tlnp 2>/dev/null | grep -q ":3000" || ss -tlnp 2>/dev/null | grep -q ":3000"; then
    FRONTEND_RUNNING=true
    echo -e "${YELLOW}⚠ Frontend já está rodando na porta 3000${NC}"
fi

# Função para limpar ao sair
cleanup() {
    echo -e "\n${YELLOW}Encerrando serviços...${NC}"
    if [ ! -z "$BACKEND_PID" ] && kill -0 $BACKEND_PID 2>/dev/null; then
        kill $BACKEND_PID 2>/dev/null
        echo -e "${GREEN}✓ Backend encerrado${NC}"
    fi
    if [ ! -z "$FRONTEND_PID" ] && kill -0 $FRONTEND_PID 2>/dev/null; then
        kill $FRONTEND_PID 2>/dev/null
        echo -e "${GREEN}✓ Frontend encerrado${NC}"
    fi
    # Matar processos filhos (vite, node)
    pkill -P $$ 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar Backend se não estiver rodando
if [ "$BACKEND_RUNNING" = false ]; then
    echo -e "${CYAN}Iniciando Backend (porta 3001)...${NC}"
    cd server
    node --watch server.js >> "../$LOG_FILE" 2>&1 &
    BACKEND_PID=$!
    cd ..
    sleep 2
    
    if kill -0 $BACKEND_PID 2>/dev/null; then
        echo -e "${GREEN}✓ Backend iniciado (PID: $BACKEND_PID)${NC}"
    else
        echo -e "${RED}✗ Erro ao iniciar Backend${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Backend já está rodando${NC}"
fi

# Iniciar Frontend se não estiver rodando
if [ "$FRONTEND_RUNNING" = false ]; then
    echo -e "${CYAN}Iniciando Frontend (porta 3000)...${NC}"
    npm run dev >> "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    sleep 3
    
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        echo -e "${GREEN}✓ Frontend iniciado (PID: $FRONTEND_PID)${NC}"
    else
        echo -e "${RED}✗ Erro ao iniciar Frontend${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Frontend já está rodando${NC}"
fi

echo ""
echo -e "${BLUE}=== SERVIÇOS RODANDO ===${NC}"
echo -e "${GREEN}Frontend:${NC} http://localhost:3000"
echo -e "${GREEN}Backend:${NC}  http://localhost:3001"
echo ""
echo -e "${BLUE}=== MONITORANDO LOGS EM TEMPO REAL ===${NC}"
echo -e "${YELLOW}Pressione Ctrl+C para parar tudo${NC}\n"

# Aguardar arquivos de log serem criados
while [ ! -f "$LOG_FILE" ]; do
    sleep 0.5
done
while [ ! -f "$FRONTEND_LOG" ]; do
    sleep 0.5
done

# Mostrar últimas linhas
echo -e "${CYAN}--- Últimas linhas do Backend ---${NC}"
tail -n 10 "$LOG_FILE"
echo ""
echo -e "${CYAN}--- Últimas linhas do Frontend ---${NC}"
tail -n 10 "$FRONTEND_LOG"
echo ""
echo -e "${BLUE}=== SEGUINDO LOGS (Backend + Frontend) ===${NC}\n"

# Usar multitail se disponível, senão usar tail simples
if command -v multitail &> /dev/null; then
    multitail -s 2 "$LOG_FILE" "$FRONTEND_LOG"
else
    # Alternativa: usar tail em paralelo
    (tail -f "$LOG_FILE" | sed 's/^/[BACKEND] /' &)
    (tail -f "$FRONTEND_LOG" | sed 's/^/[FRONTEND] /' &)
    wait
fi
