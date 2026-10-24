#!/usr/bin/env bun
// Walk SCORED to one tile (host's walk-a3.ts). Only through the wrapper:
//
//   bun speedrun/tools/oneoff.ts walk --to=X,Z[,LEVEL] [--go]
//
// bot.walkTo with no tolerance, then up to 15 ticks for the player to stand on the exact tile and level.

import { EXIT, flag, parseTile, runOneoff, tileOf } from '../../lib/oneoff';

const USAGE = 'usage: bun speedrun/tools/oneoff.ts walk --to=X,Z[,LEVEL] [--go]';
export const SETTLE_TICKS = 15;

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const to = parseTile(flag(argv, 'to'));
    if (!to) {
        console.log(USAGE);
        process.exit(EXIT.usage);
    }
    process.exit(
        await runOneoff({
            kind: 'walk',
            argv,
            pathfinding: true,
            act: async c => {
                const r = await c.session.bot.walkTo(to.x, to.z, 0, { timeout: 30_000 });
                c.out('walk', { ...r, sinceLogin: c.sinceLogin() });
                let at = tileOf(c.state());
                for (let i = 0; i < SETTLE_TICKS && !(at && at.x === to.x && at.z === to.z && at.level === to.level); i++) {
                    await c.waitTicks(1);
                    at = tileOf(c.state());
                }
                const ok = !!at && at.x === to.x && at.z === to.z && at.level === to.level;
                c.out(ok ? 'CHECK-OK' : 'CHECK-FAIL', { expected: to, at });
                return ok;
            },
        })
    );
}
