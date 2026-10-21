// Example step: bank everything at Varrock west.
//
//   bun speedrun/runner/example-bank.ts <bot> [--lab] [--from=N]
//
// --lab first stages the account with staff commands (tele to the bank, give
// 24 distinct items); that setup is outside the step and its ticks are not
// logged. The step itself opens the bank and deposits everything, and the run
// writes speedrun/runs/<runId>.jsonl (or $SPEEDRUN_LOG) and prints the report.

import { depositAll } from '../lib/bank';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report, TickLog } from '../lib/ticks';
import { give, LAB_ITEMS, near, tele, VARROCK_WEST_BANK } from '../lab/setup';
import { runSteps, type Step } from './step';

const bankEverything: Step = {
    name: 'bank everything at Varrock west',
    preconditions: s => {
        if (!near(s, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 10)) return 'not within 10 tiles of Varrock west bank';
        if (s.inventory.length === 0) return 'inventory is already empty';
        return true;
    },
    run: async ({ bot, sdk }) => {
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        const r = await depositAll(sdk);
        if (!r.ok) throw new Error(`depositAll: ${r.reason}, ${r.remaining.length} items left`);
    },
    postconditions: s => (s.inventory.length === 0 ? true : `inventory still holds ${s.inventory.length} items`),
    logoutSafe: true,
};

const args = process.argv.slice(2);
const bot = args.find(a => !a.startsWith('-'));
if (!bot) {
    console.error('Usage: bun speedrun/runner/example-bank.ts <bot> [--lab] [--from=N]');
    process.exit(2);
}
const fromArg = args.find(a => a.startsWith('--from='))?.slice(7);

const session = await openSession(bot);
try {
    if (args.includes('--lab')) {
        if (!(await tele(session.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('tele failed');
        if (session.sdk.getState()!.inventory.length === 0) await give(session.sdk, LAB_ITEMS.slice(0, 24));
    }
    const log = TickLog.open();
    const result = await runSteps(session, [bankEverything], {
        log,
        c: {},
        ...(fromArg !== undefined ? { from: /^\d+$/.test(fromArg) ? Number(fromArg) : fromArg } : {}),
    });
    console.log(formatReport(report(log.rows)));
    console.log(`log: ${log.path}`);
    if (result.resumeAt !== undefined) console.log(`stopped; resume with --from=${result.resumeAt}`);
} finally {
    await closeSession(session);
}
process.exit(0);
