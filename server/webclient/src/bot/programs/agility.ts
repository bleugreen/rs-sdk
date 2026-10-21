// Agility course laps: click the next obstacle on the label that shows the
// previous one done. Ported from docs/speedrun/scripts/agility-course.ts; the lap
// costs are in docs/speedrun/skills/agility.md ("Every obstacle pays one
// reaction": each tick between seeing an obstacle's xp and the next click landing
// adds a tick per obstacle, which in the page is the one tick the packet needs).
//
// A step is done when an xp drop of at least its xp arrives (the lap bonus lands
// with the last obstacle's), when a ladder step reaches its plane, or when an
// `endZ` step arrives on that row. A fail message or a fall into a pit waits 4
// ticks for the fail script, climbs out of a pit, and resumes at the course's
// resume step. The plain fallback (`technique: 'plain'`) waits `settleTicks`
// after each completion before the next click, a stand-in for the relay's
// reaction, for measuring what the in-page reaction is worth.

import { AGILITY_COURSES, type AgilityCourse, type AgilityStep } from './agility-courses.js';
import type { ProgramContext, ProgramParams, TickProgram } from './types.js';
import { FreshMessages, invItem, itemOp, num, oneOf, regex, skillXp, XP_RATE } from './util.js';

/** Every fail branch in the course scripts prints one of these (gnome_course.rs2 has none). */
const FAIL_RE = /slip and fall|lose your footing|lost your balance|missed a hand hold|missed the rope|were hit by|stumbled|stepped on a broken/i;
const REFUSED_RE = /from here|from this side/i;
const UNDERGROUND = 6400;

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

type Phase =
    | { kind: 'click' }
    | { kind: 'wait'; clickTick: number; x: number; z: number; level: number; arrivedAt?: number }
    | { kind: 'settle'; until: number }
    | { kind: 'recover'; until: number }
    | { kind: 'climb'; since: number; tries: number };

createAgility.params = ['course', 'laps', 'maxTicks', 'technique', 'settleTicks', 'food', 'eatBelow', 'stepTimeout', 'startStep'] as const;
export function createAgility(params: ProgramParams): TickProgram {
    const course = parseCourse(params.course);
    const laps = num(params.laps, Infinity, 'laps');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');
    if (laps === Infinity && maxTicks === Infinity) throw new Error('give laps or maxTicks');
    const technique = oneOf(params.technique, ['react', 'plain'] as const, 'react', 'technique');
    const settleTicks = num(params.settleTicks, 1, 'settleTicks');
    const foodRe = regex(params.food, '^(shark|lobster|swordfish|monkfish|tuna|salmon|trout|cake|2/3 cake|slice of cake)$', 'food');
    const eatBelow = num(params.eatBelow, 0, 'eatBelow');
    const stepTimeout = num(params.stepTimeout, 80, 'stepTimeout');
    const n = course.steps.length;

    const messages = new FreshMessages();
    let started = false;
    let startTick = 0;
    let lastTick = 0;
    let i = Math.max(0, course.steps.findIndex(st => st.name === params.startStep));
    let phase: Phase = { kind: 'click' };
    let lastXp = 0;
    let lapsDone = 0;
    let lastBonusTick: number | null = null;
    let lastDoneTick = 0;
    let stuck = 0;
    let gainSinceClick = 0;
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

    const summary = () => {
        const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : Number.NaN);
        return {
            course: typeof params.course === 'string' ? params.course : 'custom',
            technique,
            laps: lapsDone,
            ticks: lastTick - startTick,
            ticksPerLap: mean(lapTicks),
            lapTicks,
            stepTicks: Object.fromEntries(Object.entries(stepTicks).map(([k, v]) => [k, mean(v)])),
            fails,
            eats
        };
    };

    return {
        stallTicks: 160,
        snapshot: summary,
        onTick(ctx) {
            const s = ctx.state;
            const t = ctx.tick;
            lastTick = t;
            const p = s.player;
            if (!p) return;
            if (!started) {
                started = true;
                startTick = t;
                lastDoneTick = t;
                lastXp = skillXp(s, 'agility');
                messages.take(s);
            }

            // xp: obstacle drops, and the lap bonus with the last one
            const xp = skillXp(s, 'agility');
            if (xp !== lastXp) {
                const gain = (xp - lastXp) / XP_RATE;
                lastXp = xp;
                gainSinceClick = Math.max(gainSinceClick, gain);
                if (gain >= course.lapBonus - 0.05) {
                    lapsDone++;
                    if (lastBonusTick !== null) {
                        lapTicks.push(t - lastBonusTick);
                        ctx.gauge('ticksPerLap', lapTicks.reduce((a, b) => a + b, 0) / lapTicks.length);
                    }
                    lastBonusTick = t;
                    ctx.count('laps');
                }
            }
            let failed = false;
            let refused = false;
            for (const m of messages.take(s)) {
                if (FAIL_RE.test(m.text)) failed = true;
                if (REFUSED_RE.test(m.text)) refused = true;
            }
            if (lapsDone >= laps || t - startTick > maxTicks) return ctx.done(summary());

            // level-up and message boxes freeze scripts; continue them
            if (s.dialog?.isOpen && s.dialog.options.length === 0 && !s.dialog.isWaiting) ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');

            if (phase.kind === 'wait') {
                const st = stepAt(i);
                const w = phase;
                if (w.z < UNDERGROUND && p.worldZ > UNDERGROUND) failed = true;
                const gained = st.op === -1 ? p.level === st.plane : st.xp > 0 && gainSinceClick >= st.xp - 0.05;
                const arrived = st.endZ !== undefined && p.worldZ === st.endZ && w.z !== st.endZ;
                if (gained) {
                    finishStep(ctx, t);
                    phase = technique === 'plain' ? { kind: 'settle', until: t + settleTicks } : { kind: 'click' };
                } else if (arrived) {
                    // a lap bonus would land on the same tick as the arrival; give it one more
                    if (w.arrivedAt === undefined) {
                        w.arrivedAt = t;
                        return;
                    }
                    finishStep(ctx, w.arrivedAt);
                    phase = { kind: 'click' };
                } else if (failed) {
                    fails[st.name] = (fails[st.name] ?? 0) + 1;
                    ctx.count('fails');
                    ctx.log(`fail at ${st.name}`);
                    phase = { kind: 'recover', until: t + 4 };
                    return;
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
                    if (t === phase.since || t - phase.since >= 40) {
                        if (++phase.tries > 5) return ctx.fault('could not climb out of the pit', summary());
                        phase.since = t;
                        if (!clickByOption(ctx, /climb-up/i)) return ctx.fault('no climb-up loc in the pit', summary());
                    }
                    return;
                }
            }

            // the click: the next obstacle, on the label that showed the last one done
            const st = stepAt(i);
            if (eatBelow > 0 && p.hp <= eatBelow) {
                const food = invItem(s, foodRe);
                if (food && ctx.send({ type: 'useInventoryItem', slot: food.slot, optionIndex: itemOp(food, /^eat$/i, 1) }, 'eat')) {
                    eats++;
                    ctx.count('eats');
                }
            }
            let sent: boolean;
            if (st.op === -1) sent = clickByOption(ctx, /climb-down/i);
            else {
                const loc = nearestLoc(ctx, st.locs);
                if (!loc) return ctx.fault(`step ${st.name} has no candidate loc`);
                sent = ctx.send({ type: 'interactLoc', x: loc[1], z: loc[2], locId: loc[0], optionIndex: st.op ?? 1 }, st.name);
            }
            if (!sent) {
                ctx.count('clickFailed');
                return;
            }
            gainSinceClick = 0;
            phase = { kind: 'wait', clickTick: t, x: p.worldX, z: p.worldZ, level: p.level };
        }
    };
}
