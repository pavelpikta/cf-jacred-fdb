import { LOCAL_PREFIX } from './constants';

// Declarative mapping rules. Earlier entries have higher priority.
// Each rule either provides a regex or predicate and a target resolver.
interface MappingRule {
  test: RegExp | ((_path: string) => boolean);
  to: (_path: string) => string;
}

const RULES: MappingRule[] = [
  {
    test: /^(\/conf\/?$)/,
    to: () => '/api/v1.0/conf',
  },
  {
    test: (a) => a.startsWith('/torrents'),
    to: () => '/api/v1.0/torrents',
  },
  {
    test: /^(\/stats\/?$)/,
    to: () => '/stats',
  },
  {
    test: (a) => a.startsWith('/stats/'),
    to: (a) => a, // passthrough (already includes /stats/...)
  },
  {
    test: /^\/v\d/, // versioned paths like /v1/... -> /api/v1/...
    to: (a) => '/api' + a,
  },
  // Final catch-all rule (always matches)
  {
    test: () => true,
    to: (a) => '/api' + a,
  },
];

export function mapUpstreamPath(pathname: string): string {
  const after = pathname.substring(LOCAL_PREFIX.length);
  for (const rule of RULES) {
    const matched =
      typeof rule.test === 'function' ? rule.test(after) : (rule.test as RegExp).test(after);
    if (matched) return rule.to(after);
  }
  // Technically unreachable because of final catch-all.
  return '/api' + after;
}
