// Shared helpers for the Mage Arena and Dwarf Cannon measurement scripts.
// Staff commands need the engine started with LOCAL_STAFF_LEVEL=4 (docs/speedrun/LAB.md).
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Server tick as counted by the lite client (one PLAYER_INFO per tick). */
export function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

export async function waitTicks(sdk: BotSDK, n: number, wallMs = 10_000 + n * 1000): Promise<void> {
    const target = tick(sdk) + n;
    const deadline = Date.now() + wallMs;
    while (tick(sdk) < target) {
        if (Date.now() > deadline) throw new Error(`server ticks stopped arriving (tick ${tick(sdk)}, wanted ${target})`);
        await sleep(20);
    }
}

/** Wait until `cond` holds, failing after `maxTicks` server ticks. Returns ticks waited. */
export async function waitUntil(sdk: BotSDK, cond: () => boolean, maxTicks: number, label: string): Promise<number> {
    const t0 = tick(sdk);
    const wallDeadline = Date.now() + 10_000 + maxTicks * 1000;
    while (!cond()) {
        if (tick(sdk) - t0 > maxTicks || Date.now() > wallDeadline) {
            throw new Error(`timed out after ${tick(sdk) - t0} ticks waiting for: ${label}`);
        }
        await sleep(20);
    }
    return tick(sdk) - t0;
}

export async function cheat(sdk: BotSDK, command: string): Promise<void> {
    await sdk.sendSay(`::${command}`);
    await waitTicks(sdk, 2);
}

/** `::tele level,mx,mz,lx,lz` from absolute tile coordinates. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<void> {
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const p = sdk.getState()?.player;
        if (p && p.worldX === x && p.worldZ === z) break;
        await sleep(50);
    }
    await waitTicks(sdk, 2);
}

export function pos(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}

/** Log with the current server tick, relative to `t0` when given. */
export function log(sdk: BotSDK, msg: string, t0?: number): void {
    const t = tick(sdk);
    console.log(`[t=${t}${t0 !== undefined ? ` +${t - t0}` : ''}] ${msg}`);
}

// Ticks the scripts spend only confirming that a dialogue has really ended. A real run would act on
// the next step at once, so segment timings use clock(), which excludes them.
let idleTicks = 0;

/** Server tick minus the idle ticks talkThrough spent confirming dialogues had closed. */
export function clock(sdk: BotSDK): number {
    return tick(sdk) - idleTicks;
}

/**
 * Click through chat dialogs until none is open, choosing options by text when offered.
 * A dialogue counts as finished once none has been open for `idleTicks` server ticks (default 4);
 * those confirmation ticks go to the idle ledger that clock() subtracts, unless `keepIdle` is set
 * because the caller next waits for a server event that overlaps them.
 */
export async function talkThrough(
    sdk: BotSDK,
    choices: (string | RegExp)[] = [],
    opts: { maxPages?: number; idleTicks?: number; idleMs?: number; keepIdle?: boolean } = {}
): Promise<{ pages: number; options: number }> {
    const maxPages = opts.maxPages ?? 80;
    const idleLimit = opts.idleTicks ?? 4;
    let pages = 0;
    let options = 0;
    let closedAt = -1;
    const queue = [...choices];
    while (pages + options < maxPages) {
        const d = sdk.getDialog();
        if (!d || !d.isOpen) {
            if (closedAt < 0) closedAt = tick(sdk);
            if (tick(sdk) - closedAt >= idleLimit) {
                // keepIdle: a server-side wait (teleport, p_delay) overlaps these ticks; keep them
                if (!opts.keepIdle) idleTicks += tick(sdk) - closedAt;
                break;
            }
            await sleep(10);
            continue;
        }
        closedAt = -1;
        const isContinue = d.options?.length === 1 && /continue/i.test(d.options[0].text);
        if (isContinue) {
            await sdk.sendClickDialog(d.options[0].index);
            pages++;
        } else if (d.options && d.options.length > 0) {
            const want = queue[0];
            const match = want === undefined ? undefined : d.options.find((o) => (typeof want === 'string' ? o.text.includes(want) : want.test(o.text)));
            if (!match) {
                throw new Error(`no option matching ${String(want)} in [${d.options.map((o) => o.text).join(' | ')}]`);
            }
            queue.shift();
            await sdk.sendClickDialog(match.index);
            options++;
        } else {
            await sdk.sendClickDialog(0);
            pages++;
        }
        // wait until this page is replaced or closed (at most 6 ticks)
        const t = tick(sdk);
        const page = d.pageId;
        while (tick(sdk) - t < 6) {
            const nd = sdk.getDialog();
            if (tick(sdk) > t && (!nd?.isOpen || nd.pageId !== page)) break;
            await sleep(10);
        }
    }
    return { pages, options };
}

export type Ctx = { bot: BotActions; sdk: BotSDK };
