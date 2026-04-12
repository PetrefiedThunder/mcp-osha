import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after stubbing fetch
const { osha } = await import("./osha-client.js");

beforeEach(() => {
  mockFetch.mockReset();
  process.env.DOL_API_KEY = "test-key";
});

function mockOk(data: unknown = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe("osha()", () => {
  it("sends GET request to correct base URL + path", async () => {
    mockOk();
    await osha("/inspect?limit=5");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://enforcedata.dol.gov/api/inspect?limit=5",
      expect.objectContaining({ headers: { "X-API-KEY": "test-key" } })
    );
  });

  it("includes X-API-KEY from environment", async () => {
    process.env.DOL_API_KEY = "my-secret";
    mockOk();
    await osha("/test");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-API-KEY"]).toBe("my-secret");
  });

  it("falls back to empty string when DOL_API_KEY is unset", async () => {
    delete process.env.DOL_API_KEY;
    mockOk();
    await osha("/test");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-API-KEY"]).toBe("");
  });

  it("returns parsed JSON on success", async () => {
    const data = [{ id: 1 }, { id: 2 }];
    mockOk(data);

    const result = await osha("/test");
    expect(result).toEqual(data);
  });

  it("returns empty array from API", async () => {
    mockOk([]);
    const result = await osha("/test");
    expect(result).toEqual([]);
  });

  it("throws with status and body on 400", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request: invalid parameter"),
    });

    await expect(osha("/test")).rejects.toThrow(
      "DOL/OSHA API 400: Bad Request: invalid parameter"
    );
  });

  it("throws with status and body on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(osha("/test")).rejects.toThrow("DOL/OSHA API 401: Unauthorized");
  });

  it("throws with status and body on 403", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });

    await expect(osha("/test")).rejects.toThrow("DOL/OSHA API 403: Forbidden");
  });

  it("throws with status and body on 500", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(osha("/test")).rejects.toThrow("DOL/OSHA API 500: Internal Server Error");
  });

  it("propagates network errors", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(osha("/test")).rejects.toThrow("fetch failed");
  });

  it("propagates DNS resolution errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND enforcedata.dol.gov"));

    await expect(osha("/test")).rejects.toThrow("ENOTFOUND");
  });
});
