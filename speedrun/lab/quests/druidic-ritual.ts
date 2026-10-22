// Lab acceptance for the Druidic Ritual module (speedrun/quests/druidic-ritual.ts, S24's D1-D9):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/druidic-ritual.ts:--from=D1:--until=D9:--runs=3:--dialogue=both:--launch'
//
// SCORED's levels at S24 are the route's post-Monkey-Madness combat levels (the suits of armour by
// the cauldron fight back; at these levels they are harmless), Herblore 1. The pack is the
// inventory ledger's after H20, Goblin Diplomacy's Rusty Anchor part done (its two mails dyed). The
// suits are locs again 500 ticks after they wake (prison_doors.rs2), so a run within that of the
// one before meets the door already open to one click: the note row counts the suits woken.
// Ticks are from Kaqemeex (2924,3486); L24a and L24b are not in them.

import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { skillXp } from '../../lib/world';
import { ARRIVAL, CAULDRON_ROOM, DOOR_OUT, quest, stepId, steps, type Options } from '../../quests/druidic-ritual';
import { fixturePack, ledgerAfter } from './ledger';
import { labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { attack: 99, strength: 97, defence: 89, hitpoints: 97, magic: 99, prayer: 99, ranged: 54, agility: 75, crafting: 42, herblore: 1 } as const;

const H20 = ledgerAfter('H20');
const RAW = ['raw_rat_meat', 'raw_bear_meat', 'raw_beef', 'raw_chicken'];
const DIPPED = { enchanted_rat_meat: 1, enchanted_bear_meat: 1, enchanted_beef: 1, enchanted_chicken: 1 };
/** After Goblin Diplomacy's G2: two mails dyed. `meats`: raw (H20's), dipped, or gone. */
const pack = (meats: 'raw' | 'dipped' | 'none') => {
    const p = fixturePack(H20, { goblin_armour_orange: 1, goblin_armour_darkblue: 1, ...(meats === 'dipped' ? DIPPED : {}) }, ['orangedye', 'bluedye', 'goblin_armour', ...(meats === 'raw' ? [] : RAW)]);
    p.items.goblin_armour = 1;
    return p;
};

const circle = { x: ARRIVAL.x, z: ARRIVAL.z };
const sanfew = { x: 2897, z: 3428, level: 1 };
const door = { x: DOOR_OUT.x, z: DOOR_OUT.z };
const room = { x: CAULDRON_ROOM.x0 + 3, z: 9831 };
const fx = (letter: string, druidquest: number, meats: Parameters<typeof pack>[0], tile: QuestFixture['tile'], note?: string): QuestFixture =>
    ({ letter, levels: LEVELS, vars: { druidquest }, ...pack(meats), tile, ...(note ? { note } : {}) });

export const FIXTURES: readonly QuestFixture[] = [
    fx('D1', 0, 'raw', circle, "the arrival tile (legs.ts L24a: 2924,3486 tol 1), the ledger's pack after H20 and G2"),
    fx('D2', 1, 'raw', circle),
    fx('D3', 1, 'raw', sanfew),
    fx('D4', 2, 'raw', sanfew),
    fx('D5', 2, 'raw', door),
    fx('D6', 2, 'dipped', room),
    fx('D7', 2, 'dipped', sanfew),
    fx('D8', 3, 'none', sanfew),
    fx('D9', 3, 'none', circle),
];

/**
 * Reference ticks (fixed dialogue), inferred: page counts at a page a tick plus the approach, runs
 * at 0.5 a route tile from the map's tiles (stone circle to Sanfew's stairs ~60, his stairs to the
 * dungeon ladder ~35, the ladder to the prison door ~33), 2 a climb, the door 3 opens, 4 dips. Sum
 * 190 against the manifest's fixed 239 (inferred, travel inside the quest included).
 */
export const REFERENCE: Readonly<Record<string, number>> = { D1: 12, D2: 32, D3: 9, D4: 22, D5: 28, D6: 41, D7: 6, D8: 32, D9: 8 };

/** 250 base Herblore at the server's rate 25 (quest_druid.rs2:3). */
const REWARD_XP = 2500 * 2.5;
let xp0 = 0;
let hp0 = 0;

const lab: LabQuest<Options> = {
    title: "Druidic Ritual (S24 D1-D9, SCORED's post-MM levels, Herblore 1; the ledger's pack after H20; from Kaqemeex 2924,3486)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'herblore');
        hp0 = session.sdk.getState()?.player?.hp ?? 0;
    },
    check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        const s = session.sdk.getState()!;
        console.log(`check: HP ${hp0} -> ${s.player?.hp}`);
        if (!rows.some(r => r.step === `${stepId}:D9-kaqemeex-reward`)) return undefined;
        console.log(`check: Herblore level ${s.skills.find(k => /herblore/i.test(k.name))?.baseLevel}, xp gained ${skillXp(s, 'herblore') - xp0}`);
        if (questStatus(s, quest) !== 'complete') return 'Druidic Ritual is not complete after D9';
        if (skillXp(s, 'herblore') - xp0 < REWARD_XP) return `Herblore xp gained ${skillXp(s, 'herblore') - xp0}, the reward is ${REWARD_XP}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
