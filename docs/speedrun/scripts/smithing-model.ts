// Smithing route model (docs/speedrun/skills/smithing.md): best anvil item per level and the
// ticks and bars from a start level to 99, for a given per-inventory overhead.
//
//   bun docs/speedrun/scripts/smithing-model.ts [--from 1] [--overhead 7] [--switch 2] [--levelup 0] [--item 5] [--table]
//
// Reads the content tables so it follows the content:
//   smithing.dbrow   product, levelrequired, bar, bar_amount
//   smithing.struct  xpperbar (tenths of base xp)
//   smithing.inv     which products the anvil interface offers
//   Player.ts        the level table (levelExperience, tenths of game xp)
// Cycle model: one inventory holds 27 bars beside the hammer. Every item costs --item ticks
// (5: p_delay(1) + p_delay(2), measured), every inventory after the first costs --overhead more
// (the bank or trade turnaround, measured), and changing item within an inventory costs --switch
// (a fresh use-bar-on-anvil and interface click, measured as make-1's 7 ticks against make-X's 5).
// --levelup adds that many ticks per level gained (measured as 0 in the route runs).
// Each item is the one with the most base xp per tick at the current level, charging it
// bars/27 of the turnaround; the helper hands over whatever bar mix the plan needs.
// Dart tips (Tourist Trap) and claws (Death Plateau) are excluded.
import { readFileSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
function arg(name: string, def: string): string {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : def;
}
const FROM = Number(arg('from', '1'));
const OVERHEAD = Number(arg('overhead', '7'));
const LEVELUP = Number(arg('levelup', '0'));
const ITEM = Number(arg('item', '5'));
const SWITCH = Number(arg('switch', '2'));
const CAP = 27;

const ROOT = join(import.meta.dir, '../../..');
const CONTENT = join(ROOT, 'server/content/scripts/skill_smithing/configs/smithing');

// ---- level table, as Player.ts computes it (tenths of game xp; base = game / 25) ----
const LEVEL_XP: number[] = [];
{
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2.0, level / 10.0) * 300.0);
        LEVEL_XP[i] = Math.floor(acc / 4) * 10;
    }
}
/** Base xp needed for a level (getLevelByExp: exp >= levelExperience[L-2] gives level L). */
const baseFor = (level: number) => (level <= 1 ? 0 : LEVEL_XP[level - 2]! / 10 / 25);
const levelFor = (base: number) => {
    for (let l = 99; l > 1; l--) if (base + 1e-9 >= baseFor(l)) return l;
    return 1;
};

// ---- content tables ----
const XP_PER_BAR: Record<string, number> = {};
{
    let cur: Record<string, string> = {};
    const flush = () => { if (cur.namedobj) XP_PER_BAR[cur.namedobj] = Number(cur.xpperbar) / 10; };
    for (const l of readFileSync(join(CONTENT, 'smithing.struct'), 'utf8').split('\n')) {
        if (l.startsWith('[')) { flush(); cur = {}; }
        const m = l.match(/^param=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flush();
}
const ON_INTERFACE = new Set<string>();
for (const l of readFileSync(join(CONTENT, 'smithing.inv'), 'utf8').split('\n')) {
    const m = l.match(/^stock\d+=(\w+),/);
    if (m) ON_INTERFACE.add(m[1]!);
}
type Row = { name: string; level: number; bar: string; bars: number; xp: number };
const ROWS: Row[] = [];
{
    let cur: Record<string, string> = {};
    let name = '';
    const flush = () => {
        if (!cur.bar || !ON_INTERFACE.has(name) || /dart_tip|claws/.test(name)) return;
        const bars = Number(cur.bar_amount);
        ROWS.push({ name, level: Number(cur.levelrequired), bar: cur.bar, bars, xp: bars * XP_PER_BAR[cur.bar]! });
    };
    for (const l of readFileSync(join(CONTENT, 'smithing.dbrow'), 'utf8').split('\n')) {
        const h = l.match(/^\[(\w+)\]$/);
        if (h) { flush(); cur = {}; name = h[1]!; continue; }
        const m = l.match(/^data=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flush();
}

// Per-item cost: the item's own ticks plus its share of the inventory turnaround (bars / 27).
const rate = (r: Row) => r.xp / (ITEM + (r.bars * OVERHEAD) / CAP);
function best(level: number): Row {
    return ROWS.filter(r => r.level <= level).sort((a, b) => rate(b) - rate(a) || b.xp - a.xp)[0]!;
}

// ---- simulate one item at a time; an inventory closes when the next item's bars do not fit ----
type Band = { from: number; to: number; item: Row; items: number; ticks: number; xp: number };
const bands: Band[] = [];
let base = baseFor(FROM);
const target = baseFor(99);
let ticks = 0;
let level = levelFor(base);
const bars: Record<string, number> = {};
let levelUps = 0;
let invs = 0;
let switches = 0;
let used = CAP; // force a first inventory
let prev: Row | null = null;
while (base < target) {
    const r = best(level);
    let t = ITEM;
    if (used + r.bars > CAP) {
        if (invs > 0) t += OVERHEAD;
        invs++;
        used = 0;
    } else if (prev && prev !== r) { t += SWITCH; switches++; }
    used += r.bars;
    prev = r;
    base += r.xp;
    const nl = levelFor(base);
    if (nl > level) { levelUps += nl - level; t += LEVELUP * (nl - level); }
    // The final item counts to its xp tick (3 ticks after the click), not to the end of its delay.
    if (base >= target) t -= ITEM - 3;
    let band = bands[bands.length - 1];
    if (!band || band.item !== r) { band = { from: level, to: level, item: r, items: 0, ticks: 0, xp: 0 }; bands.push(band); }
    band.items++; band.ticks += t; band.xp += r.xp; band.to = Math.min(nl, 99);
    level = nl;
    bars[r.bar] = (bars[r.bar] ?? 0) + r.bars;
    ticks += t;
}

console.log(`Smithing ${FROM} -> 99, ${ITEM} ticks per item, ${OVERHEAD} per inventory turnaround, ${SWITCH} per item switch, ${LEVELUP} per level-up`);
console.log('| Levels | Item (unlock) | Bars | Base xp per item | Items | Ticks | Base xp per tick |');
console.log('|---|---|---|---|---|---|---|');
for (const b of bands) {
    console.log(`| ${b.from}-${b.to} | ${b.item.name} (${b.item.level}) | ${b.item.bars} | ${b.item.xp} | ${b.items} | ${b.ticks} | ${(b.xp / b.ticks).toFixed(1)} |`);
}
console.log(`total: ${ticks} ticks, ${invs} inventories, ${switches} in-inventory switches, ${levelUps} level-ups, ${(target - baseFor(FROM)).toFixed(1)} base xp`);
console.log(`bars: ${Object.entries(bars).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (argv.includes('--table')) {
    console.log('\nbest item per level:');
    let prev = '';
    for (let l = 1; l <= 99; l++) {
        const r = best(l);
        if (r.name !== prev) console.log(`  ${l}: ${r.name} (${r.bars} bars, ${r.xp} base, ${rate(r).toFixed(2)} base/tick)`);
        prev = r.name;
    }
}
