#!/bin/bash
# Verifica em quais grupos um número participa (útil para achar "qual grupo tem meu número").
# Uso: ./scripts/verify-groups-with-number.sh [NÚMERO]
# Ex.: ./scripts/verify-groups-with-number.sh 5511915266397

cd "$(dirname "$0")/.." || exit 1

NUMBER="${1:-}"
if [ -z "$NUMBER" ]; then
    echo "Uso: $0 <número>"
    echo "Ex.: $0 5511915266397"
    exit 1
fi

# Opcional: se tiver API_KEY no .env do server, carregue para usar na requisição
if [ -f server/.env ]; then
    export $(grep -v '^#' server/.env | xargs)
fi

URL="http://localhost:3001/api/chats/groups-containing-number?number=$NUMBER"
CURL_OPTS=(-s "$URL")
if [ -n "$API_KEY" ]; then
    CURL_OPTS+=(-H "X-API-Key: $API_KEY")
fi

echo "Verificando grupos que contêm o número: $NUMBER"
echo ""

RESP=$(curl "${CURL_OPTS[@]}")
if ! echo "$RESP" | head -c1 | grep -q '{'; then
    echo "Erro: resposta inválida do servidor (servidor está rodando e WhatsApp conectado?)"
    echo "$RESP"
    exit 1
fi

if command -v jq >/dev/null 2>&1; then
    ERR=$(echo "$RESP" | jq -r '.error // empty')
    if [ -n "$ERR" ]; then
        echo "Erro do servidor: $ERR"
        exit 1
    fi
    echo "Sua conta (número conectado): $(echo "$RESP" | jq -r '.myNumber // "?"')"
    echo "Grupos onde esse número participa: $(echo "$RESP" | jq -r '.groups | length')"
    echo ""
    echo "$RESP" | jq -r '.groups[]? | "  • \(.name // "(sem nome)") — id: \(.id)"' 2>/dev/null || true
    [ "$(echo "$RESP" | jq -r '.groups | length')" = "0" ] && echo "  Nenhum grupo encontrado com esse número."
else
    echo "Resposta (instale 'jq' para formatação melhor):"
    echo "$RESP"
fi
