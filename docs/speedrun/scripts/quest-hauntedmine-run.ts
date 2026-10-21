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

/**
 * Cart 1 patrols x=2727 between z=4491 and z=4509 with 3-tick stops
 * (hauntedmine.npc, hauntedmine_cart1), and that track is the only corridor
 * between the ladders at (2734,4503) and (2725,4486). Start the run when the
 * cart is north of the junction and heading north (or parked at the north
 * end): it cannot come back past z=4503 for at least 9 ticks.
 */
//
// The corridor is one tile wide (walls on both sides of x=2727) with two
// dead-end alcoves: (2728,4503) and (2726,4496). The cart pushes anyone on
// the tile ahead of it back one tile (hauntedmine_cart.rs2), so the crossing
// is: get into the alcove that lies between you and the cart, let it pass,
// then run the rest of the corridor behind it.
const ALCOVE_N: [number, number] = [2728, 4503];
const ALCOVE_S: [number, number] = [2726, 4496];

function cart1(sdk: Sdk): number | null {
    const c = sdk.getNearbyNpcs().find(n => /mine cart/i.test(n.name) && (n.tileX ?? n.x) === 2727);
    return c ? (c.tileZ ?? c.z) : null;
}

async function cart1Dir(sdk: Sdk): Promise<{ z: number; dir: number }> {
    const a = cart1(sdk)!;
    await sdk.waitForStateUpdate();
    const b = cart1(sdk)!;
    // parked at an end: it will head back
    const dir = b !== a ? Math.sign(b - a) : b >= 4509 ? -1 : b <= 4491 ? 1 : 0;
    return { z: b, dir };
}

async function crossTrack(sdk: Sdk, L: Ledger, heading: 'south' | 'north') {
    const t0 = sdk.getState()!.tick;
    // southbound enters at the north end (z 4509), northbound at the south end (z 4489)
    let alcove: [number, number] | null = null;
    while (!alcove && sdk.getState()!.tick - t0 < 80) {
        const { z, dir } = await cart1Dir(sdk);
        // The alcove is 7-8 tiles (4 ticks running) from the corridor end; the
        // cart moves 1 tile per tick, so a head-on cart must be at least 6
        // tiles short of the alcove when we set off.
        if (heading === 'south') {
            if (dir > 0 && z <= 4496) alcove = ALCOVE_N; // coming at us: duck at 4503 first
            else if (dir < 0 && z <= 4507) alcove = ALCOVE_S; // going away: follow, duck at 4496
        } else {
            if (dir < 0 && z >= 4503) alcove = ALCOVE_S; // coming at us: duck at 4496 first
            else if (dir > 0 && z >= 4493) alcove = ALCOVE_N; // going away: follow, duck at 4503
        }
    }
    const waitedEntry = sdk.getState()!.tick - t0;
    if (!alcove) throw new Error('cart 1 never gave an opening');
    await sdk.sendWalk(alcove[0], alcove[1], true);
    const t1 = sdk.getState()!.tick;
    // wait in the alcove until the cart has gone past it, away from our exit
    const passed = () => {
        const z = cart1(sdk);
        if (z === null) return true;
        return heading === 'south' ? z > alcove![1] : z < alcove![1];
    };
    const trace: string[] = [];
    const inAlcove = () => {
        const p = pos(sdk);
        trace.push(`${sdk.getState()!.tick}: me ${p.x},${p.z} cart ${cart1(sdk)}`);
        return p.x === alcove![0] && p.z === alcove![1];
    };
    if (!(await until(sdk, inAlcove, 30))) throw new Error(`never reached alcove ${alcove}:\n${trace.join('\n')}`);
    const t2 = sdk.getState()!.tick;
    await until(sdk, passed, 60);
    const t3 = sdk.getState()!.tick;
    L.note(`cart 1 (${heading}): entry wait ${waitedEntry}, to alcove ${t2 - t1}, alcove wait ${t3 - t2}, alcove ${alcove.join(',')}`);
}

/**
 * Cart 4 patrols x=2739 between z=4528 and z=4531, parking 4 ticks at each
 * end (14-tick cycle), and that track is the only way from the end-cart
 * ladder to the lift-area ladder (2732,4529). Coming from the north the run
 * needs track tiles 4531..4529 and steps off west at (2738,4528): 2 ticks.
 * Go the tick the cart arrives at its south end; it then sits for 3 more.
 */
async function crossCart4(sdk: Sdk, L: Ledger) {
    const STAGE: [number, number] = [2739, 4532];
    L.add({ tiles: chebyshevPath(sdk, STAGE[0], STAGE[1]) });
    await sdk.sendWalk(STAGE[0], STAGE[1], true);
    if (!(await until(sdk, () => pos(sdk).x === STAGE[0] && pos(sdk).z === STAGE[1], 40))) throw new Error(`did not reach cart 4 staging tile; at ${JSON.stringify(pos(sdk))}`);
    const cart4 = () => {
        const c = sdk.getNearbyNpcs().find(n => /mine cart/i.test(n.name) && n.x === 2739 && n.z >= 4528 && n.z <= 4531);
        return c ? c.z : null;
    };
    const t0 = sdk.getState()!.tick;
    let prev = cart4();
    while (sdk.getState()!.tick - t0 < 30) {
        await sdk.waitForStateUpdate();
        const z = cart4();
        if (z === 4528 && prev !== null && prev > 4528) break;
        prev = z;
    }
    const t1 = sdk.getState()!.tick;
    // (2738,4529) is reachable only down the track, and from it the ladder
    // route leaves via (2738,4528), never the cart's parking tile (2739,4528).
    L.add({ tiles: 4 });
    await sdk.sendWalk(2738, 4529, true);
    if (!(await until(sdk, () => pos(sdk).x === 2738 && pos(sdk).z === 4529, 15))) throw new Error(`cart 4 crossing failed; at ${JSON.stringify(pos(sdk))}`);
    L.note(`cart 4 wait ${t1 - t0}, crossing ${sdk.getState()!.tick - t1}`);
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
    await cheat(sdk, '~clearinv inv');
    await until(sdk, () => sdk.getInventory().length === 0, 10);
    await cheat(sdk, 'give chisel 1');
    if (!sdk.findEquipmentItem(/rune scimitar/i)) await cheat(sdk, 'give rune_scimitar 1');
    await cheat(sdk, 'give shark 10');
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
    if ((idx === 6 || idx === 7) && !invHas(sdk, /glowing fungus/i)) await cheat(sdk, 'give glowing_fungus 1');
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
        L.add({ tiles: chebyshevPath(sdk, 2728, 4510) });
        await sdk.sendWalk(2728, 4510, true);
        await until(sdk, () => pos(sdk).x === 2728 && pos(sdk).z === 4510, 30);
        await crossTrack(sdk, L, 'south');
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
        await sendUntil(sdk, L, () => sdk.sendUseItemOnLoc(sdk.findInventoryItem(/glowing fungus/i)!.slot, cart.x, cart.z, cart.id), () => messageSince(sdk, t0, /place the glowing fungus|already a load/i), 60, 'fungus on start cart');
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
        L.add({ tiles: chebyshevPath(sdk, 2726, 4488) });
        await sdk.sendWalk(2726, 4488, true);
        await until(sdk, () => pos(sdk).x === 2726 && pos(sdk).z === 4488, 30);
        await crossTrack(sdk, L, 'north');
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
        await crossCart4(sdk, L);
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
        // Three lift locs (lift_side_l 4937, lift_back 4940, lift_side_r
        // 4938) share one handler. From the valve, a click on a lift walks
        // the 59-step route but stops two tiles short at (2805,4493)
        // ("I can't reach that!" or a silent stall); a second click from
        // there enters the lift at once. Time matters: the route crosses the
        // cheeky ghost's zone, which turns the valve off 25 ticks later.
        const lifts = (await sdk.scanNearbyLocs(50)).filter(l => /^lift$/i.test(l.name) && Math.abs(l.x - 2807) <= 2 && Math.abs(l.z - 4493) <= 2 && l.id !== 4940);
        const landed = () => inMap(sdk, 42, 69) && pos(sdk).z <= 4452;
        L.add({ tiles: chebyshevPath(sdk, lifts[0]!.x, lifts[0]!.z) });
        const trace: string[] = [];
        let seen = sdk.getState()!.gameMessages.length;
        let clicks = 1;
        await sdk.sendInteractLoc(lifts[0]!.x, lifts[0]!.z, lifts[0]!.id, 1);
        let last = pos(sdk);
        const ok = await until(sdk, () => {
            const s = sdk.getState()!;
            const p = pos(sdk);
            const g = sdk.getNearbyNpcs().find(n => /ghost/i.test(n.name));
            const msgs = s.gameMessages.slice(seen).map(m => m.text);
            seen = s.gameMessages.length;
            trace.push(`${s.tick} ${p.x},${p.z}${g ? ` ghost@${g.x},${g.z}` : ''}${msgs.length ? ' | ' + msgs.join(' | ') : ''}${s.dialog?.isOpen ? ' [dlg] ' + (s.dialog.text ?? '') : ''}`);
            if (landed()) return true;
            if (s.dialog?.isOpen) return true; // "needs to be powered": too late
            const near = Math.max(Math.abs(p.x - 2807), Math.abs(p.z - 4493)) <= 3;
            if (near && p.x === last.x && p.z === last.z && !inMap(sdk, 42, 69) && clicks < 5) {
                const lift = lifts[clicks % lifts.length]!;
                clicks++;
                void sdk.sendInteractLoc(lift.x, lift.z, lift.id, 1);
            }
            last = p;
            return false;
        }, 80);
        if (!ok || !landed()) throw new Error(`lift ride failed:\n${trace.join('\n')}`);
        L.note(`lift clicks ${clicks}`);
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
        // The boss fades (type change to "Ghost", no Attack op) and runs to
        // another part of the room on half of the hits it takes
        // (hauntedmine_boss_ghost.rs2 ai_queue1). The type change drops the
        // player's attack, while the client keeps facing it, so the combat
        // target in the bot state is no evidence of attacking: re-click
        // whenever it is attackable and we have not swung for 5 ticks.
        const IDLE: [number, number] = [2786, 4458];
        let msgSeen = sdk.getState()!.gameMessages.length;
        let approaches = 0;
        const atk0 = sdk.getSkill('attack')!.experience;
        let lastSwing = t0;
        let lastClick = -99;
        let died = false;
        const hpLog: string[] = [];
        while (sdk.getState()!.tick - t0 < 1500) {
            const s = sdk.getState()!;
            if (messageSince(sdk, t0, /killing strike/i) || s.dialog?.isOpen) break;
            if (messageSince(sdk, t0, /you are dead/i)) { died = true; break; }
            const me = s.player!;
            if (me.animId !== -1) lastSwing = s.tick;
            if ((s.tick - t0) % 25 === 0) {
                const b = sdk.findNearbyNpc(/treus dayth/i) ?? sdk.getNearbyNpcs().find(n => /^ghost$/i.test(n.name));
                const msgs = s.gameMessages.slice(msgSeen).map(m => m.text).filter(t => !/heals some|eat the/i.test(t));
                msgSeen = s.gameMessages.length;
                const near = sdk.getNearbyNpcs().filter(n => Math.max(Math.abs(n.x - me.worldX), Math.abs(n.z - me.worldZ)) <= 6 && !/treus/i.test(n.name)).map(n => `${n.name}@${n.x},${n.z}`);
                hpLog.push(`${s.tick - t0}:${me.hp}/${b ? `${b.name}@${b.x},${b.z} ${b.healthPercent ?? '?'}%` : 'none'} me@${me.worldX},${me.worldZ}${msgs.length ? ` msgs[${msgs.join('; ')}]` : ''}${near.length ? ` npcs[${near.join(' ')}]` : ''}`);
                if (process.argv.includes('--diag') && s.tick - t0 >= 150) break;
                if (process.argv.includes('--diag') && b && /treus/i.test(b.name) && Math.max(Math.abs(b.x - me.worldX), Math.abs(b.z - me.worldZ)) > 3 && s.tick - t0 >= 50) {
                    const bb = sdk.findNearbyNpc(/treus dayth/i)!;
                    const r = sdk.findPath(bb.x, bb.z, 500);
                    console.log(`DIAG boss@${bb.x},${bb.z} reachable=${(bb as any).reachable} sdkPath=${r.success} ${JSON.stringify(r.waypoints)}`);
                    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
                        await sdk.sendWalk(bb.x + dx, bb.z + dz, true);
                        await ticks(sdk, 8);
                        console.log(`DIAG walk to ${bb.x + dx},${bb.z + dz} -> ${JSON.stringify(pos(sdk))}`);
                        if (Math.abs(pos(sdk).x - bb.x) + Math.abs(pos(sdk).z - bb.z) === 1) break;
                    }
                    await sdk.sendInteractNpc(bb.index, 2);
                    await ticks(sdk, 6);
                    console.log(`DIAG after attack: me ${JSON.stringify(pos(sdk))}, attack xp +${sdk.getSkill('attack')!.experience - atk0}`);
                    break;
                }
            }
            if (me.hp <= 30) {
                const food = sdk.findInventoryItem(/shark/i);
                if (food) {
                    await sdk.sendUseItem(food.slot, 1);
                    eats++;
                    await ticks(sdk, 1);
                    continue;
                }
            }
            const boss = sdk.findNearbyNpc(/treus dayth/i);
            if (!boss) {
                if (wasVisible) moves++;
                wasVisible = false;
                // The room is ~31 tiles north-south and the boss's six spots
                // lie at its edges, past the 15-tile NPC view from the far
                // side; its attacks need no line of sight. Wait near the
                // centre (36_40 is on its run path, so stand at 34_42).
                const ghost = sdk.getNearbyNpcs().find(n => /^ghost$/i.test(n.name));
                const p = pos(sdk);
                if (!ghost && (p.x !== IDLE[0] || p.z !== IDLE[1]) && s.tick - lastClick >= 3) {
                    await sdk.sendWalk(IDLE[0], IDLE[1], true);
                    lastClick = s.tick;
                }
                await sdk.waitForStateUpdate();
                continue;
            }
            const reappeared = !wasVisible;
            wasVisible = true;
            if (reappeared || (s.tick - lastSwing >= 5 && s.tick - lastClick >= 3)) {
                // The lite client's click route fails for most of the boss's
                // spots (cranes and carts are NPCs in the way), and then the
                // server does not move the player at all. Walk next to it on
                // the SDK path first, then attack.
                const p = pos(sdk);
                if (Math.abs(p.x - boss.x) + Math.abs(p.z - boss.z) !== 1) {
                    const adj = [[0, 1], [1, 0], [-1, 0], [0, -1]]
                        .map(([dx, dz]) => ({ x: boss.x + dx!, z: boss.z + dz! }))
                        .map(t => ({ ...t, n: chebyshevPath(sdk, t.x, t.z) }))
                        .filter(t => t.n >= 0)
                        .sort((a, b) => a.n - b.n);
                    if (adj[0]) {
                        await sdk.sendWalk(adj[0].x, adj[0].z, true);
                        approaches++;
                        await until(sdk, () => { const q = pos(sdk); return q.x === adj[0]!.x && q.z === adj[0]!.z; }, Math.ceil(adj[0].n / 2) + 3);
                    }
                }
                await sdk.sendInteractNpc(boss.index, 2);
                swings++;
                lastClick = sdk.getState()!.tick;
            }
            await sdk.waitForStateUpdate();
        }
        const dealt = Math.round((sdk.getSkill('attack')!.experience - atk0) / 100); // 4 xp per damage, 25x
        L.note(`attack clicks ${swings}, approach walks ${approaches}, fade-outs ${moves}, sharks ${eats}, damage dealt ~${dealt}, hp left ${sdk.getState()!.player!.hp}${died ? ', DIED' : ''}; hp/boss% ${hpLog.join(' ')}`);
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
