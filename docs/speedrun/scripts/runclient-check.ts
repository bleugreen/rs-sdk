// Run-client check for the two lite-client fixes the route depends on, on either
// client, driven through the SDK exactly as a step script drives it:
//   door   - Sea Slug's bridged fishing-platform doors (cairn://p/rs/54): a routed
//            walk into the room fails while the door is shut and succeeds once
//            the overlay has opened it. loc_1533 (2765,3277) on the ground floor
//            and loc_1530 (2764,3285) upstairs are the only doors on bridged
//            tiles in the whole map, so these two are the whole case.
//   puzzle - Monkey Madness's reinitialisation puzzle (cairn://p/rs/23): which
//            packet each SDK call sends for reinitialisation_puzzle:com_3, and
//            whether the tile moves; the last move solves it.
//
// Local lab only (::tele, ::setvar need LOCAL_STAFF_LEVEL=4, LAB.md):
//   bun docs/speedrun/scripts/runclient-check.ts --client=browser|lite --bot=NAME \
//       --server=localhost:9160 --gateway=ws://localhost:7960 [--checks=door,puzzle]
// The browser client opens in a visible Chrome window (system Chrome) and its
// console's packet lines are captured; the lite client runs as a runner child
// (bots/NAME/bot.env must point at the same server and gateway).
// Prints one `RESULT {json}` line per check.

import puppeteer, { type Browser } from 'puppeteer';
import { join } from 'path';
import { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { at, cheat, give, locOpAt, now, pos, setvar, tele, waitTicks, waitUntil } from './quest-gnome-lib';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=') as [string, string]));
const CLIENT = args.client as 'browser' | 'lite';
const BOT = args.bot!;
const PASSWORD = args.password ?? 'labpass';
const SERVER = args.server ?? 'localhost:9160';
const GATEWAY = args.gateway ?? 'ws://localhost:7960';
const CHECKS = (args.checks ?? 'door,puzzle').split(',');
if (CLIENT !== 'browser' && CLIENT !== 'lite') throw new Error('--client=browser|lite');

const ROOT = join(import.meta.dir, '../../..');
const PUZZLE = 11130; // reinitialisation_puzzle:com_3
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// --- client launch -----------------------------------------------------------

const consoleLines: string[] = [];
let browser: Browser | null = null;
let liteChild: ReturnType<typeof Bun.spawn> | null = null;

if (CLIENT === 'browser') {
    browser = await puppeteer.launch({
        headless: false,
        executablePath: CHROME,
        defaultViewport: null,
        userDataDir: join(process.env.TMPDIR ?? '/tmp', `runclient-check-${BOT}`),
        // A sandboxed executor cannot start Chrome's own sandbox, and its GPU process dies without these.
        args: ['--no-sandbox', '--disable-gpu-sandbox', '--disable-crash-reporter', '--disable-breakpad',
            '--window-size=800,680', '--mute-audio', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        protocolTimeout: 120_000,
    });
    const page = await browser.newPage();
    page.on('console', m => {
        const t = m.text();
        if (/useInventoryItem SENDING|clickInterfaceIop\]|\[Walk\]/.test(t)) consoleLines.push(t);
    });
    page.on('pageerror', e => console.error('[page error]', (e as Error).message));
    const url = `http://${SERVER}/bot?bot=${BOT}&password=${encodeURIComponent(PASSWORD)}&gateway=${encodeURIComponent(GATEWAY)}`;
    console.log('opening', url.replace(PASSWORD, '***'));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
} else {
    liteChild = Bun.spawn(['bun', 'src/lite/runner.ts', BOT], { cwd: join(ROOT, 'server/webclient'), stdout: 'ignore', stderr: 'inherit' });
}

const sdk = new BotSDK({ botUsername: BOT, password: PASSWORD, gatewayUrl: GATEWAY, connectionMode: 'control', autoReconnect: true, autoLaunchBrowser: false, showChat: false });
await sdk.connect();
await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0 && s.tick > 0, 180_000);
await waitTicks(sdk, 3);
console.log(`[${CLIENT}] in game at`, JSON.stringify(pos(sdk.getState())), 'tick', now(sdk));

function mark(): number {
    return consoleLines.length;
}
function since(m: number): string[] {
    return consoleLines.slice(m);
}
function result(check: string, data: Record<string, unknown>): void {
    console.log('RESULT ' + JSON.stringify({ client: CLIENT, check, ...data }));
}

// --- doors on the bridged fishing platform -----------------------------------

type Door = { label: string; level: number; door: [number, number, number]; outside: [number, number]; inside: [number, number] };
const DOORS: Door[] = [
    { label: 'glass room, ground floor', level: 0, door: [2765, 3277, 1533], outside: [2766, 3277], inside: [2765, 3278] },
    { label: "Kennith's room, upper floor", level: 1, door: [2764, 3285, 1530], outside: [2765, 3285], inside: [2764, 3286] },
];

const closedAt = (s: BotWorldState | null, d: Door) => s?.nearbyLocs.find(l => l.x === d.door[0] && l.z === d.door[1] && l.id === d.door[2]) ?? null;
const openLeaf = (s: BotWorldState | null, d: Door) =>
    s?.nearbyLocs.find(l => Math.max(Math.abs(l.x - d.door[0]), Math.abs(l.z - d.door[1])) <= 1 && l.optionsWithIndex.some(o => /^close$/i.test(o.text))) ?? null;

/** Close the door if an earlier run left it open (doors are server state, shared by every account). */
async function ensureClosed(d: Door): Promise<void> {
    if (closedAt(sdk.getState(), d)) return;
    const leaf = openLeaf(sdk.getState(), d);
    if (!leaf) throw new Error(`${d.label}: neither the shut door nor an open leaf is visible`);
    await sdk.sendInteractLoc(leaf.x, leaf.z, leaf.id, leaf.optionsWithIndex.find(o => /^close$/i.test(o.text))!.opIndex);
    if (!(await waitUntil(sdk, s => closedAt(s, d) !== null, 15))) throw new Error(`${d.label}: could not close the door`);
    await walkTo(d.outside, d.level, 10);
}

async function walkTo(t: [number, number], level: number, maxTicks: number) {
    const t0 = now(sdk);
    const m = mark();
    const sent = await sdk.sendWalk(t[0], t[1]);
    const r = await waitUntil(sdk, at(t[0], t[1], level), maxTicks);
    return { arrived: r !== null, ticks: r ? r.tick - t0 : null, endedAt: pos(sdk.getState()), sent: sent.success, message: sent.message, console: since(m) };
}

/**
 * After a long ::tele the browser client fetches and rebuilds the region before
 * its scene holds any locs; the lite client answers from a prebuilt index at
 * once. Wait for the scene, and report how long it took.
 */
async function sceneHas(label: string, pred: (s: BotWorldState) => boolean, maxTicks = 100): Promise<number> {
    const t0 = now(sdk);
    const r = await waitUntil(sdk, pred, maxTicks);
    if (!r) throw new Error(`${label}: not in the client's scene after ${maxTicks} ticks`);
    return r.tick - t0;
}

async function doorCheck(d: Door): Promise<void> {
    if (!(await tele(sdk, d.outside[0], d.outside[1], d.level))) throw new Error(`${d.label}: tele failed`);
    const sceneTicks = await sceneHas(d.label, s => closedAt(s, d) !== null || openLeaf(s, d) !== null);
    await ensureClosed(d);
    const shut = closedAt(sdk.getState(), d);

    // 1. Routed walk into the room with the door shut: the client's router must not find a way.
    const whileShut = await walkTo(d.inside, d.level, 8);
    await walkTo(d.outside, d.level, 10);

    // 2. Open it through the overlay.
    const t0 = now(sdk);
    const op = shut!.optionsWithIndex.find(o => /^open$/i.test(o.text))!;
    const sent = await sdk.sendInteractLoc(d.door[0], d.door[1], d.door[2], op.opIndex);
    const opened = await waitUntil(sdk, s => closedAt(s, d) === null && openLeaf(s, d) !== null, 15);
    const leaf = openLeaf(sdk.getState(), d);

    // 3. The same routed walk, now through the open doorway.
    const whileOpen = await walkTo(d.inside, d.level, 10);

    // Leave it shut for the next run.
    await walkTo(d.outside, d.level, 10);
    await ensureClosed(d);

    result('door', {
        door: d.label, at: d.door, level: d.level, sceneTicks,
        shutDoorVisible: shut ? { id: shut.id, options: shut.options, reachable: (shut as { reachable?: boolean }).reachable } : null,
        whileShut,
        open: { sent: sent.success, message: sent.message, ticks: opened ? opened.tick - t0 : null, leaf: leaf ? { id: leaf.id, x: leaf.x, z: leaf.z } : null },
        whileOpen,
        pass: shut !== null && !whileShut.arrived && opened !== null && whileOpen.arrived,
    });
}

// --- Monkey Madness reinitialisation puzzle ----------------------------------

function layout(s: BotWorldState | null): number[] | null {
    const grid = s?.interface?.inventories?.find(i => i.componentId === PUZZLE);
    if (!grid) return null;
    const slots = new Array(grid.size).fill(0);
    for (const it of grid.items) slots[it.slot] = it.id;
    return slots;
}
const gapOf = (l: number[]) => l.findIndex(v => v === 0);
const sameLayout = (a: number[] | null, b: number[] | null) => !!a && !!b && a.every((v, i) => v === b[i]);

async function move(kind: 'sendUseItem' | 'sendClickComponentWithOption', slot: number) {
    const before = layout(sdk.getState());
    const m = mark();
    const t0 = now(sdk);
    const sent = kind === 'sendUseItem' ? await sdk.sendUseItem(slot, 5, PUZZLE) : await sdk.sendClickComponentWithOption(PUZZLE, 5, slot);
    const r = await waitUntil(sdk, s => !sameLayout(layout(s), before), 4);
    const after = layout(sdk.getState());
    return { call: `${kind}(${kind === 'sendUseItem' ? `${slot}, 5, ${PUZZLE}` : `${PUZZLE}, 5, ${slot}`})`, sent: sent.success, gapBefore: before ? gapOf(before) : null, gapAfter: after ? gapOf(after) : null, moved: r !== null, ticks: r ? r.tick - t0 : null, console: since(m) };
}

async function puzzleCheck(): Promise<void> {
    await sdk.sendCloseModal();
    await cheat(sdk, '~clearinv');
    const vars: Record<string, number> = {
        treequest: 9, grandtree: 160,
        // Segment E of quest-mm-full.ts after E1: Daero has started the reinitialisation
        // (^daero_started_reinit = 5), the state in which the panel opens the puzzle (quest_mm.rs2).
        mm_main: 1, mm_narnode: 7, mm_caranock: 3, mm_daero: 5, mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1,
        // Glough's shortcut state: the panel opens one slide from solved (mm_puzzle.rs2).
        mm_hangar_puzzle_complete: 1,
    };
    for (const [k, v] of Object.entries(vars)) await setvar(sdk, k, v);
    await give(sdk, 'mm_gnome_royal_seal', 1);
    if (!(await tele(sdk, 2393, 9892))) throw new Error('puzzle: tele to the hangar failed');
    await sceneHas('hangar panel', s => s.nearbyLocs.some(l => l.x === 2394 && l.z === 9883));
    const panel = await locOpAt(sdk, 2394, 9883, /./, s => layout(s) !== null, 30);
    const start = layout(sdk.getState());
    if (!start) throw new Error('puzzle: the panel did not open: ' + JSON.stringify(panel));
    const gap = gapOf(start);
    // A neighbour of the gap other than slot 24 (moving 24 solves it).
    const neighbour = [gap - 5, gap + 5, gap % 5 ? gap - 1 : -1, gap % 5 !== 4 ? gap + 1 : -1].find(n => n >= 0 && n < 25 && n !== 24)!;

    // The call quest-mm-full.ts E3 makes today.
    const ifButton = await move('sendClickComponentWithOption', neighbour);
    // sendUseItem: the component-routed held op.
    const there = await move('sendUseItem', neighbour);
    const back = await move('sendUseItem', gap);
    const t0 = now(sdk);
    const solve = await move('sendUseItem', 24);
    const hangar = await waitUntil(sdk, s => Math.max(Math.abs(pos(s).x - 2649), Math.abs(pos(s).z - 4507)) <= 3, 60);
    const msgs = sdk.getState()!.gameMessages.filter(g => (g.tick ?? t0) >= t0).map(g => g.text);

    result('puzzle', {
        startGap: gap,
        ifButton, there, back, solve,
        solvedToHangar: hangar ? { ticks: hangar.tick - t0, at: pos(hangar.state) } : null,
        messages: msgs,
        pass: !ifButton.moved && there.moved && back.moved && solve.moved && hangar !== null,
    });
}

// --- run ----------------------------------------------------------------------

try {
    if (CHECKS.includes('door')) for (const d of DOORS) await doorCheck(d);
    if (CHECKS.includes('puzzle')) await puzzleCheck();
} finally {
    await sdk.disconnect().catch(() => {});
    if (browser) {
        const proc = browser.process();
        await Promise.race([browser.close().catch(() => {}), Bun.sleep(5_000)]);
        proc?.kill('SIGKILL');
    }
    liteChild?.kill();
}
process.exit(0);
