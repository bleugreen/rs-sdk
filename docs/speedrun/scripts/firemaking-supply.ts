#!/usr/bin/env bun
/**
 * Firemaking resupply lab: what one inventory refill costs the scored
 * account, in server ticks.
 *
 *   bun docs/speedrun/scripts/firemaking-supply.ts <bot> --mode=trade [--swap=1] [--helper=fmhelp] [--n=5]
 *   bun docs/speedrun/scripts/firemaking-supply.ts <bot> --mode=bank [--fast=0|1] [--n=5]
 *
 * trade: a helper (run with LAB_HELPERS=fmhelp; this script drives it as a
 *   child process with --role=helper) stands next to the scored account and
 *   sends the trade request first, as it would while the account is still
 *   lighting its last log. The account clicks trade back, then accepts each
 *   screen as soon as it can. Timed from the account's click to the items in
 *   its inventory. --swap=0: the helper hands over 27 magic logs into an
 *   inventory holding only a tinderbox. --swap=1 (pyre logs): the helper hands
 *   over 14 yew logs and 14 sacred oil(4) while the account hands back 14 yew
 *   pyre logs and 14 empty vials (two Offer-All clicks).
 * bank: Falador east bank. The account starts at (3019,3361), where the
 *   two-row snake of firemaking-line.ts ends, with only a tinderbox; it opens
 *   the nearest booth, withdraws all magic logs (27 fit), closes the bank and
 *   walks to (3019,3362), where the snake starts. --fast=0 uses the SDK's
 *   bot.openBank / bot.withdrawItem / bot.closeBank / sendWalk, each awaited.
 *   --fast=1 sends raw clicks reacting to every state update: booth op, then
 *   withdraw-All + close + walk in the tick the bank opens.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const BOT = argv.find(a => !a.startsWith('--')) ?? 'bot';
const ROLE = flag('role', 'main')!;
const MODE = flag('mode', 'trade')!;
const SWAP = flag('swap', '0') === '1';
const FAST = flag('fast', '0') === '1';
const N = Number(flag('n', '5'));
const HELPER = flag('helper', 'fmhelp')!;
const PARTNER = (flag('partner', '') ?? '').toLowerCase();
const MAIN_TILE: [number, number] = [3010, 3363];
const HELPER_TILE: [number, number] = [3011, 3363];
const tele = (x: number, z: number) => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;

await runScript(async ({ bot, sdk }) => {
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    const waitTicks = async (n: number) => { let t = sdk.getState()!.tick; for (let i = 0; i < n; i++) t = (await nextTick(t)).tick; };
    const until = async (pred: (s: BotWorldState) => boolean, max: number) => {
        let s = sdk.getState()!;
        for (let i = 0; i < max; i++) { if (pred(s)) return s; s = await nextTick(s.tick); }
        return pred(s) ? s : null;
    };
    const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});

    if (ROLE === 'helper') {
        await sdk.sendSay(tele(...HELPER_TILE)); await waitTicks(3);
        for (let i = 0; i < N; i++) {
            await sdk.sendSay('::~clearinv inv'); await waitTicks(1);
            if (SWAP) { await sdk.sendSay('::give yew_logs 14'); await waitTicks(1); await sdk.sendSay('::give sacred_oil4 14'); }
            else await sdk.sendSay('::give magic_logs 27');
            await waitTicks(2);
            const p = await until(s => s.nearbyPlayers.some(x => x.name.toLowerCase() === PARTNER), 100);
            if (!p) throw new Error('partner not nearby');
            await sdk.sendTradeRequest(p.nearbyPlayers.find(x => x.name.toLowerCase() === PARTNER)!.index);
            console.log(`HELPER request ${i} at ${sdk.getState()!.tick}`);
            const open = await until(s => s.trade?.isOpen === true && s.trade.screen === 'offer', 200);
            if (!open) throw new Error('trade never opened');
            const types = new Map<string, number>();
            for (const it of open.inventory) if (!types.has(it.name)) types.set(it.name, it.slot);
            for (const slot of types.values()) await sdk.sendOfferItem(slot, -1);
            // Accept once our whole offer is on the table and (swap) the partner's too;
            // any change to either side resets both accepts (trade.rs2).
            const want = SWAP ? 2 : 0;
            let s = await until(st => !st.trade?.isOpen || ((st.trade.myOffer.length ?? 0) >= (SWAP ? 28 : 27) && (st.trade.theirOffer.length ?? 0) >= (SWAP ? 28 : 0)), 60);
            void want;
            if (s?.trade?.isOpen) await sdk.sendAcceptTrade();
            s = await until(st => !st.trade?.isOpen || st.trade.screen === 'confirm' || !st.trade.myAccepted, 60);
            if (s?.trade?.isOpen && s.trade.screen === 'offer') { await sdk.sendAcceptTrade(); s = await until(st => !st.trade?.isOpen || st.trade.screen === 'confirm', 60); }
            if (s?.trade?.isOpen && s.trade.screen === 'confirm') await sdk.sendAcceptTrade();
            await until(st => !st.trade?.isOpen, 60);
            await waitTicks(10); // let the scored account reset its inventory first
        }
        return;
    }

    const samples: object[] = [];
    if (MODE === 'trade') {
        await sdk.sendSay(tele(...MAIN_TILE)); await waitTicks(3);
        const me = sdk.getState()!.player!.name;
        const helper = Bun.spawn(['bun', import.meta.path, HELPER, '--role=helper', `--partner=${me}`, `--n=${N}`, `--swap=${SWAP ? 1 : 0}`], { stdout: 'inherit', stderr: 'inherit' });
        const want = SWAP ? /^yew logs$/i : /^magic logs$/i;
        for (let i = 0; i < N; i++) {
            // A request may arrive while the inventory is reset below; count it.
            const t00 = sdk.getState()!.tick;
            await sdk.sendSay('::~clearinv inv'); await waitTicks(1);
            // Pyre-log making needs no tinderbox, so the swap uses all 28 slots.
            if (SWAP) { await sdk.sendSay('::give yew_logs_pyre 14'); await waitTicks(1); await sdk.sendSay('::give vial_empty 14'); }
            else await sdk.sendSay('::give tinderbox 1');
            await waitTicks(2);
            const req = await until(s => s.gameMessages.some(m => m.type === 4 && m.tick > t00 && /wishes to trade/i.test(m.text)), 300);
            if (!req) throw new Error('no trade request');
            await waitTicks(1);
            const hp = sdk.getState()!.nearbyPlayers.find(p => p.name.toLowerCase() === HELPER.toLowerCase())!;
            const t0 = sdk.getState()!.tick;
            await sdk.sendTradeRequest(hp.index);
            const open = await until(s => s.trade?.isOpen === true, 40);
            if (SWAP && open) {
                const types = new Map<string, number>();
                for (const it of open.inventory) if (!/tinderbox/i.test(it.name) && !types.has(it.name)) types.set(it.name, it.slot);
                for (const slot of types.values()) await sdk.sendOfferItem(slot, -1);
            }
            let s = await until(st => !!st.trade?.isOpen && st.trade.screen === 'offer' && st.trade.theirOffer.length >= (SWAP ? 28 : 27) && st.trade.partnerAccepted, 60);
            const offered = s;
            if (s) await sdk.sendAcceptTrade();
            s = await until(st => st.trade?.screen === 'confirm', 40);
            const conf = s;
            if (s) await sdk.sendAcceptTrade();
            const done = await until(st => !st.trade?.isOpen && count(st, want) >= (SWAP ? 14 : 27), 40);
            const sample = { trade: i, clickToOpen: open ? open.tick - t0 : null, openToOfferAccepted: open && offered ? offered.tick - open.tick : null, toConfirm: offered && conf ? conf.tick - offered.tick : null, confirmToItems: conf && done ? done.tick - conf.tick : null, clickToItems: done ? done.tick - t0 : null };
            console.log(JSON.stringify(sample)); samples.push(sample);
            await waitTicks(3);
        }
        await helper.exited;
    } else {
        const START: [number, number] = [3019, 3362], END: [number, number] = [3019, 3361];
        for (let i = 0; i < N; i++) {
            // setup (untimed): put 27 magic logs in the bank, return to the snake's end
            await sdk.sendSay('::~clearinv inv'); await waitTicks(1);
            await sdk.sendSay('::give magic_logs 27'); await waitTicks(2);
            await sdk.sendSay(tele(3013, 3356)); await waitTicks(3);
            const ob = await bot.openBank();
            if (!ob.success) throw new Error(`setup openBank: ${ob.message}`);
            await bot.depositItem(/magic logs/i, -1);
            await bot.closeBank();
            await sdk.sendSay('::give tinderbox 1');
            await sdk.sendSay(tele(...END)); await waitTicks(4);
            let s = sdk.getState()!;
            const t0 = s.tick;
            let opened: number | null = null, withdrawn: number | null = null;
            if (!FAST) {
                const r = await bot.openBank(); opened = sdk.getState()!.tick - t0;
                if (!r.success) throw new Error(r.message);
                await bot.withdrawItem(/magic logs/i, -1); withdrawn = sdk.getState()!.tick - t0;
                await bot.closeBank();
                await sdk.sendWalk(...START, true);
                s = (await until(st => st.player!.worldX === START[0] && st.player!.worldZ === START[1] && !st.bank.isOpen, 60))!;
            } else {
                const booth = s.nearbyLocs.filter(l => /bank booth/i.test(l.name) && l.optionsWithIndex.some(o => /^bank$|use.quickly/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
                const op = booth.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ?? booth.optionsWithIndex.find(o => /use.quickly/i.test(o.text))!;
                await sdk.sendInteractLoc(booth.x, booth.z, booth.id, op.opIndex);
                s = (await until(st => st.bank.isOpen && st.bank.items.some(b => /magic logs/i.test(b.name)), 60))!;
                opened = s.tick - t0;
                const item = s.bank.items.find(b => /magic logs/i.test(b.name))!;
                await Promise.all([sdk.sendBankWithdraw(item.slot, -1), sdk.sendCloseModal(), sdk.sendWalk(...START, true)]);
                s = (await until(st => count(st, /^magic logs$/i) >= 27, 20))!;
                withdrawn = s.tick - t0;
                s = (await until(st => st.player!.worldX === START[0] && st.player!.worldZ === START[1] && !st.bank.isOpen, 60))!;
            }
            const sample = { cycle: i, fast: FAST, booth: s ? undefined : null, opened, withdrawn, total: s ? s.tick - t0 : null, logs: s ? count(s, /^magic logs$/i) : null };
            console.log(JSON.stringify(sample)); samples.push(sample);
        }
    }
    const key = MODE === 'trade' ? 'clickToItems' : 'total';
    const xs = samples.map((x: any) => x[key]).filter((x: any) => typeof x === 'number') as number[];
    console.log(JSON.stringify({ mode: MODE, swap: SWAP, fast: FAST, n: xs.length, [key]: xs, mean: +(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(2), min: Math.min(...xs), max: Math.max(...xs) }));
}, { timeout: 0, printState: false });
