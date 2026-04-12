import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

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

// --- Mock fetch globally ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// --- Silence logger ---
vi.mock("./osha-client.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./osha-client.js")>();
  mod.setLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  mod.defaults.initialBackoffMs = 0;
  return mod;
});

// --- Capture tool handlers and schemas after single import ---
type ToolRegistration = {
  handler: Function;
  schema: Record<string, unknown>;
  description: string;
};
let tools: Record<string, ToolRegistration> = {};

beforeAll(async () => {
  process.env.DOL_API_KEY = "test-key";
  await import("./index.js");

  for (const call of mockTool.mock.calls) {
    const [name, desc, schema, handler] = call;
    tools[name] = { handler, schema, description: desc };
  }
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.DOL_API_KEY = "test-key";
});

function mockOk(data: unknown = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
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
// Server registration
// ============================================================
describe("server setup", () => {
  it("registers exactly 4 tools", () => {
    expect(Object.keys(tools)).toHaveLength(4);
  });

  it("registers search_inspections", () => {
    expect(tools["search_inspections"]).toBeDefined();
    expect(tools["search_inspections"].description).toBe("Search OSHA workplace inspections");
  });

  it("registers search_violations", () => {
    expect(tools["search_violations"]).toBeDefined();
    expect(tools["search_violations"].description).toBe("Search OSHA violations");
  });

  it("registers search_accidents", () => {
    expect(tools["search_accidents"]).toBeDefined();
    expect(tools["search_accidents"].description).toBe("Search OSHA accident/injury reports");
  });

  it("registers lookup_standard", () => {
    expect(tools["lookup_standard"]).toBeDefined();
    expect(tools["lookup_standard"].description).toBe("Look up an OSHA standard by number");
  });

  it("connects to transport", () => {
    expect(mockConnect).toHaveBeenCalledOnce();
  });
});

// ============================================================
// search_inspections
// ============================================================
describe("search_inspections", () => {
  const call = (params: Record<string, unknown>) =>
    tools["search_inspections"].handler(params);

  it("builds correct query params with all parameters", async () => {
    mockOk();
    await call({
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
    await call({ limit: 10 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has("establishment_name")).toBe(false);
    expect(url.searchParams.has("site_state")).toBe(false);
    expect(url.searchParams.has("sic_code")).toBe(false);
    expect(url.searchParams.has("open_date_from")).toBe(false);
    expect(url.searchParams.has("open_date_to")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("returns MCP-formatted content", async () => {
    const data = [{ activity_nr: 123, estab_name: "Test Co" }];
    mockOk(data);

    const result = await call({ limit: 1 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    });
  });

  it("calls the /inspect endpoint", async () => {
    mockOk();
    await call({ limit: 1 });
    expect(mockFetch.mock.calls[0][0]).toContain("/api/inspect?");
  });

  it("handles empty API response", async () => {
    mockOk([]);
    const result = await call({ limit: 1 });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it("handles large result set", async () => {
    const bigData = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    mockOk(bigData);
    const result = await call({ limit: 100 });
    expect(JSON.parse(result.content[0].text)).toHaveLength(100);
  });

  it("URL-encodes special characters in establishment name", async () => {
    mockOk();
    await call({ establishment: "O'Brien & Sons", limit: 1 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("establishment_name=O%27Brien+%26+Sons");
  });
});

// ============================================================
// search_violations
// ============================================================
describe("search_violations", () => {
  const call = (params: Record<string, unknown>) =>
    tools["search_violations"].handler(params);

  it("maps violation_type to viol_type query param", async () => {
    mockOk();
    await call({ violation_type: "S", limit: 5 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("viol_type")).toBe("S");
    expect(url.searchParams.has("violation_type")).toBe(false);
  });

  it("maps all parameters to correct API field names", async () => {
    mockOk();
    await call({
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
    await call({ limit: 1 });
    expect(mockFetch.mock.calls[0][0]).toContain("/api/violation?");
  });

  it("passes each violation type correctly", async () => {
    for (const type of ["S", "W", "R", "O"]) {
      mockOk();
      await call({ violation_type: type, limit: 1 });

      const url = new URL(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0]);
      expect(url.searchParams.get("viol_type")).toBe(type);
    }
  });

  it("omits optional params when undefined", async () => {
    mockOk();
    await call({ limit: 5 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has("establishment_name")).toBe(false);
    expect(url.searchParams.has("site_state")).toBe(false);
    expect(url.searchParams.has("standard")).toBe(false);
    expect(url.searchParams.has("viol_type")).toBe(false);
  });
});

// ============================================================
// search_accidents
// ============================================================
describe("search_accidents", () => {
  const call = (params: Record<string, unknown>) =>
    tools["search_accidents"].handler(params);

  it("maps event_keyword to keyword query param", async () => {
    mockOk();
    await call({ event_keyword: "fall", limit: 5 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("keyword")).toBe("fall");
  });

  it("maps date params to event_date_from/to", async () => {
    mockOk();
    await call({
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
    await call({ state: "NY", degree: "fatality", limit: 3 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("state")).toBe("NY");
    expect(url.searchParams.get("degree")).toBe("fatality");
  });

  it("calls the /accident endpoint", async () => {
    mockOk();
    await call({ limit: 1 });
    expect(mockFetch.mock.calls[0][0]).toContain("/api/accident?");
  });

  it("passes all degree enum values", async () => {
    for (const deg of ["fatality", "hospitalization", "amputation", "loss_of_eye"]) {
      mockOk();
      await call({ degree: deg, limit: 1 });

      const url = new URL(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0]);
      expect(url.searchParams.get("degree")).toBe(deg);
    }
  });

  it("omits optional params when undefined", async () => {
    mockOk();
    await call({ limit: 1 });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.has("keyword")).toBe(false);
    expect(url.searchParams.has("degree")).toBe(false);
    expect(url.searchParams.has("event_date_from")).toBe(false);
    expect(url.searchParams.has("event_date_to")).toBe(false);
  });
});

// ============================================================
// lookup_standard — URL construction
// ============================================================
describe("lookup_standard", () => {
  const call = (params: Record<string, unknown>) =>
    tools["lookup_standard"].handler(params);

  it("constructs correct URL for 1910.147", async () => {
    const result = await call({ standard: "1910.147" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147"
    );
    expect(parsed.standard).toBe("1910.147");
  });

  it("constructs correct URL for 1926.501", async () => {
    const result = await call({ standard: "1926.501" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.501"
    );
  });

  it("handles sub-section standards like 1926.501.1", async () => {
    const result = await call({ standard: "1926.501.1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(
      "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.501.1"
    );
  });

  it("does not call the DOL API", async () => {
    await call({ standard: "1910.147" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("includes a note about HTML pages", async () => {
    const result = await call({ standard: "1910.147" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.note).toContain("HTML");
  });

  it("returns MCP-formatted content", async () => {
    const result = await call({ standard: "1910.147" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });
});

// ============================================================
// Structured error responses (safeTool)
// ============================================================
describe("structured error responses", () => {
  const call = (params: Record<string, unknown>) =>
    tools["search_inspections"].handler(params);

  it("returns isError on API failure instead of throwing", async () => {
    mockError(500, "Internal Server Error");

    const result = await call({ limit: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("500");
    expect(result.content[0].text).toContain("Internal Server Error");
  });

  it("returns isError on 403 Forbidden", async () => {
    mockError(403, "Forbidden");

    const result = await call({ limit: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("403");
  });

  it("returns isError on network failure", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const result = await call({ limit: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("fetch failed");
  });

  it("returns isError with response shape mismatch info", async () => {
    // Return something that's not an array
    mockOk("not an array");

    const result = await call({ limit: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unexpected API response shape");
  });

  it("does not set isError on success", async () => {
    mockOk([]);

    const result = await call({ limit: 1 });

    expect(result.isError).toBeUndefined();
  });
});

// ============================================================
// Response validation
// ============================================================
describe("response validation", () => {
  it("accepts valid inspection response with extra fields", async () => {
    mockOk([{ activity_nr: 123, estab_name: "Test", extra_field: true }]);

    const result = await tools["search_inspections"].handler({ limit: 1 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toHaveLength(1);
  });

  it("accepts valid violation response", async () => {
    mockOk([{ activity_nr: 456, viol_type: "S", standard: "1910.147" }]);

    const result = await tools["search_violations"].handler({ limit: 1 });

    expect(result.isError).toBeUndefined();
  });

  it("accepts valid accident response", async () => {
    mockOk([{ summary_nr: 789, event_desc: "Fall from height" }]);

    const result = await tools["search_accidents"].handler({ limit: 1 });

    expect(result.isError).toBeUndefined();
  });

  it("rejects non-array inspection response", async () => {
    mockOk({ error: "unexpected" });

    const result = await tools["search_inspections"].handler({ limit: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unexpected API response shape");
  });

  it("rejects non-array violation response", async () => {
    mockOk("string response");

    const result = await tools["search_violations"].handler({ limit: 1 });

    expect(result.isError).toBe(true);
  });

  it("rejects non-array accident response", async () => {
    mockOk(42);

    const result = await tools["search_accidents"].handler({ limit: 1 });

    expect(result.isError).toBe(true);
  });
});

// ============================================================
// Zod schema validation
// ============================================================
describe("input validation schemas", () => {
  const inspections = () => tools["search_inspections"].schema as any;
  const violations = () => tools["search_violations"].schema as any;

  describe("state code", () => {
    it("accepts valid two-letter state codes", () => {
      expect(inspections().state.safeParse("TX").success).toBe(true);
      expect(inspections().state.safeParse("CA").success).toBe(true);
      expect(inspections().state.safeParse("NY").success).toBe(true);
    });

    it("rejects lowercase state codes", () => {
      expect(inspections().state.safeParse("tx").success).toBe(false);
    });

    it("rejects three-letter codes", () => {
      expect(inspections().state.safeParse("TEX").success).toBe(false);
    });

    it("rejects single-letter codes", () => {
      expect(inspections().state.safeParse("T").success).toBe(false);
    });

    it("rejects numeric codes", () => {
      expect(inspections().state.safeParse("12").success).toBe(false);
    });

    it("accepts undefined (optional)", () => {
      expect(inspections().state.safeParse(undefined).success).toBe(true);
    });
  });

  describe("date format", () => {
    it("accepts valid YYYY-MM-DD dates", () => {
      expect(inspections().start_date.safeParse("2024-01-15").success).toBe(true);
      expect(inspections().start_date.safeParse("2023-12-31").success).toBe(true);
    });

    it("rejects MM/DD/YYYY format", () => {
      expect(inspections().start_date.safeParse("01/15/2024").success).toBe(false);
    });

    it("rejects DD-MM-YYYY format", () => {
      expect(inspections().start_date.safeParse("15-01-2024").success).toBe(false);
    });

    it("rejects bare year", () => {
      expect(inspections().start_date.safeParse("2024").success).toBe(false);
    });

    it("rejects empty string", () => {
      expect(inspections().start_date.safeParse("").success).toBe(false);
    });

    it("accepts undefined (optional)", () => {
      expect(inspections().start_date.safeParse(undefined).success).toBe(true);
    });
  });

  describe("SIC code", () => {
    it("accepts valid 4-digit SIC codes", () => {
      expect(inspections().sic_code.safeParse("2011").success).toBe(true);
      expect(inspections().sic_code.safeParse("3599").success).toBe(true);
    });

    it("rejects 3-digit codes", () => {
      expect(inspections().sic_code.safeParse("201").success).toBe(false);
    });

    it("rejects 5-digit codes", () => {
      expect(inspections().sic_code.safeParse("20110").success).toBe(false);
    });

    it("rejects non-numeric", () => {
      expect(inspections().sic_code.safeParse("ABCD").success).toBe(false);
    });
  });

  describe("OSHA standard number", () => {
    it("accepts valid standards", () => {
      expect(violations().standard.safeParse("1910.147").success).toBe(true);
      expect(violations().standard.safeParse("1926.501").success).toBe(true);
    });

    it("rejects standard without a dot", () => {
      expect(violations().standard.safeParse("1910").success).toBe(false);
    });

    it("rejects non-numeric prefix", () => {
      expect(violations().standard.safeParse("OSHA.147").success).toBe(false);
    });
  });

  describe("limit", () => {
    it("accepts valid limits", () => {
      expect(inspections().limit.safeParse(1).success).toBe(true);
      expect(inspections().limit.safeParse(50).success).toBe(true);
      expect(inspections().limit.safeParse(100).success).toBe(true);
    });

    it("rejects zero", () => {
      expect(inspections().limit.safeParse(0).success).toBe(false);
    });

    it("rejects negative numbers", () => {
      expect(inspections().limit.safeParse(-1).success).toBe(false);
    });

    it("rejects numbers over 100", () => {
      expect(inspections().limit.safeParse(101).success).toBe(false);
    });

    it("rejects floats", () => {
      expect(inspections().limit.safeParse(5.5).success).toBe(false);
    });
  });
});
