#!/bin/sh
# Run by systemd on the demo host. Private keys never leave /etc/letsencrypt.
set -eu
cd /opt/manufacturing-demo
exec 9>/run/lock/manufacturing-demo-tls.lock
flock -n 9 || exit 0
certificate=/etc/letsencrypt/live/manufacturing-demo-ip/fullchain.pem
docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/lib/letsencrypt:/var/lib/letsencrypt \
    -v /var/log/letsencrypt:/var/log/letsencrypt \
    -v /opt/manufacturing-demo/acme:/var/www/certbot \
    certbot/certbot:v5.4.0 renew --cert-name manufacturing-demo-ip --non-interactive "$@"
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.release.json -f compose.https.yaml exec -T web nginx -t
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.release.json -f compose.https.yaml exec -T web nginx -s reload
# Exits nonzero if renewal stops succeeding and less than two days remain.
openssl x509 -checkend 172800 -noout -in "$certificate"
