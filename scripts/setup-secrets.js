#!/usr/bin/env node
/**
 * Interactive helper to create a Cloudflare Secrets Store and populate it
 * with the required secrets for the Snipe-IT MCP server.
 *
 * Usage:  npm run setup-secrets
 *
 * Prerequisites:
 *   - `npx wrangler login` (already authenticated)
 *   - Wrangler v4+
 */

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

/** Run wrangler via execFileSync (no shell interpolation). */
function wrangler(...args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function main() {
  console.log("\n=== Snipe-IT MCP Server — Secrets Store Setup ===\n");

  // 1. Create the Secrets Store
  console.log("Step 1: Creating Secrets Store 'snipeit-secrets'...");
  let storeId;
  try {
    const out = wrangler("secrets-store", "create", "snipeit-secrets");
    console.log(out);
    const match = out.match(/([0-9a-f-]{36})/i);
    if (match) storeId = match[1];
  } catch {
    console.log(
      "Store may already exist. Enter the store ID manually below.",
    );
  }

  if (!storeId) {
    storeId = (await ask("Enter your Secrets Store ID: ")).trim();
  }
  if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) {
    console.error("Invalid store ID format. Aborting.");
    rl.close();
    process.exit(1);
  }
  console.log(`\nUsing store ID: ${storeId}\n`);

  // 2. Prompt for secrets
  const snipeitUrl = (
    await ask("Enter your Snipe-IT URL (e.g., https://assets.example.com): ")
  ).trim();

  // Validate URL
  try {
    const parsed = new URL(snipeitUrl);
    if (parsed.protocol !== "https:") {
      console.error("Error: URL must use HTTPS. Aborting.");
      rl.close();
      process.exit(1);
    }
  } catch {
    console.error("Error: Invalid URL. Aborting.");
    rl.close();
    process.exit(1);
  }

  const snipeitToken = (await ask("Enter your Snipe-IT API token: ")).trim();
  if (snipeitToken.length < 20) {
    console.error("Error: API token appears too short. Aborting.");
    rl.close();
    process.exit(1);
  }

  // Generate a random MCP bearer token
  const mcpBearerToken = randomBytes(32).toString("hex");

  // 3. Create secrets (using execFileSync — no shell interpolation)
  console.log("\nStep 2: Creating secrets...");
  try {
    for (const [name, value] of [
      ["SNIPEIT_URL", snipeitUrl],
      ["SNIPEIT_API_TOKEN", snipeitToken],
      ["MCP_BEARER_TOKEN", mcpBearerToken],
    ]) {
      wrangler(
        "secrets-store",
        "secret",
        "create",
        "snipeit-secrets",
        name,
        "--value",
        value,
      );
      console.log(`  Created secret: ${name}`);
    }
    console.log("\nAll secrets created successfully!");
  } catch (e) {
    console.error("Failed to create secrets:", e.message);
    rl.close();
    process.exit(1);
  }

  // 4. Summary
  console.log(`
=== Next Steps ===

1. Update wrangler.toml — replace all YOUR_STORE_ID_HERE with:
   ${storeId}

2. Deploy:
   npm run deploy

3. Your MCP endpoint will be at:
   https://snipeit-mcp-server.<your-subdomain>.workers.dev/mcp

4. Configure your MCP client with this bearer token:
   ${mcpBearerToken}

   (This was auto-generated. Save it now — you cannot retrieve it later.)
`);

  rl.close();
}

main();
