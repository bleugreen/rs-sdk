// Haunted Mine, scored-account route, measured segment by segment (lab only).
//
//   bun docs/speedrun/scripts/quest-hauntedmine-run.ts <botname> [--from=<phase>] [--to=<phase>] [--stats=<n>]
//
// Phases: zealot, enter, mush, cart, exit, endcart, lift, stairs, boss, reward.
// --from sets up the quest varps, inventory and position for that phase with
// staff commands, so any phase can be re-measured on its own. --stats sets
// Attack/Strength/Defence/Hitpoints (default 70) and gives a rune scimitar.
//
// Known lab-only step: the cart puzzle's lever state is read with ::getvar
// (a production bot has no staff access; see haunted_mine.md for the
// no-information protocol and its cost). That read is outside the timed
// segments.

import { runScript } from '../../../sdk/runner';
import { Ledger, type Sdk, chebyshevPath, cheat, dialog, findLoc, getvar, messageSince, pos, tele, ticks, until } from './quest-pip-hm-lib';

const PHASES = ['zealot', 'enter', 'mush', 'cart', 'exit', 'endcart', 'lift', 'stairs', 'boss', 'reward'] as const;
type Phase = (typeof PHASES)[number];

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const FROM = arg('from', 'zealot') as Phase;
const TO = arg('to', 'reward') as Phase;
const STATS = parseInt(arg('stats', '70'), 10);

// hauntedmine_bits
const BIT = { b: 1, a: 2, c: 3, d: 4, e: 5, i: 6, j: 7, k: 8, endcartFungus: 9, heardAboutKey: 10, puzzleStarted: 21 };
const LEVERS: Record<number, [number, number]> = { 1: [2785, 4517], 2: [2784, 4517], 3: [2786, 4517], 4: [2786, 4515], 5: [2785, 4515], 6: [2768, 4533], 7: [2769, 4533], 8: [2770, 4533] };
// success path needs b=1, a=1, c=0, d=0, j=0 (hauntedmine_points.rs2:20-29)
const WANT: Record<number, 0 | 1> = { 1: 1, 2: 1, 3: 0, 4: 0, 7: 0 };

function invHas(sdk: Sdk, re: RegExp) {
    return sdk.getInventory().some(i => re.test(i.name));
}

async function energy(sdk: Sdk) {
    await cheat(sdk, '~energy');
}

/** op a loc found by name near a coordinate, logging path length; waits for `done`. */
async function opLoc(sdk: Sdk, L: Ledger, name: string | RegExp, at: [number, number], op: number, done: () => boolean, timeout = 120) {
    const loc = await findLoc(sdk, name, { x: at[0], z: at[1] }, 40);
    if (!loc) throw new Error(`no loc ${name} near ${at}`);
    const tiles = chebyshevPath(sdk, loc.x, loc.z);
    L.add({ tiles: Math.max(tiles, 0) });
    await sendUntil(sdk, L, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, op), done, timeout, `op ${op} on ${loc.name}@${loc.x},${loc.z}`);
}

/**
 * Send an op and wait for `done`. An op sent while a previous script still
 * holds the player (exactmove, p_delay) is dropped silently, so resend when
 * the player has neither moved nor animated for 3 ticks.
 */
async function sendUntil(sdk: Sdk, L: Ledger, send: () => Promise<unknown>, done: () => boolean, timeout: number, what: string) {
    const start = sdk.getState()!.tick;
    let sends = 0;
    while (sdk.getState()!.tick - start < timeout) {
        await send();
        sends++;
        let last = pos(sdk);
        let still = 0;
        while (sdk.getState()!.tick - start < timeout) {
            if (done()) {
                if (sends > 1) L.note(`${what}: resent ${sends - 1}x`);
                return;
            }
            await sdk.waitForStateUpdate();
            const p = pos(sdk);
            const anim = sdk.getState()!.player!.animId;
            if (p.x === last.x && p.z === last.z && anim === -1 && !sdk.getState()!.dialog?.isOpen) still++;
            else still = 0;
            last = p;
            if (still >= 3) break;
        }
    }
    if (!done()) throw new Error(`${what} did not complete; at ${JSON.stringify(pos(sdk))}; ${sdk.getState()!.gameMessages.slice(-3).map(m => m.text).join(' | ')}`);
}

const inMap = (sdk: Sdk, mx: number, mz: number) => {
    const p = pos(sdk);
    return p.x >> 6 === mx && p.z >> 6 === mz;
};

async function setup(sdk: Sdk, phase: Phase) {
    await cheat(sdk, `setstat attack ${STATS}`);
    await cheat(sdk, `setstat strength ${STATS}`);
    await cheat(sdk, `setstat defence ${STATS}`);
    await cheat(sdk, `setstat hitpoints ${STATS}`);
    if (!invHas(sdk, /^chisel$/i)) await cheat(sdk, 'give chisel 1');
    if (!invHas(sdk, /rune scimitar/i) && !sdk.findEquipmentItem(/rune scimitar/i)) await cheat(sdk, 'give rune_scimitar 1');
    if (sdk.countInventoryItems(/^shark$/i) < 10) await cheat(sdk, `give shark ${10 - sdk.countInventoryItems(/^shark$/i)}`);
    const sc = sdk.findInventoryItem(/rune scimitar/i);
    if (sc) await sdk.sendUseItem(sc.slot, 2);
    await ticks(sdk, 1);
    const idx = PHASES.indexOf(phase);
    const stage = idx <= 0 ? 0 : idx <= 5 ? 3 : idx === 6 ? 3 : idx === 7 ? 5 : idx === 8 ? 7 : 9;
    let bits = 0;
    if (idx >= 1) bits |= 1 << BIT.heardAboutKey;
    if (idx === 5) bits |= 1 << BIT.endcartFungus;
    await cheat(sdk, `setvar hauntedmine ${stage}`);
    await cheat(sdk, `setvar hauntedmine_bits ${bits}`);
    if (idx >= 1 && idx <= 6 && !invHas(sdk, /zealot's key/i)) await cheat(sdk, 'give hauntedmine_lift_key 1');
    if (idx === 7 && !invHas(sdk, /glowing fungus/i)) await cheat(sdk, 'give glowing_fungus 1');
    if (idx === 9 && !invHas(sdk, /^key$/i)) await cheat(sdk, 'give hauntedmine_reward_key 1');
    const start: Record<Phase, [number, number]> = {
        zealot: [3444, 3256], enter: [3446, 3256], mush: [2789, 4487], cart: [2778, 4508], exit: [2770, 4520],
        endcart: [3429, 3227], lift: [2774, 4539], stairs: [2725, 4452], boss: [2811, 4454], reward: [2788, 4457]
    };
    await tele(sdk, start[phase][0], start[phase][1]);
    if (phase === 'cart' && !invHas(sdk, /glowing fungus/i)) {
        await cheat(sdk, 'give glowing_fungus 1');
    }
    if (phase === 'exit') await cheat(sdk, `setvar hauntedmine_bits ${(1 << BIT.heardAboutKey) | (1 << BIT.endcartFungus)}`);
    await energy(sdk);
    await ticks(sdk, 2);
}

const phases: Record<Phase, (sdk: Sdk, L: Ledger) => Promise<void>> = {
    async zealot(sdk, L) {
        L.begin('zealot: start quest, ask about the key, pickpocket');
        const z = sdk.findNearbyNpc(/zealot/i)!;
        L.add({ tiles: Math.max(0, chebyshevPath(sdk, z.x, z.z) - 1) });
        await sdk.sendInteractNpc(z.index, 1);
        const d = await dialog(sdk, ['Saradomin', 'seeking challenges', 'What quest is that', 'other way into the mines'], {
            waitOpen: 30,
            stopWhen: () => (sdk.getDialog()?.options.length ?? 0) >= 5 && /second entrance/i.test(sdk.getDialog()!.options.map(o => o.text).join('|'))
        });
        L.add(d);
        const z2 = sdk.findNearbyNpc(/zealot/i)!;
        await sdk.sendInteractNpc(z2.index, 3);
        if (!(await until(sdk, () => invHas(sdk, /key/i), 30))) throw new Error('pickpocket failed');
        L.add({ options: 0 });
        L.end();
    },

    async enter(sdk, L) {
        // The zealot's side of the ridge reaches the cart tunnel only over the
        // obstacle cart; the back entrances share a ledge reachable only from
        // inside the mine (collision map, see haunted_mine.md).
        L.begin('zealot -> obstacle cart -> cart tunnel (sets stage 3)');
        const before = pos(sdk);
        await opLoc(sdk, L, /mine cart/i, [3445, 3236], 1, () => { const p = pos(sdk); return p.z <= 3235 || (p.x < 3445 && p.z < 3240); }, 120);
        await ticks(sdk, 1);
        L.note(`cart crossing ${before.x},${before.z} -> ${pos(sdk).x},${pos(sdk).z}`);
        await opLoc(sdk, L, /cart tunnel/i, [3440, 3232], 1, () => pos(sdk).z > 9000, 120);
        L.end();
        L.begin('main half -> out through back entrance 1 -> in through back entrance 2');
        await opLoc(sdk, L, /cart tunnel/i, [3404, 9631], 1, () => pos(sdk).z < 4000, 120);
        await opLoc(sdk, L, /cart tunnel/i, [3429, 3225], 1, () => pos(sdk).z > 9000, 120);
        L.end();
        L.begin('ladders: 53_150 -> 43_71 -> 42_70 -> 43_70 mushroom area');
        await opLoc(sdk, L, /ladder/i, [3422, 9625], 1, () => inMap(sdk, 43, 71));
        await opLoc(sdk, L, /ladder/i, [2798, 4567], 1, () => inMap(sdk, 42, 70));
        await opLoc(sdk, L, /ladder/i, [2725, 4486], 1, () => inMap(sdk, 43, 70));
        L.end();
    },

    async mush(sdk, L) {
        L.begin('pick glowing fungus');
        await opLoc(sdk, L, /glowing fungus/i, [2791, 4496], 1, () => invHas(sdk, /glowing fungus/i), 60);
        L.end();
        L.begin('fungus into the start cart');
        const cart = await findLoc(sdk, /mine cart/i, { x: 2778, z: 4506 }, 40);
        if (!cart || cart.x !== 2778) throw new Error(`start cart not found: ${JSON.stringify(cart)}`);
        L.add({ tiles: chebyshevPath(sdk, cart.x, cart.z) });
        const t0 = sdk.getState()!.tick;
        await sdk.sendUseItemOnLoc(sdk.findInventoryItem(/glowing fungus/i)!.slot, cart.x, cart.z, cart.id);
        if (!(await until(sdk, () => messageSince(sdk, t0, /place the glowing fungus/i), 60))) throw new Error('fungus not placed');
        L.end();
    },

    async cart(sdk, L) {
        if (FROM === 'cart') {
            const cart = await findLoc(sdk, /mine cart/i, { x: 2778, z: 4506 }, 40);
            const t0 = sdk.getState()!.tick;
            await sdk.sendUseItemOnLoc(sdk.findInventoryItem(/glowing fungus/i)!.slot, cart!.x, cart!.z, cart!.id);
            await until(sdk, () => messageSince(sdk, t0, /place the glowing fungus/i), 60);
        }
        L.begin('points settings: view (randomises levers on first view)');
        await opLoc(sdk, L, /points settings/i, [2769, 4522], 1, () => !!sdk.getState()!.modalOpen, 60);
        L.end();
        await sdk.sendCloseModal();
        const bits = await getvar(sdk, 'hauntedmine_bits'); // lab-only read of the randomised lever state
        const pulls = Object.entries(WANT).filter(([b, v]) => ((bits >> Number(b)) & 1) !== v).map(([b]) => Number(b));
        console.log(`lever bits ${bits.toString(2)} -> pull ${pulls.join(',') || 'none'}`);
        L.begin(`pull levers ${pulls.join(',') || 'none'}`);
        L.note(`${pulls.length} pulls`);
        // levers 1-5 sit together; 6-8 are in the northern alcove
        for (const b of pulls.sort((x, y) => (x <= 5 ? 0 : 1) - (y <= 5 ? 0 : 1))) {
            const [x, z] = LEVERS[b]!;
            const t0 = sdk.getState()!.tick;
            await opLoc(sdk, L, /lever/i, [x, z], 1, () => messageSince(sdk, t0, /old points creak/i), 80);
        }
        L.end();
        L.begin('points settings: send the cart (success animation)');
        await opLoc(sdk, L, /points settings/i, [2769, 4522], 1, () => !!sdk.getState()!.modalOpen, 80);
        await sdk.sendClickComponent(11708);
        const d = await dialog(sdk, [], { waitOpen: 40, settle: 1 });
        L.add(d);
        L.end();
        await sdk.sendCloseModal();
        const after = await getvar(sdk, 'hauntedmine_bits');
        if (!((after >> BIT.endcartFungus) & 1)) throw new Error(`fungus did not reach the end cart; bits ${after.toString(2)}`);
    },

    async exit(sdk, L) {
        await energy(sdk);
        L.begin('mushroom half -> surface (ladders up, crawl out back entrance 2)');
        await opLoc(sdk, L, /ladder/i, [2789, 4486], 1, () => inMap(sdk, 42, 70));
        await opLoc(sdk, L, /ladder/i, [2734, 4503], 1, () => inMap(sdk, 43, 71));
        await opLoc(sdk, L, /ladder/i, [2782, 4569], 1, () => inMap(sdk, 53, 150));
        await opLoc(sdk, L, /cart tunnel/i, [3408, 9623], 1, () => pos(sdk).z < 4000);
        L.end();
        L.begin('surface -> back entrance 1 -> lift half, ladder down to the end cart');
        await opLoc(sdk, L, /cart tunnel/i, [3430, 3233], 1, () => pos(sdk).z > 9000);
        await opLoc(sdk, L, /ladder/i, [3413, 9633], 1, () => inMap(sdk, 43, 71));
        await opLoc(sdk, L, /ladder/i, [2797, 4599], 1, () => inMap(sdk, 42, 70));
        await opLoc(sdk, L, /ladder/i, [2710, 4540], 1, () => inMap(sdk, 43, 70));
        L.end();
    },

    async endcart(sdk, L) {
        if (FROM === 'endcart') {
            L.begin('(setup) back entrance 1 -> end cart');
            await opLoc(sdk, L, /cart tunnel/i, [3430, 3233], 1, () => pos(sdk).z > 9000);
            await opLoc(sdk, L, /ladder/i, [3413, 9633], 1, () => inMap(sdk, 43, 71));
            await opLoc(sdk, L, /ladder/i, [2797, 4599], 1, () => inMap(sdk, 42, 70));
            await opLoc(sdk, L, /ladder/i, [2710, 4540], 1, () => inMap(sdk, 43, 70));
            L.end();
        }
        L.begin('take the fungus from the end cart');
        const cart = await findLoc(sdk, /mine cart/i, { x: 2774, z: 4537 }, 20);
        L.add({ tiles: chebyshevPath(sdk, cart!.x, cart!.z) });
        await sdk.sendInteractLoc(cart!.x, cart!.z, cart!.id, 1);
        const d = await dialog(sdk, ['Take it'], { waitOpen: 30, settle: 1 });
        L.add(d);
        if (!(await until(sdk, () => invHas(sdk, /glowing fungus/i), 20))) throw new Error('no fungus from end cart');
        L.end();
    },

    async lift(sdk, L) {
        await energy(sdk);
        L.begin('end cart -> lift area (ladder up, walk, ladder down)');
        await opLoc(sdk, L, /ladder/i, [2774, 4540], 1, () => inMap(sdk, 42, 70));
        await opLoc(sdk, L, /ladder/i, [2732, 4529], 1, () => inMap(sdk, 43, 70));
        L.end();
        L.begin('use the lift key on the valve');
        const valve = await findLoc(sdk, /water valve/i, { x: 2808, z: 4496 }, 50);
        L.add({ tiles: chebyshevPath(sdk, valve!.x, valve!.z) });
        let t0 = sdk.getState()!.tick;
        await sdk.sendUseItemOnLoc(sdk.findInventoryItem(/key/i)!.slot, valve!.x, valve!.z, valve!.id);
        if (!(await until(sdk, () => messageSince(sdk, t0, /open the valve/i), 80))) throw new Error('valve not opened');
        L.end();
        L.begin('valve -> lift, ride down');
        const lift = await findLoc(sdk, /^lift$/i, { x: 2807, z: 4494 }, 50);
        const path = sdk.findPath(lift!.x, lift!.z, 500);
        const ghostZone = path.waypoints.some(w => w.x >= 2800 && w.x <= 2803 && w.z >= 4512 && w.z <= 4516);
        L.note(`path crosses ghost zone: ${ghostZone}`);
        L.add({ tiles: chebyshevPath(sdk, lift!.x, lift!.z) });
        t0 = sdk.getState()!.tick;
        await sdk.sendInteractLoc(lift!.x, lift!.z, lift!.id, 1);
        if (!(await until(sdk, () => inMap(sdk, 42, 69) && messageSince(sdk, t0, /plunging you/i), 120))) {
            throw new Error(`lift ride failed: ${sdk.getState()!.gameMessages.slice(-4).map(m => m.text).join(' | ')}`);
        }
        await until(sdk, () => pos(sdk).z === 4452, 10);
        L.end();
    },

    async stairs(sdk, L) {
        await energy(sdk);
        L.begin('flooded level -> stairs down with fungus (to the boss level)');
        await opLoc(sdk, L, /stairs/i, [2746, 4436], 1, () => inMap(sdk, 43, 69), 120);
        L.end();
        const st = await getvar(sdk, 'hauntedmine');
        if (st !== 7) throw new Error(`expected stage 7 after the lit stairs, got ${st}`);
    },

    async boss(sdk, L) {
        await energy(sdk);
        L.begin('walk to the key (through the boss door)');
        const door = await findLoc(sdk, /door/i, { x: 2799, z: 4453 }, 30);
        if (door && door.options.some(o => /open/i.test(o))) {
            await opLoc(sdk, L, /door/i, [2799, 4453], 1, () => true, 5);
            await until(sdk, () => pos(sdk).x <= 2800, 40);
        }
        const key = sdk.findNearbyNpc(/key/i)!;
        L.add({ tiles: chebyshevPath(sdk, key.x, key.z) });
        L.end();
        L.begin('take the key: cutscene until Treus Dayth is attackable');
        await sdk.sendInteractNpc(key.index, 1);
        const d = await dialog(sdk, [], { waitOpen: 40, settle: 1 });
        L.add(d);
        await until(sdk, () => !!sdk.findNearbyNpc(/treus dayth/i), 60);
        L.end();
        L.begin('fight Treus Dayth');
        let swings = 0;
        let moves = 0;
        let eats = 0;
        let wasVisible = true;
        const t0 = sdk.getState()!.tick;
        while (sdk.getState()!.tick - t0 < 1500) {
            const s = sdk.getState()!;
            if (messageSince(sdk, t0, /killing strike/i) || s.dialog?.isOpen) break;
            const me = s.player!;
            if (me.hp <= Math.max(20, Math.floor(STATS * 0.4))) {
                const food = sdk.findInventoryItem(/shark/i);
                if (food) {
                    await sdk.sendUseItem(food.slot, 1);
                    eats++;
                    await ticks(sdk, 1);
                }
            }
            const boss = sdk.findNearbyNpc(/treus dayth/i);
            if (!boss) {
                if (wasVisible) moves++;
                wasVisible = false;
                await sdk.waitForStateUpdate();
                continue;
            }
            wasVisible = true;
            if (me.combat?.targetIndex !== boss.index || !me.combat?.inCombat) {
                await sdk.sendInteractNpc(boss.index, 2);
                swings++;
            }
            await sdk.waitForStateUpdate();
        }
        L.note(`attack clicks ${swings}, fade-outs seen ${moves}, sharks eaten ${eats}, hp left ${sdk.getState()!.player!.hp}`);
        const kd = await dialog(sdk, [], { settle: 1 });
        L.add(kd);
        L.end();
        const st = await getvar(sdk, 'hauntedmine');
        if (st !== 9) throw new Error(`expected stage 9 after the fight, got ${st}`);
    },

    async reward(sdk, L) {
        L.begin('take the key again');
        const key = sdk.findNearbyNpc(/key/i);
        if (key) {
            L.add({ tiles: chebyshevPath(sdk, key.x, key.z) });
            await sdk.sendInteractNpc(key.index, 1);
            const d = await dialog(sdk, [], { waitOpen: 30, settle: 1 });
            L.add(d);
        }
        if (!invHas(sdk, /key/i)) throw new Error('no reward key');
        L.end();
        L.begin('reward door (sets stage 10)');
        await energy(sdk);
        await opLoc(sdk, L, /large door/i, [2772, 4450], 1, () => pos(sdk).z <= 4450, 80);
        await ticks(sdk, 1);
        L.end();
        const st = await getvar(sdk, 'hauntedmine');
        console.log('stage after door', st);
        L.begin('cut a crystal (quest complete)');
        const strBefore = sdk.getSkill('strength')!.experience;
        await opLoc(sdk, L, /crystal outcrop/i, [2787, 4428], 1, () => sdk.getSkill('strength')!.experience > strBefore, 80);
        L.note(`strength xp +${sdk.getSkill('strength')!.experience - strBefore} (game xp)`);
        L.end();
    }
};

await runScript(async ({ sdk }) => {
    const L = new Ledger(sdk);
    await setup(sdk, FROM);
    const a = PHASES.indexOf(FROM);
    const b = PHASES.indexOf(TO);
    for (let i = a; i <= b; i++) {
        console.log(`--- phase ${PHASES[i]} (tick ${sdk.getState()!.tick}, stage ${await getvar(sdk, 'hauntedmine')})`);
        await phases[PHASES[i]!](sdk, L);
    }
    L.report(`Haunted Mine ${FROM}..${TO} at ${STATS} melee`);
    console.log('final stage', await getvar(sdk, 'hauntedmine'));
}, { timeout: 1_800_000 });
