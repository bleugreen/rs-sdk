// Builds docs/markets/supplies.md's generated tables.
//
//   bun markets/supplies/build.ts ge --origin=<game HTTP origin> [--gap=4000]
//       Reads every supply's GE quote (and its 7-day history when it traded), one request at a time,
//       into markets/supplies/data/ge.json. The origin is given on the command line only and never
//       written to the file.
//   bun markets/supplies/build.ts render [--doc=docs/markets/supplies.md]
//       Re-renders the document's generated block from the content, data/ge.json and, if present,
//       data/shelf.json (the shelf reader's counts: [{inv, obj, count, price?, at}]).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { BANKS, SHOPS } from '../../speedrun/helpers/buyer';
import { loadContent } from './content';
import { readMarket, type GeRead } from './ge';
import { SUPPLIES } from './items';
import { objOf, render, splice, type Bank, type ShelfRead } from './render';
import { shopRows, type ShopRow } from './shops';

const DATA = 'markets/supplies/data';
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);

/** The buyer's SHOPS key whose shopkeeper and stand match this row's NPC and spawn. */
function fleetKey(row: ShopRow): string | undefined {
    const s = row.spawns[0];
    if (!s) return undefined;
    return Object.entries(SHOPS).find(
        ([, v]) =>
            (row.owner.npcName ?? row.owner.npc).split(' / ').some(name => v.npc.test(name)) &&
            row.spawns.some(s => (v.stand.level ?? 0) === s.level && Math.max(Math.abs(v.stand.x - s.x), Math.abs(v.stand.z - s.z)) < 20),
    )?.[0];
}

const cmd = process.argv[2];
const content = loadContent();
if (cmd === 'ge') {
    const origin = arg('origin');
    if (!origin) throw new Error('--origin=<game HTTP origin> is required');
    const ids = [...new Set(SUPPLIES.map(s => objOf(s, content)?.id).filter((id): id is number => id !== undefined))];
    const reads: GeRead[] = await readMarket(origin, ids, { gapMs: Number(arg('gap') ?? 4_000), log: l => console.log(new Date().toISOString().slice(11, 19), l) });
    mkdirSync(DATA, { recursive: true });
    writeFileSync(`${DATA}/ge.json`, JSON.stringify(reads, null, 1) + '\n');
    console.log(`${reads.length} items -> ${DATA}/ge.json`);
} else if (cmd === 'render') {
    const doc = arg('doc') ?? 'docs/markets/supplies.md';
    const ge: GeRead[] = existsSync(`${DATA}/ge.json`) ? JSON.parse(readFileSync(`${DATA}/ge.json`, 'utf8')) : [];
    const shelf: ShelfRead[] = existsSync(`${DATA}/shelf.json`) ? JSON.parse(readFileSync(`${DATA}/shelf.json`, 'utf8')) : [];
    const banks: Bank[] = Object.entries(BANKS)
        .filter(([, b]) => !('level' in b))
        .map(([name, b]) => ({ name, x: b.x, z: b.z }));
    const block = render({ supplies: SUPPLIES, content, rows: shopRows(content), ge, shelf, banks, fleet: fleetKey });
    writeFileSync(doc, splice(readFileSync(doc, 'utf8'), block));
    console.log(`rendered ${doc}`);
} else {
    console.error('usage: bun markets/supplies/build.ts ge --origin=<url> [--gap=ms] | render [--doc=path]');
    process.exit(2);
}
