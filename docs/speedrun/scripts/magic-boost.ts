// Boosted casting for the Magic route (docs/speedrun/skills/magic.md, sections 1, 2 and 5).
//
//   bun docs/speedrun/scripts/magic-boost.ts <bot> <mode> [args]
//   NODE_TICKRATE=300 docs/speedrun/scripts/magic-lab.sh <bot> docs/speedrun/scripts/magic-boost.ts:checks
//
// Every spell's level check is `stat(magic) < levelrequired` (the boosted level, magic.rs2:22), a
// magic potion is stat_boost(magic, 4, 0) and a Wizard's mind bomb stat_boost(magic, 2, 2)
// (consume_effects.dbrow). Modes:
//
//   checks          Fire Wave (com 1189, the OPNPCT the arena run sends) on a Lumbridge chicken at
//                   base 71 without and with a magic potion, and the mind bomb cases: base 70 + potion
//                   + mind bomb in both orders, base 71 + mind bomb, base 72 + mind bomb.
//   decay [ticks]   Base 71 + one potion sip; logs every change of the boosted level for `ticks`
//                   (default 420), i.e. the stat_boost_restore soft timer (login.rs2, stat.rs2).
//   charge [bases]  For each base level (default 76,77): %magearena = 8, sip, then 5 Charge clicks
//                   (com 1193) per tick until base 99. Logs casts per tick, base and boosted level,
//                   refusals. Then the decay case: base 76 + sip, wait for the first restore tick
//                   (80 -> 79), click Charge (refused?), re-sip, click again.
//   fight [runs]    Kolodion at base 71 + potion under Protect from Magic (Prayer PRAYER, default 80,
//                   Holy Grail's level), Fire Wave every 2 ticks on the current form, re-sip whenever
//                   the boosted level is below 75. Talk and fight timed as in rs/3's
//                   quest-magearena-run.ts. After the fight: %magearena = 8 (the pool, statue and
//                   guardian are rs/3's measured 74 ticks), sip, Charge 5 per tick to 99.
//
// Setup uses staff commands (LOCAL_STAFF_LEVEL=4) and is never timed.
import { runScript } from '../../../sdk/runner';
import { converse } from '../../../speedrun/lib/converse';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import { cheat, freshKit, log, nextTick, prepare, sleep, tele, tick, waitTicks, waitUntil, xpRecorder } from './magic-lib';

const FIRE_WAVE = 1189;
const CHARGE = 1193;
const NOT_HIGH = /not high enough/i;
const [mode = 'checks', arg] = process.argv.slice(3);
const PRAYER = Number(process.env.PRAYER ?? 80);

const magic = (sdk: BotSDK) => sdk.getSkill('Magic')!;
const lvl = (sdk: BotSDK) => `${magic(sdk).level}/${magic(sdk).baseLevel}`;
const pos = (sdk: BotSDK) => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1 };
};

/** Drink one dose of the first item matching `pat` (OPHELD1, the item's Drink option). */
async function sip(sdk: BotSDK, pat: RegExp): Promise<boolean> {
    const it = sdk.getInventory().find((i) => pat.test(i.name));
    if (!it) return false;
    const op = it.optionsWithIndex.find((o) => /drink/i.test(o.text))?.opIndex ?? 1;
    await sdk.sendUseItem(it.slot, op);
    return true;
}
const POTION = /magic potion/i;
const MIND_BOMB = /mind bomb/i;

/**
 * Drink and wait until the boosted level changes, then out of the sip's own delay: potions run
 * p_delay(message_delay) (consume_effects.rs2, consume_messages.dbrow: 1 for the magic potion), and a
 * delayed player's OPNPCT is dropped (OpNpcTHandler) and Charge's p_finduid fails.
 */
async function drink(sdk: BotSDK, pat: RegExp): Promise<string> {
    const before = magic(sdk).level;
    if (!(await sip(sdk, pat))) throw new Error(`nothing matching ${pat} to drink`);
    await waitUntil(sdk, () => magic(sdk).level !== before, 4, 'boost').catch(() => {});
    await waitTicks(sdk, 3);
    return lvl(sdk);
}

async function chatSince(sdk: BotSDK): Promise<string[]> {
    return sdk.getNewChat({ types: [0] }).map((m) => m.text);
}

// ---------------------------------------------------------------- checks
const CHICKENS = { x: 3233, z: 3295 };

async function fireWaveOnce(sdk: BotSDK, label: string): Promise<string> {
    await sdk.getNewChat({ types: [0] });
    const xp0 = magic(sdk).experience;
    const npc = sdk.getNearbyNpcs().filter((n) => /chicken/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
    if (!npc) throw new Error('no chicken nearby');
    const level = lvl(sdk);
    let verdict = 'no response';
    const t0 = tick(sdk);
    let clicked = -99;
    while (tick(sdk) - t0 < 12) {
        if (tick(sdk) - clicked >= 3) {
            await sdk.sendSpellOnNpc(npc.index, FIRE_WAVE);
            clicked = tick(sdk);
        }
        if (magic(sdk).experience > xp0) {
            verdict = `CAST (+${(magic(sdk).experience - xp0) / 25} base)`;
            break;
        }
        const c = await chatSince(sdk);
        if (c.some((m) => NOT_HIGH.test(m))) {
            verdict = 'REFUSED ("Your Magic level is not high enough for this spell.")';
            break;
        }
        await sleep(20);
    }
    log(sdk, `CHECK ${label}: magic ${level} (boosted/base) -> Fire Wave ${verdict}`);
    await waitTicks(sdk, 6); // Fire Wave's 5-tick attack delay
    return verdict;
}

async function checks(sdk: BotSDK, bot: BotActions): Promise<void> {
    await freshKit(sdk, bot, 'staff_of_fire');
    await cheat(sdk, 'give bloodrune 100');
    await cheat(sdk, 'give airrune 1000');
    await cheat(sdk, 'give 4dose1magic 4');
    await cheat(sdk, 'give wizards_mind_bomb 4');
    await tele(sdk, CHICKENS.x, CHICKENS.z);
    const fresh = async (base: number) => {
        await cheat(sdk, `setstat magic ${base}`); // sets base and boosted level (Player.setLevel)
        await waitTicks(sdk, 1);
    };

    await fresh(71);
    await fireWaveOnce(sdk, 'base 71, no boost');
    log(sdk, `drink magic potion at base 71 -> ${await drink(sdk, POTION)}`);
    await fireWaveOnce(sdk, 'base 71 + magic potion');

    await fresh(70);
    log(sdk, `base 70: potion -> ${await drink(sdk, POTION)}, then mind bomb -> ${await drink(sdk, MIND_BOMB)}`);
    await fireWaveOnce(sdk, 'base 70 + potion then mind bomb');
    await fresh(70);
    log(sdk, `base 70: mind bomb -> ${await drink(sdk, MIND_BOMB)}, then potion -> ${await drink(sdk, POTION)}`);
    await fireWaveOnce(sdk, 'base 70 + mind bomb then potion');
    await fresh(71);
    log(sdk, `base 71: mind bomb -> ${await drink(sdk, MIND_BOMB)}`);
    await fireWaveOnce(sdk, 'base 71 + mind bomb');
    await fresh(72);
    log(sdk, `base 72: mind bomb -> ${await drink(sdk, MIND_BOMB)}`);
    await fireWaveOnce(sdk, 'base 72 + mind bomb');
    const lv = (n: string) => sdk.getSkill(n)!;
    log(sdk, `mind bomb side effects now: attack ${lv('Attack').level}/${lv('Attack').baseLevel}, strength ${lv('Strength').level}/${lv('Strength').baseLevel}, defence ${lv('Defence').level}/${lv('Defence').baseLevel}`);
}

// ---------------------------------------------------------------- decay
async function decay(sdk: BotSDK, bot: BotActions, ticks: number): Promise<void> {
    await freshKit(sdk, bot);
    await cheat(sdk, 'give 4dose1magic 1');
    await cheat(sdk, 'setstat magic 71');
    await waitTicks(sdk, 2);
    const before = magic(sdk).level;
    await sip(sdk, POTION);
    await waitUntil(sdk, () => magic(sdk).level !== before, 4, 'boost');
    const tDrink = tick(sdk);
    log(sdk, `DECAY drank at t=${tDrink}: ${lvl(sdk)}`);
    let last = magic(sdk).level;
    const drops: number[] = [];
    let t = tick(sdk);
    while (tick(sdk) - tDrink < ticks) {
        t = await nextTick(sdk, t);
        const l = magic(sdk).level;
        if (l !== last) {
            drops.push(t);
            log(sdk, `DECAY ${last} -> ${l} at +${t - tDrink}`, tDrink);
            last = l;
        }
    }
    const gaps = drops.slice(1).map((d, i) => d - drops[i]!);
    log(sdk, `DECAY summary: first drop +${drops[0]! - tDrink} after the sip, then gaps ${JSON.stringify(gaps)} ticks; level ${lvl(sdk)}`);
}

// ---------------------------------------------------------------- charge
/**
 * Sip a magic potion, then 5 Charge clicks every tick from the next tick until base 99. Reports the
 * ticks from the sip to the first cast (the sip's p_delay), and the casting span.
 */
async function chargeTo99(sdk: BotSDK, tag: string, maxTicks = 80) {
    const rec = xpRecorder(sdk, 'Magic');
    await sdk.getNewChat({ types: [0] });
    const before = lvl(sdk);
    await sip(sdk, POTION);
    const t0 = tick(sdk);
    let t = await nextTick(sdk, t0);
    log(sdk, `CHARGE ${tag}: sipped at t=${t0}, ${before} -> ${lvl(sdk)}`);
    let refusals = 0;
    const trace: string[] = [];
    while (magic(sdk).baseLevel < 99 && tick(sdk) - t0 < maxTicks) {
        await Promise.all(Array.from({ length: 5 }, () => sdk.sendClickComponent(CHARGE)));
        const d = sdk.getDialog();
        if (d?.isOpen && d.options.length <= 1) await sdk.sendClickDialog(d.options[0]?.index ?? 0);
        t = await nextTick(sdk, t);
        const g = rec.gains(t - 1, t)[0];
        const n = g ? g.base / 180 : 0;
        refusals += (await chatSince(sdk)).filter((m) => NOT_HIGH.test(m) || /only be learnt/i.test(m)).length;
        trace.push(`${n}@${lvl(sdk)}`);
    }
    await waitTicks(sdk, 2);
    const gains = rec.gains(t0, tick(sdk));
    rec.off();
    const casts = gains.reduce((a, g) => a + g.base, 0) / 180;
    const span = gains.length ? gains.at(-1)!.tick - gains[0]!.tick + 1 : 0;
    const firstGap = gains.length ? gains[0]!.tick - t0 : NaN;
    log(sdk, `CHARGE ${tag}: first cast ${firstGap} ticks after the sip; ${casts} casts in ${span} ticks (first to last xp tick, inclusive); sip to 99 ${firstGap + span} ticks; refusal messages ${refusals}, final ${lvl(sdk)}`);
    log(sdk, `   casts@boosted/base per tick: ${trace.join(' ')}`);
    return { casts, span, refusals, firstGap };
}

async function charge(sdk: BotSDK, bot: BotActions, bases: number[]): Promise<void> {
    await freshKit(sdk, bot, 'staff_of_fire');
    await cheat(sdk, 'setvar magearena 8');
    for (const base of bases) {
        await cheat(sdk, '~clearinv inv');
        await cheat(sdk, 'give bloodrune 2000');
        await cheat(sdk, 'give airrune 2000');
        await cheat(sdk, 'give 4dose1magic 1');
        await cheat(sdk, `setstat magic ${base}`);
        await waitTicks(sdk, 2);
        await chargeTo99(sdk, `from base ${base} + potion`);
    }

    // The decay case: the boost holds only until the next stat_boost_restore tick.
    await cheat(sdk, '~clearinv inv');
    await cheat(sdk, 'give bloodrune 100');
    await cheat(sdk, 'give airrune 100');
    await cheat(sdk, 'give 4dose1magic 1');
    await cheat(sdk, 'setstat magic 76');
    await waitTicks(sdk, 2);
    log(sdk, `DECAYCASE base 76: sip -> ${await drink(sdk, POTION)}; waiting for the restore tick`);
    const waited = await waitUntil(sdk, () => magic(sdk).level < 80, 110, 'restore tick');
    log(sdk, `DECAYCASE restore tick after ${waited} ticks: ${lvl(sdk)}`);
    const once = async (label: string) => {
        await sdk.getNewChat({ types: [0] });
        const xp0 = magic(sdk).experience;
        await sdk.sendClickComponent(CHARGE);
        await waitTicks(sdk, 2);
        const c = await chatSince(sdk);
        log(sdk, `DECAYCASE ${label} at ${lvl(sdk)}: ${magic(sdk).experience > xp0 ? 'CAST' : c.some((m) => NOT_HIGH.test(m)) ? 'REFUSED (not high enough)' : 'no response'}`);
    };
    await once('Charge after the restore tick');
    log(sdk, `DECAYCASE re-sip -> ${await drink(sdk, POTION)}`);
    await once('Charge after the re-sip');
}

// ---------------------------------------------------------------- fight
const KOLODION_SPOT = { x: 2539, z: 4715 };

async function fightOnce(sdk: BotSDK, bot: BotActions, run: number) {
    // ---- untimed setup ----
    await freshKit(sdk, bot, 'staff_of_fire');
    await cheat(sdk, 'setvar magearena 0');
    await cheat(sdk, 'setstat magic 71');
    await cheat(sdk, 'setstat hitpoints 70');
    await cheat(sdk, `setstat prayer ${PRAYER}`);
    await cheat(sdk, 'give bloodrune 300');
    await cheat(sdk, 'give airrune 3000');
    await cheat(sdk, 'give 4dose1magic 3');
    await cheat(sdk, 'give shark 5');
    await tele(sdk, KOLODION_SPOT.x, KOLODION_SPOT.z);
    await waitTicks(sdk, 3);
    const xpMagic0 = magic(sdk).experience;
    let doses = 0;

    // ---- talk to Kolodion (the sip goes first: it costs no tick, consume.rs2 potions have no delay) ----
    // The sip's p_delay(1) would drop the talk click, so the talk goes 2 ticks later (timed).
    const t0 = tick(sdk);
    await sip(sdk, POTION);
    doses++;
    await bot.activatePrayer('protect_from_magic');
    await waitTicks(sdk, 2);
    const kol = sdk.findNearbyNpc(/^Kolodion$/);
    if (!kol) throw new Error('Kolodion not found');
    await sdk.sendTalkToNpc(kol.index);
    const d1 = await converse(sdk, ['Can I fight here?', 'Yes indeedy.', "Ok, let's fight."], { idle: 4, openTicks: 4 });
    await waitUntil(sdk, () => pos(sdk).z < 4000, 60, 'arena teleport');
    const tArena = tick(sdk);
    log(sdk, `RUN ${run} talk: ${tArena - t0} ticks, ${d1.pages} pages, ${d1.options} options; magic ${lvl(sdk)}`, t0);

    // ---- the fight ----
    let casts = 0;
    let refused = 0;
    let stage = 0;
    let lastForm = -1;
    let formStart = tArena;
    let lastLevel = magic(sdk).level;
    let lastCastClick = -99;
    let lastSip = -99;
    let lastXp = magic(sdk).experience;
    let lastXpTick = -99;
    const forms: string[] = [];
    const levelLog: string[] = [];
    await sdk.getNewChat({ types: [0] });
    let t = tick(sdk);
    while (pos(sdk).z < 4600) {
        const p = sdk.getState()?.player;
        if (!p || p.isDead || pos(sdk).z < 3900 || tick(sdk) - tArena > 1500) {
            throw new Error(`fight aborted at +${tick(sdk) - tArena}: dead=${p?.isDead} pos=${JSON.stringify(pos(sdk))} casts=${casts}`);
        }
        if (!sdk.isPrayerActive('protect_from_magic') && (sdk.getSkill('Prayer')?.level ?? 0) > 0) await bot.activatePrayer('protect_from_magic');
        const m = magic(sdk);
        if (m.level !== lastLevel) {
            levelLog.push(`+${tick(sdk) - tArena}:${lastLevel}->${m.level}(base ${m.baseLevel})`);
            lastLevel = m.level;
        }
        for (const c of await chatSince(sdk)) {
            if (NOT_HIGH.test(c)) refused++;
        }
        // Re-sip once the boosted level is below Fire Wave's 75. The sip's p_delay(1) drops spell
        // clicks for 2 ticks, so sip on the tick after a cast lands (inside the 5-tick attack delay,
        // player_magic.rs2:188) when possible; if no cast has landed for 6 ticks, sip anyway.
        if (m.experience !== lastXp) {
            lastXp = m.experience;
            lastXpTick = tick(sdk);
        }
        if (m.level < 75 && tick(sdk) - lastSip > 3 && (tick(sdk) - lastXpTick <= 1 || tick(sdk) - lastXpTick >= 6)) {
            if (await sip(sdk, POTION)) {
                doses++;
                lastSip = tick(sdk);
                levelLog.push(`+${tick(sdk) - tArena}:SIP(${tick(sdk) - lastXpTick} after a cast)`);
            }
        }
        const d = sdk.getDialog();
        if (d?.isOpen && d.options.length <= 1) await sdk.sendClickDialog(d.options[0]?.index ?? 0); // level-up box
        const kols = sdk.getNearbyNpcs().filter((n) => n.name === 'Kolodion' && n.options.some((o) => /attack/i.test(o)));
        if (!kols.some((n) => n.id === 907 + stage) && kols.some((n) => n.id === 908 + stage)) stage++;
        const target = kols.find((n) => n.id === 907 + stage);
        if (target) {
            if (target.id !== lastForm) {
                if (lastForm !== -1) forms.push(`${lastForm}:${tick(sdk) - formStart}`);
                lastForm = target.id;
                formStart = tick(sdk);
            }
            // a click inside the attack delay re-queues itself (player_magic.rs2:95-97); click every 2 ticks
            if (tick(sdk) - lastCastClick >= 2) {
                await sdk.sendSpellOnNpc(target.index, FIRE_WAVE);
                casts++;
                lastCastClick = tick(sdk);
            }
        }
        t = await nextTick(sdk, t);
    }
    if (lastForm !== -1) forms.push(`${lastForm}:${tick(sdk) - formStart}(to teleport)`);
    const tBack = tick(sdk);
    const prayerLeft = sdk.getSkill('Prayer')?.level;
    await bot.deactivateAllPrayers();
    const fightXp = (magic(sdk).experience - xpMagic0) / 25;
    log(sdk, `RUN ${run} FIGHT ${tBack - tArena} ticks at base 71 + potion; cast clicks ${casts}; refusals ${refused}; doses ${doses} (incl. the pre-fight sip); prayer ${PRAYER} -> ${prayerLeft}; magic xp +${fightXp} base; magic now ${lvl(sdk)}`, t0);
    console.log(`   forms (npc:ticks) ${forms.join(' ')}`);
    console.log(`   boosted level changes ${levelLog.join(' ')}`);

    // ---- Charge straight after (pool, statue and guardian skipped: rs/3 measured them at 74 ticks) ----
    await waitTicks(sdk, 4);
    await converse(sdk, [], { idle: 4, openTicks: 4 }).catch(() => ({ pages: 0, options: 0 }));
    await cheat(sdk, 'setvar magearena 8');
    const base = magic(sdk).baseLevel;
    log(sdk, `RUN ${run} after fight: magic ${lvl(sdk)}`);
    doses++;
    const c = await chargeTo99(sdk, `run ${run}, from base ${base} + potion`);
    return { fight: tBack - tArena, talk: tArena - t0, fightXp, base, doses, charge: c.firstGap + c.span, chargeCasts: c.casts, refusals: c.refusals };
}

async function fight(sdk: BotSDK, bot: BotActions, runs: number): Promise<void> {
    const out = [];
    for (let r = 1; r <= runs; r++) {
        try {
            out.push(await fightOnce(sdk, bot, r));
        } catch (e: any) {
            log(sdk, `RUN ${r} failed: ${e?.message ?? e}`);
            await bot.deactivateAllPrayers().catch(() => {});
        }
    }
    console.log(`\nNODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}, Prayer ${PRAYER}`);
    console.log('| Run | Talk | Fight (ticks) | Fight Magic xp (base) | Base after | Potion doses (fight + Charge) | Charge casts | Charge ticks (sip to 99) | Charge refusals |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    out.forEach((o, i) => console.log(`| ${i + 1} | ${o.talk} | ${o.fight} | ${o.fightXp} | ${o.base} | ${o.doses} | ${o.chargeCasts} | ${o.charge} | ${o.refusals} |`));
}

await runScript(async ({ bot, sdk }) => {
    await prepare(sdk, bot);
    if (mode === 'checks') await checks(sdk, bot);
    else if (mode === 'decay') await decay(sdk, bot, Number(arg ?? 420));
    else if (mode === 'charge') await charge(sdk, bot, (arg ?? '76,77').split(',').map(Number));
    else if (mode === 'fight') await fight(sdk, bot, Number(arg ?? 1));
    else throw new Error(`unknown mode ${mode}`);
}, { timeout: 90 * 60_000, printState: false });
