// The runner puts an SDK action on the game socket the moment the gateway
// delivers it.
//
// The engine reads input once per tick, so the time between the frame a bot
// reacts to and its packet on the wire comes out of the gap a reaction has to
// land in. The runner used to start actions on a 20ms interval and leave the
// bytes for the session loop's next flush, and on the demo that cost about one
// next-tick reaction in two. These pin the order that replaced it: execute,
// flush, and only then collect and publish state (which takes milliseconds to
// tens of milliseconds).
//
// The client is a recording stub; nothing here touches a network.

import { describe, expect, test } from 'bun:test';

import './test-support/browser-globals.js';

import type { ActionResult } from '#/bot/ActionExecutor.js';
import type { BotAction } from '#/bot/types.js';

import { LiteGatewayRunner } from './runner.js';

type Handler = (action: BotAction) => ActionResult | Promise<ActionResult>;

function makeRunner() {
    const events: string[] = [];
    const handlers: Record<string, Handler> = {};
    const client = {
        setOnGameTickCallback(): void {},
        executeBotAction(action: BotAction): ActionResult | Promise<ActionResult> {
            events.push(`exec ${action.type}`);
            return handlers[action.type]?.(action) ?? { success: true, message: 'ok' };
        },
        flush(): void {
            events.push('flush');
        },
        collectBotState(tick: number) {
            events.push('state');
            return { tick };
        }
    };

    const runner = new LiteGatewayRunner({ client, stop() {} } as never, 'ws://unused');
    const sent: any[] = [];
    // Stand in for an open gateway socket without connecting one.
    Object.assign(runner as any, {
        wsConnected: true,
        ws: { readyState: WebSocket.OPEN, send: (msg: string) => sent.push(JSON.parse(msg)), close() {} }
    });

    const deliver = (action: Record<string, unknown>, actionId: string): void => {
        (runner as any).handleMessage({ type: 'action', action, actionId });
    };
    const results = () => sent.filter(m => m.type === 'actionResult').map(m => [m.actionId, m.result.success, m.result.reason]);

    return { runner, events, handlers, deliver, results };
}

describe('lite runner action dispatch', () => {
    test('an action runs and is flushed on arrival, before state is collected', () => {
        const { runner, events, deliver, results } = makeRunner();
        try {
            deliver({ type: 'walkTo', x: 3222, z: 3218 }, 'a1');

            // Synchronously, inside the gateway message handler: no timer involved.
            expect(events).toEqual(['exec walkTo', 'flush', 'state']);
            expect(results()).toEqual([['a1', true, undefined]]);
        } finally {
            runner.stop();
        }
    });

    test('actions arriving together run back to back in arrival order', () => {
        const { runner, events, deliver, results } = makeRunner();
        try {
            deliver({ type: 'walkTo' }, 'a1');
            deliver({ type: 'interactNpc' }, 'a2');
            deliver({ type: 'togglePrayer' }, 'a3');

            expect(events).toEqual([
                'exec walkTo', 'flush', 'state',
                'exec interactNpc', 'flush', 'state',
                'exec togglePrayer', 'flush', 'state'
            ]);
            expect(results().map(r => r[0])).toEqual(['a1', 'a2', 'a3']);
        } finally {
            runner.stop();
        }
    });

    test('a wait holds later actions for its runner ticks, then they run', async () => {
        const { runner, events, deliver, results } = makeRunner();
        try {
            deliver({ type: 'wait', ticks: 2 }, 'w1');
            deliver({ type: 'walkTo' }, 'a1');
            expect(events).toEqual(['exec wait', 'flush']);

            await Bun.sleep(120);

            expect(events).toContain('exec walkTo');
            expect(results()).toEqual([['w1', true, undefined], ['a1', true, undefined]]);
        } finally {
            runner.stop();
        }
    });

    test('an async action is flushed when it settles, then the next one runs', async () => {
        const { runner, events, handlers, deliver, results } = makeRunner();
        handlers.dialog = () =>
            new Promise(resolve =>
                setTimeout(() => {
                    events.push('async write');
                    resolve({ success: true, message: 'ok' });
                }, 5)
            );
        try {
            deliver({ type: 'dialog' }, 'd1');
            deliver({ type: 'walkTo' }, 'a1');
            expect(events).toEqual(['exec dialog', 'flush']);

            await Bun.sleep(30);

            expect(events).toEqual(['exec dialog', 'flush', 'async write', 'flush', 'state', 'exec walkTo', 'flush', 'state']);
            expect(results().map(r => r[0])).toEqual(['d1', 'a1']);
        } finally {
            runner.stop();
        }
    });

    test('an action that throws reports execution_error and does not block the queue', () => {
        const { runner, events, handlers, deliver, results } = makeRunner();
        handlers.boom = () => {
            throw new Error('bad action');
        };
        try {
            deliver({ type: 'boom' }, 'b1');
            deliver({ type: 'walkTo' }, 'a1');

            expect(results()).toEqual([['b1', false, 'execution_error'], ['a1', true, undefined]]);
            expect(events).toContain('exec walkTo');
        } finally {
            runner.stop();
        }
    });
});
