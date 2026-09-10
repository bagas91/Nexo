#!/usr/bin/env bash
# Bootstrap Nexo / ZapFlow em uma VPS nova (ou reinstalar).
#
# Uso:
#   ./scripts/bootstrap-vps.sh
#   ./scripts/bootstrap-vps.sh --skip-build      # só deps + pm2
#   ./scripts/bootstrap-vps.sh --no-pm2          # não sobe PM2 (só install+build)
#   ./scripts/bootstrap-vps.sh --env-only        # só cria server/.env a partir do example
#
# Depois: edite server/.env, abra http://IP:3001 e escaneie o QR.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

SKIP_BUILD=0
NO_PM2=0
ENV_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-pm2) NO_PM2=1 ;;
    --env-only) ENV_ONLY=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $arg (use --help)"
      exit 1
      ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok() { echo -e "${GREEN}OK${NC}  $*"; }
warn() { echo -e "${YELLOW}WARN${NC} $*"; }
err() { echo -e "${RED}ERR${NC}  $*"; }
info() { echo -e "${BLUE}INFO${NC} $*"; }
die() { err "$*"; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Comando obrigatório não encontrado: $1"
}

echo ""
info "Nexo bootstrap — pasta: $PROJECT_ROOT"
echo ""

# --- Pré-requisitos ---
need_cmd node
need_cmd npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  die "Node.js 18+ necessário (atual: $(node -v))"
fi
ok "Node $(node -v)"

if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "ffmpeg não encontrado — conversão de áudio (OGG) pode falhar. Instale: sudo apt install ffmpeg"
else
  ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  if [[ "$NO_PM2" -eq 1 ]]; then
    warn "pm2 não instalado (ok com --no-pm2)"
  else
    info "Instalando pm2 globalmente…"
    npm install -g pm2
    ok "pm2 instalado"
  fi
else
  ok "pm2 $(pm2 -v 2>/dev/null || echo '?')"
fi

# --- .env ---
ENV_FILE="$PROJECT_ROOT/server/.env"
ENV_EXAMPLE="$PROJECT_ROOT/server/.env.example"

if [[ ! -f "$ENV_EXAMPLE" ]]; then
  die "Falta server/.env.example"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "Criado server/.env a partir do .env.example"
  warn "Edite server/.env agora: ADMIN_PASS, AUTH_SECRET, GEMINI_API_KEY, etc."
else
  ok "server/.env já existe (não sobrescrito)"
fi

if [[ "$ENV_ONLY" -eq 1 ]]; then
  info "Modo --env-only: fim."
  exit 0
fi

# --- Dependências ---
info "Instalando dependências (frontend + backend)…"
npm run install:all
ok "Dependências instaladas"

# --- Build frontend ---
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  warn "Pulando build (--skip-build)"
else
  info "Build do frontend (vite)…"
  npm run build
  ok "Build concluído → dist/"
fi

# --- PM2 ---
if [[ "$NO_PM2" -eq 1 ]]; then
  warn "PM2 não iniciado (--no-pm2). Depois: npm run pm2:start"
else
  if [[ ! -f "$PROJECT_ROOT/ecosystem.config.cjs" ]]; then
    die "Falta ecosystem.config.cjs"
  fi

  if pm2 describe zapflow-backend >/dev/null 2>&1; then
    info "App já existe no PM2 — reload…"
    pm2 reload ecosystem.config.cjs --update-env --kill-timeout 30000 || pm2 restart zapflow-backend --update-env --kill-timeout 30000
    ok "zapflow-backend recarregado"
  else
    info "Subindo zapflow-backend (instances=1)…"
    pm2 start ecosystem.config.cjs
    ok "zapflow-backend iniciado"
  fi

  pm2 save >/dev/null 2>&1 || true
  ok "pm2 save"

  echo ""
  info "Para subir automaticamente após reboot, rode uma vez:"
  echo "  pm2 startup"
  echo "  # execute o comando que o pm2 imprimir (sudo …)"
  echo "  pm2 save"
fi

# --- Resumo ---
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-SEU_IP}"

echo ""
echo "=============================================="
ok "Bootstrap concluído"
echo "=============================================="
echo ""
echo "  1. Confira o .env:"
echo "       nano server/.env"
echo ""
echo "  2. Abra o painel:"
echo "       http://${IP}:3001"
echo "       http://127.0.0.1:3001"
echo ""
echo "  3. Login (ADMIN_USER / ADMIN_PASS do .env)"
echo "  4. Conexões → escanear QR do WhatsApp"
echo "  5. Integrações Bling/Woo (se usar)"
echo ""
echo "  Logs:     pm2 logs zapflow-backend"
echo "  Status:   pm2 status"
echo "  Reload:   npm run pm2:reload"
echo "  Ops WA:   veja OPS-SESSION.md"
echo ""
echo "  Nginx/HTTPS: veja DEPLOY.md + proxy para :3001"
echo "=============================================="
echo ""
