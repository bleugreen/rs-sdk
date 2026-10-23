// Lab rate harness for the markets method loops (docs/markets/methods.md).
//
//   NODE_TICKRATE=400 WEB_PORT=9920 ... speedrun/lab/lab.sh <bot> markets/methods/lab/rate.ts:--method=knight:--ticks=6000
//
// Stages the account by staff cheats (stats, quest varps, tools, a seeded bank), takes a bank
// snapshot, runs the method's Role for --ticks server ticks, then prints every bank snapshot the
// role reported and the trip summary (lines starting `RESULT`). A trip is the stretch between two
// bank snapshots, so it includes the bank run. Only the lab can stage this way: never point it at
// the demo.

import { hostname, loadavg } from 'os';
import { runScript } from '../../../sdk/runner';
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import type { Role, BankSnapshot } from '../../../speedrun/helpers/role';
import { memoryRoleState } from '../../../speedrun/helpers/role';
import { depositAll } from '../../../speedrun/lib/bank';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { holdings, span, summarize, trips, type BankSnap } from '../trips';
import { ARDOUGNE_SOUTH_BANK, SPOTS } from '../pickpocket';
import { CATHERBY_BANK } from '../fish';
import { MINE_SITES } from '../mine';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

interface Method {
    role: () => Promise<Role>;
    options: Record<string, unknown>;
    stats: Record<string, number>;
    varps?: Record<string, number>;
    /** Given into the pack (debug name, count). */
    inv?: Array<[string, number]>;
    /** Pack items to wield after the give (inventory names). */
    wear?: RegExp[];
    /** Seeded into the bank at `bank` (debug names; certs deposit as the item). */
    seed?: Array<[string, number]>;
    bank: Tile;
    /** Where the role starts. */
    at: Tile;
    /** 'first': the role banks first (food out), and trips start at its first snapshot. */
    baseline: 'stage' | 'first';
}

const arg = (name: string, d: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const num = (name: string, d: number) => Number(arg(name, String(d)));
const combat = { attack: 70, strength: 70, defence: 70 };

const pickpocket = (target: keyof typeof SPOTS): Method => ({
    role: async () => (await import('../pickpocket')).role,
    options: { target, foodPerTrip: num('foodPerTrip', 0), food: arg('food', 'Shark') },
    stats: { ...combat, thieving: num('thieving', 99), hitpoints: num('hp', 70) },
    seed: [[`cert_${arg('food', 'Shark').toLowerCase()}`, 1000]],
    bank: ARDOUGNE_SOUTH_BANK,
    at: ARDOUGNE_SOUTH_BANK,
    baseline: 'first'
});

const fishing = (c: string, tool: string): Method => ({
    role: async () => (await import('../fish')).role,
    // --keep=Raw bass|Oyster: drop the rest when the pack fills ('|'-separated: parallel.ts splits on ',')
    options: { catch: c, ...(arg('keep', '') ? { keep: arg('keep', '').split('|') } : {}) },
    stats: { fishing: num('fishing', 99) },
    inv: [[tool, 1]],
    bank: CATHERBY_BANK,
    at: CATHERBY_BANK,
    baseline: 'stage'
});

const smelterMine = (extra: Record<string, unknown>): Method => ({
    role: async () => (await import('../../../speedrun/helpers/smelter')).role,
    options: { mode: 'mine', pickaxe: false, buyOre: false, ...extra },
    stats: { ...combat, hitpoints: 70, mining: num('mining', 99) },
    inv: [['rune_pickaxe', 1]],
    wear: [/^rune pickaxe$/i],
    bank: { x: 3013, z: 3357 },
    at: { x: 3013, z: 3357 },
    baseline: 'stage'
});

const woodcut = (tree: string): Method => ({
    role: async () => (await import('../../../speedrun/helpers/woodcutter')).role,
    options: { tree, buyAxe: false, crossingHitpoints: 0, location: arg('location', '') },
    stats: { ...combat, hitpoints: 70, woodcutting: num('woodcutting', 99) },
    inv: [['rune_axe', 1]],
    wear: [/^rune axe$/i],
    bank: { x: 2725, z: 3491 },
    at: { x: 2725, z: 3491 },
    baseline: 'stage'
});

// markets/methods/mine.ts at one site: --mining (default 99), --pickaxe (debug name), --hp, --bankEvery
const mineAt = (site: 'shilo' | 'iron' | 'runite', varps?: Record<string, number>): Method => {
    const s = MINE_SITES[site];
    return {
        role: async () => (await import('../mine')).role,
        options: { site, bankEvery: num('bankEvery', site === 'runite' ? 0 : 28) },
        stats: { attack: num('combat', 70), strength: num('combat', 70), defence: num('combat', 70), hitpoints: num('hp', 70), mining: num('mining', 99) },
        varps,
        inv: [[arg('pickaxe', 'rune_pickaxe'), 1]],
        wear: [/pickaxe$/i],
        bank: s.bank,
        at: s.stand,
        baseline: 'stage'
    };
};

const METHODS: Record<string, () => Method> = {
    // Shilo Village complete (%zombiequeen 17, quest.constant ^zombiequeen_complete 15)
    shilo: () => mineAt('shilo', { zombiequeen: 17 }),
    iron: () => mineAt('iron'),
    runite: () => mineAt('runite'),
    // speedrun/helpers/smelter.ts smelt mode: steel bars from banked iron ore and coal, Falador west bank and furnace
    steel: () => ({
        role: async () => (await import('../../../speedrun/helpers/smelter')).role,
        options: { mode: 'smelt', steel: 1_000_000, buyOre: false, pickaxe: false },
        stats: { smithing: num('smithing', 99) },
        seed: [['cert_iron_ore', 3000], ['cert_coal', 6000]],
        bank: { x: 2946, z: 3369 },
        at: { x: 2946, z: 3369 },
        baseline: 'stage'
    }),
    knight: () => pickpocket('knight'),
    paladin: () => pickpocket('paladin'),
    hero: () => pickpocket('hero'),
    // the fleet's own earner (speedrun/helpers/coins.ts): kebab runs to Al-Kharid included
    guard: () => ({
        role: async () => (await import('../../../speedrun/helpers/coins')).role,
        options: { target: 'guard' },
        stats: { ...combat, thieving: num('thieving', 99), hitpoints: num('hp', 10) },
        inv: [['coins', 300], ['kebab', 24]],
        bank: { x: 3185, z: 3436 },
        at: { x: 3210, z: 3462 },
        baseline: 'stage'
    }),
    warrior: () => ({
        role: async () => (await import('../../../speedrun/helpers/coins')).role,
        options: { target: 'warrior' },
        stats: { ...combat, thieving: num('thieving', 99), hitpoints: num('hp', 10) },
        inv: [['coins', 300], ['kebab', 24]],
        bank: { x: 3270, z: 3167 },
        at: { x: 3293, z: 3172 },
        baseline: 'stage'
    }),
    essence: () => ({
        role: async () => (await import('../../../speedrun/helpers/essence')).role,
        options: {},
        stats: { ...combat, hitpoints: 70, mining: num('mining', 99) },
        varps: { runemysteries: 6 },
        inv: [['rune_pickaxe', 1]],
        wear: [/^rune pickaxe$/i],
        bank: { x: 3253, z: 3420 },
        at: { x: 3253, z: 3420 },
        baseline: 'stage'
    }),
    shark: () => fishing('shark', 'harpoon'),
    swordfish: () => fishing('swordfish', 'harpoon'),
    lobster: () => fishing('lobster', 'lobster_pot'),
    bass: () => fishing('bass', 'big_net'),
    yew: () => woodcut('yew'),
    magic: () => woodcut('magic'),
    coal: () => smelterMine({ tier: 'mithril', site: 'guild' }),
    adamant: () => smelterMine({ site: 'auto', addy: arg('addy', 'dwarven') }),
    alch: () => ({
        role: async () => (await import('../alch')).role,
        options: { item: arg('item', 'Iron bar'), spell: arg('spell', 'high') },
        stats: { magic: 99 },
        inv: [['staff_of_fire', 1], ['naturerune', 5000], [`cert_${arg('obj', 'iron_bar')}`, 5000]],
        wear: [/^staff of fire$/i],
        bank: { x: 3185, z: 3436 },
        at: { x: 3185, z: 3436 },
        baseline: 'stage'
    })
};

const bot = process.argv[2] ?? '';
const name = arg('method', '');
const ticks = num('ticks', 3000);
const tickMs = Number(process.env.NODE_TICKRATE ?? 400);
if (!bot || !METHODS[name]) {
    console.error(`usage: rate.ts <bot> --method=${Object.keys(METHODS).join('|')} [--ticks=3000] [--thieving=99 --hp=70 --foodPerTrip=0 ...]`);
    process.exit(2);
}
const m = METHODS[name]!();
const out = (tag: string, data: unknown) => console.log(`${tag} ${bot} ${name} ${JSON.stringify(data)}`);

async function bankSnap(sdk: BotSDK): Promise<BankSnap> {
    const s = sdk.getState()!;
    return { tick: s.tick, items: s.bank.items.map(i => ({ id: i.id, count: i.count })) };
}

async function stage(bot: BotActions, sdk: BotSDK): Promise<BankSnap> {
    await leaveTutorial({ sdk, bot, name: process.argv[2], sessionId: 0 } as never);
    await waitTicks(sdk, 2);
    await setStats(sdk, m.stats);
    for (const [k, v] of Object.entries(m.varps ?? {})) await setvar(sdk, k, v);
    await clearInventory(sdk);
    await mustTele(sdk, m.bank.x, m.bank.z, m.bank.level ?? 0);
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank at staging: ${opened.message}`);
    await depositAll(sdk);
    for (const [obj, n] of m.seed ?? []) {
        await cheat(sdk, `give ${obj} ${n}`);
        await waitUntil(sdk, s => s.inventory.length > 0, { maxTicks: 10 });
        await depositAll(sdk);
    }
    await waitTicks(sdk, 2);
    const snap = await bankSnap(sdk);
    await bot.closeBank();
    for (const [obj, n] of m.inv ?? []) await give(sdk, obj, n);
    for (const w of m.wear ?? []) {
        const it = sdk.getState()!.inventory.find(i => w.test(i.name));
        const op = it?.optionsWithIndex.find(o => /^(wield|wear)$/i.test(o.text));
        if (it && op) await sdk.sendUseItem(it.slot, op.opIndex);
        await waitTicks(sdk, 2);
    }
    if (m.at.x !== m.bank.x || m.at.z !== m.bank.z) await mustTele(sdk, m.at.x, m.at.z, m.at.level ?? 0);
    return snap;
}

await runScript(async ({ bot: actions, sdk }) => {
    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
    const staged = await stage(actions, sdk);
    const p = sdk.getState()!.player!;
    out('RESULT start', { host: hostname(), load: loadavg().map(l => +l.toFixed(1)), at: new Date().toISOString(), tickMs, ticks, options: m.options, stats: m.stats, pos: [p.worldX, p.worldZ], hp: p.maxHp });

    const snaps: BankSnap[] = m.baseline === 'stage' ? [staged] : [];
    // pack and worn slots: a tool moving between them (wielded, or left unwielded) must not count as output
    const inv = () => [...sdk.getState()!.inventory, ...(sdk.getState()!.equipment ?? [])].map(i => ({ id: i.id, count: i.count }));
    // Bank plus pack at each bank visit and at the stop: the whole-run rate (trips.ts holdings).
    const held: BankSnap[] = m.baseline === 'stage' ? [holdings(staged.tick, staged.items, inv())] : [];
    let lastBank = staged.items;
    const role = await m.role();
    const controller = new AbortController();
    const t0 = sdk.getState()!.tick, w0 = Date.now();
    const stop = sdk.onStateUpdate(s => {
        if (s.tick - t0 >= ticks && !controller.signal.aborted) controller.abort();
    });
    const running = role.run({
        bot: actions,
        sdk,
        account: bot,
        options: m.options,
        log: (message, data) => out('LOG', { tick: sdk.getState()?.tick, message, ...data }),
        reportBank: (b: BankSnapshot) => {
            const snap = { tick: sdk.getState()!.tick, items: b.items.map(i => ({ id: i.id, count: i.count })) };
            snaps.push(snap);
            lastBank = snap.items;
            held.push(holdings(snap.tick, snap.items, inv()));
            out('SNAP', snap);
        },
        signal: controller.signal,
        state: memoryRoleState()
    });
    await Promise.race([running.catch(e => out('LOG', { message: 'role threw', error: String(e) })), new Promise(r => controller.signal.addEventListener('abort', () => setTimeout(r, 60_000)))]);
    stop();
    const t1 = sdk.getState()!.tick, w1 = Date.now();
    const list = trips(snaps);
    out('RESULT trips', list.map(t => ({ ticks: t.ticks, board: t.board, delta: Object.fromEntries(t.delta) })));
    out('RESULT summary', { ranTicks: t1 - t0, msPerTick: +((w1 - w0) / Math.max(1, t1 - t0)).toFixed(1), ...summarize(list, tickMs) });
    if (held.length) {
        const run = span(held[0]!, holdings(t1, lastBank, inv()));
        out('RESULT run', { ...summarize([run], tickMs), fromTick: run.fromTick, toTick: run.toTick, delta: Object.fromEntries(run.delta), load: loadavg().map(l => +l.toFixed(1)) });
    }
}, { printState: false, onDisconnect: 'wait', reconnectTimeout: 120_000 });
process.exit(0);
