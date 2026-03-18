# Snipe-IT MCP Server — Cloudflare Workers Deployment

**From zero to running in 15 minutes.**

---

## Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Cloudflare account | Free tier works | [dash.cloudflare.com](https://dash.cloudflare.com) |
| Snipe-IT instance | Running, HTTPS, API enabled | Accessible via browser |
| Snipe-IT API token | Generated | Settings > API > Personal Access Tokens |

---

## Step 1: Clone & install (2 min)

```bash
git clone <this-repo>
cd snipeit-mcp-server
npm install
```

---

## Step 2: Authenticate with Cloudflare (1 min)

```bash
npx wrangler login
```

This opens a browser window. Log in and authorize Wrangler.

Verify it worked:

```bash
npx wrangler whoami
```

You should see your Cloudflare account name and ID.

---

## Step 3: Create Secrets Store & secrets (3 min)

Run the guided setup script:

```bash
npm run setup-secrets
```

It will prompt you for:

1. **Snipe-IT URL** — your instance URL (must be HTTPS, e.g. `https://assets.example.com`)
2. **Snipe-IT API token** — from Snipe-IT > Settings > API > Personal Access Tokens

The script automatically:
- Creates a Cloudflare Secrets Store named `snipeit-secrets`
- Stores your URL and API token as encrypted secrets
- Generates a random 64-character MCP bearer token for client auth
- Prints the store ID and bearer token

**IMPORTANT:** Copy and save the bearer token now. You cannot retrieve it later.

Example output:

```
Using store ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890

  Created secret: SNIPEIT_URL
  Created secret: SNIPEIT_API_TOKEN
  Created secret: MCP_BEARER_TOKEN

=== Next Steps ===

1. Update wrangler.toml — replace all YOUR_STORE_ID_HERE with:
   a1b2c3d4-e5f6-7890-abcd-ef1234567890

4. Configure your MCP client with this bearer token:
   8f3a...c7d2
```

---

## Step 4: Update wrangler.toml with your store ID (1 min)

Open `wrangler.toml` and replace all three instances of `YOUR_STORE_ID_HERE` with the store ID from Step 3.

Before:

```toml
[[secrets_store_secrets]]
binding = "SNIPEIT_URL"
store_id = "YOUR_STORE_ID_HERE"
secret_name = "SNIPEIT_URL"
```

After:

```toml
[[secrets_store_secrets]]
binding = "SNIPEIT_URL"
store_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
secret_name = "SNIPEIT_URL"
```

Do this for all three `[[secrets_store_secrets]]` blocks (SNIPEIT_URL, SNIPEIT_API_TOKEN, MCP_BEARER_TOKEN).

---

## Step 5: Test locally (2 min)

Create a `.dev.vars` file for local development:

```bash
echo 'SNIPEIT_URL=https://your-snipeit-instance.example.com' > .dev.vars
echo 'SNIPEIT_API_TOKEN=your-api-token-here' >> .dev.vars
echo 'MCP_BEARER_TOKEN=any-test-token' >> .dev.vars
```

Start the dev server:

```bash
npm run dev
```

Test the health endpoint:

```bash
curl http://127.0.0.1:8787/health
```

Expected: `{"status":"ok"}`

Test MCP with auth (should return MCP protocol response, not a 401):

```bash
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer any-test-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Test without auth (should get 401):

```bash
curl http://127.0.0.1:8787/mcp
```

Expected: `Unauthorized`

Stop the dev server with `Ctrl+C` when done.

---

## Step 6: Deploy to Cloudflare (2 min)

```bash
npm run deploy
```

Wrangler will output your Worker URL:

```
Published snipeit-mcp-server (X.XX sec)
  https://snipeit-mcp-server.<your-subdomain>.workers.dev
```

Verify the deployment:

```bash
curl https://snipeit-mcp-server.<your-subdomain>.workers.dev/health
```

Expected: `{"status":"ok"}`

---

## Step 7: Configure your MCP client (2 min)

### Claude Desktop / Claude Code

Update your MCP config (`.mcp.json` or Claude Desktop settings):

```json
{
  "mcpServers": {
    "snipeit": {
      "type": "streamable-http",
      "url": "https://snipeit-mcp-server.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-mcp-bearer-token-from-step-3>"
      }
    }
  }
}
```

### Custom MCP client

Use the Streamable HTTP transport with:
- **URL:** `https://snipeit-mcp-server.<your-subdomain>.workers.dev/mcp`
- **Auth:** `Authorization: Bearer <token>` header on every request

---

## Step 8: Verify end-to-end (1 min)

From your MCP client, try calling the `list_status_labels` tool (no arguments needed). If you get back your Snipe-IT status labels, everything is working.

---

## Optional: Custom domain

If you want a custom domain instead of `*.workers.dev`:

1. In the Cloudflare dashboard, go to **Workers & Pages > snipeit-mcp-server > Settings > Domains & Routes**
2. Add your custom domain (must be on a Cloudflare-managed zone)
3. Update your MCP client config with the new URL

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm run setup-secrets` fails | Run `npx wrangler login` first |
| 500 "MCP_BEARER_TOKEN is required" | Verify all 3 secrets exist in your Secrets Store and store_id is correct in wrangler.toml |
| 500 "SNIPEIT_URL and SNIPEIT_API_TOKEN required" | Same as above — check store_id matches |
| 401 on MCP calls | Check your bearer token matches what the setup script generated |
| "SNIPEIT_URL must use HTTPS" | Your Snipe-IT instance must be served over HTTPS |
| Timeout errors from tools | Your Snipe-IT server is slow or unreachable from Cloudflare's edge |
| `wrangler deploy` fails | Run `npx wrangler whoami` to verify auth. Check you have Workers enabled on your CF account |

---

## Cleanup

To delete the deployment:

```bash
npx wrangler delete snipeit-mcp-server
```

To delete secrets (from Cloudflare dashboard):
1. Go to **Secrets Store** tab
2. Delete the `snipeit-secrets` store

Your `.dev.vars` file is gitignored and stays local.
