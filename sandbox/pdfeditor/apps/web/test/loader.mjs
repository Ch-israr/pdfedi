/**
 * Node module loader for running web-app tests.
 * Resolves the `@/*` TypeScript path alias to the apps/web directory.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const WEB_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_APP_ROOT = path.resolve(WEB_ROOT, '..');

/** Resolve a path, trying .ts/.tsx/.js/.mjs extensions and index files. */
function resolveWithExtensions(basePath) {
  const candidates = [
    basePath,
    basePath + '.ts',
    basePath + '.tsx',
    basePath + '.js',
    basePath + '.mjs',
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.resolve(WEB_APP_ROOT, specifier.slice(2));
    const resolved = resolveWithExtensions(base);
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }
  // Also handle relative imports without extensions (from .ts files)
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const base = path.resolve(parentDir, specifier);
      const resolved = resolveWithExtensions(base);
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
      throw new Error(`Cannot resolve ${specifier}`);
    }
  }
  return nextResolve(specifier, context);
}
