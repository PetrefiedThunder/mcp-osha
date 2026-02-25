#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-osha", version: "1.0.0" });
const BASE = "https://enforcedata.dol.gov/api";

async function osha(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-API-KEY": process.env.DOL_API_KEY || "" } });
  if (!res.ok) throw new Error(`DOL/OSHA API ${res.status}: ${await res.text()}`);
  return res.json();
}

server.tool("search_inspections", "Search OSHA workplace inspections", {
  establishment: z.string().optional().describe("Establishment name (partial match)"),
  state: z.string().optional().describe("Two-letter state code"),
  sic_code: z.string().optional().describe("SIC industry code"),
  start_date: z.string().optional().describe("Inspection start date (YYYY-MM-DD)"),
  end_date: z.string().optional().describe("Inspection end date (YYYY-MM-DD)"),
  limit: z.number().default(10),
}, async ({ establishment, state, sic_code, start_date, end_date, limit }) => {
  const params = new URLSearchParams();
  if (establishment) params.set("establishment_name", establishment);
  if (state) params.set("site_state", state);
  if (sic_code) params.set("sic_code", sic_code);
  if (start_date) params.set("open_date_from", start_date);
  if (end_date) params.set("open_date_to", end_date);
  params.set("limit", String(limit));
  const data = await osha(`/inspect?${params}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("search_violations", "Search OSHA violations", {
  establishment: z.string().optional().describe("Establishment name"),
  state: z.string().optional().describe("Two-letter state code"),
  standard: z.string().optional().describe("OSHA standard number (e.g., 1910.147)"),
  violation_type: z.enum(["S", "W", "R", "O"]).optional().describe("Type: S=Serious, W=Willful, R=Repeat, O=Other"),
  limit: z.number().default(10),
}, async ({ establishment, state, standard, violation_type, limit }) => {
  const params = new URLSearchParams();
  if (establishment) params.set("establishment_name", establishment);
  if (state) params.set("site_state", state);
  if (standard) params.set("standard", standard);
  if (violation_type) params.set("viol_type", violation_type);
  params.set("limit", String(limit));
  const data = await osha(`/violation?${params}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("search_accidents", "Search OSHA accident/injury reports", {
  state: z.string().optional().describe("Two-letter state code"),
  event_keyword: z.string().optional().describe("Keyword in event description"),
  degree: z.enum(["fatality", "hospitalization", "amputation", "loss_of_eye"]).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  limit: z.number().default(10),
}, async ({ state, event_keyword, degree, start_date, end_date, limit }) => {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (event_keyword) params.set("keyword", event_keyword);
  if (degree) params.set("degree", degree);
  if (start_date) params.set("event_date_from", start_date);
  if (end_date) params.set("event_date_to", end_date);
  params.set("limit", String(limit));
  const data = await osha(`/accident?${params}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("lookup_standard", "Look up an OSHA standard by number", {
  standard: z.string().describe("Standard number (e.g., 1910.147, 1926.501)"),
}, async ({ standard }) => {
  const url = `https://www.osha.gov/laws-regs/regulations/standardnumber/${standard.split(".")[0]}/${standard}`;
  return { content: [{ type: "text", text: JSON.stringify({ standard, url, note: "OSHA standards are HTML pages; use this URL to access full text." }, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
