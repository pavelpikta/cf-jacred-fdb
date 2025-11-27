# Architecture

> Technical documentation of the runtime model for **cf-jacred-fdb**. For user-facing features and setup, see [`README.md`](./README.md).

## Table of Contents

- [System Overview](#system-overview)
- [Request Flow](#request-flow)
- [Middleware Pipeline](#middleware-pipeline)
- [Path Routing](#path-routing)
- [Caching Architecture](#caching-architecture)
- [Security Model](#security-model)
- [Client Applications](#client-applications)
- [Type System](#type-system)
- [Extension Guide](#extension-guide)

---

## System Overview

### Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Cloudflare Edge                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │  Pages (R2)     │    │   _worker.js    │    │   caches.default        │  │
│  │  Static Assets  │◄───│   Middleware    │───►│   Edge Cache            │  │
│  └─────────────────┘    └────────┬────────┘    └─────────────────────────┘  │
│                                  │                                           │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
           ┌───────────────┐             ┌───────────────┐
           │ Upstream API  │             │  TorrServer   │
           │ (HTTP origin) │             │ (User-hosted) │
           └───────────────┘             └───────────────┘
```

### Bindings

| Binding          | Type      | Purpose                             |
| ---------------- | --------- | ----------------------------------- |
| `ASSETS`         | R2/KV     | Cloudflare Pages static asset store |
| `caches.default` | Cache API | Edge cache for upstream responses   |

### Data Flow

1. **Browser** → HTTPS → **Cloudflare Edge**
2. **Worker** inspects request, runs middleware pipeline
3. **Static requests** → ASSETS binding (with manifest resolution)
4. **API requests** → Upstream origin (with caching)
5. **TorrServer requests** → User-specified TorrServer instance

---

## Request Flow

### Decision Tree

```
Request arrives
    │
    ├─► Is /stats, /stats/, /stats.html?
    │       └─► statsAsset middleware → serve stats.html
    │
    ├─► Is non-API, non-direct path?
    │       └─► staticAsset middleware → serve from ASSETS
    │
    ├─► Is method allowed (GET/HEAD/POST/OPTIONS)?
    │       └─► No: return 405
    │       └─► OPTIONS: return 204 with CORS
    │
    ├─► Is /api/torrserver/*?
    │       └─► torrserver middleware → handle add/test
    │
    ├─► Is /api/conf?
    │       └─► confEndpoint middleware → return config
    │
    └─► Remaining API/direct paths
            └─► upstream middleware → proxy to origin
```

### Sequence: Static Asset

```
Browser                  Worker                   ASSETS
   │                        │                        │
   │  GET /css/styles.css   │                        │
   │───────────────────────►│                        │
   │                        │  resolveHashedPath()   │
   │                        │───────────────────────►│
   │                        │◄───────────────────────│
   │                        │  fetch(hashed path)    │
   │                        │───────────────────────►│
   │                        │◄───────────────────────│
   │  200 + Cache-Control   │                        │
   │◄───────────────────────│                        │
```

### Sequence: API Request

```
Browser                  Worker                Cache              Upstream
   │                        │                    │                    │
   │  GET /api/torrents     │                    │                    │
   │───────────────────────►│                    │                    │
   │                        │  parse API key     │                    │
   │                        │  map path          │                    │
   │                        │  strip apikey      │                    │
   │                        │  cache.match()     │                    │
   │                        │───────────────────►│                    │
   │                        │◄───────────────────│                    │
   │                        │  [MISS]            │                    │
   │                        │  fetch upstream    │                    │
   │                        │───────────────────────────────────────►│
   │                        │◄───────────────────────────────────────│
   │                        │  cache.put()       │                    │
   │                        │───────────────────►│                    │
   │  200 + headers         │                    │                    │
   │◄───────────────────────│                    │                    │
```

### Sequence: TorrServer Add

```
Browser                  Worker                           TorrServer
   │                        │                                  │
   │  POST /api/torrserver/add                                 │
   │  { magnet, url, ... }  │                                  │
   │───────────────────────►│                                  │
   │                        │  validate body                   │
   │                        │  build auth headers              │
   │                        │  POST /torrents                  │
   │                        │─────────────────────────────────►│
   │                        │◄─────────────────────────────────│
   │  { ok, status, ... }   │                                  │
   │◄───────────────────────│                                  │
```

---

## Middleware Pipeline

### Execution Order

```typescript
const pipeline: Middleware[] = [
  statsAsset, // 1. Stats page special handling
  staticAsset, // 2. Generic static assets
  methodAndCors, // 3. Method validation + CORS
  torrserver, // 4. TorrServer endpoints
  confEndpoint, // 5. /api/conf handler
  upstream, // 6. Upstream proxy (final)
];
```

### Middleware Contracts

| Middleware      | Triggers On         | Returns Early    | Side Effects             |
| --------------- | ------------------- | ---------------- | ------------------------ |
| `statsAsset`    | `/stats*` paths     | Always           | Caching headers          |
| `staticAsset`   | Non-API, non-direct | Always           | Manifest lookup, caching |
| `methodAndCors` | All remaining       | 405/204          | CORS headers             |
| `torrserver`    | `/api/torrserver/*` | JSON response    | Network to TorrServer    |
| `confEndpoint`  | `/api/conf`         | JSON config      | Upstream fetch           |
| `upstream`      | API/direct paths    | Proxied response | Cache read/write         |

### Middleware Type

```typescript
interface RequestContext {
  request: Request;
  env: WorkerEnv;
  ctx: ExecutionContext;
  url: URL;
  pathname: string;
  start: number;
  config: ResolvedConfig;
  apiKey: ApiKeyInfo;
  locale: Locale;
  isApi: boolean;
  direct: boolean;
  upstreamPath?: string;
  upstreamUrl?: URL;
  state: Record<string, unknown>;
}

type Middleware = (ctx: RequestContext) => Promise<Response | void> | Response | void;
```

---

## Path Routing

### Local to Upstream Mapping

```typescript
const RULES: MappingRule[] = [
  // /api/conf → /api/v1.0/conf
  { type: 'regex', test: /^(\/conf\/?$)/, to: () => '/api/v1.0/conf' },

  // /api/torrents → /api/v1.0/torrents
  { type: 'predicate', test: (a) => a.startsWith('/torrents'), to: () => '/api/v1.0/torrents' },

  // /api/stats → /stats (passthrough)
  { type: 'regex', test: /^(\/stats\/?$)/, to: () => '/stats' },
  { type: 'predicate', test: (a) => a.startsWith('/stats/'), to: (a) => a },

  // /api/v1/... → /api/v1/... (versioned passthrough)
  { type: 'regex', test: /^\/v\d/, to: (a) => '/api' + a },

  // Catch-all: /api/foo → /api/foo
  { type: 'predicate', test: () => true, to: (a) => '/api' + a },
];
```

### Direct Passthrough Prefixes

These paths bypass `/api` prefix logic:

```typescript
const DIRECT_PREFIXES = ['/stats', '/stats/', '/sync', '/sync/', '/lastupdatedb', '/health'];
const DIRECT_API_KEY_EXEMPT_PREFIXES = ['/lastupdatedb', '/health'];
```

---

## Caching Architecture

### Cache Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Cache                           │
│  HTML: no-cache │ Hashed: immutable │ API: max-age=60       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Cache                     │
│           caches.default │ s-maxage=300 for API             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Upstream Origin                         │
└─────────────────────────────────────────────────────────────┘
```

### Cache-Control by Asset Type

| Asset             | Cache-Control                         | Rationale                  |
| ----------------- | ------------------------------------- | -------------------------- |
| HTML              | `no-cache, must-revalidate`           | Always fresh UX            |
| Hashed CSS/JS     | `public, max-age=31536000, immutable` | Content-addressed          |
| Non-hashed CSS/JS | `public, max-age=3600`                | 1 hour default             |
| Images/fonts      | `public, max-age=604800`              | 1 week                     |
| API success       | `public, max-age=60, s-maxage=300`    | Short browser, longer edge |
| API error         | `no-cache, max-age=0`                 | Never cache errors         |

### Cache Key Normalization

```typescript
function buildCacheKey(request: Request, upstreamUrl: string): Request {
  const u = new URL(upstreamUrl);
  u.searchParams.delete('_'); // Cache-busting param
  u.searchParams.delete('apikey'); // Prevent per-user fragmentation
  u.searchParams.delete('api_key');
  return new Request(u.toString(), { method: 'GET' });
}
```

### ETag Revalidation

```typescript
// On cache HIT with If-None-Match header:
const inm = request.headers.get('If-None-Match');
const cachedEtag = headers.get('ETag');

if (inm && cachedEtag) {
  const tokens = inm.split(',').map((s) => s.trim().replace(/^W\/|"/g, ''));
  const normalized = cachedEtag.replace(/^W\/|"/g, '');

  if (tokens.includes(normalized) || tokens.includes('*')) {
    return new Response(null, { status: 304, headers: h304 });
  }
}
```

---

## Security Model

### Header Application

```typescript
function addStandardResponseHeaders(h: Headers): void {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Frame-Options', 'DENY');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), fullscreen=(self)');
  // CORS headers applied separately
}
```

### API Key Flow

```typescript
interface ApiKeyInfo {
  keyEnforced: boolean; // API_KEY env var is set
  suppliedKey: string | null; // Key from query param
  keyValid: boolean; // Key matches allowed list
  allowedKeys: string[]; // Parsed from API_KEY (comma-separated)
}

// Key stripped before upstream fetch:
function stripApiKeyFromParams(params: URLSearchParams): boolean {
  params.delete('apikey');
  params.delete('api_key');
}
```

### Hop-by-Hop Header Stripping

```typescript
const STRIP_RESPONSE_HEADERS = [
  'set-cookie',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
];
```

### Threat Mitigations

| Threat           | Mitigation                                 |
| ---------------- | ------------------------------------------ |
| API key leakage  | Stripped from upstream URL and cache key   |
| Clickjacking     | `X-Frame-Options: DENY`                    |
| MIME sniffing    | `X-Content-Type-Options: nosniff`          |
| Referrer leakage | `Referrer-Policy: no-referrer`             |
| XS-Leaks         | COOP + CORP headers                        |
| Cache poisoning  | Normalized cache keys, header sanitization |

---

## Client Applications

### Search Page (`index.js`)

**Architecture:**

- IIFE pattern (no global pollution)
- jQuery-based DOM manipulation
- Event delegation for dynamic content
- Modular filter system

**State Management:**

```javascript
let allResults = []; // Raw API results
let filteredResults = []; // After client-side filtering

const filterCache = {
  voice: [], // Voice-over options
  tracker: [], // Tracker identifiers
  year: [], // Release years
  season: [], // Season numbers
  category: [], // Category types
  quality: [], // Video quality levels
};
```

**Filter Flow:**

```
API Response → allResults → applyFilters() → filteredResults → render()
                                  ↑
                           Filter UI changes
```

### Stats Page (`stats.js`)

**Architecture:**

- Dependency waiting (jQuery, ApiKey)
- localStorage caching (5-minute TTL)
- Auto-refresh (10 minutes, visibility-aware)
- Theme/layout persistence

**State Management:**

```javascript
let rawData = []; // All tracker stats
let viewData = []; // Filtered/sorted for display

// Preferences in localStorage:
// - statsCacheV1: { ts, data }
// - statsTheme: 'dark' | 'light'
// - statsWide: '0' | '1'
// - statsCompact: '0' | '1'
// - statsNumbersFull: '0' | '1'
```

### API Key Module (`modal.apikey.js`)

**Public API:**

```javascript
ApiKey.ensure(callback); // Ensure valid key, then call callback
ApiKey.get(); // Get stored key
ApiKey.reset(); // Clear stored key
ApiKey.promptReplace(cb); // Force new key prompt
```

**Validation Flow:**

```
ensure() → fetchConf() → requireApiKey?
              │                 │
              │                 ├─► No: callback()
              │                 │
              │                 └─► Yes: key valid?
              │                           │
              │                           ├─► Yes: callback()
              │                           │
              │                           └─► No: showModal() → validate → store → callback()
```

### TorrServer Module (`torrserver.js`)

**Public API:**

```javascript
TorrServer.openSettings(); // Open config modal
TorrServer.sendMagnet(magnet); // Send magnet to TorrServer
TorrServer.getConf(); // Get config (without password)
TorrServer.getConfWithPassword(); // Get config with decrypted password
TorrServer.clearPassword(url, user); // Clear stored password
```

**Password Encryption:**

```
Master Password (optional) → PBKDF2 → AES-GCM Key → Encrypt Password
                                                           │
                                                           ▼
                                              sessionStorage or localStorage
```

---

## Type System

### Worker Environment

```typescript
interface EnvLike {
  ASSETS: { fetch(request: Request): Promise<Response> };
  UPSTREAM_ORIGIN?: string;
  API_KEY?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  TORRSERVER_TIMEOUT_MS?: string;
  ERROR_LOCALE?: string;
}
```

### Configuration

```typescript
interface ResolvedConfig {
  upstreamOrigin: string; // From UPSTREAM_ORIGIN or default
  upstreamTimeoutMs: number; // Parsed from UPSTREAM_TIMEOUT_MS
  torrTimeoutMs: number; // Parsed from TORRSERVER_TIMEOUT_MS
}
```

### Error Envelope

```typescript
interface ErrorEnvelope {
  error: string; // Human-readable message
  code?: string; // Machine-readable code
  locale?: string; // 'en' | 'ru'
  messageKey?: string; // i18n key used
  [k: string]: unknown; // Additional context
}
```

### Locale System

```typescript
type Locale = 'en' | 'ru';

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

## Extension Guide

### Adding a New Middleware

1. Create `src/middleware/myMiddleware.ts`:

```typescript
import type { Middleware } from './types';

export const myMiddleware: Middleware = async (ctx) => {
  // Return Response to halt pipeline, or void to continue
  if (ctx.pathname === '/my-endpoint') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Return nothing to pass to next middleware
};
```

2. Export from `src/middleware/index.ts`:

```typescript
export { myMiddleware } from './myMiddleware';
```

3. Add to pipeline in `src/worker.ts`:

```typescript
const pipeline: Middleware[] = [
  statsAsset,
  staticAsset,
  methodAndCors,
  myMiddleware, // Insert at appropriate position
  torrserver,
  confEndpoint,
  upstream,
];
```

### Adding a New Path Mapping

Edit `src/lib/routing.ts`:

```typescript
const RULES: MappingRule[] = [
  // Add before catch-all:
  {
    type: 'predicate',
    test: (a) => a.startsWith('/mypath'),
    to: (a) => '/api/v2' + a,
  },
  // ... existing rules
];
```

### Adding a New Error Message

1. Add key to `src/lib/i18n.ts`:

```typescript
type MsgKey /* existing */ = 'my_error';

const RU: LocalePack = {
  messages: {
    // ... existing
    my_error: 'Моя ошибка',
  },
};

const EN: LocalePack = {
  messages: {
    // ... existing
    my_error: 'My error',
  },
};
```

2. Use in code:

```typescript
import { errorResponse } from './errors';
return errorResponse(ctx.locale, 'my_error', 'my_error', 400);
```

### Adding Security Headers

Edit `src/lib/security.ts`:

```typescript
export function addStandardResponseHeaders(h: Headers): void {
  // ... existing headers
  h.set('My-Custom-Header', 'value');
}
```

### Adding a Direct Passthrough Path

Edit `src/lib/constants.ts`:

```typescript
export const DIRECT_PREFIXES = [
  // ... existing
  '/mypath',
  '/mypath/',
] as const;

// If exempt from API key:
export const DIRECT_API_KEY_EXEMPT_PREFIXES = [
  // ... existing
  '/mypath',
] as const;
```

---

## Build System

### Asset Hashing

`scripts/copy-static.mjs` handles:

1. Copy `public/` to `dist/`
2. If `ASSET_HASH=1`:
   - Hash CSS/JS files (SHA-256, 10 chars)
   - Rename to `filename.{hash}.ext`
   - Update references in HTML
   - Generate `asset-manifest.json`
3. If `MINIFY=1`:
   - Minify CSS/JS with esbuild

### Manifest Resolution

```typescript
// src/lib/manifest.ts
async function resolveHashedPath(env: EnvLike, pathname: string): Promise<string> {
  // Skip if already hashed
  if (/[.-][a-f0-9]{8,}\.[a-z0-9]+$/i.test(pathname)) return pathname;

  // Load manifest from ASSETS (cached in isolate)
  await load(env);

  // Look up hashed path
  const key = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return state.map[key] ? '/' + state.map[key] : pathname;
}
```

---

_Last updated: 2025-11-27_
