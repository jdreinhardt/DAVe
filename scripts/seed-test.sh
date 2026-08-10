#!/usr/bin/env sh
# Non-interactive test-stack seed for docker-compose.test.yml.
# Runs inside the ckulka/baikal:*-nginx container.
#
# What it does:
#   1. Writes config/baikal.yaml with Basic auth so tsdav can authenticate
#   2. Creates the SQLite database from Baikal's own schema
#   3. Seeds testuser / testpass with a calendar + address book
#   4. Marks the install as complete so /admin/install doesn't intercept
#
# Everything is done offline against the shared volumes — we deliberately do not
# drive Baikal's web installer, which needs a browser session and silently 500s
# when the config schema doesn't match the version.
#
# Expected environment:
#   BAIKAL_ROOT  Baikal install root inside the container (default /var/www/baikal)

set -eu

BAIKAL_ROOT="${BAIKAL_ROOT:-/var/www/baikal}"
CONFIG_PATH="$BAIKAL_ROOT/config/baikal.yaml"
DB_PATH="$BAIKAL_ROOT/Specific/db/db.sqlite"
SCHEMA_PATH="$BAIKAL_ROOT/Core/Resources/Db/SQLite/db.sql"

USERNAME="testuser"
PASSWORD="testpass"
DISPLAY_NAME="Test User"
EMAIL="test@example.com"
ADMIN_PASSWORD="admin"
# Baked into every user's digesta1 hash, so it must match the config below.
AUTH_REALM="BaikalDAV"

# Read the version out of the image rather than hardcoding it: Baikal shows its
# upgrade wizard (and refuses DAV requests) when configured_version disagrees.
BAIKAL_VERSION=$(php -r "require '$BAIKAL_ROOT/Core/Distrib.php'; echo BAIKAL_VERSION;")
echo "==> Seeding Baikal $BAIKAL_VERSION"

echo "==> Writing config with Basic auth..."
mkdir -p "$(dirname "$CONFIG_PATH")"
ADMIN_HASH=$(php -r "echo password_hash('$ADMIN_PASSWORD', PASSWORD_BCRYPT);")

# Section names and keys are those of Baikal\Model\Config\{Standard,Database}.
# Basic (not the default Digest) because tsdav authenticates with Basic.
cat > "$CONFIG_PATH" <<YAML
system:
    configured_version: '$BAIKAL_VERSION'
    timezone: 'UTC'
    card_enabled: true
    cal_enabled: true
    dav_auth_type: 'Basic'
    admin_passwordhash: '$ADMIN_HASH'
    failed_access_message: 'user %u authentication failure for Baikal'
    auth_realm: '$AUTH_REALM'
    base_uri: ''
    invite_from: 'noreply@example.com'
database:
    backend: 'sqlite'
    sqlite_file: '$DB_PATH'
    encryption_key: ''
YAML
echo "   Config written: $CONFIG_PATH"

echo "==> Creating database from Baikal's schema..."
mkdir -p "$(dirname "$DB_PATH")"
if [ -s "$DB_PATH" ]; then
  echo "   Database already exists, leaving it alone: $DB_PATH"
else
  sqlite3 "$DB_PATH" < "$SCHEMA_PATH"
  echo "   Database created: $DB_PATH"
fi

echo "==> Seeding test user '$USERNAME'..."
# digesta1 = md5("username:realm:password"), which is what PDOBasicAuth compares against.
DIGEST=$(php -r "echo md5('${USERNAME}:${AUTH_REALM}:${PASSWORD}');")

# Since 0.9 a calendar is split in two: `calendars` holds the shared properties
# and `calendarinstances` the per-principal ones. access=1 means owner.
sqlite3 "$DB_PATH" <<SQL
INSERT OR IGNORE INTO users (username, digesta1)
  VALUES ('${USERNAME}', '${DIGEST}');

INSERT OR IGNORE INTO principals (uri, email, displayname)
  VALUES ('principals/${USERNAME}', '${EMAIL}', '${DISPLAY_NAME}');

INSERT OR IGNORE INTO calendars (id, synctoken, components)
  VALUES (1, 1, 'VEVENT,VTODO,VJOURNAL');

INSERT OR IGNORE INTO calendarinstances
    (calendarid, principaluri, access, displayname, uri, description,
     calendarorder, calendarcolor, timezone, transparent)
  VALUES
    (1, 'principals/${USERNAME}', 1, 'Personal', 'personal', '',
     0, '#0082C9', 'America/New_York', 0);

INSERT OR IGNORE INTO addressbooks (principaluri, displayname, uri, description, synctoken)
  VALUES ('principals/${USERNAME}', 'Contacts', 'contacts', '', 1);
SQL

# The installer only steps aside once this marker exists.
touch "$BAIKAL_ROOT/Specific/INSTALL_DISABLED"

# We ran as root; hand everything back to the web user or Baikal can't write.
chown -R nginx:nginx "$BAIKAL_ROOT/config" "$BAIKAL_ROOT/Specific" 2>/dev/null || true

echo ""
echo "==> Test Baikal seed complete."
echo "    Username : ${USERNAME}"
echo "    Password : ${PASSWORD}"
echo "    Baikal   : http://localhost:8801/dav.php"
