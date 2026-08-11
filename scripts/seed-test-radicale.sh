#!/usr/bin/env sh
# Non-interactive test-stack seed for docker-compose.test.radicale.yml.
# Runs inside the tomsquest/docker-radicale container, before Radicale starts.
#
# What it does:
#   1. Writes /config/config with Basic auth via a plaintext htpasswd file
#   2. Writes the testuser credentials
#   3. Declares the same two collections the Baikal seeder creates, so the
#      integration and e2e suites are identical across both servers
#
# This is deliberately much smaller than scripts/seed-test-baikal.sh: Radicale needs no
# database bootstrap, no schema file, and no install-wizard suppression. The
# collections are declared rather than inserted — Radicale creates them from
# `predefined_collections` on the user's first authenticated request, so we never
# touch its on-disk storage format.
#
# Expected environment:
#   CONFIG_DIR  Radicale config directory inside the container (default /config)

set -eu

CONFIG_DIR="${CONFIG_DIR:-/config}"
CONFIG_PATH="$CONFIG_DIR/config"
USERS_PATH="$CONFIG_DIR/users"

USERNAME="testuser"
PASSWORD="testpass"

echo "==> Seeding Radicale test config"

mkdir -p "$CONFIG_DIR"

# htpasswd_encryption = plain keeps this readable and avoids needing an htpasswd
# binary (the image has none) or a hashing round-trip. Fine for a throwaway test
# server that is never exposed beyond the compose network.
cat > "$USERS_PATH" <<EOF
${USERNAME}:${PASSWORD}
EOF

# Collection names and display names mirror scripts/seed-test-baikal.sh so no test needs
# to know which server it is talking to.
#
# supported-calendar-component-set is set explicitly even though Radicale already
# advertises all three component types by default — being explicit keeps the two
# seeders describing the same calendar rather than relying on a server default.
cat > "$CONFIG_PATH" <<'EOF'
[server]
hosts = 0.0.0.0:5232

[auth]
type = htpasswd
htpasswd_filename = /config/users
htpasswd_encryption = plain

[rights]
type = owner_only

[storage]
type = multifilesystem
filesystem_folder = /data/collections
predefined_collections = {"personal": {"D:displayname": "Personal", "C:supported-calendar-component-set": "VEVENT,VJOURNAL,VTODO", "tag": "VCALENDAR"}, "contacts": {"D:displayname": "Contacts", "tag": "VADDRESSBOOK"}}

[logging]
level = info
EOF

echo "   Config written: $CONFIG_PATH"
echo "   Users written:  $USERS_PATH"

# Radicale runs as the unprivileged 'radicale' user; this script runs as root.
chown -R radicale:radicale "$CONFIG_DIR" 2>/dev/null || true

echo ""
echo "==> Radicale test seed complete."
echo "    Username : ${USERNAME}"
echo "    Password : ${PASSWORD}"
echo "    Radicale : http://localhost:8802"
