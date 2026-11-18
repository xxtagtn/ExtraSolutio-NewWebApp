import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { defineConfig } from 'prisma/config';
import * as XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

test('patched toolchain preserves Prisma config and Excel import formats', () => {
  const config = defineConfig({ schema: 'prisma/sqlite/schema.prisma' });
  assert.equal(config.schema, 'prisma/sqlite/schema.prisma');
  assert.equal(XLSX.version, '0.20.3');
  for (const bookType of ['xlsx', 'xls', 'csv']) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,
      XLSX.utils.aoa_to_sheet([['Colaborador', 'Horas'], ['Pessoa QA', 9.5]]), 'Horarios');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType });
    const reopened = XLSX.read(bytes, { type: 'buffer' });
    assert.deepEqual(XLSX.utils.sheet_to_json(reopened.Sheets[reopened.SheetNames[0]], { header: 1 }),
      [['Colaborador', 'Horas'], ['Pessoa QA', 9.5]]);
  }
});

test('both real schemas validate and generate clients without accessing app databases', async () => {
  const cache = path.join(root, 'node_modules', '.cache');
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, 'dependency-prisma-'));
  try {
    for (const provider of ['sqlite', 'mysql']) {
      const output = path.join(temporary, `${provider}-client`);
      const schemaPath = path.join(temporary, `${provider}.prisma`);
      const source = await readFile(path.join(root, 'prisma', provider, 'schema.prisma'), 'utf8');
      assert.match(source, /generator client \{/);
      const schema = source.replace('generator client {',
        `generator client {\n  output = ${JSON.stringify(output.replaceAll('\\', '/'))}`);
      await writeFile(schemaPath, schema);
      const env = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1',
        DATABASE_URL: provider === 'mysql'
          ? 'mysql://validation:validation@127.0.0.1:3306/validation'
          : `file:${path.join(temporary, 'unused.db').replaceAll('\\', '/')}` };
      for (const command of ['validate', 'generate']) {
        execFileSync(process.execPath, [prismaCli, command, '--schema', schemaPath],
          { cwd: root, env, timeout: 90000, stdio: 'pipe' });
      }
      const generated = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8'));
      assert.equal(generated.version, '6.19.3');
    }
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), cache);
    await rm(temporary, { recursive: true, force: true });
  }
});
