interface Env {
  // Secrets Store bindings (async — use `await env.SNIPEIT_URL`)
  SNIPEIT_URL: string;
  SNIPEIT_API_TOKEN: string;
  MCP_BEARER_TOKEN?: string;
}
