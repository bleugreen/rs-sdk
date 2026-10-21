// Step driver shared by the Plague City and Biohazard measurement scripts.
//
// A step is one click (talk-to, loc op, item use, walk) followed by whatever
// dialogue it opens, answered as fast as the stock lite client allows, until
// an optional `done` predicate holds. Ticks run from the tick the click was
// sent to the later of: the dialogue closing (first tick seen closed) and
// `done` first holding. Level-up pages that appear inside a step are clicked
// and counted separately. All figures are server ticks (BotWorldState.tick).

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import * as L from './quest-arthur-lab';

export interface StepOpts {
    choices?: RegExp[];
    /** Ticks the dialogue must stay closed before the step is over (raise it for scripts with p_delay gaps). */
    settle?: number;
    done?: () => boolean;
    maxTicks?: number;
}

export interface StepResult {
    label: string;
    ticks: number;
    pages: number;
    options: number;
    levelUps: number;
    transcript: string[];
    note?: string;
}

export class Steps {
    rows: StepResult[] = [];
    constructor(private sdk: BotSDK) {}

    async step(label: string, act: () => Promise<unknown>, o: StepOpts = {}): Promise<StepResult> {
        const sdk = this.sdk;
        const settle = o.settle ?? 3;
        const maxTicks = o.maxTicks ?? 300;
        const t0 = L.tick(sdk);
        await act();
        let first: number | null = null;
        let lastClose: number | null = null;
        let doneTick: number | null = null;
        let lastPage: string | undefined;
        let lastClickTick = -1;
        let pages = 0;
        let options = 0;
        let levelUps = 0;
        const transcript: string[] = [];
        let note: string | undefined;
        while (L.tick(sdk) - t0 < maxTicks) {
            const s = sdk.getState()!;
            if (o.done && doneTick === null && o.done()) doneTick = s.tick;
            const d = s.dialog;
            if (d.isOpen) {
                if (first === null) first = s.tick;
                lastClose = null;
                const stale = d.pageId === lastPage && s.tick - lastClickTick >= 3;
                if (!d.isWaiting && (d.pageId !== lastPage || stale)) {
                    lastPage = d.pageId;
                    lastClickTick = s.tick;
                    const text = (d.text ?? '').replace(/\s+/g, ' ').slice(0, 80);
                    const isContinue = d.options.length > 0 && d.options.every(x => /click here to continue|^continue/i.test(x.text));
                    if (L.isLevelUpDialog(sdk)) {
                        transcript.push(`[${s.tick}] level-up`);
                        await sdk.clickDialogByText(/continue/i).catch(() => sdk.sendClickDialog(0));
                        levelUps++;
                    } else if (isContinue) {
                        transcript.push(`[${s.tick}] page: ${text}`);
                        const r = await sdk.clickDialogByText(/continue/i);
                        if (!r.success) lastPage = undefined;
                        else pages++;
                    } else if (d.options.length > 0) {
                        const texts = d.options.map(x => x.text);
                        const pick = (o.choices ?? []).find(re => texts.some(t => re.test(t)));
                        if (!pick) throw new Error(`${label}: no choice matches ${JSON.stringify(texts)}`);
                        transcript.push(`[${s.tick}] option: ${texts.find(t => pick.test(t))}`);
                        const r = await sdk.clickDialogByText(pick);
                        if (!r.success) lastPage = undefined;
                        else options++;
                    } else {
                        transcript.push(`[${s.tick}] page: ${text}`);
                        await sdk.sendClickDialog(0);
                        pages++;
                    }
                }
            } else if (first !== null) {
                if (lastClose === null) lastClose = s.tick;
                if (s.tick - lastClose >= settle && (!o.done || doneTick !== null)) break;
            } else if (o.done) {
                if (doneTick !== null && s.tick - doneTick >= settle) break;
            } else if (s.tick - t0 > 20) {
                note = 'no dialogue opened';
                break;
            }
            await sdk.waitForStateUpdate();
        }
        if (o.done && doneTick === null) note = 'done never held';
        const end = Math.max(lastClose ?? 0, doneTick ?? 0) || L.tick(sdk);
        const r: StepResult = { label, ticks: end - t0, pages, options, levelUps, transcript, note };
        this.rows.push(r);
        console.log(`STEP ${label}: ${r.ticks} ticks, ${pages} pages, ${options} options${levelUps ? `, ${levelUps} level-ups` : ''}${note ? ` (${note})` : ''}`);
        return r;
    }

    /** One run click to (x,z); measured until the observed tile is (x,z) and still. */
    async walk(label: string, x: number, z: number): Promise<StepResult> {
        const sdk = this.sdk;
        const t0 = L.tick(sdk);
        let last = L.pos(sdk);
        let lastMove = t0;
        let clicks = 1;
        return this.step(label, () => sdk.sendWalk(x, z, true), {
            // Arrived, or no tile change for 4 ticks (blocked); state updates can repeat within a tick.
            done: () => {
                const p = L.pos(sdk);
                const t = L.tick(sdk);
                if (p.x !== last.x || p.z !== last.z) lastMove = t;
                last = p;
                if (p.x === x && p.z === z) return true;
                if (t - lastMove >= 3 && t - t0 >= 3) {
                    if (clicks < 4) {
                        // stalled short (click clamped or dropped): click again, as a real client would
                        clicks++;
                        lastMove = t;
                        void sdk.sendWalk(x, z, true);
                        return false;
                    }
                    console.log(`  walk ${label} stopped at ${p.x},${p.z}`);
                    return true;
                }
                return false;
            },
            settle: 0,
            maxTicks: 150,
        });
    }

    /** Long walk with bot.walkTo (chained clicks); 0.57 ticks/tile per primitives.md. */
    async longWalk(bot: BotActions, label: string, x: number, z: number): Promise<StepResult> {
        const t0 = L.tick(this.sdk);
        const w = await L.timedWalk(this.sdk, bot, x, z, 1);
        const r: StepResult = { label, ticks: L.tick(this.sdk) - t0, pages: 0, options: 0, levelUps: 0, transcript: [], note: `${w.tiles} tiles${w.success ? '' : ' ' + w.message}` };
        this.rows.push(r);
        console.log(`STEP ${label}: ${r.ticks} ticks (${r.note})`);
        return r;
    }

    print(title: string): void {
        console.log(`\n== ${title} ==`);
        console.log('| Step | Ticks | Pages | Options | Level-ups | Note |');
        console.log('|---|---|---|---|---|---|');
        for (const r of this.rows) console.log(`| ${r.label} | ${r.ticks} | ${r.pages} | ${r.options} | ${r.levelUps} | ${r.note ?? ''} |`);
        const sum = (f: (r: StepResult) => number) => this.rows.reduce((a, r) => a + f(r), 0);
        console.log(`| total | ${sum(r => r.ticks)} | ${sum(r => r.pages)} | ${sum(r => r.options)} | ${sum(r => r.levelUps)} | |`);
    }
}

export function npc(sdk: BotSDK, re: RegExp) {
    const n = sdk.findNearbyNpc(re);
    if (!n) throw new Error(`npc ${re} not nearby`);
    return n;
}

/** Talk-to; after a climb or teleport the NPC list can lag a tick or two, so wait up to 6 ticks for it. */
export const talk = (sdk: BotSDK, re: RegExp) => async () => {
    await L.waitUntil(sdk, () => sdk.findNearbyNpc(re) !== null, 6);
    return sdk.sendTalkToNpc(npc(sdk, re).index);
};
export const opLoc = (sdk: BotSDK, x: number, z: number, id: number, op = 1) => () => sdk.sendInteractLoc(x, z, id, op);

export function slot(sdk: BotSDK, re: RegExp): number {
    const it = sdk.findInventoryItem(re);
    if (!it) throw new Error(`no ${re} in inventory`);
    return it.slot;
}

export const useOnLoc = (sdk: BotSDK, item: RegExp, x: number, z: number, id: number) => () => sdk.sendUseItemOnLoc(slot(sdk, item), x, z, id);
export const useOnItem = (sdk: BotSDK, a: RegExp, b: RegExp) => () => sdk.sendUseItemOnItem(slot(sdk, a), slot(sdk, b));
export const has = (sdk: BotSDK, re: RegExp) => () => sdk.getInventory().some(i => re.test(i.name));
export const atLevel = (sdk: BotSDK, level: number) => () => L.pos(sdk).level === level;
export const near = (sdk: BotSDK, x: number, z: number, r = 0) => () => {
    const p = L.pos(sdk);
    return Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= r;
};

/** ::give an item unless the inventory already holds `count`. */
export async function ensure(sdk: BotSDK, obj: string, name: RegExp, count = 1): Promise<void> {
    const have = sdk.getInventory().filter(i => name.test(i.name)).reduce((a, i) => a + i.count, 0);
    if (have < count) await L.cheat(sdk, `give ${obj} ${count - have}`, 2);
}

/** Drop every inventory item matching `re` (raw drop packets). */
export async function dropAll(sdk: BotSDK, re: RegExp): Promise<void> {
    for (const it of [...sdk.getInventory()].reverse()) {
        if (re.test(it.name)) {
            await sdk.sendDropItem(it.slot);
            await sdk.waitForTicks(1);
        }
    }
}

export async function varp(sdk: BotSDK, name: string): Promise<number | null> {
    return L.getVar(sdk, name);
}
