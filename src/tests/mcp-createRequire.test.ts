/**
 * Regression test for #3914 — MCP server uses explicit .js SDK subpaths.
 *
 * Extensionless wildcard exports for `server/stdio` and `types` do not resolve
 * reliably across current Node / SDK combinations. The runtime import strings
 * must include `.js`.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const source = readFileSync(join(__dirname, '..', 'mcp-server.ts'), 'utf-8');

describe('MCP server SDK subpath imports (#3914)', () => {
  test('server/stdio import uses explicit .js subpath', () => {
    assert.match(source, /await import\(`\$\{MCP_PKG\}\/server\/stdio\.js`\)/,
      'server/stdio import should include the .js suffix');
  });

  test('types import uses explicit .js subpath', () => {
    assert.match(source, /await import\(`\$\{MCP_PKG\}\/types\.js`\)/,
      'types import should include the .js suffix');
  });

  test('legacy createRequire-based resolution is gone', () => {
    assert.doesNotMatch(source, /createRequire|_require\.resolve/,
      'legacy createRequire-based subpath resolution should not remain');
  });
});
