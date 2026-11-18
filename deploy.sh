#!/usr/bin/env bash
# Installs a built zip on the Foundry server and restarts Foundry (players are disconnected).
#
#   ./deploy.sh dist/modulus-v<version>.zip     install it; the system it replaces is kept as a backup
#   ./deploy.sh --rollback                      put the most recent backup back
#
# Server details come from deploy.local.conf (not committed; see deploy.local.conf.example):
#   DEPLOY_HOST=bellows                       an ssh host or alias
#   DEPLOY_DATA=/home/forge/foundrydata       Foundry's data path (--dataPath in the service)
#   DEPLOY_SERVICE=foundry                    the systemd service (the user may restart it without a password)
#   DEPLOY_BACKUPS=/home/forge/modulus-backups
set -euo pipefail
cd "$(dirname "$0")"

SYSTEM=modulus
CONF=deploy.local.conf
[ -f "$CONF" ] || { echo "$CONF is missing (copy deploy.local.conf.example)" >&2; exit 1; }
# shellcheck disable=SC1090
source "$CONF"
: "${DEPLOY_HOST:?set in $CONF}" "${DEPLOY_DATA:?set in $CONF}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-foundry}"
DEPLOY_BACKUPS="${DEPLOY_BACKUPS:-backups/$SYSTEM}"
SYSTEMS="$DEPLOY_DATA/Data/systems"

if [ "${1:-}" = "--rollback" ]; then
  ssh "$DEPLOY_HOST" "SYSTEM='$SYSTEM' SYSTEMS='$SYSTEMS' BACKUPS='$DEPLOY_BACKUPS' SERVICE='$DEPLOY_SERVICE' bash -s" <<'REMOTE'
set -euo pipefail
: "${SYSTEM:?}" "${SYSTEMS:?}" "${BACKUPS:?}" "${SERVICE:?}"
LAST=$(ls -1dt "${BACKUPS:?}/${SYSTEM:?}"-* 2>/dev/null | head -n1 || true)
[ -n "$LAST" ] || { echo "No backup to roll back to"; exit 1; }
echo "Rolling back to $LAST"
sudo systemctl stop "$SERVICE"
rm -rf "${SYSTEMS:?}/${SYSTEM:?}"
mv "$LAST" "${SYSTEMS:?}/${SYSTEM:?}"
sudo systemctl start "$SERVICE"
grep -o '"version": *"[^"]*"' "$SYSTEMS/$SYSTEM/system.json"
echo "Foundry restarted."
REMOTE
  exit 0
fi

ZIP="${1:-}"
[ -f "$ZIP" ] || { echo "usage: ./deploy.sh <zip> | --rollback" >&2; exit 2; }
NAME=$(basename "$ZIP")
SHA=$(sha256sum "$ZIP" | cut -d' ' -f1)

scp -q "$ZIP" "$DEPLOY_HOST:/tmp/$NAME"
ssh "$DEPLOY_HOST" "SYSTEM='$SYSTEM' ZIP='/tmp/$NAME' SHA='$SHA' SYSTEMS='$SYSTEMS' BACKUPS='$DEPLOY_BACKUPS' SERVICE='$DEPLOY_SERVICE' bash -s" <<'REMOTE'
set -euo pipefail
: "${SYSTEM:?}" "${ZIP:?}" "${SHA:?}" "${SYSTEMS:?}" "${BACKUPS:?}" "${SERVICE:?}"
echo "$SHA  $ZIP" | sha256sum -c --quiet
unzip -l "$ZIP" "$SYSTEM/system.json" >/dev/null || { echo "$ZIP has no $SYSTEM/system.json"; exit 1; }
mkdir -p "$BACKUPS"
STAGE=$(mktemp -d)
unzip -q "$ZIP" -d "$STAGE"
sudo systemctl stop "$SERVICE"
if [ -d "${SYSTEMS:?}/${SYSTEM:?}" ]; then
  OLD=$(grep -o '"version": *"[^"]*"' "$SYSTEMS/$SYSTEM/system.json" | grep -o '[0-9][^"]*' || echo unknown)
  mv "${SYSTEMS:?}/${SYSTEM:?}" "${BACKUPS:?}/${SYSTEM:?}-$OLD-$(date +%Y%m%d%H%M%S)"
  echo "Previous version $OLD kept in $BACKUPS"
fi
mv "${STAGE:?}/${SYSTEM:?}" "${SYSTEMS:?}/${SYSTEM:?}"
rmdir "$STAGE"
rm -f "${ZIP:?}"
sudo systemctl start "$SERVICE"
sleep 3
systemctl is-active "$SERVICE" >/dev/null && echo "Foundry restarted with $(grep -o '"version": *"[^"]*"' "$SYSTEMS/$SYSTEM/system.json")"
# Keep the five most recent backups.
ls -1dt "${BACKUPS:?}/${SYSTEM:?}"-* 2>/dev/null | tail -n +6 | xargs -r rm -rf
REMOTE
