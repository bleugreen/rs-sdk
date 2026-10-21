// Iron-rock rotation with the knife starter, and its plain fallback. Ported from
// the lite lab script docs/speedrun/scripts/tickmanip-mine.ts; the transitions and
// their sources are in docs/speedrun/skills/tick-manipulation.md (section 5,
// "Mining, moving to the next rock") and mining.md section 4.
//
// `steps` is one period of stand>rock pairs. At level 63+ every iron roll
// succeeds, so the schedule is predicted, and it is planned on the label that
// shows each roll's xp (closed loop, lead 0): a late roll then costs only the
// ticks it was late. Per transition after a roll on R (the rock is depleted, the
// interaction has ended):
//   knife  on R: knife on logs, button 8889, drop ore, walk to the next stand;
//          the rock click so it lands by R+3. The fletching writer sets the clock
//          to R+3 and the walk closes the menu, so the first swing rolls on R+3.
//   trick  (plain only) click a live rotation rock beside us so it lands on
//          u = max(R+1, its respawn); its first swing sets the clock to u+2
//          without rolling. Walk to the stand on u+1 and click the rock on u+2.
//   plain  walk, click: the first swing on an expired clock costs a tick.
//   stay   the same rock respawned: click it on R; it rolls on R+3.
// A rock rolled on R accepts clicks landing from R + respawn.
//
// Slip recovery: no xp for a predicted roll within 6 labels (a click that went
// nowhere) drops the schedule, lets the clock expire (5 ticks) and restarts with
// one plain transition from where the player stands.
//
// Bury (`bury`, the knife-cycle parameter): a knife stay takes a bone. The roll label R
// sends knife on logs, button 8889, drop ore and a bone's Bury, and R+2 the rock click
// alone. The knife sets the clock to R+3, the bury lands after it on R+1, closes the
// fletch and delays the player through R+2 (bury_bone.rs2: p_stopaction, p_delay(0)),
// and the click lands on R+3, where a due clock rolls at once (mining.rs2:83-85): the
// stay keeps its 3 ticks (docs/speedrun/research/bones-placement.md section 4). Only a
// stay entered by a move of at most 2 tiles, or by a restart, takes one: in the lite lab a
// stay+bury after a 3-tile move never rolled (cause not established), so that stay stays
// plain. On the `stay2` lap that is one bone per 15 ticks. A move takes no bone (a
// delayed player's walk is dropped: +2 ticks, the booth's price), and the plain fallback
// has no stay with an idle tick, so `bury` is inert under `starter: 'none'`.

import type { BotWorldState } from '../types.js';
import { SHAFTS_BUTTON } from './knife-cycle.js';
import type { ProgramContext, ProgramParams, TickProgram } from './types.js';
import { baseLevel, bonesParam, buryable, buryBone, GapCounter, invItem, num, oneOf, skillXp, tile } from './util.js';

type P = [number, number];
export interface MineStep {
    stand: P;
    rock: P;
    /** Walking tiles from the previous step's stand to this stand (default: Chebyshev distance). */
    tiles?: number;
}

const KNIFE = /^knife$/i;
const LOGS = /^logs$/i;
const ORE = /ore$|^uncut/i;
const MINE = /^mine$/i;
/**
 * Depleted rocks keep op1=Mine (rocks.loc: rocks1, plainrock1_alt, rocks2, rocks3 carry
 * mining_rock_empty; ids from loc.pack), so a live rock is one with Mine that is not these.
 */
export const EMPTY_ROCKS: ReadonlySet<number> = new Set([450, 451, 452, 453]);
const key = (p: P) => `${p[0]},${p[1]}`;
const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];
const beside = (a: P, b: P) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
/** The longest move into a stay that may carry a bone (header). */
const BURY_ENTRY_TILES = 2;

/** `2604,3235>2605,3235` or `{stand, rock, tiles?}`. */
export function parseMineSteps(value: unknown): MineStep[] {
    const raw = typeof value === 'string' ? value.trim().split(/\s+/) : value;
    if (!Array.isArray(raw) || !raw.length) throw new Error('steps must be a non-empty list of stand>rock pairs');
    return raw.map((st, i) => {
        if (typeof st === 'string') {
            const [a, b] = st.split('>');
            if (!a || !b) throw new Error(`steps[${i}] must be 'x,z>x,z'`);
            return { stand: tile(a.split(',').map(Number), `steps[${i}].stand`), rock: tile(b.split(',').map(Number), `steps[${i}].rock`) };
        }
        const o = st as Record<string, unknown>;
        return { stand: tile(o.stand, `steps[${i}].stand`), rock: tile(o.rock, `steps[${i}].rock`), ...(o.tiles !== undefined ? { tiles: num(o.tiles, 0, `steps[${i}].tiles`) } : {}) };
    });
}

type Act = [string, (ctx: ProgramContext) => void];

export function createKnifeMine(params: ProgramParams): TickProgram {
    const STEPS = parseMineSteps(params.steps);
    const D = num(params.respawn, 13, 'respawn');
    const starter = oneOf(params.starter, ['knife', 'none'] as const, 'knife', 'starter');
    const ORES = num(params.ores, Infinity, 'ores');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');
    const untilLevel = num(params.untilLevel, 0, 'untilLevel');
    if (ORES === Infinity && maxTicks === Infinity && !untilLevel) throw new Error('give ores, untilLevel or maxTicks');
    const XP_LAG = num(params.xpLag, 0, 'xpLag');
    const LEAD = num(params.lead, 0, 'lead');
    const manip = starter === 'knife';
    // A lead needs the open loop (it sends before the roll is visible).
    const closedLoop = !manip || LEAD === 0;
    const bonesRe = bonesParam(params.bury);
    if (bonesRe && !closedLoop) throw new Error('bury needs lead 0: a bury that lands before the roll stops the swing');

    const rocks = [...new Map(STEPS.map(st => [key(st.rock), st.rock])).values()];
    const ids = new Map<string, { id: number; op: number }>();
    const tilesTo = (from: P, i: number): number => {
        const st = STEPS[i % STEPS.length]!;
        if (same(from, st.stand)) return 0;
        return st.tiles ?? Math.max(Math.abs(from[0] - st.stand[0]), Math.abs(from[1] - st.stand[1]));
    };

    let t = 0; // label being handled
    let started = false;
    let startTick = 0;
    const sched = new Map<number, Act[]>();
    const add = (label: number, what: string, fn: (ctx: ProgramContext) => void) => {
        const at = Math.max(label - LEAD, t);
        if (!sched.has(at)) sched.set(at, []);
        sched.get(at)!.push([what, fn]);
    };
    const click = (rock: P) => (ctx: ProgramContext) => {
        const r = ids.get(key(rock))!;
        ctx.send({ type: 'interactLoc', x: rock[0], z: rock[1], locId: r.id, optionIndex: r.op }, `click ${key(rock)}`);
    };
    const walk = (stand: P) => (ctx: ProgramContext) => {
        ctx.send({ type: 'walkTo', x: stand[0], z: stand[1], running: true }, `walk ${key(stand)}`);
    };
    const knifeOnLogs = (ctx: ProgramContext) => {
        const knife = invItem(ctx.state, KNIFE);
        const logs = invItem(ctx.state, LOGS);
        if (!knife || !logs) {
            ctx.count('starterMissing');
            ctx.log('no knife or logs for the starter');
            return;
        }
        ctx.send({ type: 'useItemOnItem', sourceSlot: knife.slot, targetSlot: logs.slot }, 'knife on logs');
        ctx.send({ type: 'clickComponent', componentId: SHAFTS_BUTTON }, `button ${SHAFTS_BUTTON}`);
    };
    const dropOre = (ctx: ProgramContext) => {
        const ore = ctx.state.inventory.find(i => ORE.test(i.name));
        if (ore) ctx.send({ type: 'dropItem', slot: ore.slot }, `drop ${ore.name}`);
    };
    // Bury: tiles of the move that brought the player to its stand (0 at the start and after a restart).
    let entryTiles = 0;
    let burySent = 0;
    let buried = 0;
    let noBoneStays = 0;
    let longEntryStays = 0;
    let lastPrayerXp = 0;
    const bury = (ctx: ProgramContext) => {
        if (!buryBone(ctx, bonesRe!)) return;
        burySent++;
        ctx.count('burySent');
    };
    /** A knife stay landing by R+3 carries a bone when it was entered short and the pack holds one. */
    const boneFits = (ctx: ProgramContext): boolean => {
        if (entryTiles > BURY_ENTRY_TILES) {
            longEntryStays++;
            return false;
        }
        if (!buryable(ctx.state, bonesRe!).length) {
            noBoneStays++;
            ctx.count('noBoneStays');
            return false;
        }
        return true;
    };

    const lastRoll = new Map<string, number>();
    const predicted: number[] = [];
    const predictedSet = new Set<number>();
    const kinds: Record<string, number> = { stay: 0, starter: 0, trick: 0, plain: 0, waited: 0 };
    let pos: P = STEPS[0]!.stand;
    let k = 0;
    let R = 0;
    let pendingRock: P | null = null;
    let slips = 0;
    let restartAt: number | null = null;
    let rolled: number | null = null;
    const xpSeen = new Set<number>();
    const checked = new Set<number>();
    const xpLabels: number[] = [];
    const steady = new GapCounter(); // from the 6th ore: the first few include the bootstrap
    let lastXp = 0;
    let onTime = 0;
    let startersSent = 0;

    const predict = (roll: number, rock: P) => {
        lastRoll.set(key(rock), roll);
        predicted.push(roll);
        predictedSet.add(roll);
        pendingRock = rock;
        R = roll;
    };

    const plan = (ctx: ProgramContext) => {
        const { stand, rock } = STEPS[k % STEPS.length]!;
        const tiles = tilesTo(pos, k);
        k++;
        const move = !same(pos, stand);
        const avail = (lastRoll.get(key(rock)) ?? -1e9) + D;
        const clickLand = Math.max(move ? R + 2 : R + 1, avail);
        let roll: number;
        let kind: string;
        if (k === 1) {
            roll = t + 3 + LEAD;
            kind = 'stay';
            add(t + LEAD, `click ${key(rock)}`, click(rock));
        } else {
            let trick: { st: P; u: number } | null = null;
            if (bonesRe && manip && !move && clickLand <= R + 3 && boneFits(ctx)) {
                roll = R + 3;
                kind = 'stay+bury';
            } else if (!move && clickLand === R + 1) {
                roll = R + 3;
                kind = 'stay';
            } else if (manip && clickLand <= R + 3) {
                roll = R + 3;
                kind = 'starter';
            } else {
                const plainRoll = clickLand + 2;
                if (!manip && move && tiles <= 2) {
                    for (const st of rocks) {
                        if (same(st, rock) || !beside(pos, st)) continue;
                        const u = Math.max(R + 1, (lastRoll.get(key(st)) ?? -1e9) + D);
                        if (avail <= u + 2 && u + 2 < plainRoll && (!trick || u < trick.u)) trick = { st, u };
                    }
                }
                if (trick) {
                    roll = trick.u + 2;
                    kind = 'trick';
                } else {
                    roll = plainRoll;
                    kind = clickLand > (move ? R + 2 : R + 1) ? 'waited' : 'plain';
                }
            }
            if (kind === 'starter' || kind === 'stay+bury') {
                add(R, 'knife on logs', knifeOnLogs);
                startersSent++;
                ctx.count('starters');
            }
            if (trick) {
                const { st, u } = trick;
                add(u - 1, `starter click ${key(st)}`, click(st));
                add(u, 'drop ore', dropOre);
                add(u, `walk ${key(stand)}`, walk(stand));
                add(u + 1, `click ${key(rock)}`, click(rock));
            } else if (kind === 'stay+bury') {
                add(R, 'drop ore', dropOre);
                add(R, 'bury', bury);
                // nothing may land on R+2, when the bury delays the player
                add(R + 2, `click ${key(rock)}`, click(rock));
            } else {
                add(R, 'drop ore', dropOre);
                if (move) add(R, `walk ${key(stand)}`, walk(stand));
                add(Math.max(clickLand - 1, R), `click ${key(rock)}`, click(rock));
            }
        }
        kinds[kind] = (kinds[kind] ?? 0) + 1;
        ctx.log(`plan #${k} ${kind} ${key(pos)}->${key(stand)} rock ${key(rock)} roll@${roll}`);
        if (move) entryTiles = tiles;
        pos = stand;
        predict(roll, rock);
    };

    const restart = (ctx: ProgramContext, s: BotWorldState) => {
        restartAt = null;
        rolled = null;
        pos = [s.player!.worldX, s.player!.worldZ];
        const { stand, rock } = STEPS[k % STEPS.length]!;
        k++;
        const avail = (lastRoll.get(key(rock)) ?? -1e9) + D;
        // up to 4 tiles of running before the click lands
        const clickLand = Math.max(t + 3 + LEAD, avail);
        add(t + LEAD, `walk ${key(stand)}`, walk(stand));
        add(clickLand - 1, `click ${key(rock)}`, click(rock));
        const roll = clickLand + 2;
        ctx.log(`restart #${k} ${key(pos)}->${key(stand)} rock ${key(rock)} roll@${roll}`);
        kinds.plain!++;
        entryTiles = 0;
        pos = stand;
        predict(roll, rock);
    };

    // Every roll at 63+ succeeds, so no xp for a predicted roll within the slack is a slip.
    const checkSlip = (ctx: ProgramContext) => {
        const slack = closedLoop ? 6 : 1;
        for (const p of predicted) {
            if (checked.has(p) || t < p + 2 + slack) continue;
            checked.add(p);
            let seen = false;
            for (let x = p + XP_LAG; x <= p + XP_LAG + slack; x++) seen ||= xpSeen.has(x);
            if (seen) continue;
            slips++;
            ctx.count('slips');
            ctx.log(`SLIP: no xp for roll@${p}; restarting`);
            for (const q of predicted) checked.add(q);
            sched.clear();
            restartAt = t + 5;
            R = Number.POSITIVE_INFINITY;
            rolled = null;
            return;
        }
    };

    const summary = () => {
        const g = steady.stats();
        return {
            respawn: D,
            starter,
            rocks: rocks.length,
            ores: xpLabels.length,
            ticks: t - startTick,
            ticksPerOre: g.ticksPerEvent,
            histogram: g.histogram,
            transitions: { ...kinds },
            starters: startersSent,
            onPredictedTick: onTime,
            slips,
            ...(bonesRe
                ? { buried, burySent, bonesPerTick: t > startTick ? Math.round((buried / (t - startTick)) * 1000) / 1000 : 0, noBoneStays, longEntryStays }
                : {})
        };
    };

    return {
        stallTicks: 40,
        snapshot: summary,
        onTick(ctx) {
            const s = ctx.state;
            t = ctx.tick;
            if (!s.player) return;
            if (!started) {
                started = true;
                startTick = t;
                for (const { rock } of STEPS) {
                    const loc = s.nearbyLocs.find(l => l.x === rock[0] && l.z === rock[1] && !EMPTY_ROCKS.has(l.id) && l.optionsWithIndex.some(o => MINE.test(o.text)));
                    if (!loc) {
                        const near = s.nearbyLocs.filter(l => Math.abs(l.x - rock[0]) + Math.abs(l.z - rock[1]) <= 1).map(l => `${l.name}#${l.id}@${l.x},${l.z}`);
                        return ctx.fault(`no live rock at ${key(rock)}`, { near });
                    }
                    ids.set(key(rock), { id: loc.id, op: loc.optionsWithIndex.find(o => MINE.test(o.text))!.opIndex });
                }
                if (manip && (!invItem(s, KNIFE) || !invItem(s, LOGS))) return ctx.fault('the knife starter needs a knife and normal logs');
                lastXp = skillXp(s, 'mining');
                lastPrayerXp = skillXp(s, 'prayer');
                if (bonesRe && !manip) ctx.log('bury is inert on the plain lap: no stay there has an idle tick');
                R = t - 2;
                ctx.progress();
                const here: P = [s.player.worldX, s.player.worldZ];
                if (same(here, STEPS[0]!.stand)) plan(ctx);
                else restart(ctx, s);
            } else {
                const xp = skillXp(s, 'mining');
                if (xp > lastXp) {
                    xpLabels.push(t);
                    xpSeen.add(t);
                    if (xpLabels.length > 5) steady.event(t);
                    rolled = t - XP_LAG;
                    if (predictedSet.has(t - XP_LAG)) {
                        onTime++;
                        ctx.count('onTime');
                    }
                    ctx.count('ores');
                    ctx.gauge('ticksPerOre', steady.ticksPerEvent);
                    ctx.progress();
                    lastXp = xp;
                }
                if (bonesRe) {
                    // one bury per Prayer xp drop (the xp comes on the tick after the bury lands)
                    const pxp = skillXp(s, 'prayer');
                    if (pxp > lastPrayerXp) {
                        buried++;
                        ctx.count('buried');
                        lastPrayerXp = pxp;
                    }
                    ctx.gauge('bonesLeft', buryable(s, bonesRe).length);
                }
                if (s.dialog?.isOpen) ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');
                if (restartAt === null) checkSlip(ctx);
                if (xpLabels.length >= ORES || t - startTick > maxTicks || (untilLevel && baseLevel(s, 'mining') >= untilLevel)) return ctx.done(summary());
            }
            // Run everything due, then plan the next transition on the label that shows the
            // roll's xp (closed loop) or on the predicted roll label (a lead), and run what
            // that plan put on this label.
            for (let guard = 0; guard < 4; guard++) {
                if (restartAt !== null && t >= restartAt) restart(ctx, s);
                for (const label of [...sched.keys()].sort((a, b) => a - b)) {
                    if (label > t) continue;
                    const acts = sched.get(label)!;
                    sched.delete(label);
                    for (const [, fn] of acts) fn(ctx);
                }
                if (restartAt === null && (closedLoop ? rolled !== null : t >= R - LEAD)) {
                    if (closedLoop) {
                        R = rolled!;
                        if (pendingRock) lastRoll.set(key(pendingRock), R);
                    }
                    rolled = null;
                    plan(ctx);
                    continue;
                }
                break;
            }
        }
    };
}
