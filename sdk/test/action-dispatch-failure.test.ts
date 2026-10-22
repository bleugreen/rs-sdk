import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import type { ActionResult } from '../types';

/**
 * Build an SDK that looks connected but whose socket swallows everything, so a
 * dispatch never gets a result back.
 */
function stubSdk(actionTimeout: number) {
    const sdk = Object.create(BotSDK.prototype) as BotSDK;
    const sent: any[] = [];
    (sdk as any).config = { actionTimeout, botUsername: 'tester' };
    (sdk as any).connectionState = 'connected';
    (sdk as any).pendingActions = new Map();
    (sdk as any).ws = { readyState: WebSocket.OPEN };
    (sdk as any).send = (msg: any) => sent.push(msg);
    return { sdk, sent, pending: (sdk as any).pendingActions as Map<string, any> };
}

function dispatch(sdk: BotSDK): Promise<ActionResult> {
    return (sdk as any).sendAction({ type: 'walkTo', x: 0, z: 0, running: true, reason: 'SDK' });
}

describe('BotSDK.sendAction while the region loads', () => {
    const withScene = (sceneReady: boolean | undefined) => {
        const stub = stubSdk(20);
        (stub.sdk as any).state = { inGame: true, ...(sceneReady === undefined ? {} : { sceneReady }) };
        return stub;
    };

    test('refuses a world click without sending it, never reporting success', async () => {
        const { sdk, sent } = withScene(false);
        for (const action of [
            { type: 'interactLoc', x: 2459, z: 3383, locId: 190, optionIndex: 1, reason: 'SDK' },
            { type: 'interactNpc', npcIndex: 5, optionIndex: 1, reason: 'SDK' },
            { type: 'walkTo', x: 1, z: 2, running: true, reason: 'SDK' }
        ]) {
            const r: ActionResult = await (sdk as any).sendAction(action);
            expect(r).toMatchObject({ success: false, reason: 'scene_loading', phase: 'validation' });
        }
        expect(sent).toHaveLength(0);
    });

    test('sends a world click once the region is built, and when the client does not publish sceneReady', async () => {
        for (const ready of [true, undefined]) {
            const { sdk, sent } = withScene(ready);
            await dispatch(sdk);
            expect(sent).toHaveLength(1);
        }
    });

    test('sends a click that is not routed in the world while the region loads (dialogue, inventory)', async () => {
        const { sdk, sent } = withScene(false);
        await (sdk as any).sendAction({ type: 'clickDialogOption', optionIndex: 0, reason: 'SDK' });
        await (sdk as any).sendAction({ type: 'useInventoryItem', slot: 0, optionIndex: 1, reason: 'SDK' });
        expect(sent).toHaveLength(2);
    });
});

describe('BotSDK.sendAction dispatch failures', () => {
    test('cleans pending dispatches when the socket write throws synchronously', async () => {
        const { sdk, pending } = stubSdk(5000);
        (sdk as any).send = () => { throw new Error('Socket write failed'); };
        expect(await dispatch(sdk)).toMatchObject({ success: false, reason: 'error', message: 'Socket write failed' });
        expect(pending.size).toBe(0);
    });

    test('reports a timeout instead of throwing', async () => {
        const { sdk, sent, pending } = stubSdk(20);

        const result = await dispatch(sdk);

        expect(sent).toHaveLength(1);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('timeout');
        expect(result.phase).toBe('dispatch');
        expect(result.message).toContain('walkTo');
        expect(pending.size).toBe(0);
    });

    test('reports a mid-flight disconnect instead of throwing', async () => {
        const { sdk, pending } = stubSdk(5000);

        const promise = dispatch(sdk);
        const entry = [...pending.values()][0]!;
        clearTimeout(entry.timeout);
        entry.reject(new Error('Connection closed'));

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.message).toBe('Connection closed');
    });

    test('reports a gateway error instead of throwing', async () => {
        const { sdk, sent } = stubSdk(5000);

        const promise = dispatch(sdk);
        (sdk as any).handleMessage(JSON.stringify({
            type: 'sdk_error',
            actionId: sent[0].actionId,
            error: 'Bot not connected to gateway'
        }));

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.reason).toBe('error');
        expect(result.message).toBe('Bot not connected to gateway');
    });

    test('still resolves normally when a result arrives', async () => {
        const { sdk, sent, pending } = stubSdk(5000);

        const promise = dispatch(sdk);
        const actionId = sent[0].actionId;
        (sdk as any).handleMessage(JSON.stringify({
            type: 'sdk_action_result',
            actionId,
            result: { success: true, message: 'Walking' }
        }));

        expect(await promise).toEqual({ success: true, message: 'Walking' });
        expect(pending.size).toBe(0);
    });
});
