#!/usr/bin/env sh
# Self-signed cert for the mock OIDC provider in docker-compose.test.radicale-oidc.yml.
#
# Needed because openid-client v6 refuses a plain-http issuer, so the mock has to
# serve HTTPS even locally. DAVe trusts this cert via NODE_EXTRA_CA_CERTS and the
# Playwright browser via `ignoreHTTPSErrors` — neither trusts it system-wide.
#
# Regenerates only when missing, so repeated `npm run stack:oidc` is cheap. The
# output directory is gitignored: a committed private key, even a throwaway one,
# is the kind of thing that gets flagged by every secret scanner forever.
#
# SAN covers localhost and 127.0.0.1 because the issuer URL has to be identical
# for DAVe (server-side token exchange) and the browser (redirect target).

set -eu

DIR="${1:-.test-oidc-certs}"
CERT="$DIR/cert.pem"
KEY="$DIR/key.pem"

if [ -s "$CERT" ] && [ -s "$KEY" ]; then
  echo "==> OIDC test cert already present in $DIR"
  exit 0
fi

mkdir -p "$DIR"
echo "==> Generating a self-signed cert for the mock OIDC provider in $DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY" -out "$CERT" -days 3650 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  >/dev/null 2>&1

# The provider container runs unprivileged and only needs to read these.
chmod 644 "$CERT" "$KEY"

echo "    cert: $CERT"
echo "    key:  $KEY"
