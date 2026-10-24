#!/usr/bin/env bun
// Drop every slot of one obj id from SCORED's pack (host's drop-a4-axe.ts / drop-a4-log.ts). Only
// through the wrapper:
//
//   bun speedrun/tools/oneoff.ts drop --id=ID --have=N --at=X,Z[,LEVEL] [--within=2] [--worn=ID] [--go]
//
// --have is the count the pack must hold before anything is dropped; --at the tile SCORED must stand
// within --within tiles of (Chebyshev, default 2) once in the world, since a drop is not undone. After:
// the id must be gone and every other id unchanged (any other change is a `pack-other` line), and
// --worn, when given, still worn.

import { byId, EXIT, intFlag, flag, packChanges, parseTile, runOneoff, usedSlots } from '../../lib/oneoff';

const USAGE = 'usage: bun speedrun/tools/oneoff.ts drop --id=ID --have=N --at=X,Z[,LEVEL] [--within=2] [--worn=ID] [--go]';

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const id = intFlag(argv, 'id');
    const have = intFlag(argv, 'have');
    const at = parseTile(flag(argv, 'at'));
    const within = intFlag(argv, 'within') ?? 2;
    const worn = intFlag(argv, 'worn');
    if (id === undefined || Number.isNaN(id) || have === undefined || Number.isNaN(have) || have < 1 || !at || Number.isNaN(within) || Number.isNaN(worn ?? 0)) {
        console.log(USAGE);
        process.exit(EXIT.usage);
    }
    process.exit(
        await runOneoff({
            kind: `drop-${id}`,
            argv,
            at: { tile: at, within },
            act: async c => {
                const s0 = c.state();
                const pre = byId(s0.inventory);
                c.out('pre', { inv: pre, slots: usedSlots(s0.inventory) });
                if (pre[id] !== have) {
                    c.out('CHECK-FAIL', `the pack holds ${pre[id] ?? 0} of ${id}, not ${have}; nothing dropped`);
                    return false;
                }
                const item = s0.inventory.find(i => i?.id === id)!;
                const r = await c.session.bot.dropItem(item, 'all');
                c.out('drop', { ...r, sinceLogin: c.sinceLogin() });
                await c.waitTicks(2);
                const s1 = c.state();
                const post = byId(s1.inventory);
                const changes = packChanges(pre, post, { [id]: 0 });
                c.out('post', { inv: post, slots: usedSlots(s1.inventory) });
                const other = changes.filter(ch => ch.id !== id);
                if (other.length) c.out('pack-other', other);
                const wornOk = worn === undefined || (byId(s1.equipment)[worn] ?? 0) > 0;
                if (worn !== undefined) c.out('worn', { id: worn, worn: wornOk });
                const ok = r.success && changes.length === 0 && wornOk;
                c.out(ok ? 'CHECK-OK' : 'CHECK-FAIL', { dropped: pre[id], changes, wornOk });
                return ok;
            },
        })
    );
}
