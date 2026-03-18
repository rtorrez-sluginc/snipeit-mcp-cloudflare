/**
 * Snipe-IT MCP Server — Cloudflare Workers Edition
 *
 * Uses Cloudflare Agents SDK (createMcpHandler) + Secrets Store for credentials.
 * All HTTP calls use the native fetch() API (no axios/node:https).
 */

import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ============================================================================
// INPUT VALIDATORS
// ============================================================================

class InputValidator {
  static validateId(id: unknown, fieldName = "id"): number {
    const num = Number(id);
    if (!Number.isInteger(num) || num < 1) {
      throw new Error(`${fieldName} must be a positive integer`);
    }
    return num;
  }

  static validateLimit(limit: unknown): number {
    if (limit === undefined) return 50;
    const num = Number(limit);
    if (!Number.isInteger(num) || num < 1 || num > 500) {
      throw new Error("Limit must be between 1 and 500");
    }
    return num;
  }

  static validateOffset(offset: unknown): number {
    if (offset === undefined) return 0;
    const num = Number(offset);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error("Offset must be a non-negative integer");
    }
    return num;
  }

  static validateSearchQuery(query: unknown): string {
    if (query === undefined) return "";
    if (typeof query !== "string") {
      throw new Error("Search query must be a string");
    }
    if (query.length > 500) {
      throw new Error("Search query too long (max 500 characters)");
    }
    return query.trim();
  }

  static validateString(
    value: unknown,
    fieldName: string,
    maxLength = 255,
  ): string {
    if (value === undefined) return "";
    if (typeof value !== "string") {
      throw new Error(`${fieldName} must be a string`);
    }
    if (value.length > maxLength) {
      throw new Error(`${fieldName} too long (max ${maxLength} characters)`);
    }
    return value.trim();
  }

  static validateEnum<T extends string>(
    value: unknown,
    allowedValues: T[],
    fieldName: string,
  ): T {
    if (!allowedValues.includes(value as T)) {
      throw new Error(
        `${fieldName} must be one of: ${allowedValues.join(", ")}`,
      );
    }
    return value as T;
  }

  static validateDate(
    value: unknown,
    fieldName: string,
  ): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new Error(`${fieldName} must be a string in YYYY-MM-DD format`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
    }
    return value;
  }
}

// ============================================================================
// ERROR HANDLER
// ============================================================================

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) return "An unexpected error occurred.";
  const e = error as Error & { status?: number; code?: string };

  if (e.status === 401)
    return "Authentication failed. Please check your API token.";
  if (e.status === 403)
    return "Permission denied. You may not have access to perform this operation.";
  if (e.status === 404)
    return "Resource not found. The requested item may not exist.";
  if (e.status === 422)
    return "Validation error. Please check your input parameters.";
  if (e.status === 429)
    return "Rate limit exceeded. Please try again in a few moments.";
  if (e.status && e.status >= 500)
    return "Snipe-IT server error. Please try again later.";
  if (e.name === "TimeoutError" || e.name === "AbortError")
    return "Request timed out. The Snipe-IT server may be slow or unreachable.";
  if (e.message && !e.status)
    return `Validation error: ${e.message}`;

  return "An unexpected error occurred while communicating with Snipe-IT.";
}

// ============================================================================
// SNIPE-IT CLIENT (fetch-based)
// ============================================================================

class SnipeITClient {
  private baseUrl: string;
  private token: string;

  constructor(url: string, token: string) {
    // SSRF protection: enforce HTTPS
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("SNIPEIT_URL is not a valid URL");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("SNIPEIT_URL must use HTTPS");
    }

    this.baseUrl = url.replace(/\/+$/, "");
    this.token = token;
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") qs.set(k, String(v));
      }
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "snipeit-mcp-server-cf/1.0.0",
      },
      signal: AbortSignal.timeout(15_000), // 15s timeout
    };
    if (body) init.body = JSON.stringify(body);

    const resp = await fetch(url, init);
    if (!resp.ok) {
      const err = new Error(`Snipe-IT API error: ${resp.status}`) as Error & {
        status: number;
      };
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  async listAssets(params?: {
    limit?: unknown;
    offset?: unknown;
    search?: unknown;
    status?: unknown;
  }) {
    return this.request("GET", "/api/v1/hardware", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
      search: InputValidator.validateSearchQuery(params?.search),
      status: params?.status
        ? InputValidator.validateString(params.status, "status", 50)
        : undefined,
    });
  }

  async getAsset(id: unknown) {
    const assetId = InputValidator.validateId(id, "asset_id");
    return this.request("GET", `/api/v1/hardware/${assetId}`);
  }

  async createAsset(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      model_id: InputValidator.validateId(data.model_id, "model_id"),
      status_id: InputValidator.validateId(data.status_id, "status_id"),
    };
    if (data.asset_tag)
      payload.asset_tag = InputValidator.validateString(
        data.asset_tag,
        "asset_tag",
      );
    if (data.name)
      payload.name = InputValidator.validateString(data.name, "name");
    if (data.serial)
      payload.serial = InputValidator.validateString(data.serial, "serial");
    if (data.purchase_date)
      payload.purchase_date = InputValidator.validateDate(
        data.purchase_date,
        "purchase_date",
      );
    if (data.purchase_cost)
      payload.purchase_cost = InputValidator.validateString(
        data.purchase_cost,
        "purchase_cost",
        50,
      );
    if (data.supplier_id)
      payload.supplier_id = InputValidator.validateId(
        data.supplier_id,
        "supplier_id",
      );
    if (data.notes)
      payload.notes = InputValidator.validateString(data.notes, "notes", 2000);
    return this.request("POST", "/api/v1/hardware", payload);
  }

  async updateAsset(id: unknown, data: Record<string, unknown>) {
    const assetId = InputValidator.validateId(id, "asset_id");
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined)
      payload.name = InputValidator.validateString(data.name, "name");
    if (data.serial !== undefined)
      payload.serial = InputValidator.validateString(data.serial, "serial");
    if (data.asset_tag !== undefined)
      payload.asset_tag = InputValidator.validateString(
        data.asset_tag,
        "asset_tag",
      );
    if (data.model_id !== undefined)
      payload.model_id = InputValidator.validateId(data.model_id, "model_id");
    if (data.status_id !== undefined)
      payload.status_id = InputValidator.validateId(
        data.status_id,
        "status_id",
      );
    if (data.notes !== undefined)
      payload.notes = InputValidator.validateString(data.notes, "notes", 2000);
    if (data.purchase_date !== undefined)
      payload.purchase_date = InputValidator.validateDate(
        data.purchase_date,
        "purchase_date",
      );
    if (data.purchase_cost !== undefined)
      payload.purchase_cost = InputValidator.validateString(
        data.purchase_cost,
        "purchase_cost",
        50,
      );
    if (data.supplier_id !== undefined)
      payload.supplier_id = InputValidator.validateId(
        data.supplier_id,
        "supplier_id",
      );
    return this.request("PUT", `/api/v1/hardware/${assetId}`, payload);
  }

  async deleteAsset(id: unknown) {
    const assetId = InputValidator.validateId(id, "asset_id");
    return this.request("DELETE", `/api/v1/hardware/${assetId}`);
  }

  async checkoutAsset(assetId: unknown, data: Record<string, unknown>) {
    const id = InputValidator.validateId(assetId, "asset_id");
    const checkout_to_type = InputValidator.validateEnum(
      data.checkout_to_type,
      ["user", "asset", "location"],
      "checkout_to_type",
    );
    const payload: Record<string, unknown> = { checkout_to_type };
    if (checkout_to_type === "user" && data.assigned_user)
      payload.assigned_user = InputValidator.validateId(
        data.assigned_user,
        "assigned_user",
      );
    if (checkout_to_type === "asset" && data.assigned_asset)
      payload.assigned_asset = InputValidator.validateId(
        data.assigned_asset,
        "assigned_asset",
      );
    if (checkout_to_type === "location" && data.assigned_location)
      payload.assigned_location = InputValidator.validateId(
        data.assigned_location,
        "assigned_location",
      );
    if (data.note)
      payload.note = InputValidator.validateString(data.note, "note", 1000);
    return this.request("POST", `/api/v1/hardware/${id}/checkout`, payload);
  }

  async checkinAsset(assetId: unknown, data?: Record<string, unknown>) {
    const id = InputValidator.validateId(assetId, "asset_id");
    const payload: Record<string, unknown> = {};
    if (data?.note)
      payload.note = InputValidator.validateString(data.note, "note", 1000);
    if (data?.location_id)
      payload.location_id = InputValidator.validateId(
        data.location_id,
        "location_id",
      );
    return this.request("POST", `/api/v1/hardware/${id}/checkin`, payload);
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  async listUsers(params?: {
    limit?: unknown;
    offset?: unknown;
    search?: unknown;
  }) {
    return this.request("GET", "/api/v1/users", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
      search: InputValidator.validateSearchQuery(params?.search),
    });
  }

  async getUser(id: unknown) {
    return this.request(
      "GET",
      `/api/v1/users/${InputValidator.validateId(id, "user_id")}`,
    );
  }

  async createUser(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      first_name: InputValidator.validateString(data.first_name, "first_name"),
      username: InputValidator.validateString(data.username, "username"),
      password: InputValidator.validateString(data.password, "password"),
    };
    if (!payload.first_name) throw new Error("first_name is required");
    if (!payload.username) throw new Error("username is required");
    if (!payload.password) throw new Error("password is required");
    if (data.last_name !== undefined)
      payload.last_name = InputValidator.validateString(
        data.last_name,
        "last_name",
      );
    if (data.email !== undefined)
      payload.email = InputValidator.validateString(data.email, "email");
    if (data.jobtitle !== undefined)
      payload.jobtitle = InputValidator.validateString(
        data.jobtitle,
        "jobtitle",
      );
    if (data.employee_num !== undefined)
      payload.employee_num = InputValidator.validateString(
        data.employee_num,
        "employee_num",
      );
    if (data.department_id !== undefined)
      payload.department_id = InputValidator.validateId(
        data.department_id,
        "department_id",
      );
    if (data.company_id !== undefined)
      payload.company_id = InputValidator.validateId(
        data.company_id,
        "company_id",
      );
    if (data.location_id !== undefined)
      payload.location_id = InputValidator.validateId(
        data.location_id,
        "location_id",
      );
    return this.request("POST", "/api/v1/users", payload);
  }

  async updateUser(id: unknown, data: Record<string, unknown>) {
    const userId = InputValidator.validateId(id, "user_id");
    const payload: Record<string, unknown> = {};
    if (data.first_name !== undefined)
      payload.first_name = InputValidator.validateString(
        data.first_name,
        "first_name",
      );
    if (data.last_name !== undefined)
      payload.last_name = InputValidator.validateString(
        data.last_name,
        "last_name",
      );
    if (data.username !== undefined)
      payload.username = InputValidator.validateString(
        data.username,
        "username",
      );
    if (data.email !== undefined)
      payload.email = InputValidator.validateString(data.email, "email");
    if (data.password !== undefined)
      payload.password = InputValidator.validateString(
        data.password,
        "password",
      );
    if (data.jobtitle !== undefined)
      payload.jobtitle = InputValidator.validateString(
        data.jobtitle,
        "jobtitle",
      );
    if (data.employee_num !== undefined)
      payload.employee_num = InputValidator.validateString(
        data.employee_num,
        "employee_num",
      );
    if (data.department_id !== undefined)
      payload.department_id = InputValidator.validateId(
        data.department_id,
        "department_id",
      );
    if (data.company_id !== undefined)
      payload.company_id = InputValidator.validateId(
        data.company_id,
        "company_id",
      );
    if (data.location_id !== undefined)
      payload.location_id = InputValidator.validateId(
        data.location_id,
        "location_id",
      );
    return this.request("PUT", `/api/v1/users/${userId}`, payload);
  }

  async deleteUser(id: unknown) {
    return this.request(
      "DELETE",
      `/api/v1/users/${InputValidator.validateId(id, "user_id")}`,
    );
  }

  // ── Models ────────────────────────────────────────────────────────────────
  async listModels(params?: {
    limit?: unknown;
    offset?: unknown;
    search?: unknown;
  }) {
    return this.request("GET", "/api/v1/models", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
      search: InputValidator.validateSearchQuery(params?.search),
    });
  }

  async createModel(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      name: InputValidator.validateString(data.name, "name"),
      category_id: InputValidator.validateId(data.category_id, "category_id"),
    };
    if (!payload.name) throw new Error("name is required");
    if (data.model_number !== undefined)
      payload.model_number = InputValidator.validateString(
        data.model_number,
        "model_number",
      );
    if (data.manufacturer_id !== undefined)
      payload.manufacturer_id = InputValidator.validateId(
        data.manufacturer_id,
        "manufacturer_id",
      );
    return this.request("POST", "/api/v1/models", payload);
  }

  async updateModel(id: unknown, data: Record<string, unknown>) {
    const modelId = InputValidator.validateId(id, "model_id");
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined)
      payload.name = InputValidator.validateString(data.name, "name");
    if (data.model_number !== undefined)
      payload.model_number = InputValidator.validateString(
        data.model_number,
        "model_number",
      );
    if (data.category_id !== undefined)
      payload.category_id = InputValidator.validateId(
        data.category_id,
        "category_id",
      );
    if (data.manufacturer_id !== undefined)
      payload.manufacturer_id = InputValidator.validateId(
        data.manufacturer_id,
        "manufacturer_id",
      );
    return this.request("PUT", `/api/v1/models/${modelId}`, payload);
  }

  async deleteModel(id: unknown) {
    return this.request(
      "DELETE",
      `/api/v1/models/${InputValidator.validateId(id, "model_id")}`,
    );
  }

  // ── Categories ────────────────────────────────────────────────────────────
  async listCategories(params?: { limit?: unknown; offset?: unknown }) {
    return this.request("GET", "/api/v1/categories", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
    });
  }

  async createCategory(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      name: InputValidator.validateString(data.name, "name"),
      category_type: InputValidator.validateEnum(
        data.category_type,
        ["asset", "accessory", "consumable", "component", "license"],
        "category_type",
      ),
    };
    if (!payload.name) throw new Error("name is required");
    return this.request("POST", "/api/v1/categories", payload);
  }

  async updateCategory(id: unknown, data: Record<string, unknown>) {
    const catId = InputValidator.validateId(id, "category_id");
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined)
      payload.name = InputValidator.validateString(data.name, "name");
    if (data.category_type !== undefined)
      payload.category_type = InputValidator.validateEnum(
        data.category_type,
        ["asset", "accessory", "consumable", "component", "license"],
        "category_type",
      );
    return this.request("PUT", `/api/v1/categories/${catId}`, payload);
  }

  async deleteCategory(id: unknown) {
    return this.request(
      "DELETE",
      `/api/v1/categories/${InputValidator.validateId(id, "category_id")}`,
    );
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  async listLocations(params?: {
    limit?: unknown;
    offset?: unknown;
    search?: unknown;
  }) {
    return this.request("GET", "/api/v1/locations", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
      search: InputValidator.validateSearchQuery(params?.search),
    });
  }

  async createLocation(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      name: InputValidator.validateString(data.name, "name"),
    };
    if (!payload.name) throw new Error("name is required");
    if (data.address !== undefined)
      payload.address = InputValidator.validateString(data.address, "address");
    if (data.city !== undefined)
      payload.city = InputValidator.validateString(data.city, "city");
    if (data.state !== undefined)
      payload.state = InputValidator.validateString(data.state, "state");
    if (data.country !== undefined)
      payload.country = InputValidator.validateString(data.country, "country");
    if (data.zip !== undefined)
      payload.zip = InputValidator.validateString(data.zip, "zip", 20);
    return this.request("POST", "/api/v1/locations", payload);
  }

  async updateLocation(id: unknown, data: Record<string, unknown>) {
    const locId = InputValidator.validateId(id, "location_id");
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined)
      payload.name = InputValidator.validateString(data.name, "name");
    if (data.address !== undefined)
      payload.address = InputValidator.validateString(data.address, "address");
    if (data.city !== undefined)
      payload.city = InputValidator.validateString(data.city, "city");
    if (data.state !== undefined)
      payload.state = InputValidator.validateString(data.state, "state");
    if (data.country !== undefined)
      payload.country = InputValidator.validateString(data.country, "country");
    if (data.zip !== undefined)
      payload.zip = InputValidator.validateString(data.zip, "zip", 20);
    return this.request("PUT", `/api/v1/locations/${locId}`, payload);
  }

  async deleteLocation(id: unknown) {
    return this.request(
      "DELETE",
      `/api/v1/locations/${InputValidator.validateId(id, "location_id")}`,
    );
  }

  // ── Status Labels ─────────────────────────────────────────────────────────
  async listStatusLabels() {
    return this.request("GET", "/api/v1/statuslabels");
  }

  // ── Manufacturers ─────────────────────────────────────────────────────────
  async listManufacturers(params?: { limit?: unknown; offset?: unknown }) {
    return this.request("GET", "/api/v1/manufacturers", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
    });
  }

  async createManufacturer(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      name: InputValidator.validateString(data.name, "name"),
    };
    if (!payload.name) throw new Error("name is required");
    if (data.url !== undefined)
      payload.url = InputValidator.validateString(data.url, "url", 500);
    return this.request("POST", "/api/v1/manufacturers", payload);
  }

  async updateManufacturer(id: unknown, data: Record<string, unknown>) {
    const mfgId = InputValidator.validateId(id, "manufacturer_id");
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined)
      payload.name = InputValidator.validateString(data.name, "name");
    if (data.url !== undefined)
      payload.url = InputValidator.validateString(data.url, "url", 500);
    return this.request("PUT", `/api/v1/manufacturers/${mfgId}`, payload);
  }

  async deleteManufacturer(id: unknown) {
    return this.request(
      "DELETE",
      `/api/v1/manufacturers/${InputValidator.validateId(id, "manufacturer_id")}`,
    );
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────
  async listSuppliers(params?: { limit?: unknown; offset?: unknown }) {
    return this.request("GET", "/api/v1/suppliers", undefined, {
      limit: InputValidator.validateLimit(params?.limit),
      offset: InputValidator.validateOffset(params?.offset),
    });
  }

  async createSupplier(data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      name: InputValidator.validateString(data.name, "name"),
    };
    if (!payload.name) throw new Error("name is required");
    for (const field of [
      "address",
      "city",
      "state",
      "country",
      "contact",
      "email",
    ]) {
      if (data[field] !== undefined)
        payload[field] = InputValidator.validateString(data[field], field);
    }
    if (data.zip !== undefined)
      payload.zip = InputValidator.validateString(data.zip, "zip", 20);
    if (data.phone !== undefined)
      payload.phone = InputValidator.validateString(data.phone, "phone", 50);
    if (data.url !== undefined)
      payload.url = InputValidator.validateString(data.url, "url", 500);
    return this.request("POST", "/api/v1/suppliers", payload);
  }

  async updateSupplier(id: unknown, data: Record<string, unknown>) {
    const supId = InputValidator.validateId(id, "supplier_id");
    const payload: Record<string, unknown> = {};
    for (const field of [
      "name",
      "address",
      "city",
      "state",
      "country",
      "contact",
      "email",
    ]) {
      if (data[field] !== undefined)
        payload[field] = InputValidator.validateString(data[field], field);
    }
    if (data.zip !== undefined)
      payload.zip = InputValidator.validateString(data.zip, "zip", 20);
    if (data.phone !== undefined)
      payload.phone = InputValidator.validateString(data.phone, "phone", 50);
    if (data.url !== undefined)
      payload.url = InputValidator.validateString(data.url, "url", 500);
    return this.request("PUT", `/api/v1/suppliers/${supId}`, payload);
  }

  async deleteSupplier(id: unknown) {
    return this.request(
      "DELETE",
      `/api/v1/suppliers/${InputValidator.validateId(id, "supplier_id")}`,
    );
  }
}

// ============================================================================
// TOOL RESULT HELPER
// ============================================================================

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: sanitizeError(error) }],
    isError: true,
  };
}

// ============================================================================
// MCP SERVER FACTORY
// ============================================================================

function createSnipeITMcpServer(env: Env): McpServer {
  const snipeit = new SnipeITClient(env.SNIPEIT_URL, env.SNIPEIT_API_TOKEN);

  const server = new McpServer({
    name: "snipeit-mcp-server",
    version: "1.0.0",
  });

  // ── Assets ──────────────────────────────────────────────────────────────

  server.registerTool(
    "list_assets",
    {
      description: "List all assets in Snipe-IT with optional filtering",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500, default: 50)"),
        offset: z.number().optional().describe("Offset for pagination"),
        search: z.string().optional().describe("Search query to filter assets"),
        status: z.string().optional().describe("Filter by status (e.g., 'RTD', 'Deployed')"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listAssets(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "get_asset",
    {
      description: "Get detailed information about a specific asset",
      inputSchema: {
        asset_id: z.number().describe("The ID of the asset"),
      },
    },
    async ({ asset_id }) => {
      try { return ok(await snipeit.getAsset(asset_id)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_asset",
    {
      description: "Create a new asset in Snipe-IT",
      inputSchema: {
        model_id: z.number().describe("Model ID (required)"),
        status_id: z.number().describe("Status label ID (required)"),
        asset_tag: z.string().optional().describe("Unique asset tag"),
        name: z.string().optional().describe("Asset name"),
        serial: z.string().optional().describe("Serial number"),
        purchase_date: z.string().optional().describe("Purchase date (YYYY-MM-DD)"),
        purchase_cost: z.string().optional().describe("Purchase cost"),
        supplier_id: z.number().optional().describe("Supplier ID"),
        notes: z.string().optional().describe("Notes"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createAsset(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_asset",
    {
      description: "Update an existing asset in Snipe-IT",
      inputSchema: {
        asset_id: z.number().describe("The ID of the asset to update"),
        name: z.string().optional().describe("Asset name"),
        serial: z.string().optional().describe("Serial number"),
        asset_tag: z.string().optional().describe("Unique asset tag"),
        model_id: z.number().optional().describe("Model ID"),
        status_id: z.number().optional().describe("Status label ID"),
        notes: z.string().optional().describe("Notes"),
        purchase_date: z.string().optional().describe("Purchase date (YYYY-MM-DD)"),
        purchase_cost: z.string().optional().describe("Purchase cost"),
        supplier_id: z.number().optional().describe("Supplier ID"),
      },
    },
    async ({ asset_id, ...data }) => {
      try { return ok(await snipeit.updateAsset(asset_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_asset",
    {
      description: "Delete an asset from Snipe-IT",
      inputSchema: {
        asset_id: z.number().describe("The ID of the asset to delete"),
      },
    },
    async ({ asset_id }) => {
      try { return ok(await snipeit.deleteAsset(asset_id)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "checkout_asset",
    {
      description: "Check out an asset to a user, asset, or location",
      inputSchema: {
        asset_id: z.number().describe("The ID of the asset to check out"),
        checkout_to_type: z.enum(["user", "asset", "location"]).describe("Type to check out to"),
        assigned_user: z.number().optional().describe("User ID (if checking out to user)"),
        assigned_asset: z.number().optional().describe("Asset ID (if checking out to asset)"),
        assigned_location: z.number().optional().describe("Location ID (if checking out to location)"),
        note: z.string().optional().describe("Checkout note"),
      },
    },
    async ({ asset_id, ...data }) => {
      try { return ok(await snipeit.checkoutAsset(asset_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "checkin_asset",
    {
      description: "Check in an asset",
      inputSchema: {
        asset_id: z.number().describe("The ID of the asset to check in"),
        note: z.string().optional().describe("Check-in note"),
        location_id: z.number().optional().describe("Location ID to check in to"),
      },
    },
    async ({ asset_id, ...data }) => {
      try { return ok(await snipeit.checkinAsset(asset_id, data)); }
      catch (e) { return err(e); }
    },
  );

  // ── Users ───────────────────────────────────────────────────────────────

  server.registerTool(
    "list_users",
    {
      description: "List all users in Snipe-IT",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500)"),
        offset: z.number().optional().describe("Offset for pagination"),
        search: z.string().optional().describe("Search query to filter users"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listUsers(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "get_user",
    {
      description: "Get detailed information about a specific user",
      inputSchema: {
        user_id: z.number().describe("The ID of the user"),
      },
    },
    async ({ user_id }) => {
      try { return ok(await snipeit.getUser(user_id)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_user",
    {
      description: "Create a new user in Snipe-IT",
      inputSchema: {
        first_name: z.string().describe("First name (required)"),
        username: z.string().describe("Username (required)"),
        password: z.string().describe("Password (required)"),
        last_name: z.string().optional().describe("Last name"),
        email: z.string().optional().describe("Email address"),
        jobtitle: z.string().optional().describe("Job title"),
        employee_num: z.string().optional().describe("Employee number"),
        department_id: z.number().optional().describe("Department ID"),
        company_id: z.number().optional().describe("Company ID"),
        location_id: z.number().optional().describe("Location ID"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createUser(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_user",
    {
      description: "Update an existing user in Snipe-IT",
      inputSchema: {
        user_id: z.number().describe("The ID of the user to update"),
        first_name: z.string().optional().describe("First name"),
        last_name: z.string().optional().describe("Last name"),
        username: z.string().optional().describe("Username"),
        email: z.string().optional().describe("Email address"),
        password: z.string().optional().describe("Password"),
        jobtitle: z.string().optional().describe("Job title"),
        employee_num: z.string().optional().describe("Employee number"),
        department_id: z.number().optional().describe("Department ID"),
        company_id: z.number().optional().describe("Company ID"),
        location_id: z.number().optional().describe("Location ID"),
      },
    },
    async ({ user_id, ...data }) => {
      try { return ok(await snipeit.updateUser(user_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_user",
    {
      description: "Delete a user from Snipe-IT",
      inputSchema: {
        user_id: z.number().describe("The ID of the user to delete"),
      },
    },
    async ({ user_id }) => {
      try { return ok(await snipeit.deleteUser(user_id)); }
      catch (e) { return err(e); }
    },
  );

  // ── Models ──────────────────────────────────────────────────────────────

  server.registerTool(
    "list_models",
    {
      description: "List all asset models",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500)"),
        offset: z.number().optional().describe("Offset for pagination"),
        search: z.string().optional().describe("Search query to filter models"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listModels(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_model",
    {
      description: "Create a new asset model in Snipe-IT",
      inputSchema: {
        name: z.string().describe("Model name (required)"),
        category_id: z.number().describe("Category ID (required)"),
        model_number: z.string().optional().describe("Model number"),
        manufacturer_id: z.number().optional().describe("Manufacturer ID"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createModel(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_model",
    {
      description: "Update an existing asset model in Snipe-IT",
      inputSchema: {
        model_id: z.number().describe("The ID of the model to update"),
        name: z.string().optional().describe("Model name"),
        model_number: z.string().optional().describe("Model number"),
        category_id: z.number().optional().describe("Category ID"),
        manufacturer_id: z.number().optional().describe("Manufacturer ID"),
      },
    },
    async ({ model_id, ...data }) => {
      try { return ok(await snipeit.updateModel(model_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_model",
    {
      description: "Delete an asset model from Snipe-IT",
      inputSchema: {
        model_id: z.number().describe("The ID of the model to delete"),
      },
    },
    async ({ model_id }) => {
      try { return ok(await snipeit.deleteModel(model_id)); }
      catch (e) { return err(e); }
    },
  );

  // ── Categories ──────────────────────────────────────────────────────────

  server.registerTool(
    "list_categories",
    {
      description: "List all categories",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listCategories(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_category",
    {
      description: "Create a new category in Snipe-IT",
      inputSchema: {
        name: z.string().describe("Category name (required)"),
        category_type: z.enum(["asset", "accessory", "consumable", "component", "license"]).describe("Category type (required)"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createCategory(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_category",
    {
      description: "Update an existing category in Snipe-IT",
      inputSchema: {
        category_id: z.number().describe("The ID of the category to update"),
        name: z.string().optional().describe("Category name"),
        category_type: z.enum(["asset", "accessory", "consumable", "component", "license"]).optional().describe("Category type"),
      },
    },
    async ({ category_id, ...data }) => {
      try { return ok(await snipeit.updateCategory(category_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_category",
    {
      description: "Delete a category from Snipe-IT",
      inputSchema: {
        category_id: z.number().describe("The ID of the category to delete"),
      },
    },
    async ({ category_id }) => {
      try { return ok(await snipeit.deleteCategory(category_id)); }
      catch (e) { return err(e); }
    },
  );

  // ── Locations ───────────────────────────────────────────────────────────

  server.registerTool(
    "list_locations",
    {
      description: "List all locations",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500)"),
        offset: z.number().optional().describe("Offset for pagination"),
        search: z.string().optional().describe("Search query to filter locations"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listLocations(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_location",
    {
      description: "Create a new location in Snipe-IT",
      inputSchema: {
        name: z.string().describe("Location name (required)"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        state: z.string().optional().describe("State/Province"),
        country: z.string().optional().describe("Country"),
        zip: z.string().optional().describe("Zip/Postal code"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createLocation(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_location",
    {
      description: "Update an existing location in Snipe-IT",
      inputSchema: {
        location_id: z.number().describe("The ID of the location to update"),
        name: z.string().optional().describe("Location name"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        state: z.string().optional().describe("State/Province"),
        country: z.string().optional().describe("Country"),
        zip: z.string().optional().describe("Zip/Postal code"),
      },
    },
    async ({ location_id, ...data }) => {
      try { return ok(await snipeit.updateLocation(location_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_location",
    {
      description: "Delete a location from Snipe-IT",
      inputSchema: {
        location_id: z.number().describe("The ID of the location to delete"),
      },
    },
    async ({ location_id }) => {
      try { return ok(await snipeit.deleteLocation(location_id)); }
      catch (e) { return err(e); }
    },
  );

  // ── Status Labels ───────────────────────────────────────────────────────

  server.registerTool(
    "list_status_labels",
    {
      description: "List all status labels",
      inputSchema: {},
    },
    async () => {
      try { return ok(await snipeit.listStatusLabels()); }
      catch (e) { return err(e); }
    },
  );

  // ── Manufacturers ───────────────────────────────────────────────────────

  server.registerTool(
    "list_manufacturers",
    {
      description: "List all manufacturers",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listManufacturers(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_manufacturer",
    {
      description: "Create a new manufacturer in Snipe-IT",
      inputSchema: {
        name: z.string().describe("Manufacturer name (required)"),
        url: z.string().optional().describe("Manufacturer website URL"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createManufacturer(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_manufacturer",
    {
      description: "Update an existing manufacturer in Snipe-IT",
      inputSchema: {
        manufacturer_id: z.number().describe("The ID of the manufacturer to update"),
        name: z.string().optional().describe("Manufacturer name"),
        url: z.string().optional().describe("Manufacturer website URL"),
      },
    },
    async ({ manufacturer_id, ...data }) => {
      try { return ok(await snipeit.updateManufacturer(manufacturer_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_manufacturer",
    {
      description: "Delete a manufacturer from Snipe-IT",
      inputSchema: {
        manufacturer_id: z.number().describe("The ID of the manufacturer to delete"),
      },
    },
    async ({ manufacturer_id }) => {
      try { return ok(await snipeit.deleteManufacturer(manufacturer_id)); }
      catch (e) { return err(e); }
    },
  );

  // ── Suppliers ───────────────────────────────────────────────────────────

  server.registerTool(
    "list_suppliers",
    {
      description: "List all suppliers",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (1-500)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.listSuppliers(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "create_supplier",
    {
      description: "Create a new supplier in Snipe-IT",
      inputSchema: {
        name: z.string().describe("Supplier name (required)"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        state: z.string().optional().describe("State/Province"),
        country: z.string().optional().describe("Country"),
        zip: z.string().optional().describe("Zip/Postal code"),
        contact: z.string().optional().describe("Contact person name"),
        phone: z.string().optional().describe("Phone number"),
        email: z.string().optional().describe("Email address"),
        url: z.string().optional().describe("Website URL"),
      },
    },
    async (args) => {
      try { return ok(await snipeit.createSupplier(args)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "update_supplier",
    {
      description: "Update an existing supplier in Snipe-IT",
      inputSchema: {
        supplier_id: z.number().describe("The ID of the supplier to update"),
        name: z.string().optional().describe("Supplier name"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        state: z.string().optional().describe("State/Province"),
        country: z.string().optional().describe("Country"),
        zip: z.string().optional().describe("Zip/Postal code"),
        contact: z.string().optional().describe("Contact person name"),
        phone: z.string().optional().describe("Phone number"),
        email: z.string().optional().describe("Email address"),
        url: z.string().optional().describe("Website URL"),
      },
    },
    async ({ supplier_id, ...data }) => {
      try { return ok(await snipeit.updateSupplier(supplier_id, data)); }
      catch (e) { return err(e); }
    },
  );

  server.registerTool(
    "delete_supplier",
    {
      description: "Delete a supplier from Snipe-IT",
      inputSchema: {
        supplier_id: z.number().describe("The ID of the supplier to delete"),
      },
    },
    async ({ supplier_id }) => {
      try { return ok(await snipeit.deleteSupplier(supplier_id)); }
      catch (e) { return err(e); }
    },
  );

  return server;
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

function checkBearerAuth(request: Request, env: Env): Response | null {
  const expected = env.MCP_BEARER_TOKEN;
  if (!expected) {
    // No token configured — reject all requests rather than running open
    return new Response("Server misconfigured: MCP_BEARER_TOKEN is required.", {
      status: 500,
    });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return new Response("Unauthorized: invalid Authorization header format", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  // Constant-time comparison to prevent timing attacks
  const token = parts[1];
  if (
    token.length !== expected.length ||
    !timingSafeEqual(token, expected)
  ) {
    return new Response("Unauthorized: invalid token", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  return null; // auth passed
}

/** Constant-time string comparison (no crypto.subtle.timingSafeEqual needed). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // Validate required secrets are configured
    if (!env.SNIPEIT_URL || !env.SNIPEIT_API_TOKEN) {
      return new Response(
        "Server misconfigured: SNIPEIT_URL and SNIPEIT_API_TOKEN secrets are required.\n" +
        "See wrangler.toml for Secrets Store setup instructions.",
        { status: 500 },
      );
    }

    const url = new URL(request.url);

    // Health check (unauthenticated)
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    // ── All other routes require bearer token auth ──
    const authErr = checkBearerAuth(request, env);
    if (authErr) return authErr;

    // MCP endpoint (Streamable HTTP)
    if (url.pathname === "/mcp" || url.pathname === "/") {
      const mcpServer = createSnipeITMcpServer(env);
      const handler = createMcpHandler(mcpServer, {
        route: url.pathname === "/" ? "/" : "/mcp",
      });
      return handler(request, env, ctx);
    }

    return new Response("Not found. Use /mcp or /health", { status: 404 });
  },
};
