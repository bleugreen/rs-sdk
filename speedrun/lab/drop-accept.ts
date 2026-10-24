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
//
// Our own run stack going away instead of the page's socket (rs/659, the twin's 01:33-01:38Z outage):
// --gateway-down=N SIGKILLs the lab gateway (lab.sh's, by $LAB_LOG/gateway.pid) N ticks into the step
// for --down-s seconds (default 60), the page's proxy with it when --proxy-down=1, then starts both
// again. --logout-after-adopt=1 sends a raw logout click, past session.ts's guard as the SDK's reconnect
// queue delivered one, on the first tick after run.ts adopts a session. The RESULT adds the outage
// (the page's own tick and in-game flag at the kill and before the restart, read over DevTools while
// the gateway is blind), every logout click the run sent, the injected one, and the step's in-world
// ticks from start to end on the page's counter.

import { mkdtempSync, readFileSync } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import type { Subprocess } from 'bun';
import type { BotWorldState } from '../../sdk/types';
import { ReservationWatch, reservationPath } from '../lib/host-reservation';
import { closeSession, cdpUrl, LOGOUT_BUTTON, openSession, ROOT, type Session } from '../lib/session';
import { evaluateInTab, pageInGame } from '../lib/tab';
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
const gatewayDownAfter = Number(flag('gateway-down', '0'));
const downS = Number(flag('down-s', '60'));
const proxyDown = flag('proxy-down', '0') === '1';
// 1: raw logout clicks (the socket drop as fallback); socket: the page's game socket dropped in the adopt's own tick.
const logoutAfterAdopt = flag('logout-after-adopt', '0');

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
let starts = 0;
const spawnProxy = () =>
    Bun.spawn(['bun', 'proxy.ts', `--world=http://localhost:${webPort}`, `--port=${pagePort}`, `--gateway=ws://localhost:${agentPort}`, `--bots-dir=${join(ROOT, 'bots')}`], {
        cwd: join(ROOT, 'server', 'webclient'),
        stdout: Bun.file(join(base, `proxy-${++starts}.log`)),
        stderr: Bun.file(join(base, `proxy-${starts}.err`)),
    });
/** Until `url` answers anything over HTTP (bounded). */
async function answers(url: string, tries = 100): Promise<boolean> {
    for (let k = 0; k < tries; k++) {
        if (await fetch(url, { redirect: 'manual' }).then(() => true, () => false)) return true;
        await Bun.sleep(100);
    }
    return false;
}
let proxy = spawnProxy();
await answers(`http://127.0.0.1:${pagePort}/bot?bot=x`);
let gatewayChild: Subprocess | null = null;
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

    // Every logout click the run sends, and the one injected past the guard.
    const rawClick = s.sdk.sendClickComponent.bind(s.sdk);
    const logoutClicks: Array<{ at: string; tick: number | null; sessionId: number }> = [];
    s.sdk.sendClickComponent = (id: number) => {
        if (id === LOGOUT_BUTTON) logoutClicks.push({ at: new Date().toISOString(), tick: s.sdk.getState()?.tick ?? null, sessionId: s.sessionId });
        return rawClick(id);
    };
    let injected: { at: string; adoptTick: number | null; sessionId: number; clicks: number; out: 'logout' | 'socket' | 'never'; outAtTick: number | null } | null = null;
    let finished = false;
    // In the adopt's own tick, as the queued click was: re-sent each tick while the engine refuses it
    // (logout.rs2 try_logout needs p_finduid, which a delayed player fails), and past
    // INJECT_CLICK_TICKS the page's game socket is dropped instead, so the page is out either way.
    const INJECT_CLICK_TICKS = 5;
    const injectAfterAdopt = async (sid0: number) => {
        for (;;) {
            if (finished) return;
            if (s.sessionId > sid0) break;
            await Bun.sleep(5);
        }
        const adoptTick = s.sdk.getState()?.tick ?? null;
        injected = { at: new Date().toISOString(), adoptTick, sessionId: s.sessionId, clicks: 0, out: 'never', outAtTick: null };
        for (let k = 0; logoutAfterAdopt !== 'socket' && k < INJECT_CLICK_TICKS; k++) {
            void rawClick(LOGOUT_BUTTON).catch(() => {});
            injected.clicks++;
            await Bun.sleep(tickMs());
            if ((await pageInGame(cdp, s.name).catch(() => null)) === false) {
                injected.out = 'logout';
                break;
            }
        }
        if (injected.out === 'never') {
            const r = await evaluateInTab<string>(cdp, s.name, dropExpression('title')).catch(() => null);
            if (r?.value === 'dropped') injected.out = 'socket';
        }
        injected.outAtTick = await pageTick();
        console.log(`[inject] after the adopt (session ${injected.sessionId}, tick ${adoptTick}): ${injected.clicks} raw logout click(s), the page out by ${injected.out} at page tick ${injected.outAtTick}`);
    };

    const pageTick = async () => (await evaluateInTab<number | null>(cdp, s.name, '(() => { const o = window.gameClient && window.gameClient.botOverlay; return o && typeof o.serverTick === "number" ? o.serverTick : null; })()').catch(() => null))?.value ?? null;
    const outage: { downAt?: string; upAt?: string; tickAtKill?: number | null; inGameAtKill?: boolean | null; tickBeforeUp?: number | null; inGameBeforeUp?: boolean | null; gatewayBackMs?: number } = {};
    const takeDown = async () => {
        const pid = Number(readFileSync(join(process.env.LAB_LOG ?? join(tmpdir(), 'speedrun-lab'), 'gateway.pid'), 'utf8').trim());
        outage.tickAtKill = await pageTick();
        outage.inGameAtKill = await pageInGame(cdp, s.name).catch(() => null);
        outage.downAt = new Date().toISOString();
        process.kill(pid, 'SIGKILL');
        if (proxyDown) proxy.kill('SIGKILL');
        console.log(`[outage] gateway${proxyDown ? ' and proxy' : ''} killed at page tick ${outage.tickAtKill} (${gatewayDownAfter} ticks into ${step.name}); back in ${downS} s`);
        await Bun.sleep(downS * 1000);
        outage.tickBeforeUp = await pageTick();
        outage.inGameBeforeUp = await pageInGame(cdp, s.name).catch(() => null);
        const t0 = Date.now();
        gatewayChild = Bun.spawn(['bun', 'run', 'gateway.ts'], { cwd: join(ROOT, 'server', 'gateway'), stdout: Bun.file(join(base, 'gateway-2.log')), stderr: Bun.file(join(base, 'gateway-2.err')) });
        if (proxyDown) proxy = spawnProxy();
        await answers(`http://127.0.0.1:${agentPort}/`);
        outage.upAt = new Date().toISOString();
        outage.gatewayBackMs = Date.now() - t0;
        console.log(`[outage] gateway back at ${outage.upAt}; the page read tick ${outage.tickBeforeUp}, in game ${outage.inGameBeforeUp} before the restart`);
    };

    const arm = () => {
        if (startTick !== null) {
            if (drop && xp.resumed === null) xp.resumed = xpNow();
            return;
        }
        startTick = s.sdk.getState()?.tick ?? -1;
        xp.start = xpNow();
        if (logoutAfterAdopt !== '0') void injectAfterAdopt(s.sessionId);
        if (gatewayDownAfter > 0) {
            const off = s.sdk.onStateUpdate(st => {
                if (outage.downAt || st.tick < startTick! + gatewayDownAfter) return;
                outage.downAt = 'pending';
                off();
                void takeDown().catch(e => console.error(`[outage] ${e}`));
            });
        }
        if (dropAfter <= 0) return;
        const off = s.sdk.onStateUpdate(st => {
            if (drop || st.tick < startTick! + dropAfter) return;
            drop = { tick: st.tick, at: Date.now(), answer: 'pending' };
            xp.drop = xpNow();
            off();
            // A dropped page publishes no more ticks: a gateway kill set after the drop goes by wall ticks.
            if (gatewayDownAfter > dropAfter) {
                setTimeout(() => {
                    if (outage.downAt) return;
                    outage.downAt = 'pending';
                    void takeDown().catch(e => console.error(`[outage] ${e}`));
                }, (gatewayDownAfter - dropAfter) * tickMs());
            }
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
    finished = true;
    code = result.code;
    xp.end = xpNow();
    // The run's own clean logout at the end is the last click; any before it was a logout of the stand-in mid-run.
    const endTick = logoutClicks.at(-1)?.tick ?? s.sdk.getState()?.tick ?? null;
    const rows = log.rows.filter(r => !r.kind && r.step === step.name);
    const drops = log.rows.filter(r => r.step === DROP_STEP);
    const resumes = log.rows.filter(r => r.step === RESUME_STEP);
    const recoverMs = drops.reduce((n, r) => n + ((r.meta as { recoverMs?: number }).recoverMs ?? r.wallMs), 0);
    // The cut attempt's ticks are its failed row when it wrote one, else the step start to the drop.
    const cut = drop && startTick !== null && rows.every(r => r.ok) ? (drop as { tick: number }).tick - startTick : 0;
    const stepTicks = rows.reduce((n, r) => n + r.ticks, 0) + cut;
    console.log(`RESULT drop-accept ${JSON.stringify({
        scenario, shape, step: step.name, dropAfter, host: hostname(), tickMs: tickMs(), code, outcome: result.outcome,
        gatewayDownAfter, downS, proxyDown, outage, injected, logoutClicks, midRunLogouts: logoutClicks.length - 1,
        startTick, endTick, inWorldTicks: startTick !== null && endTick !== null ? endTick - startTick : null,
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
    (gatewayChild as Subprocess | null)?.kill('SIGTERM');
}
process.exit(code);
