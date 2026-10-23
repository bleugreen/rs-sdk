// S25c's wine giver (SUPPLIES.md H21c, cooking.ts WINE_GIVER on the day) on the lab engine, as S25c
// was accepted against it (lab/cooking-accept.ts): a lab.sh LAB_HELPERS account (its lite runner up),
// staged by staff commands beside SCORED's booth stand with the row's noted unfermented wines, then
// the real hand-off, helpers/wine.ts giveWine's afterRelog (the run-day `wine` role's afterRelog
// branch calls the same function): it waits to see SCORED, then gone (relog 1), then back, and
// trades on the first state SCORED is back. lab/dress-rehearsal.ts (--wine-giver) stages it before
// SCORED logs in and arms it when S25c starts, so no earlier relog in sight (a staff jump's quest-tab
// relog) is taken for relog 1.

import { giveWine, type GiveResult } from '../helpers/wine';
import type { Session } from '../lib/session';
import { STAND_IN_STEP } from '../runner/run-report';
import { GIVER_TILE, WINES } from '../skills/cooking';
import { cheat, mustTele } from './setup';

/** The step the wine giver serves. */
export const WINE_STEP = 'S25c';

/** The giver beside SCORED's stand with `n` noted unfermented wines (H21c's 520) and nothing else, by staff commands. */
export async function stageWineGiver(giver: Pick<Session, 'sdk'>, n: number = WINES): Promise<void> {
    await cheat(giver.sdk, '~clearinv inv', 1);
    await mustTele(giver.sdk, GIVER_TILE.x, GIVER_TILE.z);
    await cheat(giver.sdk, `give cert_jug_unfermented_wine ${n}`, 2);
}

/** The hand-off on `receiver`'s relog in sight (giveWine afterRelog): every note, one trade. */
export function serveWine(giver: Pick<Session, 'sdk' | 'bot'>, receiver: string, o: { log?: (message: string, data?: Record<string, unknown>) => void; cueTimeoutMs?: number } = {}): Promise<GiveResult> {
    return giveWine({ sdk: giver.sdk, bot: giver.bot, log: o.log ?? (() => {}) }, receiver, -1, 120_000, { afterRelog: true, ...(o.cueTimeoutMs !== undefined ? { cueTimeoutMs: o.cueTimeoutMs } : {}) });
}

/** The slice runs S25c itself (not --staff-steps' STAND-IN jump past it). */
export function runsS25c(steps: readonly { id: string; name?: string }[]): boolean {
    return steps.some(s => s.id === WINE_STEP && !(s.name ?? '').startsWith(STAND_IN_STEP));
}

/**
 * Why S25c cannot meet its wine giver in `steps` ([] when it can, or when the slice does not run
 * S25c): --wine-giver names one lab.sh LAB_HELPERS account (a lite runner up for it), none of the
 * other givers.
 */
export function wineGiverGaps(steps: readonly { id: string; name?: string }[], g: { wineGiver?: string; labHelpers?: readonly string[]; others?: readonly string[] }): string[] {
    if (!runsS25c(steps)) return [];
    const w = g.wineGiver;
    if (!w) return ['S25c (cooking) has no wine giver: name one with --wine-giver=<lab.sh LAB_HELPERS account>, or jump the step with --staff-steps=S25c'];
    const out: string[] = [];
    if (g.labHelpers && !g.labHelpers.includes(w)) out.push(`S25c: --wine-giver ${w} is not on LAB_HELPERS, so no lite runner is up for it`);
    if (g.others?.includes(w)) out.push(`S25c: ${w} is named by --wine-giver and by another giver flag`);
    return out;
}
