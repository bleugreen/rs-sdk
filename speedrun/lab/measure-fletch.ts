// Headless-arrow production rate for the fletching supplier, on the lab.
//
//   WEB_PORT=9500 WEB_MANAGEMENT_PORT=9501 HISCORES_WEB_PORT=9502 NODE_PORT=44500 AGENT_PORT=8500 \
//     speedrun/lab/lab.sh fl_lab1 speedrun/lab/measure-fletch.ts:--logs=24
//
// Gives a knife, normal logs and feathers, then measures (1) cutting the logs
// into arrow shafts with the stock `bot.fletchLogs` (one log per call), (2) the
// same with the dialog's Make-10 button when it can be found, and (3)
// attaching feathers to shafts (15 per action) one awaited action per tick and
// as blind bursts of 5 per tick. Prints RESULT rows in ticks.
import { openSession } from '../lib/session';
import { nextTick, waitTicks } from '../lib/wait';
import { arg, botArg, result } from './common';
import { prepare } from '../helpers/wine-common';
import { give, tele } from './setup';

const name = botArg();
const logs = Number(arg('logs', '24'));
const s = await openSession(name);
const { sdk, bot } = s;
const tick = () => sdk.getState()!.tick;
const count = (re: RegExp) => sdk.getInventory().filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

// A fresh lab account starts on Tutorial Island, where item-on-item uses are blocked.
await prepare({ bot, sdk, log: (m, d) => console.log(m, JSON.stringify(d ?? {})) });
await tele(sdk, 2808, 3440); // Catherby bank, an open spot
// Start clean: drop nothing, just top up what the run needs.
if (count(/^knife$/i) === 0) await give(sdk, ['knife']);
await give(sdk, ['feather'], 5000);

async function cutStock(n: number) {
    await give(sdk, ['logs'], n);
    await nextTick(sdk);
    n = count(/^logs$/i);
    const t0 = tick();
    const shafts0 = count(/^arrow shaft$/i);
    let calls = 0;
    while (count(/^logs$/i) > 0) {
        const r = await bot.fletchLogs('arrow shaft');
        calls++;
        if (!r.success) {
            result('cut-stock-fail', { message: r.message, messages: sdk.getState()!.gameMessages?.slice(-5).map(m => m.text) });
            break;
        }
    }
    const ticks = tick() - t0;
    result('cut-stock', { logs: n, calls, ticks, shafts: count(/^arrow shaft$/i) - shafts0, ticksPerLog: +(ticks / n).toFixed(2) });
}

async function cutMake10(n: number) {
    await give(sdk, ['logs'], n);
    await nextTick(sdk);
    n = count(/^logs$/i);
    const t0 = tick();
    const shafts0 = count(/^arrow shaft$/i);
    let printed = false;
    let guard = 0;
    while (count(/^logs$/i) > 0 && guard++ < 40) {
        const knife = sdk.findInventoryItem(/^knife$/i)!;
        const log = sdk.findInventoryItem(/^logs$/i)!;
        await sdk.sendUseItemOnItem(knife.slot, log.slot);
        await sdk.waitForCondition(st => st.dialog.isOpen || !!st.interface?.isOpen, 5000).catch(() => null);
        const st = sdk.getState()!;
        if (!printed) {
            result('dialog', { dialog: st.dialog.options?.map(o => o.text), iface: st.interface?.options?.map(o => o.text) });
            printed = true;
        }
        const opts = st.dialog.options ?? [];
        // skill_multi3: per product the buttons are Make X / Make 10 / Make 5 / Make 1; shafts are product 1.
        // The labels carry non-ASCII spacing, so compare letters and digits only.
        const isMake10 = (t: string | undefined) => (t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'make10';
        const ten = opts.find(o => isMake10(o.text));
        if (!ten) { result('cut-make10-fail', { reason: 'no Make 10 option', codes: opts.map(o => [...(o.text ?? '')].map(c => c.charCodeAt(0))) }); return; }
        await sdk.clickDialogByText(new RegExp(`^${ten.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
        const before = count(/^logs$/i);
        await sdk.waitForCondition(st2 => st2.inventory.filter(i => /^logs$/i.test(i.name)).length <= Math.max(0, before - 10) || st2.inventory.every(i => !/^logs$/i.test(i.name)), 15000).catch(() => null);
        await waitTicks(sdk, 1);
    }
    const ticks = tick() - t0;
    result('cut-make10', { logs: n, ticks, shafts: count(/^arrow shaft$/i) - shafts0, ticksPerLog: +(ticks / n).toFixed(2) });
}

async function attach(mode: 'stock' | 'burst') {
    const t0 = tick();
    const h0 = count(/^headless arrow$/i);
    let actions = 0;
    while (count(/^arrow shaft$/i) > 0 && count(/^feather$/i) > 0) {
        const f = sdk.findInventoryItem(/^feather$/i)!;
        const a = sdk.findInventoryItem(/^arrow shaft$/i)!;
        if (mode === 'stock') {
            const before = count(/^headless arrow$/i);
            await sdk.sendUseItemOnItem(f.slot, a.slot);
            actions++;
            await sdk.waitForCondition(st => st.inventory.filter(i => /^headless arrow$/i.test(i.name)).reduce((x, i) => x + i.count, 0) > before, 3000).catch(() => null);
        } else {
            const left = Math.ceil(count(/^arrow shaft$/i) / 15);
            const n = Math.min(5, left);
            for (let i = 0; i < n; i++) void sdk.sendUseItemOnItem(f.slot, a.slot);
            actions += n;
            await nextTick(sdk);
        }
    }
    await waitTicks(sdk, 1);
    const ticks = tick() - t0;
    const made = count(/^headless arrow$/i) - h0;
    result(`attach-${mode}`, { actions, ticks, headless: made, perTick: +(made / Math.max(ticks, 1)).toFixed(1) });
}

await cutStock(Math.min(logs, 10));
await attach('stock');
await cutMake10(logs);
await attach('burst');
result('final', { inv: sdk.getInventory().map(i => `${i.name} x${i.count}`), fletching: sdk.getSkill('Fletching')?.baseLevel });
process.exit(0);
