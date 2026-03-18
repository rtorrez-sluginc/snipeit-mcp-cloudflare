# Snipe-IT MCP — User Guide

**How to connect Claude to your organization's Snipe-IT asset inventory.**

---

## What you need from your admin

Before you start, get these two things from whoever deployed the server:

1. **Server URL** — looks like `https://snipeit-mcp-server.example.workers.dev/mcp`
2. **Bearer token** — a long string of letters and numbers (64 characters)

---

## Option A: Claude Desktop (Windows / macOS)

### Step 1: Open the MCP configuration file

**Windows:**
1. Press `Win + R`, paste the following, and press Enter:
   ```
   notepad %APPDATA%\Claude\claude_desktop_config.json
   ```
2. If Notepad says the file doesn't exist, click **Yes** to create it.

**macOS:**
1. Open Terminal and run:
   ```bash
   open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```
2. If the file doesn't exist, create it:
   ```bash
   echo '{}' > ~/Library/Application\ Support/Claude/claude_desktop_config.json
   open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

### Step 2: Add the Snipe-IT server

Paste this into the file, replacing the two placeholder values with what your admin gave you:

```json
{
  "mcpServers": {
    "snipeit": {
      "type": "streamable-http",
      "url": "https://snipeit-mcp-server.YOUR-SUBDOMAIN.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_BEARER_TOKEN_HERE"
      }
    }
  }
}
```

> **If the file already has other MCP servers**, add the `"snipeit": { ... }` block inside the existing `"mcpServers"` object. Don't replace the whole file.

### Step 3: Restart Claude Desktop

Fully quit Claude Desktop (check the system tray / menu bar) and reopen it. The Snipe-IT tools will appear automatically.

---

## Option B: Claude Code (CLI)

### Step 1: Add with one command

Run this from any terminal, replacing the two placeholder values:

```bash
claude mcp add snipeit \
  --transport streamable-http \
  "https://snipeit-mcp-server.YOUR-SUBDOMAIN.workers.dev/mcp" \
  --header "Authorization: Bearer YOUR_BEARER_TOKEN_HERE"
```

That's it. Claude Code will use the server in your next session.

### Alternative: Edit the config file directly

Create or edit `.mcp.json` in your project root (or `~/.claude/.mcp.json` for global access):

```json
{
  "mcpServers": {
    "snipeit": {
      "type": "streamable-http",
      "url": "https://snipeit-mcp-server.YOUR-SUBDOMAIN.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_BEARER_TOKEN_HERE"
      }
    }
  }
}
```

---

## Verify it works

Once connected, ask Claude:

> "List all status labels in Snipe-IT"

If you see your organization's status labels come back, everything is working.

Other quick tests:

> "How many assets are in Snipe-IT?"

> "Search for laptops in Snipe-IT"

---

## What you can do

Once connected, you can ask Claude to do any of the following using natural language:

### Look things up
- "Show me asset #1042"
- "Search for all Dell laptops"
- "List users in Snipe-IT"
- "What locations do we have?"
- "Show me all asset models"

### Create records
- "Create a new asset with model ID 5 and status Ready to Deploy"
- "Add a new user: Jane Smith, username jsmith"
- "Create a new location called 'Building C, Floor 2'"

### Update records
- "Change the name of asset #1042 to 'Marketing MacBook'"
- "Update user #15's email to jane@example.com"

### Check out / Check in
- "Check out asset #1042 to user #7"
- "Check in asset #1042"

### Delete records
- "Delete asset #999"

> **Tip:** You don't need to memorize IDs. Ask Claude to search first ("find the laptop assigned to Jane") and it will look up the ID for you.

---

## Available tools (full list)

| Resource | Actions |
|----------|---------|
| **Assets** | list, get, create, update, delete, checkout, checkin |
| **Users** | list, get, create, update, delete |
| **Models** | list, create, update, delete |
| **Categories** | list, create, update, delete |
| **Locations** | list, create, update, delete |
| **Manufacturers** | list, create, update, delete |
| **Suppliers** | list, create, update, delete |
| **Status Labels** | list |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Claude doesn't show Snipe-IT tools | Restart Claude Desktop / start a new Claude Code session |
| "Unauthorized" errors | Check that your bearer token is correct (no extra spaces, quotes, or line breaks) |
| "Server misconfigured" errors | Contact your admin — a secret is missing on the server side |
| Timeout errors | Your Snipe-IT instance may be slow or down — try again in a minute |
| "Resource not found" | The ID you used doesn't exist. Ask Claude to search for the item first |
| Tools appear but return errors | Your Snipe-IT API token may have insufficient permissions — contact your admin |

### Still stuck?

1. **Test the server directly** — open the health URL in your browser: `https://snipeit-mcp-server.YOUR-SUBDOMAIN.workers.dev/health` — you should see `{"status":"ok"}`
2. **Check your config** — make sure the URL ends with `/mcp` and the token has no extra whitespace
3. **Contact your admin** with the exact error message Claude shows you
