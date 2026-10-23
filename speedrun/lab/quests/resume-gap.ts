// Forced resume-gap runs (rs/560): the state a re-run used to be unable to continue from, reached
// for real and then cut by a link drop, and the module re-entered by the resume walk.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/resume-gap.ts:--case=dc-k'
//
// A case names a quest, the lab fixture it starts from (the quest's own lab file), staff-command
// extras on top of it, and a trip: a predicate on the published state. The module runs through
// runResumable (runner/resume.ts) from the fixture's segment; the first state the trip holds on,
// the lite client is SIGKILLed (the demo's client drop), the session watchdog relaunches it, and
// runResumable walks again (resolveResume) and runs on to the case's last segment. The RESULT line
// carries the drop, every resume point (step, mode, reason), each step's ticks by session, and the
// state the case reports at the trip and at the end. Lab only: staff commands.

import type { BotWorldState } from '../../../sdk/types';
import { closeSession, logoutClean, openSession, startWatchdog } from '../../lib/session';
import { TickLog } from '../../lib/ticks';
import { inArea, SPELLS } from '../../lib/travel';
import { waitUntil } from '../../lib/wait';
import { runResumable, sessionLink, type ResumeEvent } from '../../runner/resume';
import { BOUNDARY_STEP, type Step } from '../../runner/step';
import { arg, botArg, result } from '../common';
import { give, leaveTutorial } from '../setup';
import { probesFor } from './demo-quest';
import { applyFixture, letterOf, type QuestFixture } from './run';

interface LoadedQuest {
    stepId: string;
    steps: Step<any>[];
    fixtures: readonly QuestFixture[];
}

interface GapCase {
    title: string;
    load(): Promise<LoadedQuest>;
    /** The lab fixture (segment letter) to start from; the run starts at its segment. */
    fixture: string;
    /** The fixture changed for the case (fewer runes than the route's). */
    tweak?(f: QuestFixture): QuestFixture;
    /** The last segment run after the resume. */
    until: string;
    /** Given after the fixture (obj debug name -> count). */
    give?: Readonly<Record<string, number>>;
    /** The stuck state: the client is dropped the first time this holds. */
    trip(s: BotWorldState): boolean;
    /** What the case reports about a state (runes, quest items). */
    report(s: BotWorldState | null): Record<string, unknown>;
}

const held = (s: BotWorldState | null, re: RegExp) => (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const runes = (s: BotWorldState | null) => ({ law: held(s, /^law rune$/i), water: held(s, /^water rune$/i), air: held(s, /^air rune$/i) });

const CASES: Readonly<Record<string, GapCase>> = {
    'dc-k': {
        title: 'Dwarf Cannon K: the Falador teleport has landed, then the client drops',
        load: async () => {
            const m = await import('../../quests/dwarf-cannon');
            const l = await import('./dwarf-cannon');
            return { stepId: m.stepId, steps: m.steps(), fixtures: l.FIXTURES };
        },
        fixture: 'K',
        until: 'L',
        // Fight Arena's exit leaves SCORED 217-257 air (STEP-MANIFEST entry 16), so on the route a
        // second Falador cast is affordable: it would spend a law rune L's Ardougne cast needs.
        give: { airrune: 217 },
        trip: s => inArea(s, SPELLS.falador.landing),
        report: s => runes(s),
    },
    'gt-m': {
        title: 'Grand Tree M: two of the four twigs placed, then the client drops',
        load: async () => {
            const m = await import('../../quests/grand-tree');
            const l = await import('./grand-tree');
            return { stepId: m.stepId, steps: m.steps(l.grandTree.options as never), fixtures: l.grandTree.fixtures };
        },
        fixture: 'M',
        until: 'M',
        trip: s => held(s, /^twigs$/i) === 2,
        report: s => ({ twigs: held(s, /^twigs$/i), at: { x: s?.player?.worldX, z: s?.player?.worldZ, level: s?.player?.level } }),
    },
    'fc-m': {
        title: 'Fishing Contest M: the last Camelot cast has landed, then the client drops',
        load: async () => {
            const m = await import('../../quests/fishing-contest');
            const l = await import('./fishing-contest');
            return { stepId: m.stepId, steps: m.steps(), fixtures: l.FIXTURES };
        },
        fixture: 'M',
        until: 'N',
        // Exactly one Camelot cast (5 air, 1 law): after it the re-run holds none.
        tweak: f => ({ ...f, items: { ...f.items, lawrune: 1, airrune: 5 } }),
        trip: s => inArea(s, SPELLS.camelot.landing),
        report: s => ({ ...runes(s), trophy: held(s, /fishing trophy/i) }),
    },
};

async function main(): Promise<number> {
    const name = arg('case', '');
    const c = CASES[name];
    if (!c) throw new Error(`--case=${name}: want one of ${Object.keys(CASES).join(', ')}`);
    const q = await c.load();
    const last = q.steps.findIndex(s => letterOf(q.stepId, s.name) === c.until);
    const first = q.steps.find(s => letterOf(q.stepId, s.name) === c.fixture);
    const base = q.fixtures.find(f => f.letter === c.fixture);
    const fixture = base && c.tweak ? c.tweak(base) : base;
    if (last < 0 || !first || !fixture) throw new Error(`${name}: no segment ${c.until} or ${c.fixture}, or no fixture ${c.fixture}`);
    // The module's own table up to `until`: the walk sees every milestone before the stuck one.
    const steps = q.steps.slice(0, last + 1);

    const session = await openSession(botArg(), { launch: true });
    let exit = 1;
    const out: Record<string, unknown> = { case: name, title: c.title, host: process.env.HOSTNAME ?? null };
    try {
        await leaveTutorial(session);
        await applyFixture(session, fixture);
        for (const [k, n] of Object.entries(c.give ?? {})) await give(session.sdk, k, n);
        await waitUntil(session.sdk, () => true, { maxTicks: 2 });
        out.start = { tick: session.sdk.getState()?.tick, ...c.report(session.sdk.getState()) };
        console.log(`START ${JSON.stringify(out.start)}`);

        const wd = startWatchdog(session, { onEvent: e => console.log(`[watchdog] ${e.verdict}: ${e.reason}`) });
        let trip: Record<string, unknown> | null = null;
        // The longest wall gaps between successive ticks, for a loaded host: the drop's own gap is among them.
        const gaps: Array<{ ms: number; tick: number }> = [];
        let last = { tick: -1, at: 0 };
        // Registered outside any step attempt, so the runner's fence never silences it.
        const off = session.sdk.onStateUpdate(s => {
            if (s.tick !== last.tick) {
                const now = Date.now();
                if (last.at) gaps.push({ ms: now - last.at, tick: s.tick });
                gaps.sort((a, b) => b.ms - a.ms).splice(5);
                last = { tick: s.tick, at: now };
            }
            if (trip || !c.trip(s)) return;
            trip = { tick: s.tick, at: { x: s.player?.worldX, z: s.player?.worldZ }, session: session.sessionId, ...c.report(s) };
            console.log(`TRIP ${JSON.stringify(trip)}: SIGKILL the client`);
            session.child?.kill('SIGKILL');
        });
        const log = TickLog.memory();
        const events: ResumeEvent[] = [];
        try {
            const r = await runResumable(session, steps, {
                log, c: {}, link: sessionLink(session), probes: probesFor(steps), from: first.name,
                shouldStop: () => false, logout: async () => {}, tickMonitor: false, restoreTimeoutMs: 5 * 60_000,
                onEvent: e => {
                    events.push(e);
                    console.log(`[resume] ${JSON.stringify(e)}`);
                },
            });
            out.ok = true;
            out.drops = r.drops;
            out.points = r.points;
        } catch (e) {
            out.ok = false;
            out.error = e instanceof Error ? e.message : String(e);
            out.points = events.filter(e => e.kind === 'resume').map(e => (e as Extract<ResumeEvent, { kind: 'resume' }>).point);
        } finally {
            off();
            wd.stop();
        }
        out.trip = trip;
        out.longestTickGaps = gaps;
        out.steps = log.rows.filter(r => !r.kind && r.step !== BOUNDARY_STEP).map(r => ({ step: r.step, session: r.sessionId, ticks: r.ticks, ok: r.ok, ...(r.error ? { error: r.error } : {}) }));
        out.end = { tick: session.sdk.getState()?.tick, ...c.report(session.sdk.getState()) };
        for (const r of out.steps as Array<Record<string, unknown>>) console.log(`  ${String(r.step).padEnd(28)} session ${r.session}  ${r.ticks} ticks  ${r.ok ? 'ok' : `FAILED ${r.error ?? ''}`}`);
        exit = out.ok && trip ? 0 : 1;
    } catch (e) {
        out.ok = false;
        out.error = e instanceof Error ? e.message : String(e);
    } finally {
        result('resume_gap', out);
        await logoutClean(session).catch(() => undefined);
        await closeSession(session);
    }
    return exit;
}

if (import.meta.main) process.exit(await main());
