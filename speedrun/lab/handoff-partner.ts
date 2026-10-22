// The lab's hand-off partner: a helper bot staged with a ledger row's `in` on the hand-off tile, its
// trade request standing once SCORED is in view, then rs/41's HS1 giver (helpers/mule.ts
// giveOpenTrade, burst) on the open trade. Shared by the hand-off labs (handoff-accept.ts, and
// quests/mage-arena.ts's H13 in Kolodion's cellar).

import { giveOpenTrade } from '../helpers/mule';
import { objName } from '../lib/items';
import type { Session } from '../lib/session';
import { clickBack, decideTradeClick, newClickCtx, sameName, sendTradeClick, tradeOf } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { configIds } from '../lib/world';
import type { HandOffPlan } from '../runner/handoff';
import { cheat } from './setup';

// ::give takes an obj's debug name. Most are the ledger name with underscores or without spaces;
// these are not (a dose suffix is looked up without it).
const DEBUG_NAMES: Readonly<Record<string, string>> = { 'prayer potion': '4doseprayerrestore', 'magic potion': '4dose1magic', 'normal logs': 'logs' };

export function debugName(name: string): string {
    const objs = configIds('obj');
    const bare = name.replace(/\(\d\)$/, '');
    for (const c of [DEBUG_NAMES[name], DEBUG_NAMES[bare], name.replace(/ /g, '_'), name.replace(/ /g, '')]) if (c && objs.has(c)) return c;
    throw new Error(`no obj debug name for "${name}": add it to DEBUG_NAMES`);
}

/** The obj ::give stages for a ledger entry: its id's obj (the note, for an `in` at [n]), else by name. */
export const objFor = (e: { name: string; ids?: readonly number[] }) => (e.ids ? objName(e.ids[0]!)! : debugName(e.name));

/** Empty the pack and the worn slots. */
export async function wipe(s: Session): Promise<void> {
    await cheat(s.sdk, '~clearinv inv');
    await cheat(s.sdk, '~clearinv worn');
    await waitUntil(s.sdk, st => st.inventory.length === 0 && st.equipment.length === 0, { maxTicks: 10 });
}

/** ::give every entry, and wait until the inventory holds them all. */
export async function stage(s: Session, items: ReadonlyArray<{ obj: string; count: number | 'all'; kind?: string }>): Promise<void> {
    for (const i of items) await cheat(s.sdk, `give ${i.obj} ${i.count === 'all' ? 1 : i.count}`);
    const slots = items.reduce((a, i) => a + (i.kind === 'u' ? (i.count as number) : i.kind === undefined && i.count !== 'all' ? (i.count as number) : 1), 0);
    const r = await waitUntil(s.sdk, st => st.inventory.length >= slots, { maxTicks: 15 });
    if (!r.ok) throw new Error(`staging ${s.name}: ${s.sdk.getState()?.inventory.length} of ${slots} slots`);
    await waitTicks(s.sdk, 2);
}

/** The partner's pack: exactly the row's `in`. */
export async function stageReceive(partner: Session, plan: HandOffPlan): Promise<void> {
    await wipe(partner);
    await stage(partner, plan.receive.map(r => ({ obj: objFor(r), count: r.count, kind: r.kind })));
}

export type PartnerResult = Awaited<ReturnType<typeof giveOpenTrade>>;

/**
 * The partner's side: a request standing once SCORED is in view, then HS1's giver on the open trade.
 * The request re-sends only after a busy bounce or no reply, never once it has landed: a request
 * landing on an open trade closes it (decideTradeClick, as the fleet givers use it). Resolves with
 * the giver's result, or undefined once `stop` holds with no trade served.
 */
export function serveStandingRequest(partner: Session, scoredName: string, stop: () => boolean): Promise<PartnerResult | undefined> {
    return (async () => {
        let req = newClickCtx();
        while (!stop()) {
            const st = await nextTick(partner.sdk);
            const t = tradeOf(st);
            if (!t.isOpen) {
                const p = st.nearbyPlayers.find(x => sameName(x.name, scoredName));
                if (!p) continue;
                const d = decideTradeClick(st, req, { noReplyTicks: 3, resendTicks: 100 });
                req = d.next;
                if (d.action === 'send') sendTradeClick(partner.sdk, p.index, req.sentTick, (sent, tick) => (req = clickBack(req, sent, tick)));
                continue;
            }
            req = newClickCtx();
            if (!sameName(t.partner, scoredName)) {
                await partner.sdk.sendDeclineTrade();
                continue;
            }
            return giveOpenTrade(partner.sdk, partner.bot, scoredName, partner.sdk.getInventory(), 'burst', 30_000);
        }
        return undefined;
    })();
}
