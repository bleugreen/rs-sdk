// A dialogue a loc op opens (rs/309 fault 1): the Gnome Stronghold gate's Femi scene as the
// browser client publishes it (a page token per page, `isWaiting` with the same token while a
// continue is in flight, options with component ids, no `allComponents`), answered through
// converse.ts's continue path (actConverse) and through dialogue.ts advance().
import { describe, expect, test } from 'bun:test';
import type { BotWorldState, DialogState, PlayerState } from '../../sdk/types';
import { actConverse } from './act';
import { converse } from './converse';
import { advance } from './dialogue';
import { baseState, drive, FakeSdk, flush } from './fake-sdk';

const player = { worldX: 2461, worldZ: 3382, level: 0, hp: 10, maxHp: 10 } as PlayerState;
const closed: DialogState = { isOpen: false, options: [], isWaiting: false };

/** The scene's server and the browser client's publishing of it; `each` is the next tick's patch. */
function femiScene(sdk: FakeSdk, session = 'mvj7zoqs') {
    let token = 2;
    const cont = (): DialogState => ({ isOpen: true, isWaiting: false, pageId: `${session}:${++token}`, options: [{ index: 1, text: 'Click here to continue', componentId: 4886, buttonType: 6 }] });
    const choice = (): DialogState => ({
        isOpen: true, isWaiting: false, pageId: `${session}:${++token}`,
        options: [{ index: 1, text: "Sorry, I'm a bit busy.", componentId: 2461, buttonType: 1 }, { index: 2, text: 'OK then.', componentId: 2462, buttonType: 1 }],
    });
    const script: Array<() => DialogState> = [cont, cont, cont, choice, cont, cont];
    let at = -1;
    const queue: Array<Partial<BotWorldState>> = [];
    const answers: string[] = [];
    sdk.onSend = (a, f) => {
        if (a.method === 'sendInteractLoc') {
            at = 0;
            queue.push({ dialog: script[0]!() });
        } else if (a.method === 'clickDialogByText' && at >= 0) {
            const d = f.state!.dialog;
            const text = String(a.args[0]);
            answers.push(text);
            // a continue is answered in flight: the same page, waiting, at once (the client's latch)
            if (/continue/.test(text)) queueMicrotask(() => f.push({ dialog: { ...d, isWaiting: true } }));
            at++;
            queue.push({ dialog: at < script.length ? script[at]!() : closed });
            if (at >= script.length) at = -1;
        }
    };
    return { each: () => queue.shift() ?? {}, answers };
}

describe('a dialogue opened by a loc op, as the browser client publishes it', () => {
    test("converse.ts's continue path (actConverse): every page continued, the choice declined by text, the dialogue closed", async () => {
        const sdk = new FakeSdk(baseState({ tick: 571, player }));
        const scene = femiScene(sdk);
        const r = await drive(sdk, actConverse(sdk as never, () => sdk.sendInteractLoc(2459, 3383, 190, 1), [/^Sorry, I'm a bit busy\.$/], { idle: 1 }), 60, scene.each);
        expect(r).toMatchObject({ ok: true });
        expect(r.dialogue).toMatchObject({ opened: true, pages: 5, options: 1 });
        expect(scene.answers.filter(a => /busy/.test(a))).toHaveLength(1);
        expect(sdk.state!.dialog.isOpen).toBe(false);
    });

    test('converse answers the same scene when it was already open (a gate clicked by bot.walkTo)', async () => {
        const sdk = new FakeSdk(baseState({ tick: 571, player }));
        const scene = femiScene(sdk);
        await sdk.sendInteractLoc(2459, 3383, 190, 1);
        sdk.tick(scene.each());
        const r = await drive(sdk, converse(sdk as never, [/^Sorry, I'm a bit busy\.$/], { idle: 1 }), 60, scene.each);
        expect(r).toMatchObject({ ok: true, opened: true, pages: 5, options: 1 });
    });

    test('advance(), page by page, with an earlier dialogue (S00) still in its page memory', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, player }));
        // An earlier dialogue on this SDK, answered with advance(): its last page stays in the memory.
        const earlier = femiScene(sdk, 'tutorial');
        await sdk.sendInteractLoc(3094, 3107, 1, 1);
        for (let k = 0; k < 10; k++) {
            const p = advance(sdk as never, { choose: /^Sorry/, maxTicks: 6 });
            await flush();
            sdk.tick(earlier.each());
            const a = await drive(sdk, p, 10, earlier.each);
            if (!a.ok) break;
        }
        await drive(sdk, Promise.resolve(), 2);
        // The gate's scene, on a later tick.
        const scene = femiScene(sdk);
        await sdk.sendInteractLoc(2459, 3383, 190, 1);
        sdk.tick(scene.each());
        const kinds: string[] = [];
        for (let k = 0; k < 10 && sdk.state!.dialog.isOpen; k++) {
            const a = await drive(sdk, advance(sdk as never, { choose: /^Sorry, I'm a bit busy\.$/, maxTicks: 6 }), 10, scene.each);
            expect(a.ok).toBe(true);
            kinds.push(a.kind);
            await flush();
            sdk.tick(scene.each());
        }
        expect(kinds).toEqual(['continue', 'continue', 'continue', 'choice', 'continue', 'continue']);
        expect(sdk.state!.dialog.isOpen).toBe(false);
    });
});
