// Mining at one site and banking the output: a markets method loop (docs/markets/phase2.md), run as
// a fleet Role. Used for the Shilo gem rocks, the Ardougne zoo iron cluster and the lone runite rock.
//
//   ROLE_OPTIONS='{"site":"shilo"}' bun markets/methods/mine.ts <account>
//
// One trip: mine the nearest live rock of the site until the pack is full, walk to the site's bank,
// deposit everything (the pickaxe is wielded), report the bank, walk back. `bankEvery: 0` never
// banks, for a respawn-bound rock whose pack takes hours to fill (runite).
//
// Rock respawn depends on the world's player count (player_count.rs2 `scale_by_playercount`), so a
// lab run emulates the demo's count (docs/markets/phase2.md 'Respawn'); the loop logs every respawn
// it sees, which is how a run proves which count the engine used.

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { depositAll } from '../../speedrun/lib/bank';
import { walkTo } from '../../speedrun/lib/act';
import { nextTick, waitTicks } from '../../speedrun/lib/wait';
import { runStandalone, type Role, type RoleContext } from '../../speedrun/helpers/role';

export interface Tile {
    x: number;
    z: number;
}

export interface Box {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

export interface MineSite {
    /** Live rock loc ids (server/content/pack/loc.pack). */
    rocks: readonly number[];
    /** The rocks' tiles: a rock outside it is not this site's. */
    box: Box;
    /** Where to stand when no rock is live, and the walk target from the bank. */
    stand: Tile;
    bank: Tile;
    /** Base respawn in ticks (mine.dbrow rock_respawnrate). */
    respawn: number;
}

/** Map spawns read from server/content/maps (file:line in docs/markets/phase2.md). */
export const MINE_SITES: Record<'shilo' | 'iron' | 'runite' | 'coal', MineSite> = {
    // 7 gem rocks, m44_46 (2820-2825, 2998-3003); Shilo bank at 2852,2954.
    shilo: { rocks: [2111], box: { x0: 2818, x1: 2827, z0: 2996, z1: 3005 }, stand: { x: 2822, z: 3001 }, bank: { x: 2851, z: 2956 }, respawn: 200 },
    // 6 iron rocks south of the Ardougne zoo (mining.md section 4); Ardougne south bank.
    iron: { rocks: [2092, 2093], box: { x0: 2598, x1: 2609, z0: 3229, z1: 3240 }, stand: { x: 2603, z: 3235 }, bank: { x: 2654, z: 3285 }, respawn: 20 },
    // The lone runite rock in map square 47_160 (3046,10265), the Lava Maze dungeon (Wilderness).
    runite: { rocks: [2106, 2107], box: { x0: 3044, x1: 3048, z0: 10263, z1: 10267 }, stand: { x: 3046, z: 10264 }, bank: { x: 3093, z: 3491 }, respawn: 2400 },
    // Mining Guild coal (37 rocks), Falador east bank, for the steel loop's coal side.
    coal: { rocks: [2096, 2097], box: { x0: 3026, x1: 3056, z0: 9730, z1: 9756 }, stand: { x: 3042, z: 9740 }, bank: { x: 3013, z: 3357 }, respawn: 100 }
};

const inBox = (b: Box, x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** player_count.rs2 `scale_by_playercount`: base x (4000 - min(players, 2000)) / 4000, truncated. */
export function respawnTicks(base: number, players: number): number {
    return Math.floor((base * (4000 - Math.min(players, 2000))) / 4000);
}

/**
 * The rock to mine next: a live site rock, preferring one with no other player beside it (a player
 * already swinging usually wins it), then the nearest. Null when none is live.
 */
export function chooseRock<L extends Pick<NearbyLoc, 'id' | 'x' | 'z' | 'distance' | 'reachable'>>(locs: readonly L[], site: Pick<MineSite, 'rocks' | 'box'>, others: readonly Tile[]): L | null {
    let best: L | null = null;
    let bestScore = Infinity;
    for (const l of locs) {
        if (!site.rocks.includes(l.id) || !inBox(site.box, l.x, l.z) || l.reachable === false) continue;
        const crowd = others.filter(p => cheb(p, l) <= 1).length;
        const score = l.distance + crowd * 20;
        if (score < bestScore) {
            bestScore = score;
            best = l;
        }
    }
    return best;
}

/**
 * Watches the site's rock tiles tick by tick and records each depleted-to-live interval: the
 * respawn the engine actually used. A tile is live when a site rock id stands on it. Tiles seen
 * live at least once are tracked; an interval counts only when both ends were observed.
 */
export class RespawnTracker {
    private readonly deadSince = new Map<string, number>();
    private readonly known = new Set<string>();
    readonly samples: number[] = [];
    /** Depletions seen (any player's). */
    depletions = 0;

    update(tick: number, live: ReadonlySet<string>, inView: (tile: string) => boolean): void {
        for (const t of live) {
            this.known.add(t);
            const since = this.deadSince.get(t);
            if (since !== undefined && since >= 0) this.samples.push(tick - since);
            this.deadSince.delete(t);
        }
        for (const t of this.known) {
            if (live.has(t)) continue;
            if (!inView(t)) {
                // out of view: the interval's start or end would be a guess
                this.deadSince.set(t, -1);
                continue;
            }
            if (!this.deadSince.has(t)) {
                this.deadSince.set(t, tick);
                this.depletions++;
            }
        }
    }
}

interface Options {
    site: keyof typeof MINE_SITES;
    /** Bank when the pack holds this many items (28 = full); 0 never banks. */
    bankEvery: number;
    reportTicks: number;
}

function readOptions(raw: Record<string, unknown>): Options {
    const site = String(raw.site ?? 'shilo') as Options['site'];
    if (!(site in MINE_SITES)) throw new Error(`mine: unknown site ${site}`);
    const num = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d);
    return { site, bankEvery: num('bankEvery', 28), reportTicks: num('reportTicks', 1000) };
}

const tileKey = (x: number, z: number) => `${x},${z}`;

export class Miner {
    private readonly o: Options;
    private readonly site: MineSite;
    readonly respawns = new RespawnTracker();
    /** Items gained at the rocks, by inventory name. */
    readonly got: Record<string, number> = {};
    clicks = 0;
    lost = 0;
    banks = 0;
    waitTicks = 0;
    private startTick = 0;
    private lastReport = 0;

    constructor(private readonly ctx: RoleContext) {
        this.o = readOptions(ctx.options);
        this.site = MINE_SITES[this.o.site];
    }

    private get s(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private observe(s: BotWorldState): void {
        const live = new Set<string>();
        for (const l of s.nearbyLocs) if (inBox(this.site.box, l.x, l.z) && this.site.rocks.includes(l.id)) live.add(tileKey(l.x, l.z));
        // a depleted rock is another loc on the same tile: a known tile in view with no live rock is depleted
        const me = { x: s.player!.worldX, z: s.player!.worldZ };
        this.respawns.update(s.tick, live, t => {
            const [x, z] = t.split(',').map(Number);
            return cheb({ x: x!, z: z! }, me) <= 12;
        });
    }

    async run(): Promise<void> {
        this.startTick = this.lastReport = this.s.tick;
        this.ctx.log('start', { options: this.o, mining: this.s.skills.find(k => k.name === 'Mining')?.baseLevel });
        while (!this.ctx.signal.aborted) {
            const s = this.s;
            try {
                if (this.o.bankEvery > 0 && s.inventory.length >= this.o.bankEvery) await this.bank();
                else if (cheb({ x: s.player!.worldX, z: s.player!.worldZ }, this.site.stand) > 12) await this.walk(this.site.stand, 2);
                else await this.mineOne();
            } catch (err) {
                this.ctx.log('errand error', { error: String(err) });
                await waitTicks(this.ctx.sdk, 5);
            }
            if (this.s.tick - this.lastReport >= this.o.reportTicks) this.report('progress');
        }
        this.report('stop');
    }

    private async walk(t: Tile, tol: number): Promise<void> {
        const r = await walkTo(this.ctx.bot, this.ctx.sdk, t.x, t.z, tol);
        if (!r.ok) this.ctx.log('walk failed', { to: t, message: r.message });
    }

    private async bank(): Promise<void> {
        await this.walk(this.site.bank, 2);
        const opened = await this.ctx.bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        const d = await depositAll(this.ctx.sdk);
        if (!d.ok) this.ctx.log('deposit incomplete', { reason: d.reason, remaining: d.remaining.map(i => i.name) });
        this.banks++;
        this.ctx.reportBank({ items: this.ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
        await this.ctx.bot.closeBank();
        this.report('banked');
    }

    private counts(s: BotWorldState): Map<string, number> {
        const m = new Map<string, number>();
        for (const i of s.inventory) m.set(i.name, (m.get(i.name) ?? 0) + i.count);
        return m;
    }

    /** Mine one rock until it yields, is depleted by someone else, or the click stops taking. */
    private async mineOne(): Promise<void> {
        const sdk = this.ctx.sdk;
        let s = this.s;
        this.observe(s);
        const others = (s.nearbyPlayers ?? []).map(p => ({ x: p.x, z: p.z }));
        const rock = chooseRock(s.nearbyLocs, this.site, others);
        if (!rock) {
            if (cheb({ x: s.player!.worldX, z: s.player!.worldZ }, this.site.stand) > 3) await this.walk(this.site.stand, 1);
            s = await nextTick(sdk, this.s.tick);
            this.waitTicks++;
            this.observe(s);
            return;
        }
        const op = rock.optionsWithIndex.find(o => /^mine$/i.test(o.text))?.opIndex ?? 1;
        const before = this.counts(s);
        const click = async () => {
            if (this.s.dialog.isOpen) await sdk.sendClickDialog(0);
            await sdk.sendInteractLoc(rock.x, rock.z, rock.id, op);
            this.clicks++;
        };
        await click();
        let still = 0;
        let reclicks = 0;
        let last = { x: s.player!.worldX, z: s.player!.worldZ };
        const deadline = s.tick + 300;
        while (!this.ctx.signal.aborted && s.tick < deadline) {
            s = await nextTick(sdk, s.tick);
            this.observe(s);
            const after = this.counts(s);
            let gained = false;
            for (const [name, n] of after) {
                const d = n - (before.get(name) ?? 0);
                if (d > 0) {
                    this.got[name] = (this.got[name] ?? 0) + d;
                    gained = true;
                }
            }
            if (gained) return;
            if (!s.nearbyLocs.some(l => l.x === rock.x && l.z === rock.z && l.id === rock.id)) {
                this.lost++;
                return;
            }
            if (s.dialog.isOpen) {
                await click();
                continue;
            }
            const p = { x: s.player!.worldX, z: s.player!.worldZ };
            const moving = p.x !== last.x || p.z !== last.z;
            last = p;
            if (!moving && (s.player?.animId ?? -1) === -1) still++;
            else still = 0;
            if (still >= 4) {
                if (++reclicks > 3) return;
                still = 0;
                await click();
            }
        }
    }

    report(message: string): void {
        const s = this.ctx.sdk.getState();
        this.lastReport = s?.tick ?? 0;
        const r = this.respawns.samples;
        this.ctx.log(message, {
            ticks: (s?.tick ?? 0) - this.startTick, got: this.got, clicks: this.clicks, lost: this.lost, banks: this.banks, waitTicks: this.waitTicks,
            depletions: this.respawns.depletions, respawnN: r.length, respawnMin: r.length ? Math.min(...r) : null, respawnMedian: r.length ? [...r].sort((a, b) => a - b)[r.length >> 1] : null,
            players: s?.nearbyPlayers?.length ?? 0
        });
    }
}

export const role: Role = {
    name: 'mine',
    produces: [/ore$/i, /^uncut /i, /^coal$/i],
    run: ctx => new Miner(ctx).run()
};

if (import.meta.main) await runStandalone(role);
