#!/usr/bin/env bun
// Receive one obj id from a courier in a trade (host's receive-a4-shark.ts). Only through the wrapper:
//
//   bun speedrun/tools/oneoff.ts receive --id=ID [--amount=1] --have=N --courier-hash=HEX --meet=X,Z[,LEVEL] [--free=N] [--go]
//
// The courier is named by a prefix (6+ hex digits) of the sha256 of its lowercased name on the world's
// player list (lib/oneoff.ts findCourier), so its name never goes in a command; it is redacted to
// COURIER in every line. Preflight refuses unless exactly one listed player matches and it stands
// within 6 tiles of --meet. Once in the world SCORED must be within 10 tiles of --meet and hold exactly
// --have of the id. After the trade the pack must hold --have + --amount of it, every other id
// unchanged, and, with --free, exactly that many free slots (a kit that needs one slot open, or a pack
// that must not be full).

import { swap } from '../../lib/trade';
import { byId, EXIT, findCourier, flag, freeSlots, intFlag, packChanges, parseTile, runOneoff, usedSlots } from '../../lib/oneoff';

const USAGE = 'usage: bun speedrun/tools/oneoff.ts receive --id=ID [--amount=1] --have=N --courier-hash=HEX --meet=X,Z[,LEVEL] [--free=N] [--go]';
/** How far from the meet tile SCORED may stand once logged in. */
export const SCORED_WITHIN = 10;

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const id = intFlag(argv, 'id');
    const amount = intFlag(argv, 'amount') ?? 1;
    const have = intFlag(argv, 'have');
    const free = intFlag(argv, 'free');
    const hash = flag(argv, 'courier-hash');
    const meet = parseTile(flag(argv, 'meet'));
    if (id === undefined || Number.isNaN(id) || Number.isNaN(amount) || amount < 1 || have === undefined || Number.isNaN(have) || Number.isNaN(free ?? 0) || !hash || !meet) {
        console.log(USAGE);
        process.exit(EXIT.usage);
    }
    let courier = '';
    process.exit(
        await runOneoff({
            kind: `receive-${id}`,
            argv,
            at: { tile: meet, within: SCORED_WITHIN },
            preflight: async c => {
                const found = findCourier(c.roster, hash, meet, c.redact);
                if (typeof found === 'string') return found;
                courier = found.name;
                return found.line;
            },
            act: async c => {
                const s0 = c.state();
                const pre = byId(s0.inventory);
                c.out('pre', { inv: pre, slots: usedSlots(s0.inventory) });
                if ((pre[id] ?? 0) !== have) {
                    c.out('CHECK-FAIL', `the pack holds ${pre[id] ?? 0} of ${id}, not ${have}; no trade`);
                    return false;
                }
                const r = await swap(c.session.sdk, courier, [], [{ item: id, amount }], { openTicks: 60, maxTicks: 80, closeModals: true });
                c.out('swap', { ...r, reason: r.reason ?? null, sinceLogin: c.sinceLogin() });
                await c.waitTicks(1);
                const s1 = c.state();
                const post = byId(s1.inventory);
                const changes = packChanges(pre, post, { [id]: have + amount });
                c.out('post', { inv: post, slots: usedSlots(s1.inventory) });
                const other = changes.filter(ch => ch.id !== id);
                if (other.length) c.out('pack-other', other);
                const freeNow = freeSlots(s1.inventory);
                const freeOk = free === undefined || freeNow === free;
                const ok = r.ok && changes.length === 0 && freeOk;
                c.out(ok ? 'CHECK-OK' : 'CHECK-FAIL', { received: (post[id] ?? 0) - have, changes, ...(free !== undefined ? { free: freeNow, freeWanted: free } : {}) });
                return ok;
            },
        })
    );
}
