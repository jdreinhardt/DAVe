# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately via GitHub:
[**Security → Report a vulnerability**](https://github.com/jdreinhardt/dave/security/advisories/new).

Include what you can: affected version or image digest, deployment method (Docker / bare Node),
DAV server behind DAVe, reproduction steps, and impact. Do **not** include real credentials or
personal calendar/contact data in a report.

This is a solo-maintained project — reports are handled on a best-effort basis. You'll get an
acknowledgment as soon as the report is seen, and a fix or mitigation plan follows triage.
Please allow a reasonable window for a fix before public disclosure.

## Supported versions

Only the latest release (and the `latest` image at `ghcr.io/jdreinhardt/dave`) receives security
fixes. There are no backports to older versions — upgrade to the current release.

## Scope — what matters most

DAVe proxies DAV traffic and stores encrypted credentials, so reports in these areas are
especially valuable:

- **Credential handling** — DAV credentials are AES-256-GCM encrypted at rest
  (`sessions.sqlite`) and must never appear in logs, error responses, or API output.
- **Session lifecycle** — cookie handling, session fixation/expiry, the sliding TTL.
- **The backend DAV proxy** — anything that lets a browser or request reach an unintended
  host or collection through the proxy (SSRF, path traversal into another user's data).
- **Cross-user isolation** — any way for one authenticated user to read another user's
  cached entries, settings, or collections.
- **Login rate limiting** — bypasses of the per-IP throttle, including via header spoofing
  when `TRUST_PROXY` is set.
- **OIDC sign-in** — anything that lets a browser choose the username DAVe sends in the
  trusted user header (`DAV_REMOTE_USER_HEADER`), skip ID-token, state, nonce or PKCE
  validation, or reuse a sign-in transaction.

## OIDC and trusted-header DAV servers

OIDC sign-in exists for deployments where the DAV server is configured to trust a user header
from DAVe — for example Radicale with `[auth] type = http_x_remote_user`, typically as a second
instance next to the Basic-auth one that desktop and mobile clients use (see README
"OIDC sign-in"). In that mode DAVe sends `X-Remote-User: <username>` taken from the verified ID
token, and never forwards that header from the browser.

Such a DAV endpoint authenticates **whoever can reach it**. Keeping it reachable only from DAVe
(a private network, never the internet or a shared reverse proxy) is a deployment requirement,
not something DAVe can enforce. Reports that reduce to "the header-trusting DAV server accepts
the header from anyone who can reach it" describe a misdeployment, not a DAVe vulnerability.

Known and accepted by design (see README "Data at rest"): `cache.db` stores synced
calendar/task/note content unencrypted at the application layer — disk/volume encryption is
the deployment's responsibility. Reports that reduce to "cache.db is plaintext" are expected
behavior, not vulnerabilities.
