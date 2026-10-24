// Agility course laps: click the next obstacle on the label that shows the
// previous one done. Ported from docs/speedrun/scripts/agility-course.ts; the lap
// costs are in docs/speedrun/skills/agility.md ("Every obstacle pays one
// reaction": each tick between seeing an obstacle's xp and the next click landing
// adds a tick per obstacle, which in the page is the one tick the packet needs).
//
// A step is done when an xp drop of at least its xp arrives (the lap bonus lands
// with the last obstacle's), when a ladder step reaches its plane, or when an
// `endZ` step arrives on that row. A lap the run joined partway (a start off the
// lap's first step) earns no bonus, since the course's progress varp never saw its
// start, so its last obstacle is done on that obstacle's own xp. A fail message or a fall into a pit waits 4
// ticks for the fail script, climbs out of a pit, and resumes at the course's
// resume step. The plain fallback (`technique: 'plain'`) waits `settleTicks`
// after each completion before the next click, a stand-in for the relay's
// reaction, for measuring what the in-page reaction is worth.
//
// The run ends after `laps`, `maxTicks`, or the tick the Agility base level
// reaches `untilLevel`; the result's `ended` says which. With `untilLevelAt:
// 'lap'` the level end waits for the lap: once the level is reached it clicks the
// lap's remaining obstacles and ends on the tick the lap's last step completes, on
// the ground where the next lap starts (or at once, when it starts there with the
// level already reached), so the band never leaves the player on an obstacle or a
// platform. Every other end still fires mid-lap. In the Wilderness it
// also watches the other players and the hits it takes, on the tick:
// - every player seen is logged as a sighting, with whether the Wilderness
//   rule lets them attack us and whether the pause rules would have fired;
// - `pauseFor: 'threat'` ends the run (`ended: 'player'`) for a player who can
//   attack us here and is targeting a player beside us or walking toward us
//   from off the lap path; `pauseFor: 'any'` for anyone within `playerRadius`;
// - with `pauseFor` given (`'none'` included), a hit that a player dealt ends it
//   (`ended: 'attacked'`);
// - a hit no fall explains is counted as `npcDamage`;
// - a death faults the run ('died').
// Food: `eatBelow` alone eats on the tick of an obstacle click. With `eatGap` it
// eats in any phase, mid-obstacle included (the agility scripts never read the
// eat's %action_delay), at most once per `eatGap` ticks, and HP at or below
// `eatBelow` with no food left ends the run (`ended: 'no-food'`). An eat is an
// inventory click, which clears the pending interaction (OpHeldHandler), so one
// that lands while the player walks to an obstacle cancels the obstacle and the
// step sits out `stepTimeout`. `eatAt: 'land'` holds such an eat for the next
// click tick (sent before the click) or an idle tick after a fall, unless HP is
// within one skeleton hit of death.

import type { NearbyPlayer } from '../types.js';
import { AGILITY_COURSES, inBox, stepFromPosition, type AgilityCourse, type AgilityStep, type Box } from './agility-courses.js';
import type { ProgramContext, ProgramParams, TickProgram } from './types.js';
import { baseLevel, FreshMessages, invCount, invItem, itemOp, num, oneOf, regex, skillXp, XP_RATE } from './util.js';

/** Every fail branch in the course scripts prints one of these (gnome_course.rs2 has none). */
export const FAIL_RE = /slip and fall|lose your footing|lost your balance|missed a hand hold|missed the rope|were hit by|stumbled|stepped on a broken/i;
const REFUSED_RE = /from here|from this side/i;
/** gnome_course.rs2: each pipe's lock is world-shared, set for 12 ticks by whoever enters it. */
const IN_USE_RE = /is being used/i;
const IN_USE_TICKS = 13;
const UNDERGROUND = 6400;
/** Ticks after a fail message in which a hit counts as the fall's (the barbarian water bite comes a few ticks later). */
const FALL_WINDOW = 6;
/** The armed skeletons' max hit (all.npc): at or below it, `eatAt: 'land'` eats at once whatever the phase. */
const LETHAL_HIT = 3;

/** wilderness_levels.rs2: (z - 3520) / 8 + 1 on the surface, from 9920 underground; 0 outside. */
export function wildernessLevel(x: number, z: number): number {
    if (x < 2944 || x >= 3392) return 0;
    if (z >= 3520 && z < UNDERGROUND) return Math.floor((z - 3520) / 8) + 1;
    if (z >= 9920 && z < 12800) return Math.floor((z - 9920) / 8) + 1;
    return 0;
}

/** pvp_combat.rs2: an attack needs both in the Wilderness and the lower Wilderness level to cover the combat gap. */
export function canAttack(aCombat: number, aWild: number, bCombat: number, bWild: number): boolean {
    const w = Math.min(aWild, bWild);
    return w > 0 && w >= Math.abs(aCombat - bCombat);
}

export interface ThreatRule {
    /** Only players within this many tiles count. */
    radius: number;
    /** A player targeting a player within this many tiles of us is taken to be targeting us. */
    targetRange: number;
    /** A player off the lap path whose own movement brought them this many tiles closer... */
    closeTiles: number;
    /** ...within this many ticks is approaching us. */
    closeTicks: number;
}

export const DEFAULT_THREAT: ThreatRule = { radius: 15, targetRange: 2, closeTiles: 3, closeTicks: 5 };

export interface Me {
    x: number;
    z: number;
    combatLevel: number;
    wild: number;
}

const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

/**
 * Why a nearby player is a threat, or null. `trail` is the player's recent tiles
 * [tick, x, z], oldest first. Approach is judged by their own movement against
 * our current tile, so our walking along the lap does not look like theirs.
 */
export function threatOf(p: NearbyPlayer, me: Me, trail: ReadonlyArray<readonly [number, number, number]>, now: number, rule: ThreatRule, lapArea: readonly Box[] = []): 'targeting' | 'closing' | null {
    if (p.distance > rule.radius) return null;
    if (!canAttack(me.combatLevel, me.wild, p.combatLevel, wildernessLevel(p.x, p.z))) return null;
    if (p.combatTargetType === 'player' && p.distance <= rule.targetRange) return 'targeting';
    if (lapArea.some(b => inBox(b, p.x, p.z))) return null;
    const then = trail.find(([t]) => t >= now - rule.closeTicks);
    if (then && cheb(then[1], then[2], me.x, me.z) - cheb(p.x, p.z, me.x, me.z) >= rule.closeTiles) return 'closing';
    return null;
}

export interface Sighting {
    name: string;
    combatLevel: number;
    /** The Wilderness rule let them attack us at some point while seen. */
    canAttack: boolean;
    firstTick: number;
    lastTick: number;
    /** Ticks seen. */
    ticks: number;
    minDistance: number;
    /** Seen on the lap path (another course user) / off it. */
    onLap: boolean;
    offLap: boolean;
    /** Came within the radius: `pauseFor: 'any'` would have fired. */
    any: boolean;
    /** `pauseFor: 'threat'` would have fired, and why. */
    threat?: 'targeting' | 'closing';
}

export type HitSource = 'fall' | 'player' | 'npc';

/**
 * Who dealt a hit we took. The splat names no attacker (StateCollector), so: a
 * fail message within FALL_WINDOW ticks makes it the fall's; the collector's
 * facing guess or a player in combat with a player close by makes it a player's;
 * anything else (an NPC beside us, or nobody visible) is an NPC's.
 */
export function classifyHit(
    ev: { tick: number; sourceType: string; sourceIndex: number },
    lastFailTick: number,
    players: readonly NearbyPlayer[],
    npcs: ReadonlyArray<{ distance: number; targetIndex: number }>,
    me: Me
): { source: HitSource; attacker?: NearbyPlayer } {
    if (ev.tick - lastFailTick <= FALL_WINDOW && ev.tick >= lastFailTick) return { source: 'fall' };
    const able = (p: NearbyPlayer) => canAttack(me.combatLevel, me.wild, p.combatLevel, wildernessLevel(p.x, p.z));
    // the facing guess sticks to a past target (StateCollector), so it counts only with that player in view
    if (ev.sourceType === 'other_player') {
        const p = players.find(q => q.index === ev.sourceIndex);
        if (p && p.distance <= 10 && able(p)) return { source: 'player', attacker: p };
    }
    // npc targetIndex packs player targets as slot + 32768
    if (npcs.some(n => n.distance <= 2 && n.targetIndex >= 32768)) return { source: 'npc' };
    const p = players.find(q => q.combatTargetType === 'player' && q.distance <= 10 && able(q));
    if (p) return { source: 'player', attacker: p };
    return { source: 'npc' };
}

function playerBrief(p: NearbyPlayer) {
    return { name: p.name, combatLevel: p.combatLevel, distance: p.distance, x: p.x, z: p.z, target: p.combatTargetType ?? 'none' };
}

function parseCourse(value: unknown): AgilityCourse {
    if (typeof value === 'string') {
        const c = AGILITY_COURSES[value];
        if (!c) throw new Error(`unknown course '${value}' (have: ${Object.keys(AGILITY_COURSES).join(', ')})`);
        return c;
    }
    const c = value as AgilityCourse | undefined;
    if (!c || !Array.isArray(c.steps) || !c.steps.length || typeof c.lapBonus !== 'number') throw new Error('course must be a course name or {steps, lapBonus, start}');
    return c;
}

export type AgilityEnd = 'laps' | 'maxTicks' | 'level' | 'player' | 'attacked' | 'no-food' | 'low-food' | 'died';

/** Damage splats on our own player that were not seen before (the collector keeps a rolling window). */
class FreshHits {
    private readonly seen = new Set<string>();

    take(s: { combatEvents?: Array<{ tick: number; observationId?: number; type: string; damage: number; sourceType: string; sourceIndex: number; targetType: string }> }) {
        const fresh = [];
        const counts = new Map<string, number>();
        for (const ev of s.combatEvents ?? []) {
            if (ev.type !== 'damage_taken' || ev.targetType !== 'player') continue;
            const base = ev.observationId !== undefined ? `o${ev.observationId}` : `${ev.tick}|${ev.damage}|${ev.sourceType}`;
            const k = (counts.get(base) ?? 0) + 1;
            counts.set(base, k);
            const key = `${base}#${k}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            fresh.push(ev);
        }
        return fresh;
    }
}

type Phase =
    | { kind: 'click' }
    | { kind: 'wait'; clickTick: number; x: number; z: number; level: number; arrivedAt?: number; loc?: [number, number, number] }
    | { kind: 'settle'; until: number }
    | { kind: 'recover'; until: number }
    | { kind: 'climb'; since: number; tries: number };

createAgility.params = [
    'course', 'laps', 'maxTicks', 'technique', 'settleTicks', 'food', 'eatBelow', 'stepTimeout', 'startStep',
    // opt-in: absent, the program sends what it sent before each was added
    'untilLevel', 'eatGap', 'eatAt', 'restockBelow', 'protect', 'protectRange', 'protectNpc', 'flickGap',
    'pauseFor', 'playerRadius', 'threatTargetRange', 'threatCloseTiles', 'threatCloseTicks', 'untilLevelAt'
] as const;
export function createAgility(params: ProgramParams): TickProgram {
    const course = parseCourse(params.course);
    const laps = num(params.laps, Infinity, 'laps');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');
    const untilLevel = num(params.untilLevel, Infinity, 'untilLevel');
    if (laps === Infinity && maxTicks === Infinity && untilLevel === Infinity) throw new Error('give laps, maxTicks or untilLevel');
    const untilLevelAt = oneOf(params.untilLevelAt, ['tick', 'lap'] as const, 'tick', 'untilLevelAt');
    if (params.untilLevelAt !== undefined && untilLevel === Infinity) throw new Error('untilLevelAt needs untilLevel');
    const technique = oneOf(params.technique, ['react', 'plain'] as const, 'react', 'technique');
    const settleTicks = num(params.settleTicks, 1, 'settleTicks');
    const foodRe = regex(params.food, '^(shark|lobster|swordfish|monkfish|tuna|salmon|trout|cake|2/3 cake|slice of cake)$', 'food');
    const eatBelow = num(params.eatBelow, 0, 'eatBelow');
    const eatAnyPhase = params.eatGap !== undefined;
    const eatGap = num(params.eatGap, 3, 'eatGap');
    const eatAt = oneOf(params.eatAt, ['any', 'land'] as const, 'any', 'eatAt');
    if (eatAt === 'land' && !eatAnyPhase) throw new Error("eatAt: 'land' needs eatGap");
    /** End `low-food` between obstacles once this many food items or fewer are left (-1: off), for a restock. */
    const restockBelow = num(params.restockBelow, -1, 'restockBelow');
    // Protect from Melee (prayer 14): 'hold' keeps it on; 'near' has it on only while an NPC matching
    // protectNpc is within protectRange; 'flick' keeps it on and turns it off and on every flickGap
    // ticks. The drain timer (prayer.rs2) fires 5 ticks after the first prayer goes on and costs a
    // point only if a prayer is on when it fires; turning the last prayer off clears it.
    const protect = oneOf(params.protect, ['off', 'hold', 'near', 'flick'] as const, 'off', 'protect');
    const protectRange = num(params.protectRange, 3, 'protectRange');
    const protectNpc = regex(params.protectNpc, 'skeleton', 'protectNpc');
    const flickGap = num(params.flickGap, 4, 'flickGap');
    const stepTimeout = num(params.stepTimeout, 80, 'stepTimeout');
    const pauseFor = oneOf(params.pauseFor, ['none', 'threat', 'any'] as const, 'none', 'pauseFor');
    const endOnPlayerHit = params.pauseFor !== undefined;
    const rule: ThreatRule = {
        radius: num(params.playerRadius, DEFAULT_THREAT.radius, 'playerRadius'),
        targetRange: num(params.threatTargetRange, DEFAULT_THREAT.targetRange, 'threatTargetRange'),
        closeTiles: num(params.threatCloseTiles, DEFAULT_THREAT.closeTiles, 'threatCloseTiles'),
        closeTicks: num(params.threatCloseTicks, DEFAULT_THREAT.closeTicks, 'threatCloseTicks')
    };
    const n = course.steps.length;

    const messages = new FreshMessages();
    const hits = new FreshHits();
    let started = false;
    let startTick = 0;
    let lastTick = 0;
    let i = Math.max(0, course.steps.findIndex(st => st.name === params.startStep));
    let phase: Phase = { kind: 'click' };
    let startLifeId = 0;
    let level = 0;
    const levelTicks: Record<number, number> = {};
    let lastFailTick = Number.NEGATIVE_INFINITY;
    let lastEatTick = Number.NEGATIVE_INFINITY;
    const damage = { fall: 0, npc: 0, player: 0 };
    const sightings = new Map<string, Sighting>();
    const trails = new Map<string, Array<[number, number, number]>>();
    const pauseEpisodes = { any: 0, threat: 0 };
    let prayerStart = -1;
    let lastToggle = Number.NEGATIVE_INFINITY;
    let lastOn = Number.NEGATIVE_INFINITY;
    let toggles = 0;
    // per lap, closed by the lap bonus
    const lap = { eats: 0, hits: 0, falls: 0 };
    const lapEats: number[] = [];
    const lapHits: number[] = [];
    const lapFalls: number[] = [];
    let lastXp = 0;
    let lapsDone = 0;
    let lastBonusTick: number | null = null;
    let lastDoneTick = 0;
    let stuck = 0;
    let gainSinceClick = 0;
    // with untilLevelAt 'lap': the tick the level was reached and the obstacles finished after it
    let levelAt: number | null = null;
    let obstaclesAfterLevel = 0;
    /** The current lap was joined partway: its last obstacle will pay no lap bonus. */
    let partialLap = false;
    const lapTicks: number[] = [];
    const stepTicks: Record<string, number[]> = {};
    const fails: Record<string, number> = {};
    let eats = 0;

    const stepAt = (k: number): AgilityStep => course.steps[k % n]!;
    const finishStep = (ctx: ProgramContext, t: number) => {
        const st = stepAt(i);
        (stepTicks[st.name] ??= []).push(t - lastDoneTick);
        lastDoneTick = t;
        stuck = 0;
        i++;
        if (i % n === 0) partialLap = false;
        if (levelAt !== null && t > levelAt) obstaclesAfterLevel++;
        ctx.count('obstacles');
        ctx.progress();
    };
    const resumeAfterFall = (name: string) => {
        const resume = course.resume?.[name];
        if (!resume) return;
        const r = course.steps.findIndex(s => s.name === resume);
        if (r < 0) return;
        const cur = i % n;
        i = i - cur + r + (r < cur ? n : 0);
    };
    const nearestLoc = (ctx: ProgramContext, cands: Array<[number, number, number]>): [number, number, number] | null => {
        const p = ctx.state.player!;
        let best: [number, number, number] | null = null;
        let bestD = Infinity;
        for (const c of cands) {
            if (!ctx.state.nearbyLocs.some(l => l.id === c[0] && l.x === c[1] && l.z === c[2])) continue;
            const d = Math.max(Math.abs(c[1] - p.worldX), Math.abs(c[2] - p.worldZ));
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        // Bridge-flagged locs (logs and ledges stored a plane up) are not in the scene
        // list; the server resolves them anyway.
        return best ?? cands[0] ?? null;
    };
    const clickByOption = (ctx: ProgramContext, re: RegExp): boolean => {
        const p = ctx.state.player!;
        const loc = ctx.state.nearbyLocs
            .filter(l => l.optionsWithIndex.some(o => re.test(o.text)))
            .sort((a, b) => Math.max(Math.abs(a.x - p.worldX), Math.abs(a.z - p.worldZ)) - Math.max(Math.abs(b.x - p.worldX), Math.abs(b.z - p.worldZ)))[0];
        if (!loc) return false;
        return ctx.send({ type: 'interactLoc', x: loc.x, z: loc.z, locId: loc.id, optionIndex: loc.optionsWithIndex.find(o => re.test(o.text))!.opIndex }, `${re.source} ${loc.name}`);
    };

    let ctx0: ProgramContext | null = null;
    const summary = (ended?: AgilityEnd, extra: Record<string, unknown> = {}) => {
        const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : Number.NaN);
        return {
            course: typeof params.course === 'string' ? params.course : 'custom',
            technique,
            ...(ended ? { ended } : {}),
            laps: lapsDone,
            ticks: lastTick - startTick,
            ticksPerLap: mean(lapTicks),
            lapTicks,
            stepTicks: Object.fromEntries(Object.entries(stepTicks).map(([k, v]) => [k, mean(v)])),
            fails,
            eats,
            level,
            levelTicks,
            fallDamage: damage.fall,
            npcDamage: damage.npc,
            playerDamage: damage.player,
            lapEats,
            lapHits,
            lapFalls,
            protect,
            prayerUsed: prayerStart >= 0 ? prayerStart - (ctx0?.state.prayers?.prayerPoints ?? prayerStart) : 0,
            prayerToggles: toggles,
            pauseFor,
            wouldPause: { ...pauseEpisodes },
            sightings: [...sightings.values()],
            ...extra
        };
    };
    const end = (ctx: ProgramContext, ended: AgilityEnd, extra?: Record<string, unknown>) => ctx.done(summary(ended, extra));
    /** The level end under untilLevelAt 'lap', with what finishing the lap cost. */
    const endAtLap = (ctx: ProgramContext) => end(ctx, 'level', { afterLevel: { ticks: ctx.tick - (levelAt ?? ctx.tick), obstacles: obstaclesAfterLevel } });
    /** Under untilLevelAt 'lap', with the level reached: the lap's last step has just completed. */
    const lapClosed = () => untilLevelAt === 'lap' && level >= untilLevel && i % n === 0;
    /**
     * Finishing the lap (untilLevelAt 'lap', the level reached): an obstacle another player holds
     * ('The pipe is being used') is marked busy until its lock has surely lapsed, and the click goes
     * to another of the step's locs at once, or back to the first to come free.
     */
    const finishing = () => untilLevelAt === 'lap' && levelAt !== null;
    const busyUntil = new Map<string, number>();
    const locKey = (c: readonly [number, number, number]) => `${c[0]}@${c[1]},${c[2]}`;

    /** Log every player seen; the first player the pause rule fires for, if any. */
    const watchPlayers = (ctx: ProgramContext, me: Me): { p: NearbyPlayer; why: 'any' | 'targeting' | 'closing' } | null => {
        const t = ctx.tick;
        let fire: { p: NearbyPlayer; why: 'any' | 'targeting' | 'closing' } | null = null;
        for (const p of ctx.state.nearbyPlayers ?? []) {
            const trail = trails.get(p.name) ?? [];
            trails.set(p.name, trail);
            const why = threatOf(p, me, trail, t, rule, course.lapArea);
            trail.push([t, p.x, p.z]);
            while (trail.length && trail[0]![0] < t - rule.closeTicks) trail.shift();
            const onLap = (course.lapArea ?? []).some(b => inBox(b, p.x, p.z));
            let sg = sightings.get(p.name);
            if (!sg) {
                sg = { name: p.name, combatLevel: p.combatLevel, canAttack: false, firstTick: t, lastTick: t, ticks: 0, minDistance: p.distance, onLap: false, offLap: false, any: false };
                sightings.set(p.name, sg);
                ctx.count('sightings');
                ctx.log(`player ${p.name} (combat ${p.combatLevel}) at ${p.distance} tiles`);
            }
            sg.lastTick = t;
            sg.ticks++;
            sg.minDistance = Math.min(sg.minDistance, p.distance);
            sg.canAttack ||= canAttack(me.combatLevel, me.wild, p.combatLevel, wildernessLevel(p.x, p.z));
            if (onLap) sg.onLap = true;
            else sg.offLap = true;
            if (p.distance <= rule.radius && !sg.any) {
                sg.any = true;
                pauseEpisodes.any++;
            }
            if (why && !sg.threat) {
                sg.threat = why;
                pauseEpisodes.threat++;
                ctx.log(`threat: ${p.name} ${why} at ${p.distance} tiles`);
            }
            if (!fire && pauseFor === 'any' && p.distance <= rule.radius) fire = { p, why: 'any' };
            if (!fire && pauseFor === 'threat' && why) fire = { p, why };
        }
        return fire;
    };

    return {
        stallTicks: 160,
        snapshot: summary,
        onTick(ctx) {
            const s = ctx.state;
            const t = ctx.tick;
            lastTick = t;
            ctx0 = ctx;
            const p = s.player;
            if (!p) return;
            if (!started) {
                started = true;
                startTick = t;
                lastDoneTick = t;
                lastXp = skillXp(s, 'agility');
                level = baseLevel(s, 'agility');
                startLifeId = p.lifeId ?? 0;
                prayerStart = s.prayers?.prayerPoints ?? -1;
                messages.take(s);
                hits.take(s);
                if (params.startStep === 'auto') i = Math.max(0, course.steps.findIndex(st => st.name === stepFromPosition(course, p.worldX, p.worldZ, p.level)));
                partialLap = i % n !== 0;
                if (p.worldZ > UNDERGROUND) phase = { kind: 'climb', since: t, tries: 0 };
            }
            if (p.isDead || (p.lifeId ?? 0) !== startLifeId) return ctx.fault('died', summary('died'));

            // xp: obstacle drops, and the lap bonus with the last one
            const xp = skillXp(s, 'agility');
            if (xp !== lastXp) {
                const gain = (xp - lastXp) / XP_RATE;
                lastXp = xp;
                gainSinceClick = Math.max(gainSinceClick, gain);
                if (gain >= course.lapBonus - 0.05) {
                    lapsDone++;
                    lapEats.push(lap.eats);
                    lapHits.push(lap.hits);
                    lapFalls.push(lap.falls);
                    lap.eats = lap.hits = lap.falls = 0;
                    if (lastBonusTick !== null) {
                        lapTicks.push(t - lastBonusTick);
                        ctx.gauge('ticksPerLap', lapTicks.reduce((a, b) => a + b, 0) / lapTicks.length);
                    }
                    lastBonusTick = t;
                    ctx.count('laps');
                }
            }
            const lv = baseLevel(s, 'agility');
            if (lv > level) {
                for (let l = level + 1; l <= lv; l++) levelTicks[l] = t;
                level = lv;
            }
            let failed = false;
            let refused = false;
            let inUse = false;
            for (const m of messages.take(s)) {
                if (FAIL_RE.test(m.text)) failed = true;
                if (REFUSED_RE.test(m.text)) refused = true;
                if (IN_USE_RE.test(m.text)) inUse = true;
            }
            if (failed) {
                lastFailTick = t;
                lap.falls++;
            }

            // the Wilderness watch: who is about, and who hit us
            const me: Me = { x: p.worldX, z: p.worldZ, combatLevel: p.combatLevel, wild: wildernessLevel(p.worldX, p.worldZ) };
            for (const ev of hits.take(s)) {
                const hit = classifyHit(ev, lastFailTick, s.nearbyPlayers ?? [], s.nearbyNpcs ?? [], me);
                damage[hit.source] += ev.damage;
                if (hit.source === 'npc') {
                    ctx.count('npcDamage', ev.damage);
                    lap.hits++;
                }
                if (hit.source === 'player') {
                    ctx.log(`hit ${ev.damage} by a player${hit.attacker ? ` (${hit.attacker.name})` : ''}`);
                    if (endOnPlayerHit) return end(ctx, 'attacked', { attacker: hit.attacker ? playerBrief(hit.attacker) : null, hitTick: t, hp: p.hp });
                }
            }
            if (me.wild > 0) {
                const fire = watchPlayers(ctx, me);
                if (fire) return end(ctx, 'player', { player: { ...playerBrief(fire.p), why: fire.why }, tick: t });
            }

            if (lapsDone >= laps) return end(ctx, 'laps');
            if (t - startTick > maxTicks) return end(ctx, 'maxTicks');
            if (level >= untilLevel) {
                if (untilLevelAt === 'tick') return end(ctx, 'level');
                levelAt ??= t;
                // started (or resumed) at the lap's start on the ground: nothing left to finish
                if (phase.kind === 'click' && i % n === 0 && p.level === 0 && p.worldZ < UNDERGROUND) return endAtLap(ctx);
            }

            // food, in any phase (with eatGap); 'land' holds it through an obstacle wait
            const eatDue = () => eatAnyPhase && eatBelow > 0 && p.hp <= eatBelow && t - lastEatTick >= eatGap;
            const eatNow = (): boolean => {
                const food = invItem(s, foodRe);
                if (!food) {
                    end(ctx, 'no-food', { hp: p.hp });
                    return false;
                }
                if (ctx.send({ type: 'useInventoryItem', slot: food.slot, optionIndex: itemOp(food, /^eat$/i, 1) }, 'eat')) {
                    lastEatTick = t;
                    eats++;
                    lap.eats++;
                    ctx.count('eats');
                }
                return true;
            };
            if (eatDue() && (eatAt === 'any' || phase.kind !== 'wait' || p.hp <= LETHAL_HIT) && !eatNow()) return;

            // Protect from Melee, every tick but the first 3 after an obstacle click: the button runs
            // p_clearpendingaction, which would cancel the walk to the obstacle. On a click tick the
            // toggles go out before the click.
            if (protect !== 'off' && !(phase.kind === 'wait' && t - phase.clickTick < 3)) {
                const on = s.prayers?.activePrayers?.[14] === true;
                const want = protect !== 'near' || (s.nearbyNpcs ?? []).some(nn => nn.distance <= protectRange && protectNpc.test(nn.name));
                const toggle = () => {
                    if (ctx.send({ type: 'togglePrayer', prayerIndex: 14 }, 'protect from melee')) toggles++;
                    lastToggle = t;
                };
                if (want && !on && t - lastToggle >= 2) {
                    toggle();
                    lastOn = t;
                } else if (!want && on && t - lastToggle >= 2) toggle();
                else if (want && on && protect === 'flick' && t - lastOn >= flickGap) {
                    toggle(); // off
                    toggle(); // and on again, in the same tick
                    lastOn = t;
                }
            }

            // level-up and message boxes freeze scripts; continue them
            if (s.dialog?.isOpen && s.dialog.options.length === 0 && !s.dialog.isWaiting) ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');

            if (phase.kind === 'wait') {
                const st = stepAt(i);
                const w = phase;
                if (w.z < UNDERGROUND && p.worldZ > UNDERGROUND) failed = true;
                // the lap's last obstacle without its bonus (0 for the Wilderness rocks, whose endZ covers a broken lap)
                const own = st.xp - course.lapBonus;
                const bonusless = partialLap && i % n === n - 1 && own > 0 && gainSinceClick >= own - 0.05;
                const gained = st.op === -1 ? p.level === st.plane : st.xp > 0 && (gainSinceClick >= st.xp - 0.05 || bonusless);
                const arrived = st.endZ !== undefined && p.worldZ === st.endZ && w.z !== st.endZ;
                if (gained) {
                    finishStep(ctx, t);
                    if (lapClosed()) return endAtLap(ctx);
                    phase = technique === 'plain' ? { kind: 'settle', until: t + settleTicks } : { kind: 'click' };
                } else if (arrived) {
                    // a lap bonus would land on the same tick as the arrival; give it one more
                    if (w.arrivedAt === undefined) {
                        w.arrivedAt = t;
                        return;
                    }
                    finishStep(ctx, w.arrivedAt);
                    if (lapClosed()) return endAtLap(ctx);
                    phase = { kind: 'click' };
                } else if (failed) {
                    fails[st.name] = (fails[st.name] ?? 0) + 1;
                    ctx.count('fails');
                    ctx.log(`fail at ${st.name}`);
                    phase = { kind: 'recover', until: t + 4 };
                    return;
                } else if (inUse && w.loc && finishing()) {
                    busyUntil.set(locKey(w.loc), t + IN_USE_TICKS);
                    ctx.count('inUse');
                    ctx.log(`${st.name} in use at (${w.loc[1]},${w.loc[2]})`);
                    phase = { kind: 'click' };
                } else if (t - w.clickTick > stepTimeout) {
                    ctx.count('stuck');
                    ctx.log(`no completion of ${st.name} after ${stepTimeout} ticks`);
                    if (++stuck > 8) return ctx.fault(`stuck at ${st.name}`, summary());
                    if (refused) i++;
                    else if (p.worldX === w.x && p.worldZ === w.z && i > 0) i--; // unreachable from here: redo the previous one
                    phase = { kind: 'click' };
                } else return;
            }
            if (phase.kind === 'settle') {
                if (t < phase.until) return;
                phase = { kind: 'click' };
            }
            if (phase.kind === 'recover') {
                if (t < phase.until) return;
                if (p.worldZ > UNDERGROUND) phase = { kind: 'climb', since: t, tries: 0 };
                else {
                    resumeAfterFall(stepAt(i).name);
                    ctx.progress();
                    phase = { kind: 'click' };
                }
            }
            if (phase.kind === 'climb') {
                if (p.worldZ < UNDERGROUND) {
                    resumeAfterFall(stepAt(i).name);
                    ctx.progress();
                    phase = { kind: 'click' };
                } else {
                    // a click that lands inside the fall's p_delay is dropped, so retry soon
                    if (t === phase.since || t - phase.since >= 12) {
                        if (++phase.tries > 5) return ctx.fault('could not climb out of the pit', summary());
                        phase.since = t;
                        if (!clickByOption(ctx, /climb-up/i)) {
                            const exit = course.pitExit;
                            if (!exit) return ctx.fault('no climb-up loc in the pit', summary());
                            ctx.send({ type: 'interactLoc', x: exit[1], z: exit[2], locId: exit[0], optionIndex: 1 }, 'climb-up (pit ladder)');
                        }
                    }
                    return;
                }
            }

            if (restockBelow >= 0 && p.worldZ < UNDERGROUND && invCount(s, foodRe) <= restockBelow) return end(ctx, 'low-food', { food: invCount(s, foodRe), hp: p.hp });

            // the click: the next obstacle, on the label that showed the last one done
            const st = stepAt(i);
            // a held eat goes out first: the click after it sets the interaction again
            if (eatAt === 'land' && eatDue() && !eatNow()) return;
            if (!eatAnyPhase && eatBelow > 0 && p.hp <= eatBelow) {
                const food = invItem(s, foodRe);
                if (food && ctx.send({ type: 'useInventoryItem', slot: food.slot, optionIndex: itemOp(food, /^eat$/i, 1) }, 'eat')) {
                    eats++;
                    lap.eats++;
                    ctx.count('eats');
                }
            }
            let sent: boolean;
            let clicked: [number, number, number] | undefined;
            if (st.op === -1) sent = clickByOption(ctx, /climb-down/i);
            else {
                let cands = st.locs;
                if (finishing() && busyUntil.size) {
                    const free = cands.filter(c => (busyUntil.get(locKey(c)) ?? -Infinity) <= t);
                    if (free.length) cands = free;
                    else {
                        // every loc held: click the first to come free when its lock lapses
                        phase = { kind: 'settle', until: Math.min(...cands.map(c => busyUntil.get(locKey(c))!)) };
                        return;
                    }
                }
                const loc = nearestLoc(ctx, cands);
                if (!loc) return ctx.fault(`step ${st.name} has no candidate loc`);
                clicked = loc;
                sent = ctx.send({ type: 'interactLoc', x: loc[1], z: loc[2], locId: loc[0], optionIndex: st.op ?? 1 }, st.name);
            }
            if (!sent) {
                ctx.count('clickFailed');
                return;
            }
            gainSinceClick = 0;
            phase = { kind: 'wait', clickTick: t, x: p.worldX, z: p.worldZ, level: p.level, ...(clicked ? { loc: clicked } : {}) };
        }
    };
}
