#!/bin/bash

# Script para monitorar logs em tempo real (sem iniciar servidor)
# Uso: ./scripts/monitor-live.sh

cd /root/zapflow-saas---whatsapp-management

LOG_DIR="logs"
LOG_FILE="$LOG_DIR/zapflow-$(date +%Y-%m-%d).log"

# Cores
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${BLUE}=== MONITORAMENTO DE LOGS EM TEMPO REAL ===${NC}\n"

# Verificar se o arquivo existe
if [ -f "$LOG_FILE" ]; then
    echo -e "${GREEN}Monitorando: $LOG_FILE${NC}"
    echo -e "${YELLOW}Pressione Ctrl+C para sair${NC}\n"
    tail -f "$LOG_FILE"
else
    echo -e "${YELLOW}Arquivo de log não encontrado: $LOG_FILE${NC}"
    echo -e "${YELLOW}Aguardando criação do arquivo...${NC}\n"
    
    # Criar diretório se não existir
    mkdir -p "$LOG_DIR"
    
    # Aguardar criação do arquivo
    while [ ! -f "$LOG_FILE" ]; do
        sleep 1
        echo -n "."
    done
    
    echo -e "\n${GREEN}Arquivo criado! Iniciando monitoramento...${NC}\n"
    tail -f "$LOG_FILE"
fi
