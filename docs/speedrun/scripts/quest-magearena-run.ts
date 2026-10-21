// Mage Arena, measured end to end from Kolodion's spot in the cellar to the god staff in hand.
//
//   bun docs/speedrun/scripts/quest-magearena-run.ts <botname>
//
// Env (all optional): MAGIC (default 80), HP (70), DEF (70), GOD (saradomin|guthix|zamorak, default
// saradomin), SPELL (fire_wave|fire_blast, default fire_blast), FOOD (sharks, 20), EAT_BELOW (40),
// FIGHT_CAP (ticks, 1500), RESET=1 sets %magearena to 0 first.
// Setup uses staff commands (LOCAL_STAFF_LEVEL=4) and is not timed. Each timed segment logs its
// tick count, dialogue pages, option clicks and tiles.
import { runScript } from '../../../sdk/runner';
import { cheat, log, pos, sleep, talkThrough, tele, tick, waitTicks } from './quest-unlocks-lib';

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

    // ---- untimed setup ----
    if (process.env.RESET === '1') await cheat(sdk, 'setvar magearena 0');
    for (const it of sdk.getEquipment()) await bot.unequipItem(it);
    for (const it of sdk.getInventory()) await bot.dropItem(it);
    await cheat(sdk, `setstat magic ${MAGIC}`);
    await cheat(sdk, `setstat hitpoints ${HP}`);
    await cheat(sdk, `setstat defence ${DEF}`);
    if (PRAYER > 0) await cheat(sdk, `setstat prayer ${PRAYER}`);
    await cheat(sdk, 'give staff_of_fire 1');
    await cheat(sdk, 'give bloodrune 500');
    await cheat(sdk, 'give deathrune 500');
    await cheat(sdk, 'give airrune 5000');
    await cheat(sdk, 'give firerune 5000');
    await cheat(sdk, `give shark ${Number(process.env.FOOD ?? 20)}`);
    await waitTicks(sdk, 3);
    await bot.equipItem(/staff of fire/i);
    await tele(sdk, 2539, 4715);
    await waitTicks(sdk, 5);
    const magicXp0 = sdk.getSkill('Magic')?.experience ?? 0;
    const hpXp0 = sdk.getSkill('Hitpoints')?.experience ?? 0;

    // ---- segment 1: talk to Kolodion until the arena teleport ----
    const t0 = tick(sdk);
    if (PRAYER >= 37) await bot.activatePrayer('protect_from_magic');
    const kol = sdk.findNearbyNpc(/^Kolodion$/);
    if (!kol) throw new Error('Kolodion not found near the cellar spawn');
    await sdk.sendTalkToNpc(kol.index);
    const d1 = await talkThrough(sdk, ['Can I fight here?', 'Yes indeedy.', "Ok, let's fight."]);
    while (pos(sdk).z > 4000) await sleep(20);
    const tArena = tick(sdk);
    log(sdk, `SEG talk-kolodion: ${tArena - t0} ticks, ${d1.pages} pages, ${d1.options} options`, t0);

    // ---- segment 2: the fight ----
    let casts = 0;
    let eats = 0;
    let minHp = 999;
    let lastForm = -1;
    let stage = 0;
    let formStart = tArena;
    const forms: string[] = [];
    const FIGHT_CAP = Number(process.env.FIGHT_CAP ?? 1500);
    let lastHp = sdk.getState()?.player?.hp ?? 0;
    sdk.getNewChat({ types: [0] });
    while (pos(sdk).z < 4600) {
        const p = sdk.getState()?.player;
        if (!p || p.isDead || pos(sdk).z < 3900 || tick(sdk) - tArena > FIGHT_CAP) {
            throw new Error(`fight aborted at +${tick(sdk) - tArena}: dead=${p?.isDead} pos=${JSON.stringify(pos(sdk))} casts=${casts}`);
        }
        if (PRAYER >= 37 && !sdk.isPrayerActive('protect_from_magic') && (sdk.getSkill('Prayer')?.level ?? 0) > 0) {
            log(sdk, 'protect from magic was off; reactivating', tArena);
            await bot.activatePrayer('protect_from_magic');
        }
        if (p.hp !== lastHp) {
            log(sdk, `hp ${lastHp} -> ${p.hp}`, tArena);
            lastHp = p.hp;
        }
        for (const m of sdk.getNewChat({ types: [0] })) log(sdk, `chat: ${m.text}`, tArena);
        if (p) minHp = Math.min(minHp, p.hp);
        if (p && p.hp > 0 && p.hp < Number(process.env.EAT_BELOW ?? 40)) {
            const food = sdk.findInventoryItem(/shark/i);
            if (food) {
                await bot.eatFood(food);
                eats++;
            }
        }
        const d = sdk.getDialog();
        if (d?.isOpen && d.options.length <= 1) await sdk.sendClickDialog(d.options[0]?.index ?? 0); // level-up box
        // Forms in order: kolhuman 907, kologre 908, kolspider 909, kolethereal 910, koldemon 911.
        // Only the current stage's form is attackable; leftover forms from an aborted run are ignored.
        const kols = sdk.getNearbyNpcs().filter((n) => n.name === 'Kolodion' && n.options.some((o) => /attack/i.test(o)));
        if (!kols.some((n) => n.id === 907 + stage) && kols.some((n) => n.id === 908 + stage)) stage++;
        const target = kols.find((n) => n.id === 907 + stage);
        if (target) {
            if (target.id !== lastForm) {
                if (lastForm !== -1) forms.push(`npc ${lastForm}: ${tick(sdk) - formStart} ticks`);
                lastForm = target.id;
                formStart = tick(sdk);
                log(sdk, `form npc ${target.id} lvl ${target.combatLevel}`, tArena);
            }
            if (casts % 5 === 0) log(sdk, `target ${target.id} hp ${target.hp}/${target.maxHp} dist ${target.distance} magic xp ${sdk.getSkill('Magic')?.experience} runes ${sdk.getInventory().filter((i) => /rune/i.test(i.name)).map((i) => i.name + ' ' + i.count).join(',')} worn ${sdk.getEquipment().map((i) => i.name).join(',')}`, tArena);
            await sdk.sendSpellOnNpc(target.index, SPELL_COM[SPELL]);
            casts++;
        }
        await waitTicks(sdk, 2);
    }
    if (lastForm !== -1) forms.push(`npc ${lastForm}: ${tick(sdk) - formStart} ticks (until teleport out)`);
    const tBack = tick(sdk);
    const prayerLeft = sdk.getSkill('Prayer')?.level;
    if (PRAYER >= 37) await bot.deactivateAllPrayers();
    log(sdk, `prayer points ${PRAYER} -> ${prayerLeft}`, t0);
    log(sdk, `SEG fight: ${tBack - tArena} ticks, cast clicks ${casts}, eats ${eats}, min hp ${minHp}`, t0);
    for (const f of forms) console.log('   ' + f);
    const d2 = await talkThrough(sdk, [], { idleMs: 2500 });
    const tDone = tick(sdk);
    log(sdk, `SEG finish-dialogue: ${tDone - tBack} ticks, ${d2.pages} pages`, t0);

    // ---- segment 3: pool to the chamber ----
    const pool = sdk.findNearbyLoc(/sparkling pool/i);
    if (!pool) throw new Error('pool not found');
    const from3 = pos(sdk);
    await bot.interactLoc(pool, 'Step-into');
    while (pos(sdk).z > 4700) await sleep(20);
    await waitTicks(sdk, 1);
    const tChamber = tick(sdk);
    log(sdk, `SEG pool: ${tChamber - tDone} ticks from ${JSON.stringify(from3)} to ${JSON.stringify(pos(sdk))}`, t0);

    // ---- segment 4: pray at the statue and take the cape ----
    const st = STATUE[GOD];
    const statue = (await sdk.scanNearbyLocs(40)).find((l) => l.x === st.x && l.z === st.z);
    if (!statue) throw new Error(`statue not found at ${st.x},${st.z}`);
    const from4 = pos(sdk);
    await bot.interactLoc(statue, statue.options[0]);
    const d4 = await talkThrough(sdk, [], { idleMs: 1500 });
    let cape = null;
    for (let i = 0; i < 40 && !cape; i++) {
        cape = sdk.findGroundItem(/cape of/i);
        if (!cape) await waitTicks(sdk, 1);
    }
    if (!cape) throw new Error('no cape on the ground');
    await bot.pickupItem(cape);
    while (!sdk.findInventoryItem(/cape of/i)) await sleep(20);
    const tCape = tick(sdk);
    log(sdk, `SEG statue+cape: ${tCape - tChamber} ticks from ${JSON.stringify(from4)}, ${d4.pages} pages`, t0);

    // ---- segment 5: chamber guardian hands over the staff ----
    const guard = sdk.findNearbyNpc(/chamber guardian/i);
    if (!guard) throw new Error('guardian not found');
    const from5 = pos(sdk);
    await sdk.sendTalkToNpc(guard.index);
    const d5 = await talkThrough(sdk, [], { idleMs: 2000 });
    const staff = sdk.findInventoryItem(/staff of (saradomin|guthix|zamorak)/i);
    const tStaff = tick(sdk);
    log(sdk, `SEG guardian: ${tStaff - tCape} ticks from ${JSON.stringify(from5)}, ${d5.pages} pages, staff=${staff?.name}`, t0);

    const magicXp = (sdk.getSkill('Magic')?.experience ?? 0) - magicXp0;
    const hpXp = (sdk.getSkill('Hitpoints')?.experience ?? 0) - hpXp0;
    log(sdk, `TOTAL ${tStaff - t0} ticks (talk to staff). Fight xp: magic ${magicXp / 25} base, hp ${hpXp / 25} base`, t0);
    await cheat(sdk, 'getvar magearena');
    await waitTicks(sdk, 2);
    for (const m of sdk.getNewChat({ types: [0] })) console.log('chat:', m.text);
}, { timeout: 30 * 60_000, printState: false });
