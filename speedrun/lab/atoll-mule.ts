// Private atoll-start duty fixture, NOT Stronghold-to-atoll route or live staging proof.
// Uses the real launcher/carried mule with ledger-generated packages and a read-only observer.
// NODE_TICKRATE=400 LAB_TIMEOUT=2400 speedrun/lab/lab.sh <lab-scored> 'speedrun/lab/atoll-mule.ts:--gw=8731'
// Defaults: --wait=850 ticks AT P, --lead=70, --spiders=2. All accounts must be lab-only.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { BotSDK } from '../../sdk';
import type { BotWorldState, TradeItem } from '../../sdk/types';
import { h45LauncherEntry } from '../helpers/mule-ledger';

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
const M_MAX = 15; // Receiver assertions, not package configuration.
const P_SHARKS = 9;
const OWN_SHARKS = 3;
const SCORED_M_JUNK = 28 - M_MAX - 1; // Canonical receiver leaves one slot spare.
const SCORED_P_JUNK = 28 - P_SHARKS - 2; // Potion plus sharks, then one spare.
const generated = h45LauncherEntry();
const WAIT = Number(arg('wait', '850'));
const LEAD = Number(arg('lead', '70'));
const SPIDERS = Number(arg('spiders', '2'));
const GW = Number(arg('gw', '8731'));
const webPort = process.env.WEB_PORT ?? '9300';

const evidenceDir = process.env.LAB_LOG ?? mkdtempSync(join(tmpdir(), 'atoll-proof-'));
mkdirSync(evidenceDir, { recursive: true });
const snapshots: unknown[] = [];
const snapshot = (label: string, s: BotWorldState) => {
    const entry = { label, observedAt: new Date().toISOString(), tick: s.tick, inGame: s.inGame,
        player: s.player, skills: s.skills,
        inventory: s.inventory.map(({ slot, id, name, count }) => ({ slot, id, name, count })),
        equipment: s.equipment.map(({ slot, id, name, count }) => ({ slot, id, name, count })) };
    snapshots.push(entry);
    appendFileSync(join(evidenceDir, 'atoll-snapshots.jsonl'), JSON.stringify(entry) + '\n');
    console.log('SNAPSHOT ' + JSON.stringify(entry));
    return s;
};
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

// ---- 1. Stage h45 through its own client, then park it logged out on M's tile.
// The launcher takes cairn_ helper names only; a lab-only one (cairn_lab45) exists on the lab engine alone.
const muleBot = arg('mule', 'cairn_lab45');
const scoredBot = botArg();
if (!/^cairn_lab[a-z0-9_]*$/i.test(muleBot) || !/^lab[a-z0-9_]*$/i.test(scoredBot)) {
    throw new Error('Private proof requires cairn_lab* mule and lab* receiver names');
}
const assertPrivate = (env: Record<string, string | undefined>) => {
    if (!/^localhost:\d+$/.test(env.SERVER ?? '') || !/^ws:\/\/(localhost|127\.0\.0\.1):\d+$/.test(env.GATEWAY_URL ?? '')) {
        throw new Error('Private proof refuses non-loopback world/gateway');
    }
};
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
assertPrivate(muleEnv);
assertPrivate(loadBotEnv(scoredBot));
const scoredAcct = loadBotEnv(scoredBot).BOT_USERNAME!;
{
    const h45 = await openSession(muleBot, { launch: true });
    await fresh(h45);
    await clearInventory(h45.sdk);
    await setStats(h45.sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 1, magic: 57, agility: 76 });
    // The reported h45 equipment, not a stronger hypothetical outfit.
    for (const obj of ['adamant_full_helm', 'adamant_longsword', 'adamant_chainbody', 'adamant_platelegs']) await cheat(h45.sdk, `give ${obj} 1`);
    await waitUntil(h45.sdk, s => s.inventory.length >= 4, { maxTicks: 15 });
    for (let pass = 0; pass < 3 && h45.sdk.getState()!.inventory.length; pass++) {
        for (const i of h45.sdk.getState()!.inventory) {
            void h45.sdk.sendUseItem(i.slot, opIndex(i, /^(wear|wield)$/i) ?? 2);
            await waitTicks(h45.sdk, 1);
        }
        await waitTicks(h45.sdk, 2);
    }
    const dressed = h45.sdk.getState()!;
    if (dressed.inventory.length) throw new Error(`h45: not worn: ${dressed.inventory.map(i => `${i.name} [${i.optionsWithIndex.map(o => o.text).join('/')}]`).join(', ')}; worn: ${dressed.equipment.map(e => e.name).join(', ')}`);
    await giveN(h45, 'shark', M_MAX + P_SHARKS + OWN_SHARKS, /^shark$/i);
    await giveN(h45, '4dose2antipoison', 1, /^superantipoison\(4\)$/i);
    await mustTele(h45.sdk, M_TILE.x, M_TILE.z);
    const drain = h45.sdk.getState()!.player!.hp - 68;
    if (drain > 0) await cheat(h45.sdk, `~stat_drain hitpoints ${drain} 0`);
    if (!(await waitUntil(h45.sdk, st => st.player?.hp === 68, { maxTicks: 10 })).ok) throw new Error('HP fixture did not reach 68');
    const st = snapshot('fixture-at-M-not-route-proof', h45.sdk.getState()!);
    check(st.player?.hp === 68 && st.player.maxHp === 99 && st.inventory.length === 28 && sharksIn(st) === 27 &&
        st.inventory.filter(i => i.id === 2448).length === 1, 'max-load fixture: HP68/99, 27 sharks + potion2448, 28 slots');
    check(Object.entries({ Attack: 99, Strength: 99, Defence: 99, Hitpoints: 99, Prayer: 1, Magic: 57, Agility: 76 })
        .every(([name, n]) => st.skills.some(k => k.name.toLowerCase() === name.toLowerCase() && k.baseLevel === n)),
        'reported base skill profile');
    check(st.equipment.length === 4 && ['Adamant full helm', 'Adamant longsword', 'Adamant chainbody', 'Adamant platelegs']
        .every(name => st.equipment.some(i => i.name.toLowerCase() === name.toLowerCase())), 'reported four adamant equipment pieces');
    console.log(`atoll-mule: h45 staged as ${st.player!.name}: ${st.inventory.length} slots (${sharksIn(st)} sharks), worn ${st.equipment.map(e => e.name).join(', ')}, at ${st.player!.worldX},${st.player!.worldZ}`);
    const out = await logoutClean(h45);
    if (!out.ok) throw new Error(`h45 logout: ${out.reason}`);
    await closeSession(h45);
}

// ---- SCORED: 99 HP and Defence (the spiders hunt it while it seeds them), 16 free slots at M (15 sharks plus one spare).
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
await giveN(scored, 'logs', SCORED_M_JUNK, /^logs$/i);
console.log(`atoll-mule: spiders near M after the spawn: ${seeded.join(' ')}`);

// ---- The launcher, h45 only, as run day's config.
const base = mkdtempSync(join(tmpdir(), 'atoll-mule-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const cueDir = join(base, 'h45-cue');
mkdirSync(join(botsDir, muleAcct), { recursive: true, mode: 0o700 });
writeFileSync(join(botsDir, muleAcct, 'bot.env'), `BOT_USERNAME=${muleAcct}\nPASSWORD=${muleEnv.PASSWORD}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
const h45Config = {
    ...generated, account: muleAcct, cueDir,
    options: { ...generated.options, serve: scoredAcct }
};
console.log('GENERATED ' + JSON.stringify(h45Config));
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
let observer: BotSDK | null = null;
let minHp = Infinity;
let observedFrames = 0;
let died = false;
let lastObservedTick = -1;
let lastObservedAt = 0;
const observedInventoryChanges: unknown[] = [];
const healthChanges: { tick: number; hp: number }[] = [];
let lastHp = -1;
let maxFrameGap = 0;
let inventoryKey = '';
const observe = (s: BotWorldState) => {
    if (!s.inGame || !s.player) return;
    if (lastObservedTick >= 0) maxFrameGap = Math.max(maxFrameGap, s.tick - lastObservedTick);
    if (s.player.hp !== lastHp) {
        lastHp = s.player.hp;
        healthChanges.push({ tick: s.tick, hp: lastHp });
    }
    if (s.tick !== lastObservedTick) observedFrames++;
    lastObservedTick = s.tick;
    lastObservedAt = Date.now();
    minHp = Math.min(minHp, s.player.hp);
    died ||= s.player.isDead || s.player.respawnCount > 0;
    const key = JSON.stringify(s.inventory.map(i => [i.slot, i.id, i.count]));
    if (key !== inventoryKey) {
        inventoryKey = key;
        observedInventoryChanges.push({ tick: s.tick, hp: s.player.hp, inventory: s.inventory.map(i => ({ slot: i.slot, id: i.id, count: i.count })) });
        snapshot('mule-inventory-change', s);
    }
};
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
async function trade(label: string, want: { item: RegExp; amount: number }[], ask: { scope: CueScope; items: { item: string; count: number }[] }, muleName: string) {
    let askTick = -1;
    let openTick = -1;
    const offers: { tick: number; screen: string | null; offer: TradeItem[] }[] = [];
    let offerKey = '';
    const unsub = sdk.onStateUpdate(st => {
        const t = tradeOf(st);
        if (t.isOpen && sameName(t.partner, muleName)) {
            const key = JSON.stringify([t.screen, t.theirOffer]);
            if (key !== offerKey) {
                offerKey = key;
                offers.push({ tick: st.tick, screen: t.screen, offer: t.theirOffer });
                console.log(`OFFER ${label} ${key}`);
            }
        }
        if (openTick >= 0 || !t.isOpen || !sameName(t.partner, muleName)) return;
        openTick = st.tick;
        if (ask) {
            writeTopUpAsk(cueDir, ask.items, Date.now(), ask.scope);
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
    return { r: r!, attempts, offers };
}

const bound = setTimeout(() => {
    console.log('atoll-mule: 35 min bound reached');
    child.kill('SIGTERM');
    console.log(results.join('\n'));
    process.exit(1);
}, 35 * 60_000);

try {
    await untilTicks('the launcher holding h45 for its cue', () => h45Status()?.state === 'awaiting-cue', 300);
    check((await listedInWorld(`http://localhost:${webPort}`, muleAcct)) === false, `h45 logged out until H12oM's cue (launcher state ${h45Status()?.state})`);

    observer = new BotSDK({ botUsername: muleAcct, password: muleEnv.PASSWORD, gatewayUrl: `ws://127.0.0.1:${GW}`,
        connectionMode: 'observe', autoLaunchBrowser: false, autoReconnect: false, readyTimeout: 0 });
    observer.onStateUpdate(observe);
    await observer.connect();
    // ---- 2. H12oM opens: h45 logs in at the explicit atoll-start fixture.
    const mCue = new CueWriter(cueDir, scoredAcct, M);
    mCue.write({ beacons: [{ tick: tick(), ms: Date.now() }], turns: [] });
    const openTick = tick();
    const inTicks = await untilTicks('h45 in the world', () => h45Status()?.state === 'online', 400);
    const readyTicks = await untilTicks('the mule ready at M', () => role(/^mule ready$/).length > 0, 400).then(() => tick() - openTick);
    const loaded = role(/^carried: (loaded|SHORT)/)[0]!;
    check(loaded.message === 'carried: loaded', `h45 carried both packages at login: ${JSON.stringify(loaded.data.packages)}`);
    check(readyTicks <= LEAD, `H12oM open -> h45 in the world ${inTicks} ticks, at M ready ${readyTicks} ticks (lead ${LEAD}); the atoll-start readiness walk ${JSON.stringify(loaded.data.walk)}`);
    // The run's minimum lead: SCORED climbs out onto M's tile LEAD ticks after the open.
    const left = LEAD - (tick() - openTick);
    if (left > 0) await waitTicks(sdk, left);
    const wildlifeAtM = role(/^wildlife$/).map(l => ({ tick: l.tick - openTick, ...l.data }));
    check(true, `wildlife at M before SCORED came (ticks after the open): ${JSON.stringify(wildlifeAtM)}`);

    await mustTele(sdk, M_TILE.x, M_TILE.z);
    const st0 = sdk.getState()!;
    const muleName = st0.nearbyPlayers.find(p => sameName(p.name, muleAcct))?.name ?? muleAcct;
    const free = 28 - st0.inventory.length;
    const n = Math.min(M_MAX, free - 1);
    snapshot('receiver-before-M', st0);
    snapshot('mule-before-M', observer.getState()!);
    const mt = await trade('M', [{ item: /^shark$/i, amount: n }], { scope: M, items: [{ item: '^shark$', count: n }] }, muleName);
    await untilTicks('the mule\'s M hand-off line', () => role(/^hand-off$/).some(l => l.data.package === 'H12oM'), 20).catch(() => 0);
    const mHand = role(/^hand-off$/).find(l => l.data.package === 'H12oM');
    const gotM = sharksIn(sdk.getState()!);
    snapshot('receiver-after-M', sdk.getState()!);
    await waitTicks(sdk, 2);
    snapshot('mule-after-M', observer.getState()!);
    check(n === 15 && mt.r.ok && gotM === 15 && free === 16 && sdk.getState()!.inventory.length === 27 && sdk.getState()!.inventory.every(i => [1511, 385].includes(i.id)), `M: SCORED with ${free} free slots asked ${n} and received ${gotM} sharks in ${mt.r.ticks} ticks on its clock (attempts ${JSON.stringify(mt.attempts)}); the mule: ${JSON.stringify(mHand?.data ?? null)}`);
    console.log('TRADE M ' + JSON.stringify(mt));
    const mDoneTick = tick();

    // ---- 3. H12oP opens straight after; h45 moves to P; SCORED goes away for WAIT ticks.
    const pCue = new CueWriter(cueDir, scoredAcct, P);
    pCue.write({ beacons: [{ tick: tick(), ms: Date.now() }], turns: [] });
    await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    await clearInventory(sdk); // what N and O ate
    await giveN(scored, 'logs', SCORED_P_JUNK, /^logs$/i);
    const moved = await untilTicks('h45 at P', () => role(/^carried: moved to the next package tile$/).length > 0, 200).then(() => role(/^carried: moved/)[0]!);
    const pArrival = snapshot('mule-arrived-P', observer.getState()!);
    check(moved.data.ok === true && pArrival.player?.worldX === P_TILE.x && pArrival.player.worldZ === P_TILE.z, `M -> P: ${JSON.stringify(moved.data)} (logged ${moved.tick - mDoneTick} ticks after M's trade)`);
    const pWaitStart = tick();
    const away = WAIT;
    if (away > 0) await waitTicks(sdk, away);
    const waited = tick() - pWaitStart;
    const keeps = role(/^keep-alive$/);
    check(keeps.length >= 1 && keeps.every(k => k.data.moved === true), `the ~${WAIT}-tick wait (${waited} ticks, ${((waited * Number(process.env.NODE_TICKRATE ?? 300)) / 60_000).toFixed(1)} min): ${keeps.length} keep-alive step(s): ${JSON.stringify(keeps.map(k => ({ tick: k.tick - mDoneTick, ...k.data })))}`);
    check(h45Status()?.state === 'online' && (await listedInWorld(`http://localhost:${webPort}`, muleAcct)) === true, `h45 still in the world after the wait (${h45Status()?.state})`);

    const beforeP = snapshot('mule-after-P-idle', observer.getState()!);
    check(observedFrames >= WAIT && Date.now() - lastObservedAt <= 3 * Number(process.env.NODE_TICKRATE ?? 400) && !died && minHp > 0,
        `continuous mule observation: frames=${observedFrames}, minHP=${minHp}, died=${died}, finalTick=${lastObservedTick}`);
    check(sharksIn(beforeP) >= P_SHARKS && beforeP.inventory.some(i => i.id === 2448),
        'P package still fulfillable after M and 850-tick idle');
    // ---- P: SCORED on P's tile takes 9 sharks + the potion.
    await mustTele(sdk, P_TILE.x, P_TILE.z);
    const pReceiver = snapshot('receiver-before-P', sdk.getState()!);
    const pFree = 28 - pReceiver.inventory.length;
    const pSharks = Math.min(P_SHARKS, Math.max(0, pFree - 2));
    check(pFree === 11 && pSharks === 9, 'P arrival-sized request: 11 free minus potion and spare slot permits9 sharks');
    const pt = await trade('P', [{ item: /^superantipoison\(4\)$/i, amount: 1 }, { item: /^shark$/i, amount: pSharks }], { scope: P, items: [{ item: '^superantipoison\\(4\\)$', count: 1 }, { item: '^shark$', count: pSharks }] }, muleName);
    await untilTicks('the mule\'s P hand-off line', () => role(/^hand-off$/).some(l => l.data.package === 'H12oP'), 20).catch(() => 0);
    const pHand = role(/^hand-off$/).find(l => l.data.package === 'H12oP');
    const stP = snapshot('receiver-after-P', sdk.getState()!);
    console.log('TRADE P ' + JSON.stringify(pt));
    await waitTicks(sdk, 2);
    const finalMule = snapshot('mule-after-P', observer.getState()!);
    const consumed = 27 - M_MAX - P_SHARKS - sharksIn(finalMule);
    check(consumed >= 0 && consumed <= OWN_SHARKS && !finalMule.inventory.some(i => i.id === 2448), `food accounting: own consumed=${consumed}, own remaining=${sharksIn(finalMule)}; auto-eating is not configured by the carried engine`);
    const firstPOffer = pt.offers.find(o => o.offer.length > 0)?.offer;
    check(firstPOffer?.[0]?.id === 2448, 'P actual first nonempty offer is potion2448 before sharks');
    check(stP.inventory.length === 27 && stP.inventory.every(i => [1511, 385, 2448].includes(i.id)),
        'P exact receiver inventory: retained17 logs plus potion2448 and9 sharks385; one spare slot');
    const potions = stP.inventory.filter(i => /^superantipoison\(4\)$/i.test(i.name)).length;
    check(pt.r.ok && sharksIn(stP) === P_SHARKS && potions === 1, `P: SCORED received ${sharksIn(stP)} sharks + ${potions} Superantipoison(4) in ${pt.r.ticks} ticks on its clock (attempts ${JSON.stringify(pt.attempts)}); the mule: ${JSON.stringify(pHand?.data ?? null)}`);

    // ---- 4. H12oP's stop: the launcher logs h45 out.
    const stopAt = Date.now();
    pCue.stop([{ tick: tick(), ms: Date.now() }], { final: true });
    const outTicks = await untilTicks('h45 out on its stop', () => launcherLines.some(l => l.includes(`${muleAcct}: out of the run on its stop cue`)), 200);
    let listed: boolean | null = true;
    for (let i = 0; i < 50 && listed !== false; i++) {
        listed = await listedInWorld(`http://localhost:${webPort}`, muleAcct);
        if (listed !== false) await sleep(200);
    }
    check(listed === false && h45Status()?.logout === 'out' && h45Status()?.logins === 1, `logout on H12oP's stop: reported ${outTicks} ticks after the write, unlisted ${Date.now() - stopAt} ms after it (logout ${h45Status()?.logout})`);
    const leftover = role(/^carried: left$/).map(l => l.data);
    check(true, `h45 after the trades: ${JSON.stringify(leftover)}; logins ${h45Status()?.logins}`);
} catch (e) {
    check(false, `atoll-mule: ${e instanceof Error ? e.message : String(e)}`);
} finally {
    observer?.disconnect();
    clearTimeout(bound);
    clearInterval(rolePoll);
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([child.exited, sleep(40_000)]);
    }
    await closeSession(scored);
    writeFileSync(join(evidenceDir, 'atoll-proof.json'), JSON.stringify({
        scope: 'PRIVATE ATOLL START ONLY; not Stronghold route, live inventory, or autonomous eating proof',
        generated: h45Config, results, snapshots, observedInventoryChanges, observedFrames, minHp, died, healthChanges, maxFrameGap, roleLines, launcherLines
    }, null, 2));
    console.log('--- summary');
    console.log(results.join('\n'));
}
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
