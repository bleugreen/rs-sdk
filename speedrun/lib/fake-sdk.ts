// A scriptable stand-in for BotSDK in unit tests: push states, record sends.
// Only the members the speedrun modules touch are implemented.

import type { ActionResult, BotWorldState, DialogState, GameMessage, InventoryItem, SkillState, TradeState } from '../../sdk/types';
import { PLAYER_CHAT_TYPES } from '../../sdk/types';

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
        ...overrides,
    } as BotWorldState;
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

/** Let queued promise callbacks run. */
export function flush(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
}
