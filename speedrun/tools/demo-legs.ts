// Demo check of the level-free transition legs (STEP-MANIFEST.md entry 11, rs/198).
//
//   bun speedrun/tools/demo-legs.ts <bot> [--lent] [--exit-dungeon] [--withdraw-coins=N]
//
// The demo has no ::tele, so the legs run as one chain, each from where the one before ended:
// T01-02 from the Lumbridge spawn, then T23-24, S24's L24a, L24b and L24c, T06-07 (its Falador
// teleport makes the start irrelevant) and T21-22 (likewise with the Lumbridge teleport). An
// untimed walk puts the player on each leg's start first, so each leg is measured exactly as on
// the lab (runLeg over lib/travel.ts). Pass: each leg within 10% of its lab mean
// (speedrun/README.md history; lab/measure-legs.ts), and never less than a tick.
//
// Before the chain, untimed and logged as `prep` lines, as `planPrep` decides from the state at
// login: with --exit-dungeon, the way out of Taverley dungeon's dragon room by the dragons role's
// own route; coins from the bank the player stands at, only with --withdraw-coins, only when
// the runes still to buy cost more than the coins carried, and only with a bank in view; the
// runes still missing, exactly the chain's casts and nothing more, from the nearer of Aubury
// and Betty; then a Lumbridge teleport and a walk to the spawn. It sends only walks, door and
// ladder ops, a coin withdrawal, shop buys and teleports: no trades, drops or deposits.
//
// A throwaway by default: fleet names are refused unless --lent says the account was lent for
// this check by its owner (rs/41), whose procedure takes it off its role first.

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { closeSession, logoutClean, openSession, ROOT } from '../lib/session';
import { addRunes, hopNeeds, runesHeld, runTo, SPELLS, teleport, travel, type Rune, type Runes, type TravelSdk } from '../lib/travel';
import { waitUntil } from '../lib/wait';
import { chebyshev, invCount, pos, skillLevel } from '../lib/world';
import { legById, runLeg, TILES } from '../runner/legs';

const PROTECTED = /^(www_cairn_md|cairn_dot_md|cairn_h\d+|cairn_t\d+|cairn_mule\d|cairn_cam|cairn_md|cairn_amb)$/i;
const SCORED = /^(www_cairn_md|cairn_dot_md|cairn_md)$/i;

/** The lab means this check is held to (lab/measure-legs.ts). */
export const LAB_MEAN: Readonly<Record<string, number>> = {
    'T01-02': 50, 'T23-24': 91.5, 'L24a': 67.5, 'L24b': 54, 'L24c': 4.5, 'T06-07': 79, 'T21-22': 32.5,
};
/** Legs too short for 10% to exceed their own lab spread: the largest lab run's distance from the mean. */
const LAB_RANGE: Readonly<Record<string, number>> = { 'L24c': 1.5 };
export const CHAIN = ['T01-02', 'T23-24', 'L24a', 'L24b', 'L24c', 'T06-07', 'T21-22'] as const;

export function legPasses(id: string, ticks: number): boolean {
    const lab = LAB_MEAN[id]!;
    return Math.abs(ticks - lab) <= Math.max(lab * 0.1, LAB_RANGE[id] ?? 1);
}

/** speedrun/helpers/buyer.ts: both sell the four elemental runes; the nearer one is used. */
export const SHOPS = [
    { name: 'Aubury', npc: /^aubury$/i, stand: { x: 3253, z: 3401, tol: 3 } },
    { name: 'Betty', npc: /^betty$/i, stand: { x: 3013, z: 3258, tol: 3 } },
] as const;
/** What an elemental rune can cost on a drained shelf (h55 paid 182 for 9 at Aubury's, 02:14Z). */
export const COINS_PER_RUNE = 25;
/** Beyond this the spawn is reached by a Lumbridge teleport rather than a walk. */
const SPAWN_WALK = 40;
const UNDERGROUND_Z = 6400;

/** speedrun/helpers/dragons.ts on the fleet host (rs/223): DOOR_INSIDE to SAFE_TILE, never in an adult's leash. */
const SAFE_ROUTE = [
    [2923, 9803], [2922, 9803], [2921, 9803], [2920, 9803], [2919, 9803], [2918, 9803], [2917, 9803],
    [2916, 9804], [2915, 9805], [2914, 9806], [2913, 9807], [2912, 9808], [2911, 9809], [2910, 9810],
    [2909, 9810], [2908, 9810], [2907, 9810], [2906, 9810], [2905, 9810], [2904, 9810], [2903, 9810],
    [2902, 9810], [2901, 9810],
].map(([x, z]) => ({ x: x!, z: z! }));
const DUSTY_KEY_DOOR = { x: 2924, z: 9803 };
const LADDER_BOTTOM = { x: 2884, z: 9798 };

/** The runes the chain's own casts consume. */
export function chainRunes(): Runes {
    return CHAIN.reduce<Runes>((a, id) => addRunes(a, hopNeeds(legById(id).def.hops).runes), {});
}

export function bankInView(s: BotWorldState): boolean {
    return s.nearbyLocs.some(l => /^bank booth$/i.test(l.name) && l.distance <= 10) || s.nearbyNpcs.some(n => /^banker$/i.test(n.name) && n.distance <= 10);
}

export type PrepPlan =
    | { ok: true; spawnTeleport: boolean; buy: Partial<Record<Rune, number>>; withdraw: number; shop: string | null }
    | { ok: false; why: string };

/** What the prep must do from the state at login, or why the chain can't start; decided before any action. */
export function planPrep(s: BotWorldState, o: { withdrawCoins?: number } = {}): PrepPlan {
    const magic = skillLevel(s, 'magic');
    if (magic < SPELLS.falador.magic) return { ok: false, why: `Magic ${magic} is below ${SPELLS.falador.magic}` };
    const p = pos(s);
    const underground = p.z > UNDERGROUND_Z;
    const spawnTeleport = underground || chebyshev(p, TILES.lumbridgeSpawn) > SPAWN_WALK;
    const need = spawnTeleport ? addRunes(chainRunes(), SPELLS.lumbridge.runes) : chainRunes();
    const held = runesHeld(s);
    if (held.law < (need.law ?? 0)) return { ok: false, why: `${held.law} law runes, ${need.law} needed (neither shop sells law)` };
    const buy: Partial<Record<Rune, number>> = {};
    for (const r of ['air', 'water', 'earth', 'fire'] as const) if (held[r] < (need[r] ?? 0)) buy[r] = need[r]! - held[r];
    const units = Object.values(buy).reduce((a, n) => a + n, 0);
    if (!units) return { ok: true, spawnTeleport, buy, withdraw: 0, shop: null };
    const cost = units * COINS_PER_RUNE;
    const coins = invCount(s, /^coins$/i);
    let withdraw = 0;
    if (coins < cost) {
        if (!o.withdrawCoins) return { ok: false, why: `${coins} coins carried for ${units} runes (up to ${cost}); --withdraw-coins not given` };
        if (underground || !bankInView(s)) return { ok: false, why: `${coins} coins carried for ${units} runes (up to ${cost}) and no bank in view to withdraw from` };
        withdraw = Math.max(o.withdrawCoins, cost) - coins;
    }
    const shop = [...SHOPS].sort((a, b) => chebyshev(p, a.stand) - chebyshev(p, b.stand))[0]!.name;
    return { ok: true, spawnTeleport, buy, withdraw, shop };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const bot = args.find(a => !a.startsWith('--'));
    const lent = args.includes('--lent');
    const exitDungeon = args.includes('--exit-dungeon');
    const withdrawCoins = Number(args.find(a => a.startsWith('--withdraw-coins='))?.split('=')[1] ?? 0);
    if (!bot || SCORED.test(bot) || (PROTECTED.test(bot) && !lent)) {
        console.error('usage: demo-legs.ts <throwaway-bot> [--lent (a fleet account lent by its owner)] [--exit-dungeon] [--withdraw-coins=N]; never the scored account');
        process.exit(2);
    }
    const logPath = join(ROOT, 'speedrun', 'runs', `demo-legs-${bot}.jsonl`);
    mkdirSync(join(ROOT, 'speedrun', 'runs'), { recursive: true });
    const out = (v: Record<string, unknown>) => {
        const line = JSON.stringify({ at: new Date().toISOString(), bot, ...v });
        appendFileSync(logPath, line + '\n');
        console.log(line);
    };

    const session = await openSession(bot, { launch: true, readyTimeoutMs: 90_000 });
    const sdk = session.sdk as unknown as TravelSdk;
    const st = () => session.sdk.getState()!;
    const tick = () => st().tick;

    async function exitTheDungeon(): Promise<void> {
        const t0 = tick();
        const p = pos(sdk);
        if (p.x < DUSTY_KEY_DOOR.x) {
            // In the room: the role's route out, one walked tile per click.
            const route = [...SAFE_ROUTE].reverse();
            let i = route.reduce((b, t, j) => (chebyshev(t, p) < chebyshev(route[b]!, p) ? j : b), 0);
            for (; i < route.length; i++) {
                const t = route[i]!;
                for (let k = 0; k < 3 && chebyshev(pos(sdk), t) > 0; k++) {
                    await session.sdk.sendWalk(t.x, t.z, false);
                    await waitUntil(sdk, s => s.player?.worldX === t.x && s.player?.worldZ === t.z, { maxTicks: 4 });
                }
                if (chebyshev(pos(sdk), t) > 0) throw new Error(`exit: route step to ${t.x},${t.z} failed at ${JSON.stringify(pos(sdk))}`);
            }
            const r = await travel(sdk, [{ kind: 'loc', loc: { x: DUSTY_KEY_DOOR.x, z: DUSTY_KEY_DOOR.z, name: /door|gate/i }, op: /^open$/i, arrive: { x: [DUSTY_KEY_DOOR.x, DUSTY_KEY_DOOR.x + 40], z: [9700, 9900] }, label: 'dusty-key door out' }]);
            if (!r.ok) throw new Error(`exit: ${r.reason}`);
        }
        const r = await travel(sdk, [
            { kind: 'run', to: { ...LADDER_BOTTOM, tol: 2 } },
            { kind: 'loc', loc: { name: /ladder/i, radius: 6 }, op: /^climb-up$/i, arrive: { x: [2860, 2910], z: [3370, 3420] }, label: 'ladder up' },
        ], { bot: session.bot });
        if (!r.ok) throw new Error(`exit: ${r.reason}`);
        out({ prep: 'exit Taverley dungeon (not counted)', ticks: tick() - t0, segments: r.segments, at: pos(sdk) });
    }

    try {
        const s = st();
        out({ prep: 'login', at: pos(sdk), magic: skillLevel(s, 'magic'), hp: s.player?.hp, coins: invCount(s, /^coins$/i), runes: runesHeld(s), equipment: s.equipment.map(e => e.name), inventory: s.inventory.map(i => `${i.name} x${i.count}`) });
        const plan = planPrep(s, { withdrawCoins });
        out({ prep: 'plan', ...plan });
        if (!plan.ok) throw new Error(plan.why);
        if (pos(sdk).z > UNDERGROUND_Z) {
            if (!exitDungeon) throw new Error('underground: rerun with --exit-dungeon to leave by the dragons route');
            await exitTheDungeon();
        }
        if (plan.withdraw > 0) {
            const t0 = tick();
            const open = await session.bot.openBank();
            if (!open.success) throw new Error(`bank: ${open.message}`);
            const w = await session.bot.withdrawItem(/^coins$/i, plan.withdraw);
            await session.bot.closeBank();
            out({ prep: 'coins from the bank (not counted)', ticks: tick() - t0, withdrew: plan.withdraw, ok: w.success, message: w.message, coins: invCount(st(), /^coins$/i) });
        }
        if (plan.shop) {
            const t0 = tick();
            const shop = SHOPS.find(x => x.name === plan.shop)!;
            const w = await runTo(sdk, shop.stand, { bot: session.bot });
            if (!w.ok) throw new Error(`walk to ${shop.name}: ${w.reason}`);
            const open = await session.bot.openShop(shop.npc);
            if (!open.success) throw new Error(`${shop.name}'s shop: ${open.message}`);
            const bought: Record<string, number> = {};
            for (const [r, n] of Object.entries(plan.buy)) {
                const res = await session.bot.buyFromShop(new RegExp(`^${r} rune$`, 'i'), n);
                bought[r] = res.amountBought ?? (res.success ? n : 0);
            }
            await session.sdk.sendCloseModal();
            out({ prep: `runes at ${shop.name}'s (not counted)`, ticks: tick() - t0, bought });
        }
        {
            const t0 = tick();
            const spawn = { ...TILES.lumbridgeSpawn, tol: 0 };
            if (chebyshev(pos(sdk), spawn) > SPAWN_WALK) {
                const t = await teleport(sdk, 'lumbridge');
                if (!t.ok) throw new Error(`prep Lumbridge teleport: ${t.reason}`);
            }
            const w = await runTo(sdk, spawn, { bot: session.bot });
            if (!w.ok) throw new Error(`walk to the spawn: ${w.reason}`);
            out({ prep: 'to the Lumbridge spawn (not counted)', ticks: tick() - t0, at: pos(sdk) });
        }
        let pass = true;
        for (const id of CHAIN) {
            const l = legById(id);
            const start = l.def.start;
            // A leg that opens with a teleport starts wherever the player stands (T06-07 and T21-22
            // start in altar rooms this chain never visits).
            if (l.def.hops[0]?.kind !== 'teleport' && chebyshev(pos(sdk), start) > (start.tol ?? 0) + 1) {
                const w = await runTo(sdk, { ...start, tol: (start.tol ?? 0) + 1 }, { bot: session.bot });
                if (!w.ok) throw new Error(`untimed walk to ${id}'s start failed: ${w.reason}`);
            }
            const r = await runLeg(l.def, { sdk: session.sdk, bot: session.bot });
            if (!r) throw new Error(`${id}: already at the destination`);
            const lab = LAB_MEAN[id]!;
            const ok = legPasses(id, r.ticks);
            pass &&= ok;
            out({ leg: id, ticks: r.ticks, lab, deltaPct: Math.round(((r.ticks - lab) / lab) * 1000) / 10, ok, segments: r.segments, doors: r.doors, clicks: r.clicks, tiles: r.tiles, ...(r.fellBack ? { fellBack: r.fellBack } : {}) });
        }
        out({ summary: pass ? 'pass' : 'fail' });
    } catch (e) {
        out({ error: e instanceof Error ? e.message : String(e), at: pos(sdk) });
        process.exitCode = 1;
    } finally {
        out({ logout: await logoutClean(session).catch(e => `logout failed: ${e instanceof Error ? e.message : String(e)}`) });
        await closeSession(session);
    }
}

if (import.meta.main) await main();
