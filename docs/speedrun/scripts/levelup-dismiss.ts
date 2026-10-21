// Level-up dismissal policies for the gathering-loop lab scripts (docs/speedrun/research/levelup-cost.md).
//
// Mechanism (read). addXp queues one [advancestat,<stat>] script on the ENGINE queue per xp drop that
// raises the base level, however many levels the drop crosses (Player.ts addXp: one enqueueScript
// after the level comparison). The engine queue runs in the player phase after that tick's client
// packets and before interactions (World.ts processPlayers), and only while the player canAccess()
// (Player.ts processEngineQueue), so pending level-ups pop one per tick. levelup.rs2 opens the
// chat modal and p_pausebuttons; at a level listed in levelup_unlocks.enum it then jumps to
// ~levelup_unlocks, one more objbox/mesbox page. While the modal is open the player is busy() and
// no interaction runs. A roll on server tick R therefore opens the page on R+1 and blocks R+1's
// interaction. Two ways to close it:
//   - a continue (RESUME_PAUSEBUTTON) resumes the script: plain page -> closed; unlock level -> the
//     unlock page opens instead (still busy) and needs a second continue;
//   - any op that calls clearPendingAction (OPLOC, OPNPC, OPHELD*, a walk does not) closes the modal
//     and drops the paused script (Player.ts closeModal: PAUSEBUTTON scripts are nulled), so the
//     unlock page never shows.
//
// Policies (`--dismiss=`):
//   watcher  speedrun/lib/levelup.ts startLevelUpWatcher: one continue per fresh continue page, read
//            then act, chained over the unlock page.
//   burst    on the label the page first shows, fire pagesAt(level) blind continues at once
//            (sendClickDialog(0, {blind:true}), rs/51); the server resumes them in one tick.
//   click    on the label the page first shows, re-send the loop's own target click (the caller's
//            `reclick`), which closes the modal and drops the unlock page.
//   none     send nothing; the loop's next scheduled op closes the page.
// The page is first visible on the label after the leveling roll's xp, so every policy's packet
// lands on R+2 at 1-tick latency.
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { startLevelUpWatcher, type LevelUpWatcher } from '../../../speedrun/lib/levelup';

export type DismissPolicy = 'watcher' | 'burst' | 'click' | 'none';
export const POLICIES: DismissPolicy[] = ['watcher', 'burst', 'click', 'none'];
export const isPolicy = (s: string): s is DismissPolicy => (POLICIES as string[]).includes(s);

const ROOT = join(import.meta.dir, '../../..');
let unlockCache: Map<string, Set<number>> | null = null;

/** Levels with an unlock page, per stat name, from levelup_unlocks.enum (commented vals excluded). */
export function unlockLevels(stat: string): Set<number> {
    if (!unlockCache) {
        unlockCache = new Map();
        const text = readFileSync(join(ROOT, 'server/content/scripts/levelup/configs/levelup_unlocks.enum'), 'utf8');
        let cur: Set<number> | null = null;
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            const head = /^\[levelup_unlocks_(\w+)\]$/.exec(line);
            if (head) { cur = new Set(); unlockCache.set(head[1]!, cur); continue; }
            const v = /^val=(\d+)/.exec(line);
            if (v && cur) cur.add(Number(v[1]));
        }
    }
    // the enum calls Runecraft "runecraft"; stat names in the bot state are capitalised
    return unlockCache.get(stat.toLowerCase()) ?? new Set();
}

/** Continue pages a level-up to `level` shows: the level-up box, plus one unlock page if listed. */
export const pagesAt = (stat: string, level: number) => 1 + (unlockLevels(stat).has(level) ? 1 : 0);

export interface Episode {
    level: number;
    /** label on which the new base level was first visible (the roll's xp label) */
    levelTick: number;
    /** label on which a dialog was first seen open after it */
    openTick: number | null;
    /** first label on which no dialog was open again */
    closeTick: number | null;
    /** distinct page ids seen while open */
    pages: number;
    expectedPages: number;
    sends: number;
}

/**
 * Applies one policy to every level-up of `stat` and records each episode. Subscribes to state
 * updates itself; call stop() at the end and print summary().
 */
export class LevelUpLab {
    episodes: Episode[] = [];
    private unsub: (() => void) | null = null;
    private watcher: LevelUpWatcher | null = null;
    private lastLevel = -1;
    private open: Episode | null = null;
    private lastPage: string | undefined;

    constructor(
        private sdk: BotSDK,
        readonly policy: DismissPolicy,
        readonly stat: string,
        private opts: { reclick?: (s: BotWorldState) => void; log?: (line: string) => void } = {}
    ) {
        if (policy === 'watcher') this.watcher = startLevelUpWatcher(sdk);
        const s0 = sdk.getState();
        if (s0) this.lastLevel = this.levelOf(s0);
        this.unsub = sdk.onStateUpdate(s => this.step(s));
    }

    private levelOf(s: BotWorldState) {
        return s.skills.find(k => k.name.toLowerCase() === this.stat.toLowerCase())?.baseLevel ?? 0;
    }

    private log(line: string) {
        this.opts.log?.(line);
    }

    private step(s: BotWorldState) {
        if (!s?.inGame) return;
        const t = s.tick;
        const lvl = this.levelOf(s);
        if (lvl > this.lastLevel && this.lastLevel > 0) {
            this.open = { level: lvl, levelTick: t, openTick: null, closeTick: null, pages: 0, expectedPages: pagesAt(this.stat, lvl), sends: 0 };
            this.episodes.push(this.open);
            this.lastPage = undefined;
            this.log(`T${t} LEVELUP ${this.stat} ${lvl} (expect ${this.open.expectedPages} page${this.open.expectedPages > 1 ? 's' : ''})`);
        }
        if (lvl > 0) this.lastLevel = lvl;
        const ep = this.open;
        if (!ep) return;
        const d = s.dialog;
        if (d?.isOpen) {
            const first = ep.openTick === null;
            if (first) ep.openTick = t;
            if (d.pageId !== this.lastPage) { this.lastPage = d.pageId; ep.pages++; }
            if (first && !d.isWaiting) {
                if (this.policy === 'burst') {
                    const k = ep.expectedPages;
                    for (let i = 0; i < k; i++) void this.sdk.sendClickDialog(0, { blind: true }).catch(() => {});
                    ep.sends += k;
                    this.log(`T${t} send ${k} blind continue${k > 1 ? 's' : ''}`);
                } else if (this.policy === 'click' && this.opts.reclick) {
                    this.opts.reclick(s);
                    ep.sends++;
                    this.log(`T${t} send re-click (dismiss)`);
                }
            }
        } else if (ep.openTick !== null && ep.closeTick === null) {
            ep.closeTick = t;
            this.log(`T${t} LEVELUP page closed (open ${t - ep.openTick} labels, ${ep.pages} page${ep.pages > 1 ? 's' : ''})`);
            this.open = null;
        }
    }

    stop() {
        this.unsub?.();
        this.watcher?.stop();
    }

    /** One line: episode count, pages seen vs expected, label offsets from the level label to open and to close. */
    summary(): string {
        const eps = this.episodes;
        const hist = (xs: Array<number | null>) => {
            const h: Record<string, number> = {};
            for (const x of xs) h[x === null ? '-' : String(x)] = (h[x === null ? '-' : String(x)] ?? 0) + 1;
            return Object.entries(h).map(([k, c]) => `${k}:${c}`).join(' ');
        };
        const unlock = eps.filter(e => e.expectedPages > 1);
        return [
            `level-up episodes ${eps.length} (policy ${this.policy}${this.watcher ? `, watcher dismissed ${this.watcher.dismissed}` : ''}), unlock levels ${unlock.length}: ${unlock.map(e => e.level).join(',') || '-'}`,
            `  pages seen: plain levels ${hist(eps.filter(e => e.expectedPages === 1).map(e => e.pages))}; unlock levels ${hist(unlock.map(e => e.pages))}`,
            `  open label - level label: ${hist(eps.map(e => (e.openTick === null ? null : e.openTick - e.levelTick)))}`,
            `  close label - level label: plain ${hist(eps.filter(e => e.expectedPages === 1).map(e => (e.closeTick === null ? null : e.closeTick - e.levelTick)))}; unlock ${hist(unlock.map(e => (e.closeTick === null ? null : e.closeTick - e.levelTick)))}`,
            `  episodes ${eps.map(e => `L${e.level}@T${e.levelTick}:${e.openTick === null ? '-' : e.openTick - e.levelTick}/${e.closeTick === null ? '-' : e.closeTick - e.levelTick}p${e.pages}`).join(' ')}`,
        ].join('\n');
    }
}
