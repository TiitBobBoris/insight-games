# Insight Games

Estonian, local-only reflection and party games. Static application in `index.html`.

Current QA branch version: **1.1.1**, build **2026.09.20.2**.

## Checks

```sh
npm ci
npm test
```

Tests use Node's test runner and jsdom; they are not real-browser or physical-device tests. The test-only instrumentation is injected by the test file, not shipped in the application.

`tests/browser.html` provides a manual real-browser viewport harness for a **non-production** preview URL. It offers 360, 390, 430 and 1180 CSS-pixel iframe widths. Scrollbars reduce the content width; this is not touch-device emulation. Use only synthetic data and never point destructive tests at production.

See [QA_REPORT.md](QA_REPORT.md) for verified results, limitations and the release decision, and [DATA_MIGRATION.md](DATA_MIGRATION.md) for storage ownership and migration behavior.
