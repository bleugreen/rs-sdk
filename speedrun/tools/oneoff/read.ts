#!/usr/bin/env bun
// Read-only state check of SCORED (host's read-a4.ts): its tile, its pack and worn items by id, its
// vitals; nothing is clicked. It still logs in, so it costs ticks in the world. Only through the
// wrapper, which runs the preflight alone without --go:
//
//   bun speedrun/tools/oneoff.ts read [--go]

import { byId, runOneoff, usedSlots } from '../../lib/oneoff';

if (import.meta.main) {
    process.exit(
        await runOneoff({
            kind: 'read-only',
            argv: process.argv.slice(2),
            act: async c => {
                const s = c.state();
                const p = s.player;
                c.out('pack', { inv: byId(s.inventory), slots: usedSlots(s.inventory) });
                c.out('worn', s.equipment.filter(Boolean).map(i => ({ id: i.id, name: i.name, count: i.count })));
                c.out('vitals', { hp: p?.hp ?? null, maxHp: p?.maxHp ?? null, runEnergy: p?.runEnergy ?? null, combat: p?.combat ?? null });
                return true;
            },
        })
    );
}
