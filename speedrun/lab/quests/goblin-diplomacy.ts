// Lab acceptance for the Goblin Diplomacy module (speedrun/quests/goblin-diplomacy.ts, S24's G1-G6):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/goblin-diplomacy.ts:--from=G1:--until=G2:--runs=3:--dialogue=both:--launch'
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/goblin-diplomacy.ts:--from=G3:--until=G6:--runs=3:--dialogue=both:--launch'
//
// The two parts run apart, as the run chain places them (L24a, Druidic Ritual and L24b come
// between, and are not in these ticks). SCORED's levels at S24 are the route's post-Monkey-Madness
// combat levels, Crafting 42 and Herblore 1. The pack is the inventory ledger's after H20, with the
// dyes spent and Druidic Ritual's meats gone by the village part.

import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { skillXp } from '../../lib/world';
import { ARRIVAL, quest, stepId, steps, VILLAGE_ARRIVAL, type Options } from '../../quests/goblin-diplomacy';
import { fixturePack, ledgerAfter } from './ledger';
import { labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { attack: 99, strength: 97, defence: 89, hitpoints: 97, magic: 99, prayer: 99, ranged: 54, agility: 75, crafting: 42, herblore: 1 } as const;

const H20 = ledgerAfter('H20');
const MEATS = ['raw_rat_meat', 'raw_bear_meat', 'raw_beef', 'raw_chicken'];
const DYED = { goblin_armour_orange: 1, goblin_armour_darkblue: 1 };
/** The village part's pack: two mails dyed, the dyes and the meats gone. `gave` drops the dyed mails already handed over. */
const village = (gave: readonly string[] = []) => {
    const quest = Object.fromEntries(Object.entries(DYED).filter(([k]) => !gave.includes(k)));
    const p = fixturePack(H20, quest, ['orangedye', 'bluedye', 'goblin_armour', ...MEATS]);
    p.items.goblin_armour = 1;
    return p;
};

const anchor = { x: ARRIVAL.x, z: ARRIVAL.z };
const generals = { x: VILLAGE_ARRIVAL.x, z: VILLAGE_ARRIVAL.z };
const fx = (letter: string, goblinquest: number, pack: { items: Record<string, number>; worn: string[] }, tile: QuestFixture['tile'], note?: string): QuestFixture =>
    ({ letter, levels: LEVELS, vars: { goblinquest }, ...pack, tile, ...(note ? { note } : {}) });

export const FIXTURES: readonly QuestFixture[] = [
    fx('G1', 0, fixturePack(H20), anchor, "the arrival tile (legs.ts T23-24: 3045,3257 tol 1), the ledger's pack after H20"),
    fx('G2', 1, fixturePack(H20), anchor),
    fx('G3', 1, village(), generals, "L24b's landing (2957,3511 tol 1), the dyes spent and Druidic Ritual done"),
    fx('G4', 2, village(), generals),
    fx('G5', 3, village(['goblin_armour_orange']), generals),
    fx('G6', 4, village(['goblin_armour_orange', 'goblin_armour_darkblue']), generals),
];

/**
 * Reference ticks (fixed dialogue), inferred from the page counts at a page a tick plus the
 * approach: the bartender opt + 4c (6), the dyes (2), the request 3c + opt + 5c (10), the orange,
 * blue and plain mails 9c each (10), the completion's level-up page (+3). Sum 51 against the
 * manifest's fixed 61 (inferred, from the Rusty Anchor).
 */
export const REFERENCE: Readonly<Record<string, number>> = { G1: 6, G2: 2, G3: 10, G4: 10, G5: 10, G6: 13 };

/** 200 base Crafting at the server's rate 25 (quest_gobdip.rs2:62). */
const REWARD_XP = 2000 * 2.5;
let xp0 = 0;

const lab: LabQuest<Options> = {
    title: "Goblin Diplomacy (S24 G1-G6, SCORED's post-MM levels, Crafting 42; the ledger's pack after H20; from the Rusty Anchor and from L24b's landing)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'crafting');
    },
    check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (!rows.some(r => r.step === `${stepId}:G6-plain-mail`)) return undefined;
        const s = session.sdk.getState()!;
        console.log(`check: Crafting level ${s.skills.find(k => /crafting/i.test(k.name))?.baseLevel}, xp gained ${skillXp(s, 'crafting') - xp0}`);
        if (questStatus(s, quest) !== 'complete') return 'Goblin Diplomacy is not complete after G6';
        if (skillXp(s, 'crafting') - xp0 < REWARD_XP) return `Crafting xp gained ${skillXp(s, 'crafting') - xp0}, the reward is ${REWARD_XP}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
