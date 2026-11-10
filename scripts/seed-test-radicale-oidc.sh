#!/usr/bin/env sh
# Seed for docker-compose.test.radicale-oidc.yml — a Radicale that identifies users by
# a trusted header instead of a password, which is what PR #4's OIDC sign-in
# needs on the DAV side.
#
# Runs inside the tomsquest/docker-radicale container, before Radicale starts.
#
# Difference from scripts/seed-test-radicale.sh: `[auth] type = http_x_remote_user`
# replaces htpasswd, so there is no users file and no password. Radicale takes the
# value of X-Remote-User as the authenticated username, with no further check.
#
# That means this server authenticates WHOEVER CAN REACH IT. The compose file
# binds it to 127.0.0.1 only for exactly that reason — do not publish it on a
# routable interface, and do not point it at real data.
#
# Collections are created from `predefined_collections` on the user's first
# request, so they appear for whatever username the identity provider supplies
# (authentik's `preferred_username` by default) without being named here.
#
# Expected environment:
#   CONFIG_DIR  Radicale config directory inside the container (default /config)

set -eu

CONFIG_DIR="${CONFIG_DIR:-/config}"
CONFIG_PATH="$CONFIG_DIR/config"

echo "==> Seeding Radicale (trusted-header auth) for OIDC preview"

mkdir -p "$CONFIG_DIR"

# Collection names and display names mirror the test seeders so the app behaves
# the same here as it does against the Baikal/Radicale test stacks.
cat > "$CONFIG_PATH" <<'EOF'
[server]
hosts = 0.0.0.0:5232

# Radicale trusts the X-Remote-User header outright. DAVe sets it from a verified
# ID token; nothing else may be able to reach this port.
[auth]
type = http_x_remote_user

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

# Radicale runs as the unprivileged 'radicale' user; this script runs as root.
chown -R radicale:radicale "$CONFIG_DIR" 2>/dev/null || true

echo ""
echo "==> OIDC preview Radicale seed complete."
echo "    Auth     : X-Remote-User header (no password)"
echo "    Reachable: 127.0.0.1:8803 only"
