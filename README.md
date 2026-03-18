# Snipe-IT MCP Server (Cloudflare Workers)

A remote [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [Snipe-IT](https://snipeitapp.com/) asset management, deployed on Cloudflare Workers.

Lets AI assistants (Claude, etc.) query and manage your Snipe-IT inventory via natural language.

## Features

- **30+ tools** — full CRUD for assets, users, models, categories, locations, manufacturers, suppliers, status labels
- **Cloudflare Workers** — serverless, globally distributed, auto-scaling
- **Cloudflare Secrets Store** — encrypted credential storage (no `.env` files in production)
- **Bearer token auth** — constant-time comparison, fail-closed
- **HTTPS-only** — enforced on both inbound (Workers default) and outbound (Snipe-IT API)
- **Input validation** — Zod schemas + custom validators on every tool
- **Sanitized errors** — never leaks stack traces or internal details
- **15s fetch timeout** — prevents hung connections from consuming resources

## Quick Start

See [INSTALL-PLAYBOOK.md](INSTALL-PLAYBOOK.md) for the full step-by-step guide.

```bash
git clone <this-repo>
cd snipeit-mcp-server
npm install
npx wrangler login
npm run setup-secrets      # creates Secrets Store, prompts for URL + token
# edit wrangler.toml with your store ID
npm run deploy
```

## Architecture

```
MCP Client (Claude Desktop / Claude Code / custom)
    |
    | HTTPS + Bearer Token
    v
Cloudflare Workers (edge)
    |
    | Secrets Store bindings (encrypted at rest)
    |
    | HTTPS + Snipe-IT API Token
    v
Your Snipe-IT Instance
```

## Available Tools

| Resource | List | Get | Create | Update | Delete | Special |
|----------|------|-----|--------|--------|--------|---------|
| Assets | list_assets | get_asset | create_asset | update_asset | delete_asset | checkout_asset, checkin_asset |
| Users | list_users | get_user | create_user | update_user | delete_user | |
| Models | list_models | | create_model | update_model | delete_model | |
| Categories | list_categories | | create_category | update_category | delete_category | |
| Locations | list_locations | | create_location | update_location | delete_location | |
| Manufacturers | list_manufacturers | | create_manufacturer | update_manufacturer | delete_manufacturer | |
| Suppliers | list_suppliers | | create_supplier | update_supplier | delete_supplier | |
| Status Labels | list_status_labels | | | | | |

## MCP Client Configuration

```json
{
  "mcpServers": {
    "snipeit": {
      "type": "streamable-http",
      "url": "https://snipeit-mcp-server.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-bearer-token>"
      }
    }
  }
}
```

## Development

```bash
# Create .dev.vars with your secrets for local testing
echo 'SNIPEIT_URL=https://your-instance.example.com' > .dev.vars
echo 'SNIPEIT_API_TOKEN=your-token' >> .dev.vars
echo 'MCP_BEARER_TOKEN=test-token' >> .dev.vars

# Start local dev server
npm run dev

# Test health endpoint
curl http://127.0.0.1:8787/health

# Test with auth
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

## Security

- All secrets stored in Cloudflare Secrets Store (encrypted at rest, injected at runtime)
- Bearer token authentication required on all MCP endpoints
- Constant-time token comparison prevents timing attacks
- HTTPS enforced on outbound Snipe-IT API calls (SSRF protection)
- All inputs validated and length-bounded
- Error messages sanitized — no internal details leaked
- 15-second timeout on all outbound requests
- Server refuses to start if any required secret is missing (fail-closed)

## License

MIT
