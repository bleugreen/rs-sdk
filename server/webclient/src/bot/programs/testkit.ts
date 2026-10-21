// Test fixtures for tick programs: a minimal published state and a runtime
// whose dispatch records every packet with the tick it went out on.

import type { ActionResult } from '../ActionExecutor.js';
import type { BotAction, BotWorldState, GameMessage, InventoryItem, NearbyLoc, NearbyNpc } from '../types.js';
import { ProgramRuntime } from './runtime.js';
import type { ProgramFactory, ProgramParams, ProgramStatus } from './types.js';

export interface StateSpec {
    tick: number;
    x?: number;
    z?: number;
    level?: number;
    hp?: number;
    maxHp?: number;
    animId?: number;
    skills?: Record<string, { xp: number; level?: number }>;
    inventory?: Array<string | { name: string; options?: string[] }>;
    npcs?: Array<Partial<NearbyNpc> & { index: number; name: string; options?: string[] }>;
    locs?: Array<Partial<NearbyLoc> & { id: number; x: number; z: number; name: string; options?: string[] }>;
    messages?: Array<{ text: string; tick?: number; id?: number }>;
    dialogOpen?: boolean;
    inGame?: boolean;
}

export function makeState(spec: StateSpec): BotWorldState {
    const x = spec.x ?? 3200;
    const z = spec.z ?? 3200;
    const inventory: InventoryItem[] = (spec.inventory ?? []).map((it, slot) => {
        const name = typeof it === 'string' ? it : it.name;
        const options = typeof it === 'string' ? ['Use', 'Drop'] : (it.options ?? ['Use', 'Drop']);
        return { slot, id: 1000 + slot, name, count: 1, optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 })) };
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
    const messages: GameMessage[] = (spec.messages ?? []).map(m => ({ type: 0, text: m.text, sender: '', tick: m.tick ?? spec.tick, observationId: m.id, fromSelf: false }));
    const skills = Object.entries(spec.skills ?? {}).map(([name, v]) => ({ name, level: v.level ?? 99, baseLevel: v.level ?? 99, experience: v.xp }));
    if (!skills.some(s => s.name.toLowerCase() === 'hitpoints')) skills.push({ name: 'Hitpoints', level: spec.hp ?? 99, baseLevel: spec.maxHp ?? 99, experience: 0 });
    return {
        tick: spec.tick,
        inGame: spec.inGame ?? true,
        player: {
            name: 'cairn_test', combatLevel: 3, hp: spec.hp ?? 99, maxHp: spec.maxHp ?? 99, x: 0, z: 0,
            worldX: x, worldZ: z, level: spec.level ?? 0, runEnergy: 100, runWeight: 0, animId: spec.animId ?? -1, spotanimId: -1,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 }, isDead: false, lifeId: 0, respawnCount: 0, lastDeathTick: null
        },
        skills,
        inventory,
        equipment: [],
        nearbyNpcs: npcs,
        nearbyPlayers: [],
        nearbyLocs: locs,
        groundItems: [],
        gameMessages: messages,
        dialog: { isOpen: spec.dialogOpen ?? false, options: [], isWaiting: false, allComponents: [] },
        interface: { isOpen: false, interfaceId: -1, options: [], inventories: [], debugInfo: [] }
    } as unknown as BotWorldState;
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

    constructor(name: string, factory: ProgramFactory, opts: { packetsPerTick?: number; stallTicks?: number } = {}) {
        this.runtime = new ProgramRuntime({
            dispatch: (action): ActionResult => {
                if (this.reject.has(action.type)) return { success: false, message: 'rejected' };
                this.sent.push({ tick: this.tick, action });
                return { success: true, message: 'ok' };
            },
            now: () => 0,
            log: line => this.logs.push(line),
            onEnd: s => (this.ended = s),
            ...opts
        });
        this.runtime.register(name, factory);
    }

    start(name: string, params: ProgramParams = {}, state?: BotWorldState): ProgramStatus {
        if (state) this.runtime.onTick(state);
        return this.runtime.start(name, params);
    }

    step(state: BotWorldState, ticksAdvanced = 1): Sent[] {
        this.tick = state.tick;
        const before = this.sent.length;
        this.runtime.onTick(state, ticksAdvanced);
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
