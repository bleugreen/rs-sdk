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
// Plain (`technique: 'plain'`): click the target, re-click only when it is gone,
// the player went idle, or after dropping a full inventory.

import type { BotWorldState, InventoryItem } from '../types.js';
import type { ProgramContext, ProgramParams, TickProgram } from './types.js';
import { baseLevel, GapCounter, invCount, invItem, itemOp, num, oneOf, regex, skillXp, statRandom } from './util.js';

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
    /** Success chance per roll: stat_random bounds, or 'fly' (salmon from 30, then trout). */
    catchChance?: 'fly' | [number, number];
    /** A click landing on the roll tick rolls at once, so a bury can take the starter's click slot (see `bury`). */
    buryOnRoll?: boolean;
}

/** Presets (tickmanip-cycle.ts METHODS, minus the lab teleports and kit). */
export const CYCLE_METHODS: Record<string, CycleMethod> = {
    willow: { skill: 'woodcutting', kind: 'loc', target: '^willow', option: '^chop', product: '^willow logs$', clickOnRoll: false, r0: 3, plainCycle: 4, lockWindow: 18, buryOnRoll: true },
    // A normal tree always falls on its first log, so each log re-bootstraps on the next tree.
    tree: { skill: 'woodcutting', kind: 'loc', target: '^(tree|dead tree|evergreen)$', option: '^chop', product: '^logs$', clickOnRoll: false, r0: 3, plainCycle: 4, lockWindow: 18, depletes: true, catchChance: [64, 200] },
    oak: { skill: 'woodcutting', kind: 'loc', target: '^oak$', option: '^chop', product: '^oak logs$', clickOnRoll: false, r0: 3, plainCycle: 4, lockWindow: 18, buryOnRoll: true },
    fly: { skill: 'fishing', kind: 'npc', target: '^fishing spot$', option: '^lure$', product: '^raw ', clickOnRoll: false, r0: 4, plainCycle: 5, lockWindow: 15, catchChance: 'fly' },
    cage: { skill: 'fishing', kind: 'npc', target: '^fishing spot$', option: '^cage$', product: '^raw ', clickOnRoll: true, r0: 4, plainCycle: 6, lockWindow: 45 }
};

/** skill_multi3:make1_a, arrow shafts from normal logs (interface.pack). */
export const SHAFTS_BUTTON = 8889;

const KNIFE = /^knife$/i;
const LOGS = /^logs$/i;
const BURY = /^bury$/i;
/** Any buryable bones; the run's are dragon bones. */
export const DEFAULT_BONES = 'bones$';

export function catchChance(method: CycleMethod, level: number): number | undefined {
    const c = method.catchChance;
    if (!c) return undefined;
    if (c === 'fly') {
        const trout = statRandom(level, 32, 192);
        if (level < 30) return trout;
        const salmon = statRandom(level, 16, 96);
        return salmon + (1 - salmon) * trout;
    }
    return statRandom(level, c[0], c[1]);
}

/** No xp for this many ticks means a lost lock; honest misses at the level trip it under 0.5% of the time. */
export function lockWindow(method: CycleMethod, level: number): number {
    const p = catchChance(method, level);
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

export function createKnifeCycle(params: ProgramParams): TickProgram {
    const method = parseMethod(params.method);
    const technique = oneOf(params.technique, ['knife', 'plain'] as const, 'knife', 'technique');
    const rollsTarget = num(params.rolls, Infinity, 'rolls');
    const untilLevel = num(params.untilLevel, 0, 'untilLevel');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');
    if (rollsTarget === Infinity && !untilLevel && maxTicks === Infinity) throw new Error('give rolls, untilLevel or maxTicks');
    const xpLag = num(params.xpLag, 0, 'xpLag');
    const lead = num(params.lead, 0, 'lead');
    const dismiss = oneOf(params.dismiss, ['now', 'blind', 'none'] as const, 'now', 'dismiss');
    const reanchor = oneOf(params.reanchor, ['xp', 'click'] as const, 'xp', 'reanchor');
    const dropProducts = params.drop !== false;
    const windowOverride = params.window === undefined ? 0 : num(params.window, 0, 'window');
    const targetRe = regex(method.target, '', 'method.target');
    const optionRe = regex(method.option, '', 'method.option');
    const productRe = regex(method.product, '', 'method.product');
    // When the product is the knife's own log, keep a few for the starter.
    const keepProducts = num(params.keepProducts, productRe.test('Logs') ? 3 : 0, 'keepProducts');
    const bonesRe = params.bury === undefined || params.bury === false ? null : regex(params.bury === true ? DEFAULT_BONES : params.bury, DEFAULT_BONES, 'bury');
    if (bonesRe && technique !== 'knife') throw new Error('bury needs the knife technique (a plain loop with a bury is not implemented)');
    if (bonesRe && !method.buryOnRoll) throw new Error(`bury is not supported for this method: its first click does not roll on a due clock (presets that allow it: ${Object.keys(CYCLE_METHODS).filter(k => CYCLE_METHODS[k]!.buryOnRoll).join(', ')})`);

    let plain = technique === 'plain';
    let started = false;
    let startTick = 0;
    let current: Target | null = null;
    let currentTile: [number, number] | null = null;
    let lastXp = 0;
    let lastLevel = 0;
    const rolls = new GapCounter();
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
    let fellBack: string | undefined;
    let lastTick = 0;
    let switches = 0;
    // Bury: the label the cycle's lone click is due on (R+2), and what the bones did.
    let clickDue: number | null = null;
    let burySent = 0;
    let buried = 0;
    let noBoneCycles = 0;
    let lateClicks = 0;
    let prayerLevelUps = 0;
    let lastPrayerXp = 0;
    let lastPrayerLevel = 0;
    // Locs not to click until a tick: a tree that just fell (the browser state still lists
    // it on the label that shows its log) or one that yielded nothing (out of reach).
    const avoid = new Map<string, number>();
    const locKey = (l: { x: number; z: number; id: number }) => `${l.x},${l.z},${l.id}`;
    const avoided = (l: { x: number; z: number; id: number }) => (avoid.get(locKey(l)) ?? -1) >= lastTick;

    const findTarget = (s: BotWorldState): Target | null => {
        if (method.kind === 'loc') {
            const locs = s.nearbyLocs.filter(l => targetRe.test(l.name) && !avoided(l) && l.optionsWithIndex.some(o => optionRe.test(o.text))).sort((a, b) => a.distance - b.distance);
            const cur = current;
            if (cur?.kind === 'loc' && locs.some(l => l.x === cur.x && l.z === cur.z && l.id === cur.id)) return cur;
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

    const click = (ctx: ProgramContext): boolean => {
        const s = ctx.state;
        current = findTarget(s);
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
        ctx.send({ type: 'useItemOnItem', sourceSlot: knife.slot, targetSlot: logs.slot }, 'knife on logs');
        ctx.send({ type: 'clickComponent', componentId: SHAFTS_BUTTON }, `button ${SHAFTS_BUTTON}`);
        return true;
    };
    const bones = (s: BotWorldState): InventoryItem[] => (bonesRe ? s.inventory.filter(i => bonesRe.test(i.name) && i.optionsWithIndex.some(o => BURY.test(o.text))) : []);
    const buryOne = (ctx: ProgramContext): boolean => {
        const b = bones(ctx.state)[0];
        if (!b || !ctx.send({ type: 'useInventoryItem', slot: b.slot, optionIndex: itemOp(b, BURY, 1) }, `bury ${b.name}`)) return false;
        burySent++;
        ctx.count('burySent');
        return true;
    };
    const breakAt = (t: number) => rolls.break(t);

    const summary = () => {
        const g = rolls.stats();
        return {
            method: params.method,
            technique: plain && technique === 'knife' ? 'knife->plain' : technique,
            rolls: g.events,
            ticks: lastTick - startTick,
            ticksPerRoll: g.ticksPerEvent,
            gaps: g.gaps,
            histogram: g.histogram,
            span: g.span,
            ticksPerRollOverSpan: g.events > 1 ? Math.round((g.span / (g.events - 1)) * 1000) / 1000 : Number.NaN,
            starters,
            resyncs,
            moves,
            levelUps,
            phase: curPhase,
            switches,
            ...(bonesRe
                ? { buried, burySent, buriesPerTick: lastTick > startTick ? Math.round((buried / (lastTick - startTick)) * 1000) / 1000 : 0, noBoneCycles, lateClicks, prayerLevelUps }
                : {}),
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

            const xp = skillXp(s, method.skill);
            let xpNow = false;
            if (xp > lastXp) {
                const prev = rolls.lastTick;
                rolls.event(t);
                xpNow = true;
                lastXp = xp;
                ctx.count('rolls');
                // The roll cadence: a lost 3-tick lock shows as gaps over 3 and a rising span figure.
                ctx.gauge('ticksPerRoll', rolls.ticksPerEvent);
                if (prev !== null) ctx.gauge('lastRollGap', t - prev);
                const g = rolls.stats();
                if (g.events > 1) ctx.gauge('ticksPerRollSpan', Math.round((g.span / (g.events - 1)) * 1000) / 1000);
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

            if (rolls.count >= rollsTarget || t - startTick > maxTicks || (untilLevel && lvl >= untilLevel)) return ctx.done(summary());

            // Answer a level-up the tick it is seen (and again if it is still open 3 ticks on).
            // The engine opens it after R+1's packets, so the starter already in is unaffected
            // (tick-manipulation.md section 6, level-up dialog).
            if (!plain && dismiss !== 'none' && s.dialog?.isOpen && t !== lastDismiss && (dialogOpenSince === t || t - lastDismiss >= 3)) {
                lastDismiss = t;
                ctx.send({ type: 'clickDialogOption', optionIndex: 0, ...(dismiss === 'blind' ? { blind: true } : {}) }, 'dismiss dialog');
            }

            const lastXpTick = rolls.lastTick ?? -1;
            const targetGone = current !== null && !sameTarget(current, findTarget(s));
            if (xpNow || targetGone) ctx.log(`${xpNow ? 'xp' : ''}${xpNow && targetGone ? ', ' : ''}${targetGone ? 'target gone' : ''} (anchor ${anchor ?? '-'}, awaiting xp since ${awaitXpSince ?? '-'})`);

            if (plain) {
                if (s.inventory.length >= 28 && dropProducts) {
                    for (const p of droppable(s).slice(0, ctx.budget)) ctx.send({ type: 'dropItem', slot: p.slot }, `drop ${p.name}`);
                    breakAt(t);
                    anchor = null;
                    return;
                }
                if (s.dialog?.isOpen) {
                    ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');
                    breakAt(t);
                    anchor = null;
                    return;
                }
                const stalled = anchor !== null && t - Math.max(anchor, lastXpTick) > 12 && idleTicks >= 2;
                if (anchor === null || targetGone || stalled) {
                    current = null;
                    if (click(ctx)) {
                        anchor = t;
                        breakAt(t);
                    }
                }
                return;
            }

            // A spot that teleported keeps its index: compare its tile with the clicked one.
            let moved = false;
            const cur = current;
            if (cur?.kind === 'npc' && currentTile && (anchor !== null || awaitXpSince !== null)) {
                const n = s.nearbyNpcs.find(m => m.index === cur.index);
                const at = n ? [n.tileX ?? n.x, n.tileZ ?? n.z] : null;
                if (!at || at[0] !== currentTile[0] || at[1] !== currentTile[1]) {
                    moved = true;
                    moves++;
                    ctx.count('moves');
                    ctx.log(`spot #${cur.index} moved ${currentTile.join(',')} -> ${at ? at.join(',') : 'gone'}`);
                }
            }

            const lost = anchor !== null && t - Math.max(anchor + method.r0 + 1, lastXpTick) > (windowOverride || lockWindow(method, lvl));
            if (method.depletes && xpNow && (anchor !== null || awaitXpSince !== null)) {
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
                if (reanchor === 'xp' || rolls.count === 0) {
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
            let d = t - anchor - method.r0 - 1 - curPhase + anchorLead;
            if (d < 0) return;
            if (xpNow && d % 3 !== 0) {
                // A roll seen off the predicted phase is still a roll on this label: a starter
                // landed late, or the page decoded two ticks at once and skipped a starter label
                // (server overrun). Re-anchor on it and send the starter now, so the slip costs
                // that one roll instead of a drift back into phase.
                anchor = t - method.r0 - 1 - curPhase + anchorLead;
                d = 0;
                ctx.count('phaseResyncs');
                ctx.log('roll off phase: re-anchored on it');
            }
            const k = d % 3;
            if (k === 0) {
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
                if (!method.clickOnRoll) click(ctx);
            } else if (k === 2 && method.clickOnRoll) {
                click(ctx);
            }
        }
    };
}
