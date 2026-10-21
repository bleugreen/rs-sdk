// Measures the karambwan attempt cadence (tbwt.rs2: use a loaded vessel on the spot, p_delay(5),
// no interaction loop) on a local lab server.
//
//   bun docs/speedrun/scripts/fishing-karambwan.ts <bot> <level> <attempts> [out=path]
//
// Sets %tbwt_lubufu to complete (31, quest_tbwt.constant) with ::setvar, grants loaded vessels,
// stands at the Karamja river spot and keeps one use of a loaded vessel on the spot in flight at
// all times. The server ignores uses sent while the player is delayed, so the accepted ones mark
// the true cadence. Every attempt (catch or snatch) turns one loaded vessel into an empty one, so
// each drop in the loaded count is an attempt and each xp increase a catch. Loaded and empty
// vessels share the name "Karambwan vessel"; they are told apart by obj id.
import { appendFileSync, writeFileSync } from 'fs';
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const args = process.argv.slice(2);
const [, levelArg = '99', attemptsArg = '200'] = args;
const opts = Object.fromEntries(args.slice(3).map(a => a.split('=') as [string, string]));
const level = Number(levelArg);
const target = Number(attemptsArg);
const verbose = opts.verbose === '1';
const out = opts.out ?? `${process.env.TMPDIR ?? '/tmp'}/fishing-karambwan-${level}.jsonl`;
writeFileSync(out, '');
const log = (ev: Record<string, unknown>) => appendFileSync(out, JSON.stringify(ev) + '\n');
const within = <T>(p: Promise<T>, ms = 1500) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

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

    const refill = async () => {
        for (const it of sdk.getInventory()) await within(sdk.sendDropItem(it.slot));
        // Each catch adds a raw karambwan and the empty vessel keeps its slot, so the inventory
        // grows by one per catch and the attempt refuses once it is full (tbwt.rs2). 14 loaded
        // vessels always fit: 14 + 13 catches = 27 slots before the last attempt.
        await sdk.sendSay('::give tbwt_karambwan_vessel_loaded_with_karambwanji 14');
        await sdk.waitForCondition(s => s.inventory.length >= 14, 5000).catch(() => undefined);
    };
    await refill();
    const loadedId = sdk.getInventory()[0].id;
    const loaded = (s: BotWorldState) => s.inventory.filter(i => i.id === loadedId);
    log({ ev: 'setup', tick: sdk.getState()!.tick, loadedId, inv: sdk.getInventory().length });

    let attempts = 0;
    let catches = 0;
    let lastXp = fishingXp(sdk.getState()!);
    let lastLoaded = loaded(sdk.getState()!).length;
    let lastAttemptTick = sdk.getState()!.tick;
    let seenMessages = sdk.getState()!.gameMessages.length;
    let using = false;
    let refilling = false;
    const gaps = new Map<number, number>();

    await new Promise<void>(resolve => {
        sdk.onStateUpdate(s => {
            if (refilling) return;
            for (const m of s.gameMessages.slice(seenMessages)) log({ ev: 'mes', tick: s.tick, text: m.text });
            seenMessages = s.gameMessages.length;
            const now = loaded(s).length;
            if (now < lastLoaded) {
                attempts += lastLoaded - now;
                const g = s.tick - lastAttemptTick;
                gaps.set(g, (gaps.get(g) ?? 0) + 1);
                lastAttemptTick = s.tick;
                log({ ev: 'attempt', tick: s.tick, gap: g, caught: fishingXp(s) !== lastXp });
            }
            lastLoaded = now;
            if (fishingXp(s) !== lastXp) {
                catches++;
                log({ ev: 'xp', tick: s.tick, base: (fishingXp(s) - lastXp) / 25 });
                lastXp = fishingXp(s);
            }
            if (s.dialog?.isOpen) sdk.sendClickDialog(0);
            if (attempts >= target) return resolve();
            if (s.tick - lastAttemptTick > 60) {
                log({ ev: 'stalled', tick: s.tick });
                return resolve();
            }
            if (now === 0) {
                refilling = true;
                refill().then(() => {
                    lastLoaded = loaded(sdk.getState()!).length;
                    lastAttemptTick = sdk.getState()!.tick;
                    log({ ev: 'refill', tick: lastAttemptTick });
                }).finally(() => (refilling = false));
                return;
            }
            const spot = s.nearbyNpcs.filter(n => n.name === 'Fishing spot').sort((a, b) => a.distance - b.distance)[0];
            if (spot && !using) {
                using = true;
                const slot = loaded(s)[0].slot;
                within(sdk.sendUseItemOnNpc(slot, spot.index)).then(r => {
                    const res = r as { success?: boolean; message?: string; reason?: string } | undefined;
                    if (verbose || (res && !res.success)) log({ ev: 'use', tick: s.tick, slot, spot: spot.index, dist: spot.distance, ok: res?.success, msg: res?.message, reason: res?.reason });
                }).finally(() => (using = false));
            }
        });
    });

    const summary = {
        level,
        attempts,
        catches,
        successRate: Math.round((catches / Math.max(attempts, 1)) * 1000) / 1000,
        gaps: Object.fromEntries([...gaps.entries()].sort((a, b) => a[0] - b[0]))
    };
    log({ ev: 'summary', ...summary });
    console.log(JSON.stringify(summary));
}, { printState: false });
