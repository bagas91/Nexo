#!/bin/bash
# Relatório rápido de desempenho — dual WhatsApp (Disparo + E-commerce)
# Uso:
#   ./scripts/perf-check.sh
#   ./scripts/perf-check.sh --watch          # atualiza a cada 5s
#   BASE_URL=http://127.0.0.1:3001 ./scripts/perf-check.sh
#
# O que mede:
#   - RAM/CPU do host
#   - processos Chrome/Node ligados às sessões Disparo e E-commerce
#   - status das duas conexões via /api/health e /api/status
#   - pastas de sessão (.wwebjs_auth)

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
APP_NAME="${APP_NAME:-zapflow-backend}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_ROOT="$PROJECT_ROOT/server/.wwebjs_auth"
WATCH=0
INTERVAL=5

for arg in "$@"; do
  case "$arg" in
    --watch|-w) WATCH=1 ;;
    --interval=*) INTERVAL="${arg#--interval=}" ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok() { echo -e "${GREEN}OK${NC}   $1"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; }
err() { echo -e "${RED}ERR${NC}  $1"; }
info() { echo -e "${BLUE}INFO${NC} $1"; }
sec() { echo -e "\n${BOLD}${CYAN}▸ $1${NC}"; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

bytes_human() {
  # stdin or $1 = bytes
  local b="${1:-0}"
  node -e "
    const n=Number(process.argv[1])||0;
    const u=['B','KB','MB','GB','TB'];
    let i=0,v=n;
    while(v>=1024 && i<u.length-1){v/=1024;i++;}
    console.log(i===0?String(Math.round(v))+u[i]:v.toFixed(1)+u[i]);
  " "$b" 2>/dev/null || echo "${b}B"
}

dir_size_bytes() {
  local d="$1"
  if [ ! -d "$d" ]; then echo 0; return; fi
  du -sb "$d" 2>/dev/null | awk '{print $1}'
}

json_field() {
  node -e "
    try {
      const o = JSON.parse(process.argv[1]);
      const path = process.argv[2].split('.');
      let cur = o;
      for (const k of path) {
        if (cur == null) { console.log(''); process.exit(0); }
        cur = cur[k];
      }
      if (cur === undefined || cur === null) console.log('');
      else if (typeof cur === 'object') console.log(JSON.stringify(cur));
      else console.log(String(cur));
    } catch { console.log(''); }
  " "$1" "$2"
}

sum_rss_kb_for_pattern() {
  local pat="$1"
  # rss em KB (coluna 6 do ps -o)
  ps -eo pid,rss,cmd --no-headers 2>/dev/null \
    | grep -F "$pat" \
    | grep -v grep \
    | awk '{s+=$2} END{print s+0}'
}

count_procs_for_pattern() {
  local pat="$1"
  ps -eo pid,cmd --no-headers 2>/dev/null \
    | grep -F "$pat" \
    | grep -v grep \
    | wc -l \
    | tr -d ' '
}

cpu_pct_for_pattern() {
  local pat="$1"
  ps -eo pid,pcpu,cmd --no-headers 2>/dev/null \
    | grep -F "$pat" \
    | grep -v grep \
    | awk '{s+=$2} END{printf "%.1f", s+0}'
}

print_top_matching() {
  local pat="$1"
  local label="$2"
  local lines
  lines="$(ps -eo pid,pcpu,rss,cmd --sort=-rss --no-headers 2>/dev/null \
    | grep -F "$pat" \
    | grep -v grep \
    | head -n 5)"
  if [ -z "$lines" ]; then
    info "$label: nenhum processo"
    return
  fi
  echo "  PID    %CPU   RSS(MB)  CMD"
  echo "$lines" | while read -r pid cpu rss rest; do
    local mb
    mb="$(node -e "console.log(((Number(process.argv[1])||0)/1024).toFixed(0))" "$rss" 2>/dev/null || echo "?")"
    printf "  %-6s %-6s %-8s %s\n" "$pid" "$cpu" "$mb" "$(echo "$rest" | cut -c1-70)"
  done
}

verdict_ram() {
  # $1 = available MB, $2 = chrome total MB
  local avail="$1"
  local chrome="$2"
  if [ "$avail" -lt 400 ]; then
    err "RAM livre baixa (${avail} MB). Risco alto com 2 Chromes."
  elif [ "$avail" -lt 800 ]; then
    warn "RAM livre apertada (${avail} MB). Monitore durante disparo."
  else
    ok "RAM livre confortável (${avail} MB)."
  fi
  if [ "$chrome" -gt 2500 ]; then
    warn "Chromium total alto (~${chrome} MB). Normal com 2 sessões, mas evite vídeo em massa."
  elif [ "$chrome" -gt 0 ]; then
    ok "Chromium total ~${chrome} MB."
  fi
}

run_once() {
  clear_if_watch() {
    if [ "$WATCH" = "1" ]; then clear; fi
  }
  clear_if_watch

  echo "=============================================="
  echo " Nexo / ZapFlow — Performance Check"
  echo " $(date '+%Y-%m-%d %H:%M:%S')"
  echo " Host: $(hostname 2>/dev/null || echo '?')"
  echo " Base: $BASE_URL"
  echo "=============================================="

  # --- Host ---
  sec "Host"
  if has_cmd free; then
    free -h | sed 's/^/  /'
    local avail_mb mem_total_mb
    avail_mb="$(free -m | awk '/^Mem:/{print $7}')"
    mem_total_mb="$(free -m | awk '/^Mem:/{print $2}')"
    info "Memória total: ${mem_total_mb} MB | disponível: ${avail_mb} MB"
  else
    warn "comando free não disponível"
    avail_mb=0
  fi
  if [ -r /proc/loadavg ]; then
    info "Load average: $(cut -d' ' -f1-3 /proc/loadavg) (1m 5m 15m)"
  fi
  if has_cmd uptime; then
    info "Uptime: $(uptime -p 2>/dev/null || uptime)"
  fi
  if has_cmd df; then
    local disk
    disk="$(df -h "$PROJECT_ROOT" 2>/dev/null | awk 'NR==2{print $4" livres de "$2" ("$5" usado)"}')"
    [ -n "$disk" ] && info "Disco ($PROJECT_ROOT): $disk"
  fi

  # --- PM2 ---
  sec "PM2 / Node"
  if has_cmd pm2; then
    local line
    line="$(pm2 jlist 2>/dev/null | node -e "
      let d=''; try{d=require('fs').readFileSync(0,'utf8');}catch{}
      try{
        const arr=JSON.parse(d);
        const p=arr.find(x=>x.name===process.argv[1]);
        if(!p){console.log('');process.exit(0);}
        const m=p.monit||{};
        const s=(p.pm2_env&&p.pm2_env.status)||'?';
        console.log([s, m.memory||0, m.cpu||0, (p.pm2_env&&p.pm2_env.restart_time)||0].join('|'));
      }catch{console.log('');}
    " "$APP_NAME" 2>/dev/null || true)"
    if [ -z "$line" ]; then
      warn "PM2: processo $APP_NAME não encontrado"
    else
      local st mem cpu restarts
      IFS='|' read -r st mem cpu restarts <<< "$line"
      local mem_h
      mem_h="$(bytes_human "$mem")"
      if [ "$st" = "online" ]; then
        ok "PM2 $APP_NAME: online | RSS Node ~${mem_h} | CPU ${cpu}% | restarts ${restarts}"
      else
        err "PM2 $APP_NAME: status=$st"
      fi
    fi
  else
    warn "pm2 não encontrado"
  fi

  # --- Sessões Chrome ---
  sec "Sessões Chromium (Disparo vs E-commerce)"
  local dispatch_pat ecom_pat
  dispatch_pat="$AUTH_ROOT/session"
  ecom_pat="$AUTH_ROOT/session-ecommerce"

  local d_rss d_cpu d_n e_rss e_cpu e_n
  d_rss="$(sum_rss_kb_for_pattern "$dispatch_pat")"
  e_rss="$(sum_rss_kb_for_pattern "$ecom_pat")"
  d_cpu="$(cpu_pct_for_pattern "$dispatch_pat")"
  e_cpu="$(cpu_pct_for_pattern "$ecom_pat")"
  d_n="$(count_procs_for_pattern "$dispatch_pat")"
  e_n="$(count_procs_for_pattern "$ecom_pat")"

  local d_mb e_mb chrome_mb
  d_mb="$(node -e "console.log(Math.round((Number(process.argv[1])||0)/1024))" "$d_rss")"
  e_mb="$(node -e "console.log(Math.round((Number(process.argv[1])||0)/1024))" "$e_rss")"
  chrome_mb=$((d_mb + e_mb))

  echo "  Papel        Procs   RAM(MB)   %CPU"
  printf "  %-12s %-7s %-9s %s\n" "Disparo" "$d_n" "$d_mb" "$d_cpu"
  printf "  %-12s %-7s %-9s %s\n" "E-commerce" "$e_n" "$e_mb" "$e_cpu"
  printf "  %-12s %-7s %-9s\n" "TOTAL" "$((d_n + e_n))" "$chrome_mb"

  if [ "$d_n" = "0" ]; then warn "Disparo: sem Chrome (sessão offline ou ainda iniciando)"; else ok "Disparo: $d_n processo(s) Chrome"; fi
  if [ "$e_n" = "0" ]; then warn "E-commerce: sem Chrome (conecte o 2º número em Conexões)"; else ok "E-commerce: $e_n processo(s) Chrome"; fi

  echo
  info "Top processos Disparo:"
  print_top_matching "$dispatch_pat" "Disparo"
  echo
  info "Top processos E-commerce:"
  print_top_matching "$ecom_pat" "E-commerce"

  # --- Pastas de sessão ---
  sec "Pastas de sessão (.wwebjs_auth)"
  local ds es bs
  ds="$(dir_size_bytes "$AUTH_ROOT/session")"
  es="$(dir_size_bytes "$AUTH_ROOT/session-ecommerce")"
  bs="$(dir_size_bytes "$AUTH_ROOT/backup")"
  echo "  session (Disparo):           $(bytes_human "$ds")"
  echo "  session-ecommerce:           $(bytes_human "$es")"
  echo "  backup/:                     $(bytes_human "$bs")"
  [ -d "$AUTH_ROOT/session" ] && ok "Pasta Disparo existe" || warn "Pasta Disparo ausente"
  [ -d "$AUTH_ROOT/session-ecommerce" ] && ok "Pasta E-commerce existe" || info "Pasta E-commerce ainda não criada (normal antes do 1º login)"

  # --- API status ---
  sec "WhatsApp API"
  local health status
  health="$(curl -s --max-time 5 "$BASE_URL/api/health" 2>/dev/null || true)"
  status="$(curl -s --max-time 5 "$BASE_URL/api/status" 2>/dev/null || true)"

  if [ -z "$health" ]; then
    err "API /api/health sem resposta ($BASE_URL)"
  else
    local okv wd we busy
    okv="$(json_field "$health" "ok")"
    wd="$(json_field "$health" "whatsappDispatch")"
    [ -z "$wd" ] && wd="$(json_field "$health" "whatsapp")"
    we="$(json_field "$health" "whatsappEcommerce")"
    busy="$(json_field "$status" "sendInProgress")"
    [ "$okv" = "true" ] && ok "Health ok=true" || err "Health ok=$okv"
    [ "$wd" = "connected" ] && ok "Disparo: $wd" || warn "Disparo: ${wd:-desconhecido}"
    [ "$we" = "connected" ] && ok "E-commerce: $we" || warn "E-commerce: ${we:-desconhecido}"
    if [ "$busy" = "true" ]; then
      warn "Há disparo/agendamento em andamento (sendInProgress=true)"
    else
      info "Nenhum disparo em andamento"
    fi
  fi

  # --- Veredito ---
  sec "Veredito rápido"
  verdict_ram "${avail_mb:-0}" "$chrome_mb"
  if [ "${d_n:-0}" != "0" ] && [ "${e_n:-0}" != "0" ] && [ "${avail_mb:-0}" -ge 800 ]; then
    ok "Ambiente parece apto para teste controlado (1–3 grupos) com Texto separado."
  elif [ "${d_n:-0}" != "0" ] && [ "${avail_mb:-0}" -ge 500 ]; then
    info "Disparo ok para teste; conecte o E-commerce quando for validar o CRM."
  else
    warn "Antes de disparo oficial: garanta Disparo conectado e RAM livre > ~800 MB."
  fi

  echo
  info "Dica: teste real = 1–3 grupos, Texto separado, imagem+texto+áudio."
  info "Watch: ./scripts/perf-check.sh --watch"
  echo "=============================================="
}

if [ "$WATCH" = "1" ]; then
  while true; do
    run_once
    sleep "$INTERVAL"
  done
else
  run_once
fi
