// Lab-only fixtures built on staff commands (::tele, ::give, ::setstat).
// Needs an engine started with LOCAL_STAFF_LEVEL=4 (lab.sh does this).
// Never imported by speedrun/lib: the scored run cannot use these.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { depositAll } from '../lib/bank';
import { matchesItem, type ItemPattern } from '../lib/items';
import type { Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { invCount, pos } from '../lib/world';
import { runSteps, type RunnerSession } from '../runner/step';
import { onTutorialIsland } from '../lib/world';
import { tutorialSkip } from '../skills/start';

type LabSdk = Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendSay'>;
type ClearSdk = LabSdk & Pick<BotSDK, 'sendDropItem' | 'sendUseEquipmentItem'>;

export const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
/** Next to Carla in West Ardougne: 10 pure continue pages, then a three-way choice. */
export const CARLA = { x: 2494, z: 3312 };

/** 28 distinct items that all have a noted form (cert_<name>). */
export const LAB_ITEMS = [
    'logs', 'oak_logs', 'willow_logs', 'maple_logs', 'yew_logs', 'copper_ore', 'tin_ore', 'iron_ore',
    'coal', 'gold_ore', 'mithril_ore', 'bronze_bar', 'iron_bar', 'steel_bar', 'raw_anchovies', 'raw_trout',
    'raw_salmon', 'bones', 'ball_of_wool', 'flax', 'uncut_sapphire', 'raw_shrimp', 'cow_hide', 'bow_string',
    'uncut_emerald', 'uncut_ruby', 'raw_lobster', 'leather',
] as const;

/** In-game names can differ from debug names (raw_shrimp is "Raw shrimps"), so match on a prefix. */
export function isLabItem(name: string, debugName: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm(name).startsWith(norm(debugName));
}

/** Send a staff command (`::cmd`; debugprocs take a `~`, as in `~clearinv inv`), then let `settleTicks` pass. */
export async function cheat(sdk: LabSdk, cmd: string, settleTicks = 0): Promise<void> {
    await sdk.sendSay('::' + cmd);
    if (settleTicks > 0) await waitTicks(sdk, settleTicks);
}

export function near(s: BotWorldState | null | undefined, x: number, z: number, r = 0): boolean {
    const p = s?.player;
    return !!p && Math.abs(p.worldX - x) <= r && Math.abs(p.worldZ - z) <= r;
}

/**
 * Leave Tutorial Island the way the run does, through S00's `tutorialSkip` (`[label,tutorial_complete]`
 * opens every side tab); a no-op once the account is off the island. Call it before staging an account
 * that may be on its first login on this engine's save data (a new name, a fresh checkout or engine).
 */
export async function leaveTutorial(session: RunnerSession, log: TickLog = TickLog.memory()): Promise<void> {
    if (!onTutorialIsland(session.sdk.getState()?.player)) return;
    await runSteps(session, [tutorialSkip], { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
}

/**
 * Staff-teleport to a tile. Refuses on Tutorial Island: a first login there hides every side tab
 * (tutorial.rs2 `start_tutorial`) and a teleport off never restores them, so the server then drops
 * every side-tab click (inventory ops, item use, spells, prayers: `Player.isComponentVisible`)
 * without a message, and a script that retries until the inventory changes counts the drops as ticks.
 */
export async function tele(sdk: LabSdk, x: number, z: number, level = 0): Promise<boolean> {
    const at = sdk.getState()?.player;
    if (at && onTutorialIsland(at)) {
        throw new Error(`tele to ${level},${x},${z} refused: the player is on Tutorial Island (at ${at.worldX},${at.worldZ}), where a teleport off leaves the side tabs hidden and the server silently ignores inventory ops. Leave through S00's tutorialSkip first: setup.ts leaveTutorial(session). See docs/speedrun/LAB.md, 'Staging a fresh account'.`);
    }
    if (near(sdk.getState(), x, z) && sdk.getState()?.player?.level === level) return true;
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const r = await waitUntil(sdk, s => near(s, x, z) && s.player?.level === level, { maxTicks: 20 });
    if (r.ok) await waitTicks(sdk, 3); // let the region and nearby entities load
    return r.ok;
}

/** `tele`, throwing when the player did not land on the tile. */
export async function mustTele(sdk: LabSdk, x: number, z: number, level = 0): Promise<void> {
    if (!(await tele(sdk, x, z, level))) throw new Error(`tele to ${level},${x},${z} did not land (at ${JSON.stringify(pos(sdk))})`);
}

const units = (s: BotWorldState | null) => (s?.inventory ?? []).reduce((a, i) => a + i.count, 0);

/**
 * Give each item (debug name) `n` times over, firing every command before
 * waiting. Done once the inventory holds at least one more unit per name (a
 * stack topped up adds units, not slots), or after a few ticks when it is full.
 */
export async function give(sdk: LabSdk, names: string | readonly string[], n = 1): Promise<void> {
    const list = typeof names === 'string' ? [names] : names;
    const before = units(sdk.getState());
    await Promise.all(list.map(name => cheat(sdk, `give ${name} ${n}`)));
    await waitUntil(sdk, s => units(s) >= before + list.length, { maxTicks: Math.ceil(list.length / 2) + 10 });
    await waitTicks(sdk, 1);
}

/** `::give` the missing units of an item unless the inventory already holds `n` (matched by `display`). */
export async function ensureItem(sdk: LabSdk, obj: string, display: ItemPattern, n = 1): Promise<void> {
    const have = invCount(sdk, display);
    if (have >= n) return;
    await cheat(sdk, `give ${obj} ${n - have}`);
    await waitUntil(sdk, s => invCount(s, display) >= n, { maxTicks: 10 });
}

export async function setstat(sdk: LabSdk, skill: string, level: number): Promise<void> {
    await cheat(sdk, `setstat ${skill} ${level}`);
    await waitTicks(sdk, 1);
}

/** Set several stats, firing every command before waiting (the server takes 5 per tick). */
export async function setStats(sdk: LabSdk, stats: Record<string, number>): Promise<void> {
    const cmds = Object.entries(stats);
    await Promise.all(cmds.map(([k, v]) => cheat(sdk, `setstat ${k} ${v}`)));
    await waitTicks(sdk, Math.ceil(cmds.length / 5) + 1);
}

/** `::setvar` a varp or varbit (quest stages: `setvar grandtree 130`). */
export async function setvar(sdk: LabSdk, name: string, value: number): Promise<void> {
    await cheat(sdk, `setvar ${name} ${value}`, 1);
}

/** Read a varp or varbit with `::getvar` (reply "get <name>: <value>"); null when no reply arrives. */
export async function getvar(sdk: LabSdk, name: string, maxTicks = 10): Promise<number | null> {
    const t0 = sdk.getState()?.tick ?? 0;
    const re = new RegExp(`^get ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (-?\\d+)$`, 'i');
    const key = (m: BotWorldState['gameMessages'][number]) => JSON.stringify([m.tick, m.type, m.text]);
    const before = new Map<string, number>();
    for (const m of sdk.getState()?.gameMessages ?? []) before.set(key(m), (before.get(key(m)) ?? 0) + 1);
    const reply = (s: BotWorldState) => {
        const remaining = new Map(before);
        for (const m of s.gameMessages) {
            const k = key(m), old = remaining.get(k) ?? 0;
            if (old > 0) { remaining.set(k, old - 1); continue; }
            if (m.type !== 0 || m.tick < t0) continue;
            const match = re.exec(m.text);
            if (match) return match;
        }
        return null;
    };
    await sdk.sendSay(`::getvar ${name}`);
    const r = await waitUntil(sdk, s => !!reply(s), { maxTicks });
    const m = r.ok ? reply(r.state) : null;
    return m ? Number(m[1]) : null;
}

/**
 * Read several varps or varbits at once with `::getvar`, collecting the replies as they are published (the client
 * keeps only the last 50 game messages). A var with no reply within `maxTicks` is absent from the result: a
 * protected varp is not read while the player cannot act.
 */
export async function readVars(sdk: LabSdk, names: readonly string[], maxTicks = Math.ceil(names.length / 5) + 8): Promise<Map<string, number>> {
    const want = new Set(names.map(n => n.toLowerCase()));
    const got = new Map<string, number>();
    const t0 = sdk.getState()?.tick ?? 0;
    const see = (s: BotWorldState) => {
        for (const m of s.gameMessages) {
            if (m.type !== 0 || m.tick < t0) continue;
            const r = /^get (\S+): (-?\d+)$/.exec(m.text);
            if (r && want.has(r[1]!.toLowerCase())) got.set(r[1]!.toLowerCase(), Number(r[2]));
        }
    };
    const unsub = sdk.onStateUpdate(see);
    try {
        await Promise.all(names.map(n => sdk.sendSay(`::getvar ${n}`)));
        await waitUntil(sdk, s => (see(s), got.size >= want.size), { maxTicks });
    } finally {
        unsub();
    }
    return got;
}

/**
 * `::setvar` each var and confirm it with `::getvar`, re-sending those that did not take. The server refuses a set
 * on a protected varp while the player cannot act ("Please finish what you are doing first.", ClientCheatHandler
 * setvar), for example during a fade or a cutscene's delay, and says so only in a game message; an unchecked set
 * leaves the previous run's value behind. Throws if any var still differs after `rounds` rounds.
 */
export async function setVars(sdk: LabSdk, vars: Readonly<Record<string, number>>, rounds = 4): Promise<void> {
    let todo = Object.entries(vars);
    for (let round = 0; round < rounds && todo.length; round++) {
        if (round > 0) await waitTicks(sdk, 3);
        await Promise.all(todo.map(([k, v]) => cheat(sdk, `setvar ${k} ${v}`)));
        await waitTicks(sdk, Math.ceil(todo.length / 5) + 1);
        const got = await readVars(sdk, todo.map(([k]) => k));
        todo = todo.filter(([k, v]) => got.get(k.toLowerCase()) !== v);
    }
    if (todo.length) throw new Error(`setVars: still not set after ${rounds} rounds: ${todo.map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

/**
 * Empty the inventory and the worn slots: `::~clearinv` both, then unequip
 * and drop whatever is left (the debugproc alone is unreliable in this lab).
 */
export async function clearInventory(sdk: ClearSdk): Promise<void> {
    await cheat(sdk, '~clearinv inv');
    await cheat(sdk, '~clearinv worn', 2);
    for (let pass = 0; pass < 4; pass++) {
        const s = sdk.getState();
        if (!s || (s.inventory.length === 0 && s.equipment.length === 0)) return;
        await Promise.all(s.equipment.map(e => sdk.sendUseEquipmentItem(e.slot, 1).catch(() => undefined)));
        if (s.equipment.length) await waitTicks(sdk, 1);
        await Promise.all((sdk.getState()?.inventory ?? []).map(i => sdk.sendDropItem(i.slot).catch(() => undefined)));
        await waitTicks(sdk, 2);
    }
}

/** Drop every inventory item matching one of `patterns` (fired at once), and wait until they are gone. */
export async function dropMatching(sdk: ClearSdk, patterns: readonly ItemPattern[]): Promise<void> {
    const items = (sdk.getState()?.inventory ?? []).filter(i => patterns.some(p => matchesItem(i, p)));
    await Promise.all(items.map(i => sdk.sendDropItem(i.slot)));
    if (items.length) await waitUntil(sdk, s => !items.some(d => s.inventory.some(i => i.slot === d.slot && i.id === d.id)), { maxTicks: 10 });
}

/**
 * Stand in Varrock west bank with an empty inventory and a bank holding every
 * LAB_ITEMS item plus at least `ironOre` iron ore. Leaves the bank open.
 */
export async function bankFixture(session: Session, opts: { ironOre?: number } = {}): Promise<void> {
    const { sdk, bot } = session;
    if (!(await tele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('tele to Varrock west bank failed');
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    await depositAll(sdk);
    const banked = sdk.getState()!.bank.items;
    const missing = LAB_ITEMS.filter(n => !banked.some(i => isLabItem(i.name, n)));
    if (missing.length) {
        await give(sdk, missing);
        await depositAll(sdk);
    }
    const ore = sdk.getState()!.bank.items.find(i => i.name === 'Iron ore')?.count ?? 0;
    const want = opts.ironOre ?? 100;
    if (ore < want) {
        await give(sdk, ['cert_iron_ore'], want - ore);
        await depositAll(sdk);
    }
}
