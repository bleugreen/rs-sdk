// Measures the karambwan attempt cadence (tbwt.rs2: use a loaded vessel on the spot, p_delay(5),
// no interaction loop) on a local lab server.
//
//   bun docs/speedrun/scripts/fishing-karambwan.ts <bot> <level> <attempts> [out=path]
//
// Sets %tbwt_lubufu to complete (31, quest_tbwt.constant) with ::setvar, grants loaded vessels,
// stands at the Karamja river spot and re-uses a loaded vessel on the spot every tick. The server
// rejects the use while the player is delayed, so the accepted uses mark the true cadence. Every
// attempt (catch or snatch) swaps one loaded vessel for an empty one, so the tick of each
// empty-vessel increase is an attempt and each xp increase a catch.
import { appendFileSync, writeFileSync } from 'fs';
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const args = process.argv.slice(2);
const [, levelArg = '99', attemptsArg = '200'] = args;
const opts = Object.fromEntries(args.slice(3).map(a => a.split('=') as [string, string]));
const level = Number(levelArg);
const target = Number(attemptsArg);
const out = opts.out ?? `${process.env.TMPDIR ?? '/tmp'}/fishing-karambwan-${level}.jsonl`;
writeFileSync(out, '');
const log = (ev: Record<string, unknown>) => appendFileSync(out, JSON.stringify(ev) + '\n');
const within = <T>(p: Promise<T>, ms = 1500) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
const LOADED = /^Karambwan vessel$/;

const [x, z] = [2899, 3117];
const fishingXp = (s: BotWorldState) => s.skills.find(k => k.name.toLowerCase() === 'fishing')!.experience;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    for (const it of sdk.getInventory()) await within(sdk.sendDropItem(it.slot));
    await sdk.waitForTicks(2);
    await sdk.sendSay(`::setstat fishing ${level}`);
    await sdk.sendSay('::setvar tbwt_lubufu 31');
    await sdk.sendSay(`::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    await sdk.waitForTicks(3);

    let attempts = 0;
    let catches = 0;
    let lastXp = fishingXp(sdk.getState()!);
    let lastAttemptTick = -1;
    let refill = true;
    const gaps = new Map<number, number>();
    const loadedSlots = (s: BotWorldState) => s.inventory.filter(i => LOADED.test(i.name) && i.optionsWithIndex.length >= 0);
    const emptyCount = (s: BotWorldState) => s.inventory.filter(i => i.id !== loadedId && /Karambwan vessel/.test(i.name)).length;
    let loadedId = -1;
    let lastEmpty = 0;

    await new Promise<void>(resolve => {
        let sending = false;
        sdk.onStateUpdate(s => {
            if (refill && !sending) {
                sending = true;
                refill = false;
                // Empty vessels are dropped and the inventory topped up with loaded ones.
                (async () => {
                    for (const it of s.inventory) if (loadedId >= 0 && it.id !== loadedId) await within(sdk.sendDropItem(it.slot));
                    await sdk.sendSay('::give tbwt_karambwan_vessel_loaded_with_karambwanji 27');
                    await sdk.waitForTicks(2);
                    loadedId = sdk.getInventory()[0]?.id ?? -1;
                    lastEmpty = 0;
                    log({ ev: 'refill', tick: sdk.getState()!.tick, inv: sdk.getInventory().length });
                })().finally(() => (sending = false));
                return;
            }
            if (sending) return;
            const xp = fishingXp(s);
            const empties = emptyCount(s);
            if (empties > lastEmpty) {
                attempts += empties - lastEmpty;
                lastEmpty = empties;
                if (lastAttemptTick >= 0) {
                    const g = s.tick - lastAttemptTick;
                    gaps.set(g, (gaps.get(g) ?? 0) + 1);
                }
                lastAttemptTick = s.tick;
                log({ ev: 'attempt', tick: s.tick, caught: xp !== lastXp });
            }
            if (xp !== lastXp) {
                catches++;
                log({ ev: 'xp', tick: s.tick, base: (xp - lastXp) / 25 });
                lastXp = xp;
            }
            if (s.dialog?.isOpen) sdk.sendClickDialog(0);
            if (attempts >= target) return resolve();
            const slots = loadedSlots(s).filter(i => i.id === loadedId);
            if (slots.length === 0) {
                refill = true;
                return;
            }
            const spot = s.nearbyNpcs.filter(n => n.name === 'Fishing spot').sort((a, b) => a.distance - b.distance)[0];
            if (spot) sdk.sendUseItemOnNpc(slots[0].slot, spot.index);
        });
    });

    const summary = {
        level,
        attempts,
        catches,
        successRate: Math.round((catches / attempts) * 1000) / 1000,
        gaps: Object.fromEntries([...gaps.entries()].sort((a, b) => a[0] - b[0]))
    };
    log({ ev: 'summary', ...summary });
    console.log(JSON.stringify(summary));
}, { printState: false });
