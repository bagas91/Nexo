#!/bin/bash
# Checklist operacional rápido do ZapFlow
# Uso:
#   ./scripts/check-zapflow.sh
#   ./scripts/check-zapflow.sh --watch
#   ./scripts/check-zapflow.sh --rescue

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
APP_NAME="${APP_NAME:-zapflow-backend}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok() { echo -e "${GREEN}OK${NC}  $1"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; }
err() { echo -e "${RED}ERR${NC}  $1"; }
info() { echo -e "${BLUE}INFO${NC} $1"; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

json_get() {
  # json_get "<json>" "<path>" ; path simples: ok / whatsapp / status
  node -e "try{const o=JSON.parse(process.argv[1]);const k=process.argv[2];console.log((o&&o[k])??'');}catch{console.log('');}" "$1" "$2"
}

count_pending() {
  node -e "try{const a=JSON.parse(process.argv[1]);const n=Array.isArray(a)?a.filter(x=>x&&x.status==='pending').length:0;console.log(n);}catch{console.log('0');}" "$1"
}

show_header() {
  echo "=========================================="
  echo " ZapFlow Operational Check"
  echo " Base URL: $BASE_URL"
  echo " Time: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "=========================================="
}

check_pm2() {
  if ! has_cmd pm2; then
    err "pm2 não encontrado"
    return 1
  fi
  local line
  line="$(pm2 list | awk -v app="$APP_NAME" '$0 ~ app {print $0; found=1} END{if(!found) exit 1}')"
  if [ $? -ne 0 ]; then
    err "Processo $APP_NAME não encontrado no PM2"
    return 1
  fi
  echo "$line" | grep -q "online"
  if [ $? -eq 0 ]; then
    ok "PM2: $APP_NAME online"
  else
    warn "PM2: $APP_NAME não está online"
  fi
}

check_health() {
  local health status schedules okv wpp stv
  health="$(curl -s --max-time 5 "$BASE_URL/api/health" || true)"
  status="$(curl -s --max-time 5 "$BASE_URL/api/status" || true)"
  schedules="$(curl -s --max-time 8 "$BASE_URL/api/schedules" || true)"

  if [ -z "$health" ]; then
    err "Health endpoint sem resposta"
    return 1
  fi

  okv="$(json_get "$health" "ok")"
  wpp="$(json_get "$health" "whatsapp")"
  stv="$(json_get "$status" "status")"

  if [ "$okv" = "true" ]; then
    ok "Health: ok=true"
  else
    warn "Health: resposta inesperada -> $health"
  fi

  if [ "$wpp" = "connected" ] || [ "$stv" = "CONNECTED" ]; then
    ok "WhatsApp conectado ($wpp/$stv)"
  else
    warn "WhatsApp não conectado ($wpp/$stv)"
  fi

  local pending
  pending="$(count_pending "$schedules")"
  if [ "$pending" = "0" ]; then
    ok "Agendamentos pendentes: 0"
  else
    warn "Agendamentos pendentes: $pending"
  fi
}

check_disk() {
  local usep avail
  usep="$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')"
  avail="$(df -h / | awk 'NR==2 {print $4}')"
  if [ -z "$usep" ]; then
    warn "Não foi possível ler uso de disco"
    return
  fi
  if [ "$usep" -ge 93 ]; then
    err "Disco crítico: ${usep}% usado (livre: $avail)"
  elif [ "$usep" -ge 90 ]; then
    warn "Disco alto: ${usep}% usado (livre: $avail)"
  else
    ok "Disco saudável: ${usep}% usado (livre: $avail)"
  fi
}

show_tail_hint() {
  echo
  info "Para acompanhar disparo em tempo real:"
  echo "  pm2 logs $APP_NAME"
}

run_once() {
  show_header
  check_pm2
  check_health
  check_disk
  show_tail_hint
}

run_watch() {
  while true; do
    clear
    run_once
    echo
    info "Atualizando em 15s... (Ctrl+C para sair)"
    sleep 15
  done
}

run_rescue() {
  show_header
  warn "Executando passos de contingência..."
  echo
  echo "1) Fix lock do navegador"
  (cd "$PROJECT_ROOT" && ./scripts/fix-browser-lock.sh)
  echo
  echo "2) Reiniciar backend com env atualizado"
  (cd "$PROJECT_ROOT" && pm2 restart "$APP_NAME" --update-env)
  echo
  echo "3) Nova checagem"
  run_once
}

case "${1:-}" in
  --watch)
    run_watch
    ;;
  --rescue)
    run_rescue
    ;;
  -h|--help)
    echo "Uso: $0 [--watch|--rescue]"
    ;;
  *)
    run_once
    ;;
esac

