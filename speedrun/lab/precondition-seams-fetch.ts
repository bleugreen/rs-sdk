#!/usr/bin/env bun
// Fetches attempt 1's run-config.json and helpers.json from their install comment (rs/496 comment 50),
// checks each sha256 against the published one, and writes them to <dir>. Lab-only, for
// precondition-seams.ts.
//
//   bun speedrun/lab/precondition-seams-fetch.ts <dir>

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';

// @cairn/sdk is the Cairn host's module, not a repo dependency: loaded by a non-literal specifier so
// the repo's typecheck does not compile the host's sources.
const SDK = '@cairn/sdk';
const { read } = (await import(SDK)) as { read: (uri: string) => Promise<unknown> };

const SHA: Record<string, string> = {
    'run-config.json': '1468f907ec4afa131648385436525d82548b20d2b8ecea1f57e75d1a6c119c95',
    'helpers.json': 'cd4faa74c84c2a9393e0e9569cb3940e51be37ee8e824b69989ddfc0dac2d64f',
};
const dir = process.argv[2];
if (!dir) throw new Error('usage: precondition-seams-fetch.ts <dir>');
mkdirSync(dir, { recursive: true });
let text = '';
for (let off = 0; off < 2800; off += 500) {
    const r: unknown = await read(`cairn://p/rs/496/comments/50?offset=${off}&limit=500`);
    const t = typeof r === 'string' ? r : String((r as { content?: string }).content ?? '');
    let lines = t.split('\n');
    lines = lines.slice(lines.findIndex(l => l.startsWith('=== ')) + 1);
    const e = lines.findIndex(l => /^\[lines \d+/.test(l));
    text += (e >= 0 ? lines.slice(0, e) : lines).join('\n') + '\n';
}
for (const f of Object.keys(SHA)) {
    const m = new RegExp(`### ${f.replace('.', '\\.')}[^\\n]*\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(text);
    if (!m) throw new Error(`${f}: no fenced block`);
    const bytes = m[1] + '\n';
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== SHA[f]) throw new Error(`${f}: sha256 ${sha}, published ${SHA[f]}`);
    writeFileSync(`${dir}/${f}`, bytes);
    console.log(`${f} ${bytes.length} bytes sha256 ${sha} ok`);
}
