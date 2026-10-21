// Level-up dismissal.
//
// A level-up is `mes` + `if_openchat(levelup_<skill>)` + `p_pausebutton`
// (server/content/scripts/levelup/scripts/levelup.rs2), and levels with
// unlocks then jump to `~levelup_unlocks`, which shows more continue boxes
// (objbox/mesbox). Gathering stalls on that chat modal; one continue each
// dismisses it.
//
// Detection: the stats update and the chat modal arrive in the same server
// tick, so a skill's base level rising arms the watcher, and any fresh
// continue page in the next few ticks is dismissed. After each dismissal the
// watcher stays armed for CHAIN_TICKS to catch the unlock pages. The level-up
// text in `recentDialogs` is a backup signal. Choice pages are never touched.
// An NPC continue page that opens within that window would be clicked too,
// so don't wrap a loop that starts a conversation right after leveling.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { classifyPage } from './dialogue';
import type { StateSource } from './wait';

export type LevelUpSdk = StateSource & Pick<BotSDK, 'sendClickDialog'>;

/** Lines from the levelup dbtable: title "Congratulations, you just advanced ..." and body "Your X level is now N." */
export const LEVEL_UP_TEXT = /just advanced|level is now|hitpoints are now/i;
export const ARM_TICKS = 4;
export const CHAIN_TICKS = 3;

/**
 * True when a continue page is showing and the latest dialog-history entry is
 * level-up text first observed within the last ARM_TICKS ticks. The lite
 * client only records a history entry when the chat modal id changes, so an
 * old level-up entry can stay at [0] long after its dialog closed; the age
 * bound keeps it from matching a later, unrelated page.
 */
export function isLevelUp(state: BotWorldState): boolean {
    if (classifyPage(state.dialog) !== 'continue') return false;
    const latest = state.recentDialogs?.[0];
    return !!latest && latest.tick >= state.tick - ARM_TICKS && LEVEL_UP_TEXT.test(latest.text.join(' '));
}

export interface WatcherMemory {
    base: Map<string, number> | null;
    armedUntil: number;
    clicked: string[];
}

export function newWatcherMemory(): WatcherMemory {
    return { base: null, armedUntil: -1, clicked: [] };
}

function baseLevels(state: BotWorldState): Map<string, number> {
    const m = new Map<string, number>();
    for (const s of state.skills ?? []) m.set(s.name, s.baseLevel);
    return m;
}

/** One watcher step per published state: whether to send a continue now. */
export function levelUpStep(mem: WatcherMemory, state: BotWorldState): { click: boolean; mem: WatcherMemory } {
    const base = baseLevels(state);
    let armedUntil = mem.armedUntil;
    if (mem.base && [...base].some(([name, lvl]) => lvl > (mem.base!.get(name) ?? lvl))) {
        armedUntil = Math.max(armedUntil, state.tick + ARM_TICKS);
    }
    const next: WatcherMemory = { base: base.size ? base : mem.base, armedUntil, clicked: mem.clicked };
    const d = state.dialog;
    const pageId = d.pageId;
    if (classifyPage(d) !== 'continue' || d.isWaiting || !pageId || mem.clicked.includes(pageId)) return { click: false, mem: next };
    if (state.tick > armedUntil && !isLevelUp(state)) return { click: false, mem: next };
    next.clicked = [...mem.clicked.slice(-31), pageId];
    next.armedUntil = Math.max(armedUntil, state.tick + CHAIN_TICKS);
    return { click: true, mem: next };
}

export interface LevelUpWatcher {
    stop(): void;
    readonly dismissed: number;
}

/** Dismiss level-up chat the tick it is published, until stopped. */
export function startLevelUpWatcher(sdk: LevelUpSdk): LevelUpWatcher {
    let mem = newWatcherMemory();
    let dismissed = 0;
    const handle = (s: BotWorldState) => {
        const r = levelUpStep(mem, s);
        mem = r.mem;
        if (r.click) {
            dismissed++;
            void sdk.sendClickDialog(0);
        }
    };
    const cur = sdk.getState();
    if (cur) handle(cur);
    const unsub = sdk.onStateUpdate(handle);
    return {
        stop: () => unsub(),
        get dismissed() {
            return dismissed;
        },
    };
}

/** Run `fn` with a level-up watcher active. */
export async function withLevelUpDismissal<T>(sdk: LevelUpSdk, fn: () => Promise<T>): Promise<T> {
    const w = startLevelUpWatcher(sdk);
    try {
        return await fn();
    } finally {
        w.stop();
    }
}
