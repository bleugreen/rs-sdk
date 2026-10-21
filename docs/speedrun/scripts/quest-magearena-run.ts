// Mage Arena, measured end to end from Kolodion's spot in the cellar to the god staff in hand.
//
//   bun docs/speedrun/scripts/quest-magearena-run.ts <botname>
//
// Env (all optional): MAGIC (default 80), HP (70), DEF (70), GOD (saradomin|guthix|zamorak, default
// saradomin), SPELL (fire_wave|fire_blast, default fire_blast), FOOD (sharks, 20), EAT_BELOW (40),
// FIGHT_CAP (ticks, 1500), RESET=1 sets %magearena to 0 first.
// Setup uses staff commands (LOCAL_STAFF_LEVEL=4) and is not timed. Each timed segment logs its
// tick count, dialogue pages, option clicks and tiles. A segment ends at its last effect (a
// teleport landing, a dialogue closing, the cape in hand), not after a dialogue's close is confirmed.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyNpc } from '../../../sdk/types';
import { opLoc, pickup, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, findNpc, invItem, messagesSince, npcByIndex, opIndex, pos, skillLevel, skillXp, worn } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, dropMatching, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const MAGIC = Number(process.env.MAGIC ?? 80);
const HP = Number(process.env.HP ?? 70);
const DEF = Number(process.env.DEF ?? 70);
const GOD = process.env.GOD ?? 'saradomin';
// Kolodion's Flames of Zamorak drains Magic by 1 + 5% per hit, stacking, so without Protect from
// Magic Fire Wave (75) is refused after two hits at 80 Magic. Every Kolodion attack is a spell, so
// PRAYER >= 37 (Protect from Magic) blocks all damage and drains. PRAYER=0 fights without it.
const PRAYER = Number(process.env.PRAYER ?? 70);
const SPELL = process.env.SPELL ?? (PRAYER >= 37 ? 'fire_wave' : 'fire_blast');
const SPELL_COM: Record<string, number> = { fire_wave: 1189, fire_blast: 1181 };
const STATUE: Record<string, { x: number; z: number }> = {
    saradomin: { x: 2500, z: 4721 },
    guthix: { x: 2507, z: 4724 },
    zamorak: { x: 2516, z: 4721 },
};

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    const log = (msg: string, t0?: number) => { const t = currentTick(sdk); console.log(`[t=${t}${t0 !== undefined ? ` +${t - t0}` : ''}] ${msg}`); };

    // ---- untimed setup ----
    // FROM=pool resumes a run whose fight finished (%magearena = 6) at the cellar pool.
    const FROM = process.env.FROM ?? 'kolodion';
    const rec = new Recorder(sdk, `Mage Arena (from ${FROM}, Magic ${MAGIC}, HP ${HP}, Def ${DEF}, Prayer ${PRAYER}, ${SPELL}, ${GOD})`);
    let t0 = currentTick(sdk);
    let magicXp0 = skillXp(sdk, 'magic');
    let hpXp0 = skillXp(sdk, 'hitpoints');
    if (FROM === 'kolodion') {
        if (process.env.RESET === '1') await setvar(sdk, 'magearena', 0);
        await clearInventory(sdk);
        await setStats(sdk, { magic: MAGIC, hitpoints: HP, defence: DEF, ...(PRAYER > 0 ? { prayer: PRAYER } : {}) });
        await give(sdk, 'staff_of_fire', 1);
        await give(sdk, ['bloodrune', 'deathrune'], 500);
        await give(sdk, ['airrune', 'firerune'], 5000);
        await give(sdk, 'shark', Number(process.env.FOOD ?? 20));
        await waitTicks(sdk, 3);
        await wield(sdk, /staff of fire/i);
        await mustTele(sdk, 2539, 4715);
        await waitTicks(sdk, 5);

        // ---- segment 1: talk to Kolodion until the arena teleport ----
        magicXp0 = skillXp(sdk, 'magic');
        hpXp0 = skillXp(sdk, 'hitpoints');
        t0 = currentTick(sdk);
        rec.begin('talk-kolodion', 'dialogue');
        if (PRAYER >= 37) await bot.activatePrayer('protect_from_magic');
        const kol = findNpc(sdk, /^Kolodion$/);
        if (!kol) throw new Error('Kolodion not found near the cellar spawn');
        const d1 = await talkTo(sdk, kol, ['Can I fight here?', 'Yes indeedy.', "Ok, let's fight."], { until: s => pos(s).z < 4000 });
        rec.interact(d1.clicks);
        if (!d1.ok) throw new Error(`timed out waiting for: arena teleport (${d1.reason})`);
        rec.dialogue(d1);
        rec.end();

        // ---- segment 2: the fight ----
        rec.begin('fight', 'fight');
        const tArena = currentTick(sdk);
        const FIGHT_CAP = Number(process.env.FIGHT_CAP ?? 1500);
        const EAT_BELOW = Number(process.env.EAT_BELOW ?? 40);
        let casts = 0;
        let eats = 0;
        let minHp = 999;
        let stage = 0;
        let lastHp = sdk.getState()?.player?.hp ?? 0;
        const forms: string[] = [];
        sdk.getNewChat({ types: [0] });
        const back = (s: BotWorldState) => pos(s).z >= 4600; // finish_mage_arena teleports you to the cellar
        const lost = (s: BotWorldState) => pos(s).z < 3900;
        // Forms in order: kolhuman 907, kologre 908, kolspider 909, kolethereal 910, koldemon 911.
        // Only the current stage's form is attackable; leftover forms from an aborted run are ignored.
        const kolodions = (s: BotWorldState) => s.nearbyNpcs.filter((n) => n.name === 'Kolodion' && n.hp !== 0 && opIndex(n, /attack/i) !== undefined);
        const current = (s: BotWorldState): NearbyNpc | undefined => {
            const kols = kolodions(s);
            if (!kols.some((n) => n.id === 907 + stage) && kols.some((n) => n.id === 908 + stage)) stage++;
            return kols.find((n) => n.id === 907 + stage);
        };
        while (!back(sdk.getState()!)) {
            const elapsed = currentTick(sdk) - tArena;
            if (elapsed > FIGHT_CAP) throw new Error(`fight aborted at +${elapsed}: pos=${JSON.stringify(pos(sdk))} casts=${casts}`);
            const w = await waitUntil(sdk, (s) => back(s) || current(s) !== undefined, { maxTicks: FIGHT_CAP - elapsed });
            if (!w.ok) throw new Error(`fight aborted at +${currentTick(sdk) - tArena}: no target; stage ${stage}; kolodions ${JSON.stringify(kolodions(sdk.getState()!).map((n) => [n.id, n.x, n.z, n.hp]))} pos ${JSON.stringify(pos(sdk))}`);
            if (back(w.state)) break;
            const target = current(w.state)!;
            log(`form npc ${target.id} lvl ${target.combatLevel}`, tArena);
            const f = await fight(sdk, target, {
                spell: SPELL_COM[SPELL], castEvery: 2,
                food: /shark/i, eatBelow: EAT_BELOW,
                ...(PRAYER >= 37 ? { prayer: 'protect_from_magic' as const } : {}),
                onDialog: 'continue',
                maxTicks: FIGHT_CAP - elapsed,
                // also over when this form changes type in place: the next form is fought by its own id
                done: (s) => back(s) || lost(s) || (npcByIndex(s, target.index)?.id ?? target.id) !== target.id,
                onTick: (s, t) => {
                    const hp = s.player?.hp ?? 0;
                    if (hp !== lastHp) { log(`hp ${lastHp} -> ${hp}`, tArena); lastHp = hp; }
                    for (const m of sdk.getNewChat({ types: [0] })) log(`chat: ${m.text}`, tArena);
                    if (t && (s.tick - tArena) % 10 === 0) log(`target ${t.id} hp ${t.hp}/${t.maxHp} dist ${t.distance} magic xp ${skillXp(s, 'magic')} runes ${s.inventory.filter((i) => /rune/i.test(i.name)).map((i) => i.name + ' ' + i.count).join(',')} worn ${s.equipment.map((i) => i.name).join(',')}`, tArena);
                },
            });
            casts += f.attacks;
            eats += f.eats;
            minHp = Math.min(minHp, f.minHp);
            const out = back(sdk.getState()!);
            forms.push(`npc ${target.id}: ${f.ticks} ticks${out ? ' (until teleport out)' : ''}`);
            if (f.died || f.end === 'timeout' || lost(sdk.getState()!)) {
                throw new Error(`fight aborted at +${currentTick(sdk) - tArena}: end=${f.end} pos=${JSON.stringify(pos(sdk))} casts=${casts}`);
            }
        }
        rec.mark();
        rec.interact(casts + eats);
        const prayerLeft = skillLevel(sdk, 'prayer');
        log(`prayer points ${PRAYER} -> ${prayerLeft}`, t0);
        rec.note(`cast clicks ${casts}, eats ${eats}, min hp ${minHp}`);
        for (const f of forms) console.log('   ' + f);
        // finish_mage_arena: p_delay(3) + teleport + p_delay(2), then Kolodion's congratulations
        rec.begin('finish-dialogue', 'dialogue');
        if (PRAYER >= 37) await bot.deactivateAllPrayers();
        const d2 = await converse(sdk, [], { openTicks: 30 });
        if (!d2.opened) throw new Error('timed out waiting for: finish dialogue');
        rec.dialogue(d2);
        rec.end();
    } else {
        // pool: Kolodion's spot after the fight; guardian: where pray_at_statue leaves you (Saradomin)
        if (FROM === 'pool') await mustTele(sdk, 2540, 4716);
        else {
            await setvar(sdk, 'magearena', 7);
            await dropMatching(sdk, [/shark|staff of (saradomin|guthix|zamorak)/i]);
            if (!invItem(sdk, /cape of/i) && !worn(sdk, /cape of/i)) await give(sdk, `${GOD}_cape`, 1);
            await mustTele(sdk, 2500, 4719);
        }
        t0 = currentTick(sdk);
    }
    log(`dialog before pool: ${JSON.stringify(sdk.getState()?.dialog)}`);

    if (FROM !== 'guardian') {
        // ---- segment 3: pool to the chamber ----
        rec.begin('pool', 'mixed');
        const pool = await findLoc(sdk, { name: /sparkling pool/i });
        if (!pool) throw new Error('pool not found');
        const from3 = pos(sdk);
        rec.interact();
        // mage_arena.rs2: a mesbox opens before the jump once %magearena >= 6
        const r3 = await opLoc(sdk, pool, 'Step-into', (s) => s.dialog.isOpen, { maxTicks: 60 });
        log(`pool interact: ok=${r3.ok} ticks=${r3.ticks} resends=${r3.resends}`);
        if (!r3.ok) throw new Error('timed out waiting for: pool mesbox');
        const d3 = await converse(sdk, [], { until: (s) => pos(s).z < 4700, maxTicks: 80 });
        if (!d3.ok) throw new Error(`timed out waiting for: arrive in the chamber (${d3.reason})`);
        rec.dialogue(d3);
        log(`pool mesbox pages ${d3.pages}`);
        await waitTicks(sdk, 1);
        rec.end(`from ${JSON.stringify(from3)} to ${JSON.stringify(pos(sdk))}`);

        // ---- segment 4: pray at the statue and take the cape ----
        rec.begin('statue+cape', 'mixed');
        const st = STATUE[GOD];
        if (!st) throw new Error(`unknown GOD=${GOD}`);
        const statue = await findLoc(sdk, { x: st.x, z: st.z, radius: 40 });
        if (!statue) throw new Error(`statue not found at ${st.x},${st.z}`);
        const from4 = pos(sdk);
        const t4 = currentTick(sdk);
        rec.interact();
        const r4 = await opLoc(sdk, statue, statue.options[0]!, (s) => s.dialog.isOpen, { maxTicks: 60 });
        log(`statue ${statue.id} options ${statue.options.join('/')} interact: ok=${r4.ok} ticks=${r4.ticks}`);
        if (!r4.ok) throw new Error('timed out waiting for: statue mesbox');
        // idle 1: the cape drop follows at once, so the close is confirmed after one tick
        rec.dialogue(await converse(sdk, [], { idle: 1 }));
        let cape = null;
        for (let i = 0; i < 40 && !cape; i++) {
            cape = (await sdk.scanGroundItems(15)).find((g) => /cape of/i.test(g.name)) ?? null;
            if (!cape) await waitTicks(sdk, 1);
        }
        for (const m of messagesSince(sdk, t4)) log(`chat: ${m}`);
        if (!cape) {
            log(`pos ${JSON.stringify(pos(sdk))} ground ${JSON.stringify(sdk.getGroundItems().map((g) => [g.name, g.x, g.z]))} recent dialogs ${JSON.stringify(sdk.getState()?.recentDialogs?.slice(-3))}`);
            throw new Error('no cape on the ground');
        }
        rec.interact();
        if (!(await pickup(sdk, /cape of/i, { maxTicks: 30 })).ok) throw new Error('timed out waiting for: cape in inventory');
        rec.mark();
        rec.end(`from ${JSON.stringify(from4)}`);
    }

    // ---- segment 5: chamber guardian hands over the staff ----
    rec.begin('guardian', 'dialogue');
    const from5 = pos(sdk);
    let guard = findNpc(sdk, /chamber guardian/i);
    if (!guard) {
        await walkTo(bot, sdk, 2506, 4699, 2);
        guard = findNpc(sdk, /chamber guardian/i);
    }
    if (!guard) throw new Error('guardian not found');
    const d5 = await talkTo(sdk, guard, [], { openTicks: 60 });
    rec.interact(d5.clicks);
    if (!d5.opened) throw new Error('timed out waiting for: guardian dialogue');
    rec.dialogue(d5);
    const staff = invItem(sdk, /staff of (saradomin|guthix|zamorak)/i);
    rec.end(`from ${JSON.stringify(from5)}, staff=${staff?.name}`);

    const magicXp = skillXp(sdk, 'magic') - magicXp0;
    const hpXp = skillXp(sdk, 'hitpoints') - hpXp0;
    log(`TOTAL ${rec.total().ticks} ticks (talk to staff). Fight xp: magic ${magicXp / 25} base, hp ${hpXp / 25} base`, t0);
    log(`magearena = ${await getvar(sdk, 'magearena')}`);
    for (const m of sdk.getNewChat({ types: [0] })) console.log('chat:', m.text);
    rec.report();
}, { timeout: 30 * 60_000, printState: false });
