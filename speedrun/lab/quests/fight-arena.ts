// Lab acceptance for the Fight Arena module (speedrun/quests/fight-arena.ts, S12):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/fight-arena.ts:--from=A:--until=K:--runs=3:--dialogue=both:--launch'
//
// The levels are SCORED's on arrival at S12 (RUN-ORDER.md and pre_mm_fights.md's timeline:
// Attack 94 after Tree Gnome Village and the Grand Tree, Strength and Defence 1, Hitpoints 36,
// Magic ~73, Prayer ~94, Thieving 1, Agility 75 from the Grand Tree).
//
// The pack is the inventory ledger's (STEP-MANIFEST.md "Inventory ledger"), walked by
// speedrun/tools/slot-ledger.ts to the H9 row, so a change to an earlier row flows through; each
// later fixture adds what the quest has handed over by then (the uniform worn, the brew, the keys)
// and takes the 5 coins once the barman has them.
//
// G and I start inside a cutscene (the ogre and Bouncer are spawned by the content on the way in),
// so they have no fixture: run them from F and H. Ticks are from the arrival tile beside Lady
// Servil (2566,3199): T11-12's 71 are not in them. Besides the runner's table, a run fails its check
// when SCORED lost any HP from the fixture to the end (the acceptance's 0 damage).

import { readFileSync } from 'fs';
import type { TickRow } from '../../lib/ticks';
import { ARRIVAL, quest, stepId, steps, TILES, type Options } from '../../quests/fight-arena';
import { MANIFEST, parseLedger, walk } from '../../tools/slot-ledger';
import { waitUntil } from '../../lib/wait';
import { cheat, give } from '../setup';
import { labMain, type LabQuest, type QuestFixture } from './run';

/** `--name=N` from the lab's command line, or undefined. */
function numArg(name: string): number | undefined {
    const a = process.argv.find(x => x.startsWith(`--${name}=`));
    return a === undefined ? undefined : Number(a.slice(name.length + 3));
}

/**
 * The prayer state the route's budget says SCORED arrives with (rs/687): `--prayerPoints=N` drains the
 * pool to N after the fixture's setstat (the engine's `~stat_drain` debugproc), `--prayerPotions=N`
 * gives N Prayer potion(4) (H8's). Attempt 3's rehearsal reached S12 with 4 points and none.
 */
async function prayerArrival(sdk: Parameters<typeof cheat>[0]): Promise<void> {
    const potions = numArg('prayerPotions');
    const points = numArg('prayerPoints');
    if (potions) await give(sdk, '4doseprayerrestore', potions);
    if (points === undefined) return;
    const cur = sdk.getState()?.prayers?.prayerPoints ?? 0;
    if (cur > points) await cheat(sdk, `~stat_drain prayer ${cur - points} 0`);
    const r = await waitUntil(sdk, s => (s.prayers?.prayerPoints ?? 0) <= points, { maxTicks: 10 });
    if (!r.ok) throw new Error(`fixture: prayer points still ${sdk.getState()?.prayers?.prayerPoints}, wanted ${points}`);
}

/** SCORED at S12. */
export const LEVELS = { attack: 94, strength: 1, defence: 1, hitpoints: 36, magic: 73, prayer: 94, thieving: 1, agility: 75 } as const;

/** Ledger names (lower case, the game's) to obj debug names, for the items SCORED holds at S12. */
const OBJ: Readonly<Record<string, string>> = {
    knife: 'knife', 'water rune': 'waterrune', 'antipoison(3)': '3doseantipoison', shark: 'shark', 'death rune': 'deathrune', 'chaos rune': 'chaosrune',
    'air rune': 'airrune', 'fire rune': 'firerune', coins: 'coins', 'law rune': 'lawrune', 'staff of fire': 'staff_of_fire', 'amulet of magic': 'amulet_of_magic',
    'khazard helmet': 'khazard_helmet', 'khazard armour': 'khazard_platemail', 'khazard cell keys': 'khazard_cellkeys',
};

/** `held` / `worn` as slot-ledger.ts renders them ("knife x1, air rune x353") as obj debug name -> count. */
export function ledgerItems(rendered: string): Record<string, number> {
    if (rendered.trim() === '-') return {};
    const out: Record<string, number> = {};
    for (const part of rendered.split(', ')) {
        const m = /^(.+) x(\d+|\?)( \(noted\))?$/.exec(part.trim());
        if (!m) throw new Error(`ledger: cannot read "${part}"`);
        if (m[2] === '?') throw new Error(`ledger: ${m[1]} is held at an unknown count`);
        if (m[3]) throw new Error(`ledger: ${m[1]} is noted; the fixture gives unnoted items`);
        const obj = OBJ[m[1]!];
        if (!obj) throw new Error(`ledger: no obj name for "${m[1]}" (add it to OBJ)`);
        out[obj] = (out[obj] ?? 0) + Number(m[2]);
    }
    return out;
}

/** SCORED's pack and worn set once `row` is done, from the ledger. */
export function ledgerAfter(row: string, markdown = readFileSync(MANIFEST, 'utf8')): { inv: Record<string, number>; worn: Record<string, number> } {
    const { rows, errors } = parseLedger(markdown);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const e = walk(rows).find(x => x.row.row === row);
    if (!e) throw new Error(`no ledger row ${row}`);
    return { inv: ledgerItems(e.held), worn: ledgerItems(e.worn) };
}

const START = ledgerAfter('H9');
const UNIFORM = ['khazard_helmet', 'khazard_platemail'] as const;

/** The fixture's items: quest items first (a full inventory drops a give silently), then the ledger pack, then the worn set. */
function pack(o: { quest?: Record<string, number>; uniform?: boolean; brewBought?: boolean }): { items: Record<string, number>; worn: string[] } {
    const inv = { ...START.inv };
    if (o.brewBought) delete inv.coins; // H9's 5 coins, all spent on the brew
    const wornSet = [...Object.keys(START.worn), ...(o.uniform ? UNIFORM : [])];
    const items: Record<string, number> = { ...(o.quest ?? {}), ...inv };
    for (const w of wornSet) items[w] = (items[w] ?? 0) + 1;
    return { items, worn: wornSet };
}

const fx = (letter: string, arenaquest: number, tile: QuestFixture['tile'], o: Parameters<typeof pack>[0] = {}, note?: string): QuestFixture => ({
    letter,
    levels: LEVELS,
    vars: { arenaquest },
    ...pack(o),
    tile,
    ...(note ? { note } : {}),
});

const xz = (t: { x: number; z: number }) => ({ x: t.x, z: t.z });

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, xz(ARRIVAL), {}, 'the arrival tile (legs.ts T11-12: Lady Servil 2566,3199 tol 1), the ledger\'s pack after H9'),
    fx('B', 1, xz(ARRIVAL)),
    fx('C', 2, xz(TILES.chestStand), { uniform: true }),
    fx('D', 3, xz(TILES.drunkGuard), { uniform: true }),
    fx('E', 3, xz(TILES.barman), { uniform: true, brewBought: true, quest: { khali_brew: 1 } }),
    fx('F', 5, xz(TILES.drunkGuard), { uniform: true, brewBought: true, quest: { khazard_cellkeys: 1 } }),
    fx('H', 9, { x: 2600, z: 3142 }, { uniform: true, brewBought: true, quest: { khazard_cellkeys: 1 } }, 'the cell after the ogre'),
    fx('J', 12, { x: 2598, z: 3158 }, { uniform: true, brewBought: true, quest: { khazard_cellkeys: 1 } }, 'in the arena after Bouncer (no General attacking)'),
    fx('K', 12, { x: 2607, z: 3151 }, { uniform: true, brewBought: true, quest: { khazard_cellkeys: 1 } }, 'outside the arena door'),
];

/**
 * Reference ticks per segment: fight_arena.md's stock step list (70/70/70 melee, the old client),
 * with the fight chain (Jeremy's keys to stage 12) scaled to rs/56's 281 at the route levels by
 * Fire Blast. A guide for the table's delta column, not the acceptance: that is the manifest's
 * 524 burst / 571 fixed for the whole step.
 */
export const REFERENCE: Readonly<Record<string, number>> = { A: 25, B: 42, C: 58, D: 54, E: 73, F: 37, G: 77, H: 78, I: 106, J: 8, K: 64 };

// HP lost from the end of the fixture to the end of the run: the acceptance wants 0.
let taken = 0;
let minHp = Infinity;
let stopHp: (() => void) | null = null;

const lab: LabQuest<Options> = {
    title: `Fight Arena (S12, SCORED's arrival levels: ${Object.entries(LEVELS).map(([k, v]) => `${k} ${v}`).join(', ')}; from the arrival tile 2566,3199)`,
    stepId,
    steps: o => steps(o),
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session) {
        const sdk = session.sdk;
        // A prayer left on by an earlier run would drain through the walks.
        await session.bot.deactivateAllPrayers().catch(() => {});
        await prayerArrival(sdk);
        stopHp?.();
        taken = 0;
        let last = sdk.getState()?.player?.hp ?? 0;
        minHp = last;
        stopHp = sdk.onStateUpdate(s => {
            const hp = s.player?.hp;
            if (hp === undefined) return;
            if (hp < last) taken += last - hp;
            last = hp;
            minHp = Math.min(minHp, hp);
        });
        const s = sdk.getState()!;
        console.log(`fixture: ${28 - s.inventory.length} free slots; worn ${s.equipment.map(i => i.name).join(', ')}; prayer ${s.prayers?.prayerPoints}`);
    },
    check(_session, _fixture, rows: readonly TickRow[]) {
        stopHp?.();
        stopHp = null;
        const fights = rows.filter(r => r.kind === 'note' && r.step === `${stepId}:fight`).map(r => r.meta as { what: string; casts: number; taken: number });
        console.log(`damage: ${taken} taken, lowest HP ${minHp}; fights ${fights.map(f => `${f.what} ${f.casts} casts ${f.taken} taken`).join('; ')}`);
        return taken > 0 ? `SCORED took ${taken} damage (lowest HP ${minHp}); the acceptance wants 0` : undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    console.log(`${quest} done`);
    process.exit(0);
}
