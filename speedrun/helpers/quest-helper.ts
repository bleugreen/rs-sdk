// The H12o helper's quest substitutions (rs/465): a 99-melee account (Prayer, Magic and Ranged 1, no
// Plague City) runs Tree Gnome Village, The Grand Tree and Monkey Madness A-G on the demo through the
// generic demo driver, so it can stand on Ape Atoll at the end of MM segment G.
//
// The quest modules encode SCORED's run: Plague City done, Magic 51-59, Prayer 43, the boss fights by
// spell under Protect from Melee, and the Ardougne and Varrock teleports. Main's ruling (rs/41 and
// rs/185, 2026-10-22) is that the modules stay SCORED's and the helper's differences live here: every
// step runs as its module wrote it except these, and the rows of these are labelled `[driver]`, never
// reported as module samples.
//
//   Tree Gnome Village (S10b): A kit check (the helper's own kit, not H7), B maze and H stronghold
//     without the Protect from Melee toggles, K the warlord by melee with food.
//   The Grand Tree (S11b): A Narnode's start talk without SCORED's entry and kit checks, I the glider
//     and the shipyard without Protect from Melee, N1 the trapdoor scene without it, N2 the demon by
//     melee with food. Three travel legs replace teleports: before B (the stronghold's spirit tree to
//     the battlefield and a walk to Hazelmere, so B's "east of x 2600" skips its cast), before C (off
//     Hazelmere's floor and out of its box, so C takes the battlefield tree itself) and before J (the
//     Brimhaven ship to Ardougne and the battlefield tree to the village, so J skips its Varrock cast).
//   Monkey Madness (S15): A Narnode's start talk without the H12 kit and its bow (Ranged 50).
//
// Dropping a prayer toggle costs nothing at 99 Defence and Hitpoints: the commanders, the warlord and
// the demon hit through it, and food covers them. Auto-retaliate stays off for TGV (the brief, for the
// stronghold door), so a commander's swing never turns the account on him mid-click.
import type { BotWorldState } from '../../sdk/types';
import { act, actConverse, openDoor, talkTo, type ActSdk } from '../lib/act';
import { fight, type FightResult } from '../lib/combat';
import { converse, levelUpInterrupt, type ConverseSdk } from '../lib/converse';
import { questStatus } from '../lib/quests';
import { regionOf, sailTo, type Sailor } from '../lib/ships';
import { logNote } from '../lib/ticks';
import { inArea, runTo, spiritTree, type Area, type SpiritTree, type TravelSdk } from '../lib/travel';
import { waitUntil, type Pred } from '../lib/wait';
import { chebyshev, findLoc, invCount, opIndex, pos, worn, type LocQuery } from '../lib/world';
import { demonInSight, inTree, ITEM as GT_ITEM, TILES as GT } from '../quests/grand-tree';
import { atRailOut, inStronghold, inVillage, ITEM as TGV_ITEM, LADDER, RAIL_OUT, STRONGHOLD_DOOR, WALL_FOOT, WARLORD } from '../quests/tree-gnome-village';
import type { Check, StepContext } from '../runner/step';

/** A module step's replacement: its own run, and its own checks where the module's assume SCORED. */
export interface Substitute {
    run(ctx: StepContext<any>): Promise<void>;
    /** Default: none (the module's `pre` is bypassed on this step only). */
    preconditions?: Check<any>;
    /** Default: the module step's own postconditions. */
    postconditions?: Check<any>;
}

/** An untimed travel leg before a module step, in place of the teleport the step would cast. */
export type Leg = (ctx: StepContext<any>) => Promise<void>;

export interface QuestPlan {
    /** Keyed by segment letter. */
    substitute: Readonly<Record<string, Substitute>>;
    legs: Readonly<Record<string, Leg>>;
}

type Sdk = TravelSdk & ActSdk & ConverseSdk & Parameters<typeof fight>[0];
const sdkOf = (ctx: StepContext<any>) => ctx.sdk as unknown as Sdk;
const st = (ctx: StepContext<any>): BotWorldState => ctx.sdk.getState()!;
const interrupts = () => [levelUpInterrupt()];

export const SHARK = /^Shark$/i;
/** Eat a shark (20) below this: the demon's and the warlord's hits stay far under 60 against 99 Defence. */
export const EAT_BELOW = 60;
const EAT = { food: SHARK, below: EAT_BELOW } as const;

// ------------------------------------------------------------------ kit

export interface HelperKit {
    logs: number;
    sharks: number;
    weapon: RegExp;
}

/** At TGV's start: Montai's 6 logs, food for the warlord, the stronghold and the demon after it, the scimitar worn. */
export const TGV_KIT: HelperKit = { logs: 6, sharks: 15, weapon: /^Rune scimitar$/i };

export function kitCheck(s: BotWorldState, kit: HelperKit): true | string {
    const logs = invCount(s, TGV_ITEM.logs);
    if (logs < kit.logs) return `holds ${logs} logs, needs ${kit.logs} for Montai`;
    const sharks = invCount(s, SHARK);
    if (sharks < kit.sharks) return `holds ${sharks} sharks, wants ${kit.sharks}`;
    if (!worn(s, kit.weapon)) return `${kit.weapon.source} is not worn`;
    return true;
}

// ------------------------------------------------------------------ moves

const need = (ok: boolean, why: string): true | string => (ok ? true : why);
const all = (...cs: Array<true | string>): true | string => cs.find(c => c !== true) ?? true;
const status = (s: BotWorldState, q: 'tree' | 'grandtree' | 'mm') => questStatus(s, q) ?? 'unobservable';

/** Run to `to` eating on the way, three tries; throws when it does not arrive. */
async function go(ctx: StepContext<any>, to: Area, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        const r = await runTo(sdk, to, { bot: ctx.bot, eat: EAT });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) throw new Error(`${what}: run to ${to.x},${to.z} failed (${why}) at ${JSON.stringify(pos(sdk))}`);
}

/** A loc op confirmed by `done`. */
async function locOp(ctx: StepContext<any>, what: string, q: LocQuery, op: RegExp, done: Pred, maxTicks = 30): Promise<void> {
    const sdk = sdkOf(ctx);
    const l = await findLoc(sdk, { ...q, op });
    if (!l) throw new Error(`${what}: no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const r = await act(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, op)!), done, { maxTicks, resendEvery: 5, interrupts: interrupts() });
    if (!r.ok) throw new Error(`${what}: ${op} on (${l.x},${l.z}) did not take within ${maxTicks} ticks at ${JSON.stringify(pos(sdk))}`);
}

/** A loc op that opens pages (a wall's mesbox, a gate's password), answered until `done` with the chat closed. */
async function locTalk(ctx: StepContext<any>, what: string, q: LocQuery, op: RegExp, choices: RegExp[], done: Pred, maxTicks = 60): Promise<void> {
    const sdk = sdkOf(ctx);
    const l = await findLoc(sdk, { ...q, op });
    if (!l) throw new Error(`${what}: no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, op)!), choices, {
        done, idle: 2, maxTicks, closeModals: true, unmatched: 'stop', interrupts: interrupts(), resendEvery: 5,
    });
    if (!r.ok) throw new Error(`${what}: ${r.reason} at ${JSON.stringify(pos(sdk))}`);
}

/** Talk to an NPC in fixed dialogue and answer it until `until` holds with the chat closed. */
async function talk(ctx: StepContext<any>, npc: RegExp, choices: RegExp[], until: Pred, near?: { x: number; z: number }): Promise<void> {
    const sdk = sdkOf(ctx);
    const r = await talkTo(sdk, npc, choices, {
        idle: 2, openTicks: 30, maxTicks: 600, unmatched: 'stop', closeModals: true, findTicks: 15, until, interrupts: interrupts(), ...(near ? { near } : {}),
    });
    if (!r.opened) throw new Error(`${npc.source}: no conversation opened after ${r.clicks} clicks`);
    if (!r.ok) throw new Error(`${npc.source}: ${r.reason} at ${JSON.stringify(pos(sdk))}; last pages: ${r.transcript.slice(-4).join(' | ')}`);
}

/** A melee fight with food: the 99-melee stand-in for a module's spell fight under Protect from Melee. */
export async function meleeFight(ctx: StepContext<any>, npc: RegExp, done?: Pred): Promise<FightResult> {
    return fight(sdkOf(ctx), npc, { eatBelow: EAT_BELOW, food: SHARK, maxTicks: 1500, findTicks: 15, onDialog: 'continue', ...(done ? { done } : {}) });
}

function fightNote(f: FightResult): Record<string, unknown> {
    return { end: f.end, ticks: f.ticks, dealt: f.dealt, taken: f.taken, eats: f.eats, minHp: f.minHp, attacks: f.attacks };
}

async function tree(ctx: StepContext<any>, to: SpiritTree): Promise<void> {
    const r = await spiritTree(sdkOf(ctx), to);
    if (!r.ok) throw new Error(`spirit tree to ${to}: ${r.reason}`);
}

// ------------------------------------------------------------------ Tree Gnome Village (S10b)

const holds = (s: BotWorldState, item: number | RegExp) => invCount(s, item) > 0;
const ORB_CHEST_OPEN = /^Open chest$/i;
const ORB_CHEST_CLOSED = /^Closed chest$/i;

/** TGV H without the prayer: wall, door (one retry: rs/411's door fault), ladder, chest, ladder down. */
async function stronghold(ctx: StepContext<any>): Promise<Record<string, unknown>> {
    const sdk = sdkOf(ctx);
    const report: Record<string, unknown> = { hp0: st(ctx).player?.hp };
    if (!holds(st(ctx), TGV_ITEM.orb) && pos(sdk).level === 0 && !inStronghold(st(ctx))) {
        await go(ctx, { ...WALL_FOOT, tol: 0 }, 'to the crumbled wall');
        await locTalk(ctx, 'crumbled wall', { name: /crumbled wall/i, near: WALL_FOOT, radius: 10 }, /^climb-over$/i, [], inStronghold, 40);
    }
    if (!holds(st(ctx), TGV_ITEM.orb) && pos(sdk).level === 0) {
        let d = await openDoor(sdk, STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z, { maxTicks: 40, interrupts: interrupts() });
        report.door = { ok: d.ok, ticks: d.ticks, resends: d.resends };
        if (!d.ok) {
            d = await openDoor(sdk, STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z, { maxTicks: 40, interrupts: interrupts() });
            report.doorRetry = { ok: d.ok, ticks: d.ticks, resends: d.resends };
            if (!d.ok) throw new Error(`the stronghold door at ${STRONGHOLD_DOOR.x},${STRONGHOLD_DOOR.z} did not open on the retry either`);
        }
        await locOp(ctx, 'ladder up', { name: /^ladder$/i, near: LADDER, radius: 12 }, /^climb-up$/i, s => pos(s).level === 1);
    }
    if (!holds(st(ctx), TGV_ITEM.orb) && pos(sdk).level === 1) {
        const chestOpen = (s: BotWorldState) => s.nearbyLocs.some(l => ORB_CHEST_OPEN.test(l.name));
        if (!chestOpen(st(ctx))) await locOp(ctx, 'open the chest', { name: ORB_CHEST_CLOSED, radius: 12 }, /^open$/i, chestOpen);
        await locTalk(ctx, 'search the chest', { name: ORB_CHEST_OPEN, radius: 12 }, /^search$/i, [], s => holds(s, TGV_ITEM.orb), 40);
    }
    if (pos(sdk).level === 1) await locOp(ctx, 'ladder down', { name: /^ladder$/i, radius: 12 }, /^climb-down$/i, s => pos(s).level === 0);
    return { ...report, hp1: st(ctx).player?.hp };
}

export function tgvPlan(kit: HelperKit = TGV_KIT): QuestPlan {
    const started = (s: BotWorldState) => need(status(s, 'tree') === 'started', `Tree Gnome Village is ${status(s, 'tree')}, not started`);
    return {
        substitute: {
            A: {
                preconditions: s => all(need(status(s, 'tree') === 'not_started', `Tree Gnome Village is ${status(s, 'tree')}`), kitCheck(s, kit)),
                run: async ctx => {
                    const k = kitCheck(st(ctx), kit);
                    if (k !== true) throw new Error(`kit: ${k}`);
                },
                postconditions: s => kitCheck(s, kit),
            },
            B: {
                preconditions: s => need(status(s, 'tree') === 'not_started' && pos(s).level === 0 && !inVillage(s), 'already inside the village, or the quest is started'),
                run: async ctx => {
                    if (inVillage(st(ctx))) return;
                    if (!atRailOut(st(ctx))) await go(ctx, { ...RAIL_OUT, tol: 0 }, 'through the maze to the loose railing');
                    await locOp(ctx, 'loose railing', { name: /loose railing/i, near: RAIL_OUT, radius: 10 }, /^squeeze/i, inVillage, 20);
                },
            },
            H: {
                preconditions: started,
                run: async ctx => logNote(ctx.log, ctx.session, 'S10b:H-stronghold[driver]', await stronghold(ctx)),
            },
            K: {
                preconditions: s => all(started(s), need(!holds(s, TGV_ITEM.orb) && !holds(s, TGV_ITEM.orbs), 'holds an orb')),
                run: async ctx => {
                    const sdk = sdkOf(ctx);
                    await go(ctx, { ...WARLORD, tol: 4 }, 'to the warlord');
                    const f = await meleeFight(ctx, /^Khazard warlord$/i, s => holds(s, TGV_ITEM.orbs));
                    logNote(ctx.log, ctx.session, 'S10b:K-warlord[driver]', { warlord: fightNote(f) });
                    if (!f.ok) throw new Error(`the warlord fight ended '${f.end}' (${JSON.stringify(fightNote(f))})`);
                    // The kill's mesbox hands over the orbs (khazard_warlord.rs2 @defeat_warlord).
                    await converse(sdk, [], { idle: 1, openTicks: 6, maxTicks: 40, closeModals: true, unmatched: 'stop', interrupts: interrupts() });
                    const got = await waitUntil(sdk, s => holds(s, TGV_ITEM.orbs), { maxTicks: 10 });
                    if (!got.ok) throw new Error('the warlord died but the orbs of protection never arrived');
                },
            },
        },
        legs: {},
    };
}

// ------------------------------------------------------------------ The Grand Tree (S11b)

const gtStarted = (s: BotWorldState) => need(status(s, 'grandtree') === 'started', `The Grand Tree is ${status(s, 'grandtree')}, not started`);
const underground = (s: BotWorldState) => pos(s).z >= 6400;
/** Karamja's shipyard side (grand-tree.ts's own box). */
const inKaramja = (s: BotWorldState) => {
    const p = pos(s);
    return p.x >= 2880 && p.x <= 3010 && p.z >= 3000 && p.z <= 3100;
};
const lvl = (l: number): Pred => s => pos(s).level === l;

async function enterTree(ctx: StepContext<any>): Promise<void> {
    if (inTree(st(ctx))) return;
    await go(ctx, { ...GT.doorOutside, tol: 1 }, 'to the Grand Tree door');
    await locOp(ctx, 'tree door in', GT.door, /^open$/i, s => pos(s).z >= 3493);
}

async function leaveTree(ctx: StepContext<any>): Promise<void> {
    if (!inTree(st(ctx))) return;
    await treeLadder(ctx, 0);
    await go(ctx, { ...GT.doorInside, tol: 0 }, 'to the tree door');
    await locOp(ctx, 'tree door out', GT.door, /^open$/i, s => pos(s).z <= 3491);
}

async function treeLadder(ctx: StepContext<any>, to: number): Promise<void> {
    for (let l = pos(st(ctx)).level; l !== to; l = pos(st(ctx)).level) {
        const up = l < to;
        await locOp(ctx, `tree ladder ${l}->${up ? l + 1 : l - 1}`, GT.treeLadder, up ? /^climb-up$/i : /^climb-down$/i, lvl(up ? l + 1 : l - 1), 20);
    }
}

/** The stronghold's own spirit tree (spirit_tree.constant: its p_telejump lands here). */
const STRONGHOLD_TREE = { x: 2461, z: 3444, tol: 3 } as const;
const BATTLEFIELD_TREE = { x: GT.battlefieldTree.x, z: GT.battlefieldTree.z, tol: 2 } as const;
/** Brimhaven's customs ship lands here (lib/ships.ts VOYAGES). */
const ARDOUGNE_DOCK = { x: 2681, z: 3270 } as const;

export function gtPlan(): QuestPlan {
    return {
        substitute: {
            A: {
                preconditions: s => all(
                    need(status(s, 'tree') === 'complete', 'Tree Gnome Village is not complete (the spirit trees need it)'),
                    need(status(s, 'grandtree') === 'not_started', `The Grand Tree is ${status(s, 'grandtree')}`),
                    need(inTree(s) || (pos(s).level === 0 && chebyshev(pos(s), GT.arrival) <= 10), `not at the Grand Tree door (at ${JSON.stringify(pos(s))})`),
                ),
                run: async ctx => {
                    await enterTree(ctx);
                    // "seem worried", the trapdoor walk (scripted), "happy to help", then the two objboxes.
                    await talk(ctx, /^King Narnode( Shareen)?$/i, [/seem worried/i, /happy to help/i],
                        s => status(s, 'grandtree') === 'started' && invCount(s, GT_ITEM.book) > 0 && invCount(s, GT_ITEM.bark) > 0 && !underground(s));
                },
            },
            I: {
                preconditions: gtStarted,
                run: async ctx => {
                    const sdk = sdkOf(ctx);
                    if (!inKaramja(st(ctx))) {
                        await enterTree(ctx);
                        await treeLadder(ctx, 3);
                        // As grand-tree.ts: walk off at the first page after the landing (walking ends the crash talk).
                        let left = false;
                        const leave = sdk.onStateUpdate(s => {
                            if (left || !inKaramja(s) || !s.dialog?.isOpen) return;
                            left = true;
                            void sdk.sendWalk(GT.shipyardGateFoot.x, GT.shipyardGateFoot.z, true);
                        });
                        try {
                            await talk(ctx, /^Gnome pilot$/i, [/Karamja/i], inKaramja);
                        } finally {
                            leave();
                        }
                    }
                    if (pos(sdk).x < GT.shipyardGate.x) {
                        await go(ctx, { ...GT.shipyardGateFoot, tol: 1 }, 'to the shipyard gate');
                        await locTalk(ctx, 'shipyard gate', GT.shipyardGate, /^open$/i, [/Glough sent me/i, /^Ka\.$/, /^Lu\.$/, /^Min\.$/], s => pos(s).x >= GT.shipyardGate.x, 200);
                    }
                    await go(ctx, { ...GT.foreman, tol: 3 }, 'to the Foreman');
                    await talk(ctx, /^Foreman$/i, [/no longer with us/i, /worm holes/i, /^Anita/i], s => invCount(s, GT_ITEM.order) > 0);
                },
            },
            N1: {
                preconditions: gtStarted,
                run: async ctx => {
                    const sdk = sdkOf(ctx);
                    const loaded = await waitUntil(sdk, s => s.nearbyLocs.length > 0, { maxTicks: 10 });
                    if (!loaded.ok) throw new Error('the scene did not load within 10 ticks');
                    // A demon already here (re-entry) must not be spawned twice: glough.rs2 adds one without checking.
                    if (demonInSight(st(ctx))) return;
                    await locOp(ctx, 'trapdoor', GT.trapdoor, /^open$/i, underground, 20);
                    const scene = await converse(sdk, [], { idle: 2, openTicks: 20, maxTicks: 80, until: demonInSight, closeModals: true, unmatched: 'stop' });
                    if (!demonInSight(st(ctx))) throw new Error(`no black demon in sight after the trapdoor scene (${scene.reason ?? 'ended'})`);
                },
            },
            N2: {
                preconditions: gtStarted,
                run: async ctx => {
                    const loaded = await waitUntil(sdkOf(ctx), s => s.nearbyLocs.length > 0, { maxTicks: 10 });
                    if (!loaded.ok) throw new Error('the scene did not load within 10 ticks');
                    if (!demonInSight(st(ctx))) throw new Error('no black demon in sight: a logout deletes it, so replay the trapdoor (stage 130) before N2');
                    const f = await meleeFight(ctx, /^Black demon$/i);
                    logNote(ctx.log, ctx.session, 'S11b:N2-demon[driver]', { demon: fightNote(f) });
                    if (f.end !== 'killed') throw new Error(`the demon fight ended '${f.end}' (${JSON.stringify(fightNote(f))})`);
                },
            },
        },
        legs: {
            // B casts the Ardougne teleport only from west of x 2600: arrive on Hazelmere's side instead.
            B: async ctx => {
                if (pos(st(ctx)).x >= 2600) return;
                await leaveTree(ctx);
                await go(ctx, STRONGHOLD_TREE, 'to the stronghold spirit tree');
                await tree(ctx, 'khazard');
                await go(ctx, { ...GT.hazelmereLadderFoot, tol: 1 }, "to Hazelmere's ladder");
            },
            // C casts it again from inside Hazelmere's box: leave the box for the battlefield tree, which C takes itself.
            C: async ctx => {
                if (pos(st(ctx)).x < 2600) return;
                if (pos(st(ctx)).level === 1) await locOp(ctx, "Hazelmere's ladder down", GT.hazelmereLadder, /^climb-down$/i, lvl(0), 20);
                await go(ctx, BATTLEFIELD_TREE, 'to the battlefield spirit tree');
            },
            // J casts the Varrock teleport from Karamja: sail to Ardougne and take the young tree to the village instead.
            J: async ctx => {
                const s = st(ctx);
                if (regionOf(pos(s)) !== 'karamja') return;
                const sailor: Sailor = {
                    bot: ctx.bot,
                    sdk: ctx.sdk,
                    log: (m, d) => logNote(ctx.log, ctx.session, 'leg:S11b:J', { m, ...(d ?? {}) }),
                    walk: t => go(ctx, { ...t, tol: 2 }, `to ${t.x},${t.z}`),
                };
                await sailTo(sailor, ARDOUGNE_DOCK);
                await go(ctx, BATTLEFIELD_TREE, 'to the battlefield spirit tree');
                await tree(ctx, 'village');
            },
        },
    };
}

// ------------------------------------------------------------------ Monkey Madness (S15), pinned off main

/** mm_gnome_royal_seal (monkey-madness.ts MM_OBJ.royalSeal). */
export const ROYAL_SEAL = 4004;
const NARNODE = { x: 2464, z: 3497 } as const;

export function mmPlan(): QuestPlan {
    return {
        substitute: {
            A: {
                preconditions: s => all(
                    need(status(s, 'tree') === 'complete', 'Tree Gnome Village is not complete'),
                    need(status(s, 'grandtree') === 'complete', 'The Grand Tree is not complete'),
                    need(status(s, 'mm') === 'not_started' || holds(s, ROYAL_SEAL), `Monkey Madness is ${status(s, 'mm')}`),
                ),
                run: async ctx => {
                    const sdk = sdkOf(ctx);
                    await enterTree(ctx);
                    await treeLadder(ctx, 0);
                    // "Start Monkey Madness?" Yes (mm_narnode.rs2): the story, the seal and its objbox, the chapter card.
                    const r = await talkTo(sdk, /^King Narnode( Shareen)?$/i, [/^Yes$/], { maxTicks: 200, idle: 4, near: NARNODE, closeModals: true, until: s => holds(s, ROYAL_SEAL) });
                    if (!holds(st(ctx), ROYAL_SEAL)) throw new Error(`no royal seal from Narnode: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
                    if (st(ctx).dialog.isOpen) await converse(sdk, [], { openTicks: 1, idle: 2, unmatched: 'first', maxTicks: 40 });
                },
            },
        },
        legs: {},
    };
}

export const PLANS = { tree: tgvPlan, grandtree: gtPlan, mm: mmPlan } as const;
