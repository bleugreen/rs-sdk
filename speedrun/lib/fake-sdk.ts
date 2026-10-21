// A scriptable stand-in for BotSDK in unit tests: push states, record sends.
// Only the members the speedrun modules touch are implemented.

import type { ActionResult, BotWorldState, DialogState } from '../../sdk/types';

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
    sendCloseModal() { return this.record('sendCloseModal'); }
    sendWalk(x: number, z: number, running = true) { return this.record('sendWalk', x, z, running); }
}

/** Let queued promise callbacks run. */
export function flush(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
}
