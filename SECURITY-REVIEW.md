# Security Review — Snipe-IT MCP Server (Cloudflare Workers)

**Date:** 2026-03-18
**Scope:** All 11 files in the repository (fresh review of sanitized codebase)
**Overall Rating:** 9/10 — Production-ready, no blocking issues

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/worker.ts` | 1421 | MCP server, auth, HTTP client, all 30+ tools |
| `scripts/setup-secrets.js` | 133 | Interactive Secrets Store provisioning |
| `wrangler.toml` | 30 | Worker config, Secrets Store bindings |
| `env.d.ts` | 6 | TypeScript Env interface |
| `package.json` | 31 | Dependencies and scripts |
| `tsconfig.json` | 17 | TypeScript compiler config |
| `.gitignore` | 10 | Git exclusions |
| `.mcp.json` | 11 | MCP client config template |
| `.env.example` | 7 | Local dev instructions |
| `README.md` | 112 | Documentation |
| `INSTALL-PLAYBOOK.md` | 253 | Deployment guide |

---

## Security Controls — What's In Place

### 1. Authentication (PASS)

- **Bearer token required** on all MCP endpoints (`checkBearerAuth()`, line 1329)
- **Fail-closed**: if `MCP_BEARER_TOKEN` is not configured, the server returns `500` and refuses all requests (line 1331-1336)
- **Constant-time comparison** via XOR-based `timingSafeEqual()` (line 1370-1377) prevents timing side-channel attacks
- **Length check before comparison** (line 1356-1358) — short-circuits on length mismatch but this leaks no useful timing info since bearer tokens are fixed-length (64 hex chars)
- **`WWW-Authenticate: Bearer`** header returned on 401 responses per RFC 6750

### 2. SSRF Protection (PASS)

- `SnipeITClient` constructor enforces `parsed.protocol !== "https:"` (line 141) — blocks `http://`, `file://`, `ftp://`, and other schemes
- URL is parsed with `new URL()` which rejects malformed input (line 136-139)
- All outbound requests go only to `this.baseUrl` which is set once at construction time from `env.SNIPEIT_URL`

### 3. Input Validation (PASS)

- **Zod schemas** on every tool's `inputSchema` — type enforcement at the MCP protocol level
- **`InputValidator` class** provides defense-in-depth:
  - `validateId()` — positive integer only
  - `validateLimit()` — clamped 1-500
  - `validateOffset()` — non-negative integer
  - `validateSearchQuery()` — max 500 characters
  - `validateString()` — configurable max length (default 255)
  - `validateEnum()` — allowlist only
  - `validateDate()` — strict `YYYY-MM-DD` regex
- IDs are coerced to integers and interpolated into URL paths (e.g., `/api/v1/hardware/${assetId}`). Since they are validated as positive integers, there is no path traversal or injection risk.
- Query parameters use `URLSearchParams` (line 158-163) which auto-encodes values

### 4. Error Handling (PASS)

- `sanitizeError()` (line 101-123) maps errors to generic user-facing messages
- HTTP status codes from Snipe-IT are translated to safe descriptions (401, 403, 404, 422, 429, 5xx)
- Timeout/abort errors have a dedicated safe message
- **No stack traces, internal paths, or server details** are ever returned to clients
- Validation errors from `InputValidator` are surfaced (they contain only field names and constraints, no internal state)

### 5. Credential Storage (PASS)

- Production: Cloudflare Secrets Store — encrypted at rest, injected at runtime via bindings
- Local dev: `.dev.vars` file — excluded by `.gitignore`
- No credentials in source code, no `.env` files committed
- `.gitignore` excludes `.env`, `.env.*`, `.dev.vars`, `.wrangler/`

### 6. Network Security (PASS)

- **Inbound**: Cloudflare Workers enforce HTTPS by default (no HTTP listener)
- **Outbound**: HTTPS-only enforced in `SnipeITClient` constructor
- **Fetch timeout**: `AbortSignal.timeout(15_000)` on every outbound request (line 174) — prevents hung connections from consuming Worker CPU time
- **No unbounded response reading**: `resp.json()` is standard Workers API with built-in size limits

### 7. Setup Script Security (PASS)

- Uses `execFileSync` (not `execSync`) — **no shell interpolation** of user input (line 22-26)
- URL validated with `new URL()` + HTTPS-only check (line 61-72)
- API token length validated (>= 20 chars) (line 75-79)
- Bearer token auto-generated: `randomBytes(32).toString("hex")` — 256 bits of entropy (line 82)
- Store ID validated with UUID regex before use (line 48)

### 8. Health Endpoint (PASS)

- Returns only `{"status":"ok"}` — no version, no environment info, no internal state (line 1401-1403)
- Unauthenticated by design (standard practice for load balancer health checks)

---

## Dependency Audit

```
npm audit — 0 vulnerabilities found (180 packages audited)
```

| Package | Version | Purpose | Risk |
|---------|---------|---------|------|
| `@modelcontextprotocol/sdk` | ^1.26.0 | MCP protocol implementation | Low — well-maintained, pinned |
| `agents` | ^0.6.0 | Cloudflare Agents SDK (MCP handler) | Low — Cloudflare-maintained |
| `zod` | ^3.23.0 | Schema validation | Low — widely used, no known issues |
| `wrangler` | ^4.0.0 | Dev/deploy tooling (devDep) | N/A — not deployed |
| `typescript` | ^5.9.3 | Compiler (devDep) | N/A — not deployed |
| `@cloudflare/workers-types` | ^4.x | Type definitions (devDep) | N/A — not deployed |

---

## Remaining Low-Severity Items

These are informational and do not block production deployment.

### L1: No CORS Headers

**Severity:** Low
**Detail:** The MCP endpoint does not set CORS headers. This is correct for server-to-server MCP transport (Claude Desktop, Claude Code, and other MCP clients use direct HTTP, not browser fetch). If you ever need browser-based MCP clients, add `Access-Control-Allow-Origin` and preflight handling.
**Action:** None required for current use case.

### L2: No Rate Limiting

**Severity:** Low
**Detail:** The Worker does not implement its own rate limiting. Cloudflare Workers has platform-level protections (CPU time limits, automatic DDoS mitigation), and the bearer token requirement limits the attack surface to authenticated clients only.
**Action:** Consider Cloudflare Rate Limiting rules in the dashboard if abuse is observed.

### L3: McpServer Instantiated Per Request

**Severity:** Low (Performance, not security)
**Detail:** `createSnipeITMcpServer(env)` is called on every request (line 1411), re-registering all 30+ tools each time. This is functionally correct but slightly wasteful. The `env` bindings are only available in the request context on Workers, so this pattern is standard.
**Action:** No change needed. Workers are designed for this pattern.

### L4: User Password Handling

**Severity:** Low
**Detail:** The `create_user` and `update_user` tools accept a `password` field and pass it through to the Snipe-IT API over HTTPS. The password is never logged or stored by the Worker. The only exposure is in the MCP transport between the AI client and this Worker — which is also HTTPS.
**Action:** Acceptable. Password is encrypted in transit on both hops (client->Worker and Worker->Snipe-IT).

### L5: No Request Body Size Limit

**Severity:** Low
**Detail:** The Worker does not explicitly limit incoming request body size. Cloudflare Workers has a platform-enforced 100 MB limit on request bodies. Combined with Zod schema validation (which rejects unexpected fields), this is sufficient.
**Action:** None required.

---

## Threat Model Summary

| Threat | Mitigation | Status |
|--------|-----------|--------|
| Unauthenticated access | Bearer token auth, fail-closed | Mitigated |
| Timing attack on token | Constant-time XOR comparison | Mitigated |
| SSRF via URL manipulation | HTTPS-only enforcement, URL validation | Mitigated |
| Command injection (setup) | execFileSync (no shell) | Mitigated |
| SQL/NoSQL injection | Not applicable (REST API proxy, no database) | N/A |
| XSS | Not applicable (JSON API, no HTML rendering) | N/A |
| Path traversal | Integer-only IDs in URL paths | Mitigated |
| Credential leakage | Secrets Store, .gitignore, no hardcoded values | Mitigated |
| Error information disclosure | sanitizeError() strips internal details | Mitigated |
| Denial of service | 15s timeout, CF platform limits, bearer auth | Mitigated |
| Dependency vulnerabilities | 0 known (npm audit clean) | Clear |

---

## Verdict

**Production-ready.** No HIGH or MEDIUM severity issues. Five LOW items documented above are informational and standard for this architecture. The codebase demonstrates defense-in-depth with authentication, input validation, SSRF protection, error sanitization, and secure credential management.
