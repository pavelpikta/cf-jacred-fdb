# cf-jacred-fbd

<!-- markdownlint-disable MD033 -->

[![CI](https://img.shields.io/github/actions/workflow/status/pavelpikta/cf-jacred-fdb/ci.yml?branch=main&logo=github&label=CI)](https://github.com/pavelpikta/cf-jacred-fdb/actions)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/pages/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-black?logo=cloudflare)](https://developers.cloudflare.com/workers/)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-339933?logo=node.js&logoColor=white)
![ESBuild](https://img.shields.io/badge/ESBuild-0.25.12-FFCF00?logo=esbuild&logoColor=black)
![ESLint](https://img.shields.io/badge/ESLint-9.39.1-4B32C3?logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-3.3.3-F7B93E?logo=prettier&logoColor=black)
![Version](https://img.shields.io/badge/Version-0.1.0-blue)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Architecture](https://img.shields.io/badge/Docs-architecture-blueviolet)](./ARCHITECTURE.md)
[![Русская версия](https://img.shields.io/badge/Docs-Русский-green)](./README.ru.md)

## AI Documentation

[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/pavelpikta/cf-jacred-fdb)

> ⚠️ Early alpha: **public API surface / HTML structure may still change**. Pin a commit if you depend on it.

Edge‑accelerated torrent meta search UI + tracker statistics dashboard delivered via Cloudflare Pages + a custom `_worker.js` (API gateway, security headers, caching, TorrServer helpers) that fronts an HTTP‑only upstream API.

> ℹ️ **Rendering note:** If your viewer does not support Mermaid diagrams, expand the "ASCII Fallback" sections below each diagram.

---

## 📚 Table of Contents

1. [Overview](#overview)
2. [Feature Highlights](#feature-highlights)
3. [Public HTTP Surface](#public-http-surface)
4. [Environment Variables](#environment-variables-worker--pages)
5. [Caching Strategy](#caching-strategy-summarized)
6. [Build & Tooling](#build--tooling)
7. [Local Quick Start](#local-quick-start)
8. [Security](#security-headers--hardening)
9. [API Key Flow](#api-key-flow-detailed)
10. [TorrServer Integration](#torrserver-integration)
11. [Architecture](#architecture)
12. [JSON Error Examples](#json-error-examples)
13. [Debug & Diagnostics](#debug--diagnostics)
14. [Extensibility Ideas](#extensibility-ideas)
15. [Contributing](#contributing)
16. [FAQ](#faq)
17. [License](#license)
18. [Support](#support--issues)

> 🇷🇺 Русская версия документации: см. [`README.ru.md`](./README.ru.md) и расширенную архитектуру [`ARCHITECTURE.ru.md`](./ARCHITECTURE.ru.md).

---

---

## Overview

This project serves two main browser apps:

1. Search ( `index.html` ) – torrent meta search with rich client‑side filtering, sorting, API‑key aware requests, and TorrServer integration (send magnet directly).
2. Stats ( `stats.html` ) – live tracker statistics dashboard with auto refresh, aggregate summary, theming, compact/wide layouts, number formatting modes, and offline (localStorage) caching.

Both pages are static assets in `public/` copied (and optionally hashed) into `dist/` at build time; the Worker handles:

- Auth (optional API key; query param stripped before origin fetch)
- Path translation `/api/...` → upstream
- Direct pass‑through for selected “direct” paths (`/stats`, `/sync` prefixes)
- Smart edge & browser caching (ETag + conditional 304, hashed asset immutability)
- Response security headers & hop‑by‑hop header stripping
- TorrServer helper POST endpoints with timeout + CF Access token support
- Runtime asset hash rewriting via manifest (so HTML stays clean of fingerprint logic in dev)

## Feature Highlights

- Search interface with multi‑facet filters (quality / voice / year / season / tracker / category + refine & exclude substring filters)
- Sort modes: seeders, size, date; persisted in `localStorage`
- Stats dashboard with: auto refresh (10m, visible tab), dynamic sort modes, theme (dark/light), compact & wide modes, number formatting toggle (abbreviated vs full), aggregate totals card, stale data highlighting
- Optional API key discovery and modal prompt; key persisted & validated via `/api/conf`
- TorrServer endpoints: add magnet, test connectivity/version; supports Basic Auth and Cloudflare Access service tokens
- Edge caching with revalidation & ETag handling (304 path)
- Manifest‑backed hashed assets for long cache lifetimes without sacrificing UX
- Comprehensive security headers (CSP placeholder) & basic threat mitigations

## Public HTTP Surface

| Endpoint / Path                   | Method | Kind               | Description                                        |
| --------------------------------- | ------ | ------------------ | -------------------------------------------------- |
| `/`                               | GET    | Static             | Search UI (served as `index.html`)                 |
| `/stats` / `/stats.html`          | GET    | Static (special)   | Stats dashboard (canonical served as `stats.html`) |
| `/api/conf`                       | GET    | API (proxied)      | Capability + API key validation descriptor         |
| `/api/torrents?search=...&exact=` | GET    | API (proxied)      | Torrent search passthrough                         |
| `/api/stats/torrents`             | GET    | API (proxied)      | Tracker statistics passthrough                     |
| `/api/torrserver/add`             | POST   | Worker action      | Magnet → TorrServer helper (JSON)                  |
| `/api/torrserver/test`            | POST   | Worker action      | TorrServer connectivity & version probe            |
| `/api/*` (other)                  | \*     | API (proxied)      | Generic upstream mapping (GET/HEAD/POST/OPTIONS)   |
| `/sync*` (direct prefix)          | \*     | Direct passthrough | Bypasses `/api` prefix mapping rules               |

Unsupported methods return a 405 JSON error envelope.

## Environment Variables (Worker & Pages)

Configure these in Cloudflare Pages (Production & Preview) or via `wrangler.toml` for local dev.

| Name                                              | Required? | Purpose                                                         | Notes                                            |
| ------------------------------------------------- | --------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `UPSTREAM_ORIGIN`                                 | Yes       | Base origin (no trailing slash) for `/api/...` mappings         | Plain HTTP allowed (TLS terminates at edge)      |
| `API_KEY`                                         | Optional  | Enforces API key if set                                         | If empty → `requireApiKey: false` in `/api/conf` |
| `UPSTREAM_TIMEOUT_MS`                             | Optional  | Timeout for generic upstream fetches                            | Default 30000 ms                                 |
| `TORRSERVER_TIMEOUT_MS`                           | Optional  | Timeout for TorrServer operations                               | Default 15000 ms                                 |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Optional  | Service token for protected TorrServer behind Cloudflare Access | Adds headers when both present                   |
| `DEBUG_LOGS`                                      | Optional  | Future flag for verbose logging                                 | Not currently implemented                        |

Preview vs production variables can diverge (e.g. unset `API_KEY` in preview for easier testing).

## Caching Strategy (Summarized)

| Asset / Response                                 | Cache-Control                         | Edge Behavior                        |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------ |
| HTML (`index.html`, `stats.html`)                | `no-cache, must-revalidate`           | Always validated (fresh UX)          |
| Hashed static assets (CSS/JS with manifest hash) | `public, max-age=31536000, immutable` | Long-lived, content addressed        |
| Upstream API (successful GET)                    | `public, max-age=60, s-maxage=300`    | Stored in `caches.default` (60s TTL) |
| 304 revalidation path                            | Returns 304 with normalized `Vary`    | Avoids double fetch                  |

Cache key drops volatile/query-only params (`apikey`, `api_key`, `_`). Users can force refresh with `Cache-Control: no-cache` request header.

## Build & Tooling

| Task             | Command              | Notes                                    |
| ---------------- | -------------------- | ---------------------------------------- |
| Dev (unminified) | `npm run dev`        | Esbuild watch + Wrangler dev             |
| Type check       | `npm run typecheck`  | `tsc --noEmit`                           |
| Lint             | `npm run lint`       | ESLint flat config                       |
| Format           | `npm run format`     | Prettier                                 |
| Production build | `npm run build:prod` | Minified worker + static copy + manifest |

Tooling stack: TypeScript, esbuild, ESLint, Prettier. Output shipped is only what resides in `dist/` (see `.cloudflareignore`).

## Local Quick Start

```bash
npm install
npm run dev
# or for production style
npm run build:prod && wrangler pages dev dist
```

## Security Headers & Hardening

Automatically applied (unless already present upstream):

| Header                         | Value                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `X-Content-Type-Options`       | `nosniff`                                                     |
| `Referrer-Policy`              | `no-referrer`                                                 |
| `X-Frame-Options`              | `DENY`                                                        |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                 |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                 |
| `Permissions-Policy`           | `geolocation=(), microphone=(), camera=(), fullscreen=(self)` |
| `Access-Control-Allow-*`       | Open (`*`) for simplicity (adjust later)                      |

Planned: strict CSP, SRI for external scripts, optional rate limiting & Turnstile, `/healthz` endpoint.

Threat snippets:

| Threat                          | Mitigation                                   |
| ------------------------------- | -------------------------------------------- |
| API key leakage upstream        | Worker strips `apikey` before origin fetch   |
| Clickjacking                    | `X-Frame-Options: DENY`                      |
| MIME sniffing                   | `X-Content-Type-Options: nosniff`            |
| Referrer leakage                | `Referrer-Policy: no-referrer`               |
| XS-Leaks baseline               | COOP + CORP alignment                        |
| Cache poisoning / fragmentation | Normalized cache key removes volatile params |

## API Key Flow (Detailed)

1. Page loads → modal script requests `/api/conf` (optionally with stored key).
2. Response includes `{ requireApiKey: boolean, apikey: true|false|undefined }`.
3. If `requireApiKey` and `apikey !== true`, user prompted; candidate key validated via `/api/conf?apikey=...`.
4. Accepted key stored in `localStorage.api_key` and appended to future API queries.
5. Worker strips `apikey` from upstream URL & cache key (prevents leakage / fragmentation).

## TorrServer Integration

Endpoints:

| Path                   | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `/api/torrserver/add`  | POST `{ magnet, url, username?, password?, debug? }` → TorrServer `/torrents` |
| `/api/torrserver/test` | POST `{ url, username?, password? }` → TorrServer `/echo` (detects version)   |

Behaviors:

- Timeouts (`TORRSERVER_TIMEOUT_MS`).
- Basic Auth auto-applied if credentials present.
- Optional Cloudflare Access service tokens (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`).
- Detect Cloudflare Access 403 to surface `cloudflareAccess: true` hint.
- Debug mode echoes raw payloads (avoid in untrusted contexts).

## Architecture

For the full middleware pipeline, diagrams (Mermaid + ASCII), caching & security rationale, decision trees, and extension points, see: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (🇷🇺 Russian translation: [`ARCHITECTURE.ru.md`](./ARCHITECTURE.ru.md)).

Minimal overview (edge request path):

```text
statsAsset → staticAsset → methodAndCors → torrserver → confEndpoint → upstream
```

Static assets are served first (fast path), then method/CORS validation, domain helpers (TorrServer + config), and finally the generic upstream proxy which applies caching + security headers.

### Preview vs Production

`wrangler.toml` defines an `env.preview` block. Cloudflare Pages automatically injects `preview` vs `production` contexts for deploys so you can supply different `API_KEY` / `UPSTREAM_ORIGIN` values in the dashboard if needed.

## Deployment (Cloudflare Pages)

1. Create / connect project in Cloudflare Pages dashboard (project name must match `name` in `wrangler.toml`: `jdr`).
2. Configure environment variables (Production & Preview) in Pages settings.
3. (Optional) Enable source maps (`upload_source_maps = true`). Allow `_worker.js.map` via `.cloudflareignore` rules if needed.
4. Push to your Git branch → automatic build: `npm run build:prod` (configure in Pages build command) or replicate its steps.
5. Pages uploads only what survives `.cloudflareignore` (we ship just `dist/` output + any permitted maps).

## JSON Error Examples

| Scenario           | Example                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Invalid method     | `{ "error": "Метод не поддерживается", "code": "method_not_allowed", "locale": "ru" }`                             |
| Upstream timeout   | `{ "error": "Превышено время ожидания апстрима", "code": "upstream_timeout", "locale": "ru", "timeoutMs": 30000 }` |
| TorrServer timeout | `{ "error": "Превышено время ожидания TorrServer", "code": "torrserver_timeout", ... }`                            |

## Debug & Diagnostics

| Need                    | How                                                              |
| ----------------------- | ---------------------------------------------------------------- |
| Show upstream URL used  | `x-debug-upstream: 1` request header (response `X-Upstream-URL`) |
| Measure worker time     | Inspect `Server-Timing` header (`edge;dur=<ms>`)                 |
| Force fresh fetch       | `Cache-Control: no-cache` request header                         |
| TorrServer verbose JSON | Include `{ "debug": true }` in add POST body                     |

## Extensibility Ideas

- Add CSP & SRI
- Service Worker for partial offline (search history cache)
- Pagination / virtualization for very large result sets
- i18n (strings currently Russian) – externalize to JSON per locale
- Rate limiting (token bucket / Turnstile integration)
- Metrics/log export (Logpush / Workers Analytics Engine)

## Contributing

1. Fork & branch.
2. Run `npm run typecheck` + `npm run build` before committing.
3. For production build parity test `npm run build:prod`.
4. Keep README in sync for any routing / header / env changes.
5. Add or update inline comments (code intentionally leans descriptive for maintainability).

Lint / Format:

```bash
npm run lint
npm run format
```

## FAQ

**Why query param (not header) for API key?** Simplicity + bookmarkable URLs. Can migrate to header transparently (still parse query for backwards compatibility).

**Why proxy an HTTP (not HTTPS) upstream?** TLS terminates at Cloudflare edge; upstream may be internal or controlled. End user always speaks HTTPS to Pages.

**Does this rate limit?** Not yet. Add Turnstile or per‑IP caching / token bucket if abuse emerges.

**How do I add another static page?** Place it in `public/`, reference assets relatively, rebuild. It will be served automatically unless it conflicts with a reserved prefix.

**Can I disable API key enforcement in preview?** Yes – clear `API_KEY` variable in the Pages preview environment.

## License

See [LICENSE](LICENSE) for full details.

```text
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
```

## Support / Issues

Please open an issue including:

- Steps to reproduce
- Expected vs actual behavior
- Request URL(s) & method(s)
- Relevant response headers / JSON payload (if not sensitive)
- (Optional) Screenshots / HAR for complex rendering issues
