import { LOCAL_PREFIX } from './constants';

// Declarative mapping rules. Earlier entries have higher priority.
// Each rule either provides a regex or predicate and a target resolver.
type MappingRule =
  | { type: 'regex'; test: RegExp; to: (_path: string) => string }
  | { type: 'predicate'; test: (_path: string) => boolean; to: (_path: string) => string };

const RULES: MappingRule[] = [
  {
    type: 'regex',
    test: /^(\/conf\/?$)/,
    to: () => '/api/v1.0/conf',
  },
  {
    type: 'predicate',
    test: (a) => a.startsWith('/torrents'),
    to: () => '/api/v1.0/torrents',
  },
  {
    type: 'regex',
    test: /^(\/stats\/?$)/,
    to: () => '/stats',
  },
  {
    type: 'predicate',
    test: (a) => a.startsWith('/stats/'),
    to: (a) => a, // passthrough (already includes /stats/...)
  },
  {
    type: 'regex',
    test: /^\/v\d/, // versioned paths like /v1/... -> /api/v1/...
    to: (a) => '/api' + a,
  },
  // Final catch-all rule (always matches)
  {
    type: 'predicate',
    test: () => true,
    to: (a) => '/api' + a,
  },
];

/**
 * Maps a local /api/* pathname to the corresponding upstream path.
 * Uses declarative rules with regex/predicate matching.
 *
 * @param pathname - The incoming pathname starting with /api (e.g., '/api/conf')
 * @returns The mapped upstream path (e.g., '/api/v1.0/conf')
 * @example
 * ```ts
 * mapUpstreamPath('/api/conf');      // '/api/v1.0/conf'
 * mapUpstreamPath('/api/torrents');  // '/api/v1.0/torrents'
 * mapUpstreamPath('/api/v2/search'); // '/api/v2/search'
 * ```
 */
export function mapUpstreamPath(pathname: string): string {
  const after = pathname.substring(LOCAL_PREFIX.length);
  for (const rule of RULES) {
    const matched = rule.type === 'regex' ? rule.test.test(after) : rule.test(after);
    if (matched) return rule.to(after);
  }
  // Technically unreachable because of final catch-all.
  return '/api' + after;
}
