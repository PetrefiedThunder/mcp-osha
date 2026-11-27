import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Preserve server startup calls recorded in beforeAll for setup assertions.
    clearMocks: false,
  },
});
