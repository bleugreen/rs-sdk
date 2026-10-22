// Return kit items to their giver after a rehearsal row is stamped (a later login no longer moves
// the row: a hiscore stamp moves only when a level is gained).
//
//   bun speedrun/tools/kit-return.ts <account> --to=<giver> --items=rune_axe:1[,item:n...] [--at=3222,3222] [--client=lite]
//
// The account's tab must already be in game (tab-login.ts); this attaches through the gateway in
// bots/<account>/bot.env. Rehearsal accounts are combat 3 with 10 hitpoints, so it never walks
// one far (rs/296 lost a kit walking cairn_rocks from Ardougne toward Lumbridge):
//
// - Within MEET_RADIUS (30) tiles of `--at` (the giver's tile, Lumbridge castle by default), and on
//   the same level, it runs there.
// - Farther away it first casts a standard teleport that lands within 30 tiles of `--at`, if the
//   account can cast one now (Magic level, runes, Wilderness level 20 or below), then runs the
//   short leg. This content has no home teleport, and a combat-3 account normally has Magic 1, so
//   in practice a far account is refused: it does not move, logs out, and exits 3 with the
//   distance and each teleport's refusal. Move the giver to a safe tile within 30 tiles of the
//   account and pass that tile as --at=x,z.
// - Every tick of the run is watched: the first hitpoint lost or hit taken halts the run where it
//   stands and skips the trade. Logout is refused for 16 ticks after a hit, and an aggressive NPC
//   keeps hitting an account that stands still, so it runs back once to where the run began (the
//   tiles it just crossed unhurt), logs out (logoutClean waits out the post-combat window) and
//   exits 4 naming the attacker. It never resumes the walk or retries.
//
// Then it opens the trade itself and offers exactly the listed items (debug names, as rehearse.ts
// --kit), retrying once if the first trade closes (a giver serves one request at a time), then
// logoutClean, confirmed by the page over CDP as tab-logout.ts does (--client=lite, the lab's
// runner: by logoutClean's own signal). Exit 0 only when the items left the pack and the account
// is out of game; 1 any other failure.

import type { BotWorldState } from '../../sdk/types';
import { parseKit } from '../rehearse';
import { closeSession, loadBotEnv, logoutClean, openSession, type ClientKind, type Session } from '../lib/session';
import { tabInGame } from '../lib/tab';
import { give } from '../lib/trade';
import { fmtTile, runTo, SPELLS, teleportRefusal, travel, wildernessLevel, type Hop, type Spell, type TravelSdk } from '../lib/travel';
import { sleep } from '../lib/wait';
import { chebyshev, pos, type StateLike } from '../lib/world';

/**
 * The longest walk to the giver, in tiles (Chebyshev). 30 tiles is about 15 ticks of running: from
 * Lumbridge castle's courtyard it stays within the castle grounds, the church and the general store,
 * where nothing hunts a combat-3 account, and a leg that short gives an attacker one or two hits
 * before the damage stop, where rs/296's 75-tick walk gave it a kill. It is also the jump
 * castTeleport counts as a landed teleport.
 */
export const MEET_RADIUS = 30;
/** The giver's default tile: Lumbridge castle courtyard, 4 tiles from the Lumbridge teleport landing. */
export const DEFAULT_GIVER_TILE = { x: 3222, z: 3222 } as const;

export const EXIT = { ok: 0, failed: 1, usage: 2, refused: 3, damaged: 4 } as const;

export type Approach =
    | { kind: 'walk'; distance: number }
    | { kind: 'teleport'; spell: Spell; distance: number }
    | { kind: 'refuse'; reason: string };

/** How to reach the giver at `at` from where the account stands: walk, teleport first, or refuse. */
export function planApproach(src: StateLike, at: { x: number; z: number; level?: number }, radius = MEET_RADIUS): Approach {
    const p = pos(src);
    const sameLevel = p.level === (at.level ?? 0);
    const distance = chebyshev(p, at);
    if (sameLevel && distance <= radius) return { kind: 'walk', distance };
    const wild = wildernessLevel(p);
    const where = `${fmtTile(p)}${wild ? ` (Wilderness level ${wild})` : ''} is ${sameLevel ? `${distance} tiles` : `on level ${p.level}, ${distance} tiles`} from the giver at ${fmtTile(at)}`;
    const spells = (Object.keys(SPELLS) as Spell[])
        .filter(s => chebyshev(SPELLS[s].landing, at) <= radius)
        .sort((a, b) => chebyshev(SPELLS[a].landing, at) - chebyshev(SPELLS[b].landing, at));
    const refusals: string[] = [];
    for (const spell of spells) {
        const why = teleportRefusal(src, spell);
        if (!why) return { kind: 'teleport', spell, distance };
        refusals.push(`${spell} teleport: ${why}`);
    }
    const none = refusals.length ? refusals.join('; ') : `no standard teleport lands within ${radius} tiles of ${fmtTile(at)}`;
    return {
        kind: 'refuse',
        reason: `${where}, beyond the ${radius}-tile walk limit, and no teleport can be cast (${none}; this content has no home teleport). ` +
            `Not walking: move the giver to a safe tile within ${radius} tiles of the account and pass it as --at=x,z.`,
    };
}

export interface Damage {
    tick: number;
    hp: number;
    by: string;
}

/** Who hit the player: the damage event's source in view, else the nearest NPC in combat. */
export function attackerOf(s: BotWorldState, sinceTick: number): string {
    const ev = [...s.combatEvents].reverse().find(e => e.type === 'damage_taken' && e.tick > sinceTick);
    if (ev?.sourceType === 'npc') {
        const n = s.nearbyNpcs.find(x => x.index === ev.sourceIndex);
        if (n) return `${n.name} (level ${n.combatLevel}) at ${n.x},${n.z}`;
    }
    if (ev?.sourceType === 'other_player') {
        const pl = s.nearbyPlayers.find(x => x.index === ev.sourceIndex);
        if (pl) return `player ${pl.name} (level ${pl.combatLevel})`;
    }
    const n = s.nearbyNpcs.filter(x => x.inCombat).sort((a, b) => a.distance - b.distance)[0];
    if (n) return `${n.name} (level ${n.combatLevel}) at ${n.x},${n.z}`;
    return ev ? `${ev.sourceType} #${ev.sourceIndex} (not in view)` : 'an unseen source (no attacker in view)';
}

/**
 * A watch over published states from `start`: the first state that shows the player lost a
 * hitpoint, or took a hit of any size (a 0 is still an attack), after `start`'s tick.
 */
export function damageWatch(start: BotWorldState): (s: BotWorldState) => Damage | null {
    let hp = start.player?.hp ?? 0;
    const since = start.tick;
    return s => {
        const now = s.player?.hp;
        if (now === undefined) return null;
        const hit = s.combatEvents.some(e => e.type === 'damage_taken' && e.tick > since);
        if (now < hp || hit || s.player?.isDead) return { tick: s.tick, hp: now, by: attackerOf(s, since) };
        hp = Math.max(hp, now);
        return null;
    };
}

export interface ApproachResult {
    ok: boolean;
    plan: Approach;
    reason?: string;
    damage?: Damage;
    /** Where the run began, which it crossed unhurt: the account's tile, or the teleport's landing. */
    runFrom: { x: number; z: number };
}

/** Get to the giver's tile by `planApproach`, stopping on the first damage. Never retries. */
export async function approach(sdk: TravelSdk, at: { x: number; z: number }, opts: { radius?: number; log?: boolean } = {}): Promise<ApproachResult> {
    const s0 = sdk.getState();
    if (!s0?.player) return { ok: false, plan: { kind: 'refuse', reason: 'no player state' }, reason: 'no player state', runFrom: pos(sdk) };
    const plan = planApproach(s0, at, opts.radius);
    const p0 = pos(s0);
    const runFrom = plan.kind === 'teleport' ? { x: SPELLS[plan.spell].landing.x, z: SPELLS[plan.spell].landing.z } : { x: p0.x, z: p0.z };
    if (plan.kind === 'refuse') return { ok: false, plan, reason: plan.reason, runFrom };
    const watch = damageWatch(s0);
    let damage: Damage | null = null;
    const stopIf = (s: BotWorldState) => {
        damage ??= watch(s);
        return damage ? `took damage from ${damage.by} (hp ${damage.hp})` : null;
    };
    const run: Hop = { kind: 'run', to: { x: at.x, z: at.z, tol: 2 } };
    const hops: Hop[] = plan.kind === 'teleport' ? [{ kind: 'teleport', spell: plan.spell }, run] : [run];
    const r = await travel(sdk, hops, { walkOnRefusal: false, stopIf, log: opts.log ?? false });
    const hit = damage as Damage | null;
    return { ok: r.ok, plan, runFrom, ...(r.reason ? { reason: r.reason } : {}), ...(hit ? { damage: hit } : {}) };
}

export interface KitReturnOptions {
    giver: string;
    items: ReadonlyArray<{ name: string; amount: number }>;
    at: { x: number; z: number };
    radius?: number;
}

export interface KitReturnResult {
    /** One of EXIT. */
    code: number;
    approach?: ApproachResult;
    gave: boolean;
    logout: Awaited<ReturnType<typeof logoutClean>>;
}

const re = (n: string) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const held = (inv: ReadonlyArray<{ name: string; count: number }>, n: string) => inv.filter(i => re(n).test(i.name)).reduce((s, i) => s + Math.max(1, i.count), 0);

/** Approach, trade, then logoutClean (always). The caller confirms the logout on its own client. */
export async function kitReturn(session: Session, o: KitReturnOptions): Promise<KitReturnResult> {
    const { sdk } = session;
    const say = (m: string) => console.log(`[kit-return] ${m}`);
    const tick = () => sdk.getState()?.tick ?? -1;
    const here = () => fmtTile(pos(sdk));
    const before = Object.fromEntries(o.items.map(k => [k.name, held(sdk.getState()!.inventory, k.name)]));
    say(`${session.name}: in game at ${here()} (T${tick()}, hp ${sdk.getState()?.player?.hp}); holds ${JSON.stringify(before)}`);
    let code: number = EXIT.failed;
    let gave = false;
    let ap: ApproachResult | undefined;
    try {
        const missing = o.items.filter(k => before[k.name]! < k.amount);
        if (missing.length) throw new Error(`not holding ${missing.map(k => `${k.amount} ${k.name}`).join(', ')}`);
        ap = await approach(sdk as unknown as TravelSdk, o.at, { radius: o.radius, log: true });
        if (ap.plan.kind === 'refuse') {
            code = EXIT.refused;
            throw new Error(`REFUSED: ${ap.plan.reason}`);
        }
        if (ap.damage) {
            code = EXIT.damaged;
            say(`STOPPED at ${here()} (T${ap.damage.tick}): took damage from ${ap.damage.by}, hp ${ap.damage.hp}. No trade.`);
            // Logout is refused for COMBAT_LOGOUT_TICKS after a hit, and an aggressive NPC keeps
            // hitting an account that stands still: back off once over the tiles just crossed unhurt.
            const back = await runTo(sdk as unknown as TravelSdk, { ...ap.runFrom, tol: 1 }, { maxTicks: 60 });
            throw new Error(`retreated to ${here()} (T${tick()}, hp ${sdk.getState()?.player?.hp})${back.ok ? '' : ` short of ${fmtTile(ap.runFrom)}: ${back.reason}`}; logging out`);
        }
        if (!ap.ok) throw new Error(`${ap.plan.kind === 'teleport' ? `${ap.plan.spell} teleport, then ` : ''}run to ${fmtTile(o.at)}: ${ap.reason}`);
        say(`at ${here()} (T${tick()})${ap.plan.kind === 'teleport' ? ` by the ${ap.plan.spell} teleport` : ''}`);
        for (let attempt = 1; attempt <= 2 && !gave; attempt++) {
            const r = await give(sdk, o.giver, o.items.map(k => ({ item: re(k.name), n: k.amount })), { maxTicks: 60, openTimeoutMs: 45_000 });
            say(`trade ${attempt}: ${r.ok ? 'ok' : `failed (${r.reason})`}, ${r.ticks} ticks, gave ${JSON.stringify(r.gave)}`);
            gave = r.ok;
            if (!gave) await sdk.waitForTicks(3);
        }
        const after = Object.fromEntries(o.items.map(k => [k.name, held(sdk.getState()!.inventory, k.name)]));
        say(`holds after: ${JSON.stringify(after)}`);
        gave = gave && o.items.every(k => after[k.name] === before[k.name]! - k.amount);
        if (gave) code = EXIT.ok;
    } catch (err) {
        say((err as Error).message);
    }
    const logout = await logoutClean(session);
    if (!logout.ok) {
        say(`LOGOUT FAILED (${logout.reason})${code === EXIT.damaged ? `: the account may still be under attack at ${here()}, hp ${sdk.getState()?.player?.hp}. Act on the tab now.` : ''}`);
        if (code === EXIT.ok) code = EXIT.failed;
    }
    return { code, ...(ap ? { approach: ap } : {}), gave, logout };
}

function parseArgs(argv: readonly string[]) {
    const account = argv.find(a => !a.startsWith('--'));
    const opt = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const at = (opt('at') ?? `${DEFAULT_GIVER_TILE.x},${DEFAULT_GIVER_TILE.z}`).split(',').map(Number);
    const client = (opt('client') ?? 'browser') as ClientKind;
    const giver = opt('to');
    const items = opt('items');
    if (!account || !giver || !items || at.length !== 2 || at.some(n => !Number.isInteger(n)) || (client !== 'browser' && client !== 'lite')) return null;
    return { account, giver, items: parseKit(items), at: { x: at[0]!, z: at[1]! }, client };
}

if (import.meta.main) {
    const a = parseArgs(process.argv.slice(2));
    if (!a) {
        console.error('usage: bun speedrun/tools/kit-return.ts <account> --to=<giver> --items=item:n[,...] [--at=x,z] [--client=browser|lite]');
        process.exit(EXIT.usage);
    }
    const env = loadBotEnv(a.account);
    const session = await openSession(a.account, { client: a.client, pathfinding: true, readyTimeoutMs: 30_000 });
    const r = await kitReturn(session, { giver: a.giver, items: a.items, at: a.at });
    await closeSession(session);
    let outOfGame = r.logout.ok;
    if (a.client === 'browser') {
        const cdp = env.CDP_URL ?? process.env.SPEEDRUN_CDP_URL ?? 'http://127.0.0.1:9222';
        outOfGame = false;
        for (const t0 = Date.now(); Date.now() - t0 < 15_000; await sleep(300)) {
            if ((await tabInGame(cdp, env.BOT_USERNAME).catch(() => null)) === false) {
                outOfGame = true;
                break;
            }
        }
    }
    console.log(`[kit-return] ${env.BOT_USERNAME}: ${outOfGame ? 'logged out; out of game' : 'logout NOT confirmed: look at the tab before stopping Chrome'} (click on tick ${r.logout.clickTick})`);
    process.exit(outOfGame ? r.code : r.code === EXIT.ok ? EXIT.failed : r.code);
}
