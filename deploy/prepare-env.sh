#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
target_env=${1:-.env.demo}
case "$target_env" in .env|.env.demo) ;; *) echo 'Use .env or .env.demo' >&2; exit 1;; esac
if [ -e "$target_env" ]; then
    echo "$target_env already exists; keeping current passwords."
    exit 0
fi
umask 077
# Hex values are safe in the PostgreSQL connection URI.
db_password=$(openssl rand -hex 32)
app_password=$(openssl rand -hex 32)
(set -C; printf 'POSTGRES_PASSWORD=%s\nDASHBOARD_PASSWORD=%s\nDEMO_HTTP_PORT=80\n' "$db_password" "$app_password" > "$target_env")
echo "Created $target_env with separate random database passwords."
