// Compare two minified webclient bundles (server/webclient `bun run build` output, e.g.
// out/bot/client.js) for code identity across builds.
//
// The bundle is not byte-reproducible: Bun + Terser pick different short names on every
// build, and that choice in turn flips layout decisions (`let{a:x}=o` vs `let x=o.a`, the
// order of the export list). So a raw md5 names a build, never a commit. This prints:
//   raw         md5 and byte size (equal only for the same build artifact)
//   normalised  md5 after every 1-3 char identifier becomes `_` (equal for same-toolchain
//               builds of the same source; layout flips still differ)
//   words       multiset of every 4+ char word and every number, strings included, over
//               the normalised text. Insensitive to renaming and to the layout flips, so
//               equal multisets mean same source; the differing words say what changed.
//
// Usage: bun docs/speedrun/scripts/bundle-compare.ts A.js B.js [--split DIR] [--show N]
//   --split DIR  write DIR/a.txt and DIR/b.txt (normalised, one statement per line) for `diff`
// Exit 0 when the word multisets are equal, 1 when they differ.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KEYWORDS = new Set(('if in do for let new try var of NaN get set case else enum null this true void with break catch class const false ' +
    'super throw while yield async await delete export import return static switch typeof default extends finally continue debugger function arguments instanceof undefined Infinity').split(' '));
const SHORT_IDENT = /(?<![A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$]{0,2}(?![A-Za-z0-9_$])/g;
const WORD = /[A-Za-z_$][A-Za-z0-9_$]{3,}|(?<![A-Za-z0-9_$.])\d[\d.eExXa-fA-F]*/g;

export function normalise(src: string): string {
    return src.replace(SHORT_IDENT, m => (KEYWORDS.has(m) ? m : '_'));
}

function words(norm: string): Map<string, number> {
    const bag = new Map<string, number>();
    for (const w of norm.match(WORD) ?? []) bag.set(w, (bag.get(w) ?? 0) + 1);
    return bag;
}

const md5 = (s: string | Buffer) => createHash('md5').update(s).digest('hex');

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const splitDir = flag('--split');
const show = Number(flag('--show') ?? 20);
if (args.length !== 2) {
    console.error('usage: bundle-compare.ts A.js B.js [--split DIR] [--show N]');
    process.exit(2);
}

const [a, b] = args.map(p => ({ path: p, raw: readFileSync(p) }));
const [na, nb] = [a, b].map(f => normalise(f.raw.toString('utf8')));
for (const [f, n] of [[a, na], [b, nb]] as const) {
    console.log(`${f.path}\n  raw ${md5(f.raw)} ${f.raw.length} B   normalised ${md5(n)} ${n.length} chars`);
}
console.log(`raw ${md5(a.raw) === md5(b.raw) ? 'EQUAL' : 'differ'}; normalised ${md5(na) === md5(nb) ? 'EQUAL' : 'differ'}`);

const [wa, wb] = [words(na), words(nb)];
const only = (x: Map<string, number>, y: Map<string, number>) =>
    [...x].map(([w, c]) => [w, c - (y.get(w) ?? 0)] as const).filter(([, c]) => c > 0);
const [oa, ob] = [only(wa, wb), only(wb, wa)];
const total = (m: Map<string, number>) => [...m.values()].reduce((s, c) => s + c, 0);
console.log(`words ${total(wa)} vs ${total(wb)}; only in A ${oa.reduce((s, [, c]) => s + c, 0)}, only in B ${ob.reduce((s, [, c]) => s + c, 0)}: ${oa.length || ob.length ? 'DIFFER (different source)' : 'EQUAL (same source)'}`);
for (const [w, c] of oa.slice(0, show)) console.log(`  A +${c} ${w}`);
for (const [w, c] of ob.slice(0, show)) console.log(`  B +${c} ${w}`);

if (splitDir) {
    mkdirSync(splitDir, { recursive: true });
    const split = (n: string) => n.replace(/([;{}])/g, '$1\n');
    writeFileSync(join(splitDir, 'a.txt'), split(na));
    writeFileSync(join(splitDir, 'b.txt'), split(nb));
    console.log(`normalised statements written to ${splitDir}/a.txt and b.txt`);
}
process.exit(oa.length || ob.length ? 1 : 0);
