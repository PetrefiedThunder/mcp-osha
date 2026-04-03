import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// --- Mock the MCP SDK ---
const mockTool = vi.fn();
const mockConnect = vi.fn();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool = mockTool;
    connect = mockConnect;
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

// --- Mock global fetch ---
const mockFetch = vi.fn();

// --- Capture tool handlers after single import ---
let toolHandlers: Record<string, Function> = {};

beforeAll(async () => {
  vi.stubGlobal("fetch", mockFetch);
  process.env.DOL_API_KEY = "test-key";

  await import("./index.js");

  for (const call of mockTool.mock.calls) {
    const [name, _desc, _schema, handler] = call;
    toolHandlers[name] = handler;
  }
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.DOL_API_KEY = "test-key";
});

afterEach(() => {
  process.env.DOL_API_KEY = "test-key";
});

function mockOk(data: unknown = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockError(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ============================================================
// 1. osha() API helper — tested indirectly through tool handlers
// ============================================================
describe("osha() API helper", () => {
  it("sends request with X-API-KEY header", async () => {
    mockOk();
    await toolHandlers["search_inspections"]({ limit: 5 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-API-KEY"]).toBe("test-key");
  });

  it("uses empty string when DOL_API_KEY is not set", async () => {
    delete process.env.DOL_API_KEY;
    mockOk();

    await toolHandlers["search_inspections"]({ limit: 1 });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-API-KEY"]).toBe("");
  });

  it("throws on non-ok response with status and body", async () => {
    mockError(403, "Forbidden");

    await expect(
      toolHandlers["search_inspections"]({ limit: 1 })
    ).rejects.toThrow("DOL/OSHA API 403: Forbidden");
  });

  it("propagates network errors from fetch", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(
      toolHandlers["search_inspections"]({ limit: 1 })
    ).rejects.toThrow("Network error");
  });
});

// ============================================================
// 2. search_inspections
// ============================================================
describe("search_inspections", () => {
  it("is registered as a tool", () => {
    expect(toolHandlers["search_inspections"]).toBeDefined();
  });

  it("builds correct query params with all parameters", async () => {
    mockOk();

    await toolHandlers["search_inspections"]({
      establishment: "Acme Corp",
      state: "TX",
      sic_code: "2011",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      limit: 20,
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("establishment_name")).toBe("Acme Corp");
    expect(url.searchParams.get("site_state")).toBe("TX");
    expect(url.searchParams.get("sic_code")).toBe("2011");
    expect(url.searchParams.get("open_date_from")).toBe("2024-01-01");
    expect(url.searchParams.get("open_date_to")).toBe("2024-12-31");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("omits optional params when undefined", async () => {
    mockOk();

    await toolHandlers["search_inspections"]({ limit: 10 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has("establishment_name")).toBe(false);
    expect(url.searchParams.has("site_state")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("returns MCP-formatted content", async () => {
    const data = [{ id: 1, name: "Test" }];
    mockOk(data);

    const result = await toolHandlers["search_inspections"]({ limit: 1 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    });
  });

  it("calls the /inspect endpoint", async () => {
    mockOk();

    await toolHandlers["search_inspections"]({ limit: 1 });

    expect(mockFetch.mock.calls[0][0]).toContain("/api/inspect?");
  });
});

// ============================================================
// 3. search_violations
// ============================================================
describe("search_violations", () => {
  it("maps violation_type to viol_type query param", async () => {
    mockOk();

    await toolHandlers["search_violations"]({
      violation_type: "S",
      limit: 5,
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("viol_type")).toBe("S");
    expect(url.searchParams.has("violation_type")).toBe(false);
  });

  it("maps all parameters to correct API field names", async () => {
    mockOk();

    await toolHandlers["search_violations"]({
      establishment: "Factory",
      state: "CA",
      standard: "1910.147",
      violation_type: "W",
      limit: 15,
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("establishment_name")).toBe("Factory");
    expect(url.searchParams.get("site_state")).toBe("CA");
    expect(url.searchParams.get("standard")).toBe("1910.147");
    expect(url.searchParams.get("viol_type")).toBe("W");
    expect(url.searchParams.get("limit")).toBe("15");
  });

  it("calls the /violation endpoint", async () => {
    mockOk();

    await toolHandlers["search_violations"]({ limit: 1 });

    expect(mockFetch.mock.calls[0][0]).toContain("/api/violation?");
  });
});

// ============================================================
// 4. search_accidents
// ============================================================
describe("search_accidents", () => {
  it("maps event_keyword to keyword query param", async () => {
    mockOk();

    await toolHandlers["search_accidents"]({
      event_keyword: "fall",
      limit: 5,
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("keyword")).toBe("fall");
  });

  it("maps date params to event_date_from/to", async () => {
    mockOk();

    await toolHandlers["search_accidents"]({
      start_date: "2024-01-01",
      end_date: "2024-06-30",
      limit: 5,
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("event_date_from")).toBe("2024-01-01");
    expect(url.searchParams.get("event_date_to")).toBe("2024-06-30");
  });

  it("passes degree and state directly", async () => {
    mockOk();

    await toolHandlers["search_accidents"]({
      state: "NY",
      degree: "fatality",
      limit: 3,
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("state")).toBe("NY");
    expect(url.searchParams.get("degree")).toBe("fatality");
  });

  it("calls the /accident endpoint", async () => {
    mockOk();

    await toolHandlers["search_accidents"]({ limit: 1 });

    expect(mockFetch.mock.calls[0][0]).toContain("/api/accident?");
  });
});

// ============================================================
// 5. lookup_standard — URL construction
// ============================================================
describe("lookup_standard", () => {
  it("constructs correct OSHA URL for standard 1910.147", async () => {
    const result = await toolHandlers["lookup_standard"]({
      standard: "1910.147",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147"
    );
    expect(parsed.standard).toBe("1910.147");
  });

  it("constructs correct OSHA URL for standard 1926.501", async () => {
    const result = await toolHandlers["lookup_standard"]({
      standard: "1926.501",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.501"
    );
  });

  it("does not call the DOL API", async () => {
    await toolHandlers["lookup_standard"]({ standard: "1910.147" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("includes a note about HTML pages", async () => {
    const result = await toolHandlers["lookup_standard"]({
      standard: "1910.147",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.note).toContain("HTML");
  });

  it("handles standard without a dot", async () => {
    const result = await toolHandlers["lookup_standard"]({
      standard: "1910",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910"
    );
  });
});

// ============================================================
// 6. Server registration
// ============================================================
describe("server setup", () => {
  it("registers all 4 tools", () => {
    const toolNames = mockTool.mock.calls.map((c: unknown[]) => c[0]);
    expect(toolNames).toContain("search_inspections");
    expect(toolNames).toContain("search_violations");
    expect(toolNames).toContain("search_accidents");
    expect(toolNames).toContain("lookup_standard");
    expect(toolNames).toHaveLength(4);
  });

  it("connects to transport", () => {
    expect(mockConnect).toHaveBeenCalledOnce();
  });
});
