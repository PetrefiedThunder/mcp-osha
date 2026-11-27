# Development

The Vitest 5 test suite requires Node.js 22.12 or later in the 22.x line,
24.x, or 26 and later. Node.js 20 is no longer supported for development
and testing. CI builds and tests on Node.js 22 and 24.

Install dependencies and run the checks:

```sh
npm ci
npm run build
npm test
```

There is no lint script configured in this project.
