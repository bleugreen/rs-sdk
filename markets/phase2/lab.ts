/**
 * Lab run of the phase-2 runner (docs/markets/phase2.md 'Running'). Lab only: refuses any SERVER that is not local.
 *
 *   . markets/methods/lab/block.sh M11 && LAB_RUNNERS=0 LAB_TIMEOUT=10800 speedrun/lab/lab.sh p2l00 \
 *     'markets/phase2/lab.ts:--knights=16:--guards=4:--steps=8,16:--hold=10:--sigint=120:--out=/tmp/p2lab'
 *
 * 1. Creates any missing lab bot (bots/<name>/bot.env pointed at the lab's SERVER).
 * 2. Stages every knights account but `--hungry` of them: Tutorial Island left through S00's skip, `--sharks` sharks
 *    put in the bank at Draynor by staff command, back to the Lumbridge spawn. The guards and the hungry knights stay
 *    fresh, so the runner's own tutorial stage runs, and a hungry knight finds no sharks at its first bank visit and
 *    goes to the food fallback.
 * 3. `--exchange=1` (default) checks both Exchange errands against this engine first: a bidder bids for iron ore, a
 *    seller sells banked ore into it with a floor above the bid (refused) and at the floor below it (capped fill);
 *    then a shark seller offers sharks and the buyer runs the shark purchase.
 * 4. Writes the plan and runs `markets/phase2/run.ts --placeholder-data` on it, stopped by SIGINT after `--sigint`
 *    minutes (the clean-stop path), then prints `markets/phase2/report.ts`.
 *
 * `--thieving=N` and `--hp-level=N` set the staged knights' levels by `::setstat` (the knights-crowding lab: the
 * runner's own stages then go straight to admission, the ship and the knights). `--warmup=N` sets the ramp's
 * `warmupMinutes` (0 measures each hold the way the runner did before it had one).
 *
 * `--fresh=1` stages nobody: every account starts on Tutorial Island and the runner's own stages do everything (the
 * Hitpoints-site lab). `--min-free-mb=N` (default 1200) stops the run with SIGINT when the host's available memory
 * falls below N MB, so a shared lab host keeps room for its other tenants; the memory is logged every 30 s.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executionContext } from '../../sdk/execution-context';
import type { BotSDK } from '../../sdk/index';
import { pointMarketAtServer } from '../../speedrun/helpers/mule';
import { memoryRoleState } from '../../speedrun/helpers/role';
import { cheat, leaveTutorial, mustTele, setStats } from '../../speedrun/lab/setup';
import { depositMatching } from '../../speedrun/lib/bank';
import { openDirectSession, type DirectSession } from '../../speedrun/lib/direct';
import { loadBotEnv, ROOT } from '../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { Gentle } from '../lib/demo.ts';
import { DemoMarket } from '../lib/market.ts';
import { lastArg as arg } from '../methods/lab/common-arg.ts';
import { buySharks, sellAtExchange, VARROCK_WEST_BANK } from './errands.ts';
import { SHARK_ID } from './exchange.ts';

const DRAYNOR_BANK = { x: 3092, z: 3245 };
const LUMBRIDGE = { x: 3222, z: 3218 };
const IRON_ORE = { id: 440, name: 'Iron ore' };

const labBot = process.argv[2] ?? '';
const prefix = arg('prefix', 'p2l');
const count = (k: string, d: number) => Number(arg(k, String(d)));
const knights = count('knights', 16);
const guards = count('guards', 4);
const iron = count('iron', 0);
const hungry = count('hungry', 1);
const sharks = count('sharks', 400);
const steps = arg('steps', '8,16').split(',').map(Number);
const hold = count('hold', 10);
const sigint = count('sigint', 0);
const out = arg('out', join(process.env.TMPDIR ?? '/tmp', 'phase2-lab'));
const exchange = arg('exchange', '1') === '1';
const fresh = arg('fresh', '0') === '1';
const minFreeMb = count('min-free-mb', 1200);
const thieving = count('thieving', 0);
const hpLevel = count('hp-level', 0);
const warmup = arg('warmup', '');

const server = loadBotEnv(labBot).SERVER ?? '';
if (!/^(localhost|127\.)/.test(server)) {
    console.error(`lab.ts: SERVER is '${server}', not a local lab: refusing`);
    process.exit(2);
}
const log = (m: string, d: Record<string, unknown> = {}) => console.log(`LAB ${new Date().toISOString()} ${m} ${JSON.stringify(d)}`);

function ensureBot(name: string): void {
    const env = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(env)) {
        const r = Bun.spawnSync(['bun', 'bots/create-bot.ts', name, '--local', '--no-chat'], { cwd: ROOT, stdout: 'ignore', stderr: 'pipe' });
        if (r.exitCode !== 0) throw new Error(`create-bot ${name}: ${r.stderr.toString()}`);
    }
    const text = readFileSync(env, 'utf8').replace(/^SERVER=.*$/m, `SERVER=${server}`).replace(/^TELEMETRY=.*$/m, 'TELEMETRY=false');
    writeFileSync(env, text);
}

async function withSession<T>(name: string, work: (sdk: BotSDK, bot: Awaited<ReturnType<DirectSession['connectSdk']>>['bot'], session: DirectSession) => Promise<T>): Promise<T> {
    const env = loadBotEnv(name);
    const session = await openDirectSession({ host: server, username: env.BOT_USERNAME, password: env.PASSWORD, profanityFilter: false });
    const { sdk, bot } = await session.connectSdk({ showChat: false });
    pointMarketAtServer(sdk, server);
    const ctl = new AbortController();
    try {
        return await executionContext.run({ signal: ctl.signal }, async () => {
            await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
            await leaveTutorial({ sdk, bot, name, sessionId: 1 });
            await waitTicks(sdk, 2);
            return work(sdk, bot, session);
        });
    } finally {
        const r = await session.logout({ timeoutMs: 30_000 });
        if (!r.ok) log('staging logout not confirmed', { name, reason: r.reason });
    }
}

/** `::give` `n` of `obj` and deposit it, at a bank already open. */
async function bankGive(sdk: BotSDK, obj: string, n: number, matches: RegExp): Promise<void> {
    await cheat(sdk, `give ${obj} ${n}`);
    await waitUntil(sdk, s => s.inventory.some(i => matches.test(i.name)), { maxTicks: 10 });
    await depositMatching(sdk, [matches]);
}

async function stageKnight(name: string): Promise<void> {
    await withSession(name, async (sdk, bot) => {
        const stats = { ...(thieving > 0 ? { thieving } : {}), ...(hpLevel > 0 ? { hitpoints: hpLevel } : {}) };
        if (Object.keys(stats).length) await setStats(sdk, stats);
        await mustTele(sdk, DRAYNOR_BANK.x, DRAYNOR_BANK.z);
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        await bankGive(sdk, 'cert_shark', sharks, /^shark$/i);
        await waitTicks(sdk, 2);
        const banked = sdk.getBankItems().find(i => /^shark$/i.test(i.name))?.count ?? 0;
        await bot.closeBank();
        await mustTele(sdk, LUMBRIDGE.x, LUMBRIDGE.z);
        log('staged', { name, sharks: banked });
    });
}

/** Both Exchange errands against this engine's own book. */
async function exchangeCheck(): Promise<void> {
    const [maker, taker] = [`${prefix}x1`, `${prefix}x2`];
    ensureBot(maker);
    ensureBot(taker);
    const book = new DemoMarket(new Gentle({ server, minIntervalMs: 500 }));
    // the maker bids 100 for 1,000 iron ore and offers 300 sharks at 600
    await withSession(maker, async (sdk, bot) => {
        await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
        await cheat(sdk, 'give coins 100000');
        await cheat(sdk, 'give cert_shark 300');
        await waitUntil(sdk, s => s.inventory.some(i => /^shark$/i.test(i.name)), { maxTicks: 10 });
        const g = await bot.openGE();
        if (!g.success) throw new Error(`openGE: ${g.message}`);
        const bid = await bot.placeGEOffer({ item: IRON_ORE.id, side: 'buy', quantity: 1000, price: 100 });
        const ask = await bot.placeGEOffer({ item: SHARK_ID, side: 'sell', quantity: 300, price: 600 });
        log('maker offers', { bid: bid.message, ask: ask.message });
        await bot.closeInterface().catch(() => undefined);
    });
    await withSession(taker, async (sdk, bot) => {
        await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        await bankGive(sdk, 'cert_iron_ore', 600, /^iron ore$/i);
        await bankGive(sdk, 'coins', 100_000, /^coins$/i);
        await bot.closeBank();
        const x = { sdk, bot, signal: new AbortController().signal, event: (m: string, d?: Record<string, unknown>) => log(`errand: ${m}`, d ?? {}), roleState: memoryRoleState(), reportBank: () => undefined };
        const refused = await sellAtExchange(x, { item: IRON_ORE, floor: 150, cap: 500, fillMinutes: 1 }, book);
        log('CHECK sale above the bid', { result: refused.result, reason: refused.reason });
        const sold = await sellAtExchange(x, { item: IRON_ORE, floor: 80, cap: 500, fillMinutes: 1 }, book);
        log('CHECK sale at the floor', { result: sold.result, quantity: sold.quantity, filled: sold.filled, coinsReceived: sold.coinsReceived, expected: sold.expected });
        const bought = await buySharks(x, { perAccount: 120, ceiling: 701, runEnded: true, fillMinutes: 1 }, book);
        log('CHECK shark purchase', { result: bought.record.result, filled: bought.record.filled, banked: bought.banked });
    });
}

const names = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${tag}${String(i + 1).padStart(2, '0')}`);
const knightNames = names('k', knights);
const accounts = [...names('g', guards).map(a => ({ account: a, method: 'guards' })), ...knightNames.map(a => ({ account: a, method: 'knights' })), ...names('i', iron).map(a => ({ account: a, method: 'iron' }))];
for (const a of accounts) ensureBot(a.account);
mkdirSync(out, { recursive: true });

if (exchange) await exchangeCheck();

// four at a time, the last `hungry` knights left fresh
const staged = fresh ? [] : knightNames.slice(0, Math.max(0, knights - hungry));
for (let i = 0; i < staged.length; i += 4) await Promise.all(staged.slice(i, i + 4).map(n => stageKnight(n)));
log('staging done', { knights: staged.length, fresh: accounts.length - staged.length });

const plan = {
    accounts,
    loginSpacingMs: 2000,
    ramp: { steps, holdMinutes: hold, dropPct: 10, admitTimeoutMinutes: 30, ...(warmup !== '' ? { warmupMinutes: Number(warmup) } : {}) },
    ledger: { everyTicks: 50, bookMinutes: 5 }
};
const planPath = join(out, 'plan.json');
writeFileSync(planPath, JSON.stringify(plan, null, 2));
const child = Bun.spawn(['bun', 'markets/phase2/run.ts', planPath, '--out', out, '--placeholder-data'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
if (sigint > 0)
    setTimeout(() => {
        log('sending SIGINT', { afterMinutes: sigint });
        child.kill('SIGINT');
    }, sigint * 60_000);
/** MemAvailable in MB (Linux), null elsewhere. */
const availableMb = (): number | null => {
    try {
        const m = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'));
        return m ? Math.round(Number(m[1]) / 1024) : null;
    } catch {
        return null;
    }
};
/** A process's resident memory in MB (Linux), null when unreadable. */
const rssMb = (pid: number | undefined): number | null => {
    try {
        const m = /^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
        return m ? Math.round(Number(m[1]) / 1024) : null;
    } catch {
        return null;
    }
};
const enginePid = (() => {
    try {
        return Number(readFileSync(join(process.env.LAB_LOG ?? '', 'engine.pid'), 'utf8').trim());
    } catch {
        return undefined;
    }
})();
let memStopped = false;
const memWatch = setInterval(() => {
    const mb = availableMb();
    if (mb === null) return;
    log('memory', { availableMb: mb, runnerMb: rssMb(child.pid), engineMb: rssMb(enginePid) });
    if (mb < minFreeMb && !memStopped) {
        memStopped = true;
        log('sending SIGINT: available memory below the floor', { availableMb: mb, floorMb: minFreeMb });
        child.kill('SIGINT');
    }
}, 30_000);
const code = await child.exited;
clearInterval(memWatch);
log('runner exited', { code });
Bun.spawnSync(['bun', 'markets/phase2/report.ts', join(out, 'ledger.jsonl')], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
process.exit(code);
