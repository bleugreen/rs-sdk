#!/usr/bin/env bun
// Receive one obj id from a courier in a trade (host's receive-a4-shark.ts). Only through the wrapper:
//
//   bun speedrun/tools/oneoff.ts receive --id=ID [--amount=1] --have=N --courier-hash=HEX --meet=X,Z[,LEVEL] [--go]
//
// The courier is named by a prefix (6+ hex digits) of the sha256 of its lowercased name on the world's
// player list (lib/oneoff.ts nameHash), so its name never goes in a command; it is redacted to COURIER
// in every line. Preflight refuses unless exactly one listed player matches and it stands within 6
// tiles of --meet. Once in the world SCORED must be within 10 tiles of --meet and hold exactly --have
// of the id. After the trade the pack must hold --have + --amount of it and every other id unchanged.

import { swap } from '../../lib/trade';
import { byId, chebyshev, EXIT, flag, intFlag, nameHash, packChanges, parseTile, runOneoff, usedSlots } from '../../lib/oneoff';

const USAGE = 'usage: bun speedrun/tools/oneoff.ts receive --id=ID [--amount=1] --have=N --courier-hash=HEX --meet=X,Z[,LEVEL] [--go]';
/** How far from the meet tile the courier may stand at preflight, and SCORED once logged in. */
export const COURIER_WITHIN = 6;
export const SCORED_WITHIN = 10;

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const id = intFlag(argv, 'id');
    const amount = intFlag(argv, 'amount') ?? 1;
    const have = intFlag(argv, 'have');
    const hash = flag(argv, 'courier-hash')?.toLowerCase();
    const meet = parseTile(flag(argv, 'meet'));
    if (id === undefined || Number.isNaN(id) || Number.isNaN(amount) || amount < 1 || have === undefined || Number.isNaN(have) || !hash || !/^[0-9a-f]{6,64}$/.test(hash) || !meet) {
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
                const matches = c.roster.filter(p => nameHash(p.name).startsWith(hash));
                for (const m of matches) c.redact.add(m.name, 'COURIER');
                if (matches.length !== 1) return `${matches.length} listed players match the courier hash; need exactly 1`;
                const m = matches[0]!;
                const dist = chebyshev({ x: m.x, z: m.z, level: m.level }, meet);
                if (dist > COURIER_WITHIN) return `the courier is ${Number.isFinite(dist) ? `${dist} tiles` : 'on another level'} from the meet tile (at most ${COURIER_WITHIN})`;
                courier = m.name;
                return { courierMatches: 1, courier: { x: m.x, z: m.z, level: m.level, distFromMeet: dist } };
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
                const ok = r.ok && changes.length === 0;
                c.out(ok ? 'CHECK-OK' : 'CHECK-FAIL', { received: (post[id] ?? 0) - have, changes });
                return ok;
            },
        })
    );
}
