#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { osha, validateApiKey, OshaApiError } from "./osha-client.js";

validateApiKey();

const server = new McpServer({ name: "mcp-osha", version: "1.0.0" });

// --- Shared schemas ---

const stateCode = z
  .string()
  .regex(/^[A-Z]{2}$/, "Must be a two-letter state code (e.g. TX, CA)")
  .optional()
  .describe("Two-letter state code");

const dateString = z.iso.date().optional();

// --- Response schemas ---

const inspectionSchema = z.array(
  z.object({
    activity_nr: z.number().optional(),
    estab_name: z.string().optional(),
    site_state: z.string().optional(),
    open_date: z.string().optional(),
  }).passthrough(),
);

const violationSchema = z.array(
  z.object({
    activity_nr: z.number().optional(),
    estab_name: z.string().optional(),
    viol_type: z.string().optional(),
    standard: z.string().optional(),
  }).passthrough(),
);

const accidentSchema = z.array(
  z.object({
    summary_nr: z.number().optional(),
    event_desc: z.string().optional(),
    event_date: z.string().optional(),
  }).passthrough(),
);

// --- Helpers ---

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function mcpError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

async function safeTool<T>(
  fn: () => Promise<T>,
  responseSchema?: z.ZodType<T>,
): Promise<ReturnType<typeof mcpText> | ReturnType<typeof mcpError>> {
  try {
    const data = await fn();
    if (responseSchema) {
      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) {
        return mcpError(
          `Unexpected API response shape: ${parsed.error.message}\n\nRaw response:\n${JSON.stringify(data, null, 2)}`,
        );
      }
    }
    return mcpText(data);
  } catch (err) {
    if (err instanceof OshaApiError) {
      return mcpError(`DOL/OSHA API error ${err.status}: ${err.body}`);
    }
    return mcpError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Tools ---

server.tool("search_inspections", "Search OSHA workplace inspections", {
  establishment: z.string().optional().describe("Establishment name (partial match)"),
  state: stateCode,
  sic_code: z.string().regex(/^\d{4}$/, "Must be a 4-digit SIC code").optional().describe("SIC industry code"),
  start_date: dateString.describe("Inspection start date (YYYY-MM-DD)"),
  end_date: dateString.describe("Inspection end date (YYYY-MM-DD)"),
  limit: z.number().int().min(1).max(100).default(10),
}, async ({ establishment, state, sic_code, start_date, end_date, limit }) => {
  const params = new URLSearchParams();
  if (establishment) params.set("establishment_name", establishment);
  if (state) params.set("site_state", state);
  if (sic_code) params.set("sic_code", sic_code);
  if (start_date) params.set("open_date_from", start_date);
  if (end_date) params.set("open_date_to", end_date);
  params.set("limit", String(limit));
  return safeTool(() => osha(`/inspect?${params}`), inspectionSchema);
});

server.tool("search_violations", "Search OSHA violations", {
  establishment: z.string().optional().describe("Establishment name"),
  state: stateCode,
  standard: z.string().regex(/^\d{4}(\.\d+)+$/, "Must be a valid OSHA standard (e.g. 1910.147)").optional().describe("OSHA standard number (e.g., 1910.147)"),
  violation_type: z.enum(["S", "W", "R", "O"]).optional().describe("Type: S=Serious, W=Willful, R=Repeat, O=Other"),
  limit: z.number().int().min(1).max(100).default(10),
}, async ({ establishment, state, standard, violation_type, limit }) => {
  const params = new URLSearchParams();
  if (establishment) params.set("establishment_name", establishment);
  if (state) params.set("site_state", state);
  if (standard) params.set("standard", standard);
  if (violation_type) params.set("viol_type", violation_type);
  params.set("limit", String(limit));
  return safeTool(() => osha(`/violation?${params}`), violationSchema);
});

server.tool("search_accidents", "Search OSHA accident/injury reports", {
  state: stateCode,
  event_keyword: z.string().optional().describe("Keyword in event description"),
  degree: z.enum(["fatality", "hospitalization", "amputation", "loss_of_eye"]).optional(),
  start_date: dateString,
  end_date: dateString,
  limit: z.number().int().min(1).max(100).default(10),
}, async ({ state, event_keyword, degree, start_date, end_date, limit }) => {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (event_keyword) params.set("keyword", event_keyword);
  if (degree) params.set("degree", degree);
  if (start_date) params.set("event_date_from", start_date);
  if (end_date) params.set("event_date_to", end_date);
  params.set("limit", String(limit));
  return safeTool(() => osha(`/accident?${params}`), accidentSchema);
});

server.tool("lookup_standard", "Look up an OSHA standard by number", {
  standard: z.string().regex(/^\d{4}(\.\d+)+$/, "Must be a valid OSHA standard (e.g. 1910.147, 1926.501)").describe("Standard number (e.g., 1910.147, 1926.501)"),
}, async ({ standard }) => {
  const part = standard.split(".")[0];
  const url = `https://www.osha.gov/laws-regs/regulations/standardnumber/${part}/${standard}`;
  return mcpText({ standard, url, note: "OSHA standards are HTML pages; use this URL to access full text." });
});

const transport = new StdioServerTransport();
await server.connect(transport);
