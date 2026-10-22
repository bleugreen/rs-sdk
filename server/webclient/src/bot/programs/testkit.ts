// Test fixtures for tick programs: a minimal published state and a runtime
// whose dispatch records every packet with the tick it went out on.

import type { ActionResult } from '../ActionExecutor.js';
import type { BotAction, BotWorldState, CombatEvent, GameMessage, InventoryItem, NearbyLoc, NearbyNpc, NearbyPlayer, TradeState } from '../types.js';
import { ProgramRuntime } from './runtime.js';
import type { ProgramFactory, ProgramInit, ProgramParams, ProgramStatus, TickProgram } from './types.js';

export interface StateSpec {
    tick: number;
    x?: number;
    z?: number;
    level?: number;
    hp?: number;
    maxHp?: number;
    animId?: number;
    skills?: Record<string, { xp: number; level?: number }>;
    /** By slot; null is an empty slot (the items after it keep their slots). Without an id an item gets 1000 + slot. */
    inventory?: Array<string | { name: string; id?: number; options?: string[]; count?: number } | null>;
    /** The bank, by bank slot; omitted means closed and empty. */
    bank?: { isOpen?: boolean; items: Array<{ id: number; name?: string; count: number }> };
    /** Worn items, by name. */
    equipment?: string[];
    npcs?: Array<Partial<NearbyNpc> & { index: number; name: string; options?: string[] }>;
    locs?: Array<Partial<NearbyLoc> & { id: number; x: number; z: number; name: string; options?: string[] }>;
    /** Players in sight; a missing x/z stands one tile east of the player. */
    players?: Array<Partial<NearbyPlayer> & { index: number; name: string }>;
    messages?: Array<{ text: string; tick?: number; id?: number; type?: number; sender?: string }>;
    /** Open trade fields; omitted (and no tradeOpen) means no trade open. */
    trade?: Partial<TradeState>;
    dialogOpen?: boolean;
    /** A main modal (trade screen) is open. */
    tradeOpen?: boolean;
    inGame?: boolean;
    combatLevel?: number;
    combatEvents?: CombatEvent[];
    lifeId?: number;
    isDead?: boolean;
}

export function makeState(spec: StateSpec): BotWorldState {
    const x = spec.x ?? 3200;
    const z = spec.z ?? 3200;
    const inventory: InventoryItem[] = (spec.inventory ?? []).flatMap((it, slot) => {
        if (it === null) return [];
        const name = typeof it === 'string' ? it : it.name;
        const options = typeof it === 'string' ? ['Use', 'Drop'] : (it.options ?? ['Use', 'Drop']);
        const count = typeof it === 'string' ? 1 : (it.count ?? 1);
        const id = typeof it === 'string' ? 1000 + slot : (it.id ?? 1000 + slot);
        return [{ slot, id, name, count, optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 })) }];
    });
    const npcs = (spec.npcs ?? []).map(n => {
        const options = n.options ?? ['Talk-to'];
        const nx = n.x ?? x + 1;
        const nz = n.z ?? z;
        return {
            kind: 'npc', id: 1, combatLevel: 0, size: 1, hp: null, maxHp: null, healthPercent: null, targetIndex: -1, inCombat: false, lastCombatTick: null, animId: -1, spotanimId: -1,
            distance: Math.max(Math.abs(nx - x), Math.abs(nz - z)),
            ...n,
            x: nx, z: nz, tileX: n.tileX ?? nx, tileZ: n.tileZ ?? nz,
            options,
            optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 }))
        } as NearbyNpc;
    });
    const locs = (spec.locs ?? []).map(l => {
        const options = l.options ?? ['Examine'];
        return {
            level: 0,
            distance: Math.max(Math.abs(l.x - x), Math.abs(l.z - z)),
            ...l,
            options,
            optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 }))
        } as NearbyLoc;
    });
    const players: NearbyPlayer[] = (spec.players ?? []).map(p => {
        const px = p.x ?? x + 1;
        const pz = p.z ?? z;
        return { kind: 'player', combatLevel: 3, combatTargetType: 'none', combatTargetIndex: -1, inCombat: false, ...p, x: px, z: pz, distance: Math.max(Math.abs(px - x), Math.abs(pz - z)) };
    });
    const messages: GameMessage[] = (spec.messages ?? []).map(m => ({ type: m.type ?? 0, text: m.text, sender: m.sender ?? '', tick: m.tick ?? spec.tick, observationId: m.id, fromSelf: false }));
    const trade: TradeState = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...(spec.trade || spec.tradeOpen ? { isOpen: true, screen: 'offer', ...spec.trade } : {}) };
    const skills = Object.entries(spec.skills ?? {}).map(([name, v]) => ({ name, level: v.level ?? 99, baseLevel: v.level ?? 99, experience: v.xp }));
    if (!skills.some(s => s.name.toLowerCase() === 'hitpoints')) skills.push({ name: 'Hitpoints', level: spec.hp ?? 99, baseLevel: spec.maxHp ?? 99, experience: 0 });
    return {
        tick: spec.tick,
        inGame: spec.inGame ?? true,
        player: {
            name: 'cairn_test', combatLevel: spec.combatLevel ?? 3, hp: spec.hp ?? 99, maxHp: spec.maxHp ?? 99, x: 0, z: 0,
            worldX: x, worldZ: z, level: spec.level ?? 0, runEnergy: 100, runWeight: 0, animId: spec.animId ?? -1, spotanimId: -1,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 }, isDead: spec.isDead ?? false, lifeId: spec.lifeId ?? 0, respawnCount: 0, lastDeathTick: null
        },
        skills,
        inventory,
        equipment: (spec.equipment ?? []).map((name, slot) => ({ slot, id: 2000 + slot, name, count: 1, optionsWithIndex: [{ text: 'Remove', opIndex: 1 }] })),
        nearbyNpcs: npcs,
        nearbyPlayers: players,
        modalOpen: trade.isOpen,
        modalInterface: trade.isOpen ? 3323 : -1,
        nearbyLocs: locs,
        trade,
        bank: { isOpen: spec.bank?.isOpen ?? false, items: (spec.bank?.items ?? []).map((b, slot) => ({ slot, id: b.id, name: b.name ?? `obj ${b.id}`, count: b.count })), noteMode: false },
        groundItems: [],
        gameMessages: messages,
        combatEvents: spec.combatEvents ?? [],
        dialog: { isOpen: spec.dialogOpen ?? false, options: [], isWaiting: false, allComponents: [] },
        interface: { isOpen: false, interfaceId: -1, options: [], inventories: [], debugInfo: [] }
    } as unknown as BotWorldState;
}

/** A test program's factory with its accepted keys (none by default). */
export function declared(fn: (params: ProgramParams, init: ProgramInit) => TickProgram, params: readonly string[] = []): ProgramFactory {
    return Object.assign(fn, { params });
}

export interface Sent {
    tick: number;
    action: BotAction;
}

export class Harness {
    readonly sent: Sent[] = [];
    readonly runtime: ProgramRuntime;
    readonly logs: string[] = [];
    ended: ProgramStatus | null = null;
    private tick = 0;
    /** Make dispatch reject actions of these types. */
    reject = new Set<string>();
    /** Answer an action as the client would (userEvents, a refusal); undefined means the default success. */
    respond: ((action: BotAction) => ActionResult | undefined) | null = null;

    /** A bare function registers as a program that accepts no keys of its own. */
    constructor(name: string, factory: ProgramFactory | ((params: ProgramParams, init: ProgramInit) => TickProgram), opts: { packetsPerTick?: number; stallTicks?: number; now?: () => number; wallNow?: () => number; random?: () => number } = {}) {
        this.runtime = new ProgramRuntime({
            dispatch: (action): ActionResult => {
                if (this.reject.has(action.type)) return { success: false, message: 'rejected' };
                const r = this.respond?.(action);
                if (r && !r.success) return r;
                this.sent.push({ tick: this.tick, action });
                return r ?? { success: true, message: 'ok' };
            },
            now: () => 0,
            // with now() at 0, a frame's Date.now() stamp equals the arrival passed to step()
            wallNow: () => 0,
            log: line => this.logs.push(line),
            onEnd: s => (this.ended = s),
            ...opts
        });
        this.runtime.register(name, 'params' in factory ? factory : declared(factory));
    }

    start(name: string, params: ProgramParams = {}, state?: BotWorldState): ProgramStatus {
        if (state) this.runtime.onTick(state);
        return this.runtime.start(name, params);
    }

    step(state: BotWorldState, ticksAdvanced = 1, arrivals: readonly number[] = []): Sent[] {
        this.tick = state.tick;
        const before = this.sent.length;
        this.runtime.onTick(state, ticksAdvanced, arrivals);
        return this.sent.slice(before);
    }

    get status(): ProgramStatus {
        return this.runtime.status()!;
    }

    /** `T12 useItemOnItem,clickComponent` lines, for compact assertions. */
    timeline(types?: string[]): string[] {
        const by = new Map<number, string[]>();
        for (const s of this.sent) {
            if (types && !types.includes(s.action.type)) continue;
            if (!by.has(s.tick)) by.set(s.tick, []);
            by.get(s.tick)!.push(s.action.type);
        }
        return [...by].map(([t, a]) => `T${t} ${a.join(',')}`);
    }
}
