// Underground Pass: timed segments, each started from a staged quest state
// (::setvar / ::tele / ::give) and played with real clicks. Travel follows the
// cheapest route from quest-underground-pass-route.ts (see `travel` below).
//
//   bun docs/speedrun/scripts/quest-underground-pass-segments.ts <bot> <segment> [--grid=342] [--thieving=50] [--agility=99]
//
// Segments (quest order):
//   start      King Lathas (%upass 0, started bit, grid answer), Koftik outside (-> 1), enter
//   entry      cave entrance -> Koftik's cloth -> bridge shot (-> 2) -> rope swing -> grid -> lever
//   gridfall   one wrong grid step, the pit, the climb out
//   orbs       portcullis -> four orbs -> furnace -> down the well (-> 3)
//   area2      cage, mud, ledge, Thieving-50 cages, pipe, railing, boulder (-> 4), horn, tunnel
//   paladins   three paladins, badges and horn into the well, the door (-> 5)
//   cavern     Nilhoof (-> 6), cat, witch, chest (-> 7), three demons, shadow, then `brew`
//   brew       (resumable) brew, tomb, ashes, Kalrag, dove
//   iban       disciple, robes only, temple doors (-> 8), doll in the pit (-> 9), Koftik, out
//   handin     King Lathas at %upass 9 (-> 10, the reward)
//   fights     every fight, --rounds times, at --att/--str/--def/--hp
//   swingfail / ledgefail / bridgefall   cost of a failed rope swing, ledge, broken bridge
//   post       after completion: cave entrance to the Iban temple doors and through them
//              (Regicide's second traversal, %upass 10, %regicide_quest 2)
//
// Each step is one segment (speedrun/lab/record.ts), from its click to the
// player idle again: no movement, no new message and no dialogue for 3 ticks.
// The segment ends at the last change before that settle, so the settle is not
// counted. TOTAL rows carry a whole stretch's wall-clock span in `wallTicks`
// and 0 in the Ticks column, so the table's Total is the sum of the steps.

import { runScript } from '../../../sdk/runner';
import { act, pickup, slotOf, talkTo, wield, type ActOptions } from '../../../speedrun/lib/act';
import { fight, Upkeep } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { idle } from '../../../speedrun/lib/idle';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { at, chebyshev, findNpc, invCount, invItem, messagesSince, opIndex, pos, skillXp, tileCounter, waitForNpc } from '../../../speedrun/lib/world';
import { Recorder, type Segment } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { P, plan, type T } from './quest-underground-pass-route';

const args = process.argv.slice(3);
const segment = args.find(a => !a.startsWith('--')) ?? 'post';
const opt = (name: string, d: number) => Number(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? d);
// Grid answers are three digits 1-5, each within 1 of the previous (upass_grid.rs2:47-58).
const GRID = opt('grid', 343);
const THIEVING = opt('thieving', 50);
const AGILITY = opt('agility', 99);

/** %ibanmulti with the given bits set and the grid answer (three digits 1-5) in bits 22-31. */
function ibanmulti(bits: number[], grid = 343): number {
    let v = 0;
    for (const b of bits) v |= 1 << b;
    return (v | (grid << 22)) >>> 0;
}

const BIT = {
    blood: 1, dove: 2, ashes: 3, shadow: 4, orb1: 5, orb2: 6, orb3: 7, orb4: 8, cat: 9, randas: 10, started: 11, crate: 12, jerro: 13,
    badge1: 14, badge2: 15, badge3: 16, koftikInsane: 17, horn: 18, history: 19, inscription: 20, brew: 21,
};

/** Crossings whose loc can be clicked from afar (the server walks the player to it): clicked from 8 tiles out. */
const DIRECT_CLICK = new Set(['rockslide', 'stonebridge', 'stairs', 'unicorn_door', 'temple_door2', 'well_down', 'mudpile_up', 'pipe6', 'pipe4', 'exit_cave', 'enter_cave', 'rockpile']);
/** The failure message of each rolled crossing, plus generic refusals. */
const CROSSING_FAIL = /slip back down|slip and tumble|fall off it|fall in to the darkness|rat pit|fail to pick|just misses|can't reach|cannot|refuses|is locked|You need|being used/i;

/** A named point of the route planner. */
function pt(name: string): T {
    const t = P[name];
    if (!t) throw new Error(`no route point ${name}`);
    return t;
}

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, segment);
    const here = (): T => {
        const p = pos(sdk);
        return [p.x, p.z, p.level];
    };
    const isAt = (t: T) => at(t[0], t[1], t[2])(sdk.getState()!);
    const hp = () => sdk.getState()?.player?.hp ?? 0;
    const maxHp = () => sdk.getState()?.player?.maxHp ?? 99;
    const teleTo = (t: T) => mustTele(sdk, t[0], t[1], t[2]);

    // Click builders for `step`. The item is checked when the step is set up; a
    // re-send after the item is used up sends nothing.
    const clickLoc = (id: number, x: number, z: number, op = 1) => () => sdk.sendInteractLoc(x, z, id, op);
    const useOnLoc = (item: RegExp, id: number, x: number, z: number) => {
        slotOf(sdk, item);
        return async () => {
            const it = invItem(sdk, item);
            if (it) await sdk.sendUseItemOnLoc(it.slot, x, z, id);
        };
    };
    const useOnItem = (a: RegExp, b: RegExp) => {
        slotOf(sdk, a);
        slotOf(sdk, b);
        return async () => {
            const x = invItem(sdk, a);
            const y = invItem(sdk, b);
            if (x && y) await sdk.sendUseItemOnItem(x.slot, y.slot);
        };
    };

    const finish = (seg: Segment, hp0: number, extra: Record<string, unknown> = {}) => {
        Object.assign(seg, { hpLost: hp0 - hp(), ...extra });
        const msgs = messagesSince(sdk, seg.startTick).slice(0, 6);
        const done = rec.end()!;
        if (msgs.length) console.log(`    msgs: ${JSON.stringify(msgs)}`);
        return done;
    };

    /**
     * One timed step: `click`, then `done` (through act, which re-sends a click
     * that was evidently dropped unless `resendEvery` is 0), then idle. Without
     * `done` the click runs once.
     */
    const step = async (label: string, click: () => Promise<unknown>, done?: Pred, o: ActOptions = {}): Promise<Segment> => {
        await idle(sdk, { maxTicks: 80 });
        const hp0 = hp();
        const seg = rec.begin(label);
        let doneAfter: number | null = null;
        try {
            if (done) {
                const r = await act(sdk, click, done, { maxTicks: 120, ...o });
                rec.interact(1 + r.resends);
                if (r.resends) seg.resends = r.resends;
                if (r.ok) {
                    doneAfter = r.ticks;
                    rec.mark(seg.startTick + r.ticks);
                } else rec.note(`not done after ${r.ticks} ticks`);
            } else {
                const r = await click();
                rec.interact();
                if (r && typeof r === 'object' && 'ok' in r && r.ok === false) rec.note('not done');
            }
        } catch (e) {
            rec.end(`error: ${(e as Error).message}`);
            throw e;
        }
        const i = await idle(sdk, { maxTicks: 80 });
        rec.mark(i.last);
        seg.levelUps += i.levelUps;
        return finish(seg, hp0, { doneAfter });
    };

    /** Talk to an NPC and answer with a priority list of choices; from the first click to the dialogue closed. */
    const talk = async (label: string, npc: RegExp, choices: RegExp[] = [/./]) => {
        await idle(sdk, { maxTicks: 80 });
        const hp0 = hp();
        const seg = rec.begin(label, 'dialogue');
        const r = await talkTo(sdk, npc, choices, { keep: true, findTicks: 20 });
        rec.dialogue(r);
        rec.interact(r.clicks);
        if (!r.opened) rec.note('no dialogue opened');
        return finish(seg, hp0, { dialogueTicks: r.opened ? r.endTick - r.firstTick : 0 });
    };

    /** Answer the dialogue that `click` opens (or that is already open), then idle. */
    const dialogue = async (label: string, click: (() => Promise<unknown>) | null, choices: RegExp[] = [/./]) => {
        await idle(sdk, { maxTicks: 80 });
        const hp0 = hp();
        const seg = rec.begin(label, 'dialogue');
        const conv = converse(sdk, choices, { keep: true });
        if (click) {
            await click();
            rec.interact();
        }
        const r = rec.dialogue(await conv);
        const i = await idle(sdk, { maxTicks: 80 });
        if (i.changed) rec.mark(i.last);
        seg.levelUps += i.levelUps;
        return finish(seg, hp0, { dialogueTicks: r.opened ? r.endTick - r.firstTick : 0 });
    };

    /** Fight an NPC to the end on combat.fight, eating swordfish below 40% hitpoints. */
    const fightRow = async (label: string, re: RegExp) => {
        await idle(sdk, { maxTicks: 80, still: 1 });
        const npc = await waitForNpc(sdk, re, 30);
        if (!npc) throw new Error(`no npc ${re}`);
        const hp0 = hp();
        const seg = rec.begin(label, 'fight');
        const r = await fight(sdk, npc, { eatBelow: maxHp() * 0.4, food: /^Swordfish$/i, maxTicks: 600 });
        rec.mark(seg.startTick + r.ticks);
        rec.interact(r.attacks + r.eats);
        seg.levelUps += r.levelUps;
        if (!r.ok || r.end === 'dialog') rec.note(r.end);
        return finish(seg, hp0, { fightEnd: r.end, killed: r.end === 'killed' || r.end === 'gone', hp0, minHp: r.minHp, eaten: r.eats, attacks: r.attacks, dealt: r.dealt, taken: r.taken });
    };

    /** A value read between steps (a varp, a count): a 0-tick row. */
    const value = (label: string, extra: Record<string, unknown>) => rec.add({ name: label, ticks: 0, kind: 'value', ...extra });
    /** A whole stretch's wall-clock span, kept out of the step total. */
    const wall = (label: string, ticks: number, extra: Record<string, unknown> = {}) => rec.add({ name: label, ticks: 0, kind: 'total', wallTicks: ticks, note: `${ticks} ticks wall clock`, ...extra });

    /**
     * Walk the cheapest planned route to `dst` for real. Walking runs are sent
     * as run clicks of up to `reach` tiles, the next one sent when the player
     * is within 2 tiles of the last; each crossing is clicked on its loc. A
     * failed crossing (an agility roll) re-plans from wherever the player
     * lands. One segment from the first click to idle at the destination.
     */
    const travel = async (label: string, dst: T, opts: { allow?: (kind: string) => boolean; reach?: number } = {}) => {
        // winding cave routes can exceed the client's 25-turn click route, so keep clicks short
        const reach = opts.reach ?? 10;
        await idle(sdk, { maxTicks: 80 });
        const hp0 = hp();
        const seg = rec.begin(label, 'travel');
        const tiles = tileCounter(sdk);
        // food eaten while travelling, one click each; walking continues
        const upkeep = new Upkeep(sdk, { eatBelow: maxHp() * 0.45 });
        const crossings: string[] = [];
        const fails: string[] = [];
        const detail: string[] = [];
        let replans = 0;
        let resends = 0;
        let doors = 0;
        try {
            for (let attempt = 0; attempt < 12; attempt++) {
                const p = plan(here(), dst, opts.allow);
                if (!p) throw new Error(`${label}: no route from ${here()} to ${dst}`);
                let failed = false;
                let i = 0;
                while (i < p.steps.length && !failed) {
                    // gather the walking run up to the next crossing
                    const run: T[] = [];
                    while (i < p.steps.length && !p.steps[i]!.edge) run.push(p.steps[i++]!.t);
                    const edge = p.steps[i]?.edge;
                    // walk the run (all of it, unless the crossing's loc can be clicked from afar);
                    // a loc clicked from afar is approached by the server, so keep that to the last 8 tiles
                    const stopAt = edge && DIRECT_CLICK.has(edge.kind) && run.length > 0 ? Math.max(0, run.length - 8) : run.length;
                    const tw = currentTick(sdk);
                    const tiles0 = tiles.tiles;
                    let k = 0;
                    while (k < stopAt) {
                        const cur = pos(sdk);
                        let j = k;
                        while (j + 1 < stopAt && chebyshev({ x: run[j + 1]![0], z: run[j + 1]![1] }, cur) <= reach) j++;
                        const target = run[j]!;
                        const final = j === stopAt - 1;
                        await sdk.sendWalk(target[0], target[1], true);
                        let lq = pos(sdk);
                        let moved = currentTick(sdk);
                        let walkResends = 0;
                        await waitUntil(
                            sdk,
                            s => {
                                upkeep.step(s);
                                const q = pos(s);
                                const d = chebyshev(q, { x: target[0], z: target[1] });
                                if (final ? d === 0 : d <= 2) return true;
                                if (q.x !== lq.x || q.z !== lq.z) moved = s.tick;
                                lq = q;
                                if (s.tick - moved < 2) return false;
                                // A click during a forced move is dropped: send it again; after 6 tries
                                // accept stopping short (an NPC standing on the tile). The planner treats
                                // doors as open, so a stall next to a closed door opens it.
                                if (walkResends >= 6) return true;
                                walkResends++;
                                moved = s.tick;
                                const door = s.nearbyLocs.filter(l => /door/i.test(l.name) && opIndex(l, 'Open') !== undefined && chebyshev(l, q) <= 5).sort((a, b) => a.distance - b.distance)[0];
                                if (door && walkResends <= 3) {
                                    doors++;
                                    void sdk
                                        .sendInteractLoc(door.x, door.z, door.id, opIndex(door, 'Open')!)
                                        .then(() => sdk.waitForTicks(2))
                                        .then(() => sdk.sendWalk(target[0], target[1], true));
                                } else {
                                    resends++;
                                    void sdk.sendWalk(target[0], target[1], true);
                                }
                                return false;
                            },
                            { maxTicks: 60 }
                        );
                        k = j + 1;
                    }
                    if (stopAt > 0) detail.push(`walk ${tiles.tiles - tiles0} tiles ${currentTick(sdk) - tw}t`);
                    if (!edge) break;
                    const te = currentTick(sdk);
                    const c = edge.click!;
                    const send = c.item ? useOnLoc(c.item, c.id, c.x, c.z) : clickLoc(c.id, c.x, c.z, c.op ?? 1);
                    await send();
                    const to = edge.to;
                    const from = pos(sdk);
                    // one- and two-tile crossings must land exactly; longer ones within a tile
                    const tol = chebyshev({ x: edge.from[0], z: edge.from[1] }, { x: to[0], z: to[1] }) <= 2 ? 0 : 1;
                    const arrived = (q: { x: number; z: number; level: number }) => (to[2] !== edge.from[2] ? q.level === to[2] : q.level === to[2] && chebyshev(q, { x: to[0], z: to[1] }) <= tol);
                    // A click sent while a forced move is still running is dropped: re-send it
                    // after a tick with no movement, as long as nothing has been said since the click.
                    let lastQ = from;
                    let quiet = te;
                    let resent = 0;
                    const r = await waitUntil(
                        sdk,
                        s => {
                            const said = messagesSince(s, te + 1);
                            if (said.some(t => CROSSING_FAIL.test(t))) return true;
                            const q = pos(s);
                            if (arrived(q)) return true;
                            if (q.x !== lastQ.x || q.z !== lastQ.z || said.length > 0) quiet = s.tick;
                            lastQ = q;
                            if (s.tick - quiet >= 1 && resent < 20) {
                                quiet = s.tick;
                                resent++;
                                void send();
                            }
                            return false;
                        },
                        { maxTicks: 90 }
                    );
                    resends += resent;
                    const failMsg = messagesSince(sdk, te + 1).find(t => CROSSING_FAIL.test(t));
                    if (!r.ok || failMsg) {
                        await idle(sdk, { maxTicks: 80 });
                        const q = pos(sdk);
                        const moved = chebyshev(q, from) > 3 || q.level !== from.level;
                        fails.push(`${edge.kind}${edge.note.startsWith('(') ? ' ' + edge.note : ''}: ${failMsg ?? `no arrival at ${to}, now ${here()}`}`);
                        failed = true;
                        if (!failMsg && !moved) throw new Error(`${label}: stuck at ${edge.kind} ${edge.note} from ${from.x},${from.z},${from.level} want ${to} now ${here()} msgs ${JSON.stringify(messagesSince(sdk, te + 1))}`);
                        break;
                    }
                    if (!isAt(to)) {
                        // landed next to the planned tile: re-plan from here
                        await sdk.waitForTicks(1);
                        if (chebyshev(pos(sdk), { x: to[0], z: to[1] }) > 0) {
                            crossings.push(edge.kind);
                            failed = true;
                            break;
                        }
                    }
                    crossings.push(edge.kind + (edge.note.startsWith('(') ? ' ' + edge.note : ''));
                    detail.push(`${edge.kind} ${currentTick(sdk) - te}t${resent ? ` (${resent} re-clicks)` : ''}`);
                    i++;
                }
                if (!failed) break;
                replans++;
            }
            const i = await idle(sdk, { maxTicks: 80 });
            rec.mark(i.last);
            seg.levelUps += i.levelUps;
        } finally {
            tiles.stop();
        }
        rec.interact(crossings.length);
        return finish(seg, hp0, { crossings: crossings.length, crossingList: crossings, fails, replans, resends, eaten: upkeep.eats, doors, detail, at: here() });
    };

    await bot.dismissBlockingUI();
    await setvar(sdk, 'biohazard', 16); // ^biohazard_complete, needed by the cave entrance (quest_upass.rs2:81)
    // King Lathas talks Regicide first whenever %regicide_quest > 0 (king_lathas.rs2:2); only `post` sets it.
    await setvar(sdk, 'regicide_quest', 0);

    /** Walk the trap grid on its safe strips (upass_grid.rs2:61-83), from the east edge to the lever, and pull it. */
    const grid = async (answer: number) => {
        const [d0, d1, d2] = [Math.floor(answer / 100) % 10, Math.floor(answer / 10) % 10, answer % 10];
        const row = (n: number) => 9673 + 2 * (n - 1);
        const pts: T[] = [[2477, row(d0), 0], [2474, row(d0), 0], [2474, row(d1), 0], [2469, row(d1), 0], [2469, row(d2), 0], [2466, row(d2), 0], [2466, 9673, 0]];
        await step(`grid walk (answer ${answer})`, async () => {
            for (const p of pts) {
                if (isAt(p)) continue;
                await sdk.sendWalk(p[0], p[1], true);
                await waitUntil(sdk, s => at(p[0], p[1], p[2])(s) || pos(s).z < 9600, { maxTicks: 30 });
                if (!isAt(p)) throw new Error(`grid: did not reach ${p} (at ${here()})`);
            }
        });
        await step('portcullis lever', clickLoc(3337, 2466, 9672, 1), at(2464, 9677, 0));
    };

    /**
     * Koftik's damp cloth, a lit bronze fire arrow, the shot from (2446,9722).
     * A miss costs the arrow (upass_bridge.rs2:63-71): back to Koftik for another cloth.
     */
    const crossBridge = async () => {
        const west = pt('bridgeWest');
        for (let shot = 1; shot <= 6; shot++) {
            if (shot > 1) await travel('back to Koftik after a miss', [2448, 9716, 0]);
            await talk(`Koftik (damp cloth), shot ${shot}`, /Koftik/, [/litter/i, /./]);
            await step('wrap cloth on bronze arrow', useOnItem(/^Damp cloth$/i, /^Bronze arrow$/i), s => invCount(s, /fire arrow/i) > 0);
            await step('light it with the tinderbox', useOnItem(/^Tinderbox$/i, /fire arrow/i), s => s.inventory.some(i => i.id === 942));
            await step('wield the lit arrow', () => wield(sdk, /^Bronze fire arrows$/i));
            await travel('Koftik -> shooting spot (2446,9722)', pt('shootSpot'));
            // no re-send: the shot is a roll, and the bridge's scripted fall holds the player still
            await step(`fire at the guide rope, shot ${shot}`, clickLoc(3340, 2443, 9718, 1), s => at(west[0], west[1], west[2])(s) || messagesSince(s, rec.cur?.startTick ?? 0, /just misses/).length > 0, { resendEvery: 0 });
            if (isAt(west)) return shot;
        }
        throw new Error('bridge: six misses');
    };

    const ATT = opt('att', 70), STR = opt('str', 70), DEF = opt('def', 70), HP = opt('hp', 70);
    /** Melee stats, rune scimitar, rune armour (no platebody: Dragon Slayer), amulet of strength, swordfish. */
    const gear = async (food = 10) => {
        await setStats(sdk, { attack: ATT, strength: STR, defence: DEF, hitpoints: HP, agility: AGILITY, thieving: THIEVING, ranged: 60, prayer: 1 });
        await clearInventory(sdk);
        for (const g of ['rune_scimitar', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength']) {
            await give(sdk, g);
            await wield(sdk, new RegExp(`^${g.replace(/_/g, ' ')}$`, 'i'));
        }
        await give(sdk, 'swordfish', food);
        await sdk.sendSetCombatStyle(1); // aggressive
        await waitTicks(sdk, 2);
    };
    const vars = async (upass: number, bits: number[]) => {
        await setvar(sdk, 'upass', upass);
        await setvar(sdk, 'ibanmulti', ibanmulti([BIT.started, BIT.koftikInsane, ...bits], GRID));
    };
    const take = async (label: string, re: RegExp) => {
        await waitUntil(sdk, s => s.groundItems.some(g => re.test(g.name)), { maxTicks: 10 });
        return step(label, () => pickup(sdk, re));
    };
    /** Dwarf brew, Iban's ashes from the tomb, Kalrag's blood, the dove: the doll's other three parts. */
    const brewToDove = async () => {
        await travel('-> brew barrel (west side)', pt('barrel'));
        await step('bucket on the barrel: dwarf brew', useOnLoc(/^Bucket$/i, 3344, 2327, 9799), s => invCount(s, /brew/i) > 0);
        await travel('-> Iban\'s tomb', pt('tomb'));
        await step('brew on the tomb', useOnLoc(/brew/i, 3353, 2356, 9800), s => invCount(s, /brew/i) === 0);
        await step('tinderbox on the tomb: Iban\'s ashes', useOnLoc(/^Tinderbox$/i, 3353, 2356, 9800), s => invCount(s, /ashes/i) > 0);
        await step('ashes on the doll (p_delay 7)', useOnItem(/ashes/i, /doll/i), s => invCount(s, /ashes/i) === 0);
        await travel('tomb -> Kalrag', pt('kalrag'));
        await fightRow('fight Kalrag (lvl 89, 78 hp)', /Kalrag/);
        await idle(sdk, { maxTicks: 80, still: 4 });
        value('ibanmulti after Kalrag', { value: await getvar(sdk, 'ibanmulti') });
        await travel('Kalrag -> north stairs -> dove cage', pt('doveCage'));
        await step('search the cage: Iban\'s dove (bitten, no gauntlets)', clickLoc(3351, 2134, 4702, 1), s => invCount(s, /dove/i) > 0);
        await step('dove on the doll', useOnItem(/dove/i, /doll/i), s => invCount(s, /dove/i) === 0);
    };
    const ORBS = [BIT.orb1, BIT.orb2, BIT.orb3, BIT.orb4];
    const BADGES = [BIT.badge1, BIT.badge2, BIT.badge3, BIT.horn];
    const ORB = /^Orb of light$/i;

    if (segment === 'start') {
        // King Lathas starts the quest; Koftik outside the cave sets %upass 1.
        await setStats(sdk, { ranged: 25 });
        await setvar(sdk, 'upass', 0);
        await setvar(sdk, 'ibanmulti', 0);
        await mustTele(sdk, 2578, 3294, 1); // inside the throne room door (2575,3293)
        await talk('King Lathas (start, %upass 0)', /King Lathas/);
        value('ibanmulti after Lathas', { value: await getvar(sdk, 'ibanmulti') });
        await mustTele(sdk, 2434, 3313, 0);
        await dialogue('cave entrance at %upass 0: Koftik first dialogue', clickLoc(3213, 2433, 3313, 1), [/take my chances/i]);
        value('upass after Koftik', { value: await getvar(sdk, 'upass') });
        const landing = pt('landing');
        await step('cave entrance: enter', clickLoc(3213, 2433, 3313, 1), at(landing[0], landing[1], landing[2]));
    } else if (segment === 'entry') {
        // %upass 1: into the cave, Koftik's cloth, the bridge shot (2), the rope swing, the grid, the lever.
        await setStats(sdk, { agility: AGILITY, thieving: THIEVING, ranged: opt('ranged', 60), hitpoints: 99 });
        await vars(1, []);
        await setvar(sdk, 'ibanmulti', ibanmulti([BIT.started], GRID));
        await clearInventory(sdk);
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 2], ['spade', 1], ['swordfish', 5]] as const) await give(sdk, n, c);
        await wield(sdk, /^Shortbow$/i);
        await mustTele(sdk, 2434, 3313, 0);
        const t0 = currentTick(sdk);
        await travel('cave entrance -> Koftik at the bridge', [2448, 9716, 0]);
        const shots = await crossBridge();
        value('bridge shots needed', { shots, upass: await getvar(sdk, 'upass') });
        await travel('bridge west bank -> grid east edge (rope swing)', pt('gridEast'));
        await grid(GRID);
        wall('TOTAL cave entrance to through the portcullis (known grid)', currentTick(sdk) - t0);
    } else if (segment === 'gridfall') {
        // One wrong step on the grid: the fall, the climb out, and back at the east edge.
        await setStats(sdk, { hitpoints: 99 });
        await vars(2, []);
        await teleTo(pt('gridEast'));
        const wrong = Math.floor(GRID / 100) === 1 ? 2 : 1;
        await step('step onto a trapped grid tile', () => sdk.sendWalk(2475, 9673 + 2 * (wrong - 1), true), s => pos(s).z < 9600);
        // the fall lands on one of the four hand-hold tiles at random (upass_grid.rs2:94); click the one underfoot or next to it
        const p = pos(sdk);
        const holds: Array<[number, number]> = [[2395, 9559], [2395, 9560], [2396, 9559], [2396, 9560]];
        const dist = (h: [number, number]) => Math.abs(h[0] - p.x) + Math.abs(h[1] - p.z);
        const hold = [...holds].sort((a, b) => dist(a) - dist(b))[0]!;
        await step(
            `climb the protruding rocks out of the pit (landed ${p.x},${p.z},${p.level})`,
            async () => {
                for (const [x, z] of [hold, [2395, 9559], [2396, 9560], [2395, 9560], [2396, 9559]] as Array<[number, number]>) {
                    await sdk.sendInteractLoc(x, z, 3365, 1);
                    await waitTicks(sdk, 3);
                    if (pos(sdk).z > 9600) return;
                }
            },
            at(2477, 9677, 0),
            { resendEvery: 0 }
        );
    } else if (segment === 'swingfail') {
        // Cost of a failed rope swing: from the pit landing back to the swing with a new rope.
        await setStats(sdk, { agility: AGILITY, ranged: 60, hitpoints: 99 });
        await vars(2, []);
        await clearInventory(sdk);
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 1]] as const) await give(sdk, n, c);
        await wield(sdk, /^Shortbow$/i);
        await mustTele(sdk, 2485, 9649, 0);
        const t0 = currentTick(sdk);
        await travel('pit landing -> rock pile -> Koftik', [2448, 9716, 0]);
        await crossBridge();
        await travel('bridge west bank -> rope swing done', [2466, 9699, 0]);
        wall('TOTAL rope swing failure recovery (pit to across the swing)', currentTick(sdk) - t0);
    } else if (segment === 'ledgefail') {
        await setStats(sdk, { agility: AGILITY, thieving: THIEVING, hitpoints: 99 });
        await vars(3, ORBS);
        await clearInventory(sdk);
        await give(sdk, 'spade');
        await mustTele(sdk, 2373, 9641, 0);
        await travel('rat pit -> ledge top', pt('ledgeTop'));
    } else if (segment === 'bridgefall') {
        await setStats(sdk, { agility: AGILITY, hitpoints: 99 });
        await vars(7, [...ORBS, ...BADGES]);
        for (const land of [[2335, 9821, 0], [2333, 9866, 0]] as T[]) {
            await teleTo(land);
            await travel(`bridge fall landing ${land} -> back at the bridge (2155,4718)`, [2155, 4721, 1]);
        }
    } else if (segment === 'orbs') {
        // %upass 2, through the portcullis: four orbs, the furnace, the well (-> 3).
        await setStats(sdk, { agility: AGILITY, thieving: THIEVING, hitpoints: 99 });
        await vars(2, []);
        await clearInventory(sdk);
        await setStats(sdk, { hitpoints: HP });
        await give(sdk, 'swordfish', 20);
        await teleTo(pt('afterPortcullis'));
        const t0 = currentTick(sdk);
        await travel('portcullis -> orb 1 trap (flat rock)', pt('orb1trap'));
        for (let k = 0; k < 6 && invCount(sdk, ORB) < 1; k++) {
            await dialogue(`disarm the log trap for orb 1, try ${k + 1}`, clickLoc(3339, 2382, 9668, 1), [/give it a go/i]);
            await idle(sdk, { maxTicks: 80 });
        }
        await travel('-> orb 2', pt('orb2'));
        await take('take orb 2', ORB);
        await travel('-> orb 3', pt('orb3'));
        await take('take orb 3', ORB);
        await travel('-> orb 4', pt('orb4'));
        await take('take orb 4', ORB);
        value('orbs held', { orbs: invCount(sdk, ORB) });
        await travel('-> furnace', pt('furnace'));
        for (let k = 0; k < 4; k++) {
            const before = invCount(sdk, ORB);
            await step(`orb ${k + 1} into the furnace`, useOnLoc(ORB, 3294, 2454, 9682), s => invCount(s, ORB) < before);
        }
        value('ibanmulti after furnace', { value: await getvar(sdk, 'ibanmulti') });
        await travel('furnace -> down the well', pt('wellBottom'));
        wall('TOTAL portcullis to the well bottom', currentTick(sdk) - t0, { upass: await getvar(sdk, 'upass') });
    } else if (segment === 'area2') {
        // %upass 3: cage, mud, ledge, cages (Thieving 50) or stone bridges, pipe, railing, boulder (-> 4), horn, tunnel.
        await setStats(sdk, { agility: AGILITY, thieving: THIEVING, hitpoints: 99 });
        await vars(3, ORBS);
        await clearInventory(sdk);
        await give(sdk, 'spade');
        await give(sdk, 'swordfish', 3);
        await teleTo(pt('wellBottom'));
        const t0 = currentTick(sdk);
        await travel('well bottom -> pipe east end', pt('pipeEast'), { allow: k => THIEVING >= 50 || k !== 'railing5' });
        await step('squeeze through the pipe (%upass 3: 1-tile jump)', clickLoc(3237, 2417, 9605, 1), at(2412, 9605, 0));
        await travel('-> unicorn cage', pt('unicornCage'));
        await step('search the cage: piece of railing', clickLoc(3267, 2397, 9605, 2), s => invCount(s, /railing/i) > 0);
        await step(
            'railing on the boulder (unicorn killed)',
            async () => {
                const b = await waitForNpc(sdk, /Boulder/, 20);
                if (!b) throw new Error('no Boulder in view');
                await sdk.sendUseItemOnNpc(slotOf(sdk, /railing/i), b.index);
            },
            s => s.dialog.isOpen || pos(s).x < 2380,
            { resendEvery: 0 }
        );
        await dialogue('"I heard something breaking."', null, [/./]);
        value('upass after boulder', { value: await getvar(sdk, 'upass'), at: here() });
        await dialogue('search the smashed cage: unicorn horn', clickLoc(3308, 2371, 9603, 1), [/./]);
        await travel('-> tunnel to area 3', pt('area3'));
        wall('TOTAL well bottom to area 3', currentTick(sdk) - t0, { horn: invCount(sdk, /horn/i) });
    } else if (segment === 'paladins') {
        // %upass 4: three paladins, badges and horn into the well, the door (-> 5).
        await gear(15);
        await vars(4, ORBS);
        await give(sdk, 'cave_unicorn_horn');
        await teleTo(pt('area3'));
        const t0 = currentTick(sdk);
        await travel('area 3 -> paladins', [2423, 9716, 0]);
        for (const [name, badge] of [['Sir Jerro', 1], ['Sir Carl', 2], ['Sir Harry', 3]] as const) {
            await fightRow(`fight ${name} (lvl 62, 57 hp)`, new RegExp(name));
            await waitTicks(sdk, 1);
            await take(`pick up ${name}'s badge`, /badge/i).catch(e => value(`badge ${badge} missing`, { err: String(e) }));
        }
        await travel('paladins -> well of flames', pt('bloodwell'));
        for (const it of [/badge/i, /badge/i, /badge/i, /horn/i]) {
            const n0 = invCount(sdk, it);
            await step(`throw ${it} into the well`, useOnLoc(it, 3305, 2373, 9718), s => invCount(s, it) < n0);
        }
        await step('open the door to Iban\'s cavern', clickLoc(3220, 2368, 9717, 1), s => pos(s).level === 1);
        wall('TOTAL area 3 to the cavern', currentTick(sdk) - t0, { upass: await getvar(sdk, 'upass') });
    } else if (segment === 'cavern') {
        // %upass 5 at the cavern door: Nilhoof (6), cat, witch, chest (7), demons, shadow, brew, ashes, Kalrag, dove.
        await gear(15);
        await vars(5, [...ORBS, ...BADGES]);
        await give(sdk, 'bucket_empty');
        await give(sdk, 'tinderbox');
        await teleTo(pt('mainArrival'));
        const t0 = currentTick(sdk);
        await travel('cavern arrival -> south stairs -> dwarves', pt('dwarfStairsFoot'));
        await travel('-> Nilhoof', pt('nilhoof'));
        await talk('Nilhoof (%upass 5 -> 6)', /Nilhoof/);
        await travel('Nilhoof -> stairs up', pt('stairsSouth'));
        await travel('-> witch\'s cat', pt('cat'));
        await step(
            'pick up the cat',
            async () => {
                const c = findNpc(sdk, /Witches cat/);
                if (c) await sdk.sendInteractNpc(c.index, 1);
            },
            s => invCount(s, /cat/i) > 0
        );
        await travel('cat -> witch\'s door', pt('witchDoor'));
        await step('cat on the witch\'s door (hide, %ibanmulti bit 9)', useOnLoc(/cat/i, 3270, 2158, 4566), s => invCount(s, /cat/i) === 0);
        await step('open the door', clickLoc(3270, 2158, 4566, 1));
        await dialogue('open the chest: doll, journal, potions (%upass 7)', clickLoc(3272, 2157, 4564, 1), [/./]);
        value('upass after chest', { value: await getvar(sdk, 'upass'), doll: invCount(sdk, /doll/i) });
        // the door closes behind you (open_and_close_door3); open it again to leave
        await step('leave the witch\'s house', clickLoc(3270, 2158, 4566, 1), s => pos(s).z >= 4566);
        const demons: Array<[string, RegExp, T]> = [['Doomion', /doomion/i, pt('doomion')], ['Holthion', /holthion/i, pt('holthion')], ['Othainian', /othanian/i, pt('othainian')]];
        for (const [name, amulet, where] of demons) {
            await travel(`-> ${name}`, where);
            await fightRow(`fight ${name} (lvl 91, 87 hp)`, new RegExp(name));
            await waitTicks(sdk, 1);
            await take(`pick up the amulet of ${name}`, amulet).catch(e => value(`amulet ${name} missing`, { err: String(e) }));
        }
        await travel('-> the sealed chest', pt('shadowChest'));
        await step('open the chest with three amulets: Iban\'s shadow', clickLoc(3274, 2136, 4578, 1), s => invCount(s, /shadow/i) > 0);
        await step('shadow on the doll', useOnItem(/shadow/i, /doll/i), s => invCount(s, /shadow/i) === 0);
        await travel('-> south stairs -> dwarves', pt('dwarfStairsFoot'));
        await brewToDove();
        wall('TOTAL cavern arrival to the doll complete', currentTick(sdk) - t0, { ibanmulti: await getvar(sdk, 'ibanmulti') });
    } else if (segment === 'brew') {
        // resume the cavern at the dwarves: %upass 7, doll holding the shadow
        await gear(15);
        await vars(7, [...ORBS, ...BADGES, BIT.cat, BIT.shadow]);
        await give(sdk, ['ibandoll', 'bucket_empty', 'tinderbox']);
        await teleTo(pt('dwarfStairsFoot'));
        const t0 = currentTick(sdk);
        await brewToDove();
        wall('TOTAL dwarf stairs to the doll complete', currentTick(sdk) - t0, { ibanmulti: await getvar(sdk, 'ibanmulti') });
    } else if (segment === 'fights') {
        // Every fight, `--rounds` times, at --att/--str/--def/--hp, rune scimitar and rune armour.
        const rounds = opt('rounds', 2);
        await vars(7, [...ORBS, ...BADGES]);
        const targets: Array<[string, RegExp, T]> = [
            ['Sir Jerro', /Sir Jerro/, [2423, 9719, 0]], ['Sir Carl', /Sir Carl/, [2421, 9717, 0]], ['Sir Harry', /Sir Harry/, [2425, 9717, 0]],
            ['Doomion', /Doomion/, [2136, 4567, 1]], ['Holthion', /Holthion/, [2134, 4556, 1]], ['Othainian', /Othainian/, [2124, 4562, 1]],
            ['Kalrag', /Kalrag/, [2356, 9906, 0]], ['Iban disciple', /Iban disciple/, [2153, 4646, 1]],
        ];
        for (let r = 1; r <= rounds; r++) {
            for (const [name, re, where] of targets) {
                await gear(20);
                await teleTo(where);
                await waitUntil(sdk, s => findNpc(s, re) !== null, { maxTicks: 120 }); // respawn
                if (!findNpc(sdk, re)) {
                    value(`${name}: not spawned`, {});
                    continue;
                }
                await fightRow(`round ${r}: ${name} at ${ATT}/${STR}/${DEF}, ${HP} hp`, re);
            }
        }
    } else if (segment === 'iban') {
        // %upass 7, doll complete: a disciple's robes, wear only them, the temple, the doll in the pit (-> 9), Koftik, out.
        await gear(10);
        await vars(7, [...ORBS, ...BADGES, BIT.blood, BIT.dove, BIT.ashes, BIT.shadow]);
        await give(sdk, 'ibandoll');
        await teleTo(pt('doveCage'));
        const t0 = currentTick(sdk);
        await travel('dove cage -> disciples', pt('disciples'));
        await fightRow('fight an Iban disciple (lvl 13, 20 hp)', /Iban disciple/);
        await waitTicks(sdk, 1);
        await take('pick up a robe', /Robe of zamorak/i);
        await take('pick up the other robe', /Robe of zamorak/i).catch(() => undefined);
        await step(
            'unequip everything',
            async () => {
                for (const e of sdk.getEquipment()) await bot.unequipItem(e);
            },
            s => s.equipment.length === 0,
            { resendEvery: 0 }
        );
        await step(
            'wear both robes',
            async () => {
                for (const r of (sdk.getState()?.inventory ?? []).filter(i => /Robe of zamorak/i.test(i.name))) {
                    const o = opIndex(r, /^(wear|wield)$/i);
                    if (o !== undefined) await sdk.sendUseItem(r.slot, o);
                }
            },
            s => s.equipment.length === 2,
            { resendEvery: 0 }
        );
        await travel('-> temple doors', pt('templeDoor'));
        await step('open the temple doors (%upass 8)', clickLoc(3334, 2143, 4647, 1), s => pos(s).x <= 2142);
        // a use sent during the doors' forced move (or Iban's bolt knock-back) answers "I can't reach that!": act sends it again
        await step('doll into the pit: Iban destroyed (%upass 9)', useOnLoc(/doll/i, 3359, 2136, 4647), s => pos(s).level === 0, { maxTicks: 200 });
        value('upass after the pit', { value: await getvar(sdk, 'upass'), at: here(), hp: hp() });
        await travel('thrown from the temple -> Koftik', pt('koftik5'));
        await talk('Koftik (leads you out)', /Koftik/);
        await waitTicks(sdk, 3);
        await travel('-> cave exit', pt('exit'));
        await step('leave the pass', clickLoc(3214, 2496, 9713, 1), s => pos(s).z < 4000);
        wall('TOTAL dove cage to outside the cave', currentTick(sdk) - t0);
    } else if (segment === 'handin') {
        await vars(9, []);
        await mustTele(sdk, 2578, 3294, 1);
        const agi0 = skillXp(sdk, 'agility');
        await talk('King Lathas (hand-in, %upass 9)', /King Lathas/);
        await idle(sdk, { maxTicks: 80, still: 6 });
        value('reward', { upass: await getvar(sdk, 'upass'), agilityXpGained: skillXp(sdk, 'agility') - agi0 });
    } else if (segment === 'post') {
        await setStats(sdk, { agility: AGILITY, thieving: THIEVING, ranged: 60, hitpoints: 99 });
        await setvar(sdk, 'upass', 10);
        await setvar(sdk, 'regicide_quest', 2);
        await setvar(sdk, 'ibanmulti', ibanmulti([BIT.started, BIT.orb1, BIT.orb2, BIT.orb3, BIT.orb4, BIT.badge1, BIT.badge2, BIT.badge3, BIT.horn, BIT.koftikInsane], GRID));
        await clearInventory(sdk);
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 1], ['spade', 1], ['swordfish', 5]] as const) await give(sdk, n, c);
        await wield(sdk, /^Shortbow$/i);
        for (const e of sdk.getEquipment()) if (/arrow/i.test(e.name)) await bot.unequipItem(e);
        await mustTele(sdk, 2434, 3313, 0);
        const t0 = currentTick(sdk);
        await travel('cave entrance -> Koftik at the bridge', [2448, 9716, 0]);
        await crossBridge();
        await travel('bridge west bank -> grid east edge (rope swing)', pt('gridEast'));
        await grid(GRID);
        await travel('portcullis -> Iban temple doors', pt('templeDoor'));
        await step('temple doors (east side, %regicide_quest 2)', clickLoc(3334, 2143, 4647, 1), s => pos(s).x < 2100);
        wall('TOTAL cave entrance click to through the temple doors', currentTick(sdk) - t0, { at: here() });
    } else {
        throw new Error(`unknown segment ${segment}`);
    }
    rec.report();
}, { timeout: 3_600_000, printState: false });
