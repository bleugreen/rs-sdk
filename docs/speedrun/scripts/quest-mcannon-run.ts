// Dwarf Cannon, measured segment by segment from %mcannon = 0 to quest complete (%mcannon = 11).
//
//   bun docs/speedrun/scripts/quest-mcannon-run.ts <botname>
//
// Env: CRAFT (default 60), SMITH (default 60) set the levels the railing and repair rolls use
// (stat_random reads the current level). Teleports between areas are staff ::tele to the spell's
// landing tile and are NOT in the segment ticks; add the measured teleport primitive (4 ticks) per
// teleport. Each segment prints ticks, dialogue pages, option clicks, route tiles and rolls.
import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import { cheat, clock, log, pos, talkThrough, tele, tick, waitTicks, waitUntil } from './quest-unlocks-lib';

const CRAFT = Number(process.env.CRAFT ?? 60);
const SMITH = Number(process.env.SMITH ?? 60);
const ARDOUGNE = [2661, 3301];
const FALADOR = [2965, 3378];
const LAWGOF = [2571, 3463];
// railing locs mcannonrailing1..6 (loc ids 15..20, bits 5..10 of %mcannonmulti), from maps m39_54 / m40_54
const RAILINGS: [number, number, number][] = [[2556, 3475, 15], [2558, 3472, 16], [2557, 3464, 17], [2559, 3462, 18], [2564, 3460, 19], [2572, 3460, 20]];

type Seg = { name: string; ticks: number; pages: number; options: number; tiles: number; note?: string };
const segs: Seg[] = [];

async function routeTiles(sdk: BotSDK, x: number, z: number): Promise<number> {
    const p = sdk.findPath(x, z);
    if (!p.success) return -1;
    // waypoints are turn points: sum the Chebyshev steps between them
    let { x: px, z: pz } = pos(sdk);
    let n = 0;
    for (const w of p.waypoints) {
        n += Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
        px = w.x;
        pz = w.z;
    }
    return n;
}

async function walk(bot: BotActions, sdk: BotSDK, x: number, z: number, tol = 1): Promise<number> {
    const tiles = await routeTiles(sdk, x, z);
    const e0 = sdk.getState()?.player?.runEnergy;
    const r = await bot.walkTo(x, z, tol);
    if (!r.success) throw new Error(`walk to ${x},${z} failed: ${r.message}`);
    log(sdk, `walk to ${x},${z}: ${tiles} route tiles, run energy ${e0} -> ${sdk.getState()?.player?.runEnergy}`);
    return tiles;
}

async function talk(bot: BotActions, sdk: BotSDK, name: RegExp, choices: string[] = []): Promise<{ pages: number; options: number }> {
    const npc = sdk.findNearbyNpc(name);
    if (!npc) throw new Error(`npc ${name} not found near ${JSON.stringify(pos(sdk))}`);
    await sdk.sendTalkToNpc(npc.index);
    await waitUntil(sdk, () => sdk.getDialog()?.isOpen === true, 40, `dialogue with ${name}`);
    return talkThrough(sdk, choices, { idleMs: 800 });
}

async function locAt(sdk: BotSDK, x: number, z: number, name?: RegExp) {
    const locs = await sdk.scanNearbyLocs(20);
    return locs.find((l) => l.x === x && l.z === z && (!name || name.test(l.name))) ?? null;
}

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    // ---- untimed setup ----
    await cheat(sdk, 'setvar mcannon 0');
    await cheat(sdk, 'setvar mcannonmulti 0');
    await cheat(sdk, `setstat crafting ${CRAFT}`);
    await cheat(sdk, `setstat smithing ${SMITH}`);
    await cheat(sdk, 'setstat hitpoints 70');
    for (const it of sdk.getEquipment()) await bot.unequipItem(it);
    for (const it of sdk.getInventory()) await bot.dropItem(it);
    // FROM=shed starts at stage 6 (toolkit in hand, railings done) beside the shed door
    const FROM = process.env.FROM ?? 'start';
    if (FROM === 'shed') {
        await cheat(sdk, 'setvar mcannon 6');
        await cheat(sdk, 'setvar mcannonmulti 2016');
        await cheat(sdk, 'give mcannontoolkit 1');
        await tele(sdk, 2574, 3462);
    } else {
        await tele(sdk, ARDOUGNE[0], ARDOUGNE[1]);
    }
    const tStart = clock(sdk);
    let t = clock(sdk);
    const seg = (name: string, d: { pages?: number; options?: number; tiles?: number; note?: string }) => {
        const s: Seg = { name, ticks: clock(sdk) - t, pages: d.pages ?? 0, options: d.options ?? 0, tiles: d.tiles ?? 0, note: d.note };
        segs.push(s);
        log(sdk, `SEG ${name}: ${s.ticks} ticks, ${s.pages} pages, ${s.options} options, ${s.tiles} tiles${s.note ? ', ' + s.note : ''}`, tStart);
        t = clock(sdk);
    };

    let tiles = 0;
    let d = { pages: 0, options: 0 };
    let pages = 0;
    let opts = 0;
    if (FROM === 'start') {
    // 1. Ardougne teleport landing -> Commander Lawgof, start
    tiles = await walk(bot, sdk, LAWGOF[0], LAWGOF[1] - 2, 2);
    seg('walk ardougne->lawgof', { tiles });
    d = await talk(bot, sdk, /dwarf commander|lawgof/i, ["Yeah, I'd love to help."]);
    seg('lawgof start (6 railings)', d);

    // 2. the six railings
    let tries = 0;
    tiles = 0;
    for (const [rx, rz, rid] of RAILINGS) {
        for (let attempt = 0; attempt < 12; attempt++) {
            const rail = (await sdk.scanNearbyLocs(25)).find((l) => l.x === rx && l.z === rz && l.id === rid) ?? null;
            if (!rail) throw new Error(`railing not found at ${rx},${rz}`);
            sdk.getNewChat({ types: [0] });
            const r = await bot.interactLoc(rail, 'Inspect');
            if (!r.success) throw new Error(`railing ${rx},${rz}: ${r.message}`);
            await waitUntil(sdk, () => sdk.getDialog()?.isOpen === true, 20, 'railing choice');
            const dd = await talkThrough(sdk, ['Try to replace the railing.'], { keepIdle: true, idleTicks: 1 });
            pages += dd.pages;
            opts += dd.options;
            tries++;
            // railings.rs2: if_close, p_delay(2), roll; success then p_delay(2) before the bit is set
            const msgs: string[] = [];
            await waitUntil(sdk, () => {
                msgs.push(...sdk.getNewChat({ types: [0] }).map((m) => m.text));
                return msgs.some((m) => /no problems|fail and cut/i.test(m));
            }, 20, 'railing result');
            if (msgs.some((m) => /no problems/i.test(m))) {
                await waitTicks(sdk, 3);
                break;
            }
        }
    }
    seg('six railings', { pages, options: opts, note: `${tries} tries for 6 railings at Crafting ${CRAFT}` });
    tiles = await walk(bot, sdk, LAWGOF[0], LAWGOF[1] - 2, 2);
    d = await talk(bot, sdk, /dwarf commander|lawgof/i);
    seg('lawgof railings done', { ...d, tiles });

    // 3. watchtower: ladder 2570,3441 up to level 1 and 2, take the remains (2567,3444 level 2)
    tiles = await walk(bot, sdk, 2570, 3442, 1);
    let ladder = await locAt(sdk, 2570, 3441, /ladder/i);
    if (!ladder) throw new Error('watchtower ladder not found');
    await bot.interactLoc(ladder, 'Climb-up');
    await waitUntil(sdk, () => pos(sdk).level === 1, 20, 'tower level 1');
    let up2 = (await sdk.scanNearbyLocs(8)).find((l) => /ladder/i.test(l.name) && l.options.some((o) => /climb-up/i.test(o)));
    if (!up2) throw new Error('level-1 ladder not found');
    const r2 = await bot.interactLoc(up2, 'Climb-up');
    if (sdk.getDialog()?.isOpen) await talkThrough(sdk, [/Climb up/i] as any, { idleMs: 500 });
    await waitUntil(sdk, () => pos(sdk).level === 2, 20, 'tower level 2');
    const remains = (await sdk.scanGroundItems(10)).find((g) => /dwarf remains/i.test(g.name));
    if (!remains) throw new Error('dwarf remains not found');
    await bot.pickupItem(remains);
    await waitUntil(sdk, () => !!sdk.findInventoryItem(/dwarf remains/i), 20, 'remains in inventory');
    for (const lv of [1, 0]) {
        const down = (await sdk.scanNearbyLocs(8)).find((l) => /ladder/i.test(l.name) && l.options.some((o) => /climb-down/i.test(o)));
        if (!down) throw new Error(`down ladder not found on level ${lv + 1}`);
        await bot.interactLoc(down, 'Climb-down');
        if (sdk.getDialog()?.isOpen) await talkThrough(sdk, [/Climb down/i] as any, { idleMs: 500 });
        await waitUntil(sdk, () => pos(sdk).level === lv, 20, `tower level ${lv}`);
    }
    seg('watchtower remains', { tiles, note: '4 ladder climbs + 1 pickup' });
    tiles = await walk(bot, sdk, LAWGOF[0], LAWGOF[1] - 2, 2);
    d = await talk(bot, sdk, /dwarf commander|lawgof/i);
    seg('lawgof remains', { ...d, tiles });

    // 4. goblin cave: entrance 2622,3392 -> 2620,9797; crate 2571,9850; mud pile 2621,9796
    tiles = await walk(bot, sdk, 2623, 3394, 2);
    const cave = (await sdk.scanNearbyLocs(8)).find((l) => /cave entrance/i.test(l.name));
    if (!cave) throw new Error('cave entrance not found');
    await bot.interactLoc(cave, 'Enter');
    await waitUntil(sdk, () => pos(sdk).z > 9000, 20, 'inside the cave');
    seg('walk lawgof->cave + enter', { tiles });
    tiles = await walk(bot, sdk, 2571, 9849, 1);
    const crate = await locAt(sdk, 2571, 9850, /crate/i);
    if (!crate) throw new Error('crate not found');
    await bot.interactLoc(crate, 'Search');
    await waitUntil(sdk, () => sdk.getDialog()?.isOpen === true, 20, 'child dialogue');
    d = await talkThrough(sdk, [], { idleMs: 1000 });
    seg('cave crate + lollk', { ...d, tiles });
    tiles = await walk(bot, sdk, 2620, 9797, 1);
    const mud = (await sdk.scanNearbyLocs(8)).find((l) => /mud pile/i.test(l.name));
    if (!mud) throw new Error('mud pile not found');
    await bot.interactLoc(mud, 'Climb-over');
    await waitUntil(sdk, () => pos(sdk).z < 4000, 20, 'out of the cave');
    const tiles2 = await walk(bot, sdk, LAWGOF[0], LAWGOF[1] - 2, 2);
    d = await talk(bot, sdk, /dwarf commander|lawgof/i, ["Ok, I'll see what I can do."]);
    seg('mud pile + walk + lawgof toolkit', { ...d, tiles: tiles + tiles2 });
    }

    // 5. the shed: door 2576,3461, broken cannon 2577,3461 (3x3)
    pages = 0;
    opts = 0;
    let inspects = 0;
    let fixTries = 0;
    const door = await locAt(sdk, 2576, 3461, /door/i);
    if (door) await bot.openDoor(door);
    // mcannon_broken_cannon.rs2: first inspect -> chatplayer (stage 7); later inspects roll
    // "find the problem" (two mes + p_delay(3), then a 5-way menu) and each part fix rolls again
    // (p_delay(2)); with all four bits set the next inspect says it is in working order (stage 8).
    const parts = ['Pipe', 'Barrel', 'Axle', 'Shaft'];
    let partIdx = 0;
    let findFails = 0;
    let fixFails = 0;
    let done = false;
    const dialogText = () => (sdk.getDialog()?.allComponents ?? []).map((c) => c.text).join(' ');
    for (let i = 0; i < 40 && !done; i++) {
        const cannon = (await sdk.scanNearbyLocs(10)).find((l) => /broken multicannon/i.test(l.name));
        if (!cannon) throw new Error('broken cannon not found');
        sdk.getNewChat({ types: [0] });
        const msgs: string[] = [];
        await bot.interactLoc(cannon, 'Inspect');
        inspects++;
        await waitUntil(sdk, () => {
            msgs.push(...sdk.getNewChat({ types: [0] }).map((m) => m.text));
            return sdk.getDialog()?.isOpen === true || msgs.some((m) => /can't quite find/i.test(m));
        }, 15, 'cannon inspect result');
        if (msgs.some((m) => /can't quite find/i.test(m))) {
            findFails++;
            continue;
        }
        const dlg = sdk.getDialog()!;
        if (dlg.options.length > 1) {
            const dd = await talkThrough(sdk, [parts[partIdx]], { keepIdle: true, idleTicks: 1 });
            opts += dd.options;
            fixTries++;
            await waitUntil(sdk, () => {
                msgs.push(...sdk.getNewChat({ types: [0] }).map((m) => m.text));
                return msgs.some((m) => /manage to fix it|fail to fix it|already fixed/i.test(m));
            }, 15, 'part fix result');
            if (msgs.some((m) => /manage to fix it|already fixed/i.test(m))) {
                partIdx++;
                await waitTicks(sdk, 3); // p_delay(2) after a successful fix
            } else fixFails++;
        } else {
            if (/working order/i.test(dialogText())) done = true;
            const dd = await talkThrough(sdk, []);
            pages += dd.pages;
        }
    }
    if (!done) throw new Error(`cannon not repaired after ${inspects} inspects (${partIdx} parts)`);
    seg('shed: inspect + repair 4 parts', { pages, options: opts, note: `${inspects} inspects (${findFails} failed to find the problem), ${fixTries} part attempts (${fixFails} failed) at Smithing ${SMITH} / Crafting ${CRAFT}` });
    tiles = await walk(bot, sdk, LAWGOF[0], LAWGOF[1] - 2, 2);
    d = await talk(bot, sdk, /dwarf commander|lawgof/i, ['Ok then, just for you!']);
    seg('lawgof repaired', { ...d, tiles });

    // 6. Nulodion at the Black Guard base (3011,3453), door 3015,3453
    await tele(sdk, FALADOR[0], FALADOR[1]);
    t = clock(sdk);
    tiles = await walk(bot, sdk, 3016, 3453, 1);
    const ndoor = await locAt(sdk, 3015, 3453, /door/i);
    if (ndoor) await bot.openDoor(ndoor);
    const tiles3 = await walk(bot, sdk, 3012, 3453, 2);
    d = await talk(bot, sdk, /nulodion|cannon engineer/i);
    seg('falador landing -> nulodion (notes + mould)', { ...d, tiles: tiles + tiles3, note: 'plus 1 teleport' });

    // 7. back to Lawgof, quest complete
    await tele(sdk, ARDOUGNE[0], ARDOUGNE[1]);
    t = clock(sdk);
    tiles = await walk(bot, sdk, LAWGOF[0], LAWGOF[1] - 2, 2);
    d = await talk(bot, sdk, /dwarf commander|lawgof/i);
    await waitTicks(sdk, 3);
    if (sdk.getDialog()?.isOpen) {
        const q = await talkThrough(sdk, [], { idleMs: 800 }); // quest complete scroll
        d.pages += q.pages;
    }
    seg('ardougne landing -> lawgof (complete)', { ...d, tiles, note: 'plus 1 teleport' });

    await cheat(sdk, 'getvar mcannon');
    await waitTicks(sdk, 2);
    for (const m of sdk.getNewChat({ types: [0] }).slice(-4)) console.log('chat:', m.text);
    const sum = segs.reduce((a, s) => ({ ticks: a.ticks + s.ticks, pages: a.pages + s.pages, options: a.options + s.options, tiles: a.tiles + s.tiles }), { ticks: 0, pages: 0, options: 0, tiles: 0 });
    console.log(`TOTAL ${sum.ticks} ticks (excluding 2 teleports), ${sum.pages} pages, ${sum.options} options, ${sum.tiles} tiles`);
    console.log('crafting xp', sdk.getSkill('Crafting')?.experience);
}, { timeout: 30 * 60_000, printState: false });
