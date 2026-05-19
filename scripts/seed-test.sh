#!/usr/bin/env sh
# Non-interactive test-stack seed for docker-compose.test.yml.
# Runs inside the ckulka/baikal:nginx container.
#
# What it does:
#   1. Installs sqlite3 (alpine apk)
#   2. Writes baikal.yaml with Basic auth so tsdav can authenticate
#   3. Triggers DB initialisation via a curl request to the Baikal admin endpoint
#   4. Seeds testuser / testpass with a calendar + address book via sqlite3
#
# Expected environment:
#   BAIKAL_INTERNAL_URL  URL visible from within the Docker network (default http://baikal/dav.php)

set -eu

BAIKAL_INTERNAL_URL="${BAIKAL_INTERNAL_URL:-http://baikal/}"
DB_PATH="/var/www/baikal/Specific/db.sqlite"
CONFIG_DIR="/var/www/baikal/config"
CONFIG_PATH="$CONFIG_DIR/baikal.yaml"

USERNAME="testuser"
PASSWORD="testpass"
DISPLAY_NAME="Test User"
EMAIL="test@example.com"

echo "==> Installing sqlite3..."
apk add -q sqlite

echo "==> Writing Baikal config with Basic auth..."
mkdir -p "$CONFIG_DIR"

# Compute a bcrypt hash for the admin password using PHP (available in this image).
ADMIN_HASH=$(php -r "echo password_hash('admin', PASSWORD_BCRYPT);")

cat > "$CONFIG_PATH" <<YAML
baikal:
    parameters:
        admin_passwordhash: '$ADMIN_HASH'
        auth_realm: 'BaikalDAV'
        auth_type: 'Basic'
        invite_from: ''
        timezone: 'UTC'
        card_enabled: 'true'
        cal_enabled: 'true'
        dav_route: '/dav.php'
        base_uri: ''
YAML

echo "   Config written: $CONFIG_PATH"

echo "==> Triggering Baikal database initialisation..."
# The first authenticated request to the admin area runs migrations.
# We request the admin login page; the status code doesn't matter here — we just
# need Baikal to run its bootstrap/migration logic.
curl -s -o /dev/null -X GET "${BAIKAL_INTERNAL_URL%/dav.php}/admin/" || true

# Wait for the DB to appear (Baikal creates it during the first migration run).
WAITED=0
until [ -f "$DB_PATH" ]; do
  if [ "$WAITED" -ge 30 ]; then
    echo "ERROR: Baikal database not created after 30 seconds." >&2
    exit 1
  fi
  curl -s -o /dev/null "${BAIKAL_INTERNAL_URL%/dav.php}/admin/" || true
  sleep 1
  WAITED=$((WAITED + 1))
done
echo "   Database ready: $DB_PATH"

echo "==> Seeding test user '$USERNAME'..."
# digesta1 = md5("username:BaikalDAV:password") — used by Baikal for Basic auth verification
HASH=$(php -r "echo md5('${USERNAME}:BaikalDAV:${PASSWORD}');")

sqlite3 "$DB_PATH" <<SQL
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
echo "==> Test Baikal seed complete."
echo "    Username : ${USERNAME}"
echo "    Password : ${PASSWORD}"
echo "    Baikal   : http://localhost:8801/dav.php"
