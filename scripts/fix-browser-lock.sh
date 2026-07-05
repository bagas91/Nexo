#!/bin/bash
# Libera o bloqueio "browser is already running" para poder conectar de novo.
# Uso: npm run fix:browser-lock   ou   ./scripts/fix-browser-lock.sh

set -e
cd "$(dirname "$0")/.."

echo "Parando o backend (PM2)..."
pm2 stop zapflow-backend 2>/dev/null || true

echo "Aguardando 5 segundos..."
sleep 5

echo "Encerrando processos Chrome do WhatsApp (wwebjs_auth)..."
pkill -f "wwebjs_auth" 2>/dev/null || true
sleep 2

echo "Pronto. Suba o backend de novo: npm run pm2:start   ou   pm2 start zapflow-backend"
echo "Depois abra o app e clique em 'Gerar QR Code' para conectar com seu pessoal."
