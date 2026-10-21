// Cooking raw food on a range or a fire (rs/37's no-wine Cooking fallback): ticks per cook and
// burn count for one inventory.
//
//   bun docs/speedrun/scripts/cooking-range.ts <bot> [--food=raw_lobster] [--level=99]
//       [--where=range|fire] [--mode=fast|stock] [--n=27]
//
// cook_item does one item per click and ends in p_delay(1) (cooking.rs2:158-195); there is no
// make-X. The OPLOCU click is dropped while the player is delayed, so the expected cadence is
// 3 ticks per cook (p_delay(n) = n + 2 from the click).
//   --mode=fast   re-send item-on-range every observed tick on the first raw item.
//   --mode=stock  bot.useItemOnLoc, awaited, then wait for the inventory to change.
// Range: Al Kharid (3271,3180), loc 2728. Fire: lit by the bot on the Varrock main road.
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
const FOOD = args.food ?? 'raw_lobster';
const LEVEL = Number(args.level ?? 99);
const WHERE = args.where ?? 'range';
const MODE = args.mode ?? 'fast';
const N = Number(args.n ?? 27);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OBJ: Record<string, number> = {};
for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) OBJ[m[2]!] = Number(m[1]);
}
const RAW = OBJ[FOOD];
if (RAW === undefined) throw new Error(`unknown food ${FOOD}`);
const cookXp = (s: BotWorldState) => s.skills.find(k => k.name === 'Cooking')?.experience ?? 0;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    for (const it of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(it.slot);
    await sdk.sendSay(`::setstat cooking ${LEVEL}`);
    await sdk.sendSay('::setstat firemaking 99');
    // Range: Al Kharid, range loc at (3271,3180) (maps/m51_49.jm2), player on (3273,3180).
    // Fire: open ground on the Varrock main road, (3206,3428).
    const [tx, tz] = WHERE === 'fire' ? [3206, 3428] : [3273, 3180];
    for (let attempt = 0; attempt < 5; attempt++) {
        await sdk.sendSay(`::tele 0,${tx >> 6},${tz >> 6},${tx & 63},${tz & 63}`);
        await sdk.waitForTicks(4);
        const p = sdk.getState()?.player;
        if (p && Math.abs(p.worldX - tx) <= 2 && Math.abs(p.worldZ - tz) <= 2) break;
    }
    let target: { x: number; z: number; id: number; name: string } | undefined;
    if (WHERE === 'fire') {
        await sdk.sendSay('::give tinderbox 1');
        await sdk.sendSay('::give logs 1');
        await sdk.waitForTicks(2);
        const lit = await bot.burnLogs();
        console.log(`fire: ${lit.message}`);
        await sdk.waitForTicks(2);
        target = sdk.getState()!.nearbyLocs.filter(l => /^fire$/i.test(l.name) && (l as any).reachable !== false).sort((a, b) => a.distance - b.distance)[0];
    } else {
        target = sdk.getState()!.nearbyLocs.filter(l => [2728, 2729, 2730, 2731].includes(l.id) && (l as any).reachable !== false).sort((a, b) => a.distance - b.distance)[0];
    }
    if (!target) throw new Error(`no ${WHERE} nearby: ${sdk.getState()!.nearbyLocs.slice(0, 10).map(l => `${l.name}#${l.id}@${l.x},${l.z}`).join(' ')}`);
    await sdk.sendSay(`::give ${FOOD} ${N}`);
    await sdk.waitForTicks(3);
    // First cook through the porcelain so the bot walks into reach; not timed.
    await bot.useItemOnLoc(sdk.getState()!.inventory.find(i => i.id === RAW)!, target as any);
    await sdk.waitForTicks(4);
    for (let d = 0; d < 3 && sdk.getState()?.dialog?.isOpen; d++) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }

    const s0 = sdk.getState()!;
    const t0 = s0.tick;
    const x0 = cookXp(s0);
    const raws0 = s0.inventory.filter(i => i.id === RAW).length;
    const cookTicks: number[] = [];
    let lastRaw = raws0;
    if (MODE === 'fast') {
        await new Promise<void>(resolve => {
            let acted = -1;
            const off = sdk.onStateUpdate(s => {
                if (!s?.inGame || s.tick === acted) return;
                acted = s.tick;
                const raws = s.inventory.filter(i => i.id === RAW);
                if (raws.length < lastRaw) { for (let k = 0; k < lastRaw - raws.length; k++) cookTicks.push(s.tick - t0); lastRaw = raws.length; }
                if (!raws.length || s.tick - t0 > 400) { off(); resolve(); return; }
                if (s.dialog?.isOpen) sdk.sendClickDialog(0).catch(() => {});
                sdk.sendUseItemOnLoc(raws[0]!.slot, target!.x, target!.z, target!.id).catch(() => {});
            });
        });
    } else {
        for (;;) {
            const s = sdk.getState()!;
            const raw = s.inventory.find(i => i.id === RAW);
            if (!raw || s.tick - t0 > 600) break;
            await bot.useItemOnLoc(raw, target as any);
            await sdk.waitForCondition(st => st.inventory.filter(i => i.id === RAW).length < lastRaw, 10_000).catch(() => {});
            const now = sdk.getState()!;
            const left = now.inventory.filter(i => i.id === RAW).length;
            for (let k = 0; k < lastRaw - left; k++) cookTicks.push(now.tick - t0);
            lastRaw = left;
            if (now.dialog?.isOpen) await sdk.sendClickDialog(0);
        }
    }
    const end = sdk.getState()!;
    const cooked = raws0 - end.inventory.filter(i => i.id === RAW).length;
    const gaps = cookTicks.slice(1).map((t, i) => t - cookTicks[i]!);
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g] = (hist[g] ?? 0) + 1;
    const burnt = end.inventory.filter(i => /^burnt/i.test(i.name)).length;
    const gained = (cookXp(end) - x0) / 25;
    console.log([
        `== cooking-range ${FOOD} level ${LEVEL} on ${WHERE} (${target.name}#${target.id}) mode=${MODE} (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `cooked ${cooked} in ${cookTicks.length ? cookTicks[cookTicks.length - 1]! - cookTicks[0]! : 0} ticks (first to last); gaps (ticks:count) ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' ')}; mean ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(2)}`,
        `burnt ${burnt} of ${cooked}; ${gained} base xp`
    ].join('\n'));
}, { timeout: 20 * 60_000, printState: false });
