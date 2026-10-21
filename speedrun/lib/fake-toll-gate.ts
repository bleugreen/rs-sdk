// Test fixtures for the Al-Kharid toll gate (toll-gate.ts): a scripted border
// guard and a walkTo that, like the SDK pathfinder, stalls at the gate when
// asked for a destination across the fence.

import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { baseState, FakeSdk, type SentAction } from './fake-sdk';
import { inAlKharid, isEastOfTollGate, TOLL_EAST, TOLL_WEST, type Tile, type TollGateBot } from './toll-gate';

export const coins = (count: number, slot = 0): InventoryItem => ({ slot, id: 995, name: 'Coins', count, optionsWithIndex: [] }) as unknown as InventoryItem;

export const guard = (index: number, x: number, distance: number): NearbyNpc =>
    ({ kind: 'npc', id: 1, index, name: 'Border Guard', combatLevel: 8, x, z: 3228, tileX: x, tileZ: 3228, distance, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] }) as unknown as NearbyNpc;

export const gateLoc: NearbyLoc = { id: 2882, name: 'Gate', x: 3268, z: 3227, level: 0, distance: 1, optionsWithIndex: [{ text: 'Open', opIndex: 1 }], options: ['Open'] } as NearbyLoc;

/** A player at `at` carrying `carried` coins. */
export function tollWorld(at: Tile, carried: number, extra: Partial<BotWorldState> = {}): FakeSdk {
    return new FakeSdk(
        baseState({
            player: { worldX: at.x, worldZ: at.z, hp: 10, maxHp: 10 } as BotWorldState['player'],
            inventory: carried > 0 ? [coins(carried)] : [],
            ...extra
        })
    );
}

const CHOICE = { isOpen: true, isWaiting: false, pageId: 'choice', options: [
    { index: 1, text: "No thank you, I'll walk around." },
    { index: 2, text: 'Who does my money go to?' },
    { index: 3, text: 'Yes, ok.' }
] };
const CLOSED = { isOpen: false, isWaiting: false, options: [] };

/** The border guard's script: a choice page, then the toll and a walk through, or the broke line. */
export function borderGuard(fake: FakeSdk, opts: { refuse?: boolean } = {}): void {
    fake.onSend = (a: SentAction, sdk) => {
        if (a.method === 'sendInteractNpc' || a.method === 'sendInteractLoc') sdk.push({ dialog: CHOICE });
        if (a.method !== 'sendClickDialog') return;
        const s = sdk.state!;
        if (s.dialog.pageId === 'choice' && a.args[0] === 3) {
            const purse = s.inventory.find(i => i.name === 'Coins');
            const have = purse?.count ?? 0;
            if (opts.refuse || have < 10) {
                sdk.push({ dialog: { isOpen: true, isWaiting: false, pageId: 'broke', options: [], text: "Oh dear, I don't actually seem to have enough money." } });
                return;
            }
            const to = inAlKharid(s) ? TOLL_WEST : TOLL_EAST;
            const inventory = s.inventory.flatMap(i => (i !== purse ? [i] : have > 10 ? [{ ...i, count: have - 10 }] : []));
            sdk.push({ dialog: CLOSED, inventory, player: { ...s.player!, worldX: to.x, worldZ: to.z } });
        } else if (s.dialog.isOpen) {
            sdk.push({ dialog: CLOSED });
        }
    };
}

/**
 * A walkTo with the SDK pathfinder's toll gate behaviour: it arrives anywhere on
 * the player's own side, and a destination across the fence ends at the gate.
 * `calls` records each request and which side it was made from.
 */
export function pathfinder(fake: FakeSdk): { bot: TollGateBot; calls: { to: [number, number]; fromEast: boolean }[] } {
    const calls: { to: [number, number]; fromEast: boolean }[] = [];
    const bot: TollGateBot = {
        walkTo: async (x: number, z: number) => {
            const s = fake.state!;
            const fromEast = inAlKharid(s);
            calls.push({ to: [x, z], fromEast });
            if (isEastOfTollGate({ x, z }) !== fromEast) {
                const gate = fromEast ? TOLL_EAST : TOLL_WEST;
                fake.push({ player: { ...s.player!, worldX: gate.x, worldZ: gate.z } });
                return { success: false, message: `Stuck at (${gate.x}, ${gate.z})` };
            }
            fake.push({ player: { ...s.player!, worldX: x, worldZ: z } });
            return { success: true, message: 'ok' };
        }
    };
    return { bot, calls };
}
