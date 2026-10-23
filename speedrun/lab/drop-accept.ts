// Lab acceptance for run.ts's socket-drop recovery (rs/511): a step run through run.ts's own chain
// runner (runChainOnSession, with the relog budget, so a drop goes through runner/drop-relog.ts), on
// the browser client over the run's page path (proxy.ts in front of the lab world, the tab logged in
// by a one-time token over CDP, as RUN-HOST.md and firemaking-accept.ts), with the page's game socket
// dropped `--drop=<ticks>` into the step.
//
//   (cd server/webclient && bun run build)
//   NODE_TICKRATE=400 SPEEDRUN_TICK_MS=400 LAB_RUNNERS=0 LAB_TIMEOUT=2400 \
//     speedrun/lab/lab.sh <lab bot> speedrun/lab/drop-accept.ts:leg:--drop=0 speedrun/lab/drop-accept.ts:leg:--drop=30 ...
//
// Scenarios (each staged by staff commands first):
//   leg    T23-24, the Falador teleport and the run to the Rusty Anchor (90 ticks), from the cook
//   bank   S25e, herblore at the Varrock west booth from 28 on the ranging-cap list banked (herblore-accept
//          l2: 117 ticks), a bank burst every inventory
//   knife  S22's fly band on the in-page knife loop (knife-cycle), Fishing 27 to 30 at the river
// --drop=0 is the baseline. --drop=N drops the page N ticks after the step starts: the page's saved
// password is spoiled and its game socket closed, so its own reconnect (Client.ts lostCon) fails and it
// falls to the title screen while the world goes on ticking: the 22:15:50Z drop's shape.
//
// One RESULT line: the step's ticks (in-world, every attempt), the drop and the recovery (wall ms and
// those ms in ticks: the old player stays in the world until the new login takes it over, so they are
// on the clock), the relog entries, and the host (`uname -n`): tick figures count only from bgsrv-mac.

import { mkdtempSync } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { ReservationWatch, reservationPath } from '../lib/host-reservation';
import { closeSession, cdpUrl, openSession, ROOT, type Session } from '../lib/session';
import { evaluateInTab } from '../lib/tab';
import { newRunId, TickLog } from '../lib/ticks';
import { tickMs, waitTicks, waitUntil } from '../lib/wait';
import { runChainOnSession } from '../run';
import { tag, type ChainStep } from '../runner/chain';
import { legById, TILES } from '../runner/legs';
import { RelogBudget } from '../runner/relog-budget';
import { DROP_STEP, RESUME_STEP } from '../runner/resume';
import * as fishing from '../skills/fishing';
import * as herblore from '../skills/herblore';
import { launchLabBrowser } from './browser';
import { cheat, leaveTutorial, mustTele, setStats } from './setup';

const bot = process.argv[2];
const scenario = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const SCENARIOS = ['leg', 'bank', 'knife'] as const;
if (!bot || !SCENARIOS.includes(scenario as never)) {
    console.error(`usage: bun speedrun/lab/drop-accept.ts <bot> ${SCENARIOS.join('|')} [--drop=<ticks into the step, 0 = none>]`);
    process.exit(2);
}
const dropAfter = Number(flag('drop', '0'));

/**
 * The page drop, `--shape=title` (default): the game socket closed with the page's one reconnect
 * attempt (Client.ts lostCon's login) swallowed, so it falls to the title screen while the world
 * ticks on: the 22:15:50Z shape. The lab engine takes any password, so spoiling it would not stop
 * the reconnect. `--shape=reconnect`: the socket closed only; the page reconnects itself.
 */
export function dropExpression(shape: string): string {
    return `(() => {
    const c = window.gameClient;
    if (!c || !c.ingame) return 'not in game';
    if (!c.stream) return 'no stream';
    if (${JSON.stringify(shape)} === 'title') c.login = async function () { delete c.login; };
    c.stream.close();
    return 'dropped';
})()`;
}
const shape = flag('shape', 'title')!;

const RANGING_CAP: Record<string, number> = { harralandervial: 1, chocolate_dust: 1, ranarrvial: 8, iritvial: 10, eye_of_newt: 10, kwuarmvial: 17, limpwurt_root: 17, cadantinevial: 14, white_berries: 22, dwarfweedvial: 208, wine_of_zamorak: 208 };

async function stage(s: Session): Promise<ChainStep> {
    const { sdk } = s;
    const say = (cmd: string, settle = 0) => cheat(sdk, cmd, settle);
    await leaveTutorial(s);
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await waitTicks(sdk, 1);
    }
    await say('~clearinv inv', 1);
    await setStats(sdk, { hitpoints: 70, attack: 70, strength: 70, defence: 70 });
    if (scenario === 'leg') {
        await setStats(sdk, { magic: 50 });
        await say('give lawrune 5', 1);
        await say('give airrune 20', 1);
        await say('give waterrune 5', 1);
        await mustTele(sdk, TILES.cook.x, TILES.cook.z);
        return tag('T23-24', 'leg', legById('T23-24'));
    }
    if (scenario === 'bank') {
        await say('~clearinv bank', 1);
        await setStats(sdk, { herblore: 28 });
        await mustTele(sdk, herblore.SCORED_TILE.x, herblore.SCORED_TILE.z);
        await waitUntil(sdk, st => st.nearbyLocs.some(l => l.id === herblore.VARROCK_WEST.id), { maxTicks: 20 });
        for (const [name, n] of Object.entries(RANGING_CAP)) await say(`give cert_${name} ${n}`);
        await waitTicks(sdk, 3);
        // Banked unnoted, as herblore-accept l2: the step withdraws from the booth every inventory.
        const booth = herblore.boothFor(sdk.getState() as BotWorldState, herblore.VARROCK_WEST);
        for (let i = 0; i < 10 && !sdk.getState()!.bank.isOpen; i++) {
            await sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.option);
            await waitUntil(sdk, st => st.bank.isOpen, { maxTicks: 3 });
        }
        for (const id of [...new Set(sdk.getState()!.inventory.map(i => i.id))]) {
            const it = sdk.getState()!.inventory.find(i => i.id === id);
            if (it) await sdk.sendBankDeposit(it.slot, -1);
        }
        await waitUntil(sdk, st => st.inventory.length === 0, { maxTicks: 10 });
        await sdk.sendCloseModal();
        await waitTicks(sdk, 2);
        return tag('S25e', 'step', herblore.steps({ to: 99 })[0]!);
    }
    await setStats(sdk, { fishing: 27 });
    for (const [item, n] of [['fly_fishing_rod', 1], ['feather', 600], ['knife', 1], ['logs', 1]] as const) await say(`give ${item} ${n}`, 1);
    await mustTele(sdk, fishing.RIVER.x, fishing.RIVER.z);
    const band = fishing.steps({ to: 35, runStartXp: 22_406 }).find(st => st.name === 'fishing:fly-20-78')!;
    return tag('S22', 'step', band);
}

const webPort = process.env.WEB_PORT ?? '9300';
const agentPort = process.env.AGENT_PORT ?? '8300';
const cdpPort = Number(webPort) + 5;
const pagePort = Number(webPort) + 6;
const base = mkdtempSync(join(tmpdir(), `drop-accept-${scenario}-`));
const proxy = Bun.spawn(['bun', 'proxy.ts', `--world=http://localhost:${webPort}`, `--port=${pagePort}`, `--gateway=ws://localhost:${agentPort}`, `--bots-dir=${join(ROOT, 'bots')}`], {
    cwd: join(ROOT, 'server', 'webclient'),
    stdout: Bun.file(join(base, 'proxy.log')),
    stderr: Bun.file(join(base, 'proxy.err')),
});
for (let k = 0; k < 50; k++) {
    if (await fetch(`http://127.0.0.1:${pagePort}/bot?bot=x`, { redirect: 'manual' }).then(() => true, () => false)) break;
    await Bun.sleep(200);
}
const browser = await launchLabBrowser(bot, { cdpPort, clientUrl: `http://127.0.0.1:${pagePort}/bot?server=localhost:${webPort}&gateway=ws://localhost:${agentPort}` });
let session: Session | null = null;
let code = 1;
try {
    const s = await openSession(bot, { client: 'browser', launch: true });
    session = s;
    const step = await stage(s);
    const log = TickLog.open(`drop-${newRunId()}`, join(base, 'run.jsonl'));
    const relogs = new RelogBudget(join(base, 'run-dir'));
    // The step's skill xp at its start, at the drop, when it resumed after the relog, and at its end:
    // a dropped player stays in the world, and a server-side action loop (fishing) goes on gaining.
    const skillName = scenario === 'knife' ? 'Fishing' : scenario === 'bank' ? 'Herblore' : null;
    const xpNow = () => (skillName ? (s.sdk.getState()?.skills.find(k => k.name === skillName)?.experience ?? null) : null);
    const xp: { start: number | null; drop: number | null; resumed: number | null; end: number | null } = { start: null, drop: null, resumed: null, end: null };
    let startTick: number | null = null;
    let drop: { tick: number; at: number; answer: string } | null = null;
    const cdp = cdpUrl(s.env)!;
    const arm = () => {
        if (startTick !== null) {
            if (drop && xp.resumed === null) xp.resumed = xpNow();
            return;
        }
        startTick = s.sdk.getState()?.tick ?? -1;
        xp.start = xpNow();
        if (dropAfter <= 0) return;
        const off = s.sdk.onStateUpdate(st => {
            if (drop || st.tick < startTick! + dropAfter) return;
            drop = { tick: st.tick, at: Date.now(), answer: 'pending' };
            xp.drop = xpNow();
            off();
            void evaluateInTab<string>(cdp, s.name, dropExpression(shape)).then(
                r => (drop!.answer = r?.value ?? 'no tab'),
                e => (drop!.answer = `threw ${e}`)
            );
            console.log(`[drop] page dropped at tick ${st.tick} (${dropAfter} ticks into ${step.name})`);
            // What the page itself shows after the drop, sampled each tick for 40 ticks (changes only).
            void (async () => {
                let last = '';
                for (let k = 0; k < 40; k++) {
                    const v = await evaluateInTab<unknown>(cdp, s.name, '(() => { const c = window.gameClient; return c ? [c.ingame, c.loginInProgress, [c.loginMes1, c.loginMes2].filter(Boolean).join(" ")] : null; })()').catch(e => ({ value: `threw ${e}` }));
                    const line = JSON.stringify(v?.value ?? null);
                    if (line !== last) console.log(`[drop] page +${((Date.now() - drop!.at) / tickMs()).toFixed(1)} ticks: ${line}`);
                    last = line;
                    await Bun.sleep(tickMs());
                }
            })();
        });
    };
    const chain: ChainStep[] = [{ ...step, run: async ctx => (arm(), step.run(ctx)), resume: async ctx => (arm(), (step.resume ?? step.run).call(step, ctx)) }];
    const pre = step.preconditions(s.sdk.getState()!, {});
    console.log(`[drop] ${scenario}: ${step.name}, preconditions ${pre === true ? 'pass' : pre}; drop ${dropAfter > 0 ? `${dropAfter} ticks in` : 'none (baseline)'}; host ${hostname()}; tick ${tickMs()} ms`);
    const { result } = await runChainOnSession(s, { log, chain, reservation: new ReservationWatch(reservationPath(join(base, 'no-reservation.json')), { label: 'drop' }), relogs, label: 'drop' });
    code = result.code;
    xp.end = xpNow();
    const rows = log.rows.filter(r => !r.kind && r.step === step.name);
    const drops = log.rows.filter(r => r.step === DROP_STEP);
    const resumes = log.rows.filter(r => r.step === RESUME_STEP);
    const recoverMs = drops.reduce((n, r) => n + ((r.meta as { recoverMs?: number }).recoverMs ?? r.wallMs), 0);
    // The cut attempt's ticks are its failed row when it wrote one, else the step start to the drop.
    const cut = drop && startTick !== null && rows.every(r => r.ok) ? (drop as { tick: number }).tick - startTick : 0;
    const stepTicks = rows.reduce((n, r) => n + r.ticks, 0) + cut;
    console.log(`RESULT drop-accept ${JSON.stringify({
        scenario, shape, step: step.name, dropAfter, host: hostname(), tickMs: tickMs(), code, outcome: result.outcome,
        stepTicks, rows: rows.map(r => ({ ticks: r.ticks, ok: r.ok, sessionId: r.sessionId })), cutTicks: cut,
        drop, drops: drops.map(r => ({ reason: (r.meta as { reason?: string }).reason, recoverMs: (r.meta as { recoverMs?: number }).recoverMs })),
        recoverMs, recoverTicks: Math.round(recoverMs / tickMs()), resumes: resumes.map(r => ({ ticks: r.ticks, point: (r.meta as { step?: string; mode?: string }).step, mode: (r.meta as { mode?: string }).mode })),
        relogs: relogs.entries(), files: base,
        xp, xpPerTick: xp.start !== null && xp.end !== null && stepTicks ? Math.round(((xp.end - xp.start - (xp.drop !== null && xp.resumed !== null ? xp.resumed - xp.drop : 0)) / stepTicks) * 10) / 10 : null,
        xpWhileOut: xp.drop !== null && xp.resumed !== null ? xp.resumed - xp.drop : null,
    })}`);
} catch (e) {
    console.error(`[drop] ${e instanceof Error ? e.stack : e}`);
} finally {
    if (session) await closeSession(session).catch(() => {});
    await browser.kill().catch(() => {});
    proxy.kill('SIGTERM');
}
process.exit(code);
