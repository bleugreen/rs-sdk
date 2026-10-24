// Lab acceptance for the Mage Arena module (speedrun/quests/mage-arena.ts, S16):
//
//   speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/mage-arena.ts:--from=A:--until=F:--runs=3:--dialogue=burst'
//   speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/mage-arena.ts:--from=B:--until=C:--runs=3:--spell=fire_blast'
//
// --spell=fire_wave|fire_blast (default the module's, fire_wave); --magic=N the arrival's base Magic,
// set at the bottom of the level (default 76: 8,092.7 base, rs/371's pricing); --xp=N the arrival's base
// Magic xp instead (the level is the one it falls in): ::setstat puts the xp at the level's floor, then
// High Level Alchemy (a fixed 65 base a cast, magic_spells.dbrow) climbs to the nearest cast of N, and
// the coins it makes are dropped (rs/158's route arrival, 77 at ~9,118); --prayer=N prayer points
// at arrival (default 40: S15's demon leaves 30-50 of 94, m, rs/201; i for the chain); --potion=0 drops
// the magic potion from the kit (acceptance (a)); --blood=N stages N blood runes and lowers the kit to
// match (default H13's 90; ~20 forces the Fire Blast fallback mid-fight); --death=N the death runes
// behind it (default H13's 25); --prayerpots=4,2 stages the prayer potions at those doses in place of
// the four (4)s (rs/764's S16 entry); --trace=N. After each run an EXIT line lists the pack and the worn
// set, the S16 exit drops' evidence (no prayer potion or vial past the ledger's T16-18 row).
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
import { prayerActive, prayerDoses, setPrayer } from '../../lib/combat';
import { baseToXp, levelForXp, xpForLevel, XP_RATE } from '../../lib/xp';
import { invItem, skillXp } from '../../lib/world';
import { exitMagic, FALLBACK_RUNES, newTally, quest, SPELL_RUNES, stepId, steps, type FightTally, type KolodionSpell, type Options } from '../../quests/mage-arena';
import { arg, result } from '../common';
import { cheat, dropMatching, give, setvar } from '../setup';
import { waitTicks, waitUntil } from '../../lib/wait';
import { relog, type Session } from '../../lib/session';
import { inArena } from '../../quests/mage-arena';
import { watchPoison, type PoisonWatch } from '../poison-watch';
import { labMain, type LabQuest, type QuestFixture } from './run';

const SPELL = arg('spell', 'fire_wave') as KolodionSpell;
if (SPELL !== 'fire_wave' && SPELL !== 'fire_blast') throw new Error(`--spell=${SPELL}: want fire_wave or fire_blast`);
const XP_AT = Number(arg('xp', '0'));
const MAGIC = XP_AT ? levelForXp(baseToXp(XP_AT)) : Number(arg('magic', '76'));
const PRAYER_AT = Number(arg('prayer', '40'));
const POTION = arg('potion', '1') !== '0';
const FROM = arg('from', 'A');
const PRAYER_POTS = arg('prayerpots', '4,4,4,4').split(',').map(Number);
/** --superanti=N: H12's Superantipoison at N doses in the pack, as H13's row keeps it to H14. */
const SUPER_ANTI = arg('superanti', '');
/**
 * --poison=SEV (with --launch): a poison carried across a fresh login, attempt 4's shape: %poison reset, ::~poison SEV,
 * one hit taken, then a relog on a new client (the published tick restarts, no hit in view) and the segments at once.
 * Every damage_taken (hitmark, sourceIndex), antipoison dose and the first arena tick are logged (lab/poison-watch.ts).
 */
const POISON = Number(arg('poison', '0'));
if (PRAYER_POTS.some(d => !(d >= 1 && d <= 4))) throw new Error(`--prayerpots=${PRAYER_POTS}: doses 1-4`);
const prayerPots = PRAYER_POTS.reduce<Record<string, number>>((m, d) => ({ ...m, [`${d}doseprayerrestore`]: (m[`${d}doseprayerrestore`] ?? 0) + 1 }), {});

/** SCORED after S15 (i: MM's reward on S15's arrival levels), Magic at the arrival under test. */
export const LEVELS: Readonly<Record<string, number>> = {
    attack: 99, strength: 97, defence: 88, hitpoints: 97, ranged: 50, prayer: 94, thieving: 57, agility: 75, magic: MAGIC,
};

/** The ledger's S16 pack after H13 (obj debug names), less the spell runes and the gree-gree. */
const PACK: Record<string, number> = {
    staff_of_fire: 1, mm_amulet_of_monkey_speak: 1,
    waterrune: 8, lawrune: 7, airrune: 756,
    ...prayerPots, ...(POTION ? { '4dose1magic': 1 } : {}), shark: 9, knife: 1,
    ...(SUPER_ANTI ? { [`${SUPER_ANTI}dose2antipoison`]: 1 } : {}),
};
const SPELL_RUNE_OBJ: Record<KolodionSpell, string> = { fire_wave: 'bloodrune', fire_blast: 'deathrune' };
/** Fire Blast's pricing carries death runes well past any fight, so the count is the measurement, not the kit. */
const BLOOD = arg('blood', '') ? Number(arg('blood', '')) : undefined;
const SPELL_RUNE_COUNT = SPELL === 'fire_blast' ? Math.max(200, SPELL_RUNES.fire_blast) : (BLOOD ?? SPELL_RUNES.fire_wave);
/** Fire Wave's fallback runes (H13's death runes). */
const DEATH = SPELL === 'fire_wave' ? Number(arg('death', String(FALLBACK_RUNES))) : 0;
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
    items: { ...PACK, [SPELL_RUNE_OBJ[SPELL]]: SPELL_RUNE_COUNT, ...(DEATH ? { deathrune: DEATH } : {}), ...extra },
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

const options: Omit<Options, 'dialogue'> = {
    spell: SPELL, tally, ...(/^[D-F]/.test(FROM) ? { fought: true } : {}), ...(BLOOD !== undefined && SPELL === 'fire_wave' ? { spellRunes: BLOOD } : {}),
};

/** High Level Alchemy (interface.pack magic:highlvl_alchemy): 65 base xp a cast, whatever the item. */
const HIGH_ALCH = { component: 1178, base: 65 } as const;

/** Climb from the level's floor to the cast nearest `target` base xp; the staff of fire pays the fire runes. */
async function alchTo(sdk: Parameters<NonNullable<LabQuest['prepare']>>[0]['sdk'], target: number): Promise<number> {
    const n = Math.max(0, Math.round((target - skillXp(sdk, 'magic') / XP_RATE) / HIGH_ALCH.base));
    if (!n) return 0;
    await give(sdk, 'naturerune', n);
    for (let i = 0; i < n; i++) {
        await give(sdk, 'iron_bar', 1);
        const xp0 = skillXp(sdk, 'magic');
        for (let k = 0; k < 8 && skillXp(sdk, 'magic') === xp0; k++) {
            const bar = invItem(sdk, /^iron bar$/i);
            if (bar) await sdk.sendSpellOnItem(bar.slot, HIGH_ALCH.component);
            await waitTicks(sdk, 2);
        }
        if (skillXp(sdk, 'magic') === xp0) throw new Error(`alchTo: cast ${i + 1} of ${n} paid no xp`);
    }
    await dropMatching(sdk, [/^coins$/i, /^iron bar$/i, /^nature rune$/i]);
    return n;
}

/**
 * Every wall-clock gap over 1.5 s between new ticks, with the tick jump across it: a jump of 1 is a
 * pause upstream of the client (engine or socket), a jump of many is a client that drained a backlog.
 * Diagnoses the fight's 'client stopped publishing' (rs/371).
 */
let gapMonitor = false;
function watchGaps(sdk: Parameters<NonNullable<LabQuest['prepare']>>[0]['sdk']): void {
    if (gapMonitor) return;
    gapMonitor = true;
    let lastTick = -1;
    let lastMs = Date.now();
    sdk.onStateUpdate(s => {
        if (s.tick === lastTick) return;
        const ms = Date.now();
        if (lastTick >= 0 && ms - lastMs > 1500) console.log(`GAP ${ms - lastMs} ms ending ${(ms / 1000).toFixed(1)}, tick ${lastTick} -> ${s.tick} (+${s.tick - lastTick}) at ${s.player?.worldX},${s.player?.worldZ} npcs ${s.nearbyNpcs.length} msgs ${JSON.stringify(s.gameMessages.slice(-2).map(m => m.text))}`);
        lastTick = s.tick;
        lastMs = ms;
    });
}

const lab: LabQuest<Options> = {
    title: `Mage Arena (${SPELL}, base Magic ${MAGIC}${XP_AT ? ` at ~${XP_AT} base xp` : ''}, prayer ${PRAYER_AT}${POTION ? '' : ', no magic potion'}${BLOOD !== undefined ? `, ${BLOOD} blood + ${DEATH} death` : ''})`,
    stepId,
    steps,
    fixtures: FIXTURES,
    // mage_arena.md's step rows (fixed column), read; the fight is the manifest's inferred middle.
    reference: { B: 23, C: 315, D: 13, E: 32, F: 26 },
    options,
    async prepare(session, f) {
        const sdk = session.sdk;
        watchGaps(sdk);
        Object.assign(tally, newTally(SPELL));
        // ::setstat puts the level at its bottom: check the arrival xp is the level's floor.
        await waitTicks(sdk, 2);
        // An aborted fight leaves Protect from Magic on, draining the next run's arrival points.
        if (prayerActive(sdk.getState()!, 'protect_from_magic')) await setPrayer(sdk, 'protect_from_magic', false);
        const s = sdk.getState()!;
        const pts = s.prayers?.prayerPoints ?? 0;
        if (f.letter <= 'C' && pts > PRAYER_AT) await cheat(sdk, `~stat_drain prayer ${pts - PRAYER_AT} 0`, 2);
        if (f.letter <= 'C') await setvar(sdk, quest, 0);
        const alchs = XP_AT && f.letter <= 'C' ? await alchTo(sdk, XP_AT) : 0;
        if (alchs) console.log(`ARRIVAL ${alchs} high alchemy casts to ~${XP_AT} base`);
        await waitTicks(sdk, 2);
        const s1 = sdk.getState()!;
        console.log(`ARRIVAL magic xp ${(skill(s1, 'magic')?.experience ?? 0) / 25} base (level ${MAGIC} floor ${xpForLevel(MAGIC) / 25}), prayer ${s1.prayers?.prayerPoints}/${s1.prayers?.prayerLevel}, doses ${prayerDoses(s1)}, hp ${s1.player?.hp}, free ${28 - s1.inventory.length}`);
        if (POISON > 0) await carryPoison(session);
    },
    check(session) {
        const s = session.sdk.getState()!;
        const left = s.inventory.filter(i => /^prayer potion|^vial$/i.test(i.name)).map(i => i.name);
        console.log(`EXIT pack ${s.inventory.length}/28 (${28 - s.inventory.length} free): ${s.inventory.map(i => (i.count > 1 ? `${i.name} x${i.count}` : i.name)).join(', ')}; worn: ${s.equipment.map(i => i.name).join(', ')}; prayer ${s.prayers?.prayerPoints}/${s.prayers?.prayerLevel}; potions or vials left: ${left.length ? left.join(', ') : 'none'}`);
        if (tally.ticks > 0) {
            const row = { ...structuredClone(tally), exit: exitMagic(s), ok: true };
            fights.push(row);
            result('S16_fight', row);
        }
        return undefined;
    },
};

const skill = (s: BotWorldState, name: string) => s.skills.find(k => k.name.toLowerCase() === name);

const poisonEmit = (event: string, fields: Record<string, unknown>) => console.log(`POISONLAB ${JSON.stringify({ event, ...fields })}`);
let poisonWatch: PoisonWatch | null = null;

/** --poison: SEV, one hit, a relog on a new client; the observer runs from before the poisoning to the script's end. */
async function carryPoison(session: Session): Promise<void> {
    const sdk = session.sdk;
    if (!session.child) throw new Error('--poison needs this script to own the client (LAB_RUNNERS=0 and --launch) for its relog');
    poisonWatch ??= watchPoison(sdk, poisonEmit, { arena: inArena });
    await cheat(sdk, 'setvar poison 0', 2);
    const t0 = sdk.getState()!.tick;
    await cheat(sdk, `~poison ${POISON}`);
    const hit = (s: BotWorldState | null) => (s?.combatEvents ?? []).find(e => e.type === 'damage_taken' && e.targetType === 'player' && e.hitmark === 2 && e.tick > t0);
    if (!(await waitUntil(sdk, s => !!hit(s), { maxTicks: 40 })).ok) throw new Error(`--poison=${POISON}: no poison hit within 40 ticks of t=${t0}`);
    await waitTicks(sdk, 2);
    poisonEmit('poison-staged', { severity: POISON, poisonedAt: t0, firstHitAt: hit(sdk.getState())!.tick, hp: sdk.getState()!.player?.hp });
    const r = await relog(session);
    const s = sdk.getState()!;
    poisonEmit('relogged', { loginTick: r.loginTick, tickNow: s.tick, hp: s.player?.hp, poisonInView: (s.combatEvents ?? []).filter(e => e.hitmark === 2).length });
}

const stat = (xs: number[]) => (xs.length ? { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), min: Math.min(...xs), max: Math.max(...xs) } : null);

await labMain(lab);
if (poisonWatch) {
    poisonWatch.stop();
    result('S16_poison', poisonWatch.summary());
}

if (fights.length) {
    const base = (xp: number) => +(xp / 25).toFixed(1);
    console.log(`\nKolodion, ${SPELL}, base Magic ${MAGIC} (m, lab, 300 ms; from the arena landing to the cellar landing):`);
    console.log('| run | fight ticks | casts | clicks | runes | fallback (spell, from tick, runes) | air | Magic xp (base) | exit base xp | exit level | HP lost | prayer used | doses | sips | eats |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    fights.forEach((f, i) => console.log(`| ${i + 1} | ${f.ticks} | ${f.casts} | ${f.clicks} | ${f.runesUsed} | ${f.fallback ? `${f.fallback.spell}, +${f.fallback.at}, ${f.fallback.runesUsed}` : '-'} | ${f.airUsed} | ${base(f.magicXp1 - f.magicXp0)} | ${base(f.magicXp1)} | ${f.magicBase1} | ${f.hp0 - f.hpMin} | ${f.prayerUsed} | ${f.doses} | ${f.magicSips} | ${f.eats} |`));
    const summary = {
        spell: SPELL, magic: MAGIC, runs: fights.length,
        ticks: stat(fights.map(f => f.ticks)), casts: stat(fights.map(f => f.casts)), runes: stat(fights.map(f => f.runesUsed)),
        air: stat(fights.map(f => f.airUsed)), xp: stat(fights.map(f => base(f.magicXp1 - f.magicXp0))),
        exitLevel: stat(fights.map(f => f.magicBase1)), hpLost: stat(fights.map(f => f.hp0 - f.hpMin)), prayer: stat(fights.map(f => f.prayerUsed)),
    };
    console.log(JSON.stringify(summary));
    result('S16_pricing', summary);
}
