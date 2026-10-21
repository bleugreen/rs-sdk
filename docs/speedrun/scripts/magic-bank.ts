// The bank cycle between enchanting inventories, stock SDK vs a tick-tight client.
//
//   bun docs/speedrun/scripts/magic-bank.ts <bot> [mode] [cycles] [spell]
//   NODE_TICKRATE=300 docs/speedrun/scripts/magic-lab.sh <bot> docs/speedrun/scripts/magic-bank.ts:fast:3
//
// Stands at a Varrock west bank booth with the spell's runes and staff (magic-cadence.ts SPELLS),
// puts (cycles + 1) inventories of the target jewellery in the bank, then repeats: enchant the whole
// inventory (one click per tick, as magic-cadence.ts), bank, and start the next inventory. The
// number that matters is the gap between the last cast of one inventory and the first cast of the
// next; without banking it would be 3 ticks, so overhead = gap - 3.
//
// mode=stock: bot.openBank, bot.depositItem(all), bot.withdrawItem(all), bot.closeBank.
// mode=fast:  click the booth's Bank option every tick until the bank is open (OpLocHandler drops
//             it while the last cast's p_delay holds), then in one tick send deposit-all,
//             withdraw-all and close, then cast on the next tick.
import { runScript } from '../../../sdk/runner';
import { SPELLS } from './magic-cadence-spells';
import { cheat, freshKit, log, namePattern, nextTick, prepare, sleep, tick, waitTicks, waitUntil, xpRecorder } from './magic-lib';

const [mode = 'fast', cyclesArg = '3', spellName = 'dragonstone'] = process.argv.slice(3);
const CYCLES = Number(cyclesArg);
const s = SPELLS[spellName]!;

await runScript(async ({ bot, sdk }) => {
    await prepare(sdk, bot);
    await freshKit(sdk, bot, s.staff);
    await cheat(sdk, '~clearbank');
    await cheat(sdk, `setstat magic ${s.level}`);
    for (const c of s.extra ?? []) await cheat(sdk, c);
    for (const [rune, n] of s.runes) await cheat(sdk, `give ${rune} ${n}`);
    const free = 28 - s.runes.length;
    const item = namePattern(s.item!);
    // stock the bank with CYCLES more inventories, then hold one
    let r = await bot.openBank();
    if (!r.success) throw new Error(`openBank: ${r.message}`);
    for (let i = 0; i < CYCLES; i++) {
        await cheat(sdk, `give ${s.item} ${free}`);
        await waitUntil(sdk, () => sdk.getInventory().some((x) => item.test(x.name)), 10, 'items given');
        const d = await bot.depositItem(item, -1);
        if (!d.success) throw new Error(`deposit: ${d.message}`);
    }
    await bot.closeBank();
    await cheat(sdk, `give ${s.item} ${free}`);
    await waitTicks(sdk, 3);
    const booth = sdk.findNearbyLoc(/bank booth/i)!;
    const bankOp = booth.optionsWithIndex.find((o) => /^bank$|use.quickly/i.test(o.text)) ?? booth.optionsWithIndex[0]!;
    log(sdk, `booth at (${booth.x},${booth.z}) dist ${booth.distance}, option ${bankOp.text}/${bankOp.opIndex}; bank holds ${sdk.getBankItems().map((b) => `${b.name} x${b.count}`).join(', ')}`);

    const rec = xpRecorder(sdk, 'Magic');
    const castAll = async () => {
        let t = tick(sdk);
        while (true) {
            // two clicks per tick on different slots: the server takes at most one per p_delay
            // window (magic-cadence.ts), and the spare covers a click that misses its tick
            const next = sdk.getInventory().filter((x) => item.test(x.name)).slice(0, 2);
            if (next.length === 0) return;
            await Promise.all(next.map((x) => sdk.sendSpellOnItem(x.slot, s.com)));
            t = await nextTick(sdk, t);
        }
    };
    const gaps: number[] = [];
    const t0 = tick(sdk);
    for (let c = 0; c <= CYCLES; c++) {
        await castAll();
        // wait for the last cast's xp
        await waitUntil(sdk, () => !sdk.getInventory().some((x) => item.test(x.name)), 10, 'last cast');
        if (c === CYCLES) break;
        const tb = tick(sdk);
        if (mode === 'stock') {
            // the stock helper's booth click is dropped while the last cast's p_delay holds
            // (OpLocHandler), and it then waits out its own timeout; retry like a stock bot would
            for (let a = 0; ; a++) {
                r = await bot.openBank(3000);
                if (r.success) break;
                if (a === 3) throw new Error(`openBank: ${r.message}`);
            }
            const d = await bot.depositItem(/ring of wealth|amulet of glory|ring of|amulet of/i, -1);
            if (!d.success) throw new Error(`deposit: ${d.message}`);
            const w = await bot.withdrawItem(item, -1);
            // withdraw-all reports "x26 of N requested" as a failure when the bank holds more
            if (!sdk.getInventory().some((x) => item.test(x.name))) throw new Error(`withdraw: ${w.message}`);
            await bot.closeBank();
        } else {
            // One decision per server tick from the latest state: open, then deposit+withdraw+close.
            let t = tick(sdk);
            const steps: string[] = [];
            for (let guard = 0; guard < 30; guard++) {
                const have = sdk.getInventory().some((x) => item.test(x.name));
                const open = sdk.isBankOpen();
                if (have && !open) break;
                if (have && open) {
                    steps.push(`${tick(sdk) - tb}:close`);
                    await sdk.sendCloseModal();
                } else if (!open) {
                    steps.push(`${tick(sdk) - tb}:booth`);
                    await sdk.sendInteractLoc(booth.x, booth.z, booth.id, bankOp.opIndex);
                } else {
                    // Blind: the target jewellery is bank slot 0 (the bank was cleared, then stocked
                    // with it first), so do not wait for the SDK to publish the bank's contents,
                    // which lags the open by 1-2 ticks.
                    const out = sdk.getInventory().find((x) => !item.test(x.name) && x.count === 1 && !/staff/i.test(x.name));
                    steps.push(`${tick(sdk) - tb}:dep+wd+close`);
                    await Promise.all([out ? sdk.sendBankDeposit(out.slot, -1) : Promise.resolve(), sdk.sendBankWithdraw(0, -1), sdk.sendCloseModal()]);
                }
                t = await nextTick(sdk, t);
            }
            log(sdk, `   steps ${steps.join(' ')}`);
        }
        log(sdk, `cycle ${c}: bank part took ${tick(sdk) - tb} ticks as seen by the bot`);
        await sleep(1);
    }
    await waitTicks(sdk, 3);
    const gains = rec.gains(t0, tick(sdk));
    const all = gains.slice(1).map((g, i) => g.tick - gains[i]!.tick);
    // gap i is between cast i and cast i+1; the bank sits after every `free` casts
    // the CYCLES largest gaps are the bank visits
    const cut = [...all].sort((a, b) => b - a)[CYCLES - 1] ?? Infinity;
    const inner: number[] = [];
    for (const g of all) (g >= cut && gaps.length < CYCLES ? gaps : inner).push(g);
    const casts = gains.length;
    const span = gains.at(-1)!.tick - gains[0]!.tick;
    const hist = inner.reduce((m: Record<number, number>, g) => ((m[g] = (m[g] ?? 0) + 1), m), {});
    log(sdk, `mode=${mode} NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}: ${casts} casts in ${span} ticks (first to last cast); bank gaps (last cast to next first cast) ${JSON.stringify(gaps)} => overhead over a plain 3-tick cast ${JSON.stringify(gaps.map((g) => g - 3))}; in-inventory gaps ${JSON.stringify(hist)}`);
    rec.off();
}, { timeout: 30 * 60_000, printState: false });
