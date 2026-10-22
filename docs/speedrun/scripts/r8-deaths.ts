// R8's Wilderness death prices, from the slot ledger's own rows, section 2's leg and step figures and
// the engine's death rules, so a fold-in re-prices a death by re-running this rather than by hand.
//
//   bun docs/speedrun/scripts/r8-deaths.ts
//   SPARE_ARROWS=0 bun docs/speedrun/scripts/r8-deaths.ts   (S27 before h92's spare 570 is banked)
//
// The engine (server/content/scripts/player/scripts/death.rs2, r): a death to another player respawns
// at Lumbridge on 1 HP, not full, and a death mark keeps any further death at 1 HP for a while; an
// unskulled player keeps the three priciest single units carried, worn or held, by obj cost (one unit
// of a stack: one arrow, one coin), and everything else drops for the killer. A shark heals 20 behind a
// 3-tick eat delay (consume_normal.dbrow, consume.rs2). A deployed cannon is a loc only its owner can
// pick up, decaying 2,500 ticks after its set-up (quest_mcannon cannon_setup.rs2, cannon.constant), so
// a death beside it loses neither the cannon nor its set-up if SCORED is back inside the decay. xp is
// kept, so a step's progress is never lost; what a death costs is the time back to where it happened,
// plus whatever the run still needs that the killer took.
//
// For each stretch this prints the kit SCORED carries (the ledger's state after the named row), the
// three units the engine keeps, and every lost item classed by the ledger's later rows: 'returned
// unused' if its next appearance is a swap, trade, deposit or drop with no step using it first,
// otherwise 'needed' with where. The price is the recovery below plus the stretch's own replay.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST, parseLedger, walk, type Held, type LedgerRow } from '../../../speedrun/tools/slot-ledger.ts';

const root = join(import.meta.dir, '../../..');
const ro = readFileSync(join(import.meta.dir, '..', 'RUN-ORDER.md'), 'utf8').split('\n');

// Section 2's expected figure for a row id (its first table only).
const NUM = String.raw`[\d,]+(?:\.\d+)?`;
const h = ro.findIndex(l => l.startsWith('| ID | Kind |'));
const s2 = new Map<string, number>();
for (const l of ro.slice(h + 2)) {
    if (!l.startsWith('|')) break;
    const c = l.split('|').slice(1, -1).map(x => x.trim());
    const m = c[5]?.replace(/\*/g, '').match(new RegExp(`^(?:knife )?(${NUM})`));
    if (c[0] && m && !s2.has(c[0])) s2.set(c[0], Number(m[1]!.replace(/,/g, '')));
}
const fig = (id: string) => {
    const v = s2.get(id);
    if (v === undefined) throw new Error(`section 2 has no figure for ${id}`);
    return v;
};

// Obj costs by game name, and by id through pack/obj.pack for `NAME @ID` rows.
const objs = new Map<string, { debug: string; name: string; cost: number; destroy: boolean }[]>();
const byDebug = new Map<string, { debug: string; name: string; cost: number; destroy: boolean }>();
const walkDir = (d: string): string[] => readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walkDir(p) : p.endsWith('.obj') ? [p] : [];
});
for (const f of walkDir(join(root, 'server/content/scripts'))) {
    for (const b of readFileSync(f, 'utf8').split(/\n(?=\[)/)) {
        const debug = b.match(/^\[([^\]]+)\]/)?.[1];
        const name = b.match(/^name=(.*)$/m)?.[1];
        if (!debug || !name || /^certtemplate=/m.test(b)) continue;
        const o = { debug, name, cost: Number(b.match(/^cost=(\d+)$/m)?.[1] ?? 0), destroy: /^param=destroy_death,\^true$/m.test(b) };
        byDebug.set(debug, o);
        const k = name.toLowerCase();
        objs.set(k, [...(objs.get(k) ?? []), o]);
    }
}
const packIds = new Map(readFileSync(join(root, 'server/content/pack/obj.pack'), 'utf8').split('\n').map(l => l.split('=') as [string, string]).map(([i, d]) => [Number(i), d] as const));
const { rows, errors } = parseLedger(readFileSync(MANIFEST, 'utf8'));
if (errors.length) throw new Error(errors.join('\n'));
// A name several objs share (the greegrees) takes the id some row gives it (`NAME @ID`).
const rowIds = new Map<string, number>();
for (const r of rows) for (const e of [...r.in, ...r.out]) if (e.id !== undefined) rowIds.set(e.name.toLowerCase(), e.id);
const obj = (it: Held) => {
    const id = it.id ?? rowIds.get(it.name.toLowerCase());
    if (id !== undefined) return byDebug.get(packIds.get(id) ?? '');
    const all = objs.get(it.name.toLowerCase()) ?? [];
    return all.find(o => o.debug === it.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')) ?? all[0];
};
const entries = walk(rows);
const at = (row: string) => {
    const i = rows.findIndex(r => r.row === row);
    if (i < 0) throw new Error(`no ledger row ${row}`);
    return i;
};

type Unit = { name: string; count: number; worn: boolean; cost: number; known: boolean };
const kit = (row: string, without: RegExp | null = null): Unit[] => {
    const { inv, worn } = entries[at(row)]!.stacks;
    const unit = (it: Held, w: boolean): Unit => {
        const o = obj(it);
        return { name: it.name, count: it.count ?? 0, worn: w, cost: o && !o.destroy ? o.cost : 0, known: !!o };
    };
    return [...inv.map(i => unit(i, false)), ...worn.map(i => unit(i, true))].filter(u => !without || !without.test(u.name));
};
// death.rs2's move_priciest_item_on_hero_to_death, three times: one unit each, held before worn on a tie.
const keep3 = (units: Unit[]) => {
    const left = units.map(u => ({ ...u }));
    const kept: string[] = [];
    for (let n = 0; n < 3; n++) {
        let best: (typeof left)[number] | undefined;
        for (const u of [...left.filter(u => !u.worn), ...left.filter(u => u.worn)]) if (u.count > 0 && u.cost > (best?.cost ?? 0)) best = u;
        if (!best) break;
        best.count -= 1;
        kept.push(`${best.name} (${best.cost})`);
    }
    return { kept, lost: left.filter(u => u.count > 0) };
};

// A lost item's fate in the rows after the stretch: the first row that consumes or hands it in, or
// that wears it through a step, makes it needed; a swap, trade, deposit or drop first returns it unused.
// A stretch names the kit the step it is in or heading to still uses (`uses`).
const isStep = (r: LedgerRow) => /^S\d/.test(r.row);
const fate = (u: Unit, from: string, uses?: [RegExp, string]) => {
    if (uses && uses[0].test(u.name)) return `needed: ${uses[1]}`;
    if (/^S1[7]$/.test(from)) return 'not needed: the run ends on the course';
    const k = u.name.toLowerCase();
    const fam = k.replace(/\(\d\)$/, '');
    const mine = (n: string) => n.toLowerCase() === k || n.toLowerCase().replace(/\(\d\)$/, '') === fam;
    // Worn through a step means still worn once the step's row is done; S17's course uses no kit.
    let wornThrough: string | null = null;
    for (let i = at(from) + 1; i < rows.length; i++) {
        const r = rows[i]!;
        const o = r.out.find(e => mine(e.name));
        if (o && (o.reason === 'consume' || o.reason === 'hand-in')) return `needed: ${o.reason} at ${r.row}`;
        if (o) return wornThrough ? `needed: worn through ${wornThrough}, back at ${r.row}` : `returned unused (${o.reason} at ${r.row})`;
        if (!wornThrough && isStep(r) && r.row !== 'S17' && entries[i]!.stacks.worn.some(w => mine(w.name))) wornThrough = r.row;
    }
    return wornThrough ? `needed: worn through ${wornThrough}` : `not used after ${from}`;
};

const HELPER = 10; // e: the recovery helper cued at the death reaching the Lumbridge spawn (fold-in 28's 'respawn ~10')
const TRADE = 5; // e: one trade at the spawn: the teleport runes, the food and the spare kit
const heal = (hp: number) => Math.ceil((hp - 1) / 20); // sharks from 1 HP back to full, 3 ticks each

// H11 and H13 are trades at the Ardougne landing, inside T13-14 and T15-16 before the lever, so the
// kit those legs carry into the Wilderness is the state after H11 and after H13; the ledger lists each
// trade after its leg, whose row then holds only the teleport cast (the T13-14 and T15-16 lines below).
type Stretch = { name: string; row: string; deployed?: boolean; hp: number; replay: [number, number]; how: string; uses?: [RegExp, string] };
const cannon = /^(cannon (base|stand|barrels|furnace)|cannonball)$/;
const stretches: Stretch[] = [
    { name: 'T13-14 as the ledger walks it (before H11)', row: 'T13-14', hp: 42, replay: [0, fig('T13-14')], how: 'T13-14 again, the part already walked' },
    { name: 'T13-14 with H11 at the landing (the Wilderness carry to the spiders)', row: 'H11', hp: 42, replay: [0, fig('T13-14')], how: 'T13-14 again, the part already walked', uses: [/^(cannon (base|stand|barrels|furnace)|cannonball|mithril scimitar)$/, 'S14 ahead'] },
    { name: 'S14 deployed (the cannon on the ground)', row: 'S14', deployed: true, hp: 42, replay: [fig('T13-14'), fig('T13-14')], how: 'T13-14 again; the cannon waits, no second set-up', uses: [/^mithril scimitar$/, 'wielded for the rest of S14'] },
    { name: 'T14-15 (the spiders to the Ardougne cast, the cannon packed)', row: 'T14-15', hp: 42, replay: [0, 66], how: 'the Wilderness part already walked (~66 to level 20, R8)' },
    { name: 'T15-16 as the ledger walks it (before H13)', row: 'T15-16', hp: 42, replay: [0, fig('T15-16')], how: 'T15-16 again, the part already walked' },
    { name: 'T15-16 with H13 at the landing (the Wilderness carry to the arena)', row: 'H13', hp: 42, replay: [0, fig('T15-16')], how: 'T15-16 again, the part already walked; a second H13 kit in the trade' },
    { name: 'S27 deployed (the cannon on the ground)', row: 'S27', deployed: true, hp: 97, replay: [fig('T26-27'), fig('T26-27')], how: 'T26-27 again; the cannon waits, no second set-up', uses: [/^(magic shortbow|rune arrow)$/, 'the rest of S27'] },
    { name: 'S27 bow phase (the cannon fired out and packed)', row: 'S27', hp: 97, replay: [fig('T26-27'), fig('T26-27')], how: 'T26-27 again; the cannon done, no set-up', uses: [/^(magic shortbow|rune arrow)$/, 'the rest of S27'] },
    { name: 'S17 mid-course', row: 'S17', hp: 97, replay: [fig('T13-14') + fig('T27-17') + 66, fig('T13-14') + fig('T27-17') + 157], how: "T13-14's lever leg and T27-17 again, plus the lap in progress (66-157)" },
];

const spareArrows = process.env.SPARE_ARROWS !== '0';
for (const s of stretches) {
    const units = kit(s.row, s.deployed ? cannon : null);
    const unknown = units.filter(u => !u.known).map(u => u.name);
    const { kept, lost } = keep3(units);
    const sharks = heal(s.hp);
    const fixed = HELPER + TRADE + 3 * sharks;
    console.log(`\n${s.name}: the ledger's state after ${s.row}${s.deployed ? ', the cannon and its balls on the ground' : ''}`);
    console.log(`  carried: ${units.map(u => `${u.name} x${u.count}${u.worn ? ' (worn)' : ''}`).join(', ')}`);
    if (unknown.length) console.log(`  no obj cost found (priced 0): ${unknown.join(', ')}`);
    console.log(`  kept (keep 3, by obj cost): ${kept.join(', ')}`);
    const fates = lost.map(u => [u, fate(u, s.row, s.uses)] as const);
    for (const [u, f] of fates) console.log(`  lost ${u.name} x${u.count}: ${f}`);
    const needed = fates.filter(([, f]) => f.startsWith('needed')).map(([u]) => `${u.name} x${u.count}`);
    console.log(`  the recovery trade carries: ${needed.join(', ') || 'nothing the run needs'}; and ${sharks} sharks to eat back from 1 HP`);
    console.log(`  price: helper ${HELPER} e + trade ${TRADE} e + ${sharks} sharks from 1 HP to ${s.hp} at 3 = ${3 * sharks} i, ${fixed}; + ${s.how}, ${s.replay[0]}-${s.replay[1]}: ${Math.round(fixed + s.replay[0])}-${Math.round(fixed + s.replay[1])}`);
}
if (!spareArrows) console.log("\nSPARE_ARROWS=0: S27's lost 570 rune arrows have no spare on h92, so S27's finish after a death is priced on what h91's top-up holds, its shortfall stated.");
