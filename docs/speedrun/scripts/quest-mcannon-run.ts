// Dwarf Cannon, measured segment by segment from %mcannon = 0 to quest complete (%mcannon = 11).
//
//   bun docs/speedrun/scripts/quest-mcannon-run.ts <botname>
//
// Env: CRAFT (default 60), SMITH (default 60) set the levels the railing and repair rolls use
// (stat_random reads the current level). Teleports between areas are staff ::tele to the spell's
// landing tile and are NOT in the segment ticks; add the measured teleport primitive (4 ticks) per
// teleport. Each segment prints ticks, dialogue pages, option clicks, route tiles (the SDK route
// finder's length of each walk, in the note and as routeTiles) and rolls. A segment ends at its
// last effect (a dialogue closing, a roll's message, an arrival), not after a dialogue's close is
// confirmed.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { opLoc, openDoor, pickup, talkTo, walkTo } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { pageText, type OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, waitOrThrow, waitTicks, type Pred } from '../../../speedrun/lib/wait';
import { findLoc, messagesSince, pos, routeTiles, skillXp, type LocQuery } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const CRAFT = Number(process.env.CRAFT ?? 60);
const SMITH = Number(process.env.SMITH ?? 60);
const ARDOUGNE = [2661, 3301] as const;
const FALADOR = [2965, 3378] as const;
const LAWGOF = [2571, 3463] as const;
const LAWGOF_RE = /dwarf commander|lawgof/i;
// railing locs mcannonrailing1..6 (loc ids 15..20, bits 5..10 of %mcannonmulti), from maps m39_54 / m40_54
const RAILINGS: [number, number, number][] = [[2556, 3475, 15], [2558, 3472, 16], [2557, 3464, 17], [2559, 3462, 18], [2564, 3460, 19], [2572, 3460, 20]];

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    // ---- untimed setup ----
    await setvar(sdk, 'mcannon', 0);
    await setvar(sdk, 'mcannonmulti', 0);
    await setStats(sdk, { crafting: CRAFT, smithing: SMITH, hitpoints: 70 });
    await clearInventory(sdk);
    // FROM=shed starts at stage 6 (toolkit in hand, railings done) beside the shed door
    const FROM = process.env.FROM ?? 'start';
    if (FROM === 'shed') {
        await setvar(sdk, 'mcannon', 6);
        await setvar(sdk, 'mcannonmulti', 2016);
        await give(sdk, 'mcannontoolkit', 1);
        await mustTele(sdk, 2574, 3462);
    } else {
        await mustTele(sdk, ARDOUGNE[0], ARDOUGNE[1]);
    }
    const tStart = currentTick(sdk);
    const log = (msg: string) => { const t = currentTick(sdk); console.log(`[t=${t} +${t - tStart}] ${msg}`); };
    const rec = new Recorder(sdk, `Dwarf Cannon (Crafting ${CRAFT}, Smithing ${SMITH}, from ${FROM})`);

    let route = 0; // route tiles of the open segment's walks
    const begin = (name: string, kind?: string) => { route = 0; rec.begin(name, kind); };
    const end = (note?: string) => {
        if (rec.cur) rec.cur.routeTiles = route;
        rec.end([`route ${route} tiles`, note].filter(Boolean).join('; '));
    };
    const walk = async (x: number, z: number, tol = 1) => {
        const p = sdk.findPath(x, z);
        const tiles = p.success ? routeTiles(pos(sdk), p.waypoints) : -1;
        const e0 = sdk.getState()?.player?.runEnergy;
        const r = await walkTo(bot, sdk, x, z, tol);
        if (!r.ok) throw new Error(`walk to ${x},${z} failed: ${r.message}`);
        log(`walk to ${x},${z}: ${tiles} route tiles, run energy ${e0} -> ${sdk.getState()?.player?.runEnergy}`);
        route += tiles;
        rec.mark();
    };
    const talk = async (npc: RegExp, choices: OptionPattern[] = []) => {
        const r = await talkTo(sdk, npc, choices, { openTicks: 40 });
        rec.interact(r.clicks);
        if (!r.opened) throw new Error(`timed out waiting for: dialogue with ${npc}`);
        if (!r.ok) throw new Error(`dialogue with ${npc}: ${r.reason}`);
        rec.dialogue(r);
    };
    const locOrThrow = async (q: LocQuery, what: string) => {
        const l = await findLoc(sdk, q);
        if (!l) throw new Error(`${what} not found near ${JSON.stringify(pos(sdk))}`);
        return l;
    };
    /** Op a loc and wait for `done`, the segment's effect. */
    const op = async (q: LocQuery, option: string | RegExp, done: Pred, what: string, maxTicks = 20) => {
        const l = await locOrThrow(q, what);
        rec.interact();
        if (!(await opLoc(sdk, l, option, done, { maxTicks })).ok) throw new Error(`timed out waiting for: ${what}`);
        rec.mark();
    };
    /** Climb a tower ladder; a ladder offering both ways asks first ("Climb up" / "Climb down"). */
    const climb = async (option: RegExp, answer: RegExp, level: number) => {
        const there = (s: BotWorldState) => pos(s).level === level;
        const l = await locOrThrow({ name: /ladder/i, op: option, radius: 8 }, `ladder to level ${level}`);
        rec.interact();
        await opLoc(sdk, l, option, s => there(s) || s.dialog.isOpen, { maxTicks: 20 });
        if (sdk.getState()!.dialog.isOpen) rec.dialogue(await converse(sdk, [answer], { until: there }));
        rec.mark((await waitOrThrow(sdk, there, 20, `tower level ${level}`)).tick);
    };
    /** Wait for a game message matching `re` published from `since` on; the roll's result is the segment's effect. */
    const message = async (since: number, re: RegExp, maxTicks: number, what: string) => {
        rec.mark((await waitOrThrow(sdk, s => messagesSince(s, since, re).length > 0, maxTicks, what)).tick);
        return messagesSince(sdk, since, re);
    };

    if (FROM === 'start') {
        // 1. Ardougne teleport landing -> Commander Lawgof, start
        begin('walk ardougne->lawgof', 'travel');
        await walk(LAWGOF[0], LAWGOF[1] - 2, 2);
        end();
        begin('lawgof start (6 railings)', 'dialogue');
        await talk(LAWGOF_RE, ["Yeah, I'd love to help."]);
        end();

        // 2. the six railings
        begin('six railings', 'interaction');
        let tries = 0;
        for (const [rx, rz, rid] of RAILINGS) {
            for (let attempt = 0; attempt < 12; attempt++) {
                // messages from the next tick on: the last failed try's message must not count
                const since = currentTick(sdk) + 1;
                await op({ x: rx, z: rz, id: rid, radius: 25 }, 'Inspect', s => s.dialog.isOpen, `railing choice at ${rx},${rz}`, 40);
                rec.dialogue(await converse(sdk, ['Try to replace the railing.'], { idle: 1 }));
                tries++;
                // railings.rs2: if_close, p_delay(2), roll; success then p_delay(2) before the bit is set
                const msgs = await message(since, /no problems|fail and cut/i, 20, 'railing result');
                if (msgs.some((m) => /no problems/i.test(m))) {
                    await waitTicks(sdk, 3);
                    rec.mark();
                    break;
                }
            }
        }
        end(`${tries} tries for 6 railings at Crafting ${CRAFT}`);
        begin('lawgof railings done', 'mixed');
        await walk(LAWGOF[0], LAWGOF[1] - 2, 2);
        await talk(LAWGOF_RE);
        end();

        // 3. watchtower: ladder 2570,3441 up to level 1 and 2, take the remains (2567,3444 level 2)
        begin('watchtower remains', 'mixed');
        await walk(2570, 3442, 1);
        await op({ x: 2570, z: 3441, name: /ladder/i, radius: 20 }, 'Climb-up', s => pos(s).level === 1, 'tower level 1');
        await climb(/climb-up/i, /Climb up/i, 2);
        rec.interact();
        if (!(await pickup(sdk, /dwarf remains/i, { maxTicks: 20 })).ok) throw new Error('timed out waiting for: remains in inventory');
        rec.mark();
        for (const lv of [1, 0]) await climb(/climb-down/i, /Climb down/i, lv);
        end('4 ladder climbs + 1 pickup');
        begin('lawgof remains', 'mixed');
        await walk(LAWGOF[0], LAWGOF[1] - 2, 2);
        await talk(LAWGOF_RE);
        end();

        // 4. goblin cave: entrance 2622,3392 -> 2620,9797; crate 2571,9850; mud pile 2621,9796
        begin('walk lawgof->cave + enter', 'travel');
        await walk(2623, 3394, 2);
        await op({ name: /cave entrance/i, radius: 8 }, 'Enter', s => pos(s).z > 9000, 'inside the cave');
        end();
        begin('cave crate + lollk', 'mixed');
        await walk(2571, 9849, 1);
        await op({ x: 2571, z: 9850, name: /crate/i, radius: 20 }, 'Search', s => s.dialog.isOpen, 'child dialogue');
        rec.dialogue(await converse(sdk, []));
        end();
        begin('mud pile + walk + lawgof toolkit', 'mixed');
        await walk(2620, 9797, 1);
        await op({ name: /mud pile/i, radius: 8 }, 'Climb-over', s => pos(s).z < 4000, 'out of the cave');
        await walk(LAWGOF[0], LAWGOF[1] - 2, 2);
        await talk(LAWGOF_RE, ["Ok, I'll see what I can do."]);
        end();
    }

    // 5. the shed: door 2576,3461, broken cannon 2577,3461 (3x3)
    begin('shed: inspect + repair 4 parts', 'mixed');
    let inspects = 0;
    let fixTries = 0;
    await openDoor(sdk, 2576, 3461);
    // mcannon_broken_cannon.rs2: first inspect -> chatplayer (stage 7); later inspects roll
    // "find the problem" (two mes + p_delay(3), then a 5-way menu) and each part fix rolls again
    // (p_delay(2)); with all four bits set the next inspect says it is in working order (stage 8).
    const parts = ['Pipe', 'Barrel', 'Axle', 'Shaft'];
    let partIdx = 0;
    let findFails = 0;
    let fixFails = 0;
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
        const cannon = await locOrThrow({ name: /broken multicannon/i, radius: 10 }, 'broken cannon');
        const since = currentTick(sdk) + 1;
        rec.interact();
        const ri = await opLoc(sdk, cannon, 'Inspect', s => s.dialog.isOpen || messagesSince(s, since, /can't quite find/i).length > 0, { maxTicks: 40 });
        if (!ri.ok) {
            log(`inspect: no result at ${JSON.stringify(pos(sdk))}`);
            const shut = await findLoc(sdk, { name: /door/i, op: 'Open', radius: 6 });
            if (shut) await openDoor(sdk, shut.x, shut.z);
            continue;
        }
        inspects++;
        rec.mark();
        if (messagesSince(sdk, since, /can't quite find/i).length) {
            findFails++;
            continue;
        }
        const dlg = sdk.getState()!.dialog;
        if (dlg.options.length > 1) {
            rec.dialogue(await converse(sdk, [parts[partIdx]!], { idle: 1 }));
            fixTries++;
            const msgs = await message(since, /manage to fix it|fail to fix it|already fixed/i, 15, 'part fix result');
            if (msgs.some((m) => /manage to fix it|already fixed/i.test(m))) {
                partIdx++;
                await waitTicks(sdk, 3); // p_delay(2) after a successful fix
                rec.mark();
            } else fixFails++;
        } else {
            if (/working order/i.test(pageText(dlg))) done = true;
            // idle 1 mid-segment: the next inspect follows the chatplayer page at once
            rec.dialogue(await converse(sdk, [], done ? {} : { idle: 1 }));
        }
    }
    if (!done) throw new Error(`cannon not repaired after ${inspects} inspects (${partIdx} parts)`);
    end(`${inspects} inspects (${findFails} failed to find the problem), ${fixTries} part attempts (${fixFails} failed) at Smithing ${SMITH} / Crafting ${CRAFT}`);
    begin('lawgof repaired', 'mixed');
    await walk(LAWGOF[0], LAWGOF[1] - 2, 2);
    await talk(LAWGOF_RE, ['Ok then, just for you!']);
    end();

    // 6. Nulodion at the Black Guard base (3011,3453), door 3015,3453
    await mustTele(sdk, FALADOR[0], FALADOR[1]);
    begin('falador landing -> nulodion (notes + mould)', 'mixed');
    await walk(3016, 3453, 1);
    await openDoor(sdk, 3015, 3453);
    await walk(3012, 3453, 2);
    await talk(/nulodion|cannon engineer/i);
    end('plus 1 teleport');

    // 7. back to Lawgof, quest complete
    await mustTele(sdk, ARDOUGNE[0], ARDOUGNE[1]);
    begin('ardougne landing -> lawgof (complete)', 'mixed');
    await walk(LAWGOF[0], LAWGOF[1] - 2, 2);
    await talk(LAWGOF_RE);
    await waitTicks(sdk, 3);
    if (sdk.getState()!.dialog.isOpen) rec.dialogue(await converse(sdk, [])); // quest complete scroll
    end('plus 1 teleport');

    log(`mcannon = ${await getvar(sdk, 'mcannon')}`);
    const sum = rec.total();
    const tiles = rec.segments.reduce((a, s) => a + (typeof s.routeTiles === 'number' ? s.routeTiles : 0), 0);
    console.log(`TOTAL ${sum.ticks} ticks (excluding 2 teleports), ${sum.pages} pages, ${sum.options} options, ${tiles} route tiles`);
    console.log('crafting xp', skillXp(sdk, 'crafting'));
    rec.report();
}, { timeout: 30 * 60_000, printState: false });
