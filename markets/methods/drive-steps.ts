// Drive a skill module's `steps()` (speedrun/skills/*.ts) standalone, outside the scored runner:
// runSteps on an open session, stopping between steps when `signal` aborts, with the logout left
// to the caller (the probes' lifecycle in probe-sampler.ts logs out once, at its end).
import { runSteps, type RunnerSession, type RunStepsResult, type Step } from '../../speedrun/runner/step';
import { TickLog, type TickRow } from '../../speedrun/lib/ticks';

/** The named steps, in the order given; throws when a name is missing, so a renamed step fails loudly. */
export function pickSteps<C>(steps: readonly Step<C>[], names: readonly string[]): Step<C>[] {
    return names.map(n => {
        const s = steps.find(st => st.name === n);
        if (!s) throw new Error(`no step named '${n}' (have: ${steps.map(st => st.name).join(', ')})`);
        return s;
    });
}

export interface DriveOptions<C> {
    c: C;
    signal: AbortSignal;
    /** The ledger rows land here (default: in memory); `onRow` sees each as it is appended. */
    log?: TickLog;
    onRow?: (row: TickRow) => void;
}

export async function driveSteps<C>(session: RunnerSession, steps: readonly Step<C>[], o: DriveOptions<C>): Promise<RunStepsResult> {
    const log = o.log ?? TickLog.memory();
    if (o.onRow) {
        const append = log.append.bind(log);
        log.append = (row: TickRow) => {
            append(row);
            o.onRow!(row);
        };
    }
    return runSteps(session, steps, {
        log,
        c: o.c,
        signal: o.signal,
        // Passing shouldStop keeps runSteps from installing its own SIGINT handler.
        shouldStop: () => o.signal.aborted,
        logout: async () => undefined,
        tickMonitor: false,
    });
}
