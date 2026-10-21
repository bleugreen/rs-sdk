// Wine bank fermentation on the scored account's side (rs/37), measured end to end.
//
//   bun docs/speedrun/scripts/cooking-wine.ts <bot> --phase=prep [--wines=450] [--inv=0] [--level=1]
//   (delayfree-lab.sh step @relog)
//   bun docs/speedrun/scripts/cooking-wine.ts <bot> --phase=observe [--ticks=60]
//
// prep: waits until the login-armed timer of the current session has fired (login + 20,
//   wine.rs2:72-73), sets Cooking, puts <wines> unfermented wines in the bank (given as
//   banknotes and deposited, so they bank unnoted) and <inv> loose ones in the inventory,
//   then checks for 10 ticks that nothing ferments (the timer is cleared after it fires,
//   wine.rs2:70).
// observe: run right after a relog. Logs Cooking xp every tick from login (the lite
//   client's tick count starts at login) and reports the tick the wines fermented, the
//   xp, the level, and the good/bad wine counts in bank and inventory.
//
// The timer (wine.rs2:22-70) rolls stat_random(cooking, 48, 352) per bank BATCH: 15 batches
// of floor(N/15), then N % 15 single rolls, then each inventory wine singly, at the
// current level, which rises as batches succeed.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const args: Record<string, string> = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [key, ...v] = a.slice(2).split('=');
        return [key, v.length ? v.join('=') : 'true'];
    })
);
const PHASE = args.phase ?? 'prep';
const WINES = Number(args.wines ?? 450);
const INV = Number(args.inv ?? 0);
const LEVEL = Number(args.level ?? 1);
const TICKS = Number(args.ticks ?? 60);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OBJ: Record<string, number> = {};
for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) OBJ[m[2]!] = Number(m[1]);
}
const UNF = OBJ.jug_unfermented_wine!, WINE = OBJ.jug_wine!, BAD = OBJ.jug_bad_wine!, UNF_NOTE = OBJ.cert_jug_unfermented_wine!;

const LEVEL_XP: number[] = [];
{
    let acc = 0;
    LEVEL_XP[1] = 0;
    for (let i = 0; i < 98; i++) {
        acc += Math.floor(i + 1 + Math.pow(2, (i + 1) / 10) * 300);
        LEVEL_XP[i + 2] = Math.floor(acc / 4);
    }
}
const levelOf = (xp: number) => { let l = 1; while (l < 99 && xp >= LEVEL_XP[l + 1]!) l++; return l; };
const cookXp = (s: BotWorldState) => s.skills.find(k => k.name === 'Cooking')?.experience ?? 0;
const count = (items: Array<{ id: number; count: number }>, id: number) => items.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);

await runScript(async ({ bot, sdk }) => {
    if (PHASE === 'prep') {
        await bot.skipTutorial?.();
        // The session's own login timer must have fired before any wine is banked.
        await sdk.waitForCondition(s => s.tick >= 25, 60_000);
        await sdk.sendSay(`::setstat cooking ${LEVEL}`);
        for (let attempt = 0; attempt < 5; attempt++) {
            await sdk.sendSay('::tele 0,49,53,49,44');
            await sdk.waitForTicks(4);
            const p = sdk.getState()?.player;
            if (p && Math.abs(p.worldX - 3185) <= 2 && Math.abs(p.worldZ - 3436) <= 2) break;
        }
        await bot.openBank();
        for (const it of [...(sdk.getState()?.inventory ?? [])]) await bot.depositItem(it, -1);
        await bot.closeBank();
        await sdk.sendSay(`::give cert_jug_unfermented_wine ${WINES + INV}`);
        await sdk.waitForTicks(2);
        await bot.openBank();
        const note = sdk.getState()!.inventory.find(i => i.id === UNF_NOTE);
        if (!note) throw new Error('no noted wine given');
        await bot.depositItem(note, -1);
        if (INV > 0) {
            const b = sdk.getState()!.bank.items.find(i => i.id === UNF);
            if (b) await bot.withdrawItem(b, INV);
        }
        await bot.closeBank();
        const x0 = cookXp(sdk.getState()!);
        await sdk.waitForTicks(10);
        await bot.openBank();
        const s = sdk.getState()!;
        console.log(`prep: tick ${s.tick}; Cooking ${levelOf(cookXp(s))} (${cookXp(s) / 25} base, ${cookXp(s) === x0 ? 'unchanged' : 'CHANGED'} over 10 ticks); bank unfermented ${count(s.bank.items, UNF)}, inventory unfermented ${count(s.inventory, UNF)}`);
        await bot.closeBank();
        return;
    }

    // ---- observe, right after login ----
    const first = sdk.getState()!;
    let last = cookXp(first);
    const x0 = last;
    const jumps: string[] = [];
    console.log(`observe: first state at tick ${first.tick} after login; Cooking ${levelOf(x0)} (${x0 / 25} base)`);
    await new Promise<void>(resolve => {
        const off = sdk.onStateUpdate(s => {
            if (!s?.inGame) return;
            const x = cookXp(s);
            if (x !== last) { jumps.push(`tick ${s.tick}: +${(x - last) / 25} base -> level ${levelOf(x)}`); last = x; }
            if (s.tick >= TICKS) { off(); resolve(); }
        });
    });
    await bot.openBank();
    const s = sdk.getState()!;
    const gained = (cookXp(s) - x0) / 25;
    console.log([
        `== cooking-wine observe (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `xp changes (tick = ticks since login as the client counts them): ${jumps.join('; ') || 'none'}`,
        `gained ${gained} base = ${gained / 110} good wines; Cooking ${levelOf(x0)} -> ${levelOf(cookXp(s))}`,
        `bank: wine ${count(s.bank.items, WINE)}, bad ${count(s.bank.items, BAD)}, unfermented ${count(s.bank.items, UNF)}; inventory: wine ${count(s.inventory, WINE)}, bad ${count(s.inventory, BAD)}, unfermented ${count(s.inventory, UNF)}`
    ].join('\n'));
    await bot.closeBank();
}, { timeout: 20 * 60_000, printState: false });
