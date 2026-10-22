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
//
// The CLI runs the helper's whole climb in one login, each phase only when its work is not done yet:
//
//   bun speedrun/helpers/quest-helper.ts <account> --fleet-account --mm-module=<pinned monkey-madness.ts>
//       [--phases=kit,logs,agility,tree,grandtree,mm,mm-return] [--mm-until=G]
//
//   kit        at the nearest bank (the buyer banked its purchases): sharks, the weapon and armour (worn), a bronze
//              axe while the logs are short, coins for the fares
//   logs       Montai's 6 logs from the normal trees west of Draynor
//   agility    a leg onto the Gnome course (the route's nearest waypoint on, the stronghold gate), then
//              Gnome course laps to 25 (The Grand Tree's climb, quest_grandtree.rs2:25), clicked from
//              here: skills/agility.ts runs the in-page program, which the lite client cannot host
//   tree       a leg to Elkoy, then Tree Gnome Village with the substitutions above
//   grandtree  a leg to the Grand Tree door (the village spirit tree), then The Grand Tree
//   mm         out of the roots, then Monkey Madness A to --mm-until (the module is not on main: pass
//              the file pinned to the commit rs/185 names); the journal is read at the end
//   mm-return  on the atoll first the landing -> M -> P walk, timed (H12o's two trade tiles), then
//              Lumdo back to Crash Island and Waydar's "I need to return to your kingdom."
//              (mm_waydar.rs2 @waydar_return: the glider drops the player by the Gnomeball pitch),
//              then up to Daero in the Grand Tree, where the helper parks logged out for run day
//
// The account rules and the loopback gateway are demo-quest.ts's; chat is refused for the whole
// login, and it always ends with a confirmed logout.
import { resolve } from 'node:path';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { act, actConverse, openDoor, talkTo, wield, type ActSdk } from '../lib/act';
import { depositMatching, withdrawMany, type WithdrawSpec } from '../lib/bank';
import { INVENTORY_SIZE, matchesAny } from '../lib/items';
import { fight, type FightResult } from '../lib/combat';
import { converse, levelUpInterrupt, type ConverseSdk } from '../lib/converse';
import { crossingSettings } from '../lib/kandarin';
import { journalProbe, questStatus } from '../lib/quests';
import { closeSession, loadBotEnv, openSession, type Session } from '../lib/session';
import { regionOf, sailTo, type Sailor } from '../lib/ships';
import { crossTollGate, inAlKharid, isEastOfTollGate } from '../lib/toll-gate';
import { logNote, TickLog, type TickRow } from '../lib/ticks';
import { GNOME_STRONGHOLD_GATE, gateSide, inArea, passGate, runTo, spiritTree, travel, type Area, type SpiritTree, type TravelSdk } from '../lib/travel';
import { waitUntil, type Pred } from '../lib/wait';
import { chebyshev, findLoc, invCount, opIndex, pos, skillXp, worn, type LocQuery } from '../lib/world';
import { arg, botArg, result } from '../lab/common';
import { startLoopbackGateway } from '../lab/loopback-gateway';
import { confirmedLogout } from '../lab/quests/aereck-burst';
import { checkDemoTarget, formatDemoTable, refuseChat, runDemoQuest, type Leg, type QuestModule, type Substitute } from '../lab/quests/demo-quest';
import * as grandTree from '../quests/grand-tree';
import { demonInSight, inTree, ITEM as GT_ITEM, TILES as GT } from '../quests/grand-tree';
import * as tgv from '../quests/tree-gnome-village';
import { ARRIVAL as ELKOY, atRailOut, inStronghold, inVillage, ITEM as TGV_ITEM, LADDER, RAIL_OUT, STRONGHOLD_DOOR, VILLAGE_TREE, WALL_FOOT, WARLORD } from '../quests/tree-gnome-village';
import { runSteps, type Step, type StepContext } from '../runner/step';
import { GNOME_START, ROUTES } from '../skills/agility';
import { AGILITY_COURSES, type AgilityStep } from '../../server/webclient/src/bot/programs/agility-courses';
import { BANKS } from './buyer';

export type { Leg, Substitute };

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

/**
 * The melee weapon. A rune scimitar is not buyable on the demo (docs/speedrun/helpers/market.md: one
 * bid, no ask), so the helper wields an adamant longsword from Varrock's sword shop; either serves.
 */
export const WEAPON = /^(Rune scimitar|Adamant longsword)$/i;
export const AXE = /^Bronze axe$/i;
const COINS = /^Coins$/i;
/** Fares on the way (Brimhaven to Ardougne 30) with room to spare. */
export const KIT_COINS = 300;
/**
 * Sharks taken from the bank: TGV's warlord and GT's demon, with a margin over TGV_KIT's floor. The pack
 * is exactly full once Montai's logs are chopped: 20 sharks, the axe, the coins and 6 logs are 28 slots.
 */
export const KIT_SHARKS = 20;
/**
 * Armour, worn: the best melee body, legs and helm buyable before Dragon Slayer and 32 quest points
 * (docs/speedrun/helpers/market.md; Wayne's, Louie's and Peksa's shops). The atoll's jungle spiders hit
 * an unarmoured 99-Defence account at the M trade tile (rs/473).
 */
export const ARMOUR: readonly RegExp[] = [/^Adamant chainbody$/i, /^Adamant platelegs$/i, /^Adamant full helm$/i];

/** At TGV's start: Montai's 6 logs, food for the warlord, the stronghold and the demon after it, the weapon worn. */
export const TGV_KIT: HelperKit = { logs: 6, sharks: 15, weapon: WEAPON };

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
            // On foot: the stronghold's spirit tree talks only once The Grand Tree is complete
            // (spirit_tree.rs2 [oploc1,ent]), and the village's is behind Elkoy's maze.
            B: async ctx => {
                if (pos(st(ctx)).x >= 2600) return;
                await leaveTree(ctx);
                await outOfStronghold(ctx);
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

// ------------------------------------------------------------------ the kit and the logs (untimed)

/** Every line the kit phase leaves in the pack; anything else held goes back to the bank. */
const KIT_LINES: readonly RegExp[] = [SHARK, WEAPON, ...ARMOUR, AXE, COINS, TGV_ITEM.logs];

export const freeSlots = (s: BotWorldState): number => INVENTORY_SIZE - s.inventory.length;

const exactName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/**
 * What the kit phase banks before it withdraws: anything outside the kit (the bronze longsword the
 * armour replaced), and every shark when more than KIT_SHARKS are held (the withdraw tops them back up),
 * so the pack keeps room for Montai's logs.
 */
export function kitDeposits(s: BotWorldState): RegExp[] {
    const out = new Map<string, RegExp>();
    for (const i of s.inventory) if (!matchesAny(i, KIT_LINES)) out.set(i.name, exactName(i.name));
    if (invCount(s, SHARK) > KIT_SHARKS) out.set('Shark', SHARK);
    return [...out.values()];
}

/** Slots the logs still to chop need beyond what is free; 0 when they fit. */
export function logShortfall(s: BotWorldState): number {
    return Math.max(0, TGV_KIT.logs - invCount(s, TGV_ITEM.logs) - freeSlots(s));
}

/** What the kit phase takes from the bank: the shortfall of each kit line against what is held or worn. */
export function kitWithdraws(s: BotWorldState): WithdrawSpec[] {
    const want: WithdrawSpec[] = [];
    const sharks = invCount(s, SHARK);
    if (sharks < KIT_SHARKS) want.push({ item: SHARK, n: KIT_SHARKS - sharks });
    if (invCount(s, WEAPON) === 0 && !worn(s, WEAPON)) want.push({ item: WEAPON, n: 1 });
    for (const a of ARMOUR) if (invCount(s, a) === 0 && !worn(s, a)) want.push({ item: a, n: 1 });
    if (invCount(s, TGV_ITEM.logs) < TGV_KIT.logs && invCount(s, AXE) === 0 && !worn(s, AXE)) want.push({ item: AXE, n: 1 });
    const coins = invCount(s, COINS);
    if (coins < KIT_COINS) want.push({ item: COINS, n: KIT_COINS - coins });
    return want;
}

const SURFACE_BANKS = Object.values(BANKS).filter(b => !('level' in b) || !b.level);

/** The nearest surface bank on the player's side of the Al Kharid toll gate (the walk cannot pay the toll). */
export function kitBank(here: { x: number; z: number }): { x: number; z: number } {
    const side = isEastOfTollGate(here);
    return SURFACE_BANKS.filter(b => isEastOfTollGate(b) === side).sort((a, b) => chebyshev(a, here) - chebyshev(b, here))[0]!;
}

/** Withdraw the kit at the nearest bank (banks are shared) and wield the weapon. */
async function kitUp(ctx: StepContext<any>): Promise<void> {
    const sdk = sdkOf(ctx);
    const deposits = kitDeposits(st(ctx));
    if (deposits.length || kitWithdraws(st(ctx)).length) {
        const bank = kitBank(pos(st(ctx)));
        await go(ctx, { ...bank, tol: 2 }, 'to the bank');
        const opened = await ctx.bot.openBank();
        if (!opened.success) throw new Error(`bank: ${opened.message}`);
        await waitUntil(sdk, s => s.bank?.isOpen === true, { maxTicks: 10 });
        if (deposits.length) {
            const d = await depositMatching(ctx.sdk, deposits);
            if (!d.ok) throw new Error(`kit: deposit ${d.reason}; still held ${d.remaining.map(i => i.name).join(', ')}`);
        }
        const r = await withdrawMany(ctx.sdk, kitWithdraws(st(ctx)));
        await ctx.sdk.sendCloseModal();
        await waitUntil(sdk, s => !s.bank?.isOpen, { maxTicks: 5 });
        if (!r.ok || r.missing.length) throw new Error(`kit: withdraw ${r.reason ?? 'short'}; missing ${r.missing.map(m => String(m.item)).join(', ') || 'none'}`);
    }
    for (const item of [WEAPON, ...ARMOUR]) {
        if (worn(st(ctx), item) || invCount(st(ctx), item) === 0) continue;
        const w = await wield(sdk, item);
        if (!w.ok) throw new Error(`kit: could not wear ${item.source}`);
    }
    if (!worn(st(ctx), WEAPON)) throw new Error('kit: no weapon worn');
    if (logShortfall(st(ctx))) throw new Error(`kit: ${freeSlots(st(ctx))} free slots, Montai's logs need ${TGV_KIT.logs - invCount(st(ctx), TGV_ITEM.logs)}`);
}

/** Normal trees west of Draynor's bank, on the agility route's first stretch. */
const TREES = { x: 3098, z: 3262, tol: 4 } as const;
const TREE = /^Tree$/i;
const CHOP = /^chop down$/i;

/** Out of Al Kharid by the toll gate (the buyer can end at its bank; runTo cannot pay the toll). */
async function westOfToll(ctx: StepContext<any>): Promise<void> {
    if (!inAlKharid(st(ctx))) return;
    const r = await crossTollGate(ctx.bot, ctx.sdk, false);
    if (!r.ok) throw new Error(`the Al Kharid toll gate: ${r.reason}`);
}

const locKey = (l: { x: number; z: number }) => `${l.x},${l.z}`;

/** The nearest choppable tree within `radius` of `at`, leaving out the trees given up on. */
export function pickTree(locs: readonly NearbyLoc[], at: { x: number; z: number }, skip: ReadonlySet<string>, radius = 15): NearbyLoc | null {
    let best: NearbyLoc | null = null;
    for (const l of locs) {
        if (!TREE.test(l.name) || opIndex(l, CHOP) === undefined || skip.has(locKey(l)) || chebyshev(l, at) > radius) continue;
        if (!best || chebyshev(l, at) < chebyshev(best, at)) best = l;
    }
    return best;
}

/**
 * Chop Montai's 6 logs from normal trees (Woodcutting 1, the bronze axe). A tree that gives no log in a
 * chop's 60 ticks and still stands is out of reach (across the river or a fence), so it is skipped.
 */
async function chopLogs(ctx: StepContext<any>): Promise<void> {
    const sdk = sdkOf(ctx);
    if (invCount(st(ctx), TGV_ITEM.logs) >= TGV_KIT.logs) return;
    if (logShortfall(st(ctx))) throw new Error(`logs: ${freeSlots(st(ctx))} free slots for ${TGV_KIT.logs - invCount(st(ctx), TGV_ITEM.logs)} logs; run the kit phase first`);
    await westOfToll(ctx);
    const skip = new Set<string>();
    for (let tries = 0; invCount(st(ctx), TGV_ITEM.logs) < TGV_KIT.logs; tries++) {
        if (tries >= 30) throw new Error(`only ${invCount(st(ctx), TGV_ITEM.logs)} logs after 30 chops (skipped ${[...skip].join(' ')})`);
        const s = st(ctx);
        const tree = pickTree([...s.nearbyLocs, ...(await ctx.sdk.scanNearbyLocs(15))], pos(s), skip);
        if (!tree) {
            if (chebyshev(pos(s), TREES) <= TREES.tol) throw new Error(`no reachable tree at the trees (skipped ${[...skip].join(' ')})`);
            await go(ctx, TREES, 'to the trees');
            continue;
        }
        const n0 = invCount(s, TGV_ITEM.logs);
        const standing = (q: BotWorldState) => q.nearbyLocs.some(l => l.x === tree.x && l.z === tree.z && l.id === tree.id);
        await act(sdk, () => sdk.sendInteractLoc(tree.x, tree.z, tree.id, opIndex(tree, CHOP)!), q => invCount(q, TGV_ITEM.logs) > n0 || !standing(q), { maxTicks: 60, interrupts: interrupts() });
        if (invCount(st(ctx), TGV_ITEM.logs) === n0 && standing(st(ctx))) {
            skip.add(locKey(tree));
            console.log(`quest-helper: no log from the tree at ${locKey(tree)} in 60 ticks; skipping it`);
        }
    }
}

// ------------------------------------------------------------------ the legs between quests (untimed)

/** Agility 25 is The Grand Tree's climb (quest_grandtree.rs2:25, the boosted level). */
export const AGILITY_TO = 25;
/** Within this of the course start the agility module's own walk is a no-op (agility.ts GNOME_NEAR). */
const GNOME_NEAR = 30;
const GATE_SOUTH_INDEX = ROUTES.spawnToGnome.findIndex(([x, z]) => x === 2461 && z === 3382);

/** The route's waypoint nearest `p` (Chebyshev), where the walk joins it instead of starting at Lumbridge. */
export function nearestWaypoint(route: ReadonlyArray<readonly [number, number]>, p: { x: number; z: number }): number {
    let best = 0;
    for (let i = 1; i < route.length; i++) if (chebyshev({ x: route[i]![0], z: route[i]![1] }, p) < chebyshev({ x: route[best]![0], z: route[best]![1] }, p)) best = i;
    return best;
}

const nearGnome = (s: BotWorldState) => pos(s).level === 0 && chebyshev(pos(s), { x: GNOME_START[0], z: GNOME_START[1] }) <= GNOME_NEAR;
const inGnomeStronghold = (s: BotWorldState) => pos(s).x >= 2380 && pos(s).x <= 2500 && pos(s).z >= 3384 && pos(s).z <= 3520 && pos(s).z < 6400;

/** Onto the Gnome course: the agility route from its nearest waypoint to the gate, through the gate, to the course. */
async function toGnomeCourse(ctx: StepContext<any>): Promise<void> {
    const s = st(ctx);
    if (nearGnome(s)) return;
    if (pos(s).z >= 6400) throw new Error(`underground at ${JSON.stringify(pos(s))}: climb out first`);
    await westOfToll(ctx);
    if (!inGnomeStronghold(s)) {
        const route = ROUTES.spawnToGnome.slice(0, GATE_SOUTH_INDEX + 1);
        for (const [x, z] of route.slice(nearestWaypoint(route, pos(s)))) await go(ctx, { x, z, tol: 3 }, 'the agility route');
        const g = await passGate(sdkOf(ctx), GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.north);
        if (!g.ok) throw new Error(`the Gnome Stronghold gate: ${g.reason}`);
    }
    await go(ctx, { x: GNOME_START[0], z: GNOME_START[1], tol: 3 }, 'to the Gnome course');
}

const GNOME_COURSE = AGILITY_COURSES.gnome!;

/** The loc a course step clicks: the nearest candidate the scene publishes, else the first (the in-page program's rule). */
export function stepLoc(step: AgilityStep, locs: readonly NearbyLoc[], at: { x: number; z: number }): { id: number; x: number; z: number } {
    const seen = step.locs.filter(([id, x, z]) => locs.some(l => l.id === id && l.x === x && l.z === z));
    const pool = seen.length ? seen : step.locs.slice(0, 1);
    const [id, x, z] = pool.reduce((a, b) => (chebyshev({ x: b[1], z: b[2] }, at) < chebyshev({ x: a[1], z: a[2] }, at) ? b : a));
    return { id, x, z };
}

/** Laps go on until the level is reached, and then to the end of the lap in hand (never off a branch or the rope). */
export const lapsDone = (agility: number, nextStep: number): boolean => agility >= AGILITY_TO && nextStep === 0;

const agilityBase = (s: BotWorldState) => s.skills.find(k => k.name === 'Agility')?.baseLevel ?? 1;

/**
 * Gnome course laps from the course start to AGILITY_TO, on the lite client. Each obstacle is one `act`
 * click, done when Agility xp rises (every Gnome obstacle pays xp and none can fail, gnome_course.rs2).
 */
async function gnomeLaps(ctx: StepContext<any>): Promise<void> {
    const sdk = sdkOf(ctx);
    if (agilityBase(st(ctx)) >= AGILITY_TO) return;
    if (pos(st(ctx)).level !== 0) throw new Error(`agility: start the laps on the ground, not at ${JSON.stringify(pos(st(ctx)))}`);
    let i = 0;
    let misses = 0;
    let laps = 0;
    for (let clicks = 0; !lapsDone(agilityBase(st(ctx)), i); clicks++) {
        if (clicks >= 140) throw new Error(`agility: ${laps} laps in ${clicks} clicks, still ${agilityBase(st(ctx))}`);
        const step = GNOME_COURSE.steps[i]!;
        const loc = stepLoc(step, st(ctx).nearbyLocs, pos(st(ctx)));
        const xp0 = skillXp(st(ctx), 'Agility');
        const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, step.op ?? 1), s => skillXp(s, 'Agility') > xp0, { maxTicks: 40, interrupts: interrupts() });
        if (skillXp(st(ctx), 'Agility') > xp0) {
            misses = 0;
            i = (i + 1) % GNOME_COURSE.steps.length;
            if (i === 0) console.log(`quest-helper: gnome lap ${++laps} done, Agility ${agilityBase(st(ctx))}`);
            continue;
        }
        if (++misses >= 4) throw new Error(`agility: ${step.name} drew no xp 4 times running (${r.reason ?? 'no reason'}) at ${JSON.stringify(pos(st(ctx)))}`);
    }
}

/** From the stronghold (the course) out of its south gate to Elkoy, where Tree Gnome Village starts. */
async function toElkoy(ctx: StepContext<any>): Promise<void> {
    if (chebyshev(pos(st(ctx)), ELKOY) <= 2 || inVillage(st(ctx))) return;
    await outOfStronghold(ctx);
    await go(ctx, { ...ELKOY, tol: 1 }, "to Elkoy's maze entrance");
}

/** Out of the Gnome Stronghold by its south gate (the pathfinder masks the gate, so it is never walked through). */
async function outOfStronghold(ctx: StepContext<any>): Promise<void> {
    if (!inGnomeStronghold(st(ctx))) return;
    if (gateSide(GNOME_STRONGHOLD_GATE, pos(st(ctx))) !== 'north') await go(ctx, { x: 2461, z: 3388, tol: 2 }, 'to the stronghold gate');
    const g = await passGate(sdkOf(ctx), GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.south);
    if (!g.ok) throw new Error(`the Gnome Stronghold gate: ${g.reason}`);
}

/** From beside the village spirit tree (Tree Gnome Village's exit) to the Grand Tree door. */
async function toGrandTree(ctx: StepContext<any>): Promise<void> {
    if (inTree(st(ctx)) || chebyshev(pos(st(ctx)), GT.arrival) <= 10) return;
    if (chebyshev(pos(st(ctx)), VILLAGE_TREE) <= 20) await tree(ctx, 'stronghold');
    await go(ctx, { ...GT.arrival, tol: 2 }, 'to the Grand Tree door');
}

/** From beside Narnode in the roots (The Grand Tree's exit) up into the tree, where Monkey Madness starts. */
async function outOfRoots(ctx: StepContext<any>): Promise<void> {
    if (pos(st(ctx)).z < 6400) return;
    await go(ctx, { x: GT.rootsLadder.x, z: GT.rootsLadder.z - 1, tol: 1 }, 'to the roots ladder');
    await locOp(ctx, 'roots ladder up', GT.rootsLadder, /^climb-up$/i, s => pos(s).z < 6400, 20);
}

/**
 * H12o's two trade tiles on the atoll (rs/41, from main): SCORED's segment M starts at (2763,2704) and
 * P's trade is at (2802,2724). Whether one helper serves both depends on the walk between them.
 */
export const ATOLL_TRADES = { landing: { x: 2802, z: 2707 }, M: { x: 2763, z: 2704 }, P: { x: 2802, z: 2724 } } as const;
/** Lumdo's landing and the south of the atoll around it, where G ends. */
const ATOLL_SOUTH = { x: 2785, z: 2712, tol: 30 } as const;

/** Time landing -> M -> P as a human, each leg's ticks and tiles stepped, as `note` rows. */
async function measureAtollWalk(ctx: StepContext<any>): Promise<void> {
    const sdk = sdkOf(ctx);
    const legs: Array<{ leg: string; ok: boolean; ticks: number; tiles: number; at: unknown; reason?: string }> = [];
    for (const [leg, to] of [['landing->M', ATOLL_TRADES.M], ['M->P', ATOLL_TRADES.P]] as const) {
        const r = await runTo(sdk, { ...to, tol: 1 }, { bot: ctx.bot, eat: EAT });
        legs.push({ leg, ok: r.ok, ticks: r.ticks, tiles: r.tiles, at: r.at, ...(r.reason ? { reason: r.reason } : {}) });
        if (!r.ok) break;
    }
    logNote(ctx.log, ctx.session, 'leg:mm-return:atoll-walk', { legs });
    console.log(`quest-helper: atoll walk ${JSON.stringify(legs)}`);
    // Back to Lumdo for the boat; a failed leg is reported, not thrown: the return still has to happen.
    await go(ctx, { ...ATOLL_TRADES.landing, tol: 2 }, "back to Lumdo's landing");
}

/** Gnomeball pitch, where Waydar's return flight drops the player (mm_waydar.rs2: 0_37_54_25_10). */
export const GNOMEBALL_DROP = { x: 2393, z: 3466 } as const;

/** Daero on the Grand Tree's first floor (monkey-madness.ts DAERO): where the helper parks for run day. */
export const DAERO = { x: 2484, z: 3487, level: 1 } as const;
const nearDaero = (s: BotWorldState) => pos(s).level === DAERO.level && chebyshev(pos(s), DAERO) <= 3;

/**
 * After G: Lumdo back to Crash Island, Waydar's "I need to return to your kingdom." (the glider drops the
 * player by the Gnomeball pitch), then into the Grand Tree and up to Daero, where it parks logged out:
 * on run day Daero's flight and Lumdo take it back to the atoll (rs/463).
 */
async function returnToKingdom(ctx: StepContext<any>): Promise<void> {
    const sdk = sdkOf(ctx);
    if (nearDaero(st(ctx))) return;
    const dropped = (s: BotWorldState) => (chebyshev(pos(s), GNOMEBALL_DROP) <= 6 && pos(s).level === 0) || inGnomeStronghold(s);
    if (!dropped(st(ctx))) {
        if (inArea(sdk, ATOLL_SOUTH)) await measureAtollWalk(ctx);
        const crash = { x: 2894, z: 2726, tol: 12 };
        if (!inArea(sdk, crash)) {
            const r = await travel(sdk, [{ kind: 'lumdo', to: 'crash_island' }], { bot: ctx.bot });
            if (!r.ok) throw new Error(`Lumdo back to Crash Island: ${r.reason}`);
        }
        await talk(ctx, /^Waydar$/i, [/I need to return to your kingdom/i], dropped);
    }
    await enterTree(ctx);
    await treeLadder(ctx, DAERO.level);
    await go(ctx, { ...DAERO, tol: 2 }, 'to Daero');
}

// ------------------------------------------------------------------ the CLI

export const PHASES = ['kit', 'logs', 'agility', 'tree', 'grandtree', 'mm', 'mm-return'] as const;
export type Phase = (typeof PHASES)[number];

/** `--phases`: known names, no repeats, in the climb's order. */
export function parsePhases(list: string): Phase[] {
    const names = list.split(',').map(x => x.trim()).filter(Boolean);
    for (const n of names) if (!(PHASES as readonly string[]).includes(n)) throw new Error(`unknown phase "${n}" (phases: ${PHASES.join(', ')})`);
    if (new Set(names).size !== names.length) throw new Error(`a phase is named twice in "${list}"`);
    const order = names.map(n => PHASES.indexOf(n as Phase));
    if (order.some((x, i) => i > 0 && x < order[i - 1]!)) throw new Error(`phases out of order: ${list} (the climb is ${PHASES.join(', ')})`);
    return names as Phase[];
}

const legStep = (name: string, run: Leg): Step<any> => ({ name: `leg:${name}`, preconditions: () => true, run, postconditions: () => true, logoutSafe: true });

interface PhaseResult {
    phase: Phase;
    ok: boolean;
    rows: TickRow[];
    start?: unknown;
    error?: string;
}

/** Plain steps (the agility module, the return) on the session, rows into `log`; a failure comes back, not thrown. */
async function runPlain(session: Session, phase: Phase, list: Step<any>[], log: TickLog): Promise<PhaseResult> {
    const n0 = log.rows.length;
    try {
        await runSteps(session, list, { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        return { phase, ok: true, rows: log.rows.slice(n0) };
    } catch (e) {
        return { phase, ok: false, rows: log.rows.slice(n0), error: e instanceof Error ? e.message : String(e) };
    }
}

export type QuestPhase = Extract<Phase, 'tree' | 'grandtree' | 'mm'>;

/**
 * Whether the untimed walk to a quest's start runs: only while the quest is not started. It is not a
 * leg before the first segment, because the resume walk may start past that segment (TGV's A is a kit
 * check, done whenever the kit is held) and a leg before the start is dropped with it.
 */
export const approachFirst = (s: BotWorldState, quest: QuestPhase): boolean => questStatus(s, quest) === 'not_started';

/**
 * A step failure that another player causes and a short wait clears: the Grand Tree's doors stand open
 * (no Open option) for 6 ticks after anyone goes through (gnome_gate.rs2 @open_tree_door, loc_change 6),
 * and grand-tree.ts's door clicks do not wait for that. rs/185 owns the module fix.
 */
export function transientFault(error: string | undefined): boolean {
    return !!error && /tree door (in|out): no loc with \/\^open\$\/i/.test(error);
}
/** Tries per phase after a transient fault, each after a wait longer than the door's open form. */
export const TRANSIENT_RETRIES = 3;
const TRANSIENT_WAIT_TICKS = 8;

async function runQuest(session: Session, phase: QuestPhase, module: QuestModule, plan: QuestPlan, approach: Leg, log: TickLog, until?: string): Promise<PhaseResult> {
    const n0 = log.rows.length;
    const s = session.sdk.getState();
    if (s && approachFirst(s, phase)) {
        const a = await runPlain(session, phase, [legStep(`${phase}:approach`, approach)], log);
        if (!a.ok) return a;
    }
    const once = () => runDemoQuest(session, { module, opts: {}, substitute: plan.substitute, legs: plan.legs, log, ...(until ? { until } : {}) });
    let r = await once();
    // The resume walk re-enters the failed step exactly as a relog would, without spending a login.
    for (let retry = 1; retry <= TRANSIENT_RETRIES && transientFault(r.error); retry++) {
        logNote(log, session, `retry:${phase}`, { retry, after: r.error, waitTicks: TRANSIENT_WAIT_TICKS });
        console.log(`quest-helper: retry ${retry} of ${phase} after ${r.error}`);
        await waitUntil(session.sdk, () => false, { maxTicks: TRANSIENT_WAIT_TICKS });
        r = await once();
    }
    // runDemoQuest returns the whole shared log; the phase's rows start where it began.
    return { phase, ok: r.finished && !r.error, rows: log.rows.slice(n0), start: r.start, ...(r.error ? { error: r.error } : {}) };
}

function snapshot(s: BotWorldState | null): Record<string, unknown> {
    if (!s) return {};
    return {
        at: [s.player?.worldX, s.player?.worldZ, s.player?.level],
        hp: s.player?.hp,
        levels: Object.fromEntries(s.skills.filter(k => k.baseLevel > 1).map(k => [k.name, k.baseLevel])),
        quests: { tree: questStatus(s, 'tree'), grandtree: questStatus(s, 'grandtree'), mm: questStatus(s, 'mm') },
        inventory: s.inventory.map(i => `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`),
        worn: s.equipment.map(i => i.name),
    };
}

async function main(): Promise<void> {
    const account = botArg();
    const phases = parsePhases(arg('phases', PHASES.join(',')));
    const mmModule = arg('mm-module', '');
    const mmUntil = arg('mm-until', 'G');
    if (phases.includes('mm') && !mmModule) throw new Error('--mm-module=<monkey-madness.ts pinned to the commit rs/185 names> is required for the mm phase');
    checkDemoTarget(loadBotEnv(account), { lab: false, fleetAccount: process.argv.includes('--fleet-account') });
    const mm = phases.includes('mm') ? ((await import(resolve(mmModule))) as Partial<QuestModule>) : null;
    if (mm && (typeof mm.steps !== 'function' || typeof mm.stepId !== 'string')) throw new Error(`${mmModule} does not export steps() and stepId`);

    const gateway = await startLoopbackGateway(account, 'quest-helper');
    const out: Record<string, unknown> = { account, phases, ...(mm ? { mmModule, mmUntil } : {}) };
    const results: PhaseResult[] = [];
    let exit = 1;
    try {
        const session = await openSession(account, { launch: true, readyTimeoutMs: 180_000 });
        const allow = refuseChat(session.sdk as unknown as { sendSay(m: string): Promise<unknown> });
        const log = TickLog.open(`quest-helper-${account}`);
        try {
            out.start = snapshot(session.sdk.getState());
            console.log(`quest-helper: start ${JSON.stringify(out.start)}`);
            for (const phase of phases) {
                let r: PhaseResult;
                if (phase === 'kit') r = await runPlain(session, phase, [legStep('kit', kitUp)], log);
                else if (phase === 'logs') r = await runPlain(session, phase, [legStep('logs', chopLogs)], log);
                else if (phase === 'agility') r = await runPlain(session, phase, [legStep('agility', toGnomeCourse), legStep('agility:laps', gnomeLaps)], log);
                else if (phase === 'tree') {
                    await crossingSettings(session.sdk, (m, d) => console.log(`quest-helper: ${m} ${JSON.stringify(d ?? {})}`));
                    r = await runQuest(session, phase, tgv, tgvPlan(), toElkoy, log);
                } else if (phase === 'grandtree') r = await runQuest(session, phase, grandTree, gtPlan(), toGrandTree, log);
                else if (phase === 'mm') {
                    r = await runQuest(session, phase, mm as QuestModule, mmPlan(), outOfRoots, log, mmUntil);
                    const j = (await journalProbe('mm')(session)) as { lines?: string[] } | null;
                    out.mmJournal = j?.lines ?? j;
                } else r = await runPlain(session, phase, [legStep('mm-return', returnToKingdom)], log);
                results.push(r);
                console.log(`\n### ${phase}: ${r.ok ? 'ok' : `FAILED: ${r.error}`}\n\n${formatDemoTable(r.rows)}\n`);
                console.log(`quest-helper: after ${phase} ${JSON.stringify(snapshot(session.sdk.getState()))}`);
                if (!r.ok) break;
            }
            if (results.length === phases.length && results.every(r => r.ok)) exit = 0;
        } catch (e) {
            out.error = e instanceof Error ? e.message : String(e);
        } finally {
            allow();
            out.end = snapshot(session.sdk.getState());
            try {
                const lo = await confirmedLogout(session);
                out.logout = { ok: true, confirmedBy: lo.confirmedBy, latencyTicks: lo.latencyTicks };
            } catch (e) {
                out.logout = { ok: false, reason: e instanceof Error ? e.message : String(e) };
                exit = 2;
            }
            await closeSession(session);
        }
    } finally {
        gateway.kill('SIGTERM');
    }
    out.phaseResults = results.map(r => ({
        phase: r.phase, ok: r.ok, ...(r.error ? { error: r.error } : {}), start: r.start,
        ticks: Object.fromEntries(r.rows.filter(x => !x.kind).map(x => [x.step, x.ok ? x.ticks : `fail@${x.ticks}`])),
    }));
    result('quest_helper', out);
    process.exit(exit);
}

if (import.meta.main) await main();
