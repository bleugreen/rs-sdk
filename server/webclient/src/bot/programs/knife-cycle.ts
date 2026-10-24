// Knife tick-manipulation for one gathering target (fly fishing, woodcutting,
// lobster), and the plain loop it falls back to. Ported from the lite lab script
// docs/speedrun/scripts/tickmanip-cycle.ts; the cadences and their sources are in
// docs/speedrun/skills/tick-manipulation.md (sections 5 and 6).
//
// Knife: on the label that shows a roll R, send knife-on-logs, the arrow-shafts
// button (component 8889), a drop and the target click. They land on R+1; the
// fletching writer sets the action clock to R+3 (cut_logs.rs2), the click's
// closeModal clears the queued fletch, and the next roll is on R+3. In the page
// the starter goes out in the same game-loop pass that decoded R, so nothing
// relays it and it lands on R+1 whenever the host's tick leaves room for it.
//
// The schedule is open-loop and anchored on a roll the program saw: after a roll
// on R the plain loop rolls next on R + r0 + 1, so the first starter goes out on
// that label and every 3 labels after it. A lost lock (no xp for the lock window)
// re-anchors: `reanchor: 'xp'` (default) re-clicks at once and anchors on the next
// xp; `'click'` waits 5 ticks for the pushed clock to expire, re-clicks and steps
// the phase, as the lab script's default does. Spot moves and depleted trees are
// detected from the target's tile and identity. A roll observed off the predicted
// phase (a late starter, or two ticks decoded at once during a server overrun)
// re-anchors the schedule on that roll at once.
//
// Bury (`bury`, Woodcutting on oak and willow): on the roll label R send
// knife-on-logs, the button, a drop and a bone's Bury, and on R+2 the tree click
// alone. The knife still sets the clock to R+3; the bury lands after it on R+1,
// clears the interaction and the queued fletch, and delays the player through R+2
// (bury_bone.rs2: p_stopaction, p_delay(0)), so nothing may land on R+2. The click
// lands on R+3 itself, where the first-click label finds the clock due and rolls at
// once (woodcut.rs2:97-98), so the 3-tick lattice holds with a bone every cycle
// (docs/speedrun/research/bones-placement.md section 2). It also closes a level-up
// page. With no bone in the pack the roll label sends the plain knife bundle, which
// rolls on the same R+3, so running out loses no label. Fishing has no such branch
// (the fly lock breaks), and a normal tree re-bootstraps on every log, so only the
// methods marked `buryOnRoll` accept it.
//
// A non-depleting tree that falls (one log in 8, or another player's axe) leaves
// the lock intact: the cycle runs on the player's clock, so a live tree clicked by
// the roll tick takes the roll. The next scheduled click goes to a live tree, or,
// when this cycle's click already went to the fallen one, a re-click goes out now.
//
// When every tree is down the schedule sends nothing and keeps its phase for the respawn, but
// the lock window still runs, so a wait longer than it (the willows' respawn is about 29 ticks
// at low load, the window 18) ends in `resync (no xp)` and counts a slip. With `waitRespawn`
// (non-depleting trees only) each label on which no listed tree stands moves the window's start
// to it: a respawn wait is neither a slip nor a resync. The result's `respawnWaits` lists each
// wait's length, from the first label that showed every tree down to the first that showed one
// standing.
//
// Plain (`technique: 'plain'`): click the target, re-click only when it is gone,
// the player went idle, or after dropping a full inventory. Two opt-in refinements
// for fishing: `followSpot` re-clicks the nearest spot on the label that shows the
// clicked spot on a new tile (otherwise a moved spot, which keeps its index, is only
// noticed once the player has idled past the stall window), and `dropEach` drops
// the catch on the label that shows it and re-clicks in the same pass, so both land
// on R+1. A drop clears the interaction but not the action clock, and on R+1 every
// attempt label continues (fly from any offset; net, bait and cage only on R+1 and
// R+2: skills/fishing.md section 6), so the roll lattice is kept and a full
// inventory never happens.
//
// Plain + bury (`technique: 'plain'` with `bury`, the knife-off fallback the host gate
// switches to): the plain clock with a bone in its idle ticks, as bones-wc.ts `plainbury`
// measured it (bones-placement.md section 1). Anchored on the label R that shows a roll: R
// sends a drop and a click (the drop clears the interaction, the click restores it), R+1 a
// bury, which lands on R+2, clears the interaction and delays the player through R+3, and
// R+3 the click alone, which lands on the roll tick R+4 itself, where the first-click label
// finds the clock due and rolls at once (woodcut.rs2:97-98). A level-up page seen on R+1 is
// answered with a dismiss and a click instead, and that cycle carries no bone; with no bone
// in the pack the cycle is the plain one. Every observed roll re-anchors the schedule, and a
// player idle for two cycles, or no xp for the lock window, restarts it from a click. Unlike
// the knife, nothing here writes the clock, and a roll that fells the tree leaves it on the roll
// tick, and the page still lists the fallen tree on R (it is gone on R+1). So R's click goes to
// another standing tree among `trees`, which re-arms the clock whether or not the one that
// rolled fell. With a single tree standing it goes to that one, and when that turns out to have
// fallen (seen gone after R) the cycle sends no bone, clicks a live tree as early as the bury
// allows (its first roll is r0 after it lands) and re-anchors on that roll's xp.
//
// On time (`bury`, both loops): the engine deletes a buried bone and gives its xp on the tick after
// the Bury lands (bury_bone.rs2), so a Bury sent on label S that lands on S+1, its tick, shows the
// bone gone on label S+2. Each Bury sent is counted on S+2 as `buryOnTime` (one bone fewer than
// when it went out) or `buryLate` (landed late, or never). A run whose S+2 label the page never
// saw on its own counts neither. Every bury cycle sends one Bury, so the share on time is the
// server's on-time rate for that cycle's sends, measured in the loop itself with no probe
// (woodcutting.ts switches its burying bands between the two loops on it). The runtime's
// lab-only `hold` reaches each bury cycle's timed sends: the roll label's bundle and the lone
// click in the knife loop, the bury and the R+3 click in plain + bury. With `hold` unset or 0
// nothing is drawn or held, and the packets are as before (knife-cycle.test.ts BURY_GOLDEN).
//
// Report: a roll is one swing of the cadence (every 3 ticks locked, `plainCycle` plain), and
// it succeeds with the method's catch chance. `successes` counts the xp drops, one log or
// fish each, and `ticksPerSuccess` is the mean gap between them, so it sits above the cadence
// by 1/p. Where the method has a catch chance, `ticksPerExpectedRoll` weights each success as
// 1/p rolls at the level it was rolled at (as tickmanip-demo-report.ts does); that is the
// figure to set against 3 and `plainCycle`. The status carries every success's tick while the
// run goes (`marks.successes`), so a poller can time each log or fish.
//
// Catch chance and the lock window: p is stat_random's chance at the base level L,
// (floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1)/256 (engine PlayerOps.ts STAT_RANDOM). The
// Woodcutting presets carry trees.dbrow's lo/hi for every axe, and the program uses the axe
// woodcutting_axe_checker would swing: the best one worn or carried, rune first
// (woodcut.rs2). A locked cadence rolls every 3 ticks, so k misses in a row come with
// probability (1-p)^k; the lock window is 3k ticks for the least k with (1-p)^k <= 0.005,
// never below the method's `lockWindow`. With no axe seen there is no p: the window stays at
// `lockWindow` and `ticksPerExpectedRoll` is NaN.

import type { BotWorldState, InventoryItem } from '../types.js';
import type { ProgramContext, ProgramParams, TickProgram } from './types.js';
import { baseLevel, bonesParam, buryable, buryBone, GapCounter, invCount, invItem, num, oneOf, regex, skillXp, statRandom, tile } from './util.js';

export interface CycleMethod {
    skill: string;
    kind: 'loc' | 'npc';
    /** Regular expressions (case-insensitive) over target name, its option, and the product. */
    target: string;
    option: string;
    product: string;
    /** First-click label rolls only when the clock equals map_clock: click on R+3, not with the starter. */
    clickOnRoll: boolean;
    /** Ticks from a click on an expired clock to its first roll. */
    r0: number;
    /** The plain loop's ticks per roll (the host gate's cost model). */
    plainCycle: number;
    /** Ticks with no xp after which a lock counts as lost, before the catch-chance scaling. */
    lockWindow: number;
    /** The target is gone after every successful roll (normal trees). */
    depletes?: boolean;
    /** Success chance per roll: stat_random bounds, bounds per axe (Woodcutting), or 'fly' (salmon from 30, then trout). */
    catchChance?: 'fly' | [number, number] | AxeChance;
    /** A click landing on the roll tick rolls at once, so a bury can take the starter's click slot (see `bury`). */
    buryOnRoll?: boolean;
}

/** woodcutting_axe_checker's order (woodcut.rs2): the first of these worn or carried is the axe that swings. */
export const AXES = ['rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;
export type Axe = (typeof AXES)[number];
/** stat_random bounds for each axe on one tree type. */
export type AxeChance = Record<Axe, [number, number]>;

/** trees.dbrow successchance, per tree table and axe. */
export const TREE_CHANCE: Record<'tree' | 'oak' | 'willow', AxeChance> = {
    tree: { bronze: [64, 200], iron: [96, 300], steel: [128, 400], black: [144, 450], mithril: [160, 500], adamant: [192, 600], rune: [224, 700] },
    oak: { bronze: [32, 100], iron: [48, 150], steel: [64, 200], black: [72, 225], mithril: [80, 250], adamant: [96, 300], rune: [112, 350] },
    willow: { bronze: [16, 50], iron: [24, 75], steel: [32, 100], black: [36, 112], mithril: [40, 125], adamant: [48, 150], rune: [56, 175] }
};

/** Presets (tickmanip-cycle.ts METHODS, minus the lab teleports and kit). */
export const CYCLE_METHODS: Record<string, CycleMethod> = {
    willow: { skill: 'woodcutting', kind: 'loc', target: '^willow', option: '^chop', product: '^willow logs$', clickOnRoll: false, r0: 3, plainCycle: 4, lockWindow: 18, buryOnRoll: true, catchChance: TREE_CHANCE.willow },
    // A normal tree always falls on its first log, so each log re-bootstraps on the next tree.
    tree: { skill: 'woodcutting', kind: 'loc', target: '^(tree|dead tree|evergreen)$', option: '^chop', product: '^logs$', clickOnRoll: false, r0: 3, plainCycle: 4, lockWindow: 18, depletes: true, catchChance: TREE_CHANCE.tree },
    oak: { skill: 'woodcutting', kind: 'loc', target: '^oak$', option: '^chop', product: '^oak logs$', clickOnRoll: false, r0: 3, plainCycle: 4, lockWindow: 18, buryOnRoll: true, catchChance: TREE_CHANCE.oak },
    fly: { skill: 'fishing', kind: 'npc', target: '^fishing spot$', option: '^lure$', product: '^raw ', clickOnRoll: false, r0: 4, plainCycle: 5, lockWindow: 15, catchChance: 'fly' },
    // fishing.struct fishing_struct_lobster
    cage: { skill: 'fishing', kind: 'npc', target: '^fishing spot$', option: '^cage$', product: '^raw ', clickOnRoll: true, r0: 4, plainCycle: 6, lockWindow: 45, catchChance: [6, 95] }
};

/** skill_multi3:make1_a, arrow shafts from normal logs (interface.pack). */
export const SHAFTS_BUTTON = 8889;

const KNIFE = /^knife$/i;
const LOGS = /^logs$/i;
/** The axe woodcutting_axe_checker swings: the best one worn or carried. */
export function axeOf(s: BotWorldState): Axe | undefined {
    const names = new Set([...s.equipment, ...s.inventory].map(i => i.name.toLowerCase()));
    return AXES.find(a => names.has(`${a} axe`));
}

/** The chance one roll succeeds; per-axe bounds need the axe, and without one there is no chance to give. */
export function catchChance(method: CycleMethod, level: number, axe?: Axe): number | undefined {
    const c = method.catchChance;
    if (!c) return undefined;
    if (c === 'fly') {
        const trout = statRandom(level, 32, 192);
        if (level < 30) return trout;
        const salmon = statRandom(level, 16, 96);
        return salmon + (1 - salmon) * trout;
    }
    const b = Array.isArray(c) ? c : axe ? c[axe] : undefined;
    return b ? statRandom(level, b[0], b[1]) : undefined;
}

/** No xp for this many ticks means a lost lock; honest misses at the level trip it under 0.5% of the time (header). */
export function lockWindow(method: CycleMethod, level: number, axe?: Axe): number {
    const p = catchChance(method, level, axe);
    if (!p || p >= 1) return method.lockWindow;
    return Math.max(method.lockWindow, 3 * Math.ceil(Math.log(0.005) / Math.log(1 - p)));
}

type Target = { kind: 'loc'; x: number; z: number; id: number; op: number } | { kind: 'npc'; index: number; x: number; z: number; op: number };

function parseMethod(value: unknown): CycleMethod {
    if (typeof value === 'string') {
        const m = CYCLE_METHODS[value];
        if (!m) throw new Error(`unknown method '${value}' (presets: ${Object.keys(CYCLE_METHODS).join(', ')})`);
        return m;
    }
    if (value && typeof value === 'object') {
        const v = value as Partial<CycleMethod> & { preset?: string };
        const base = v.preset ? CYCLE_METHODS[v.preset] : undefined;
        if (v.preset && !base) throw new Error(`unknown method preset '${v.preset}'`);
        const m = { ...base, ...v } as CycleMethod;
        for (const k of ['skill', 'kind', 'target', 'option', 'product'] as const) if (typeof m[k] !== 'string') throw new Error(`method.${k} is required`);
        for (const k of ['r0', 'plainCycle', 'lockWindow'] as const) if (typeof m[k] !== 'number') throw new Error(`method.${k} is required`);
        return m;
    }
    throw new Error('method is required (a preset name or a method object)');
}

createKnifeCycle.params = ['method', 'technique', 'successes', 'untilLevel', 'untilXp', 'maxTicks', 'xpLag', 'lead', 'dismiss', 'reanchor', 'followSpot', 'dropEach', 'drop', 'window', 'trees', 'keepProducts', 'bury', 'phase', 'waitRespawn'] as const;
export function createKnifeCycle(params: ProgramParams): TickProgram {
    const method = parseMethod(params.method);
    const technique = oneOf(params.technique, ['knife', 'plain'] as const, 'knife', 'technique');
    const successTarget = num(params.successes, Infinity, 'successes');
    const untilLevel = num(params.untilLevel, 0, 'untilLevel');
    /** End once the skill's xp (game xp, as published) reaches this: a band that stops at a quest-start xp. */
    const untilXp = num(params.untilXp, 0, 'untilXp');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');
    if (successTarget === Infinity && !untilLevel && !untilXp && maxTicks === Infinity) throw new Error('give successes, untilLevel, untilXp or maxTicks');
    const followSpot = params.followSpot === true;
    const dropEach = params.dropEach === true;
    const xpLag = num(params.xpLag, 0, 'xpLag');
    const lead = num(params.lead, 0, 'lead');
    const dismiss = oneOf(params.dismiss, ['now', 'blind', 'none'] as const, 'now', 'dismiss');
    const reanchor = oneOf(params.reanchor, ['xp', 'click'] as const, 'xp', 'reanchor');
    const dropProducts = params.drop !== false;
    const windowOverride = params.window === undefined ? 0 : num(params.window, 0, 'window');
    // The loc tiles the player reaches from where it stands. The page can't compute reach, and a
    // click on a tree that needs a walk never rolls inside a bury cycle: the next bury's
    // p_stopaction cancels the walk every cycle.
    if (params.trees !== undefined && (!Array.isArray(params.trees) || params.trees.length === 0)) throw new Error('trees must be a non-empty list of [x, z]');
    const trees = params.trees === undefined ? null : new Set((params.trees as unknown[]).map((v, i) => tile(v, `trees[${i}]`).join(',')));
    const targetRe = regex(method.target, '', 'method.target');
    const optionRe = regex(method.option, '', 'method.option');
    const productRe = regex(method.product, '', 'method.product');
    // When the product is the knife's own log, keep a few for the starter.
    const keepProducts = num(params.keepProducts, productRe.test('Logs') ? 3 : 0, 'keepProducts');
    const bonesRe = bonesParam(params.bury);
    if (bonesRe && !method.buryOnRoll) throw new Error(`bury is not supported for this method: its first click does not roll on a due clock (presets that allow it: ${Object.keys(CYCLE_METHODS).filter(k => CYCLE_METHODS[k]!.buryOnRoll).join(', ')})`);
    const waitRespawn = params.waitRespawn === true;
    if (waitRespawn && (method.kind !== 'loc' || method.depletes)) throw new Error('waitRespawn needs a tree that stands after a log and respawns when it falls (oak, willow)');

    let plain = technique === 'plain';
    let started = false;
    let startTick = 0;
    let current: Target | null = null;
    let currentTile: [number, number] | null = null;
    let lastXp = 0;
    let lastLevel = 0;
    let axe: Axe | undefined;
    const successes = new GapCounter();
    // The gaps `successes` counts, in ticks and in rolls expected at the catch chance.
    let gapTicks = 0;
    let gapExpectedRolls = 0;
    const ticksPerExpectedRoll = () => (gapExpectedRolls ? Math.round((gapTicks / gapExpectedRolls) * 1000) / 1000 : Number.NaN);
    let anchor: number | null = null;
    let anchorLead = 0;
    let awaitXpSince: number | null = null;
    let cooldownUntil = -1;
    let curPhase = ((num(params.phase, 0, 'phase') % 3) + 3) % 3;
    let idleTicks = 0;
    let dialogOpenSince: number | null = null;
    let lastDismiss = -1;
    let starters = 0;
    let resyncs = 0;
    let moves = 0;
    let levelUps = 0;
    // The gap from the last success before each spot move to the first success after it.
    const moveGaps: number[] = [];
    let moveFrom: number | null = null;
    let fellBack: string | undefined;
    let lastTick = 0;
    let switches = 0;
    // Bury: the label the cycle's lone click is due on (R+2), and what the bones did.
    let clickDue: number | null = null;
    let burySent = 0;
    let buried = 0;
    let noBoneCycles = 0;
    let lateClicks = 0;
    // On time (header): the label the last Bury went out on and the bones held then, until S+2 judges it.
    let buryCheck: { at: number; bones: number } | null = null;
    let buryOnTime = 0;
    let buryLate = 0;
    // waitRespawn: the first label of the current all-down wait, the last label that showed every
    // tree down (the lock window starts there), and each finished wait's length.
    let downSince: number | null = null;
    let downLast = -Infinity;
    const respawnWaits: number[] = [];
    let prayerLevelUps = 0;
    let lastPrayerXp = 0;
    let lastPrayerLevel = 0;
    // Locs not to click until a tick: a tree that just fell (the browser state still lists
    // it on the label that shows its log) or one that yielded nothing (out of reach).
    const avoid = new Map<string, number>();
    const locKey = (l: { x: number; z: number; id: number }) => `${l.x},${l.z},${l.id}`;
    const avoided = (l: { x: number; z: number; id: number }) => (avoid.get(locKey(l)) ?? -1) >= lastTick;

    /** The current target while it stands; with `other`, the nearest tree that is not it, when one stands. */
    const findTarget = (s: BotWorldState, other = false): Target | null => {
        if (method.kind === 'loc') {
            const cur = current;
            const isCur = (l: { x: number; z: number; id: number }) => cur?.kind === 'loc' && l.x === cur.x && l.z === cur.z && l.id === cur.id;
            let locs = s.nearbyLocs
                .filter(l => targetRe.test(l.name) && !avoided(l) && (!trees || trees.has(`${l.x},${l.z}`)) && l.optionsWithIndex.some(o => optionRe.test(o.text)))
                .sort((a, b) => a.distance - b.distance);
            if (other && locs.some(l => !isCur(l))) locs = locs.filter(l => !isCur(l));
            else if (locs.some(isCur)) return cur;
            const l = locs[0];
            return l ? { kind: 'loc', x: l.x, z: l.z, id: l.id, op: l.optionsWithIndex.find(o => optionRe.test(o.text))!.opIndex } : null;
        }
        const npcs = s.nearbyNpcs.filter(n => targetRe.test(n.name) && n.optionsWithIndex.some(o => optionRe.test(o.text))).sort((a, b) => a.distance - b.distance);
        const cur = current;
        if (cur?.kind === 'npc') {
            const same = npcs.find(n => n.index === cur.index);
            if (same) return { ...cur, x: same.x, z: same.z };
        }
        const n = npcs[0];
        return n ? { kind: 'npc', index: n.index, x: n.x, z: n.z, op: n.optionsWithIndex.find(o => optionRe.test(o.text))!.opIndex } : null;
    };
    const sameTarget = (a: Target | null, b: Target | null) =>
        !!a && !!b && (a.kind === 'loc' && b.kind === 'loc' ? a.x === b.x && a.z === b.z && a.id === b.id : a.kind === 'npc' && b.kind === 'npc' && a.index === b.index);

    const click = (ctx: ProgramContext, other = false): boolean => {
        const s = ctx.state;
        current = findTarget(s, other);
        if (!current) {
            ctx.log(`no target at ${s.player?.worldX},${s.player?.worldZ}`);
            ctx.count('noTarget');
            return false;
        }
        if (current.kind === 'loc') return ctx.send({ type: 'interactLoc', x: current.x, z: current.z, locId: current.id, optionIndex: current.op }, `click loc ${current.id}@${current.x},${current.z}`);
        const idx = current.index;
        const n = s.nearbyNpcs.find(m => m.index === idx);
        currentTile = n ? [n.tileX ?? n.x, n.tileZ ?? n.z] : null;
        return ctx.send({ type: 'interactNpc', npcIndex: idx, optionIndex: current.op }, `click npc #${idx}`);
    };
    const droppable = (s: BotWorldState): InventoryItem[] => s.inventory.filter(i => productRe.test(i.name)).slice(keepProducts);
    const dropOne = (ctx: ProgramContext) => {
        const p = droppable(ctx.state)[0];
        if (p) ctx.send({ type: 'dropItem', slot: p.slot }, `drop ${p.name}`);
    };
    const knifeStart = (ctx: ProgramContext): boolean => {
        const knife = invItem(ctx.state, KNIFE);
        const logs = invItem(ctx.state, LOGS);
        if (!knife || !logs) return false;
        ctx.starter();
        ctx.send({ type: 'useItemOnItem', sourceSlot: knife.slot, targetSlot: logs.slot }, 'knife on logs');
        ctx.send({ type: 'clickComponent', componentId: SHAFTS_BUTTON }, `button ${SHAFTS_BUTTON}`);
        return true;
    };
    const bones = (s: BotWorldState): InventoryItem[] => (bonesRe ? buryable(s, bonesRe) : []);
    const buryOne = (ctx: ProgramContext): boolean => {
        if (!bonesRe) return false;
        const held = bones(ctx.state).length;
        if (!buryBone(ctx, bonesRe)) return false;
        burySent++;
        ctx.count('burySent');
        buryCheck = { at: lastTick, bones: held };
        return true;
    };
    /** Judge the last Bury on its S+2 label (header); a later label first means S+2 was never seen alone. */
    const judgeBury = (ctx: ProgramContext, t: number) => {
        if (!buryCheck || t < buryCheck.at + 2) return;
        if (t === buryCheck.at + 2) {
            if (bones(ctx.state).length < buryCheck.bones) {
                buryOnTime++;
                ctx.count('buryOnTime');
            } else {
                buryLate++;
                ctx.count('buryLate');
            }
        }
        buryCheck = null;
    };
    const breakAt = (t: number) => successes.break(t);
    /** Answer an open dialog once, and again if it is still open 3 labels on. */
    const answerDialog = (ctx: ProgramContext, t: number): boolean => {
        if (!ctx.state.dialog?.isOpen || t === lastDismiss || (dialogOpenSince !== t && t - lastDismiss < 3)) return false;
        lastDismiss = t;
        ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');
        return true;
    };

    /**
     * The tree this cycle's roll-label click went to was seen gone after that label: it fell to the
     * roll, and the click (on its stump) did not re-arm the clock, which a fall leaves on the roll
     * tick (woodcut.rs2 get_logs returns without p_oploc). The next click on a live tree rolls r0
     * after it lands, off the lattice, so the schedule waits for that roll's xp.
     */
    const treeFell = () => {
        switches++;
        anchor = null;
        awaitXpSince = lastTick;
        breakAt(lastTick);
    };

    /** One label of the plain + bury loop (header). `anchor` is the last roll's label; `clickDue` the bury cycle's click. */
    const plainBury = (ctx: ProgramContext, t: number, xpNow: boolean, targetGone: boolean, lvl: number) => {
        const s = ctx.state;
        const dialog = !!s.dialog?.isOpen;
        if (xpNow) {
            anchor = t;
            awaitXpSince = null;
        }
        if (clickDue !== null) {
            if (t < clickDue) return; // the bury delays the player through the next tick: nothing may land then
            if (t > clickDue) {
                // The click's label was never seen (two ticks decoded in one pass): the roll it was
                // for is gone; click now and the next xp re-anchors.
                lateClicks++;
                ctx.count('lateClicks');
                ctx.log('bury click label skipped: re-click');
            }
            // the cycle's timed click, on its label: the lab's `hold` may hold it (header)
            if (t === clickDue) ctx.starter();
            clickDue = null;
            click(ctx); // also closes a level-up page (OpLocHandler)
            if (targetGone) treeFell();
            return;
        }
        const restart = (why: string) => {
            answerDialog(ctx, t);
            current = null;
            anchor = null;
            if (click(ctx)) {
                awaitXpSince = t;
                breakAt(t);
            }
            ctx.log(`plain + bury: click and wait for xp (${why})`);
        };
        // The lock window counts rolls at the plain cadence. A bury cycle leaves the player idle for
        // about 3 labels, so only two whole idle cycles since the last click or roll mean a click did not take.
        const window = windowOverride || Math.ceil(lockWindow(method, lvl) / 3) * method.plainCycle;
        const idle = (since: number) => idleTicks > 2 * method.plainCycle && t - since > 2 * method.plainCycle;
        if (anchor === null) {
            if (awaitXpSince === null) restart('start');
            else if (targetGone || idle(awaitXpSince) || t - awaitXpSince > window || answerDialog(ctx, t)) restart('no roll yet');
            return;
        }
        if (idle(anchor) || t - anchor > window) {
            resyncs++;
            ctx.count('resyncs');
            ctx.count('slips');
            restart(t - anchor > window ? 'no xp' : 'idle');
            return;
        }
        const k = (t - anchor) % method.plainCycle;
        if (k !== 0 && targetGone) {
            // seen gone after the roll label: no bone this cycle, the click goes to a live tree now
            restart('tree fell');
            treeFell();
            return;
        }
        if (k === 1) {
            if (dialog) {
                // a level-up page from this roll: a bury would not clear it, a click does; skip this bone
                answerDialog(ctx, t);
                click(ctx);
                return;
            }
            if (bones(s).length) ctx.starter(); // the cycle's timed bury: the lab's `hold` may hold it (header)
            if (buryOne(ctx)) {
                clickDue = t + 2;
                return;
            }
            noBoneCycles++;
            ctx.count('noBoneCycles');
        }
        if (k === 0) {
            const p = dropProducts ? droppable(s)[0] : undefined;
            const answered = answerDialog(ctx, t);
            if (p) ctx.send({ type: 'dropItem', slot: p.slot }, `drop ${p.name}`);
            // to another standing tree: the one that just rolled may have fallen, still listed (header)
            if (p || answered || targetGone) click(ctx, method.kind === 'loc');
            return;
        }
        if (targetGone || answerDialog(ctx, t)) click(ctx);
    };

    // A spot that teleported keeps its index: compare its tile with the clicked one.
    const spotMoved = (ctx: ProgramContext): boolean => {
        const cur = current;
        if (cur?.kind !== 'npc' || !currentTile || (anchor === null && awaitXpSince === null)) return false;
        const n = ctx.state.nearbyNpcs.find(m => m.index === cur.index);
        const at = n ? [n.tileX ?? n.x, n.tileZ ?? n.z] : null;
        if (at && at[0] === currentTile[0] && at[1] === currentTile[1]) return false;
        moves++;
        ctx.count('moves');
        moveFrom = successes.lastTick ?? ctx.tick;
        ctx.log(`spot #${cur.index} moved ${currentTile.join(',')} -> ${at ? at.join(',') : 'gone'}`);
        return true;
    };

    const summary = () => {
        const g = successes.stats();
        return {
            method: params.method,
            technique: plain && technique === 'knife' ? 'knife->plain' : technique,
            successes: g.events,
            ticks: lastTick - startTick,
            ticksPerSuccess: g.ticksPerEvent,
            ...(method.catchChance ? { ticksPerExpectedRoll: ticksPerExpectedRoll() } : {}),
            ...(method.catchChance && method.catchChance !== 'fly' && !Array.isArray(method.catchChance) ? { axe: axe ?? null } : {}),
            gaps: g.gaps,
            histogram: g.histogram,
            span: g.span,
            ticksPerSuccessOverSpan: g.events > 1 ? Math.round((g.span / (g.events - 1)) * 1000) / 1000 : Number.NaN,
            starters,
            resyncs,
            moves,
            moveGaps: [...moveGaps],
            levelUps,
            phase: curPhase,
            switches,
            ...(bonesRe
                ? { buried, burySent, buriesPerTick: lastTick > startTick ? Math.round((buried / (lastTick - startTick)) * 1000) / 1000 : 0, noBoneCycles, lateClicks, prayerLevelUps, buryOnTime, buryLate }
                : {}),
            ...(waitRespawn ? { respawnWaits: [...respawnWaits] } : {}),
            ...(fellBack ? { fellBack } : {})
        };
    };

    return {
        stallTicks: 200,
        snapshot: summary,
        onTick(ctx) {
            const s = ctx.state;
            const t = ctx.tick;
            lastTick = t;
            if (!started) {
                started = true;
                startTick = t;
                lastXp = skillXp(s, method.skill);
                lastLevel = baseLevel(s, method.skill);
                lastPrayerXp = skillXp(s, 'prayer');
                lastPrayerLevel = baseLevel(s, 'prayer');
                if (!plain && !invItem(s, KNIFE)) return ctx.fault('no knife in the inventory');
                if (!plain && !invItem(s, LOGS)) return ctx.fault('no normal logs in the inventory');
            }

            axe = axeOf(s);
            const xp = skillXp(s, method.skill);
            let xpNow = false;
            if (xp > lastXp) {
                const prev = successes.lastTick;
                const gap = successes.event(t);
                // rolled at the level before any level-up this xp brings (lastLevel is updated below)
                const p = catchChance(method, lastLevel, axe);
                if (gap !== null && p) {
                    gapTicks += gap;
                    gapExpectedRolls += 1 / p;
                }
                xpNow = true;
                lastXp = xp;
                ctx.count('successes');
                ctx.mark('successes');
                if (moveFrom !== null) {
                    moveGaps.push(t - moveFrom);
                    moveFrom = null;
                }
                // A lost 3-tick lock shows as success gaps that are not multiples of 3 and a rising span figure.
                ctx.gauge('ticksPerSuccess', successes.ticksPerEvent);
                if (p) ctx.gauge('ticksPerExpectedRoll', ticksPerExpectedRoll());
                if (prev !== null) ctx.gauge('lastSuccessGap', t - prev);
                const g = successes.stats();
                if (g.events > 1) ctx.gauge('ticksPerSuccessSpan', Math.round((g.span / (g.events - 1)) * 1000) / 1000);
                ctx.progress();
            }
            if (bonesRe) {
                // One bury per Prayer xp drop (the xp comes on the tick after the bury lands).
                const pxp = skillXp(s, 'prayer');
                if (pxp > lastPrayerXp) {
                    buried++;
                    ctx.count('buried');
                    lastPrayerXp = pxp;
                }
                const plvl = baseLevel(s, 'prayer');
                if (plvl > lastPrayerLevel) {
                    prayerLevelUps++;
                    ctx.count('prayerLevelUps');
                    lastPrayerLevel = plvl;
                }
                ctx.gauge('bonesLeft', bones(s).length);
                ctx.gauge('buriesPerTick', t > startTick ? Math.round((buried / (t - startTick)) * 1000) / 1000 : 0);
                judgeBury(ctx, t);
            }
            const lvl = baseLevel(s, method.skill);
            if (lvl > lastLevel) {
                levelUps++;
                ctx.count('levelUps');
                ctx.log(`level ${lvl}`);
                lastLevel = lvl;
            }
            if (s.dialog?.isOpen) {
                if (dialogOpenSince === null) dialogOpenSince = t;
            } else dialogOpenSince = null;
            idleTicks = (s.player?.animId ?? -1) === -1 ? idleTicks + 1 : 0;

            if (successes.count >= successTarget || t - startTick > maxTicks || (untilLevel && lvl >= untilLevel) || (untilXp && xp >= untilXp)) return ctx.done(summary());

            // Answer a level-up the tick it is seen (and again if it is still open 3 ticks on).
            // The engine opens it after R+1's packets, so the starter already in is unaffected
            // (tick-manipulation.md section 6, level-up dialog).
            if (!plain && dismiss !== 'none' && s.dialog?.isOpen && t !== lastDismiss && (dialogOpenSince === t || t - lastDismiss >= 3)) {
                lastDismiss = t;
                ctx.send({ type: 'clickDialogOption', optionIndex: 0, ...(dismiss === 'blind' ? { blind: true } : {}) }, 'dismiss dialog');
            }

            const lastXpTick = successes.lastTick ?? -1;
            const targetGone = current !== null && !sameTarget(current, findTarget(s));
            if (xpNow || targetGone) ctx.log(`${xpNow ? 'xp' : ''}${xpNow && targetGone ? ', ' : ''}${targetGone ? 'target gone' : ''} (anchor ${anchor ?? '-'}, awaiting xp since ${awaitXpSince ?? '-'})`);

            if (plain && bonesRe) return plainBury(ctx, t, xpNow, targetGone, lvl);
            if (plain) {
                if (s.inventory.length >= 28 && dropProducts) {
                    for (const p of droppable(s).slice(0, ctx.budget)) ctx.send({ type: 'dropItem', slot: p.slot }, `drop ${p.name}`);
                    breakAt(t);
                    anchor = null;
                    return;
                }
                const moved = followSpot && spotMoved(ctx);
                const catchLabel = dropEach && dropProducts && xpNow && droppable(s).length > 0;
                if (s.dialog?.isOpen) {
                    ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');
                    if (!catchLabel) {
                        breakAt(t);
                        anchor = null;
                        return;
                    }
                }
                if (catchLabel) {
                    // dropEach (header): the drops and the re-click land on R+1; one slot is left for the click
                    for (const p of droppable(s).slice(0, Math.max(0, ctx.budget - 1))) ctx.send({ type: 'dropItem', slot: p.slot }, `drop ${p.name}`);
                    if (moved || targetGone) {
                        current = null;
                        currentTile = null;
                        breakAt(t);
                    }
                    if (click(ctx)) anchor = t;
                    return;
                }
                const stalled = anchor !== null && t - Math.max(anchor, lastXpTick) > 12 && idleTicks >= 2;
                if (anchor === null || targetGone || stalled || moved) {
                    current = null;
                    currentTile = null;
                    if (click(ctx)) {
                        anchor = t;
                        breakAt(t);
                    }
                }
                return;
            }

            const moved = spotMoved(ctx);
            if (waitRespawn && anchor !== null) {
                if (!findTarget(s)) {
                    if (downSince === null) {
                        downSince = t;
                        ctx.count('respawnWaits');
                        ctx.log('every listed tree down: waiting for the respawn');
                    }
                    downLast = t;
                } else if (downSince !== null) {
                    respawnWaits.push(t - downSince);
                    ctx.log(`a tree stands again after ${t - downSince} ticks`);
                    downSince = null;
                }
            }
            const lost = anchor !== null && t - Math.max(anchor + method.r0 + 1, lastXpTick, downLast) > (windowOverride || lockWindow(method, lvl, axe));
            // A non-depleting tree that fell is not a lost lock (header): the schedule's next click picks a live tree.
            const switchTree = targetGone && !moved && !lost && anchor !== null && method.kind === 'loc' && !method.depletes;
            if (switchTree) {
                switches++;
                ctx.count('switches');
                const next = findTarget(s);
                ctx.log(`tree gone: the next click goes to ${next?.kind === 'loc' ? `${next.x},${next.z}` : 'none live'} (player at ${s.player?.worldX},${s.player?.worldZ})`);
                current = null;
            } else if (method.depletes && xpNow && (anchor !== null || awaitXpSince !== null)) {
                // The target fell to the roll just seen (a normal tree always falls on its first
                // log), though the state may list it for another tick: start the next one from
                // this label with a starter bundle, like a bootstrap; its first swing rolls 2
                // ticks after it lands.
                if (current?.kind === 'loc') avoid.set(locKey(current), t + 10);
                anchor = t - method.r0 - 1 - curPhase;
                anchorLead = 0;
                awaitXpSince = null;
                current = null;
                ctx.log('next target');
            } else if (moved || (anchor !== null && (targetGone || lost))) {
                const why = moved ? 'spot moved' : targetGone ? 'target gone' : 'no xp';
                // A lock with no xp is mistimed by a tick or two; step the phase.
                if (reanchor === 'click' && why === 'no xp') curPhase = (curPhase + 1) % 3;
                if (why === 'no xp') ctx.count('slips');
                resyncs++;
                ctx.count('resyncs');
                ctx.log(`resync (${why})`);
                anchor = null;
                clickDue = null;
                awaitXpSince = null;
                current = null;
                currentTile = null;
                // click: let the pushed clock expire so the bootstrap click starts a fresh cycle
                cooldownUntil = reanchor === 'xp' ? t : t + 5;
            }
            if (awaitXpSince !== null) {
                if (xpNow && t > awaitXpSince) {
                    // a roll on R = t - xpLag; the plain continuation rolls next on R + r0 + 1
                    anchor = t - xpLag;
                    anchorLead = lead;
                    curPhase = 0;
                    awaitXpSince = null;
                    ctx.log(`anchored on xp (roll ${anchor})`);
                } else {
                    if (t - awaitXpSince > 30) {
                        // nothing from this target: try another (it may be out of reach)
                        if (current?.kind === 'loc') avoid.set(locKey(current), t + 100);
                        current = null;
                        if (click(ctx)) awaitXpSince = t;
                        ctx.log('re-click while waiting for xp');
                    }
                    return;
                }
            }
            if (anchor === null) {
                if (t < cooldownUntil) return;
                // The first lock always anchors on observed xp: it needs no warm-up walk, and at
                // the page's latency of 1 the anchor is exact.
                if (reanchor === 'xp' || successes.count === 0) {
                    if (click(ctx)) {
                        awaitXpSince = t;
                        breakAt(t);
                    }
                    return;
                }
                if (click(ctx)) {
                    anchor = t;
                    anchorLead = 0;
                    breakAt(t);
                    ctx.log(`bootstrap phase ${curPhase}`);
                }
                return;
            }
            if (clickDue !== null && t > clickDue) {
                // The label a bury cycle's click was due on was never seen (two ticks decoded in one
                // pass), so the roll it was for is gone: click now and anchor on the next xp.
                clickDue = null;
                lateClicks++;
                ctx.count('lateClicks');
                ctx.log('bury click label skipped: re-click and anchor on xp');
                anchor = null;
                current = null;
                if (click(ctx)) {
                    awaitXpSince = t;
                    breakAt(t);
                }
                return;
            }
            let d = t - anchor - method.r0 - 1 - curPhase + anchorLead;
            if (d < 0) return;
            if (xpNow && d % 3 !== 0) {
                // A roll seen off the predicted phase is still a roll on this label: a starter
                // landed late, or the page decoded two ticks at once and skipped a starter label
                // (server overrun). Re-anchor on it and send the starter now, so the slip costs
                // that one roll instead of a drift back into phase.
                anchor = t - method.r0 - 1 - curPhase + anchorLead;
                d = 0;
                clickDue = null;
                ctx.count('phaseResyncs');
                ctx.log('roll off phase: re-anchored on it');
            }
            const k = d % 3;
            if (k === 0) {
                if (!method.clickOnRoll && !(bonesRe && bones(s).length) && !findTarget(s)) {
                    // Every tree is down. A starter with no click behind it leaves the fletching menu
                    // open, so the fletch completes and uses the knife's log; send nothing and keep the
                    // phase for the respawn. (A bury closes the menu, so a bury cycle still goes out.)
                    ctx.count('noTarget');
                    return;
                }
                if (!knifeStart(ctx)) {
                    fellBack = invCount(s, KNIFE) ? 'out of logs' : 'no knife';
                    ctx.log(`${fellBack}: falling back to the plain loop`);
                    ctx.count('fellBack');
                    plain = true;
                    anchor = null;
                    return;
                }
                starters++;
                ctx.count('starters');
                if (dropProducts) dropOne(ctx);
                if (bonesRe && buryOne(ctx)) {
                    // the bury delays the player through R+2, so the click goes out on R+2 to land on R+3
                    clickDue = t + 2;
                    return;
                }
                if (bonesRe) {
                    noBoneCycles++;
                    ctx.count('noBoneCycles');
                }
                if (!method.clickOnRoll) click(ctx);
            } else if (clickDue === t || (k === 2 && method.clickOnRoll)) {
                // the bury cycle's timed click: the lab's `hold` may hold it (header)
                if (clickDue === t) ctx.starter();
                clickDue = null;
                click(ctx);
            } else if (switchTree && clickDue === null) {
                // this cycle's click went to the tree that fell: a click on a live one that lands by the
                // roll tick keeps the roll (a mid-cycle click keeps the pending clock)
                click(ctx);
            }
        }
    };
}
