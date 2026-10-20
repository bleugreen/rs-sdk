// Shared helpers for the agility-*.ts measurement scripts (docs/speedrun/LAB.md).
// Every xp change is logged with the server tick it was observed on, so cycle
// times come from tick deltas, never wall-clock time.
import type { BotSDK } from '../../../sdk';
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';

export const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102

export interface XpEvent {
    tick: number;
    gameXp: number; // total Agility xp after the change (game units)
    baseGain: number; // gain in base xp (game xp / 25)
    x: number;
    z: number;
    level: number;
    hp: number;
}

export function agilityXp(s: BotWorldState | null): number {
    return s?.skills.find(k => k.name === 'Agility')?.experience ?? 0;
}

/** Records every Agility xp change with its server tick; also dismisses level-up dialogs. */
export class XpLog {
    events: XpEvent[] = [];
    private last: number;
    private unsub: () => void;
    hpLost = 0;
    private lastHp: number;

    constructor(private sdk: BotSDK) {
        const s = sdk.getState();
        this.last = agilityXp(s);
        this.lastHp = s?.player?.hp ?? 0;
        this.unsub = sdk.onStateUpdate(st => {
            const xp = agilityXp(st);
            const hp = st.player?.hp ?? 0;
            if (hp < this.lastHp) this.hpLost += this.lastHp - hp;
            this.lastHp = hp;
            if (xp !== this.last) {
                this.events.push({
                    tick: st.tick,
                    gameXp: xp,
                    baseGain: (xp - this.last) / XP_RATE,
                    x: st.player?.worldX ?? 0,
                    z: st.player?.worldZ ?? 0,
                    level: st.player?.level ?? 0,
                    hp,
                });
                this.last = xp;
            }
            if (st.dialog?.isOpen && st.dialog.options.length === 0 && !st.dialog.isWaiting) {
                // level-up and message boxes freeze scripts; click to continue
                void sdk.sendClickDialog(0).catch(() => {});
            }
        });
    }

    stop() { this.unsub(); }

    since(i: number) { return this.events.slice(i); }
}

export async function cheat(sdk: BotSDK, cmd: string) {
    await sdk.sendSay('::' + cmd);
    await sdk.waitForTicks(2);
}

/** ::tele to an absolute tile (LAB.md: map square = tile >> 6, local = tile & 63). */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0) {
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    await sdk.waitForCondition(s => s.player?.worldX === x && s.player?.worldZ === z && s.player?.level === level, 10_000)
        .catch(() => { throw new Error(`tele to ${level},${x},${z} did not land`); });
    await sdk.waitForTicks(2);
}

export function findLoc(sdk: BotSDK, id: number, x: number, z: number): NearbyLoc | null {
    return sdk.getNearbyLocs().find(l => l.id === id && l.x === x && l.z === z) ?? null;
}

/** Interact with a loc by id and tile; scans if it is not in the cached nearby list. */
export async function clickLoc(sdk: BotSDK, id: number, x: number, z: number, op = 1) {
    let loc = findLoc(sdk, id, x, z);
    if (!loc) {
        await sdk.scanNearbyLocs(30);
        loc = findLoc(sdk, id, x, z);
    }
    if (!loc) throw new Error(`loc ${id} at ${x},${z} not visible`);
    const r = await sdk.sendInteractLoc(x, z, id, op);
    if (!r.success) throw new Error(`interact ${id} at ${x},${z} failed: ${r.message}`);
}

export function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? 0;
}

/** Waits until the predicate holds or the given number of server ticks pass. Returns true if it held. */
export async function waitTicksFor(sdk: BotSDK, pred: (s: BotWorldState) => boolean, maxTicks: number): Promise<boolean> {
    const start = tick(sdk);
    const s0 = sdk.getState();
    if (s0 && pred(s0)) return true;
    try {
        await sdk.waitForCondition(s => pred(s) || s.tick - start >= maxTicks, maxTicks * 1000 + 10_000);
    } catch {
        return false;
    }
    const s = sdk.getState();
    return !!s && pred(s);
}

export function summary(xs: number[]) {
    if (xs.length === 0) return { n: 0, mean: NaN, min: NaN, max: NaN };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { n: xs.length, mean: +mean.toFixed(2), min: Math.min(...xs), max: Math.max(...xs) };
}

export function pos(sdk: BotSDK) {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}
