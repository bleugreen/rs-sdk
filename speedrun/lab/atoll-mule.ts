// H12o, the Monkey Madness atoll helper (helpers/mule.ts carried mode), end to end on the lab engine:
// the run-machine launcher (standalone.ts) runs the mule for a stand-in h45 with H12o's config, logged
// out until H12oM's cue opens (loginOn) and logged out on H12oP's stop (stopOn); this script plays
// SCORED and writes the cues and the ask as run.ts does (rs/393):
//   1. h45 staged: 99 melee, rune armour worn, 13 + 9 sharks and a Superantipoison(4), parked logged out
//      on P's tile (2803,2724). Jungle spiders spawned on M's tile (2763,2704), the wildlife case.
//   2. H12oM opens: h45 logs in, walks P -> M, clears the spiders. SCORED arrives on M's tile at the
//      run's minimum lead (`--lead`, 70 ticks after the open) and trades with 10 free slots: it writes the
//      top-up ask (`^shark$`, 10) on the open frame and wants exactly 10 sharks.
//   3. H12oP opens straight after; h45 walks M -> P. SCORED leaves (Varrock) for `--wait` ticks (850),
//      across which h45 must keep alive; then SCORED appears on P's tile and takes 9 sharks + 1 potion.
//   4. H12oP stops: the launcher logs h45 out.
// Prints RESULT lines (FAIL for a check that does not hold). Through lab.sh, h45 with a bot.env only:
//
//   NODE_TICKRATE=400 LAB_TIMEOUT=2400 speedrun/lab/lab.sh <scored> 'speedrun/lab/atoll-mule.ts'
// (h45's stand-in is cairn_lab45, a lab-only name; its bot.env is written on first use).
//
// Options: --wait=850 (ticks SCORED is away between the trades), --lead=70, --spiders=2, --gw=8479
// (the launcher's loopback gateway port).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';

import { CueWriter, writeTopUpAsk, type CueScope } from '../helpers/altar-cue';
import type { LauncherStatus } from '../helpers/standalone';
import { listedInWorld } from '../lib/demo-status';
import { closeSession, loadBotEnv, logoutClean, openSession, type Session } from '../lib/session';
import { DROPPED_TICKS, receiveFrom, sameName, tradeOf } from '../lib/trade';
import { waitTicks, waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { arg, botArg } from './common';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats, VARROCK_WEST_BANK } from './setup';

const ROOT = resolve(import.meta.dir, '..', '..');
const M: CueScope = { step: 'H12oM', family: 'mule' };
const P: CueScope = { step: 'H12oP', family: 'mule' };
const M_TILE = { x: 2763, z: 2704 };
const P_TILE = { x: 2803, z: 2724 };
const M_MAX = 13;
const P_SHARKS = 9;
const SCORED_JUNK = 18; // SCORED's 28 less its free slots at each leg: 10 free
const WAIT = Number(arg('wait', '850'));
const LEAD = Number(arg('lead', '70'));
const SPIDERS = Number(arg('spiders', '2'));
const GW = Number(arg('gw', '8479'));
const webPort = process.env.WEB_PORT ?? '9300';

const results: string[] = [];
const check = (ok: boolean, what: string) => {
    results.push(`${ok ? 'RESULT' : 'FAIL'} ${what}`);
    console.log(`${ok ? 'RESULT' : 'FAIL'} ${what}`);
};
const sharksIn = (s: { inventory: { name: string; count: number }[] }) => s.inventory.filter(i => /^shark$/i.test(i.name)).reduce((n, i) => n + i.count, 0);

async function fresh(s: Session): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await leaveTutorial(s);
            return;
        } catch (e) {
            if (attempt >= 3) throw e;
        }
    }
}

async function giveN(s: Session, obj: string, n: number, matches: RegExp): Promise<void> {
    await cheat(s.sdk, `give ${obj} ${n}`);
    const r = await waitUntil(s.sdk, st => st.inventory.filter(i => matches.test(i.name)).reduce((a, i) => a + i.count, 0) >= n, { maxTicks: 15 });
    if (!r.ok) throw new Error(`::give ${obj} ${n} did not land`);
}

// ---- 1. Stage h45 through its own client, then park it logged out on P's tile.
// The launcher takes cairn_ helper names only; a lab-only one (cairn_lab45) exists on the lab engine alone.
const muleBot = arg('mule', 'cairn_lab45');
// bots/create-bot.ts takes no underscore, so the lab account's bot.env (gitignored) is written here.
const muleEnvPath = join(ROOT, 'bots', muleBot, 'bot.env');
if (!existsSync(muleEnvPath)) {
    mkdirSync(join(ROOT, 'bots', muleBot), { recursive: true, mode: 0o700 });
    writeFileSync(
        muleEnvPath,
        `BOT_USERNAME=${muleBot}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${process.env.WEB_PORT ?? '9300'}\nGATEWAY_URL=ws://localhost:${process.env.AGENT_PORT ?? '8300'}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`,
        { mode: 0o600 }
    );
}
const muleEnv = loadBotEnv(muleBot);
const muleAcct = muleEnv.BOT_USERNAME!;
const scoredBot = botArg();
const scoredAcct = loadBotEnv(scoredBot).BOT_USERNAME!;
{
    const h45 = await openSession(muleBot, { launch: true });
    await fresh(h45);
    await clearInventory(h45.sdk);
    await setStats(h45.sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99 });
    // The best melee armour h45 can buy with no Dragon Slayer (the rune platebody needs it).
    for (const obj of ['rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'rune_scimitar']) await cheat(h45.sdk, `give ${obj} 1`);
    await waitUntil(h45.sdk, s => s.inventory.length >= 5, { maxTicks: 15 });
    for (let pass = 0; pass < 3 && h45.sdk.getState()!.inventory.length; pass++) {
        for (const i of h45.sdk.getState()!.inventory) {
            void h45.sdk.sendUseItem(i.slot, opIndex(i, /^(wear|wield)$/i) ?? 2);
            await waitTicks(h45.sdk, 1);
        }
        await waitTicks(h45.sdk, 2);
    }
    const dressed = h45.sdk.getState()!;
    if (dressed.inventory.length) throw new Error(`h45: not worn: ${dressed.inventory.map(i => `${i.name} [${i.optionsWithIndex.map(o => o.text).join('/')}]`).join(', ')}; worn: ${dressed.equipment.map(e => e.name).join(', ')}`);
    await giveN(h45, 'shark', M_MAX + P_SHARKS, /^shark$/i);
    await giveN(h45, '4dose2antipoison', 1, /^superantipoison\(4\)$/i);
    await mustTele(h45.sdk, P_TILE.x, P_TILE.z);
    const st = h45.sdk.getState()!;
    console.log(`atoll-mule: h45 staged as ${st.player!.name}: ${st.inventory.length} slots (${sharksIn(st)} sharks), worn ${st.equipment.map(e => e.name).join(', ')}, at ${st.player!.worldX},${st.player!.worldZ}`);
    const out = await logoutClean(h45);
    if (!out.ok) throw new Error(`h45 logout: ${out.reason}`);
    await closeSession(h45);
}

// ---- SCORED: 99 HP and Defence (the spiders hunt it while it seeds them), 10 free slots.
const scored = await openSession(scoredBot);
const sdk = scored.sdk;
await fresh(scored);
await clearInventory(sdk);
await setStats(sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99 });
const tick = () => sdk.getState()?.tick ?? -1;

// The wildlife case: spiders spawned on M's tile before h45 is in; SCORED leaves at once.
await mustTele(sdk, M_TILE.x, M_TILE.z);
for (let i = 0; i < SPIDERS; i++) await cheat(sdk, 'npcadd mm_jungle_spider');
await waitTicks(sdk, 2);
const seeded = (sdk.getState()?.nearbyNpcs ?? []).filter(n => /jungle spider/i.test(n.name)).map(n => `${n.index}@${n.tileX ?? n.x},${n.tileZ ?? n.z}`);
await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
await giveN(scored, 'logs', SCORED_JUNK, /^logs$/i);
console.log(`atoll-mule: spiders near M after the spawn: ${seeded.join(' ')}`);

// ---- The launcher, h45 only, as run day's config.
const base = mkdtempSync(join(tmpdir(), 'atoll-mule-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const cueDir = join(base, 'h45-cue');
mkdirSync(join(botsDir, muleAcct), { recursive: true, mode: 0o700 });
writeFileSync(join(botsDir, muleAcct, 'bot.env'), `BOT_USERNAME=${muleAcct}\nPASSWORD=${muleEnv.PASSWORD}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
const h45Config = {
    account: muleAcct,
    role: 'mule',
    cueDir,
    loginOn: M,
    stopOn: P,
    options: {
        serve: scoredAcct,
        serveMode: 'request',
        carried: true,
        packages: [
            { name: 'H12oM', scope: M, at: M_TILE, items: [{ item: 'Shark', topUp: { max: M_MAX } }] },
            { name: 'H12oP', scope: P, at: P_TILE, items: [{ item: 'Shark', amount: P_SHARKS }, { item: 'Superantipoison(4)', amount: 1 }] }
        ]
    }
};
const configPath = join(base, 'launch.json');
writeFileSync(configPath, JSON.stringify({ gatewayPort: GW, botsDir, runDir, loginSpacingMs: 1000, accounts: [h45Config] }, null, 2));
console.log(`atoll-mule: launcher files in ${base}`);

const launcherLines: string[] = [];
const child: Subprocess<'ignore', 'pipe', 'inherit'> = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], { cwd: ROOT, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' });
void (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    const reader = child.stdout.getReader();
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            launcherLines.push(line);
            console.log(`[t${tick()}] ${line}`);
        }
    }
})();

// The mule's own log (runDir/logs/<account>.role.log), each line stamped with the server tick seen.
interface RoleLine {
    tick: number;
    message: string;
    data: Record<string, unknown>;
}
const roleLines: RoleLine[] = [];
let roleRead = 0;
const rolePoll = setInterval(() => {
    let text = '';
    try {
        text = readFileSync(join(runDir, 'logs', `${muleAcct}.role.log`), 'utf8');
    } catch {
        return;
    }
    const lines = text.split('\n');
    for (const line of lines.slice(roleRead, lines.length - 1)) {
        const json = line.slice(line.indexOf('{'));
        try {
            const d = JSON.parse(json) as Record<string, unknown>;
            roleLines.push({ tick: tick(), message: String(d.message ?? ''), data: d });
            console.log(`[t${tick()}] h45: ${String(d.message ?? '')} ${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !['t', 'account', 'role', 'message'].includes(k))))}`);
        } catch {
            /* a lite or non-JSON line */
        }
    }
    roleRead = lines.length - 1;
}, 100);
const role = (re: RegExp) => roleLines.filter(l => re.test(l.message));
const status = (): LauncherStatus | null => {
    try {
        return JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as LauncherStatus;
    } catch {
        return null;
    }
};
const h45Status = () => status()?.accounts.find(a => a.account === muleAcct);

async function untilTicks(what: string, ok: () => boolean, maxTicks: number): Promise<number> {
    const t0 = tick();
    const r = await waitUntil(sdk, () => ok() || child.exitCode !== null, { maxTicks });
    if (child.exitCode !== null && !ok()) throw new Error(`the launcher exited (${child.exitCode}) while waiting for ${what}`);
    if (!r.ok) throw new Error(`timed out (${maxTicks} ticks) waiting for ${what}`);
    return tick() - t0;
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** SCORED's half of a hand-off on the tile it stands on: the ask on the open frame (M), then receiveFrom wanting exactly `want`. */
async function trade(label: string, want: { item: RegExp; amount: number }[], ask: { scope: CueScope; count: number } | null, muleName: string) {
    let askTick = -1;
    let openTick = -1;
    const unsub = sdk.onStateUpdate(st => {
        const t = tradeOf(st);
        if (openTick >= 0 || !t.isOpen || !sameName(t.partner, muleName)) return;
        openTick = st.tick;
        if (ask) {
            writeTopUpAsk(cueDir, [{ item: '^shark$', count: ask.count }], Date.now(), ask.scope);
            askTick = st.tick;
        }
    });
    const attempts: unknown[] = [];
    let r: Awaited<ReturnType<typeof receiveFrom>> | null = null;
    for (let i = 0; i < 3; i++) {
        openTick = -1;
        r = await receiveFrom(sdk, muleName, { want, maxTicks: 40, openMaxTicks: 40, noReplyTicks: DROPPED_TICKS });
        attempts.push({ ok: r.ok, ticks: r.ticks, reason: r.reason ?? null, openTick, askTick });
        if (r.ok) break;
        await waitTicks(sdk, 3);
    }
    unsub();
    return { r: r!, attempts };
}

const bound = setTimeout(() => {
    console.log('atoll-mule: 35 min bound reached');
    child.kill('SIGTERM');
    console.log(results.join('\n'));
    process.exit(1);
}, 35 * 60_000);

try {
    await untilTicks('the launcher holding h45 for its cue', () => h45Status()?.state === 'awaiting-cue', 300);
    check(!(await listedInWorld(`http://localhost:${webPort}`, muleAcct)), `h45 logged out until H12oM's cue (launcher state ${h45Status()?.state})`);

    // ---- 2. H12oM opens: h45 logs in at P and walks to M.
    const mCue = new CueWriter(cueDir, scoredAcct, M);
    mCue.write({ beacons: [{ tick: tick(), ms: Date.now() }], turns: [] });
    const openTick = tick();
    const inTicks = await untilTicks('h45 in the world', () => h45Status()?.state === 'online', 400);
    const readyTicks = await untilTicks('the mule ready at M', () => role(/^mule ready$/).length > 0, 400).then(() => tick() - openTick);
    const loaded = role(/^carried: (loaded|SHORT)/)[0]!;
    check(loaded.message === 'carried: loaded', `h45 carried both packages at login: ${JSON.stringify(loaded.data.packages)}`);
    check(readyTicks <= LEAD, `H12oM open -> h45 in the world ${inTicks} ticks, at M ready ${readyTicks} ticks (lead ${LEAD}); the walk P -> M ${JSON.stringify(loaded.data.walk)}`);
    // The run's minimum lead: SCORED climbs out onto M's tile LEAD ticks after the open.
    const left = LEAD - (tick() - openTick);
    if (left > 0) await waitTicks(sdk, left);
    const wildlifeAtM = role(/^wildlife$/).map(l => ({ tick: l.tick - openTick, ...l.data }));
    check(true, `wildlife at M before SCORED came (ticks after the open): ${JSON.stringify(wildlifeAtM)}`);

    await mustTele(sdk, M_TILE.x, M_TILE.z);
    const st0 = sdk.getState()!;
    const muleName = st0.nearbyPlayers.find(p => sameName(p.name, muleAcct))?.name ?? muleAcct;
    const free = 28 - st0.inventory.length;
    const n = Math.min(M_MAX, free);
    const mt = await trade('M', [{ item: /^shark$/i, amount: n }], { scope: M, count: n }, muleName);
    const mHand = role(/^hand-off$/).find(l => l.data.package === 'H12oM');
    const gotM = sharksIn(sdk.getState()!);
    check(mt.r.ok && gotM === n, `M: SCORED with ${free} free slots asked ${n} and received ${gotM} sharks in ${mt.r.ticks} ticks on its clock (attempts ${JSON.stringify(mt.attempts)}); the mule: ${JSON.stringify(mHand?.data ?? null)}`);
    const mDoneTick = tick();

    // ---- 3. H12oP opens straight after; h45 moves to P; SCORED goes away for WAIT ticks.
    const pCue = new CueWriter(cueDir, scoredAcct, P);
    pCue.write({ beacons: [{ tick: tick(), ms: Date.now() }], turns: [] });
    await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    await clearInventory(sdk); // what N and O ate
    await giveN(scored, 'logs', SCORED_JUNK, /^logs$/i);
    const moved = await untilTicks('h45 at P', () => role(/^carried: moved to the next package tile$/).length > 0, 200).then(() => role(/^carried: moved/)[0]!);
    check(moved.data.ok === true, `M -> P: ${JSON.stringify(moved.data)} (logged ${moved.tick - mDoneTick} ticks after M's trade)`);
    const away = WAIT - (tick() - mDoneTick);
    if (away > 0) await waitTicks(sdk, away);
    const waited = tick() - mDoneTick;
    const keeps = role(/^keep-alive$/);
    check(keeps.length >= 1 && keeps.every(k => k.data.moved === true), `the ~${WAIT}-tick wait (${waited} ticks, ${((waited * Number(process.env.NODE_TICKRATE ?? 300)) / 60_000).toFixed(1)} min): ${keeps.length} keep-alive step(s): ${JSON.stringify(keeps.map(k => ({ tick: k.tick - mDoneTick, ...k.data })))}`);
    check(h45Status()?.state === 'online' && (await listedInWorld(`http://localhost:${webPort}`, muleAcct)) === true, `h45 still in the world after the wait (${h45Status()?.state})`);

    // ---- P: SCORED on P's tile takes 9 sharks + the potion.
    await mustTele(sdk, P_TILE.x, P_TILE.z);
    const pt = await trade('P', [{ item: /^shark$/i, amount: P_SHARKS }, { item: /^superantipoison\(4\)$/i, amount: 1 }], null, muleName);
    const pHand = role(/^hand-off$/).find(l => l.data.package === 'H12oP');
    const stP = sdk.getState()!;
    const potions = stP.inventory.filter(i => /^superantipoison\(4\)$/i.test(i.name)).length;
    check(pt.r.ok && sharksIn(stP) === P_SHARKS && potions === 1, `P: SCORED received ${sharksIn(stP)} sharks + ${potions} Superantipoison(4) in ${pt.r.ticks} ticks on its clock (attempts ${JSON.stringify(pt.attempts)}); the mule: ${JSON.stringify(pHand?.data ?? null)}`);

    // ---- 4. H12oP's stop: the launcher logs h45 out.
    const stopAt = Date.now();
    pCue.stop([{ tick: tick(), ms: Date.now() }]);
    const outTicks = await untilTicks('h45 out on its stop', () => launcherLines.some(l => l.includes(`${muleAcct}: out of the run on its stop cue`)), 200);
    let listed = true;
    for (let i = 0; i < 50 && listed; i++) {
        listed = (await listedInWorld(`http://localhost:${webPort}`, muleAcct)) === true;
        if (listed) await sleep(200);
    }
    check(!listed && h45Status()?.logout === 'out', `logout on H12oP's stop: reported ${outTicks} ticks after the write, unlisted ${Date.now() - stopAt} ms after it (logout ${h45Status()?.logout})`);
    const leftover = role(/^carried: left$/).map(l => l.data);
    check(true, `h45 after the trades: ${JSON.stringify(leftover)}; logins ${h45Status()?.logins}`);
} catch (e) {
    check(false, `atoll-mule: ${e instanceof Error ? e.message : String(e)}`);
} finally {
    clearTimeout(bound);
    clearInterval(rolePoll);
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([child.exited, sleep(40_000)]);
    }
    await closeSession(scored);
    console.log('--- summary');
    console.log(results.join('\n'));
}
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
