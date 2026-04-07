#!/usr/bin/env bash
# start-demo.sh — запускает только ngrok и обновляет .env
# Сервер и фронт запускаются отдельно через: npm run dev
#
# Использование: bash start-demo.sh

set -euo pipefail

NGROK="/c/Users/User/AppData/Local/Microsoft/WinGet/Packages/Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe/ngrok.exe"
SERVER_PORT=3001
ENV_FILE="$(dirname "$0")/server/.env"

echo "═══════════════════════════════════════════════════"
echo "  Triangle Demo — ngrok туннель"
echo "═══════════════════════════════════════════════════"

# Убиваем старые ngrok процессы
pkill -f "ngrok http" 2>/dev/null || true
sleep 1

# Стартуем ngrok в фоне
echo "→ Запуск ngrok на порту $SERVER_PORT..."
"$NGROK" http "$SERVER_PORT" --log stdout > /tmp/ngrok-demo.log 2>&1 &
NGROK_PID=$!

# Ждём туннель
URL=""
for i in $(seq 1 10); do
  sleep 1
  URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | node -e "
    const c=[]; process.stdin.on('data',d=>c.push(d)); process.stdin.on('end',()=>{
      try { const d=JSON.parse(Buffer.concat(c)); const t=d.tunnels?.find(t=>t.proto==='https'); console.log(t?.public_url||''); } catch{}
    })" 2>/dev/null || echo "")
  [ -n "$URL" ] && break
done

if [ -z "$URL" ]; then
  echo "ERROR: не удалось получить ngrok URL. Проверь /tmp/ngrok-demo.log"
  exit 1
fi

echo "✓ ngrok: $URL"

# Обновляем PUBLIC_SERVER_URL в .env
if grep -q "PUBLIC_SERVER_URL=" "$ENV_FILE"; then
  sed -i "s|PUBLIC_SERVER_URL=.*|PUBLIC_SERVER_URL=$URL|" "$ENV_FILE"
else
  echo "PUBLIC_SERVER_URL=$URL" >> "$ENV_FILE"
fi
echo "✓ .env обновлён"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Публичный URL:  $URL"
echo "  Webhook:        $URL/api/escrow-webhook"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Теперь в другом терминале запусти:"
echo "    npm run dev"
echo ""
echo "  Фронт: http://localhost:5173"
echo "  Сервер: http://localhost:3001"
echo ""
echo "  ngrok работает (PID $NGROK_PID). Этот терминал можно закрыть."
