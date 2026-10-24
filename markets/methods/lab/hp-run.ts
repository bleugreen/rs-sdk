// Lab measurement of the Hitpoints trainer from a truly fresh account (docs/markets/hp-training.md).
//
//   LAB_HELPERS="b2" speedrun/lab/lab.sh b1 'markets/methods/lab/hp-run.ts:--bots=b1,b2:--to=99:--out=/tmp/hp:--bank-kebabs=300'
//
// For each bot (in parallel with --bots, one child process each): leave Tutorial Island, put
// --coins coins (and --bank-kebabs kebabs) in the bank at Draynor by staff command, go back to the
// Lumbridge spawn, then run hp-train.ts to --to. No ::setstat: every trained level is earned.
// --prayer=N --pray=1 run the Prayer-first variant (hp-train.ts --prayer N --pray).
// Each bot's JSONL (samples, events, totals) goes to <out>-<bot>.jsonl, and its totals line is
// also printed as `RESULT <bot> {...}`. Never point it at the demo.
import { readFileSync } from 'node:fs';
import { openSession, closeSession } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { lastArg as arg } from './common-arg';
import { cheat, leaveTutorial, mustTele } from '../../../speedrun/lab/setup';
import { depositMatching } from '../../../speedrun/lib/bank';
import { runProbe } from '../probe-sampler';
import { DRAYNOR_BANK, spec } from '../hp-train';

const LUMBRIDGE = { x: 3222, z: 3218 };
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const bots = arg('bots', positional[0] ?? '').split(',').filter(Boolean);
const out = arg('out', '/tmp/hp-run');
const pass = [
    ...['to', 'site', 'switch-hp', 'kebabs', 'food-per-trip', 'prayer'].flatMap(k => (arg(k, '') ? [`--${k}`, arg(k, '')] : [])),
    ...(arg('pray', '0') === '1' ? ['--pray'] : [])
];

if (bots.length > 1 && !process.argv.includes('--child')) {
    const env = { ...process.env };
    delete env.BOT_USERNAME;
    delete env.PASSWORD;
    const own = process.argv.slice(3).filter(a => !a.startsWith('--bots='));
    // A bot spec may carry its own options after '@': hpp31@prayer=31@pray=1 (they follow, so they win).
    const stagger = Number(arg('stagger', '0'));
    const jobs = bots.map(async (spec, i) => {
        // --stagger=S starts the bots S seconds apart, so the first reaches Zeke's one mithril scimitar first.
        await Bun.sleep(i * stagger * 1000);
        const [b, ...extra] = spec.split('@');
        const args = ['bun', 'markets/methods/lab/hp-run.ts', b!, `--bots=${b}`, '--child', ...own, ...extra.map(e => `--${e}`)];
        return Bun.spawn(args, { env, stdout: 'inherit', stderr: 'inherit' }).exited.then(code => console.log(`JOB ${b} exited ${code}`));
    });
    await Promise.all(jobs);
    process.exit(0);
}

const bot = bots[0]!;
const session = await openSession(bot);
const { sdk } = session;
await leaveTutorial(session);
await waitTicks(sdk, 2);
await mustTele(sdk, DRAYNOR_BANK.x, DRAYNOR_BANK.z);
const opened = await session.bot.openBank();
if (!opened.success) throw new Error(`openBank: ${opened.message}`);
const coins = Number(arg('coins', '2000'));
await cheat(sdk, `give coins ${coins}`);
await waitUntil(sdk, s => s.inventory.some(i => /^coins$/i.test(i.name) && i.count >= coins), { maxTicks: 10 });
await depositMatching(sdk, [/^coins$/i]);
for (let left = Number(arg('bank-kebabs', '0')); left > 0; ) {
    const n = Math.min(left, 28 - sdk.getState()!.inventory.length);
    if (n <= 0) throw new Error('no room to stage kebabs');
    await cheat(sdk, `give kebab ${n}`);
    await waitUntil(sdk, s => s.inventory.filter(i => /^kebab$/i.test(i.name)).length >= n, { maxTicks: 10 });
    await depositMatching(sdk, [/^kebab$/i]);
    left -= n;
}
await waitTicks(sdk, 2);
const bank = sdk.getState()!.bank.items.map(i => ({ name: i.name, count: i.count }));
await session.bot.closeBank();
await mustTele(sdk, LUMBRIDGE.x, LUMBRIDGE.z);
const s = sdk.getState()!;
console.log(`FIXTURE ${bot} ${JSON.stringify({ bank, inventory: s.inventory.map(i => ({ name: i.name, count: i.count })), equipment: s.equipment.map(e => e.name), levels: Object.fromEntries(s.skills.map(k => [k.name, k.baseLevel])) })}`);
await closeSession(session);

const file = `${out}-${bot}.jsonl`;
const code = await runProbe(spec, [bot, '--out', file, ...pass]);
const lines = readFileSync(file, 'utf8').trim().split('\n');
console.log(`RESULT ${bot} ${lines.at(-1)}`);
process.exit(code);
