// One-account wine fermentation read on a live world (cairn://p/rs/468): make a few
// unfermented wines beside Varrock west bank, bank them at once, log out before the
// make's 20-tick timer is due, log back in, and read the bank at login and on until
// login + 60, with Cooking xp and game messages on every tick.
//
//   BOT_USERNAME=... PASSWORD=... SERVER=rs-sdk-demo.fly.dev bun speedrun/lab/wine-bank-read.ts [--wines=3]
//
// Credentials come only from the environment. The account must already have Cooking 35,
// grapes and jugs of water (inventory or bank), and must not be logged in anywhere else.
// Prints one JSON line per event; `tick` is the session's own client clock, which
// restarts with each login, so the second session's reads are also given as
// `sinceLogin`. If it starts inside the Cooks' Guild it climbs down and leaves first.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { initPathfinding } from '../../sdk/pathfinding';
import { depositMatching } from '../lib/bank';
import { demoOrigin, listedInWorld } from '../lib/demo-status';
import { directLogoutText, openDirectSession, type DirectSession } from '../lib/direct';
import { waitForFreshState } from '../lib/fresh-state';
import { ITEM, closeBank, invCount, openBank, position, skillLevel, VARROCK_WEST_BANK, walkNear, withdraw } from '../helpers/wine-common';

const account = process.env.BOT_USERNAME ?? '';
const password = process.env.PASSWORD ?? '';
const host = process.env.SERVER ?? '';
if (!account || !password || !host) {
    console.error('BOT_USERNAME, PASSWORD and SERVER must be set in the environment');
    process.exit(2);
}
// Holds attempt 1's noted wines: a login would let a bank deposit unnote and ferment them.
if (account.toLowerCase() === 'cairn_h40') {
    console.error('refusing cairn_h40');
    process.exit(2);
}
const wines = Math.max(1, Math.min(3, Number(process.argv.find(a => a.startsWith('--wines='))?.slice(8) ?? 3)));
const origin = demoOrigin(host);
const COOKED_CHICKEN = 2140;
const WINE_IDS = [ITEM.wine, ITEM.wineNote, ITEM.jugWine, ITEM.jugWine + 1, ITEM.badWine, ITEM.badWine + 1];

const out = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Live {
    session: DirectSession;
    sdk: BotSDK;
    bot: BotActions;
    loginTick: number;
    stopWatch: () => void;
}
let current: Live | null = null;

const tickOf = (sdk: BotSDK) => sdk.getState()?.tick ?? 0;
const cookingXp = (sdk: BotSDK) => sdk.getSkill('Cooking')?.experience ?? 0;
const ctxOf = (l: Live) => ({ sdk: l.sdk, bot: l.bot, log: (m: string, d?: Record<string, unknown>) => out(`lib: ${m}`, { tick: tickOf(l.sdk), ...d }) });

function wineItems(items: readonly { id: number; name: string; count: number }[]) {
    return items.filter(i => WINE_IDS.includes(i.id as never) || /wine/i.test(i.name)).map(i => ({ id: i.id, name: i.name, count: i.count }));
}

/** Every tick: new game messages, Cooking xp changes, wine items appearing in the inventory. */
function watch(sdk: BotSDK, label: string, loginTick: () => number): () => void {
    const seen = new Set<string>();
    for (const m of sdk.getState()?.gameMessages ?? []) seen.add(`${m.tick}|${m.text}`);
    let xp = cookingXp(sdk);
    let inv = JSON.stringify(wineItems(sdk.getInventory()));
    return sdk.onStateUpdate(s => {
        const rel = s.tick - loginTick();
        for (const m of s.gameMessages ?? []) {
            const k = `${m.tick}|${m.text}`;
            if (seen.has(k)) continue;
            seen.add(k);
            if (m.type === 0 || m.fromSelf) out('message', { session: label, tick: s.tick, sinceLogin: rel, type: m.type, text: m.text });
        }
        const x = s.skills.find(k => k.name === 'Cooking')?.experience ?? xp;
        if (x !== xp) {
            out('cooking xp', { session: label, tick: s.tick, sinceLogin: rel, from: xp, to: x, delta: x - xp, level: s.skills.find(k => k.name === 'Cooking')?.baseLevel });
            xp = x;
        }
        const i = JSON.stringify(wineItems(s.inventory));
        if (i !== inv) {
            out('inventory wine', { session: label, tick: s.tick, sinceLogin: rel, items: JSON.parse(i) });
            inv = i;
        }
    });
}

async function login(label: string): Promise<Live> {
    const delays = [30, 60, 120, 240, 240, 240];
    for (let attempt = 0; ; attempt++) {
        for (let k = 0; k < 30 && (await listedInWorld(origin, account)) === true; k++) await sleep(2_000);
        try {
            const session = await openDirectSession({ host, username: account, password });
            const { sdk, bot } = await session.connectSdk({ showChat: false });
            const fresh = await waitForFreshState(sdk, { timeoutMs: 60_000 });
            const loginTick = fresh.state.tick;
            const live: Live = { session, sdk, bot, loginTick, stopWatch: () => {} };
            live.stopWatch = watch(sdk, label, () => live.loginTick);
            current = live;
            out('logged in', {
                session: label,
                loginTick,
                at: position(sdk),
                cooking: sdk.getSkill('Cooking'),
                inventoryWine: wineItems(sdk.getInventory()),
                inventory: sdk.getInventory().map(i => `${i.name} x${i.count}`)
            });
            void session.ended.then(e => out('session ended', { session: label, reason: e.reason }));
            return live;
        } catch (e) {
            const err = e as { name?: string; code?: number; message?: string };
            out('login refused', { session: label, attempt, name: err.name, code: err.code, message: String(err.message ?? e).slice(0, 200) });
            if (err.name === 'OutdatedClientError' || attempt >= delays.length) throw e;
            await sleep(delays[attempt]! * 1_000);
        }
    }
}

async function logout(l: Live, label: string): Promise<void> {
    await l.bot.dismissBlockingUI().catch(() => {});
    const r = await l.session.logout();
    l.stopWatch();
    current = null;
    out('logout', { session: label, text: directLogoutText(r), clickTick: r.clickTick, endTick: r.endTick, ok: r.ok });
    if (!r.ok) throw new Error(`logout not confirmed: ${directLogoutText(r)}`);
}

async function readBank(l: Live, label: string): Promise<void> {
    const t0 = tickOf(l.sdk);
    await openBank(ctxOf(l));
    const opened = tickOf(l.sdk);
    const items = l.sdk.getBankItems();
    const wine = wineItems(items);
    await closeBank(l.bot, l.sdk);
    out('bank read', { read: label, askedTick: t0, openTick: opened, closeTick: tickOf(l.sdk), sinceLogin: opened - l.loginTick, closedSinceLogin: tickOf(l.sdk) - l.loginTick, wine, cookingXp: cookingXp(l.sdk) });
}

// ---- leaving the Cooks' Guild (stairs and door as in speedrun/helpers/grapes.ts) ----

const GUILD = { x1: 3137, z1: 3444, x2: 3150, z2: 3455 };
const GUILD_DOOR = { x: 3143, z: 3444 };
const GUILD_OUTSIDE = { x: 3143, z: 3443 };
const inGuild = (p: { x: number; z: number }) => p.x >= GUILD.x1 && p.x <= GUILD.x2 && p.z >= GUILD.z1 && p.z <= GUILD.z2;

async function climbDown(l: Live): Promise<void> {
    const want = position(l.sdk).level - 1;
    for (let attempt = 0; attempt < 4 && position(l.sdk).level !== want; attempt++) {
        const opt = /climb-down|climb down/i;
        const loc = (await l.sdk.scanNearbyLocs(10))
            .filter(x => /stair|ladder/i.test(x.name) && x.optionsWithIndex.some(o => opt.test(o.text) || /^climb$/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!loc) throw new Error(`no way down near ${JSON.stringify(position(l.sdk))}`);
        const o = loc.optionsWithIndex.find(x => opt.test(x.text)) ?? loc.optionsWithIndex.find(x => /^climb$/i.test(x.text))!;
        await l.bot.interactLoc(loc, o.text);
        for (let i = 0; i < 10 && position(l.sdk).level !== want; i++) {
            const d = l.sdk.getState()?.dialog;
            if (d?.isOpen && d.options.length) await l.sdk.clickDialogByText(/down/i);
            await l.sdk.waitForTicks(1);
        }
    }
    if (position(l.sdk).level !== want) throw new Error('climb down failed');
}

async function toBank(l: Live): Promise<void> {
    const ctx = ctxOf(l);
    if (inGuild(position(l.sdk)) || position(l.sdk).level > 0) {
        while (position(l.sdk).level > 0) await climbDown(l);
        const door = (await l.sdk.scanNearbyLocs(6)).find(x => x.x === GUILD_DOOR.x && x.z === GUILD_DOOR.z && /door/i.test(x.name));
        if (door?.optionsWithIndex.some(o => /^open$/i.test(o.text))) {
            await l.bot.walkTo(GUILD_DOOR.x, GUILD_DOOR.z, 0);
            await l.bot.openDoor(door);
        }
        await walkNear(ctx, GUILD_OUTSIDE.x, GUILD_OUTSIDE.z, 1);
        out('left the guild', { tick: tickOf(l.sdk), at: position(l.sdk) });
    }
    try {
        await walkNear(ctx, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
    } catch {
        // the strip east of the guild can trap the SDK's offline router: let the server path
        for (const w of [{ x: 3142, z: 3436 }, { x: 3148, z: 3426 }, { x: 3152, z: 3422 }]) {
            await l.sdk.sendWalk(w.x, w.z);
            await l.sdk.waitForTicks(12);
        }
        await walkNear(ctx, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
    }
    out('at the bank', { tick: tickOf(l.sdk), at: position(l.sdk) });
}

// ---- the read ----

async function onSignal(): Promise<void> {
    out('signal: logging out');
    if (current) await logout(current, 'signal').catch(e => out('signal logout failed', { error: String(e) }));
    process.exit(130);
}
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

initPathfinding();
out('start', { account, host, wines });

// Session 1: make, bank at once, log out inside the make's timer.
const a = await login('make');
if (skillLevel(a.sdk, 'Cooking') < 35) throw new Error(`Cooking ${skillLevel(a.sdk, 'Cooking')} < 35`);
await toBank(a);
await openBank(ctxOf(a));
out('bank before', { tick: tickOf(a.sdk), wine: wineItems(a.sdk.getBankItems()), grapes: a.sdk.getBankItems().find(i => i.id === ITEM.grapes)?.count ?? 0, jugsOfWater: a.sdk.getBankItems().find(i => i.id === ITEM.jugWater)?.count ?? 0 });
const loose = [ITEM.grapes, ITEM.jugEmpty, ITEM.jugWater, COOKED_CHICKEN].filter(id => invCount(a.sdk, id) > 0);
if (loose.length) await depositMatching(a.sdk, loose);
const free = 28 - a.sdk.getInventory().length;
const n = Math.min(wines, Math.floor(free / 2));
if (n < 1) throw new Error(`no room: ${a.sdk.getInventory().map(i => i.name).join(', ')}`);
const gotG = await withdraw(a.bot, a.sdk, ITEM.grapes, n);
const gotJ = await withdraw(a.bot, a.sdk, ITEM.jugWater, n);
await a.sdk.waitForCondition(() => invCount(a.sdk, ITEM.grapes) >= n && invCount(a.sdk, ITEM.jugWater) >= n, 5_000).catch(() => {});
out('withdrawn', { tick: tickOf(a.sdk), deposited: loose, n, grapes: invCount(a.sdk, ITEM.grapes), jugsOfWater: invCount(a.sdk, ITEM.jugWater), gotG, gotJ });
await closeBank(a.bot, a.sdk);

const makes: { wine: number; sentTick: number; madeTick: number }[] = [];
const pairs = Math.min(invCount(a.sdk, ITEM.grapes), invCount(a.sdk, ITEM.jugWater));
for (let k = 0; k < pairs; k++) {
    const g = a.sdk.getInventory().find(i => i.id === ITEM.grapes);
    const j = a.sdk.getInventory().find(i => i.id === ITEM.jugWater);
    if (!g || !j) break;
    const before = invCount(a.sdk, ITEM.wine);
    const sent = tickOf(a.sdk);
    await a.sdk.sendUseItemOnItem(g.slot, j.slot);
    const ok = await a.sdk.waitForCondition(() => invCount(a.sdk, ITEM.wine) > before, 4_000).then(() => true, () => false);
    if (!ok) {
        out('make did not land', { tick: tickOf(a.sdk), k, dialog: a.sdk.getState()?.dialog.text });
        await a.bot.dismissBlockingUI();
        continue;
    }
    makes.push({ wine: k + 1, sentTick: sent, madeTick: tickOf(a.sdk) });
}
const lastMake = makes.at(-1)?.madeTick ?? -1;
out('made', { makes, lastMakeTick: lastMake, timerDueTick: lastMake + 20, inventoryWine: wineItems(a.sdk.getInventory()) });
if (makes.length === 0) throw new Error('no wine made');

await openBank(ctxOf(a));
const dep = await depositMatching(a.sdk, [ITEM.wine]);
await a.sdk.waitForCondition(() => invCount(a.sdk, ITEM.wine) === 0, 3_000).catch(() => {});
const bankedTick = tickOf(a.sdk);
out('banked', { tick: bankedTick, sinceLastMake: bankedTick - lastMake, deposit: { ok: dep.ok, ticks: dep.ticks }, bankWine: wineItems(a.sdk.getBankItems()), inventoryWine: wineItems(a.sdk.getInventory()) });
await closeBank(a.bot, a.sdk);
const closed = tickOf(a.sdk);
out('bank closed', { tick: closed, ticksLeftOnMakeTimer: lastMake + 20 - closed });
await logout(a, 'make');

// Session 2: log in at the booth; read the bank at login (closed well before +19), then
// at +22, then every 8 ticks to +60, or once more after a change.
await sleep(5_000);
const b = await login('read');
await readBank(b, 'login');
const readAt = [22, 30, 38, 46, 54, 62];
let lastWine = '';
for (const at of readAt) {
    while (tickOf(b.sdk) - b.loginTick < at) await b.sdk.waitForStateUpdate();
    const before = JSON.stringify(wineItems(b.sdk.getBankItems()));
    await readBank(b, `+${at}`);
    const now = JSON.stringify(wineItems(b.sdk.getBankItems()));
    if (lastWine && now === lastWine && !now.includes(`"id":${ITEM.wine}`)) break;
    lastWine = now;
    void before;
}
out('done', { loginTick: b.loginTick, tick: tickOf(b.sdk), cooking: b.sdk.getSkill('Cooking') });
await logout(b, 'read');
process.exit(0);
