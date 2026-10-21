// Runner boundary ticks: a 10-step dummy chain through runSteps, each step one
// walk of one tile confirmed on arrival. Boundary ticks are the chain's ticks
// that no measured step row contains:
//
//   (tick when runSteps returns - tick when it was called) - sum of step rows
//
// computed from the step rows alone, so the figure means the same thing for
// any runner, whether or not it logs its own boundary rows.
//
//   speedrun/lab/lab.sh srlab1 'speedrun/lab/measure-runner.ts:--n=3:--steps=10'

import { closeSession, openSession } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps, type Step } from '../runner/step';
import { arg, botArg, labLog, result } from './common';
import { cheat, near, tele } from './setup';

const n = Number(arg('n', '3'));
const stepsPerChain = Number(arg('steps', '10'));
/** Two adjacent open tiles in the Lumbridge castle courtyard. */
const A = { x: 3222, z: 3218 };
const B = { x: 3223, z: 3218 };

const session = await openSession(botArg());
const { sdk } = session;
const log = labLog('runner');

// A bot fresh from create-bot is still on Tutorial Island.
await cheat(sdk, 'setvar tutorial 1000');
await waitTicks(sdk, 2);
if (!(await tele(sdk, A.x, A.z))) throw new Error('tele to Lumbridge courtyard failed');

function walkStep(i: number, from: { x: number; z: number }, to: { x: number; z: number }): Step {
    return {
        name: `walk ${i}`,
        preconditions: s => (near(s, from.x, from.z) ? true : `not on ${from.x},${from.z}`),
        run: async ({ sdk }) => {
            const sent = await sdk.sendWalk(to.x, to.z, false);
            if (!sent.success) throw new Error(`sendWalk: ${sent.message}`);
            const w = await waitUntil(sdk, s => near(s, to.x, to.z), { maxTicks: 10 });
            if (!w.ok) throw new Error(`did not reach ${to.x},${to.z}`);
        },
        postconditions: s => (near(s, to.x, to.z) ? true : `not on ${to.x},${to.z}`),
        logoutSafe: false,
    };
}

const steps = Array.from({ length: stepsPerChain }, (_, i) => (i % 2 === 0 ? walkStep(i, A, B) : walkStep(i, B, A)));
const isStepRow = (step: string) => /^walk \d+$/.test(step);

for (let chain = 0; chain < n; chain++) {
    if (!near(sdk.getState(), A.x, A.z) && !(await tele(sdk, A.x, A.z))) throw new Error('tele back to A failed');
    await waitTicks(sdk, 2);
    const first = log.rows.length;
    const t0 = sdk.getState()!.tick;
    await runSteps(session, steps, { log, c: {}, shouldStop: () => false });
    const t1 = sdk.getState()!.tick;
    const rows = log.rows.slice(first);
    const stepRows = rows.filter(r => isStepRow(r.step));
    const measured = stepRows.reduce((a, r) => a + r.ticks, 0);
    const gaps = stepRows.slice(1).map((r, i) => r.startTick - stepRows[i]!.endTick);
    const logged = rows.filter(r => r.step === '(boundary)');
    result('chain', {
        chain,
        steps: stepRows.length,
        totalTicks: t1 - t0,
        measuredTicks: measured,
        boundaryTicks: t1 - t0 - measured,
        entryTicks: stepRows[0] ? stepRows[0].startTick - t0 : null,
        betweenSteps: gaps,
        exitTicks: stepRows.length ? t1 - stepRows[stepRows.length - 1]!.endTick : null,
        ...(logged.length ? { loggedBoundaryTicks: logged.reduce((a, r) => a + r.ticks, 0) } : {}),
    });
}

console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(session);
process.exit(0);
