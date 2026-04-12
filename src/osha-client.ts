const BASE = "https://enforcedata.dol.gov/api";

export const defaults = {
  timeoutMs: 30_000,
  maxRetries: 3,
  initialBackoffMs: 1_000,
};

export class OshaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`DOL/OSHA API ${status}: ${body}`);
    this.name = "OshaApiError";
  }
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

const defaultLogger: Logger = {
  info(msg, data) {
    console.error(JSON.stringify({ level: "info", msg, ...data }));
  },
  warn(msg, data) {
    console.error(JSON.stringify({ level: "warn", msg, ...data }));
  },
  error(msg, data) {
    console.error(JSON.stringify({ level: "error", msg, ...data }));
  },
};

let logger: Logger = defaultLogger;

export function setLogger(l: Logger) {
  logger = l;
}

export function validateApiKey(): void {
  if (!process.env.DOL_API_KEY) {
    throw new Error(
      "DOL_API_KEY environment variable is required. " +
        "Get an API key at https://developer.dol.gov/",
    );
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function osha(path: string): Promise<unknown> {
  const url = `${BASE}${path}`;
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= defaults.maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = defaults.initialBackoffMs * 2 ** (attempt - 1);
      logger.warn("Retrying DOL/OSHA API request", { path, attempt, backoff_ms: backoff });
      await sleep(backoff);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), defaults.timeoutMs);

      try {
        const res = await fetch(url, {
          headers: { "X-API-KEY": process.env.DOL_API_KEY || "" },
          signal: controller.signal,
        });

        if (res.status === 429 && attempt < defaults.maxRetries) {
          lastError = new OshaApiError(429, "Rate limited");
          logger.warn("Rate limited by DOL/OSHA API", { path, attempt });
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          throw new OshaApiError(res.status, body);
        }

        const data = await res.json();
        const duration = Date.now() - start;
        logger.info("DOL/OSHA API request completed", {
          path,
          status: res.status,
          duration_ms: duration,
          attempts: attempt + 1,
        });
        return data;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      lastError = err;

      if (err instanceof OshaApiError && err.status !== 429) {
        const duration = Date.now() - start;
        logger.error("DOL/OSHA API error", {
          path,
          status: err.status,
          duration_ms: duration,
          body: err.body,
        });
        throw err;
      }

      if (err instanceof DOMException && err.name === "AbortError") {
        const duration = Date.now() - start;
        logger.error("DOL/OSHA API request timed out", {
          path,
          timeout_ms: defaults.timeoutMs,
          duration_ms: duration,
        });
        throw new Error(`DOL/OSHA API request timed out after ${defaults.timeoutMs}ms`);
      }

      if (!(err instanceof OshaApiError) && attempt >= defaults.maxRetries) {
        const duration = Date.now() - start;
        logger.error("DOL/OSHA API network error", {
          path,
          duration_ms: duration,
          error: String(err),
        });
        throw err;
      }
    }
  }

  throw lastError;
}
