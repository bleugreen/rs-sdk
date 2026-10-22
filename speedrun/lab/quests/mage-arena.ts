// Lab acceptance for the Mage Arena module (speedrun/quests/mage-arena.ts, S16):
//
//   speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/mage-arena.ts:--from=A:--until=F:--runs=3:--dialogue=burst'
//   speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/mage-arena.ts:--from=B:--until=C:--runs=3:--spell=fire_blast'
//
// --spell=fire_wave|fire_blast (default the module's, fire_wave); --magic=N the arrival's base Magic,
// set at the bottom of the level (default 76: 8,092.7 base, rs/371's pricing); --prayer=N prayer points
// at arrival (default 40: S15's demon leaves 30-50 of 94, m, rs/201; i for the chain); --potion=0 drops
// the magic potion from the kit (acceptance (a)); --trace=N.
//
// Fixtures stage SCORED's S16 inventory from STEP-MANIFEST.md's inventory ledger after H13 (the
// slot-ledger walk, 21/28 with the gree-gree): water 8, law 7, air 756, blood 70, prayer potion(4)
// 4, magic potion(4) 1, shark 9, knife 1, the gree-gree; worn: the M'speak amulet and the staff of
// fire. With --spell=fire_blast the blood runes give way to death runes (H13's Fire Blast column).
// Levels are SCORED's after S15 (RUN-ORDER S15/S16; i): Attack 99, Strength 97, Defence 88,
// Hitpoints 97, Ranged 50, Prayer 94, Thieving 57, Agility 75, Magic as --magic.
// Ticks are from the arrival tile in Kolodion's cellar (2543,4713): T15-16 is not in them.
// After each run the RESULT line `S16_fight` carries the fight's tally (casts, runes, xp, HP,
// prayer) and the exit's Magic; a summary over the runs follows the table.

import type { BotWorldState } from '../../../sdk/types';
import { prayerDoses } from '../../lib/combat';
import { xpForLevel } from '../../lib/xp';
import { exitMagic, newTally, quest, SPELL_RUNES, stepId, steps, type FightTally, type KolodionSpell, type Options } from '../../quests/mage-arena';
import { arg, result } from '../common';
import { cheat, setvar } from '../setup';
import { waitTicks } from '../../lib/wait';
import { labMain, type LabQuest, type QuestFixture } from './run';

const SPELL = arg('spell', 'fire_wave') as KolodionSpell;
if (SPELL !== 'fire_wave' && SPELL !== 'fire_blast') throw new Error(`--spell=${SPELL}: want fire_wave or fire_blast`);
const MAGIC = Number(arg('magic', '76'));
const PRAYER_AT = Number(arg('prayer', '40'));
const POTION = arg('potion', '1') !== '0';
const FROM = arg('from', 'A');

/** SCORED after S15 (i: MM's reward on S15's arrival levels), Magic at the arrival under test. */
export const LEVELS: Readonly<Record<string, number>> = {
    attack: 99, strength: 97, defence: 88, hitpoints: 97, ranged: 50, prayer: 94, thieving: 57, agility: 75, magic: MAGIC,
};

/** The ledger's S16 pack after H13 (obj debug names), less the spell runes and the gree-gree. */
const PACK: Record<string, number> = {
    staff_of_fire: 1, mm_amulet_of_monkey_speak: 1,
    waterrune: 8, lawrune: 7, airrune: 756,
    '4doseprayerrestore': 4, ...(POTION ? { '4dose1magic': 1 } : {}), shark: 9, knife: 1,
};
const SPELL_RUNE_OBJ: Record<KolodionSpell, string> = { fire_wave: 'bloodrune', fire_blast: 'deathrune' };
/** Fire Blast's pricing carries death runes well past any fight, so the count is the measurement, not the kit. */
const SPELL_RUNE_COUNT = SPELL === 'fire_blast' ? Math.max(200, SPELL_RUNES.fire_blast) : SPELL_RUNES.fire_wave;
const GREEGREE = 'mm_monkey_greegree_for_small_ninja_monkey';
const WORN = ['staff_of_fire', 'mm_amulet_of_monkey_speak'] as const;

const CELLAR_ARRIVAL = { x: 2543, z: 4713 };
const CELLAR_FINISH = { x: 2540, z: 4716 };
const CHAMBER_LANDING = { x: 2509, z: 4689 };
const BELOW_SARADOMIN = { x: 2500, z: 4719 };

const fx = (letter: string, magearena: number, tile: QuestFixture['tile'], extra: Record<string, number> = {}, note?: string): QuestFixture => ({
    letter,
    levels: LEVELS,
    vars: { magearena },
    relog: false, // nothing reads the quest tab: the arena is not on it
    items: { ...PACK, [SPELL_RUNE_OBJ[SPELL]]: SPELL_RUNE_COUNT, ...extra },
    worn: WORN,
    tile,
    ...(note ? { note } : {}),
});

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, CELLAR_ARRIVAL, { [GREEGREE]: 1 }, "the arrival tile (legs.ts T15-16 kolodionCellar), the gree-gree still held"),
    fx('B', 0, CELLAR_ARRIVAL),
    fx('D', 6, CELLAR_FINISH, {}, 'the fight won (finish_mage_arena lands here)'),
    fx('E', 6, CHAMBER_LANDING),
    fx('F', 7, BELOW_SARADOMIN, { saradomin_cape: 1 }),
];

const tally: FightTally = newTally(SPELL);
const fights: Array<FightTally & { exit: ReturnType<typeof exitMagic>; ok: boolean }> = [];

const options: Omit<Options, 'dialogue'> = { spell: SPELL, tally, ...(/^[D-F]/.test(FROM) ? { fought: true } : {}) };

const lab: LabQuest<Options> = {
    title: `Mage Arena (${SPELL}, base Magic ${MAGIC}, prayer ${PRAYER_AT}${POTION ? '' : ', no magic potion'})`,
    stepId,
    steps,
    fixtures: FIXTURES,
    // mage_arena.md's step rows (fixed column), read; the fight is the manifest's inferred middle.
    reference: { B: 23, C: 315, D: 13, E: 32, F: 26 },
    options,
    async prepare(session, f) {
        const sdk = session.sdk;
        Object.assign(tally, newTally(SPELL));
        // ::setstat puts the level at its bottom: check the arrival xp is the level's floor.
        await waitTicks(sdk, 2);
        const s = sdk.getState()!;
        const pts = s.prayers?.prayerPoints ?? 0;
        if (f.letter <= 'C' && pts > PRAYER_AT) await cheat(sdk, `~stat_drain prayer ${pts - PRAYER_AT} 0`, 2);
        if (f.letter <= 'C') await setvar(sdk, quest, 0);
        await waitTicks(sdk, 2);
        const s1 = sdk.getState()!;
        console.log(`ARRIVAL magic xp ${(skill(s1, 'magic')?.experience ?? 0) / 25} base (level ${MAGIC} floor ${xpForLevel(MAGIC) / 25}), prayer ${s1.prayers?.prayerPoints}/${s1.prayers?.prayerLevel}, doses ${prayerDoses(s1)}, hp ${s1.player?.hp}, free ${28 - s1.inventory.length}`);
    },
    check(session) {
        const s = session.sdk.getState()!;
        if (tally.ticks > 0) {
            const row = { ...structuredClone(tally), exit: exitMagic(s), ok: true };
            fights.push(row);
            result('S16_fight', row);
        }
        return undefined;
    },
};

const skill = (s: BotWorldState, name: string) => s.skills.find(k => k.name.toLowerCase() === name);

const stat = (xs: number[]) => (xs.length ? { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), min: Math.min(...xs), max: Math.max(...xs) } : null);

await labMain(lab);

if (fights.length) {
    const base = (xp: number) => +(xp / 25).toFixed(1);
    console.log(`\nKolodion, ${SPELL}, base Magic ${MAGIC} (m, lab, 300 ms; from the arena landing to the cellar landing):`);
    console.log('| run | fight ticks | casts | clicks | runes | air | Magic xp (base) | exit base xp | exit level | HP lost | prayer used | doses | sips | eats |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    fights.forEach((f, i) => console.log(`| ${i + 1} | ${f.ticks} | ${f.casts} | ${f.clicks} | ${f.runesUsed} | ${f.airUsed} | ${base(f.magicXp1 - f.magicXp0)} | ${base(f.magicXp1)} | ${f.magicBase1} | ${f.hp0 - f.hpMin} | ${f.prayerUsed} | ${f.doses} | ${f.magicSips} | ${f.eats} |`));
    const summary = {
        spell: SPELL, magic: MAGIC, runs: fights.length,
        ticks: stat(fights.map(f => f.ticks)), casts: stat(fights.map(f => f.casts)), runes: stat(fights.map(f => f.runesUsed)),
        air: stat(fights.map(f => f.airUsed)), xp: stat(fights.map(f => base(f.magicXp1 - f.magicXp0))),
        exitLevel: stat(fights.map(f => f.magicBase1)), hpLost: stat(fights.map(f => f.hp0 - f.hpMin)), prayer: stat(fights.map(f => f.prayerUsed)),
    };
    console.log(JSON.stringify(summary));
    result('S16_pricing', summary);
}
