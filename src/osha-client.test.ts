import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { osha, validateApiKey, OshaApiError, setLogger, defaults } = await import("./osha-client.js");

// Silence logging during tests
const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
setLogger(noopLogger);

// Use zero backoff for fast tests
defaults.initialBackoffMs = 0;

beforeEach(() => {
  mockFetch.mockReset();
  noopLogger.info.mockClear();
  noopLogger.warn.mockClear();
  noopLogger.error.mockClear();
  process.env.DOL_API_KEY = "test-key";
});

function mockOk(data: unknown = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

function mockStatus(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ============================================================
// validateApiKey()
// ============================================================
describe("validateApiKey()", () => {
  it("succeeds when DOL_API_KEY is set", () => {
    process.env.DOL_API_KEY = "some-key";
    expect(() => validateApiKey()).not.toThrow();
  });

  it("throws when DOL_API_KEY is empty", () => {
    process.env.DOL_API_KEY = "";
    expect(() => validateApiKey()).toThrow("DOL_API_KEY environment variable is required");
  });

  it("throws when DOL_API_KEY is missing", () => {
    delete process.env.DOL_API_KEY;
    expect(() => validateApiKey()).toThrow("DOL_API_KEY environment variable is required");
  });

  it("includes signup URL in error message", () => {
    delete process.env.DOL_API_KEY;
    expect(() => validateApiKey()).toThrow("https://developer.dol.gov/");
  });
});

// ============================================================
// OshaApiError
// ============================================================
describe("OshaApiError", () => {
  it("stores status and body", () => {
    const err = new OshaApiError(403, "Forbidden");
    expect(err.status).toBe(403);
    expect(err.body).toBe("Forbidden");
    expect(err.message).toBe("DOL/OSHA API 403: Forbidden");
    expect(err.name).toBe("OshaApiError");
  });

  it("is an instance of Error", () => {
    expect(new OshaApiError(500, "fail")).toBeInstanceOf(Error);
  });
});

// ============================================================
// osha() — basic requests
// ============================================================
describe("osha()", () => {
  it("sends request to correct base URL + path", async () => {
    mockOk();
    await osha("/inspect?limit=5");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://enforcedata.dol.gov/api/inspect?limit=5",
      expect.objectContaining({
        headers: { "X-API-KEY": "test-key" },
      }),
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
    expect(await osha("/test")).toEqual(data);
  });

  it("returns empty array from API", async () => {
    mockOk([]);
    expect(await osha("/test")).toEqual([]);
  });

  it("passes AbortSignal to fetch", async () => {
    mockOk();
    await osha("/test");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

// ============================================================
// osha() — error handling
// ============================================================
describe("osha() error handling", () => {
  it("throws OshaApiError on 400", async () => {
    mockStatus(400, "Bad Request");
    await expect(osha("/test")).rejects.toThrow(OshaApiError);
  });

  it("throws OshaApiError with status and body on 403", async () => {
    mockStatus(403, "Forbidden");
    try {
      await osha("/test");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OshaApiError);
      expect((err as InstanceType<typeof OshaApiError>).status).toBe(403);
      expect((err as InstanceType<typeof OshaApiError>).body).toBe("Forbidden");
    }
  });

  it("throws OshaApiError on 500", async () => {
    mockStatus(500, "Internal Server Error");
    await expect(osha("/test")).rejects.toThrow("DOL/OSHA API 500");
  });

  it("does not retry on 400 errors", async () => {
    mockStatus(400, "Bad request");
    await expect(osha("/test")).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 403 errors", async () => {
    mockStatus(403, "Forbidden");
    await expect(osha("/test")).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 500 errors", async () => {
    mockStatus(500, "Server error");
    await expect(osha("/test")).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates network errors after retries", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(osha("/test")).rejects.toThrow("fetch failed");
    // 1 initial + 3 retries = 4 total
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("throws timeout error when request is aborted", async () => {
    mockFetch.mockImplementationOnce(() => {
      const err = new DOMException("signal is aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(osha("/test")).rejects.toThrow("timed out");
  });
});

// ============================================================
// osha() — retry on 429
// ============================================================
describe("osha() retry on 429", () => {
  it("retries on 429 and succeeds", async () => {
    mockStatus(429, "Rate limited");
    mockOk([{ id: 1 }]);

    const result = await osha("/test");
    expect(result).toEqual([{ id: 1 }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times on 429 then throws", async () => {
    mockStatus(429, "Rate limited");
    mockStatus(429, "Rate limited");
    mockStatus(429, "Rate limited");
    mockStatus(429, "Rate limited");

    const promise = osha("/test");
    await expect(promise).rejects.toThrow(OshaApiError);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("logs warnings on retry", async () => {
    mockStatus(429, "Rate limited");
    mockOk();

    await osha("/test");
    expect(noopLogger.warn).toHaveBeenCalled();
  });
});

// ============================================================
// osha() — logging
// ============================================================
describe("osha() logging", () => {
  it("logs info on successful request", async () => {
    mockOk([]);
    await osha("/inspect?limit=1");

    expect(noopLogger.info).toHaveBeenCalledWith(
      "DOL/OSHA API request completed",
      expect.objectContaining({
        path: "/inspect?limit=1",
        status: 200,
      }),
    );
  });

  it("logs error on API failure", async () => {
    mockStatus(500, "Server error");
    await expect(osha("/test")).rejects.toThrow();

    expect(noopLogger.error).toHaveBeenCalledWith(
      "DOL/OSHA API error",
      expect.objectContaining({ status: 500, body: "Server error" }),
    );
  });

  it("logs duration in milliseconds", async () => {
    mockOk();
    await osha("/test");

    const logData = noopLogger.info.mock.calls[0][1];
    expect(logData).toHaveProperty("duration_ms");
    expect(typeof logData.duration_ms).toBe("number");
  });
});
