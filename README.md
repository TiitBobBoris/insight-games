# Insight Games

Estonian, local-only reflection and party games. Static application in `index.html`.

Current application version: **1.2.0**, build **2026.09.29.1**.

## GPT-6 Peak Moment

Peak Momenti mängus saab kasutaja soovi korral luua personaalse AI-peegelduse. Enne saatmist küsib rakendus nõusolekut ja saadab serverile ainult selle mängu täidetud väljad. Ülejäänud lokaalseid tulemusi ei saadeta.

Serverifunktsioon asub failis `api/peak-reflection.js` ja kasutab OpenAI Responses API-t mudeliga `gpt-6-sol`. API-võti jääb serverisse. Vercelis peab olema määratud keskkonnamuutuja `OPENAI_API_KEY`; päris võtit ei tohi Git-repositooriumisse lisada.

## Checks

```sh
npm ci
npm test
```

Tests use Node's test runner and jsdom; they are not real-browser or physical-device tests. The test-only instrumentation is injected by the test file, not shipped in the application.

`tests/browser.html` provides a manual real-browser viewport harness for a **non-production** preview URL. It offers 360, 390, 430 and 1180 CSS-pixel iframe widths. Scrollbars reduce the content width; this is not touch-device emulation. Use only synthetic data and never point destructive tests at production.

See [QA_REPORT.md](QA_REPORT.md) for verified results, limitations and the release decision, and [DATA_MIGRATION.md](DATA_MIGRATION.md) for storage ownership and migration behavior.
