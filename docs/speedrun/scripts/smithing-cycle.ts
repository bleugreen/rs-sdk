// Anvil smithing cadence and the anvil <-> bank cycle (docs/speedrun/skills/smithing.md).
//
//   bun docs/speedrun/scripts/smithing-cycle.ts <bot> [--site varrock|seers|yanille] [--bank fast|stock]
//       [--make 1|5|10] [--product adamant_platebody] [--level 99] [--cycles 4] [--stock 200]
//       [--run 0|1] [--minutes 12]
//
// Setup (staff cheats, untimed): sets Smithing to --level, banks the starter items, gives a
// hammer, stocks the bank with noted bars (::give cert_<bar>, then deposit-all, which un-notes
// them), and starts at the bank with the bank open.
//
// Timed loop, one cycle = withdraw bars -> walk to anvil -> smith the inventory -> walk to the
// booth -> open the bank -> deposit products. Every Smithing xp change is logged with the
// observed tick (state.tick advances once per server tick).
//
// --bank fast   raw packets at the 5-per-tick floor. On the observed tick the bank opens it
//               sends deposit-all(product), withdraw-all(bar) and, if leftover bars are already
//               in the inventory, use-bar-on-anvil, all in one tick. The booth click is re-sent
//               every tick from the last xp until the bank opens (clicks while delayed are
//               dropped by the server), so it lands on the first legal tick.
// --bank stock  the stock SDK porcelain: bot.openBank / depositItem / withdrawItem / closeBank,
//               then bot.smithAtAnvil per item (--make 1), or one use-bar + make-5/10 click
//               (--make 5|10), waiting for the porcelain's own completion checks.
// --make        smithing interface option: 1 (INV_BUTTON1), 5 (INV_BUTTON2), 10 (INV_BUTTON3).
//               With --make 1 in fast mode, use-bar-on-anvil is re-sent from the tick after
//               each xp until the interface reopens.
// --run 1       turns running on (IF_BUTTON controls:com_5, interface.pack 153) after setup.
import { readFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';

const argv = process.argv.slice(2);
function arg(name: string, def: string): string {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : def;
}

const SITE = arg('site', 'varrock');
const BANK = arg('bank', 'fast');
const MAKE = Number(arg('make', '5'));
const PRODUCT = arg('product', 'adamant_platebody');
const LEVEL = Number(arg('level', '99'));
const CYCLES = Number(arg('cycles', '4'));
const STOCK = Number(arg('stock', '200'));
const RUN = arg('run', '0') === '1';

const ROOT = join(import.meta.dir, '../../..');
const CONTENT = join(ROOT, 'server/content/scripts/skill_smithing/configs/smithing');
const ANVIL_ID = 2783; // loc.pack: 2783=anvil
const BOOTH_ID = 2213; // loc.pack: 2213=bankbooth
const SMITHING_IF = 994;
const COLUMN_BASE = 1119; // interface.pack: 1119=smithing:column1 .. 1123=column5

// Anvil per site: the anvil with the shortest walk to a booth (smithing-anvils.ts).
const SITES: Record<string, { tele: [number, number]; anvil: [number, number] }> = {
    varrock: { tele: [3185, 3436], anvil: [3188, 3426] },
    seers: { tele: [2722, 3493], anvil: [2713, 3492] },
    yanille: { tele: [2613, 3091], anvil: [2613, 3081] },
};

// ---- content tables (read from the repo so the script follows the content) ----
type Row = { name: string; level: number; bar: string; bars: number; xp: number; com: number; slot: number };
const XP_PER_BAR: Record<string, number> = {};
{
    let cur: Record<string, string> = {};
    const flush = () => { if (cur.namedobj) XP_PER_BAR[cur.namedobj] = Number(cur.xpperbar) / 10; };
    for (const l of readFileSync(join(CONTENT, 'smithing.struct'), 'utf8').split('\n')) {
        if (l.startsWith('[')) { flush(); cur = {}; }
        const m = l.match(/^param=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flush();
}
const SLOT_OF = new Map<string, { com: number; slot: number }>();
{
    let inv = '';
    for (const l of readFileSync(join(CONTENT, 'smithing.inv'), 'utf8').split('\n')) {
        const h = l.match(/^\[smithing_[a-z]+(\d)\]$/);
        if (h) { inv = h[1]!; continue; }
        if (l.startsWith('[')) { inv = ''; continue; }
        const m = l.match(/^stock(\d+)=(\w+),/);
        if (m && inv) SLOT_OF.set(m[2]!, { com: COLUMN_BASE + Number(inv) - 1, slot: Number(m[1]) - 1 });
    }
}
const ROWS: Row[] = [];
{
    let cur: Record<string, string> = {};
    let name = '';
    const flush = () => {
        const pos = SLOT_OF.get(name);
        if (!cur.bar || !pos) return;
        const bars = Number(cur.bar_amount);
        ROWS.push({ name, level: Number(cur.levelrequired), bar: cur.bar, bars, xp: bars * (XP_PER_BAR[cur.bar] ?? 0), ...pos });
    };
    for (const l of readFileSync(join(CONTENT, 'smithing.dbrow'), 'utf8').split('\n')) {
        const h = l.match(/^\[(\w+)\]$/);
        if (h) { flush(); cur = {}; name = h[1]!; continue; }
        const m = l.match(/^data=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flush();
}
const BAR_NAME: Record<string, RegExp> = {
    bronze_bar: /^bronze bar$/i, iron_bar: /^iron bar$/i, steel_bar: /^steel bar$/i,
    mithril_bar: /^mithril bar$/i, adamantite_bar: /^adamantite bar$/i, runite_bar: /^runite bar$/i,
};

// ---- helpers ----
function nextTick(sdk: any, after: number): Promise<BotWorldState> {
    return new Promise(resolve => {
        const cur = sdk.getState() as BotWorldState | null;
        if (cur && cur.tick > after) return resolve(cur);
        const off = sdk.onStateUpdate((s: BotWorldState) => { if (s.tick > after) { off(); resolve(s); } });
    });
}
async function waitTicks(sdk: any, n: number): Promise<BotWorldState> {
    let s = sdk.getState() as BotWorldState;
    const t = s.tick + n;
    while (s.tick < t) s = await nextTick(sdk, s.tick);
    return s;
}
const smithXp = (s: BotWorldState) => s.skills.find(k => k.name === 'Smithing')?.experience ?? 0;
const smithLevel = (s: BotWorldState) => s.skills.find(k => k.name === 'Smithing')?.baseLevel ?? 1;
const tele = (x: number, z: number) => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;
const cheb = (a: { x: number; z: number }, b: [number, number]) => Math.max(Math.abs(a.x - b[0]), Math.abs(a.z - b[1]));
const smithingOpen = (s: BotWorldState) => s.interface?.isOpen && s.interface.interfaceId === SMITHING_IF;
const countBars = (s: BotWorldState, bar: string) => s.inventory.filter(i => BAR_NAME[bar]!.test(i.name)).reduce((a, i) => a + i.count, 0);

function booth(s: BotWorldState, anvil: [number, number]): NearbyLoc | undefined {
    return s.nearbyLocs.filter(l => l.id === BOOTH_ID).sort((a, b) => cheb(a, anvil) - cheb(b, anvil))[0];
}
function anvilLoc(s: BotWorldState, at: [number, number]): NearbyLoc | undefined {
    return s.nearbyLocs.find(l => l.id === ANVIL_ID && l.x === at[0] && l.z === at[1]);
}
const bankOp = (l: NearbyLoc) => (l.optionsWithIndex.find(o => /^use-quickly$/i.test(o.text)) ?? l.optionsWithIndex.find(o => /^(bank|use)$/i.test(o.text)))?.opIndex ?? 1;

type Cycle = { start: number; xps: number[]; bankOpen: number; nextClick: number; product: string };

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const site = SITES[SITE];
    if (!site) throw new Error(`unknown site ${SITE}`);
    const row = ROWS.find(r => r.name === PRODUCT);
    if (!row) throw new Error(`unknown product ${PRODUCT}`);

    // ---- untimed setup ----
    await sdk.sendSay(`::setstat smithing ${LEVEL}`);
    await sdk.sendSay(tele(site.tele[0], site.tele[1]));
    await waitTicks(sdk, 4);
    const open = await bot.openBank();
    if (!open.success) throw new Error(`bank: ${open.message}`);
    for (const it of [...(sdk.getState() as BotWorldState).inventory]) {
        const cur = (sdk.getState() as BotWorldState).inventory.find(i => i.id === it.id);
        if (cur) await bot.depositItem(cur, -1);
    }
    await bot.closeBank();
    await sdk.sendSay('::give hammer 1');
    await sdk.sendSay(`::give cert_${row.bar} ${STOCK}`);
    // The run button's script starts with if_close (player_controls.rs2), so toggle it before
    // opening the bank.
    if (RUN) await sdk.sendClickComponent(153);
    await waitTicks(sdk, 2);
    await bot.openBank();
    for (const it of [...(sdk.getState() as BotWorldState).inventory]) {
        if (/hammer/i.test(it.name)) continue;
        await bot.depositItem(it, -1);
    }
    if ((sdk.getState() as BotWorldState).bank.noteMode) await sdk.sendClickComponent(5387);
    let s = await waitTicks(sdk, 2);
    console.log(`setup: level ${smithLevel(s)}, bank ${s.bank.items.map(i => `${i.name} x${i.count}`).join(', ')}; site ${SITE}, bank=${BANK}, make=${MAKE}, product=${PRODUCT}`);

    const optionFor = (m: number) => (m === 10 ? 3 : m === 5 ? 2 : 1);
    const cycles: Cycle[] = [];
    let lastXp = smithXp(s);
    const deadline = Date.now() + Number(arg('minutes', '12')) * 60_000;
    const done = () => cycles.length >= CYCLES || Date.now() > deadline;

    if (BANK === 'fast') {
        // Phases: bank (bank open: deposit/withdraw/use-bar) -> anvil (waiting for the smithing
        // interface) -> smith (counting xp) -> booth (re-clicking the booth until the bank opens).
        type Phase = 'bank' | 'anvil' | 'smith' | 'booth';
        let phase = 'bank' as Phase;
        let cyc: Cycle | null = null;
        let useSentTick = -99;
        let freeFrom = 0; // first observed tick on which a click can be legal
        let itemsLeftInClick = 0;
        let bankHandledTick = -1;
        let withdrawn = false;
        let newCycle = true;
        let progressTick = s.tick;
        let lastPhase: Phase = phase;
        while (!done()) {
            s = await nextTick(sdk, s.tick);
            if (phase !== lastPhase) { lastPhase = phase; progressTick = s.tick; }
            if (s.tick - progressTick > 120) {
                console.log(`STALL in phase ${phase} at tick ${s.tick}: pos ${s.player?.worldX},${s.player?.worldZ}, bank ${s.bank.isOpen}, if ${s.interface?.interfaceId}`);
                console.log(s.gameMessages.slice(-5).map(m => m.text).join(' | '));
                break;
            }
            const xp = smithXp(s);
            if (s.dialog.isOpen) sdk.sendClickDialog(0).catch(() => {});
            if (xp > lastXp) {
                cyc?.xps.push(s.tick);
                lastXp = xp;
                progressTick = s.tick;
                itemsLeftInClick--;
                if (phase === 'smith') {
                    const barsLeft = countBars(s, row.bar);
                    if (itemsLeftInClick <= 0 || barsLeft < row.bars) {
                        if (barsLeft >= row.bars) { phase = 'anvil'; useSentTick = -99; }
                        else phase = 'booth';
                        freeFrom = s.tick + 1;
                    }
                }
            }
            if (phase === 'booth' && s.tick >= freeFrom) {
                if (s.bank.isOpen) phase = 'bank';
                else {
                    const b = booth(s, site.anvil);
                    if (b) sdk.sendInteractLoc(b.x, b.z, b.id, bankOp(b)).catch(() => {});
                }
            }
            if (phase === 'bank' && !s.bank.isOpen && s.tick - progressTick > 5) phase = 'booth';
            if (phase === 'bank' && s.bank.isOpen && bankHandledTick !== s.tick) {
                // The bank inventory can arrive a tick after the modal: wait for it.
                if (!s.bank.items.length) continue;
                if (cyc && cyc.bankOpen < 0) cyc.bankOpen = s.tick;
                newCycle = true;
                // Deposit products (one deposit-all per item id).
                const seen = new Set<number>();
                let packets = 0;
                for (const it of s.inventory) {
                    if (seen.has(it.id) || /hammer/i.test(it.name) || BAR_NAME[row.bar]!.test(it.name)) continue;
                    seen.add(it.id);
                    sdk.sendBankDeposit(it.slot, -1).catch(() => {});
                    packets++;
                }
                const bi = s.bank.items.find(i => BAR_NAME[row.bar]!.test(i.name));
                if (!bi) { console.log(`out of ${row.bar}`); break; }
                if (!withdrawn || countBars(s, row.bar) < 27) {
                    sdk.sendBankWithdraw(bi.slot, -1).catch(() => {});
                    packets++;
                }
                withdrawn = true;
                bankHandledTick = s.tick;
                const leftover = s.inventory.find(i => BAR_NAME[row.bar]!.test(i.name));
                const a = anvilLoc(s, site.anvil);
                if (leftover && a && packets <= 3) {
                    sdk.sendUseItemOnLoc(leftover.slot, a.x, a.z, a.id).catch(() => {});
                    useSentTick = s.tick;
                } else useSentTick = -99;
                phase = 'anvil';
                freeFrom = s.tick + 1;
                continue;
            }
            if (phase === 'anvil') {
                if (smithingOpen(s)) {
                    if (newCycle) {
                        if (cyc) { cyc.nextClick = s.tick; cycles.push(cyc); }
                        cyc = { start: s.tick, xps: [], bankOpen: -1, nextClick: -1, product: row.name };
                        newCycle = false;
                    }
                    sdk.sendClickComponentWithOption(row.com, optionFor(MAKE), row.slot).catch(() => {});
                    itemsLeftInClick = MAKE;
                    phase = 'smith';
                } else if (s.tick >= freeFrom && s.tick - useSentTick >= (MAKE === 1 ? 1 : 3)) {
                    const bar = s.inventory.find(i => BAR_NAME[row.bar]!.test(i.name));
                    const a = anvilLoc(s, site.anvil);
                    if (bar && a) {
                        sdk.sendUseItemOnLoc(bar.slot, a.x, a.z, a.id).catch(() => {});
                        useSentTick = s.tick;
                    }
                }
            }
        }
    } else {
        // Stock SDK porcelain.
        let started = false;
        while (!done()) {
            const cyc: Cycle = { start: -1, xps: [], bankOpen: -1, nextClick: -1, product: row.name };
            if (started) {
                const ob = await bot.openBank();
                if (!ob.success) throw new Error(`openBank: ${ob.message}`);
            }
            cyc.bankOpen = (sdk.getState() as BotWorldState).tick;
            for (const it of (sdk.getState() as BotWorldState).inventory) {
                if (/hammer/i.test(it.name) || BAR_NAME[row.bar]!.test(it.name)) continue;
                const cur = (sdk.getState() as BotWorldState).inventory.find(i => i.id === it.id);
                if (cur) await bot.depositItem(cur, -1);
            }
            const w = await bot.withdrawItem(BAR_NAME[row.bar]!, -1);
            if (!w.success && countBars(sdk.getState() as BotWorldState, row.bar) < row.bars) throw new Error(`withdraw: ${w.message}`);
            await bot.closeBank();
            started = true;
            const metal = row.name.split('_')[0]!;
            const what = row.name.slice(metal.length + 1).replace(/_/g, ' ');
            if (MAKE === 1) {
                while (countBars(sdk.getState() as BotWorldState, row.bar) >= row.bars) {
                    const r = await bot.smithAtAnvil(`${metal} ${what}`);
                    const t = (sdk.getState() as BotWorldState).tick;
                    if (cyc.start < 0) cyc.start = t;
                    if (!r.success) { console.log(`smithAtAnvil: ${r.message}`); break; }
                    cyc.xps.push(t);
                }
            } else {
                // The porcelain has no make-X; one use-bar + one make-X click, then wait for the xp.
                let st = sdk.getState() as BotWorldState;
                const bar = st.inventory.find(i => BAR_NAME[row.bar]!.test(i.name))!;
                const a = st.nearbyLocs.filter(l => l.id === ANVIL_ID).sort((x, y) => x.distance - y.distance)[0]!;
                await sdk.sendUseItemOnLoc(bar.slot, a.x, a.z, a.id);
                st = await sdk.waitForCondition(smithingOpen, 15000);
                await sdk.sendClickComponentWithOption(row.com, optionFor(MAKE), row.slot);
                cyc.start = st.tick;
                const want = Math.min(MAKE, Math.floor(countBars(st, row.bar) / row.bars));
                let x = smithXp(st);
                while (cyc.xps.length < want) {
                    st = await nextTick(sdk, st.tick);
                    if (st.dialog.isOpen) await sdk.sendClickDialog(0);
                    if (smithXp(st) > x) { x = smithXp(st); cyc.xps.push(st.tick); }
                }
            }
            cycles.push(cyc);
            if (cycles.length > 1) cycles[cycles.length - 2]!.nextClick = cyc.start;
        }
    }

    // ---- report ----
    const full = cycles.filter(c => c.nextClick > 0 && c.xps.length > 0);
    console.log('\ncycle  product              click  xp ticks after click        lastXp->bankOpen  bankOpen->nextClick  click->nextClick');
    for (const c of cycles) {
        const rel = c.xps.map(t => t - c.start).join(',');
        const last = c.xps[c.xps.length - 1] ?? c.start;
        const toBank = c.bankOpen < 0 ? '-' : String(c.bankOpen - last);
        const toAnvil = c.bankOpen < 0 || c.nextClick < 0 ? '-' : String(c.nextClick - c.bankOpen);
        console.log(`${String(cycles.indexOf(c)).padStart(5)}  ${c.product.padEnd(20)} ${String(c.start).padStart(5)}  ${rel.padEnd(28)} ${toBank.padStart(16)}  ${toAnvil.padStart(19)}  ${String(c.nextClick > 0 ? c.nextClick - c.start : '-').padStart(16)}`);
    }
    const gaps: Record<number, number> = {};
    for (const c of cycles) for (let i = 1; i < c.xps.length; i++) { const g = c.xps[i]! - c.xps[i - 1]!; gaps[g] = (gaps[g] ?? 0) + 1; }
    console.log(`\nwithin-cycle xp gap histogram: ${JSON.stringify(gaps)}`);
    if (full.length) {
        const per = full.map(c => c.nextClick - c.start);
        const lastToNext = full.map(c => c.nextClick - c.xps[c.xps.length - 1]!);
        console.log(`full cycles: ${full.length}; click->next click: ${per.join(' ')} (mean ${(per.reduce((a, b) => a + b, 0) / per.length).toFixed(2)})`);
        console.log(`items per cycle: ${full.map(c => c.xps.length).join(' ')}; last xp -> next make click: ${lastToNext.join(' ')}`);
    }
}, { timeout: 45 * 60_000 });
