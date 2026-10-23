// Preloaded into the filmed script's process by capture.ts (BUN_OPTIONS=--preload=film/hook.ts, so any
// Bun process the script starts loads it too); never imported. It wraps BotSDK's one dispatch point, `sendAction`, which every `send*` call and every
// BotActions helper goes through, and appends each action with the stack that issued it to
// $FILM_ACTIONS (JSONL, film/trace.ts RawAction). With FILM_ACTIONS unset it does nothing. The SDK's
// source is unchanged, so a script run any other way (the run, the lab, the rehearsal) carries none
// of this.
//
// An action sent from an in-page tick program (speedrun/lib/programs.ts) never reaches the SDK, so
// it is not recorded here; the world feed and the video still show it.

import { appendFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { BotSDK } from '../sdk/index';
import { isPlumbing, parseStack, pickSite } from './trace';

const out = process.env.FILM_ACTIONS;
const hooked = globalThis as { __filmHook?: true };
if (out && !hooked.__filmHook) {
    hooked.__filmHook = true;
    // A step loop under runSteps sits ~15 frames deep; the default limit (10) would cut the script off.
    Error.stackTraceLimit = Math.max(Error.stackTraceLimit ?? 10, 64);
    const root = resolve(import.meta.dir, '..');
    const script = process.env.FILM_SCRIPT ? relative(root, resolve(process.env.FILM_SCRIPT)) : undefined;
    type Dispatch = (this: BotSDK, action: { type: string }) => Promise<unknown>;
    const proto = BotSDK.prototype as unknown as { sendAction: Dispatch };
    const send = proto.sendAction;
    proto.sendAction = function (action) {
        const ms = Date.now();
        try {
            const frames = parseStack(new Error().stack ?? '', root);
            const line = {
                ms,
                clientTick: this.getState()?.tick ?? null,
                bot: this.config.botUsername,
                action: action.type,
                args: action,
                ...pickSite(frames, script),
                stack: frames.filter(f => !isPlumbing(f)).slice(0, 12)
            };
            appendFileSync(out, JSON.stringify(line) + '\n');
        } catch (e) {
            // Recording must never change what the script does: a failed write loses a trace line only.
            console.error(`[film hook] ${e instanceof Error ? e.message : String(e)}`);
        }
        return send.call(this, action);
    };
}
