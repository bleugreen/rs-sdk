// Lab acceptance for the Plague City module (speedrun/quests/plague-city.ts, S08):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/plague-city.ts:--from=A:--until=Z:--runs=3:--dialogue=both:--launch'
//   LAB_RUNNERS=0 LAB_HELPERS=<carrier> speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/plague-city.ts:--from=A:--until=Z:--launch:--carrier=<carrier>'
//
// SCORED's levels on arrival at S08 (RUN-ORDER.md rows S02-S07): Magic 59 (S04), Mining 49 (S05,
// which this quest takes to 64), Firemaking 99, Runecraft 44, Woodcutting 99, Prayer 95 (S07's
// bury, S25b). Its pack (the slot ledger's walk after T07-08): a knife and one log, the staff of
// water worn; then H6 (the quest's items and T08-09's 2 law runes; no water runes, the cast takes
// its water from the staff) staged as the trade leaves it. Each fixture stages that pack less what
// the quest has used by then, plus what it has handed over, and %elenaquest. Ticks are from
// Edmond's arrival tile (2568,3334): T07-08's Camelot teleport and run are not in them, nor is H6's
// trade (9 m, primitives.md section 6), which segment A only checks here.
//
// --carrier=<bot> (from A only): SCORED arrives without H6, and the carrier, staged beside Edmond
// with H6, trades it over in segment A (`kitFrom`), as the run's H6 hand-off does.
//
// --at=x,z: start the --from fixture on that tile instead (B from the house's west door tile,
// 2570,3333, or from Alrena's room). Each run records the house doors' state at its start.
// --open-door: open the house's west door (2570,3333) before the run, from the fixture's tile.
// --edmond-inside: the live B failure's state (run-20261024-022859). Edmond wanders 5 tiles from his
// spawn (NpcType's default), into Alrena's room while the west door stands open, and is shut in
// when it closes. The lab cannot move an NPC, so it closes the door, spawns an Edmond in Alrena's
// room (::npcadd) and waits until that one is the Edmond nearest his spawn (the one a talk picks).
//
// After a run that reached Z, `check` confirms the quest complete, the magic scroll read (Z's note:
// the memorise and can-now-cast pages, the scroll gone), the 2,425 base Mining, and then casts the
// Ardougne teleport from Edmond's house as T08-09 will, with no water runes held and the staff of
// water worn: it must land and spend the 2 law.

import type { TickRow } from '../../lib/ticks';
import { questStatus } from '../../lib/quests';
import { teleport, type TravelSdk } from '../../lib/travel';
import { give as tradeGive, type GiveResult } from '../../lib/trade';
import { configId, findNpc, invCount, opIndex, skillXp, worn } from '../../lib/world';
import { closeSession, openSession, type Session } from '../../lib/session';
import { HOUSE_DOORS, quest, stepId, steps, type Options, type ScrollRead } from '../../quests/plague-city';
import { labMain, STAGING, type LabQuest, type QuestFixture } from './run';
import { arg, result } from '../common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, tele } from '../setup';
import { openDoor, opLoc } from '../../lib/act';
import { waitUntil } from '../../lib/wait';

export const LEVELS = { magic: 59, mining: 49, firemaking: 99, runecraft: 44, woodcutting: 99, prayer: 95 } as const;

/** SCORED's own pack at S08: the knife, S07's kept log and the staff of water (worn). */
const BASE = { knife: 1, logs: 1, staff_of_water: 1 } as const;
/** H6's runes (the ledger's row H6): T08-09's 2 law. No water: the cast takes it from the staff. */
const H6_RUNES = { lawrune: 2 } as const;
const H6 = { dwellberries: 1, bucket_water: 4, spade: 1, rope: 1, chocolate_dust: 1, bucket_milk: 1, snape_grass: 1 } as const;

type Items = Record<string, number>;
/** Quest items first: a full pack drops a ::give silently. */
const pack = (quest: Items, kit: Items): Items => ({ ...quest, ...kit, ...BASE, ...H6_RUNES });

/** The kit as it stands after each phase: the berries go at D, the cure is mixed at F, the water poured at G, the rope tied at I. */
const KIT = {
    full: { ...H6 },
    afterAlrena: { bucket_water: 4, spade: 1, rope: 1, chocolate_dust: 1, bucket_milk: 1, snape_grass: 1 },
    afterCure: { bucket_water: 4, spade: 1, rope: 1, hangover_cure: 1 },
    afterMud: { bucket_empty: 4, spade: 1, rope: 1, hangover_cure: 1 },
    afterRope: { bucket_empty: 4, spade: 1, hangover_cure: 1 },
    afterBravek: { bucket_empty: 4, spade: 1 },
} as const;

const vars = (elenaquest: number) => ({ elenaquest, biohazard: 0 });
const WORN = ['staff_of_water'] as const;
const MASKED = ['staff_of_water', 'gasmask'] as const;

const fx = (letter: string, stage: number, quest: Items, kit: Items, tile: QuestFixture['tile'], worn: readonly string[] = WORN, note?: string): QuestFixture => ({
    letter, levels: LEVELS, vars: vars(stage), items: pack(quest, kit), worn, tile, ...(note ? { note } : {}),
});

const EDMOND = { x: 2568, z: 3334 };
/** Where the carrier waits for SCORED, beside Edmond's arrival tile. */
const CARRIER_AT = { x: 2570, z: 3334 };
const PIC = { elena_picture: 1 };
const MASK = { gasmask: 1 };

const CARRIER = arg('carrier', '');
const AT = arg('at', '') ? (([x, z]) => ({ x: x!, z: z! }))(arg('at', '').split(',').map(Number)) : null;
const FROM = arg('from', '').toUpperCase();

const BASE_FIXTURES: readonly QuestFixture[] = [
    CARRIER
        ? { letter: 'A', levels: LEVELS, vars: vars(0), items: { ...BASE }, worn: WORN, tile: EDMOND, note: `Edmond's arrival tile, H6 with the carrier ${CARRIER}` }
        : fx('A', 0, {}, KIT.full, EDMOND, WORN, "Edmond's arrival tile (T07-08: 2568,3334 tol 1), H6 staged"),
    fx('B', 0, {}, KIT.full, EDMOND),
    fx('C', 1, {}, KIT.full, EDMOND),
    fx('D', 1, PIC, KIT.full, { x: 2576, z: 3334 }),
    fx('E', 2, { ...PIC, ...MASK }, KIT.afterAlrena, { x: 2573, z: 3334 }),
    fx('F', 3, { ...PIC, ...MASK }, KIT.afterAlrena, EDMOND),
    fx('G', 3, { ...PIC, ...MASK }, KIT.afterCure, EDMOND),
    fx('H', 7, { ...PIC, ...MASK }, KIT.afterMud, { x: 2567, z: 3332 }),
    fx('I', 8, { ...PIC, ...MASK }, KIT.afterMud, { x: 2562, z: 9737 }),
    fx('J', 9, { ...PIC, ...MASK }, KIT.afterRope, { x: 2530, z: 9703 }),
    fx('K', 10, { ...PIC, ...MASK }, KIT.afterRope, { x: 2535, z: 9718 }),
    fx('L', 10, { ...PIC, ...MASK }, KIT.afterRope, { x: 2529, z: 3304 }, MASKED),
    fx('M', 20, { ...PIC, ...MASK, turnip_book: 1 }, KIT.afterRope, { x: 2539, z: 3305 }, MASKED),
    fx('N', 21, { ...PIC, ...MASK }, KIT.afterRope, { x: 2531, z: 3329 }, MASKED),
    fx('O', 22, { ...PIC, ...MASK }, KIT.afterRope, { x: 2531, z: 3330 }, MASKED),
    fx('P', 23, { ...PIC, ...MASK }, KIT.afterRope, { x: 2531, z: 3330 }, MASKED),
    fx('Q', 24, { ...PIC, ...MASK }, KIT.afterRope, { x: 2533, z: 3273 }, MASKED),
    fx('R', 25, { ...PIC, ...MASK }, KIT.afterRope, { x: 2529, z: 3317 }, MASKED),
    fx('S', 26, { ...PIC, ...MASK, scruffy_note: 1 }, KIT.afterRope, { x: 2535, z: 3314 }, MASKED),
    fx('T', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1 }, KIT.afterBravek, { x: 2535, z: 3314 }, MASKED),
    fx('U', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1 }, KIT.afterBravek, { x: 2533, z: 3271 }, MASKED),
    fx('V', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2533, z: 3269 }, MASKED),
    fx('W', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2537, z: 9670 }, MASKED),
    fx('X', 28, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2540, z: 9672 }, MASKED),
    fx('Y', 28, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2567, z: 3333 }, MASKED),
    fx('Z', 29, { ...MASK, ardougnescroll: 1 }, KIT.afterBravek, { x: 2567, z: 3333 }, MASKED),
];

export const FIXTURES: readonly QuestFixture[] = BASE_FIXTURES.map(f => (AT && f.letter === FROM ? { ...f, tile: AT, note: `${f.note ?? ''} (--at ${AT.x},${AT.z})`.trim() } : f));

/**
 * Reference ticks per segment on the fixed client, from plague_city.md's step rows (stock, measured
 * with the segments script) less one tick per page and option: B step 2 (37 - 17), C 3, D 4 (24 - 7),
 * E 5 (9 - 3), F 6 (8 - 2), G 7-8 (3 + 16 - 4), H 9 (6 - 2), I 10-11 (26 + 5 - 1), J 12 (34 - 4),
 * K 13, L 14 (33 - 12), M 15 (26 - 5), N 16 (8 - 3), O 17 less the door (3 + 14 + 3 - 5), P the door
 * out, the run and 18 (5 + 54 - 8), Q 19 with the expected retries at the fixed rate (47 - 9 + ~8),
 * R 20-21 (11 + 18 - 8), S 22 (26 - 12), T 23-24 (28 + 11 - 4), U 25 (12 - 1), V 26's stairs and
 * run (1 + 3), W 26's unlock and 27 (4 - 1 + 10 - 4), X 28-30 (9 + 22 + 26), Y 31 (10 - 3), Z 32
 * (6 - 2). A is 0 here (the kit staged; the trade is 9 m). Sum 476, with the trade 485, the
 * manifest's 491 fixed less its rounding of the clerk's retries.
 */
export const REFERENCE: Readonly<Record<string, number>> = {
    A: 0, B: 20, C: 16, D: 17, E: 6, F: 6, G: 15, H: 4, I: 30, J: 30, K: 11, L: 21, M: 21, N: 5, O: 15,
    P: 51, Q: 46, R: 21, S: 14, T: 35, U: 11, V: 4, W: 9, X: 57, Y: 7, Z: 4,
};

/** 2,425 base Mining at the server's rate 25 (quest_elena.rs2:12 stat_advance in tenths; the WorldConfig xp rate). */
const REWARD_XP = 24250 * 2.5;
let xp0 = 0;

/** Alrena's room, inside the west door. */
const inHouse = (n: { x: number; z: number }) => n.x >= 2571 && n.x <= 2573 && n.z >= 3330 && n.z <= 3336;
const EDMOND_RE = /^edmond$/i;

async function edmondInside(session: Session): Promise<void> {
    const sdk = session.sdk;
    const p = sdk.getState()!.player!;
    const start = { x: p.worldX, z: p.worldZ };
    const openDoorLoc = () => sdk.getState()!.nearbyLocs.find(l => l.x === 2571 && l.z === 3333 && /door/i.test(l.name) && opIndex(l, /^close$/i) !== undefined);
    const open = openDoorLoc();
    if (open) await opLoc(sdk as never, open, /^close$/i, () => !openDoorLoc(), { maxTicks: 20 });
    if (!sdk.getState()!.nearbyNpcs.some(n => EDMOND_RE.test(n.name) && inHouse(n))) {
        await mustTele(sdk, 2572, 3334);
        await cheat(sdk, 'npcadd edmond');
        const w = await waitUntil(sdk, s => s.nearbyNpcs.some(n => EDMOND_RE.test(n.name) && inHouse(n)), { maxTicks: 10 });
        if (!w.ok) throw new Error('--edmond-inside: no Edmond in Alrena\'s room after ::npcadd');
    }
    await mustTele(sdk, start.x, start.z);
    const picked = await waitUntil(sdk, s => {
        const e = findNpc(s, EDMOND_RE, { x: 2568, z: 3334 });
        return !!e && inHouse(e) && !openDoorLoc();
    }, { maxTicks: 400 });
    if (!picked.ok) throw new Error('--edmond-inside: the Edmond nearest his spawn never was the one inside (400 ticks)');
}

const carrier = CARRIER ? await openSession(CARRIER, { pathfinding: false }) : null;
let carrierGive: Promise<GiveResult> | null = null;

/** The carrier holding H6 as the ledger's row has it, beside Edmond, its trade offer standing for SCORED. */
async function stageCarrier(c: Session, scored: string): Promise<void> {
    const sdk = c.sdk;
    await sdk.sendCloseModal();
    await tele(sdk, STAGING.x, STAGING.z);
    await clearInventory(sdk);
    const items = Object.entries({ ...H6, ...H6_RUNES });
    for (const [k, n] of items) await give(sdk, k, n);
    const held = sdk.getState()?.inventory ?? [];
    for (const [k, n] of items) {
        const have = held.filter(i => i.id === configId('obj', k)).reduce((a, i) => a + i.count, 0);
        if (have < n) throw new Error(`carrier: gave ${n} ${k}, holding ${have}`);
    }
    await mustTele(sdk, CARRIER_AT.x, CARRIER_AT.z);
    carrierGive = tradeGive(sdk, scored, items.map(([k, n]) => ({ item: configId('obj', k), n })), { openMaxTicks: 150 });
}

const lab: LabQuest<Options> = {
    title: `Plague City (S08, SCORED's levels: Magic 59, Mining 49; from Edmond's arrival tile 2568,3334)`,
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session, f: QuestFixture) {
        xp0 = skillXp(session.sdk, 'mining');
        carrierGive = null;
        if (process.argv.includes('--open-door')) {
            const at = session.sdk.getState()!.player!;
            const o = await openDoor(session.sdk as never, HOUSE_DOORS[0].x, HOUSE_DOORS[0].z);
            if (!o.ok) throw new Error('--open-door: the west house door did not open');
            if (session.sdk.getState()!.player!.worldX !== at.worldX || session.sdk.getState()!.player!.worldZ !== at.worldZ) await mustTele(session.sdk, at.worldX, at.worldZ);
        }
        if (process.argv.includes('--edmond-inside')) await edmondInside(session);
        const s = session.sdk.getState()!;
        const near = s.nearbyLocs.filter(l => /door/i.test(l.name) && Math.abs(l.x - 2570) <= 2 && Math.abs(l.z - 3333) <= 2).map(l => `${l.name} ${l.id} @${l.x},${l.z} [${l.optionsWithIndex.map(o => o.text).join('/')}]`);
        const edmond = findNpc(s, /^edmond$/i, { x: 2568, z: 3334 });
        const doors = HOUSE_DOORS.map(d => {
            const l = s.nearbyLocs.find(l => l.x === d.x && l.z === d.z && /door/i.test(l.name));
            return { ...d, loc: l ? `${l.name} ${l.id} [${l.optionsWithIndex.map(o => o.text).join('/')}]` : null };
        });
        result(`${stepId}_start`, { letter: f.letter, at: s.player ? { x: s.player.worldX, z: s.player.worldZ } : null, doors, near, edmond: edmond ? { x: edmond.x, z: edmond.z } : null });
        if (carrier && f.letter === 'A') await stageCarrier(carrier, session.sdk.getState()!.player!.name);
    },
    async check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (carrierGive) {
            const g = await carrierGive;
            result(`${stepId}_h6_carrier`, { ok: g.ok, ticks: g.ticks, gave: g.gave.map(i => `${i.name} x${i.count}`), reason: g.reason ?? null });
            if (!g.ok) return `the carrier's H6 trade: ${g.reason}`;
        }
        if (!rows.some(r => r.step === `${stepId}:Z-scroll` && !r.kind)) return undefined;
        const sdk = session.sdk;
        const s = sdk.getState()!;
        // T08-09 as the ledger has it: H6's 2 law only, the water from the worn staff.
        if (invCount(s, /^water rune$/i) > 0) return `${invCount(s, /^water rune$/i)} water runes held before the cast: the staff's water is not what is tested`;
        if (!worn(s, /^staff of water$/i)) return 'the staff of water is not worn at the cast';
        const law0 = invCount(s, /^law rune$/i);
        if (questStatus(s, quest) !== 'complete') return 'the quest is not complete after Z';
        const read = rows.filter(r => r.kind === 'note' && r.step === `${stepId}:Z`).map(r => (r.meta as { scrollRead?: ScrollRead }).scrollRead).find(Boolean);
        if (!read?.read) return `the scroll read was not observed (${JSON.stringify(read ?? null)})`;
        if (rows.some(r => r.step === `${stepId}:Y-edmond-reward` && !r.kind)) {
            const gained = skillXp(s, 'mining') - xp0;
            if (gained < REWARD_XP) return `Mining xp gained ${gained}, the reward is ${REWARD_XP}`;
        }
        // T08-09's cast: at %elenaquest 29 it is refused ('You haven't learnt how to cast this spell yet.').
        const cast = await teleport(sdk as unknown as TravelSdk, 'ardougne', { walkOnRefusal: false });
        const after = sdk.getState()!;
        const runes = { lawBefore: law0, lawAfter: invCount(after, /^law rune$/i), waterHeld: invCount(after, /^water rune$/i), staff: worn(after, /^staff of water$/i)?.name ?? null };
        result(`${stepId}_ardougne_cast`, { ok: cast.ok, ticks: cast.ticks, reason: cast.reason ?? null, at: cast.at, scrollPages: read.pages, ...runes });
        if (!cast.ok) return `the Ardougne teleport after the scroll: ${cast.reason}`;
        if (runes.lawAfter !== law0 - 2) return `the cast spent ${law0 - runes.lawAfter} law, not 2`;
        return undefined;
    },
};

if (import.meta.main) {
    if (carrier) {
        await leaveTutorial(carrier);
        lab.options = { kitFrom: carrier.sdk.getState()!.player!.name };
    }
    try {
        await labMain(lab);
    } finally {
        if (carrier) await closeSession(carrier);
    }
    process.exit(0);
}
