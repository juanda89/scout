#!/bin/bash
# Despliega (o actualiza) Scout en la instancia Lightsail. Uso: deploy/lightsail/deploy.sh <ip> [ruta a .env.prod]
set -euo pipefail
IP="${1:?ip de la instancia}"; ENVFILE="${2:-.env.prod}"
KEY="${SCOUT_SSH_KEY:-$HOME/.ssh/scout-lightsail.pem}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new ubuntu@$IP"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$ENVFILE" "ubuntu@$IP:/opt/scout/.env.prod"
$SSH 'set -e; cd /opt/scout && git pull --ff-only && set -a && . ./.env.prod && set +a && docker compose -f docker-compose.prod.yml up -d --build --remove-orphans && docker image prune -f >/dev/null && docker compose -f docker-compose.prod.yml ps'
