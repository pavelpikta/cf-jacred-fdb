# cf-jacred-fdb

[![CI](https://img.shields.io/github/actions/workflow/status/pavelpikta/cf-jacred-fdb/ci.yml?branch=main&logo=github&label=CI)](https://github.com/pavelpikta/cf-jacred-fdb/actions)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/pages/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-black?logo=cloudflare)](https://developers.cloudflare.com/workers/)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-339933?logo=node.js&logoColor=white)
![ESBuild](https://img.shields.io/badge/ESBuild-0.27.0-FFCF00?logo=esbuild&logoColor=black)
![Version](https://img.shields.io/badge/Version-0.1.0-blue)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Architecture](https://img.shields.io/badge/Docs-architecture-blueviolet)](./ARCHITECTURE.md)
[![Русская версия](https://img.shields.io/badge/Docs-Русский-green)](./README.ru.md)

## AI Documentation

[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/pavelpikta/cf-jacred-fdb)

> ⚠️ **Temporary on hold**:

> ⚠️ **Early Alpha**: Public API surface and HTML structure may still change. Pin a commit if you depend on it.

Edge-accelerated torrent meta search UI + tracker statistics dashboard delivered via Cloudflare Pages with a custom Worker (`_worker.js`) that acts as an API gateway, security layer, caching proxy, and TorrServer integration helper.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [HTTP API Reference](#http-api-reference)
- [Environment Variables](#environment-variables)
- [Build & Development](#build--development)
- [Deployment](#deployment)
- [Security](#security)
- [TorrServer Integration](#torrserver-integration)
- [API Key Management](#api-key-management)
- [Caching Strategy](#caching-strategy)
- [Error Handling](#error-handling)
- [Debug & Diagnostics](#debug--diagnostics)
- [Internationalization](#internationalization)
- [Contributing](#contributing)
- [FAQ](#faq)
- [License](#license)

---

## Overview

This project provides two browser applications:

### 1. Torrent Search (`/`)

- Full-text search with exact match option
- Multi-facet filtering: quality, voice-over, year, season, tracker, category
- Text refinement and exclusion filters
- Client-side sorting by seeders, size, or date
- TorrServer integration for direct magnet sending
- Tracker icons and color-coded badges

### 2. Tracker Statistics (`/stats`)

- Live dashboard with auto-refresh (10 minutes)
- Aggregate totals across all trackers
- Proportional distribution bars (confirm/wait/skip)
- Stale data highlighting (>7 days, >90 days)
- Theme switching (dark/light)
- Compact and wide layout modes
- Number formatting toggle (abbreviated vs full)

### Worker Responsibilities

The Cloudflare Worker handles:

- **API Gateway**: Routes `/api/*` requests to upstream with path translation
- **Security**: API key validation, header sanitization, CORS
- **Caching**: Edge cache with ETag/304 support, normalized cache keys
- **TorrServer Proxy**: Endpoints for adding magnets and testing connectivity
- **Static Assets**: Manifest-based hashed asset resolution

---

## Features

| Feature              | Description                                        |
| -------------------- | -------------------------------------------------- |
| **Edge Caching**     | 60s browser / 300s edge TTL with ETag revalidation |
| **Hashed Assets**    | Immutable 1-year cache for fingerprinted CSS/JS    |
| **API Key Auth**     | Optional enforcement with multi-key support        |
| **TorrServer**       | Proxy and direct modes with Basic Auth + CF Access |
| **i18n**             | Russian (default) and English error messages       |
| **Security Headers** | X-Frame-Options, CSP-ready, CORS, Referrer-Policy  |
| **Responsive UI**    | Mobile-optimized with touch enhancements           |

---

## Quick Start

```bash
# Install dependencies
npm install

# Development (unminified, with wrangler dev server)
npm run dev

# Production build
npm run build:prod

# Preview production build locally
wrangler pages dev dist
```

**Requirements**: Node.js ≥18.0.0

---

## HTTP API Reference

### Static Assets

| Path                               | Description              |
| ---------------------------------- | ------------------------ |
| `/`                                | Search UI (`index.html`) |
| `/stats`, `/stats/`, `/stats.html` | Statistics dashboard     |
| `/css/*`, `/js/*`, `/img/*`        | Static assets            |

### API Endpoints

| Endpoint                       | Method | Description                        |
| ------------------------------ | ------ | ---------------------------------- |
| `/api/conf`                    | GET    | Configuration & API key validation |
| `/api/torrents?search=&exact=` | GET    | Torrent search                     |
| `/api/stats/torrents`          | GET    | Tracker statistics                 |
| `/api/torrserver/add`          | POST   | Add magnet to TorrServer           |
| `/api/torrserver/test`         | POST   | Test TorrServer connectivity       |

### Direct Passthrough Paths

These paths bypass `/api` mapping and go directly to upstream:

| Path            | Description                                |
| --------------- | ------------------------------------------ |
| `/stats/*`      | Upstream stats endpoints                   |
| `/sync/*`       | Sync operations                            |
| `/lastupdatedb` | Database update timestamp (API key exempt) |
| `/health`       | Health check (API key exempt)              |

### Request/Response Examples

**Search Request:**

```http
GET /api/torrents?search=matrix&apikey=YOUR_KEY&exact=true
```

**TorrServer Add:**

```http
POST /api/torrserver/add
Content-Type: application/json

{
  "magnet": "magnet:?xt=urn:btih:...",
  "url": "http://localhost:8090",
  "username": "admin",
  "password": "secret",
  "debug": false
}
```

**TorrServer Test:**

```http
POST /api/torrserver/test
Content-Type: application/json

{
  "url": "http://localhost:8090",
  "username": "admin",
  "password": "secret"
}
```

---

## Environment Variables

Configure in Cloudflare Pages dashboard or `wrangler.toml`:

| Variable                  | Required | Default                    | Description                         |
| ------------------------- | -------- | -------------------------- | ----------------------------------- |
| `UPSTREAM_ORIGIN`         | Yes      | `http://redapi.cfhttp.top` | Upstream API origin                 |
| `API_KEY`                 | No       | —                          | Comma-separated API keys for auth   |
| `UPSTREAM_TIMEOUT_MS`     | No       | `30000`                    | Upstream request timeout            |
| `TORRSERVER_TIMEOUT_MS`   | No       | `15000`                    | TorrServer request timeout          |
| `CF_ACCESS_CLIENT_ID`     | No       | —                          | Cloudflare Access client ID         |
| `CF_ACCESS_CLIENT_SECRET` | No       | —                          | Cloudflare Access client secret     |
| `ERROR_LOCALE`            | No       | `ru`                       | Error message locale (`en` or `ru`) |

---

## Build & Development

### NPM Scripts

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `npm run dev`        | Build + wrangler dev server          |
| `npm run build`      | Development build                    |
| `npm run build:prod` | Production build (minified + hashed) |
| `npm run typecheck`  | TypeScript type checking             |
| `npm run lint`       | ESLint                               |
| `npm run format`     | Prettier formatting                  |
| `npm run watch`      | Watch mode for assets + worker       |

### Project Structure

<!-- markdownlint-disable MD040 -->

```
cf-jacred-fdb/
├── src/                    # TypeScript Worker source
│   ├── worker.ts           # Entry point
│   ├── config.ts           # Configuration resolver
│   ├── lib/                # Shared utilities
│   │   ├── apiKey.ts       # API key parsing/validation
│   │   ├── assets.ts       # Asset caching logic
│   │   ├── constants.ts    # Constants and types
│   │   ├── errors.ts       # Error response builders
│   │   ├── fetching.ts     # Fetch with timeout/caching
│   │   ├── i18n.ts         # Internationalization
│   │   ├── manifest.ts     # Asset hash manifest
│   │   ├── routing.ts      # Path mapping rules
│   │   ├── security.ts     # Security headers
│   │   └── torrserver.ts   # TorrServer handlers
│   └── middleware/         # Request pipeline
│       ├── index.ts        # Exports
│       ├── types.ts        # Context types
│       ├── statsAsset.ts   # /stats page handler
│       ├── staticAsset.ts  # Static file handler
│       ├── methodAndCors.ts# Method validation + CORS
│       ├── torrserver.ts   # TorrServer endpoints
│       ├── conf.ts         # /api/conf endpoint
│       └── upstream.ts     # Upstream proxy
├── public/                 # Static assets
│   ├── index.html          # Search page
│   ├── stats.html          # Stats page
│   ├── css/                # Stylesheets
│   ├── js/                 # Client JavaScript
│   └── img/                # Images and icons
├── scripts/
│   └── copy-static.mjs     # Build script
├── dist/                   # Build output (gitignored)
├── wrangler.toml           # Cloudflare configuration
├── tsconfig.json           # TypeScript configuration
└── package.json            # Dependencies and scripts
```

<!-- markdownlint-enable MD040 -->

---

## Deployment

### Cloudflare Pages

1. Create a Pages project named `cf-jacred-fdb` (or update `wrangler.toml`)
2. Set environment variables in Pages dashboard
3. Configure build command: `npm run build:prod`
4. Configure output directory: `dist`
5. Push to your Git branch for automatic deployment

### Manual Deployment

```bash
npm run build:prod
wrangler pages deploy dist
```

---

## Security

### Response Headers

All responses include:

| Header                         | Value                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `X-Content-Type-Options`       | `nosniff`                                                     |
| `Referrer-Policy`              | `no-referrer`                                                 |
| `X-Frame-Options`              | `DENY`                                                        |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                 |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                 |
| `Permissions-Policy`           | `geolocation=(), microphone=(), camera=(), fullscreen=(self)` |

### CORS

Open CORS policy (`*`) for API endpoints. Adjust in production if needed.

### API Key Protection

- Keys stripped from upstream requests and cache keys
- Multi-key support (comma-separated in `API_KEY`)
- Exempt paths: `/lastupdatedb`, `/health`

### Client-Side Security

- XSS protection via HTML escaping
- URL sanitization (strips `javascript:` protocol)
- Password encryption with Web Crypto API (AES-GCM)
- Optional master password for real encryption security

---

## TorrServer Integration

### Modes

1. **Proxy Mode** (default): Browser → Worker → TorrServer
   - Avoids CORS issues
   - Supports CF Access tokens
   - Cannot reach private networks

2. **Direct Mode**: Browser → TorrServer
   - Requires CORS or same-origin
   - Works with LAN servers
   - Needs credentials in browser

### Password Storage

- Encrypted with AES-GCM + PBKDF2
- Optional master password for real security
- Storage: sessionStorage (default) or localStorage
- Fallback to session memory if crypto unavailable

### Configuration

Access via "Настройки TorrServer" link in the search UI:

- TorrServer URL
- Username/password (optional)
- Direct mode toggle
- Persist password toggle
- Master password setup

---

## API Key Management

### Flow

1. Page loads → checks `/api/conf`
2. If `requireApiKey: true` and no valid key → modal prompt
3. Key validated server-side via `/api/conf?apikey=...`
4. Valid key stored in `localStorage.api_key`
5. Key appended to API requests, stripped before upstream

### Client API

```javascript
// Ensure key is available before API calls
ApiKey.ensure(() => {
  // Safe to make API calls
});

// Get stored key
const key = ApiKey.get();

// Reset key (forces new prompt)
ApiKey.reset();
```

---

## Caching Strategy

| Asset Type        | Cache-Control                         | Edge Behavior          |
| ----------------- | ------------------------------------- | ---------------------- |
| HTML files        | `no-cache, must-revalidate`           | Always revalidated     |
| Hashed assets     | `public, max-age=31536000, immutable` | Long-term cached       |
| Non-hashed CSS/JS | `public, max-age=3600`                | 1 hour                 |
| Images/fonts      | `public, max-age=604800`              | 1 week                 |
| API responses     | `public, max-age=60, s-maxage=300`    | 60s browser, 5min edge |

### Cache Key Normalization

Stripped from cache keys:

- `apikey`, `api_key` (prevents fragmentation)
- `_` (cache-busting parameter)

### Force Refresh

Send `Cache-Control: no-cache` header to bypass cache.

---

## Error Handling

### Error Response Format

```json
{
  "error": "Human-readable message",
  "code": "error_code",
  "locale": "ru",
  "messageKey": "i18n_key"
}
```

### HTTP Status Codes

| Status | Cause                                        |
| ------ | -------------------------------------------- |
| 400    | Invalid request, path decode error, bad JSON |
| 403    | Invalid/missing API key                      |
| 404    | Asset not found                              |
| 405    | Method not allowed                           |
| 502    | Upstream/TorrServer network error            |
| 504    | Upstream/TorrServer timeout                  |

---

## Debug & Diagnostics

| Need                | Method                                                   |
| ------------------- | -------------------------------------------------------- |
| Show upstream URL   | `x-debug-upstream: 1` header → `X-Upstream-URL` response |
| Measure worker time | Check `Server-Timing: edge;dur=<ms>` header              |
| Force fresh fetch   | `Cache-Control: no-cache` request header                 |
| TorrServer debug    | `"debug": true` in POST body                             |
| Client debug        | `localStorage.setItem('torrserver_debug', '1')`          |

---

## Internationalization

### Supported Locales

- `ru` (Russian) - default
- `en` (English)

### Configuration

Set `ERROR_LOCALE` environment variable to `en` for English error messages.

### Message Keys

```typescript
type MsgKey =
  | 'not_found'
  | 'bad_request'
  | 'method_not_allowed'
  | 'forbidden'
  | 'upstream_timeout'
  | 'upstream_fetch_failed'
  | 'torrserver_timeout'
  | 'torrserver_network'
  | 'torrserver_all_attempts_failed'
  | 'missing_url'
  | 'invalid_url'
  | 'expect_json_body'
  | 'invalid_magnet'
  | 'auth_credentials_mismatch'
  | 'auth_error_hint'
  | 'auth_error_hint_tokens'
  | 'path_decode_error'
  | 'path_map_error';
```

---

## Contributing

1. Fork and create a feature branch
2. Run `npm run typecheck` and `npm run lint` before committing
3. Test with `npm run build:prod`
4. Update documentation for any API/config changes
5. Submit a pull request

### Code Style

- TypeScript with strict mode
- ESLint + Prettier formatting
- Descriptive comments for maintainability
- JSDoc for public functions

---

## FAQ

**Q: Why query param instead of header for API key?**  
A: Simplicity and bookmarkable URLs. Header support can be added for backward compatibility.

**Q: Why proxy an HTTP upstream?**  
A: TLS terminates at Cloudflare edge. Upstream may be internal. Users always connect via HTTPS.

**Q: Does this rate limit?**  
A: Not yet. Consider Turnstile or per-IP limiting if abuse occurs.

**Q: How to add a new static page?**  
A: Place in `public/`, reference assets relatively, rebuild. Served automatically unless it conflicts with reserved prefixes.

**Q: Can I disable API key in preview?**  
A: Yes, leave `API_KEY` empty in Pages preview environment variables.

**Q: How to change error language?**  
A: Set `ERROR_LOCALE=en` environment variable.

---

## License

<!-- markdownlint-disable MD040 -->

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

  https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

<!-- markdownlint-enable MD040 -->

See [LICENSE](./LICENSE) for full details.

---

## Support

Open an issue with:

- Steps to reproduce
- Expected vs actual behavior
- Request URL(s) and method(s)
- Relevant response headers/JSON (if not sensitive)
- Screenshots/HAR for rendering issues
