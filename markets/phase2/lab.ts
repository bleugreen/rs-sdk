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
 *    then a shark seller offers sharks and the buyer runs the shark purchase; then a third account collects a buy
 *    with a full pack (nothing comes) and runs the purchase, which must make room and collect it.
 * 4. Writes the plan and runs `markets/phase2/run.ts --placeholder-data` on it, stopped by SIGINT after `--sigint`
 *    minutes (the clean-stop path), then prints `markets/phase2/report.ts`.
 *
 * Shark resupply (docs/markets/phase2.md 'Shark resupply'): `--trained=1` gives each staged knight Thieving 99 and
 * Hitpoints 40 so it skips training; `--coins=N` banks N coins with its sharks (the fresh path: `--sharks=0
 * --coins=500`, a first purchase short on coins); `--legacy-sharks=1` writes each staged knight's role-state as the runner before
 * SharkState left it (a bare purchase record, `banked` = `--sharks`), so its buy-sharks stage starts done;
 * `--buy=1` makes the plan buy sharks (`--per-account`, `--minimum`, `--rebuy-min`, `--ceiling`) and passes
 * `--run-ended`; `--ramp=0` turns the ramp off; `--park=1` sets `foodFallback: 'park'`; `--restart=M` stops the runner after M minutes and starts it again. The Exchange check's maker leaves its shark ask open for the rebuy.
 *
 * Knights crowding (docs/markets/phase2.md 'Knights crowding at 8, 16 and 24'): `--warmup=N` sets the ramp's
 * `warmupMinutes` (0 measures each hold the way the runner did before it had one); `--drop-pct=N` its `dropPct`
 * (default 10; a large one keeps the ramp going so every step is measured, its ratio still in the ledger).
 *
 * Memory (docs/markets/phase2.md 'Memory'): `--heap=1` preloads `heap-probe.ts` into the runner, which samples its
 * memory every minute into memory.jsonl in --out and writes heap snapshots at the minutes in PHASE2_HEAP_SNAPSHOTS.
 * `--bank-at=N` sets the knights' `bankAt` (a bank trip every N coins carried) and `--shark-ask=N` the sharks the
 * Exchange check's maker offers (default 300), so a run can compress hours of banking, buying and sailing.
 *
 * `--fresh=1` stages nobody: every account starts on Tutorial Island and the runner's own stages do everything (the
 * Hitpoints-site lab). `--min-free-mb=N` (default 1200) stops the run with SIGINT when the host's available memory
 * falls below N MB, so a shared lab host keeps room for its other tenants; the memory is logged every 30 s.
 *
 * The sale round trip and the pickaxe stage (rs/732): `--sell=1` enables sales of iron ore (floor `--iron-floor`,
 * default 80, into the Exchange check's iron bid, so keep `--exchange=1`) every `--sell-every` minutes (default 5).
 * Of the `--iron` accounts, the first `--bare` leave Tutorial Island with an empty pack (no pickaxe) at the Lumbridge
 * spawn, and the next `--away` the same on the Ardougne side with 200 coins, as a knight sent to iron from the market
 * would be after a death; the rest stay fresh.
 *
 *   . markets/methods/lab/block.sh M20 && LAB_RUNNERS=0 LAB_TIMEOUT=3600 speedrun/lab/lab.sh p2t00 \
 *     'markets/phase2/lab.ts:--prefix=p2t:--knights=0:--guards=0:--iron=4:--bare=1:--away=1:--sell=1:--iron-bid=3000:--sigint=40:--out=/tmp/rs732'
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executionContext } from '../../sdk/execution-context';
import type { BotSDK } from '../../sdk/index';
import { pointMarketAtServer } from '../../speedrun/helpers/mule';
import { memoryRoleState } from '../../speedrun/helpers/role';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats } from '../../speedrun/lab/setup';
import { depositMatching } from '../../speedrun/lib/bank';
import { openDirectSession, type DirectSession } from '../../speedrun/lib/direct';
import { loadBotEnv, ROOT } from '../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { Gentle } from '../lib/demo.ts';
import { DemoMarket } from '../lib/market.ts';
import { lastArg as arg } from '../methods/lab/common-arg.ts';
import { buySharks, sellAtExchange, VARROCK_WEST_BANK } from './errands.ts';
import { SHARK_ID } from './exchange.ts';
import { aliasOf } from './names.ts';

const DRAYNOR_BANK = { x: 3092, z: 3245 };
const LUMBRIDGE = { x: 3222, z: 3218 };
const ARDOUGNE_MARKET = { x: 2665, z: 3290 };
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
const bare = count('bare', 0);
const away = count('away', 0);
const sell = arg('sell', '0') === '1';
const sellEvery = count('sell-every', 5);
const ironFloor = count('iron-floor', 80);
/** Iron ore the Exchange check's maker bids for at 100; its own check sells 500 of it. */
const ironBid = count('iron-bid', 1000);
const trained = arg('trained', '0') === '1';
const coins = count('coins', 0);
const legacySharks = arg('legacy-sharks', '0') === '1';
const buy = arg('buy', '0') === '1';
const rampOn = arg('ramp', '1') === '1';
const park = arg('park', '0') === '1';
const warmup = arg('warmup', '');
const dropPct = count('drop-pct', 10);
const bankAt = arg('bank-at', '');
/** Sharks the Exchange check's maker offers at 600, for the purchases and rebuys to fill. */
const sharkAsk = count('shark-ask', 300);

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
        await mustTele(sdk, DRAYNOR_BANK.x, DRAYNOR_BANK.z);
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        if (sharks > 0) await bankGive(sdk, 'cert_shark', sharks, /^shark$/i);
        if (coins > 0) await bankGive(sdk, 'coins', coins, /^coins$/i);
        await waitTicks(sdk, 2);
        const banked = sdk.getBankItems().find(i => /^shark$/i.test(i.name))?.count ?? 0;
        await bot.closeBank();
        if (trained) await setStats(sdk, { thieving: 99, hitpoints: 40 });
        await mustTele(sdk, LUMBRIDGE.x, LUMBRIDGE.z);
        log('staged', { name, sharks: banked, trained });
    });
}

/** Off Tutorial Island with nothing carried or worn: no pickaxe. On the Ardougne side with 200 coins for its fares. */
async function stageWithoutPickaxe(name: string, where: 'lumbridge' | 'ardougne'): Promise<void> {
    await withSession(name, async sdk => {
        await clearInventory(sdk);
        if (where === 'ardougne') {
            await cheat(sdk, 'give coins 200');
            await waitUntil(sdk, s => s.inventory.some(i => /^coins$/i.test(i.name)), { maxTicks: 10 });
        }
        const to = where === 'ardougne' ? ARDOUGNE_MARKET : LUMBRIDGE;
        await mustTele(sdk, to.x, to.z);
        const s = sdk.getState()!;
        log('staged without a pickaxe', { name, where, carried: s.inventory.map(i => `${i.name} x${i.count}`), worn: s.equipment.map(i => i.name) });
    });
}

/** Both Exchange errands against this engine's own book. */
async function exchangeCheck(): Promise<void> {
    const [maker, taker] = [`${prefix}x1`, `${prefix}x2`];
    ensureBot(maker);
    ensureBot(taker);
    const book = new DemoMarket(new Gentle({ server, minIntervalMs: 500 }));
    // the maker bids 100 for `--iron-bid` (1,000) iron ore and offers 300 sharks at 600
    await withSession(maker, async (sdk, bot) => {
        await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
        await cheat(sdk, `give coins ${ironBid * 100}`);
        await cheat(sdk, `give cert_shark ${sharkAsk}`);
        await waitUntil(sdk, s => s.inventory.some(i => /^shark$/i.test(i.name)), { maxTicks: 10 });
        const g = await bot.openGE();
        if (!g.success) throw new Error(`openGE: ${g.message}`);
        const bid = await bot.placeGEOffer({ item: IRON_ORE.id, side: 'buy', quantity: ironBid, price: 100 });
        const ask = await bot.placeGEOffer({ item: SHARK_ID, side: 'sell', quantity: sharkAsk, price: 600 });
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
    await fullPackCheck(book);
}

/**
 * run-b3 a07 (docs/markets/phase2.md 'Shark resupply'): a collect with no free slot takes nothing and reports success.
 * A raw buy and collect with a full pack shows it; then the purchase errand on the same account must make room,
 * collect what was left and buy the rest.
 */
async function fullPackCheck(book: DemoMarket): Promise<void> {
    const name = `${prefix}x3`;
    ensureBot(name);
    await withSession(name, async (sdk, bot) => {
        await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
        await cheat(sdk, 'give coins 50000');
        await waitUntil(sdk, s => s.inventory.some(i => /^coins$/i.test(i.name)), { maxTicks: 10 });
        await cheat(sdk, `give bronze_dagger ${28 - sdk.getState()!.inventory.length}`);
        await waitUntil(sdk, s => s.inventory.length >= 28, { maxTicks: 10 });
        log('full pack', { slots: sdk.getState()!.inventory.length });
        const g = await bot.openGE();
        if (!g.success) throw new Error(`openGE: ${g.message}`);
        const placed = await bot.placeGEOffer({ item: SHARK_ID, side: 'buy', quantity: 5, price: 701 });
        if (!placed.offer) throw new Error(`place: ${placed.message}`);
        await waitTicks(sdk, 3);
        const col = await bot.collectGEOffer(placed.offer.id, true);
        const left = sdk.getGEState()?.offers.find(o => o.id === placed.offer!.id);
        log('CHECK raw collect with a full pack', { success: col.success, items: col.items, coins: col.coins, message: col.message, offerItemsAfter: left?.items ?? null });
        await bot.closeInterface().catch(() => undefined);
        const x = { sdk, bot, signal: new AbortController().signal, event: (m: string, d?: Record<string, unknown>) => log(`errand: ${m}`, d ?? {}), reportBank: () => undefined };
        const bought = await buySharks(x, { perAccount: 20, ceiling: 701, runEnded: true, fillMinutes: 1 }, book);
        log('CHECK shark purchase after a full-pack collect', { result: bought.record.result, leftovers: bought.record.leftovers, quantity: bought.record.quantity, filled: bought.record.filled, collect: bought.record.collect, after: bought.record.after, banked: bought.banked });
    });
}

const names = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${tag}${String(i + 1).padStart(2, '0')}`);
const knightNames = names('k', knights);
const ironNames = names('i', iron);
const accounts = [...names('g', guards).map(a => ({ account: a, method: 'guards' })), ...knightNames.map(a => ({ account: a, method: 'knights' })), ...ironNames.map(a => ({ account: a, method: 'iron' }))];
for (const a of accounts) ensureBot(a.account);
mkdirSync(out, { recursive: true });

if (exchange) await exchangeCheck();

// four at a time, the last `hungry` knights left fresh
const staged = fresh ? [] : knightNames.slice(0, Math.max(0, knights - hungry));
for (let i = 0; i < staged.length; i += 4) await Promise.all(staged.slice(i, i + 4).map(n => stageKnight(n)));
const bareNames = ironNames.slice(0, bare);
const awayNames = ironNames.slice(bare, bare + away);
for (const n of bareNames) await stageWithoutPickaxe(n, 'lumbridge');
for (const n of awayNames) await stageWithoutPickaxe(n, 'ardougne');
log('staging done', { knights: staged.length, withoutPickaxe: bareNames.length + awayNames.length, fresh: accounts.length - staged.length - bareNames.length - awayNames.length });

// the purchase record the runner wrote before SharkState (errands.ts buySharks' record with its `at`)
if (legacySharks)
    for (const n of staged) {
        const path = join(out, 'role-state', `${aliasOf(accounts.findIndex(a => a.account === n))}.json`);
        mkdirSync(join(out, 'role-state'), { recursive: true });
        writeFileSync(path, JSON.stringify({ 'phase2.sharks': { kind: 'buy', item: SHARK_ID, ceiling: 701, held: sharks, result: 'enough', banked: sharks, at: new Date().toISOString() } }, null, 2) + '\n');
        log('legacy role-state', { name: n, path });
    }

const plan = {
    accounts,
    loginSpacingMs: 2000,
    ramp: rampOn ? { steps, holdMinutes: hold, dropPct, admitTimeoutMinutes: 30, ...(warmup !== '' ? { warmupMinutes: Number(warmup) } : {}) } : null,
    ledger: { everyTicks: 50, bookMinutes: 5 },
    ...(buy
        ? { sharks: { source: 'buy', perAccount: count('per-account', 20), minimum: count('minimum', 5), rebuyMinSharks: count('rebuy-min', 5), ceiling: count('ceiling', 650), fillMinutes: 1 }, foodFallbackMix: { guards: 1 } }
        : {}),
    ...(park ? { foodFallback: 'park' } : {}),
    ...(bankAt !== '' ? { options: { knights: { bankAt: Number(bankAt) } } } : {}),
    ...(sell ? { sell: { enabled: true, cap: 500, everyMinutes: sellEvery, floors: { 'Iron ore': ironFloor }, fillMinutes: 1 } } : {})
};
const planPath = join(out, 'plan.json');
writeFileSync(planPath, JSON.stringify(plan, null, 2));
const heap = arg('heap', '0') === '1';
const spawnRunner = () =>
    Bun.spawn(['bun', ...(heap ? ['--preload', './markets/phase2/heap-probe.ts'] : []), 'markets/phase2/run.ts', planPath, '--out', out, '--placeholder-data', ...(buy ? ['--run-ended'] : [])], {
        cwd: ROOT,
        stdout: 'inherit',
        stderr: 'inherit',
        env: heap ? { ...process.env, PHASE2_HEAP_DIR: out } : process.env
    });
let child = spawnRunner();
// --restart=M: stop the runner after M minutes and start it again on the same --out (its role-state), as markets does
const restart = count('restart', 0);
let restarted: Promise<void> | null = null;
const restartTimer =
    restart > 0
        ? setTimeout(() => {
              restarted = (async () => {
                  log('restarting the runner', { afterMinutes: restart });
                  child.kill('SIGINT');
                  log('runner exited for the restart', { code: await child.exited });
                  child = spawnRunner();
              })();
          }, restart * 60_000)
        : null;
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
let code = await child.exited;
if (restarted) {
    await restarted;
    code = await child.exited;
} else if (restartTimer) clearTimeout(restartTimer);
clearInterval(memWatch);
log('runner exited', { code });
Bun.spawnSync(['bun', 'markets/phase2/report.ts', join(out, 'ledger.jsonl')], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
process.exit(code);
