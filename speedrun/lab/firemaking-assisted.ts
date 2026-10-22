// Lab rehearsal of the assisted Firemaking 1-99 (rs/228 plan step 4.3), end to end with the real
// pieces: the account is claimed and parked first (rehearse.ts --claim, as cairn_burns is), six
// fm-row droppers each log in holding one 28-log inventory (`restock: held`, preloaded here by
// ::give, the only cheat in the run) and start from one go file written at T0 (`start: cue`,
// `cueAt: written`), staggered so dropper k logs in only about 100 ticks before its first log is
// due, and the account logs in about 100 ticks after T0, when log 0 turns public, and runs
// `rehearse.ts --skill=firemaking` with no kit. Through lab.sh, which starts the engine:
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 LAB_BOTS="fmd1 fmd2 fmd3 fmd4 fmd5 fmd6" \
//     speedrun/lab/lab.sh <fresh account> speedrun/lab/firemaking-assisted.ts:--fm-tree=<dir>
//
// --fm-tree is a checkout holding speedrun/helpers/fm-row.ts with the opt-ins (rs/41's mission
// branch from 47342ae6), whose bots/ and node_modules point at this checkout's. Options:
//   --droppers=fmd1,...,fmd6  --tiles=<parseTiles list> (default LUMBRIDGE_LAP)
//   --login-at=95  observed ticks after T0 at which the account's harness is launched (its login
//                  lands a few ticks later; log 0 turns public at T0 + 101). Ticks are read from
//                  dropper 0's published state (tools/tick-wait.ts), not counted as tickMs() of
//                  wall time: the demo's tick ran 0.34-0.37 s in rs/269, so wall ticks launch early.
//   --skip=1       fm-row skipOccupied (off by default: see rs/228 on lapped rows)
//   --stagger=0    all six droppers log in and arm before T0 (default 1: dropper k about 165 ticks
//                  before its first log is due)
//   --spare-tiles=0  --out=<dir>
// A dropper process is run as `bun <script> <dropper> --preload=<k>` for the preload.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runScript } from '../../sdk/runner';
import { parseLog } from '../lib/ticks';
import { tickMs, waitUntil } from '../lib/wait';
import { parseTiles, routeLogs } from '../skills/firemaking';
import { arg, botArg, result } from './common';
import { cheat, clearInventory } from './setup';
import { loadBotEnv } from '../lib/session';
import { observeTicks } from '../tools/tick-wait';

/** The lab-confirmed lap beside the Lumbridge spawn (rs/228 row check, 4-tick chains throughout). */
export const LUMBRIDGE_LAP = '3222-3218@3219;3218-3243@3218;3242-3223@3219';
const INVENTORY = 28;

const ROOT = resolve(import.meta.dir, '..', '..');
const me = botArg();
const preload = arg('preload', '');

/** Inventory k of the route, as ::give counts by debug name. */
function inventory(k: number): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const t of routeLogs(0).slice(k * INVENTORY, (k + 1) * INVENTORY)) counts.set(t.obj, (counts.get(t.obj) ?? 0) + 1);
    return [...counts];
}

if (preload !== '') {
    // ---- one dropper: out of the tutorial, an empty pack, then exactly its inventory
    const k = Number(preload);
    await runScript(async ({ bot, sdk }) => {
        await bot.skipTutorial().catch(() => {});
        while (sdk.getState()?.dialog.isOpen) {
            await sdk.sendClickDialog(0);
            await sdk.waitForTicks(1);
        }
        await clearInventory(sdk);
        const load = inventory(k);
        for (const [obj, n] of load) await cheat(sdk, `give ${obj} ${n}`);
        const want = load.reduce((a, [, n]) => a + n, 0);
        const r = await waitUntil(sdk, s => s.inventory.length >= want, { maxTicks: 20 });
        console.log(`preload ${me} inventory ${k}: ${load.map(([o, n]) => `${n} ${o}`).join(', ')} -> ${r.ok ? 'ok' : 'SHORT'}`);
    }, { timeout: 0, printState: false });
    process.exit(0);
}

// ---- the orchestrator
const fmTree = resolve(arg('fm-tree', ''));
if (!existsSync(join(fmTree, 'speedrun/helpers/fm-row.ts'))) throw new Error(`--fm-tree=${fmTree} holds no speedrun/helpers/fm-row.ts`);
const droppers = arg('droppers', 'fmd1,fmd2,fmd3,fmd4,fmd5,fmd6').split(',');
const tiles = arg('tiles', LUMBRIDGE_LAP);
const loginAt = Number(arg('login-at', '95'));
const skip = arg('skip', '0') === '1';
const spareTiles = Number(arg('spare-tiles', '0'));
const out = arg('out', '') || mkdtempSync(join(tmpdir(), 'fm-assisted-'));
mkdirSync(out, { recursive: true });
const cueDirPath = join(out, 'cue');
mkdirSync(cueDirPath, { recursive: true });
const ms = tickMs();
const parts = Math.ceil(routeLogs(0).length / INVENTORY);
if (droppers.length !== parts) throw new Error(`held droppers need one per inventory: ${parts}, got ${droppers.length}`);
const tileList = parseTiles(tiles).map(t => [t[0], t[1]]);
const stamp = () => new Date().toISOString();
const say = (s: string) => console.log(`${stamp()} ${s}`);
const procs: Array<ReturnType<typeof Bun.spawn>> = [];
process.on('exit', () => procs.forEach(p => p.kill()));

function spawn(name: string, cmd: string[], cwd: string, env: Record<string, string> = {}) {
    const p = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
    procs.push(p);
    const pipe = async (s: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        const reader = s.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            appendFileSync(join(out, `${name}.log`), dec.decode(value, { stream: true }));
        }
    };
    void pipe(p.stdout as ReadableStream<Uint8Array>);
    void pipe(p.stderr as ReadableStream<Uint8Array>);
    return p;
}

async function waitLog(name: string, phrase: RegExp, seconds: number): Promise<boolean> {
    for (let i = 0; i < seconds * 4; i++) {
        const f = Bun.file(join(out, `${name}.log`));
        if ((await f.exists()) && phrase.test(await f.text())) return true;
        await Bun.sleep(250);
    }
    return false;
}

say(`assisted firemaking lab: account ${me}, droppers ${droppers.join(',')}, ${tileList.length} tiles, skip ${skip}, files in ${out}`);

// 1. Claim and park the account.
const claim = spawn('claim', [process.execPath, 'speedrun/rehearse.ts', '--claim', `--bot=${me}`, '--client=lite', '--lab', `--log=${join(out, 'claim.jsonl')}`], ROOT);
say(`claim exited ${await claim.exited}`);

// 2. Droppers: dropper k is first wanted about 4 x 28k ticks after log 0 (no failed rolls from level
//    43), so it logs in about 105 (reveal + lead) + 60 (login, preload, walk) ticks before that.
const wantedAt = (k: number) => 101 + 4 + 4 * INVENTORY * k;
const stagger = arg('stagger', '1') !== '0';
const loginTick = (k: number) => (stagger ? Math.max(0, wantedAt(k) - 105 - 60) : 0);
const options = (k: number) => ({
    tiles: tileList, parts, part: k, restock: { kind: 'held' }, start: 'cue', cueAt: 'written', cueDir: cueDirPath,
    ...(skip ? { skipOccupied: true, spareTiles } : {})
});
async function startDropper(k: number): Promise<void> {
    const d = droppers[k]!;
    spawn(`runner-${d}`, [process.execPath, 'src/lite/runner.ts', d], join(ROOT, 'server/webclient'));
    if (!(await waitLog(`runner-${d}`, /logged into/, 120))) throw new Error(`${d} did not log in`);
    const pre = spawn(`preload-${d}`, [process.execPath, 'speedrun/lab/firemaking-assisted.ts', d, `--preload=${k}`], ROOT);
    await pre.exited;
    spawn(`fm-row-${d}`, [process.execPath, 'speedrun/helpers/fm-row.ts', d], fmTree, { ROLE_OPTIONS: JSON.stringify(options(k)) });
    say(`dropper ${k} ${d} started`);
}
const early = [0, 1, 2, 3, 4, 5].filter(k => loginTick(k) === 0);
await Promise.all(early.map(startDropper));
for (const k of early) if (!(await waitLog(`fm-row-${droppers[k]}`, /"phase":"armed"/, 180))) throw new Error(`dropper ${k} never armed`);

// 3. T0: the go file. Later launches are placed on dropper 0's observed ticks.
const env0 = loadBotEnv(droppers[0]!);
const ticks = await observeTicks(droppers[0]!, env0.GATEWAY_URL ?? 'ws://127.0.0.1:7780', env0.PASSWORD ?? '');
process.on('exit', () => void ticks.close());
const t0 = Date.now();
writeFileSync(join(cueDirPath, 'fm-row-go.json'), JSON.stringify({ v: 1, ms: t0 }));
const cueTick = ticks.clock.now();
if (cueTick === null) throw new Error(`no published tick from ${droppers[0]}`);
say(`T0 cue written at tick ${cueTick}; later droppers at ${[0, 1, 2, 3, 4, 5].filter(k => loginTick(k) > 0).map(k => `${k}@+${loginTick(k)}`).join(' ')}`);
const at = (tick: number) => ticks.clock.at(cueTick + tick);
const late = [0, 1, 2, 3, 4, 5].filter(k => loginTick(k) > 0).map(async k => {
    await at(loginTick(k));
    await startDropper(k);
});

// 4. The account, about when log 0 turns public.
await at(loginAt);
say(`launching the account's harness at T0+${loginAt} (tick ${ticks.clock.now()}, ${Date.now() - t0} ms after the cue)`);
const acctLog = join(out, 'account.jsonl');
const harness = spawn('account', [process.execPath, 'speedrun/rehearse.ts', '--skill=firemaking', `--bot=${me}`, '--client=lite', '--lab', '--to=99', `--skill-opt=tiles=${tiles}`, `--log=${acctLog}`], ROOT);
const code = await harness.exited;
say(`harness exited ${code} at T0+${Math.round((Date.now() - t0) / ms)} ticks`);
await Promise.race([Promise.all(late), Bun.sleep(5000)]);

// 5. Report.
const rows = existsSync(acctLog) ? parseLog(await Bun.file(acctLog).text()) : [];
const claimRows = existsSync(join(out, 'claim.jsonl')) ? parseLog(await Bun.file(join(out, 'claim.jsonl')).text()) : [];
const session = (rs: typeof rows) => rs.filter(r => r.kind === 'session').map(r => ({ step: r.step, ticks: r.ticks, meta: r.meta }));
const summary = rows.find(r => r.step === 'S03 firemaking summary');
const bands = rows.filter(r => /^S03 firemaking fm-/.test(r.step)).map(r => ({ band: r.step.slice(15), ticks: r.ticks, ...(r.meta as object) }));
const stepRows = rows.filter(r => !r.kind).map(r => ({ step: r.step, ticks: r.ticks, ok: r.ok }));
const ticksOf = (rs: typeof rows) => rs.filter(r => !r.kind).reduce((a, r) => a + r.ticks, 0);
const dropperEnds: Record<string, string> = {};
for (const d of droppers) {
    const f = Bun.file(join(out, `fm-row-${d}.log`));
    const text = (await f.exists()) ? await f.text() : '';
    dropperEnds[d] = text.split('\n').filter(l => /finished|lost|catch-up|skip|warning|Error/i.test(l)).slice(-6).join(' | ').slice(0, 900);
}
result('fm-assisted', { exit: code, claimTicks: ticksOf(claimRows), claimSession: session(claimRows), attemptTicks: ticksOf(rows), steps: stepRows, session: session(rows), summary: summary?.meta, summaryTicks: summary?.ticks, bands, droppers: dropperEnds, out });
process.exit(0);
