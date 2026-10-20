import { describe, expect, test } from 'bun:test';
import { ActionExecutor } from './ActionExecutor.js';

describe('ActionExecutor interaction routing', () => {
    test('surfaces an unreachable route instead of reporting packet dispatch', () => {
        const client = {
            interactNpc: () => ({ success: false, reason: 'cant_reach' as const }),
            projectNpcToScreen: () => null
        };
        const executor = new ActionExecutor(client as any);

        const result = executor.execute({
            type: 'interactNpc',
            npcIndex: 42,
            optionIndex: 1,
            reason: 'test'
        });

        expect(result).toEqual({
            success: false,
            message: 'Failed to interact with NPC: cant_reach',
            phase: 'routing',
            reason: 'cant_reach'
        });
    });

    test('describes successful primitive interactions as dispatch, not completion', () => {
        const client = {
            interactLoc: () => ({ success: true as const }),
            projectTileToScreen: () => null
        };
        const executor = new ActionExecutor(client as any);

        const result = executor.execute({
            type: 'interactLoc',
            x: 3200,
            z: 3200,
            locId: 1,
            optionIndex: 1,
            reason: 'test'
        });

        expect(result).toMatchObject({ success: true, phase: 'dispatch' });
    });
});

describe('ActionExecutor argument validation', () => {
    /** A client every method of which fails the test: validation must answer first. */
    const untouchable = new Proxy({}, {
        get: (_target, name) => () => {
            throw new Error(`client.${String(name)} must not be called`);
        }
    });

    test('refuses a loc interaction sent with a loc object and an option name', () => {
        // What `sdk.sendInteractLoc(willow, 'chop')` puts on the wire. Unchecked,
        // the missing locId reached LocType.list and froze the client.
        const executor = new ActionExecutor(untouchable as any);

        const result = executor.execute(JSON.parse(JSON.stringify({
            type: 'interactLoc',
            x: { x: 3088, z: 3234, id: 1308 },
            z: 'chop',
            locId: undefined,
            optionIndex: 1,
            reason: 'SDK'
        })));

        expect(result).toEqual({
            success: false,
            message: 'interactLoc needs integer arguments; got x=an object, z="chop", locId=missing',
            phase: 'validation',
            reason: 'invalid_argument'
        });
    });

    test.each([
        { type: 'useItemOnLoc', itemSlot: 0, x: 3200, z: 3200, locId: 1.5, reason: 't' },
        { type: 'pickupItem', x: 3200, z: 3200, itemId: Number.NaN, reason: 't' },
        { type: 'interactNpc', npcIndex: '7', optionIndex: 1, reason: 't' },
        { type: 'useInventoryItem', slot: 0, optionIndex: 1, interfaceId: null, reason: 't' }
    ])('refuses $type with a non-integer field', action => {
        const executor = new ActionExecutor(untouchable as any);

        expect(executor.execute(action as any)).toMatchObject({ success: false, reason: 'invalid_argument' });
    });

    test('leaves absent optional fields alone', () => {
        const executor = new ActionExecutor({ useInventoryItem: () => true } as any);

        expect(executor.execute({ type: 'useInventoryItem', slot: 3, optionIndex: 2, reason: 't' }))
            .toMatchObject({ success: true, phase: 'dispatch' });
    });
});
