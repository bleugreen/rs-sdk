// Every webclient suite installs the browser globals itself, before anything else
// (see browser-globals.ts), so none depends on which file `bun test` loaded first.

import { expect, test } from 'bun:test';

import './browser-globals.js';

import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dir, '../..');
const BROWSER_GLOBALS = join(import.meta.dir, 'browser-globals.ts');
const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** The first module a suite evaluates after bun:test, as a source path where it is relative. */
function firstImport(file: string, source: string): string | null {
    const first = transpiler.scanImports(source).find(i => i.path !== 'bun:test');
    if (!first) {
        return null;
    }
    if (first.kind !== 'import-statement' || !first.path.startsWith('.')) {
        return `${first.kind} ${first.path}`;
    }
    return resolve(dirname(file), first.path).replace(/\.js$/, '.ts');
}

const suites = [...new Bun.Glob('**/*.test.ts').scanSync({ cwd: SRC, absolute: true })].sort();

test('the scan finds the webclient suites, this one among them', () => {
    expect(suites).toContain(join(import.meta.dir, 'browser-globals.test.ts'));
});

test.each(suites.map(file => relative(SRC, file)))('%s imports test-support/browser-globals first', async suite => {
    const file = join(SRC, suite);
    expect(firstImport(file, await Bun.file(file).text())).toBe(BROWSER_GLOBALS);
});
