// Lab acceptance for the Dwarf Cannon module (speedrun/quests/dwarf-cannon.ts, S13):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/dwarf-cannon.ts:--from=A:--until=L:--runs=3:--dialogue=both:--launch'
//
// --levels=real (default) sets SCORED's levels on arrival at S13: Crafting 1 (the reward takes it
// to 42), Smithing 1 (S25a is later), ~42 HP, Magic ~76 (RUN-ORDER.md S12/S13 rows, R5/O14).
// --walk runs the demo throwaway's path instead: teleports: false (K and L walk over White Wolf
// Mountain), at 30 HP and Magic 1 with no Plague City and no runes.
// --levels=route sets the 60/60 of quest-mcannon-run.ts, the levels the manifest's 976 / 920 were
// measured at: a route check against those figures, not the acceptance.
//
// Every fixture starts a segment where the one before it ends, from the quest varps (%mcannon,
// %mcannonmulti: railing bits 5-10, cannon part bits 0-3) and Plague City read (%elenaquest 30,
// the Ardougne teleport's gate). Ticks are from the arrival tile beside Lawgof (2571,3463): the
// T12-13 leg's 121 are not in them. Besides the runner's table this prints a tally per run: the
// railing tries and failures, the shed's rolls, food eaten and its ticks, damage and lowest HP.
// Each fixture fills the pack so that exactly the free slots the module needs from that segment on
// are free (6 at A, 3 from B to H, 2 from I to K, none at L): the tightest pack its precondition admits.
//
// --at=x,z: start the --from fixture on that tile instead. K from inside Nulodion's workshop
// (--at=3012,3453) is K re-run after its door crossing (runResumable walking back into K after a
// drop): the old K clicked the door from there, which carries SCORED out and shuts Nulodion in.
// --watch-nulodion=N: before the run, cross Nulodion's door N times from the corridor and back, then
// stand outside 100 ticks, recording every tile Nulodion is seen on: whether he ever leaves the
// workshop (quests/dwarf-cannon.ts inWorkshop). Each run records SCORED's and Nulodion's tiles at its start.

import { arg, result } from '../common';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { opLoc } from '../../lib/act';
import type { Session } from '../../lib/session';
import { waitTicks } from '../../lib/wait';
import { findNpc } from '../../lib/world';
import { inWorkshop, LETTERS, newTally, NULODION_AT, QUEST_ITEMS, quest, stepId, steps, type Options, type Tally } from '../../quests/dwarf-cannon';
import { INVENTORY_SLOTS, slotNeed } from '../../quests/segments';
import { mustTele } from '../setup';
import { labMain, type LabQuest, type QuestFixture } from './run';

const LEVELS = arg('levels', 'real');
if (LEVELS !== 'real' && LEVELS !== 'route') throw new Error(`--levels=${LEVELS}: want real or route`);
/** --walk: the demo throwaway's path (teleports: false), at its levels: 30 Hitpoints, Magic 1, no Plague City. */
const WALK = process.argv.includes('--walk');

/** SCORED at S13 (real), quest-mcannon-run.ts's defaults (route), or the demo throwaway (--walk). */
const levels: Record<string, number> = WALK
    ? { attack: 1, magic: 1, prayer: 1, thieving: 1, agility: 1, strength: 42, hitpoints: 30, crafting: 1, smithing: 1 }
    : LEVELS === 'real'
        ? { attack: 99, magic: 76, prayer: 94, thieving: 57, agility: 75, hitpoints: 42, crafting: 1, smithing: 1 }
        : { attack: 99, magic: 76, prayer: 94, thieving: 57, agility: 75, hitpoints: 70, crafting: 60, smithing: 60 };

const RAILS = 2016; // bits 5-10
const PARTS = 15; // bits 0-3
const RUNES = { waterrune: 3, airrune: 3, lawrune: 3 } as const;
const FOOD = { shark: 8 } as const;
const LAWGOF = { x: 2571, z: 3462 };

/** The quest items a fixture gives, by debug name, as the inventory shows them (all unstackable). */
const QUEST_OBJ: Readonly<Record<string, string>> = {
    mcannonrailing1_obj: 'Railing', mcannonremains: 'Dwarf remains', mcannontoolkit: 'Tool kit', nulodions_notes: "Nulodion's notes", ammo_mould: 'Ammo mould',
};
/** An inert unstackable item that fills the pack. */
const FILLER = 'bucket_empty';

/**
 * The tightest pack the segment's free-slot precondition admits: the fixture's items, then filler
 * until exactly the module's own need (slotNeed over QUEST_ITEMS from this segment on) is free.
 * rs/185 addendum 8 wants SCORED's actual inventory at S13; until rs/158's per-step table lands,
 * the tightest pack bounds it from below.
 */
export function filler(letter: string, items: Record<string, number>): number {
    const inventory = Object.entries(items).flatMap(([k, n]) => (QUEST_OBJ[k] ? Array.from({ length: n }, () => ({ name: QUEST_OBJ[k], id: 0, count: 1 }) as unknown as InventoryItem) : []));
    const need = slotNeed({ inventory } as unknown as BotWorldState, QUEST_ITEMS, LETTERS, letter).slots;
    const used = Object.entries(items).reduce((a, [k, n]) => a + (k in RUNES ? 1 : n), 0);
    return INVENTORY_SLOTS - used - need;
}

const fx = (letter: string, mcannon: number, multi: number, tile: QuestFixture['tile'], questItems: Record<string, number> = {}, note?: string): QuestFixture => {
    const items: Record<string, number> = { ...questItems, ...(WALK ? {} : RUNES), ...FOOD };
    const n = filler(letter, items);
    return {
        letter,
        levels,
        // option_nodef 1: auto-retaliate off (player_controls.constant), as the run plays (main's run-wide rule).
        vars: { mcannon, mcannonmulti: multi, elenaquest: WALK ? 0 : 30, option_nodef: 1 },
        items: n > 0 ? { ...items, [FILLER]: n } : items,
        tile,
        ...(note ? { note } : {}),
    };
};

const AT = arg('at', '') ? (([x, z]) => ({ x: x!, z: z! }))(arg('at', '').split(',').map(Number)) : null;
const FROM = arg('from', '').toUpperCase();
const WATCH = Number(arg('watch-nulodion', '0'));

const BASE_FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, 0, LAWGOF, {}, 'the arrival tile (legs.ts T12-13: Lawgof 2571,3463 tol 1)'),
    fx('B', 1, 0, LAWGOF, { mcannonrailing1_obj: 6 }),
    fx('C', 1, RAILS, { x: 2571, z: 3461 }),
    fx('D', 2, RAILS, LAWGOF),
    fx('E', 2, RAILS, { x: 2570, z: 3442 }, { mcannonremains: 1 }),
    fx('F', 3, RAILS, LAWGOF),
    fx('G', 4, RAILS, { x: 2620, z: 9797 }),
    fx('H', 5, RAILS, { x: 2571, z: 9849 }),
    fx('I', 6, RAILS, LAWGOF, { mcannontoolkit: 1 }),
    fx('J', 8, RAILS | PARTS, { x: 2574, z: 3462 }, { mcannontoolkit: 1 }),
    fx('K', 9, RAILS | PARTS, LAWGOF, { mcannontoolkit: 1 }),
    fx('L', 10, RAILS | PARTS, { x: 3012, z: 3453 }, { mcannontoolkit: 1, nulodions_notes: 1, ammo_mould: 1 }),
];

export const FIXTURES: readonly QuestFixture[] = BASE_FIXTURES.map(f => (AT && f.letter === FROM ? { ...f, tile: AT, note: `${f.note ?? ''} (--at ${AT.x},${AT.z})`.trim() } : f));

const NULODION_RE = /^nulodion$/i;
const tileOf = (s: BotWorldState) => ({ x: s.player!.worldX, z: s.player!.worldZ });

/** --watch-nulodion: cross the door `n` times from its tile and back, then 100 ticks outside, recording Nulodion's tiles. */
async function watchNulodion(session: Session, n: number): Promise<void> {
    const sdk = session.sdk;
    const back = tileOf(sdk.getState()!);
    const seen = new Map<string, number>();
    const stop = sdk.onStateUpdate(s => {
        for (const npc of s.nearbyNpcs) if (NULODION_RE.test(npc.name)) seen.set(`${npc.x},${npc.z}`, (seen.get(`${npc.x},${npc.z}`) ?? 0) + 1);
    });
    let crossed = 0;
    try {
        await mustTele(sdk, 3015, 3453);
        for (let i = 0; i < n; i++) {
            const inside = !inWorkshop(tileOf(sdk.getState()!));
            const r = await opLoc(sdk as never, { x: 3015, z: 3453, name: /^door$/i, radius: 15 }, /^open$/i, s => inWorkshop(tileOf(s)) === inside, { maxTicks: 20 });
            if (r.ok) crossed++;
        }
        if (inWorkshop(tileOf(sdk.getState()!))) await opLoc(sdk as never, { x: 3015, z: 3453, name: /^door$/i, radius: 15 }, /^open$/i, s => !inWorkshop(tileOf(s)), { maxTicks: 20 });
        await waitTicks(sdk, 100);
    } finally {
        stop();
    }
    const tiles = [...seen.keys()].map(k => k.split(',').map(Number) as [number, number]);
    const outside = tiles.filter(([x, z]) => !inWorkshop({ x, z }));
    result(`${stepId}_nulodion_watch`, { crossings: n, crossed, tiles: tiles.length, maxX: Math.max(...tiles.map(t => t[0])), outside, seen: Object.fromEntries(seen) });
    await mustTele(sdk, back.x, back.z);
}

/**
 * Reference ticks per segment, fixed column, at 60/60 from the arrival tile: dwarf_cannon.md's
 * measured stock step list less each conversation's stock-to-fixed saving (its dialogue table), and
 * K and L with their 4-tick teleport. Sum 855 = the manifest's 976 less T12-13's 121.
 */
export const REFERENCE: Readonly<Record<string, number>> = { A: 13, B: 203, C: 11, D: 33, E: 26, F: 64, G: 48, H: 117, I: 76, J: 26, K: 104, L: 134 };

// One tally per run, filled by the module through Options.tally and taken at the next fixture.
const tally: Tally = newTally();
const runs: Array<{ mode: string; t: Tally }> = [];
let mode = 'fixed';
let started = false;
const take = () => {
    if (started) runs.push({ mode, t: { ...tally } });
    Object.assign(tally, newTally());
    started = true;
};

const lab: LabQuest<Options> = {
    title: `Dwarf Cannon (S13, ${WALK ? 'demo throwaway: walking K and L, 30 HP, Magic 1' : LEVELS === 'real' ? 'real levels: Crafting 1, Smithing 1, 42 HP' : 'route check: Crafting 60, Smithing 60, 70 HP'}; from the arrival tile 2571,3463)`,
    stepId,
    steps(o) {
        if (started) take();
        started = false;
        mode = o.dialogue ?? 'burst';
        return steps(o);
    },
    fixtures: FIXTURES,
    reference: REFERENCE,
    options: { tally, ...(WALK ? { teleports: false } : {}) },
    async prepare(session, f) {
        take();
        if (WATCH > 0 && f.letter === 'K') await watchNulodion(session, WATCH);
        if (f.letter === 'K' || f.letter === 'L') {
            const s = session.sdk.getState()!;
            const nu = findNpc(s, NULODION_RE, NULODION_AT);
            const door = s.nearbyLocs.find(l => l.x === 3015 && l.z === 3453 && /door/i.test(l.name));
            result(`${stepId}_start`, {
                letter: f.letter, at: tileOf(s), inWorkshop: inWorkshop(tileOf(s)),
                nulodion: nu ? { x: nu.x, z: nu.z, inWorkshop: inWorkshop(nu) } : null,
                door: door ? `${door.name} ${door.id} [${door.optionsWithIndex.map(o => o.text).join('/')}]` : null,
            });
        }
        // The level the railing and shed rolls read (stat_random takes the current level, not the base).
        const lv = (k: string) => session.sdk.getState()?.skills.find(x => x.name.toLowerCase() === k);
        const c = lv('crafting');
        const m = lv('smithing');
        console.log(`LEVELS crafting ${c?.level}/${c?.baseLevel} smithing ${m?.level}/${m?.baseLevel} hitpoints ${lv('hitpoints')?.level} autoRetaliate ${session.sdk.getState()?.autoRetaliateEnabled ? 'on' : 'off'}`);
    },
};

const fmtT = (t: Tally) => `| ${t.railingTries} | ${t.railingFails} | ${t.shedInspects} (${t.shedFindFails} not found) | ${t.shedFixTries} (${t.shedFixFails} failed) | ${t.damage} | ${t.eats} (${t.eatTicks} ticks) | ${Number.isFinite(t.minHp) ? t.minHp : '-'} |`;

if (import.meta.main) {
    await labMain(lab);
    take();
    console.log(`\n### ${quest} tally per run (${LEVELS} levels)\n\n| Mode | Run | Railing tries | Railing failures | Shed inspects | Shed fixes | Damage | Eats | Lowest HP |\n|---|---|---|---|---|---|---|---|---|`);
    const perMode = new Map<string, number>();
    for (const r of runs) {
        const i = (perMode.get(r.mode) ?? 0) + 1;
        perMode.set(r.mode, i);
        console.log(`| ${r.mode} | ${i} ${fmtT(r.t)}`);
    }
    result(`${stepId}_tally`, { levels: LEVELS, runs });
    process.exit(0);
}
