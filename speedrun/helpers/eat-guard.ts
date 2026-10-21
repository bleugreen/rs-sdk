// Eat guard: eats whenever hitpoints fall below a threshold, whatever else the account
// is doing (walking, looting, fighting, waiting at a bank), by watching every published
// state. A role that only eats inside its fight loop dies on a long walk past aggressive
// monsters or under poison (rs/48's baby blue probe did, inside the Taverley dungeon).
//
// Engine facts it relies on (server/engine OpHeldHandler.ts, player/scripts/consumption/consume.rs2):
// - Eating keeps the walk queue (clearPendingAction), so a walk carries on after the eat.
// - Eating clears the current interaction, so an attack in progress stops; the fighter re-attacks.
// - Eating is refused for 2 ticks after the last eat (%eat_delay), so the guard waits 3.
// - An eat sent while a bank, shop, trade or exchange window is open would close it, and the
//   inventory is not on screen then; the guard waits until it is closed.
import type { ActionResult, BotWorldState, InventoryItem } from '../../sdk/types';

export interface EatGuardSdk {
    getState(): BotWorldState | null;
    onStateUpdate(listener: (s: BotWorldState) => void): () => void;
    sendUseItem(slot: number, option?: number): Promise<ActionResult>;
}

export interface EatGuardOptions {
    /** Eat below this fraction of max hitpoints. */
    eatAt: number;
    /** Inventory items that count as food. An item must also offer Eat, so banknotes never match. */
    food: RegExp;
    /** Ticks between eats (default 3: the engine refuses an eat within 2 ticks of the last). */
    gapTicks?: number;
}

export function hitpoints(s: BotWorldState): { hp: number; max: number } {
    const k = s.skills.find(x => x.name === 'Hitpoints');
    return { hp: k?.level ?? s.player?.hp ?? 10, max: Math.max(1, k?.baseLevel ?? s.player?.maxHp ?? 10) };
}

/** Why an eat cannot be sent in this state, or null when it can. */
export function eatBlocker(s: BotWorldState): string | null {
    if (!s.inGame) return 'not in game';
    if (!s.player) return 'no player';
    if (s.player.isDead) return 'dead';
    if (s.bank?.isOpen) return 'bank';
    if (s.shop?.isOpen) return 'shop';
    if (s.trade?.isOpen) return 'trade';
    if (s.ge) return 'exchange';
    if (s.interface?.isOpen) return 'interface';
    return null;
}

/** The first carried item matching `food` that offers Eat, with that option's index. */
export function edibleFood(s: BotWorldState, food: RegExp): { item: InventoryItem; opIndex: number } | null {
    for (const item of s.inventory) {
        if (!food.test(item.name)) continue;
        const op = item.optionsWithIndex.find(o => /^eat$/i.test(o.text));
        if (op) return { item, opIndex: op.opIndex };
    }
    return null;
}

export class EatGuard {
    /** Eats sent so far; a fighter compares it across ticks to know when to re-attack. */
    eats = 0;
    /** Eats sent per food name. */
    readonly eaten: Record<string, number> = {};
    private nextTick = -Infinity;
    private lastTick = -Infinity;
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly sdk: EatGuardSdk, private readonly opts: EatGuardOptions) {}

    start(): this {
        if (!this.unsubscribe) this.unsubscribe = this.sdk.onStateUpdate(s => this.check(s));
        const s = this.sdk.getState();
        if (s) this.check(s);
        return this;
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /** Evaluate one state; sends an eat and returns true when hitpoints are low and food is at hand. */
    check(s: BotWorldState): boolean {
        // The lite client's tick counter restarts at login; the previous session's
        // cooldown must not suppress food until that old counter is reached again.
        if (s.tick < this.lastTick) this.nextTick = -Infinity;
        this.lastTick = s.tick;
        if (s.tick < this.nextTick) return false;
        const { hp, max } = hitpoints(s);
        if (hp / max >= this.opts.eatAt) return false;
        if (eatBlocker(s)) return false;
        const f = edibleFood(s, this.opts.food);
        if (!f) return false;
        this.nextTick = s.tick + (this.opts.gapTicks ?? 3);
        this.eats++;
        this.eaten[f.item.name] = (this.eaten[f.item.name] ?? 0) + 1;
        void this.sdk.sendUseItem(f.item.slot, f.opIndex).catch(() => undefined);
        return true;
    }
}
