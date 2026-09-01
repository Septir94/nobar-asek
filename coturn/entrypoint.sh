#!/bin/sh
# coturn entrypoint — substitute env vars into config then start turnserver
# This replaces ${TURN_SECRET}, ${TURN_REALM}, ${EXTERNAL_IP} in the template.

set -e

CONF_TEMPLATE="/etc/coturn/turnserver.conf"
CONF_OUT="/tmp/turnserver.conf"

# Perform envsubst on the config template
envsubst < "$CONF_TEMPLATE" > "$CONF_OUT"

echo "[coturn] Starting coturn with resolved config:"
cat "$CONF_OUT"

exec turnserver -c "$CONF_OUT" "$@"
