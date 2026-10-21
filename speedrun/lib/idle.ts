// Idle policies live above wait/world: world queries already depend on wait.
import { clickContinue, type DialogueSdk } from './dialogue';
import { levelUpChain } from './levelup';
import { currentTick, waitUntil, type Pred, type WaitResult } from './wait';
import { messagesSince, pos } from './world';

export interface IdleOptions {
    /** Consecutive ticks without movement, a new game message or an open dialogue. Default 3. */
    still?: number;
    maxTicks: number;
}

export type IdleResult = WaitResult & {
    /** Last movement/message/open-dialogue tick, or the call tick if nothing changed; excludes the quiet tail. */
    last: number;
    changed: boolean;
    levelUps: number;
};

/**
 * Wait for message-based idle, ignoring animation. A ready quest dialogue ends
 * the wait untouched; only recognised level-up/unlock pages are dismissed.
 * The cap uses waitUntil's timeout semantics and returns ok:false, not an error.
 */
export async function idle(sdk: DialogueSdk, { still = 3, maxTicks }: IdleOptions): Promise<IdleResult> {
    const levelUp = levelUpChain();
    const clicked = new Set<string>();
    const t0 = currentTick(sdk);
    let last = t0;
    let changed = false;
    let levelUps = 0;
    let p = pos(sdk);
    let said = 0;
    const r = await waitUntil(sdk, s => {
        const q = pos(s);
        const n = messagesSince(s, t0 + 1).length;
        if (s.dialog.isOpen || q.x !== p.x || q.z !== p.z || q.level !== p.level || n !== said) {
            last = s.tick;
            changed = true;
        }
        p = q;
        said = n;
        if (s.dialog.isOpen && !s.dialog.isWaiting) {
            if (!levelUp(s)) return true;
            const pageId = s.dialog.pageId;
            if (pageId && !clicked.has(pageId)) {
                clicked.add(pageId);
                levelUps++;
                void clickContinue(sdk);
            }
        }
        return s.tick - last >= still;
    }, { maxTicks });
    return { ...r, last, changed, levelUps };
}

/**
 * Animation-based idle predicate: one tile, no dialogue and no animation for
 * still ticks. Messages do not reset it and no dialogue is dismissed. Each
 * wait needs a fresh predicate; its successful tick includes the quiet tail.
 */
export function settled(still: number): Pred {
    let last = '';
    let since = -1;
    return s => {
        const p = s.player;
        const here = `${p?.worldX},${p?.worldZ},${p?.level}`;
        if (here !== last || s.dialog.isOpen || (p?.animId ?? -1) !== -1 || since < 0) {
            last = here;
            since = s.tick;
            return false;
        }
        return s.tick - since >= still;
    };
}
