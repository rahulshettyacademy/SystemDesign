#!/bin/sh
# Picks lab.conf (default) or prod.conf based on NGINX_MODE.
set -e
MODE="${NGINX_MODE:-lab}"
cp "/etc/nginx/modes/${MODE}.conf" /etc/nginx/conf.d/default.conf
mkdir -p /var/log/nginx/lab
echo "nginx mode: ${MODE}"
