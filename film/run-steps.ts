// Runs a step module (a file exporting `steps(options)`: speedrun/skills/*.ts, speedrun/quests/*.ts)
// once against the lab, the way the run's runner does (speedrun/runner/step.ts runSteps), so
// capture.ts can film the run's own code. It attaches to the client capture.ts launched and never
// logs out.
//
//   bun film/run-steps.ts <bot> --module=<path> [--opts=<options.json>] [--log=<rows.jsonl>]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeSession, openSession } from '../speedrun/lib/session';
import { TickLog } from '../speedrun/lib/ticks';
import { runSteps, type Step } from '../speedrun/runner/step';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const bot = argv.find(a => !a.startsWith('-'));
const modulePath = flag('module');
if (!bot || !modulePath) throw new Error('usage: bun film/run-steps.ts <bot> --module=<path> [--opts=<options.json>] [--log=<rows.jsonl>]');

const mod = (await import(resolve(modulePath))) as { steps?: (options: unknown) => Step<Record<string, never>>[] };
if (typeof mod.steps !== 'function') throw new Error(`${modulePath} exports no steps(options)`);
const options: unknown = flag('opts') ? JSON.parse(readFileSync(flag('opts')!, 'utf8')) : {};
const steps = mod.steps(options);

const session = await openSession(bot, { client: 'browser' });
const log = TickLog.memory();
const dump = () => {
    const out = flag('log');
    if (out) writeFileSync(out, log.rows.map(r => JSON.stringify(r)).join('\n') + (log.rows.length ? '\n' : ''));
};
// capture.ts stops a clip at its length with SIGTERM: keep the step rows logged so far.
process.on('SIGTERM', () => {
    dump();
    process.exit(143);
});
try {
    const r = await runSteps(session, steps, { log, c: {}, shouldStop: () => false, logout: async () => {} });
    console.log(`RESULT film-steps ${JSON.stringify(r)}`);
} catch (e) {
    console.log(`RESULT film-steps ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}`);
    process.exitCode = 1;
} finally {
    dump();
    await closeSession(session);
}
