// A stand-in skill module for exercising the rehearsal harness (speedrun/rehearse.ts) without a
// real step script. Same convention as speedrun/skills/<skill>.ts (`skill`, `steps()`):
//
//   steps({to})         chop normal trees near the Lumbridge spawn with the starter axe until
//                       Woodcutting reaches `to` (stock bot.chopTree; level-ups dismissed)
//   steps({idle: N})    stand still for N ticks: no xp, so a fresh account's hiscore Overall
//                       stays its logout playtime, which is what the session row is checked against
//
//   bun speedrun/rehearse.ts --skill=speedrun/runner/stub.ts --skill-opt=idle=50 ...

import type { BotWorldState } from '../../sdk/types';
import { withLevelUpDismissal } from '../lib/levelup';
import { waitTicks } from '../lib/wait';
import type { Step } from './step';

export const skill = 'woodcutting';

export function woodcuttingLevel(s: BotWorldState): number {
    return s.skills.find(k => k.name.toLowerCase() === 'woodcutting')?.baseLevel ?? 1;
}

const AXE = /axe$/i;
const LOGS = /^logs$/i;

function chopTo(to: number): Step<any> {
    return {
        name: `stub: chop to Woodcutting ${to}`,
        preconditions: s => (s.inventory.some(i => AXE.test(i.name) && !/pickaxe/i.test(i.name)) ? true : 'no axe in the inventory'),
        run: async ({ sdk, bot }) => {
            await withLevelUpDismissal(sdk, async () => {
                while (woodcuttingLevel(sdk.getState()!) < to) {
                    if (sdk.getState()!.inventory.length >= 28) {
                        const d = await bot.dropItem(LOGS, 'all');
                        if (!d.success) throw new Error(`dropping logs: ${d.message}`);
                    }
                    const r = await bot.chopTree();
                    if (!r.success) throw new Error(`chopTree: ${r.message}`);
                }
            });
        },
        postconditions: s => (woodcuttingLevel(s) >= to ? true : `Woodcutting ${woodcuttingLevel(s)} < ${to}`),
        logoutSafe: true,
        done: o => woodcuttingLevel(o.state) >= to,
    };
}

function idleFor(n: number): Step<any> {
    return {
        name: `stub: idle ${n} ticks`,
        preconditions: () => true,
        run: async ({ sdk }) => {
            await waitTicks(sdk, n);
        },
        postconditions: () => true,
        logoutSafe: true,
    };
}

export function steps(opts: { to?: number; idle?: number | string; [k: string]: unknown } = {}): Step<any>[] {
    if (opts.idle !== undefined) {
        const n = Number(opts.idle);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`stub: idle must be a positive whole number of ticks, not ${opts.idle}`);
        return [idleFor(n)];
    }
    return [chopTo(opts.to ?? 15)];
}
