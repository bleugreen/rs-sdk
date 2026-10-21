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
            const next = sdk.getInventory().find((x) => item.test(x.name));
            if (!next) return;
            await sdk.sendSpellOnItem(next.slot, s.com);
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
            r = await bot.openBank();
            if (!r.success) throw new Error(`openBank: ${r.message}`);
            const d = await bot.depositItem(/ring of wealth|amulet of glory|ring of|amulet of/i, -1);
            if (!d.success) throw new Error(`deposit: ${d.message}`);
            const w = await bot.withdrawItem(item, -1);
            if (!w.success) throw new Error(`withdraw: ${w.message}`);
            await bot.closeBank();
        } else {
            let t = tick(sdk);
            while (!sdk.isBankOpen()) {
                await sdk.sendInteractLoc(booth.x, booth.z, booth.id, bankOp.opIndex);
                t = await nextTick(sdk, t);
            }
            const out = sdk.getInventory().find((x) => !item.test(x.name) && x.count === 1 && !/staff/i.test(x.name));
            const bankSlot = sdk.getBankItems().find((b) => item.test(b.name));
            if (!out || !bankSlot) throw new Error(`bank state: out=${out?.name} bank=${bankSlot?.name}`);
            await Promise.all([sdk.sendBankDeposit(out.slot, -1), sdk.sendBankWithdraw(bankSlot.slot, -1), sdk.sendCloseModal()]);
            await waitUntil(sdk, () => sdk.getInventory().some((x) => item.test(x.name)) && !sdk.isBankOpen(), 10, 'restocked');
        }
        log(sdk, `cycle ${c}: bank part took ${tick(sdk) - tb} ticks as seen by the bot`);
        await sleep(1);
    }
    await waitTicks(sdk, 3);
    const gains = rec.gains(t0, tick(sdk));
    const all = gains.slice(1).map((g, i) => g.tick - gains[i]!.tick);
    for (const g of all) if (g > 4) gaps.push(g);
    const casts = gains.length;
    const span = gains.at(-1)!.tick - gains[0]!.tick;
    log(sdk, `mode=${mode} NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}: ${casts} casts in ${span} ticks (first to last cast); inventory-to-inventory gaps ${JSON.stringify(gaps)} => bank overhead ${JSON.stringify(gaps.map((g) => g - 3))} ticks; in-inventory gaps ${JSON.stringify(all.filter((g) => g <= 4).reduce((m: Record<number, number>, g) => ((m[g] = (m[g] ?? 0) + 1), m), {}))}`);
    rec.off();
}, { timeout: 30 * 60_000, printState: false });
