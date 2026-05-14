#!/usr/bin/env bash
# Seed a local Baikal instance (docker-compose.dev.yml) with a test user,
# one address book, and one calendar so the app has data to render immediately.
#
# Prerequisites:
#   1. docker compose -f docker-compose.dev.yml up -d
#   2. Complete the Baikal first-run wizard at http://localhost:8800/admin/
#      (set an admin password, then "Save changes" on the system config page).
#   3. Run this script: ./scripts/seed.sh
#
# The test credentials written by this script:
#   Username: testuser
#   Password: testpass
#
# The script installs sqlite3 inside the baikal container temporarily (apk add).
# That package is not persisted across container restarts — it's just for seeding.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
USERNAME="testuser"
PASSWORD="testpass"
DISPLAY_NAME="Test User"
EMAIL="test@example.com"
DB_PATH="/var/www/baikal/Specific/db.sqlite"

echo "==> Waiting for Baikal HTTP to be ready..."
until curl -sf http://localhost:8800/ > /dev/null 2>&1; do
  printf '.'
  sleep 2
done
echo " ready."

echo "==> Installing sqlite3 in the Baikal container..."
docker compose -f "$COMPOSE_FILE" exec baikal apk add -q sqlite

echo "==> Waiting for Baikal database to be initialised..."
# The database is created on first request to the admin wizard.
# If it doesn't exist yet, prompt the user.
until docker compose -f "$COMPOSE_FILE" exec baikal test -f "$DB_PATH" 2>/dev/null; do
  echo "    Database not found yet. Have you completed the Baikal setup wizard"
  echo "    at http://localhost:8800/admin/ ?"
  echo "    Waiting 5 seconds..."
  sleep 5
done

# digesta1 is md5("username:BaikalDAV:password") — used for HTTP Basic/Digest auth.
HASH=$(docker compose -f "$COMPOSE_FILE" exec -T baikal \
  sh -c "printf '%s' '${USERNAME}:BaikalDAV:${PASSWORD}' | md5sum | cut -d' ' -f1" \
  | tr -d '\r\n')

echo "==> Creating test user '${USERNAME}' (password: '${PASSWORD}')..."

docker compose -f "$COMPOSE_FILE" exec -T baikal sqlite3 "$DB_PATH" <<SQL
INSERT OR IGNORE INTO users (username, digesta1, displayname)
  VALUES ('${USERNAME}', '${HASH}', '${DISPLAY_NAME}');

INSERT OR IGNORE INTO principals (uri, email, displayname)
  VALUES ('principals/${USERNAME}', '${EMAIL}', '${DISPLAY_NAME}');

INSERT OR IGNORE INTO calendars
    (principaluri, displayname, uri, description,
     calendarorder, calendarcolor, timezone, components, transparent, synctoken)
  VALUES
    ('principals/${USERNAME}', 'Personal', 'personal', '',
     0, '#0082C9', 'America/New_York', 'VEVENT', 0, 1);

INSERT OR IGNORE INTO addressbooks (principaluri, displayname, uri, description, synctoken)
  VALUES ('principals/${USERNAME}', 'Contacts', 'contacts', '', 1);
SQL

echo ""
echo "✓ Seed complete."
echo ""
echo "  Test account:"
echo "    Username : ${USERNAME}"
echo "    Password : ${PASSWORD}"
echo ""
echo "  URLs:"
echo "    App (frontend)    : http://localhost:5173"
echo "    App (API)         : http://localhost:3000"
echo "    Baikal admin      : http://localhost:8800/admin/"
echo "    Baikal DAV        : http://localhost:8800/dav.php"
echo ""
echo "  To copy existing DAV data into the test instance for richer testing:"
echo "    docker compose -f ${COMPOSE_FILE} cp /path/to/your.vcf baikal:/tmp/"
echo "    docker compose -f ${COMPOSE_FILE} exec baikal ..."
