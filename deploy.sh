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
# Every compendium the manifest lists must have arrived whole, or nothing is replaced.
check_packs() {
  local dir="$1" bad=0 n=0
  for p in $(grep -o '"path": *"packs/[^"]*"' "$dir/system.json" | grep -o 'packs/[^"]*'); do
    n=$((n + 1))
    if [ ! -f "$dir/$p/CURRENT" ] || ! ls "$dir/$p"/MANIFEST-* >/dev/null 2>&1; then
      echo "Compendium $p is missing or incomplete in $dir"
      bad=1
    fi
  done
  [ "$n" -gt 0 ] || { echo "No compendiums listed in $dir/system.json"; bad=1; }
  [ "$bad" = 0 ] && echo "Compendiums present: $n"
  return "$bad"
}
check_packs "$STAGE/$SYSTEM" || { echo "Not installed: the zip's compendiums are incomplete."; exit 1; }
sudo systemctl stop "$SERVICE"
if [ -d "${SYSTEMS:?}/${SYSTEM:?}" ]; then
  OLD=$(grep -o '"version": *"[^"]*"' "$SYSTEMS/$SYSTEM/system.json" | grep -o '[0-9][^"]*' || echo unknown)
  mv "${SYSTEMS:?}/${SYSTEM:?}" "${BACKUPS:?}/${SYSTEM:?}-$OLD-$(date +%Y%m%d%H%M%S)"
  echo "Previous version $OLD kept in $BACKUPS"
fi
mv "${STAGE:?}/${SYSTEM:?}" "${SYSTEMS:?}/${SYSTEM:?}"
rmdir "$STAGE"
check_packs "${SYSTEMS:?}/${SYSTEM:?}" || echo "WARNING: compendiums incomplete after install; run ./deploy.sh --rollback"
rm -f "${ZIP:?}"
sudo systemctl start "$SERVICE"
sleep 3
systemctl is-active "$SERVICE" >/dev/null && echo "Foundry restarted with $(grep -o '"version": *"[^"]*"' "$SYSTEMS/$SYSTEM/system.json")"
# Keep the five most recent backups.
ls -1dt "${BACKUPS:?}/${SYSTEM:?}"-* 2>/dev/null | tail -n +6 | xargs -r rm -rf
REMOTE
