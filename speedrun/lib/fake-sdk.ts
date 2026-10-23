// A scriptable stand-in for BotSDK in unit tests: push states, record sends.
// Only the members the speedrun modules touch are implemented.

import type { ActionResult, BotWorldState, DialogState, GameMessage, InventoryItem, SkillState, TradeItem, TradeState } from '../../sdk/types';
import { PLAYER_CHAT_TYPES } from '../../sdk/types';
import type { RuneName, RuneUse } from './travel';

export interface SentAction {
    method: string;
    args: unknown[];
}

export function baseState(overrides: Partial<BotWorldState> = {}): BotWorldState {
    const dialog: DialogState = { isOpen: false, options: [], isWaiting: false };
    return {
        tick: 100,
        inGame: true,
        player: null,
        skills: [],
        inventory: [],
        equipment: [],
        nearbyNpcs: [],
        nearbyPlayers: [],
        nearbyLocs: [],
        groundItems: [],
        gameMessages: [],
        recentDialogs: [],
        dialog,
        interface: { isOpen: false, interfaceId: -1, options: [], inventories: [] },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] },
        bank: { isOpen: false, items: [], noteMode: false },
        modalOpen: false,
        modalInterface: -1,
        combatEvents: [],
        prayers: { activePrayers: [], prayerPoints: 0, prayerLevel: 1 },
        // Run on, as every login leaves the scored account (lib/run-mode.ts).
        varps: { option_run: 1 },
        ...overrides,
    } as BotWorldState;
}

/** `s` with its rune stacks replaced by exactly `runes` (`lawrune` held as `Law rune`); every other item kept. */
export function withRunes(s: BotWorldState, runes: RuneUse): BotWorldState {
    const kept = s.inventory.filter(i => !/ rune$/i.test(i.name));
    let slot = Math.max(-1, ...s.inventory.map(i => i.slot));
    const label = (r: RuneName) => `${r[0]!.toUpperCase()}${r.slice(1, -'rune'.length)} rune`;
    const stacks = (Object.entries(runes) as [RuneName, number][]).filter(([, n]) => n > 0).map(([r, n]): InventoryItem => ({ slot: ++slot, id: 0, name: label(r), count: n, optionsWithIndex: [] }));
    return { ...s, inventory: [...kept, ...stacks] };
}

/**
 * Where `check` and a module's declared RUNE_NEED disagree: `check` should pass on `s` holding exactly
 * `need`'s runes, and fail with any one of them a rune short. Empty when they agree.
 */
export function runeNeedProblems(check: (s: BotWorldState) => true | string, s: BotWorldState, need: RuneUse): string[] {
    const problems: string[] = [];
    const at = check(withRunes(s, need));
    if (at !== true) problems.push(`refused holding the need: ${at}`);
    for (const [r, n] of Object.entries(need) as [RuneName, number][]) {
        if (n > 0 && check(withRunes(s, { ...need, [r]: n - 1 })) === true) problems.push(`passed one ${r} short (${n - 1} of ${n})`);
    }
    return problems;
}

export class FakeSdk {
    state: BotWorldState | null;
    readonly sent: SentAction[] = [];
    private listeners = new Set<(s: BotWorldState) => void>();
    /** Called on every send; may push follow-up states to simulate the server. */
    onSend: (a: SentAction, sdk: FakeSdk) => void = () => {};

    constructor(state: BotWorldState | null = baseState()) {
        this.state = state;
    }

    getState(): BotWorldState | null {
        return this.state;
    }

    getSkill(name: string): SkillState | null {
        const n = name.trim().toLowerCase();
        return this.state?.skills.find(s => s.name.toLowerCase() === n) ?? null;
    }

    getInventory(): InventoryItem[] {
        return this.state?.inventory ?? [];
    }

    getEquipment(): InventoryItem[] {
        return this.state?.equipment ?? [];
    }

    getTradeState(): TradeState {
        return this.state?.trade ?? { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
    }

    onStateUpdate(listener: (s: BotWorldState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    push(patch: Partial<BotWorldState> | ((s: BotWorldState) => Partial<BotWorldState>)): BotWorldState {
        const cur = this.state ?? baseState();
        const delta = typeof patch === 'function' ? patch(cur) : patch;
        const next = { ...cur, ...delta } as BotWorldState;
        this.state = next;
        for (const l of [...this.listeners]) l(next);
        return next;
    }

    /** As BotSDK: resolves with the first state (current or pushed) that matches; rejects after `timeoutMs`. */
    waitForCondition(pred: (s: BotWorldState) => boolean, timeoutMs = 30_000): Promise<BotWorldState> {
        return new Promise((resolve, reject) => {
            if (this.state && pred(this.state)) return resolve(this.state);
            const unsub = this.onStateUpdate(s => {
                if (!pred(s)) return;
                unsub();
                clearTimeout(timer);
                resolve(s);
            });
            const timer = setTimeout(() => {
                unsub();
                reject(new Error('waitForCondition timed out'));
            }, timeoutMs);
        });
    }

    /** Advance one tick, optionally changing state. */
    tick(patch: Partial<BotWorldState> | ((s: BotWorldState) => Partial<BotWorldState>) = {}): BotWorldState {
        return this.push(s => ({ tick: s.tick + 1, ...(typeof patch === 'function' ? patch(s) : patch) }));
    }

    /** The one dispatch point every send goes through, as in BotSDK (where it is private). */
    sendAction(a: SentAction): Promise<ActionResult> {
        this.sent.push(a);
        this.onSend(a, this);
        return Promise.resolve({ success: true, message: 'ok' });
    }

    private record(method: string, ...args: unknown[]): Promise<ActionResult> {
        return this.sendAction({ method, args });
    }

    sendBankDeposit(slot: number, amount = 1) { return this.record('sendBankDeposit', slot, amount); }
    sendBankWithdraw(slot: number, amount = 1) { return this.record('sendBankWithdraw', slot, amount); }
    sendClickComponent(componentId: number) { return this.record('sendClickComponent', componentId); }
    sendClickDialog(...args: unknown[]) { return this.record('sendClickDialog', ...(args.length ? args : [0])); }
    clickDialogByText(pattern: string | RegExp) { return this.record('clickDialogByText', pattern); }
    sendTradeRequest(playerIndex: number) { return this.record('sendTradeRequest', playerIndex); }
    sendOfferItem(slot: number, amount = 1) { return this.record('sendOfferItem', slot, amount); }
    sendAcceptTrade() { return this.record('sendAcceptTrade'); }
    sendDeclineTrade() { return this.record('sendDeclineTrade'); }
    sendCountDialog(value: number) { return this.record('sendCountDialog', value); }
    sendInteractNpc(npcIndex: number, option = 1) { return this.record('sendInteractNpc', npcIndex, option); }
    sendInteractLoc(x: number, z: number, locId: number, option = 1) { return this.record('sendInteractLoc', x, z, locId, option); }
    sendCloseModal() { return this.record('sendCloseModal'); }
    sendUseItemOnItem(sourceSlot: number, targetSlot: number) { return this.record('sendUseItemOnItem', sourceSlot, targetSlot); }
    sendUseItem(slot: number, option = 1) { return this.record('sendUseItem', slot, option); }
    sendWalk(x: number, z: number, running = true) { return this.record('sendWalk', x, z, running); }
    sendSpellOnNpc(npcIndex: number, spell: number) { return this.record('sendSpellOnNpc', npcIndex, spell); }
    sendUseEquipmentItem(slot: number, option = 1) { return this.record('sendUseEquipmentItem', slot, option); }
    sendUseItemOnLoc(slot: number, x: number, z: number, locId: number) { return this.record('sendUseItemOnLoc', slot, x, z, locId); }
    sendUseItemOnNpc(slot: number, npcIndex: number) { return this.record('sendUseItemOnNpc', slot, npcIndex); }
    sendPickup(x: number, z: number, itemId: number) { return this.record('sendPickup', x, z, itemId); }
    sendDropItem(slot: number) { return this.record('sendDropItem', slot); }
    sendTogglePrayer(prayer: string | number) { return this.record('sendTogglePrayer', prayer); }

    /** The SDK route for findPath (default: straight to the destination on the player's level). */
    pathTo: (x: number, z: number) => { success: boolean; waypoints: Array<{ x: number; z: number; level: number }>; reachedDestination?: boolean } = (x, z) => ({
        success: true, waypoints: [{ x, z, level: this.state?.player?.level ?? 0 }], reachedDestination: true,
    });
    findPath(x: number, z: number, _maxWaypoints = 500) { return this.pathTo(x, z); }

    /** Locs an on-demand scan returns (default: the published list). */
    scanLocs: BotWorldState['nearbyLocs'] | null = null;
    async scanNearbyLocs() { return this.scanLocs ?? this.state?.nearbyLocs ?? []; }
    async scanGroundItems() { return this.state?.groundItems ?? []; }

    // Chat: pushChat stands in for lines arriving from the server; getNewChat reads them
    // with the SDK's cursor semantics; sends report the SDK's say/PM result shape.
    private chat: GameMessage[] = [];
    private chatCursor = 0;

    pushChat(msg: Partial<GameMessage> & { text: string }): GameMessage {
        const m: GameMessage = { type: 2, sender: '', tick: this.state?.tick ?? 0, fromSelf: false, ...msg };
        this.chat.push(m);
        return m;
    }

    getNewChat(opts: { types?: readonly number[]; includeSelf?: boolean } = {}): GameMessage[] {
        const types = new Set(opts.types ?? PLAYER_CHAT_TYPES);
        const fresh = this.chat.slice(this.chatCursor);
        this.chatCursor = this.chat.length;
        return fresh.filter(m => types.has(m.type) && (opts.includeSelf || !m.fromSelf));
    }

    private chatResult(r: Promise<ActionResult>, text: string): Promise<ActionResult> {
        return r.then(res => ({ ...res, data: { sent: true, truncated: false, filtered: false, finalText: text } }));
    }

    sendSay(message: string) { return this.chatResult(this.record('sendSay', message), message); }
    sendPrivateMessage(targetName: string, message: string) { return this.chatResult(this.record('sendPrivateMessage', targetName, message), message); }
}

export interface TradePartnerRules {
    /** The partner's name on the trade screens. */
    partner: string;
    /** Whether an item stacks in the pack. */
    stacks: (t: { id: number; name: string }) => boolean;
    /** Whether an item goes in the weapon slot: wielding one displaces the worn weapon into the pack. */
    weapon: (name: string) => boolean;
    /** The session drops on this tick with the trade open, and the server refunds our offer. */
    logoutAt?: number;
}

/** The equipment slot a wielded weapon takes (the client's worn inventory). */
const WEAPON_SLOT = 3;

/**
 * The server and a partner whose request stands (the hand-off giver on its tile): our trade click
 * opens the screens with its offer up and accepted; an offer of ours resets both accepts and the
 * partner re-accepts two ticks later; the confirm accept swaps the items. An offer of an untradeable
 * obj (items.ts untradeable) is refused with the engine's message, as trade.rs2 does. Equip clicks
 * and drops land a tick later, a wield displacing the worn weapon into the pack.
 */
export class FakeTradePartner extends FakeSdk {
    private queue: Array<{ due: number; fx: (s: BotWorldState) => Partial<BotWorldState> }> = [];
    tradeClicks: number[] = [];
    unequipTicks: number[] = [];

    constructor(s: BotWorldState, private theirs: TradeItem[], private rules: TradePartnerRules) {
        super(s);
        this.onSend = a => this.serve(a);
    }

    private later(fx: (s: BotWorldState) => Partial<BotWorldState>, d = 1) {
        this.queue.push({ due: this.state!.tick + d, fx });
    }

    private packItem(slot: number, t: { id: number; name: string }, count: number): InventoryItem {
        return { slot, id: t.id, name: t.name, count, optionsWithIndex: this.rules.weapon(t.name) ? [{ text: 'Wield', opIndex: 2 }] : [] };
    }

    /** Put items into the first free inventory slots, merging stacks. */
    addTo(inv: readonly InventoryItem[], items: readonly TradeItem[]): InventoryItem[] {
        const out = [...inv];
        const free = () => { for (let s = 0; ; s++) if (!out.some(i => i.slot === s)) return s; };
        for (const t of items) {
            const stacks = this.rules.stacks(t);
            const stack = stacks ? out.find(i => i.id === t.id) : undefined;
            if (stack) out[out.indexOf(stack)] = { ...stack, count: stack.count + t.count };
            else if (stacks) out.push(this.packItem(free(), t, t.count));
            else for (let k = 0; k < t.count; k++) out.push(this.packItem(free(), t, 1));
        }
        return out;
    }

    private serve(a: SentAction) {
        const s = this.state!;
        const toConfirm = (tr: NonNullable<BotWorldState['trade']>) => ({ trade: { ...tr, screen: 'confirm' as const, myAccepted: false, partnerAccepted: true } });
        switch (a.method) {
            case 'sendTradeRequest':
                this.tradeClicks.push(s.tick);
                this.later(cur => ({
                    gameMessages: [...cur.gameMessages, { type: 0, text: 'Sending trade offer...', tick: cur.tick, sender: '', fromSelf: false }],
                    trade: cur.trade?.isOpen ? undefined : { isOpen: true, screen: 'offer', partner: this.rules.partner, myOffer: [], theirOffer: this.theirs, myAccepted: false, partnerAccepted: true },
                }));
                break;
            case 'sendOfferItem': {
                const slot = a.args[0] as number;
                const offered = s.inventory.find(i => i.slot === slot);
                if (offered && untradeable(offered.id)) {
                    // trade.rs2: refused with a message, nothing moves and no accept is reset.
                    this.later(cur => ({ gameMessages: [...cur.gameMessages, { type: 0, text: "You can't trade this item.", tick: cur.tick, sender: '', fromSelf: false }] }));
                    break;
                }
                this.later(cur => {
                    const it = cur.inventory.find(i => i.slot === slot);
                    if (!it || !cur.trade?.isOpen) return {};
                    const moved = cur.inventory.filter(i => i.id === it.id).reduce((n, i) => n + i.count, 0);
                    return { inventory: cur.inventory.filter(i => i.id !== it.id), trade: { ...cur.trade, myOffer: [...cur.trade.myOffer, { slot: 0, id: it.id, name: it.name, count: moved }], myAccepted: false, partnerAccepted: false } };
                });
                this.later(cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen || tr.screen !== 'offer') return {};
                    return tr.myAccepted ? toConfirm(tr) : { trade: { ...tr, partnerAccepted: true } };
                }, 2);
                break;
            }
            case 'sendAcceptTrade':
                this.later(cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen) return {};
                    if (tr.screen === 'offer') return tr.partnerAccepted ? toConfirm(tr) : { trade: { ...tr, myAccepted: true } };
                    return { trade: undefined, inventory: this.addTo(cur.inventory, tr.theirOffer), gameMessages: [...cur.gameMessages, { type: 0, text: 'Accepted trade.', tick: cur.tick, sender: '', fromSelf: false }] };
                });
                break;
            case 'sendDropItem': {
                const slot = a.args[0] as number;
                this.later(cur => ({ inventory: cur.inventory.filter(i => i.slot !== slot) }));
                break;
            }
            case 'sendDeclineTrade':
                this.later(cur => (cur.trade?.isOpen ? { trade: undefined, inventory: this.addTo(cur.inventory, cur.trade.myOffer) } : {}));
                break;
            case 'sendUseEquipmentItem': {
                this.unequipTicks.push(s.tick);
                const slot = a.args[0] as number;
                this.later(cur => {
                    const e = cur.equipment.find(x => x.slot === slot);
                    return e ? { equipment: cur.equipment.filter(x => x !== e), inventory: this.addTo(cur.inventory, [{ slot: 0, id: e.id, name: e.name, count: e.count }]) } : {};
                });
                break;
            }
            case 'sendUseItem': {
                const slot = a.args[0] as number;
                this.later(cur => {
                    const it = cur.inventory.find(i => i.slot === slot);
                    if (!it) return {};
                    const weapon = this.rules.weapon(it.name);
                    const displaced = weapon ? cur.equipment.filter(e => this.rules.weapon(e.name)) : [];
                    const inventory = this.addTo(cur.inventory.filter(i => i !== it), displaced.map(e => ({ slot: 0, id: e.id, name: e.name, count: e.count })));
                    const kept = cur.equipment.filter(e => !displaced.includes(e));
                    const at = weapon ? WEAPON_SLOT : (() => { for (let q = 0; ; q++) if (!kept.some(e => e.slot === q)) return q; })();
                    return { inventory, equipment: [...kept, { slot: at, id: it.id, name: it.name, count: 1, optionsWithIndex: [{ text: 'Remove', opIndex: 1 }] }] };
                });
                break;
            }
        }
    }

    override tick(patch: Partial<BotWorldState> | ((s: BotWorldState) => Partial<BotWorldState>) = {}): BotWorldState {
        return this.push(cur => {
            let next: BotWorldState = { ...cur, tick: cur.tick + 1, ...(typeof patch === 'function' ? patch(cur) : patch) };
            if (this.rules.logoutAt !== undefined && next.tick >= this.rules.logoutAt) {
                // The session is gone: the server closes the trade and refunds our offer.
                const refund = next.trade?.isOpen ? next.trade.myOffer : [];
                this.queue = [];
                return { ...next, trade: undefined, inventory: this.addTo(next.inventory, refund), inGame: false };
            }
            for (let i = 0; i < this.queue.length; ) {
                if (this.queue[i]!.due <= next.tick) next = { ...next, ...this.queue.splice(i, 1)[0]!.fx(next) };
                else i++;
            }
            return next;
        });
    }
}

/**
 * The server's side of the run toggle (player_controls.rs2): a press of run off
 * (152) or run on (153) publishes `varps.option_run` on the next tick. The
 * first `ignore` presses are dropped, as for a busy player (p_finduid fails).
 * Call the returned handler from `onSend`.
 */
export function runToggleServer(sdk: FakeSdk, opts: { ignore?: number } = {}): (a: SentAction) => void {
    let ignore = opts.ignore ?? 0;
    return a => {
        if (a.method !== 'sendClickComponent' || (a.args[0] !== 152 && a.args[0] !== 153)) return;
        if (ignore-- > 0) return;
        const on = a.args[0] === 153 ? 1 : 0;
        setTimeout(() => sdk.tick(s => ({ varps: { ...s.varps, option_run: on } })), 1);
    };
}

/** Let queued promise callbacks run. */
export function flush(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
}

export interface WalkSim {
    /** The tile the last accepted walk click aims at. */
    target: { x: number; z: number } | null;
    /** Every walk click, with the tile the player stood on when it was sent. */
    clicks: Array<{ x: number; z: number; from: { x: number; z: number }; tick: number }>;
}

/**
 * A running player: each tick moves up to `speed` tiles (one step at a time, straight or diagonal)
 * toward the last walk click, refusing a step onto a tile `blocked` names. `accept` may drop a click.
 */
export function simulateWalking(
    sdk: FakeSdk,
    opts: { speed?: number; blocked?: (x: number, z: number) => boolean; accept?: (n: number, x: number, z: number) => boolean } = {}
): WalkSim {
    const sim: WalkSim = { target: null, clicks: [] };
    const prev = sdk.onSend;
    sdk.onSend = (a, f) => {
        prev(a, f);
        if (a.method !== 'sendWalk') return;
        const [x, z] = a.args as [number, number];
        const p = f.state?.player;
        sim.clicks.push({ x, z, from: { x: p?.worldX ?? -1, z: p?.worldZ ?? -1 }, tick: f.state?.tick ?? -1 });
        if (opts.accept?.(sim.clicks.length, x, z) ?? true) sim.target = { x, z };
    };
    const tick = sdk.tick.bind(sdk);
    sdk.tick = patch => {
        const p = sdk.state?.player;
        if (p && sim.target) {
            let { worldX: x, worldZ: z } = p;
            for (let i = 0; i < (opts.speed ?? 2); i++) {
                const nx = x + Math.sign(sim.target.x - x);
                const nz = z + Math.sign(sim.target.z - z);
                if ((nx === x && nz === z) || opts.blocked?.(nx, nz)) break;
                x = nx;
                z = nz;
            }
            sdk.state = { ...sdk.state!, player: { ...p, worldX: x, worldZ: z, x, z } };
        }
        return tick(patch);
    };
    return sim;
}

/** Tick `sdk` (applying `each` per tick) until `p` settles; throws after `maxTicks`. */
export async function drive<T>(sdk: FakeSdk, p: Promise<T>, maxTicks = 600, each: (s: BotWorldState) => Partial<BotWorldState> = () => ({})): Promise<T> {
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < maxTicks; i++) {
        await flush();
        if (settled) return p;
        sdk.tick(each);
    }
    await flush();
    if (settled) return p;
    throw new Error(`drive: still pending after ${maxTicks} ticks`);
}
