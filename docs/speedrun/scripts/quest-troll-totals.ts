// Tick totals for Death Plateau, Troll Stronghold and Troll Romance, from raw
// counts. No server needed:
//
//   bun docs/speedrun/scripts/quest-troll-totals.ts [--md]
//
// Every step carries its raw counts so the totals can be recomputed when a
// primitive changes (docs/speedrun/quests/primitives.md, CONVENTIONS.md):
//   talk     dialogue runs, e.g. '2c,o,6c,o,13c' (c = pure continue pages,
//            o = option or interface click, s = state-changing page, w = typed
//            input). Pages are counted from the scripts (read).
//   walk     measured ticks (quest-troll-walk.ts) or a route [from, to] whose
//            steps the SDK pathfinder counts (ceil(steps / 2) + 1, primitives §2)
//   act      interaction ticks (doors, stairs, climbs, item use; measured or inferred)
//   wait     forced p_delay waits outside dialogue pages (read: p_delay(n) = n + 1)
//   fight    measured fight ticks (quest-troll-fights.ts)
// Dialogue columns (CONVENTIONS.md, "Dialogue: three columns"):
//   stock = 2 per page/option + 2 to open; fixed = 1 per page/option + 1;
//   burst = 1 to open + ceil(k / 5) per run of k pure continues + 1 per o/s/w.
import { findLongPath, initPathfinding } from '../../../sdk/pathfinding';

type XY = [number, number, number?];
interface Step {
    q: 'DP' | 'TS' | 'TR';
    what: string;
    talk?: string | string[];
    walk?: number | [XY, XY] | Array<number | [XY, XY]>;
    act?: number;
    wait?: number;
    fight?: number;
    label: string;
}

const DENULTH: XY = [2896, 3529], DUNSTAN: XY = [2919, 3573], COURTYARD: XY = [2899, 3564];
const TENZING_DOOR: XY = [2823, 3555], DP_ROCKS: XY = [2880, 3593], CASTLE_STAIRS: XY = [2898, 3565];
const INN_STAIRS: XY = [2914, 3538], STONES: XY = [2893, 3563], SABA_CAVE: XY = [2857, 3577];
// Games necklace to Burthorpe: 8 (primitives §4) + games-room stairs 4 (measured) + 6 walk + 2 stairs (inferred)
const NECKLACE = 20;

const STEPS: Step[] = [
    // ---------------- Death Plateau ----------------
    { q: 'DP', what: 'Games necklace to Burthorpe, run to Denulth', act: NECKLACE, walk: [COURTYARD, DENULTH], label: 'necklace inferred; route pathfinder' },
    { q: 'DP', what: 'Denulth: "Do you have any quests for me?", "No but perhaps I could try and find one?" (0 -> 10)', talk: '2c,o,6c,o,13c', label: 'read' },
    { q: 'DP', what: 'Run to the castle stairs, climb to level 1, Eohric', walk: [DENULTH, CASTLE_STAIRS], act: 2 + 3, label: 'route pathfinder; stairs primitives §3' },
    { q: 'DP', what: 'Eohric: "I\'m looking for the guard that was on last night." (10 -> 20)', talk: '2c,o,5c', label: 'read' },
    { q: 'DP', what: 'Down, run to the inn stairs, up, knock on Harold\'s door', walk: [CASTLE_STAIRS, INN_STAIRS], act: 2 + 2 + 6 + 2 + 3, talk: '2c', label: 'route pathfinder; knock read (quest_death.rs2:19-25)' },
    { q: 'DP', what: 'Harold: "You\'re the guard that was on duty last night?" (20 -> 30)', talk: '2c,o,4c', label: 'read' },
    { q: 'DP', what: 'Back to Eohric (door, inn stairs, castle stairs)', walk: [INN_STAIRS, CASTLE_STAIRS], act: 5 + 2 + 2 + 3, label: 'route pathfinder' },
    { q: 'DP', what: 'Eohric: "I found Harold but he won\'t talk to me!" (30 -> 40)', talk: '5c', label: 'read' },
    { q: 'DP', what: 'Back to Harold, knock', walk: [CASTLE_STAIRS, INN_STAIRS], act: 5 + 2 + 2 + 6 + 2 + 3, talk: '2c', label: 'route pathfinder' },
    { q: 'DP', what: 'Harold: Asgarnian ale (40 -> 50), then "Can I buy you a drink?" with a Blurberry Special (very drunk)', talk: '4c,s,1c,o,4c,s,1c', wait: 4 + 10, label: 'read (death_guard_equiproom.rs2:275-335)' },
    { q: 'DP', what: 'Harold: "Would you like to gamble?", bet 101+, roll; drunk Harold loses all and writes the IOU (50 -> 55)', talk: '2c,o,4c,w,1c,o,o,4c,s', wait: 2 + 9 + 6, label: 'read (death_guard_equiproom.rs2:46-249)' },
    { q: 'DP', what: 'Read the IOU (55 -> 60)', talk: '3c,s', label: 'read (quest_death.rs2:27-35)' },
    { q: 'DP', what: 'Out, down, run to the stone balls', walk: [INN_STAIRS, STONES], act: 3 + 2, label: 'route pathfinder' },
    { q: 'DP', what: 'Pick up 5 stone balls, place them (blue 2894,3562; yellow 2895,3562; red 2894,3563; purple 2895,3563; green 2895,3564) (60 -> 70)', act: 20, label: 'inferred, 10 interactions at 2' },
    { q: 'DP', what: 'Run to Saba\'s cave, enter, to Saba', walk: [STONES, SABA_CAVE], act: 2 + 4, label: 'route pathfinder' },
    { q: 'DP', what: 'Saba: "Do you know of another way up Death Plateau?" (map 0 -> 1)', talk: '2c,o,13c', label: 'read' },
    { q: 'DP', what: 'Leave the cave, run to Tenzing\'s door, knock', walk: [SABA_CAVE, TENZING_DOOR], act: 5 + 2 + 2, talk: '4c', label: 'route pathfinder; knock read (quest_death.rs2:46-61)' },
    { q: 'DP', what: 'Tenzing: "OK, I\'ll get those for you." (map 1 -> 2, climbing boots)', talk: '12c,o,3c', label: 'read' },
    { q: 'DP', what: 'Front door, run to Dunstan', walk: 76, act: 2, label: 'measured walk (quest-troll-walk.ts, 2823,3555 -> Dunstan)' },
    { q: 'DP', what: 'Dunstan: boots and the condition (map 2 -> 3)', talk: '12c', label: 'read' },
    { q: 'DP', what: 'Run to Denulth', walk: [DUNSTAN, DENULTH], label: 'route pathfinder' },
    { q: 'DP', what: 'Denulth: certificate (map 3 -> 4)', talk: '13c', label: 'read' },
    { q: 'DP', what: 'Run to Dunstan', walk: [DENULTH, DUNSTAN], label: 'route pathfinder' },
    { q: 'DP', what: 'Dunstan: certificate (map 4 -> 5), spikes with the iron bar', talk: '9c', label: 'read' },
    { q: 'DP', what: 'Run to Tenzing (door opens without knocking from map 2)', walk: [DUNSTAN, TENZING_DOOR], act: 2 + 2, label: 'route pathfinder' },
    { q: 'DP', what: 'Tenzing: spiked boots, 10 bread, 10 trout (map 5 -> 6 -> 7, secret way map)', talk: '11c', label: 'read' },
    { q: 'DP', what: 'Back door, stile, run to the lookout zone (2864,3608) (map 7 -> 8)', walk: [[2817, 3564], [2864, 3608]], act: 2 + 2 + 4, talk: '1c', label: 'route pathfinder; stile measured 3-6' },
    { q: 'DP', what: 'Games necklace to Burthorpe, run to Denulth', act: NECKLACE, walk: [COURTYARD, DENULTH], label: 'inferred' },
    { q: 'DP', what: 'Denulth: map and combination, quest complete; close the scroll', talk: '11c', act: 2, label: 'read' },
    // ---------------- Troll Stronghold ----------------
    { q: 'TS', what: 'Trade: climbing boots, food, Troll Romance materials, games necklace', act: 9, label: 'measured, primitives §6' },
    { q: 'TS', what: 'Denulth: "How goes your fight with the trolls?", "Is there anything...", "I\'ll get Godric back!" (0 -> 10); wear climbing boots', talk: '2c,o,4c,o,2c,o,2c', act: 2, label: 'read' },
    { q: 'TS', what: 'Run to the Death Plateau rocks, climb, run to the rockslide (2856,3612)', walk: 90, label: 'measured (quest-troll-walk.ts plateau_dp_rocks)' },
    { q: 'TS', what: 'Rockslide, climbing rocks 2860,3626 and 2879,3622, to the arena\'s west door (Agility 15 each)', walk: 2 + 15 + 3 + 12 + 5 + 18, act: 3, talk: '1c', label: 'measured (ts_out); door and Dad\'s line inferred' },
    { q: 'TS', what: 'Fight Dad to surrender, "I\'ll be going now." (10 -> 20)', fight: 123, label: 'measured, 70/70/70 rune scimitar, n=5 (111-138)' },
    { q: 'TS', what: 'North door, run to the troll pass', walk: 10 + 12, act: 3, label: 'measured walks; door inferred' },
    { q: 'TS', what: 'Pass tunnel, round the Trollheim rockslide on x=2913, stronghold door', walk: 110, label: 'measured (ts_pass)' },
    { q: 'TS', what: 'Kill a Troll General, pick up the prison key', fight: 112, label: 'measured, 70 melee + Protect from Melee, n=3 (103-127)' },
    { q: 'TS', what: 'North stairs to level 1, prison door (20 -> 30), stairs to level 0, run to Twig', walk: 10 + 4 + 5 + 3 + 4 + 19, act: 3, label: 'measured (ts_in); prison door inferred' },
    { q: 'TS', what: 'Pickpocket Twig for cell key 1 (Thieving 30, stat_random 60/300)', act: 3, label: 'inferred; 89% at Thieving 70, see Risks' },
    { q: 'TS', what: 'Unlock Godric\'s cell (30 -> 40)', act: 2, talk: '1c', label: 'read (quest_troll.rs2:241-309)' },
    { q: 'TS', what: 'Games necklace to Burthorpe, run to Dunstan', act: NECKLACE, walk: [COURTYARD, DUNSTAN], label: 'inferred' },
    { q: 'TS', what: 'Dunstan: Godric is home, quest complete (40 -> 50); close the scroll', talk: '4c', act: 2, label: 'read' },
    // ---------------- Troll Romance ----------------
    { q: 'TR', what: 'Dunstan to the Death Plateau rocks, up, rockslides to the secret door, in, to Ug', walk: [[[2919, 3573], DP_ROCKS], 18 + 20 + 15 + 18], act: 5 + 2 + 2 + 1, label: 'measured legs (walk.ts); Dunstan -> rocks pathfinder' },
    { q: 'TR', what: 'Ug: "Awww, you poor troll...", "Don\'t worry now, I\'ll see what I can do." (0 -> 5)', talk: '2c,o,3c,o,4c', label: 'read' },
    { q: 'TR', what: 'Run to Aga', walk: 21, label: 'measured (stile_to_ug)' },
    { q: 'TR', what: 'Aga: "So... how\'s your... um... love life?", "Errr... I\'ve got to go." (5 -> 10)', talk: '1c,o,9c,o,1c', label: 'read' },
    { q: 'TR', what: 'Games necklace to Burthorpe, run to Tenzing (door opens)', act: NECKLACE + 2, walk: [COURTYARD, TENZING_DOOR], label: 'inferred' },
    { q: 'TR', what: 'Tenzing: "Do you know where I can find Trollweiss?", "What would I need to make such a sled?" (10 -> 15)', talk: '2c,o,13c,o,5c', label: 'read' },
    { q: 'TR', what: 'Front door, run to Dunstan', walk: 76, act: 2, label: 'measured walk' },
    { q: 'TR', what: 'Dunstan: "I need a sled!!", "Yes." (15 -> 20)', talk: '2c,o,1c,o,8c', label: 'read' },
    { q: 'TR', what: 'Dunstan again with yew logs, iron bar, rope: sled (20 -> 22); walk off at the menu', talk: '4c,s,2c', label: 'read' },
    { q: 'TR', what: 'Swamp tar on bucket of wax (cake tin held), wax on sled (22 -> 25)', act: 4, label: 'inferred, 2 item uses' },
    { q: 'TR', what: 'To the Death Plateau rocks, secret door, through the stronghold to the level 2 top door', walk: [[[2919, 3573], DP_ROCKS], 18 + 20 + 15 + 37 + 3 + 5 + 10], act: 5 + 2 + 2 + 1 + 4 + 3 + 4 + 2, label: 'measured legs (walk.ts ts_in reversed); stronghold doors inferred' },
    { q: 'TR', what: 'Trollheim to the ice cave, crevasse, sled start; wield sled, ride 1 (Agility 28)', walk: 88 + 48 + 18 + 6, act: 1 + 2 + 2 + 21, label: 'measured (trollweiss leg)' },
    { q: 'TR', what: 'Pick the Trollweiss (25 -> 30)', act: 3, label: 'inferred, p_delay(0)' },
    { q: 'TR', what: 'Games necklace to Burthorpe, to the rocks, secret door, Ug', act: NECKLACE + 5 + 2 + 2 + 1, walk: [[COURTYARD, DP_ROCKS], 18 + 20 + 15 + 18], label: 'measured legs; necklace inferred' },
    { q: 'TR', what: 'Ug: flower (30 -> 35)', talk: '10c', label: 'read' },
    { q: 'TR', what: 'Run to Arrg; "I am here to kill you!"; fight in the arena (35 -> 40)', walk: 16, fight: 144, label: 'measured, 70 melee + Protect from Melee, n=3 (125-161), includes the talk' },
    { q: 'TR', what: 'Arena west door, climbing rocks, rockslide, secret door, Ug', walk: 105, label: 'measured (arena_to_ug)' },
    { q: 'TR', what: 'Ug: "Yes, he has been defeated." quest complete (40 -> 45); close the scroll', talk: '7c', act: 2, label: 'read' },
];

function parse(r: string) {
    let pages = 0, opts = 0, burst = 1;
    for (const tok of r.split(',').map(t => t.trim()).filter(Boolean)) {
        const m = tok.match(/^(\d*)c$/);
        if (m) { const k = parseInt(m[1] || '1'); pages += k; burst += Math.ceil(k / 5); }
        else if (tok === 's') { pages++; burst++; }
        else { opts++; burst++; }
    }
    return { pages, opts, stock: 2 * (pages + opts) + 2, fixed: pages + opts + 1, burst };
}

initPathfinding();
function routeTicks(a: XY, b: XY): { ticks: number; tiles: number } {
    const p = findLongPath(a[2] ?? 0, a[0], a[1], b[0], b[1], 3000);
    let s = 0, px = a[0], pz = a[1];
    for (const q of p) { s += Math.max(Math.abs(q.x - px), Math.abs(q.z - pz)); px = q.x; pz = q.z; }
    return { ticks: Math.ceil(s / 2) + 1, tiles: s };
}
function walkTicks(w: Step['walk']): { ticks: number; tiles: string } {
    if (w === undefined) return { ticks: 0, tiles: '' };
    if (typeof w === 'number') return { ticks: w, tiles: 'measured' };
    const parts: Array<number | [XY, XY]> = typeof w[0] === 'number' || (Array.isArray(w[0]) && typeof w[0][0] === 'number') ? [w as [XY, XY]] : (w as Array<number | [XY, XY]>);
    let ticks = 0, tiles = 0, measured = 0;
    for (const part of parts) {
        if (typeof part === 'number') { ticks += part; measured += part; }
        else { const r = routeTicks(part[0], part[1]); ticks += r.ticks; tiles += r.tiles; }
    }
    return { ticks, tiles: tiles ? `${tiles} route tiles${measured ? ` + ${measured} measured` : ''}` : 'measured' };
}

const md = process.argv.includes('--md');
const sums: Record<string, Record<string, number>> = {};
for (const q of ['DP', 'TS', 'TR']) {
    const rows: string[] = ['| # | Step | Dialogue runs | Pages + options | Walk | Interactions + waits | Fight | Stock | Fixed | Burst | Label |', '|---|---|---|---|---|---|---|---|---|---|---|'];
    const s = { walk: 0, act: 0, fight: 0, dStock: 0, dFixed: 0, dBurst: 0, pages: 0, opts: 0 };
    STEPS.filter(x => x.q === q).forEach((st, i) => {
        const talks = st.talk === undefined ? [] : Array.isArray(st.talk) ? st.talk : [st.talk];
        const d = talks.map(parse).reduce((a, b) => ({ pages: a.pages + b.pages, opts: a.opts + b.opts, stock: a.stock + b.stock, fixed: a.fixed + b.fixed, burst: a.burst + b.burst }), { pages: 0, opts: 0, stock: 0, fixed: 0, burst: 0 });
        const w = walkTicks(st.walk);
        const other = (st.act ?? 0) + (st.wait ?? 0);
        const f = st.fight ?? 0;
        s.walk += w.ticks; s.act += other; s.fight += f; s.dStock += d.stock; s.dFixed += d.fixed; s.dBurst += d.burst; s.pages += d.pages; s.opts += d.opts;
        const base = w.ticks + other + f;
        rows.push(`| ${i + 1} | ${st.what} | ${talks.join(' / ') || ''} | ${talks.length ? `${d.pages} + ${d.opts}` : ''} | ${w.ticks || ''}${w.tiles && w.tiles !== 'measured' ? ` (${w.tiles})` : ''} | ${other || ''} | ${f || ''} | ${base + d.stock} | ${base + d.fixed} | ${base + d.burst} | ${st.label} |`);
    });
    sums[q] = s;
    if (md) console.log(`\n### ${q}\n\n${rows.join('\n')}`);
}
console.log('\n| Quest | Walk | Interactions + waits | Fights | Pages + options | Dialogue stock / fixed / burst | Total stock | Total fixed | Total burst |');
console.log('|---|---|---|---|---|---|---|---|---|');
const tot = { walk: 0, act: 0, fight: 0, dStock: 0, dFixed: 0, dBurst: 0, pages: 0, opts: 0 };
for (const [q, s] of Object.entries(sums)) {
    for (const k of Object.keys(tot) as Array<keyof typeof tot>) tot[k] += s[k];
    const b = s.walk + s.act + s.fight;
    console.log(`| ${q} | ${s.walk} | ${s.act} | ${s.fight} | ${s.pages} + ${s.opts} | ${s.dStock} / ${s.dFixed} / ${s.dBurst} | ${b + s.dStock} | ${b + s.dFixed} | ${b + s.dBurst} |`);
}
const b = tot.walk + tot.act + tot.fight;
console.log(`| chain | ${tot.walk} | ${tot.act} | ${tot.fight} | ${tot.pages} + ${tot.opts} | ${tot.dStock} / ${tot.dFixed} / ${tot.dBurst} | ${b + tot.dStock} | ${b + tot.dFixed} | ${b + tot.dBurst} |`);
