/**
 * Security headers.
 *
 * The app is a self-contained SPA served by this same process: no CDN, no
 * inline scripts, no third-party origin. That means the policy below can be
 * genuinely strict - it is a real allowlist, not a decorative header.
 *
 * Two deliberate relaxations, each with a reason:
 *   - `style-src 'unsafe-inline'`: Vite injects a <style> tag during dev, and
 *     Tailwind's preflight is happiest without a nonce round-trip. Scripts stay
 *     locked to 'self'.
 *   - HSTS off by default: this is served over plain HTTP on a shop LAN, and
 *     HSTS on a bare IP or http:// origin makes browsers refuse to load it at
 *     all. Turn it on once the app is behind real HTTPS.
 */

import helmet from 'helmet';
import config from '../config/env.js';

const TAG = 'security';

export function securityHeaders() {
  const isProduction = config.nodeEnv === 'production';

  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        // The recorded clip is a blob: URL; icons are inline data URIs.
        'media-src': ["'self'", 'blob:'],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'", 'data:'],
        // The API is same-origin in production; in dev Vite proxies /api, so
        // 'self' plus the dev origin both stay same-origin to the page.
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        // Would silently rewrite http:// on the LAN to https:// and break the app.
        'upgrade-insecure-requests': null,
      },
    },
    // Enable only when actually behind HTTPS.
    strictTransportSecurity: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

export { TAG as SECURITY_TAG };
