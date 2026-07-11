import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOTS = ['src', 'server', 'scripts', 'public', 'prisma'];
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.jsx', '.json', '.md', '.prisma', '.sql']);

// These are the byte sequences produced when UTF-8 text is decoded as Windows-1252 and encoded again.
const MOJIBAKE_PATTERN = new RegExp(
  '(?:\\u00c3[\\u00a1\\u00a2\\u00a3\\u00a7\\u00a9\\u00aa\\u00ad\\u00b3\\u00ba]|\\u00c2[\\u00ab\\u00bb\\u00b7]|\\u00c3\\u0192|\\u00ef\\u00bf\\u00bd)',
  'u',
);

function collectTextFiles(directory, result = []) {
  for (const name of fs.readdirSync(directory)) {
    if (['node_modules', 'dist', '_recovery_clone', '.git'].includes(name)) continue;
    const filePath = path.join(directory, name);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      collectTextFiles(filePath, result);
    } else if (TEXT_EXTENSIONS.has(path.extname(filePath))) {
      result.push(filePath);
    }
  }
  return result;
}

test('source files do not contain UTF-8 mojibake sequences', () => {
  const findings = [];
  for (const relativeRoot of SOURCE_ROOTS) {
    const directory = path.join(ROOT, relativeRoot);
    if (!fs.existsSync(directory)) continue;
    for (const filePath of collectTextFiles(directory)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (MOJIBAKE_PATTERN.test(content)) {
        findings.push(path.relative(ROOT, filePath));
      }
    }
  }

  assert.deepEqual(findings, []);
});
