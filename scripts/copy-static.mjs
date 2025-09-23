#!/usr/bin/env node
/**
 * Enhanced copy-static.mjs
 * - Copies static assets into dist/
 * - Optional hashing for .css/.js when ASSET_HASH=1 (updates HTML refs)
 * - Generates asset-manifest.json (original -> hashed path)
 * - Writes dist/.cloudflareignore
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transform } from 'esbuild';

const root = process.cwd();
const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });

// Source static root now centralized under ./public
const publicRoot = path.join(root, 'public');
const entries = fs.existsSync(publicRoot)
  ? fs.readdirSync(publicRoot) // copy everything inside public (first-level)
  : ['index.html', 'stats.html', 'css', 'js', 'img']; // fallback (legacy)
const enableHash = !!process.env.ASSET_HASH;
const manifest = {}; // original relative -> hashed relative
const enableMinify = !!process.env.MINIFY;

function hashContent(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

async function copyRecursive(src, dest, rel = '') {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      await copyRecursive(path.join(src, file), path.join(dest, file), path.join(rel, file));
    }
  } else {
    if (enableHash && /\.(css|js)$/i.test(src)) {
      let buf = fs.readFileSync(src);
      if (enableMinify) {
        try {
          const ext = path.extname(src).toLowerCase();
          const result = await transform(buf.toString('utf8'), {
            loader: ext === '.css' ? 'css' : 'js',
            minify: true,
            legalComments: 'none',
            format: ext === '.js' ? 'iife' : undefined,
            target: 'es2019',
          });
          buf = Buffer.from(result.code, 'utf8');
        } catch (e) {
          console.warn('[copy-static] Minify failed for', rel, e.message);
        }
      }
      const h = hashContent(buf);
      const parsed = path.parse(dest);
      const hashedName = `${parsed.name}.${h}${parsed.ext}`;
      const outPath = path.join(parsed.dir, hashedName);
      if (!fs.existsSync(parsed.dir)) fs.mkdirSync(parsed.dir, { recursive: true });
      fs.writeFileSync(outPath, buf);
      manifest[rel] = path.join(path.relative(dist, outPath));
    } else {
      // If minify requested but not hashing (e.g., watching without ASSET_HASH) still minify in-place for .js/.css
      if (enableMinify && /\.(css|js)$/i.test(src)) {
        try {
          const ext = path.extname(src).toLowerCase();
          const result = await transform(fs.readFileSync(src, 'utf8'), {
            loader: ext === '.css' ? 'css' : 'js',
            minify: true,
            legalComments: 'none',
            format: ext === '.js' ? 'iife' : undefined,
            target: 'es2019',
          });
          fs.writeFileSync(dest, result.code, 'utf8');
        } catch (e) {
          console.warn('[copy-static] Inline minify failed for', rel, e.message);
          fs.copyFileSync(src, dest);
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }
}
// Copy phase: if ./public exists treat its contents as root-level deployable
async function run() {
  if (fs.existsSync(publicRoot)) {
    for (const entry of entries) {
      const src = path.join(publicRoot, entry);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(dist, entry);
      await copyRecursive(src, dest, entry);
    }
  } else {
    for (const e of entries) {
      // legacy fallback
      const src = path.join(root, e);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(dist, e);
      await copyRecursive(src, dest, e);
    }
  }

  if (enableHash) {
    for (const htmlName of ['index.html', 'stats.html']) {
      const p = path.join(dist, htmlName);
      if (!fs.existsSync(p)) continue;
      let html = fs.readFileSync(p, 'utf8');
      for (const [orig, hashed] of Object.entries(manifest)) {
        // Escape regex special characters in original path for global replacement
        const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(escaped, 'g'), hashed);
      }
      fs.writeFileSync(p, html, 'utf8');
    }
    fs.writeFileSync(path.join(dist, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
  }

  const ignoreContent = `# dist/.cloudflareignore\n# Only upload built assets & worker.\nnode_modules\nsrc\nscripts\n*.ts\npackage.json\npackage-lock.json\ntsconfig.json\n`;
  fs.writeFileSync(path.join(dist, '.cloudflareignore'), ignoreContent, 'utf8');

  console.log(
    `Static assets copied to dist${enableHash ? ' (hashed)' : ''}${enableMinify ? ' (minified)' : ''}`
  );
}

// Execute async pipeline
run();
