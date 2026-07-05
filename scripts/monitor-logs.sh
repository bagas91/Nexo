#!/bin/bash

# Script para monitorar logs do ZapFlow
# Uso: ./scripts/monitor-logs.sh [opções]

LOG_DIR="/root/zapflow-saas---whatsapp-management/logs"
SERVER_DIR="/root/zapflow-saas---whatsapp-management/server"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_help() {
    echo "Uso: $0 [opções]"
    echo ""
    echo "Opções:"
    echo "  -f, --follow     Seguir logs em tempo real (tail -f)"
    echo "  -t, --today      Mostrar logs de hoje"
    echo "  -a, --all        Mostrar todos os logs disponíveis"
    echo "  -s, --status     Mostrar status do sistema"
    echo "  -p, --process    Mostrar processos Node.js rodando"
    echo "  -h, --help       Mostrar esta ajuda"
}

show_status() {
    echo -e "${BLUE}=== STATUS DO SISTEMA ZAPFLOW ===${NC}\n"
    
    # Verificar processos
    echo -e "${YELLOW}Processos Node.js:${NC}"
    ps aux | grep -E "node.*server\.js|node.*--watch|vite" | grep -v grep | while read line; do
        PID=$(echo $line | awk '{print $2}')
        CMD=$(echo $line | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
        echo "  PID: $PID | $CMD"
    done
    
    echo ""
    
    # Verificar Frontend (porta 3000)
    echo -e "${YELLOW}Frontend (porta 3000):${NC}"
    if netstat -tlnp 2>/dev/null | grep -q ":3000" || ss -tlnp 2>/dev/null | grep -q ":3000"; then
        echo -e "  ${GREEN}✓ Frontend rodando${NC}"
        echo -e "  ${GREEN}  Acesse: http://localhost:3000${NC}"
        netstat -tlnp 2>/dev/null | grep ":3000" || ss -tlnp 2>/dev/null | grep ":3000"
    else
        echo -e "  ${RED}✗ Frontend não está rodando${NC}"
        echo -e "  ${YELLOW}  Execute: npm run frontend ou npm run start:all${NC}"
    fi
    
    echo ""
    
    # Verificar Backend (porta 3001)
    echo -e "${YELLOW}Backend (porta 3001):${NC}"
    if netstat -tlnp 2>/dev/null | grep -q ":3001" || ss -tlnp 2>/dev/null | grep -q ":3001"; then
        echo -e "  ${GREEN}✓ Backend rodando${NC}"
        netstat -tlnp 2>/dev/null | grep ":3001" || ss -tlnp 2>/dev/null | grep ":3001"
    else
        echo -e "  ${RED}✗ Backend não está rodando${NC}"
        echo -e "  ${YELLOW}  Execute: npm run server:monitor ou npm run start:all${NC}"
    fi
    
    echo ""
    
    # Verificar status da API
    echo -e "${YELLOW}Status da API:${NC}"
    STATUS=$(curl -s http://localhost:3001/api/status 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}✓ API respondendo${NC}"
        echo "  $STATUS" | jq '.' 2>/dev/null || echo "  $STATUS"
    else
        echo -e "  ${RED}✗ API não está respondendo${NC}"
    fi
    
    echo ""
    
    # Verificar logs
    echo -e "${YELLOW}Arquivos de Log:${NC}"
    if [ -d "$LOG_DIR" ]; then
        LOG_COUNT=$(find "$LOG_DIR" -name "*.log" -type f | wc -l)
        echo "  Total de arquivos de log: $LOG_COUNT"
        if [ $LOG_COUNT -gt 0 ]; then
            echo "  Últimos arquivos:"
            find "$LOG_DIR" -name "*.log" -type f -printf "%T@ %p\n" | sort -rn | head -5 | while read line; do
                FILE=$(echo $line | cut -d' ' -f2-)
                SIZE=$(du -h "$FILE" | cut -f1)
                echo "    - $(basename $FILE) ($SIZE)"
            done
        fi
    else
        echo -e "  ${YELLOW}Diretório de logs não existe ainda${NC}"
    fi
    
    echo ""
    
    # Verificar sessão WhatsApp
    echo -e "${YELLOW}Sessão WhatsApp:${NC}"
    if [ -d "$SERVER_DIR/.wwebjs_auth" ]; then
        echo -e "  ${GREEN}✓ Diretório de autenticação existe${NC}"
        SESSION_SIZE=$(du -sh "$SERVER_DIR/.wwebjs_auth" | cut -f1)
        echo "  Tamanho: $SESSION_SIZE"
    else
        echo -e "  ${YELLOW}⚠ Diretório de autenticação não encontrado${NC}"
    fi
}

show_today_logs() {
    TODAY=$(date +%Y-%m-%d)
    LOG_FILE="$LOG_DIR/zapflow-$TODAY.log"
    
    if [ -f "$LOG_FILE" ]; then
        echo -e "${BLUE}=== LOGS DE HOJE ($TODAY) ===${NC}\n"
        tail -100 "$LOG_FILE"
    else
        echo -e "${YELLOW}Nenhum log encontrado para hoje${NC}"
    fi
}

show_all_logs() {
    if [ -d "$LOG_DIR" ]; then
        echo -e "${BLUE}=== TODOS OS LOGS DISPONÍVEIS ===${NC}\n"
        find "$LOG_DIR" -name "*.log" -type f -printf "%T@ %p\n" | sort -rn | while read line; do
            FILE=$(echo $line | cut -d' ' -f2-)
            echo -e "\n${YELLOW}=== $(basename $FILE) ===${NC}"
            tail -50 "$FILE"
        done
    else
        echo -e "${YELLOW}Nenhum log encontrado${NC}"
    fi
}

follow_logs() {
    TODAY=$(date +%Y-%m-%d)
    LOG_FILE="$LOG_DIR/zapflow-$TODAY.log"
    
    if [ -f "$LOG_FILE" ]; then
        echo -e "${BLUE}Seguindo logs em tempo real... (Ctrl+C para sair)${NC}\n"
        tail -f "$LOG_FILE"
    else
        echo -e "${YELLOW}Aguardando criação do arquivo de log...${NC}"
        while [ ! -f "$LOG_FILE" ]; do
            sleep 1
        done
        tail -f "$LOG_FILE"
    fi
}

show_processes() {
    echo -e "${BLUE}=== PROCESSOS NODE.JS ===${NC}\n"
    ps aux | grep -E "node" | grep -v grep | head -20
}

# Parse arguments
case "${1:-}" in
    -f|--follow)
        follow_logs
        ;;
    -t|--today)
        show_today_logs
        ;;
    -a|--all)
        show_all_logs
        ;;
    -s|--status)
        show_status
        ;;
    -p|--process)
        show_processes
        ;;
    -h|--help|"")
        show_help
        ;;
    *)
        echo "Opção desconhecida: $1"
        show_help
        exit 1
        ;;
esac
