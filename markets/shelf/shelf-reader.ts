// Shelf reader: walks one account to a list of NPC shops, opens each, and writes
// every shelf item's stock count and prices, with the UTC time, as JSON lines.
// Read only: it never buys, sells, trades, drops or touches the Grand Exchange
// (read-only.ts). Notes and lab evidence: docs/markets/shelf-reader.md.
//
//   bun markets/shelf/shelf-reader.ts <account> [--stops a,b,c] [--out file.jsonl] [--repeat N --every TICKS]
//
// The account and host conventions are speedrun/helpers/role.ts runStandalone's:
// bots/<account>/bot.env with the account's lite client running, or
// HELPER_PATH=direct with BOT_USERNAME, PASSWORD and SERVER in the environment.
// Options may also come from ROLE_OPTIONS as JSON ({"stops":"aubury,betty"}).
//
// Per stop: walk there (toll gate, ships, the Ice Mountain trapdoor and the
// Ranging Guild door included), open the shop, record the shop line and one
// line per shelf slot, ask the server for each item's live price with the
// shop's Value option, close the shop. A stop it cannot afford the fare for, or
// whose requirement the account lacks (Dargaud: Ranged 40), is logged as
// skipped and the route moves on.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, ShopItem } from '../../sdk/types';
import { runStandalone, type Role, type RoleContext } from '../../speedrun/helpers/role';
import { sailTo, type Sailor } from '../../speedrun/lib/ships';
import { travelTo } from '../../speedrun/lib/toll-gate';
import { isUnderground } from '../../speedrun/lib/underground';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { onTutorialIsland } from '../../speedrun/lib/world';
import { readOnlyBot, readOnlySdk, SHOP_STOCK_COMPONENT, VALUE_OPTION } from './read-only';
import {
    type Entry,
    inRangingGuild,
    judgeStop,
    type Options,
    parseArgs,
    parseOptions,
    parseValueMessage,
    RANGING_GUILD_DOOR,
    type ShelfRecord,
    shelfRecords,
    type Stop,
    stopOf,
    type Tile,
    zoneOf
} from './stops';

/** Value clicks sent before waiting for their answers. */
const VALUE_BATCH = 5;
/** Ticks to wait for a batch's Value answers. */
const VALUE_WAIT_TICKS = 6;

class Aborted extends Error {}

/** markets/shelf/out/<account>-<UTC stamp>.jsonl, ignored by git. */
export function defaultOut(account: string, now = new Date()): string {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return join(resolve(import.meta.dir), 'out', `${account || 'account'}-${stamp}.jsonl`);
}

const lower = (s: string) => s.toLowerCase();
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const msgKey = (m: BotWorldState['gameMessages'][number]) => JSON.stringify([m.tick, m.type, m.text]);

export class ShelfReader {
    private readonly bot: BotActions;
    private readonly sdk: BotSDK;
    private readonly out: string;

    constructor(
        private readonly ctx: RoleContext,
        private readonly opt: Options
    ) {
        this.bot = readOnlyBot(ctx.bot);
        this.sdk = readOnlySdk(ctx.sdk);
        this.out = resolve(opt.out ?? defaultOut(ctx.account));
    }

    private get state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }
    private here(): Tile {
        const p = this.state.player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }
    private coins(): number {
        return this.state.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
    }
    private ranged(): number {
        return this.sdk.getSkill('Ranged')?.level ?? 1;
    }
    private checkSignal(): void {
        if (this.ctx.signal.aborted) throw new Aborted();
    }
    private emit(r: ShelfRecord): void {
        appendFileSync(this.out, JSON.stringify(r) + '\n');
    }

    async run(): Promise<void> {
        mkdirSync(dirname(this.out), { recursive: true });
        await this.sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
        if (onTutorialIsland(this.state.player)) {
            const r = await this.bot.skipTutorial();
            this.ctx.log('tutorial', { success: r.success, result: r.message });
            await waitTicks(this.sdk, 3);
        }
        const wall0 = Date.now();
        const tick0 = this.tick();
        this.ctx.log('shelf reader', { out: this.out, stops: this.opt.stops, repeat: this.opt.repeat, every: this.opt.every });
        this.emit({ kind: 'route', utc: new Date().toISOString(), account: this.ctx.account, stops: this.opt.stops, repeat: this.opt.repeat, every: this.opt.every, coins: this.coins(), ranged: this.ranged(), at: this.here(), tick: tick0 });
        const read: string[] = [];
        const skipped: string[] = [];
        let aborted = false;
        try {
            for (const key of this.opt.stops) {
                this.checkSignal();
                const stop = stopOf(key);
                const verdict = judgeStop(stop, { zone: zoneOf(this.here()), coins: this.coins(), ranged: this.ranged() });
                if (!verdict.go) {
                    this.skip(stop, verdict.reason);
                    skipped.push(key);
                    continue;
                }
                try {
                    await this.visit(stop);
                    read.push(key);
                } catch (e) {
                    if (e instanceof Aborted || this.ctx.signal.aborted) throw e;
                    this.skip(stop, `failed: ${String(e).slice(0, 300)}`);
                    skipped.push(key);
                    if (this.sdk.getState()?.shop.isOpen) await this.bot.closeShop();
                }
            }
        } catch (e) {
            if (!(e instanceof Aborted || this.ctx.signal.aborted)) throw e;
            aborted = true;
        } finally {
            const done: ShelfRecord = { kind: 'done', utc: new Date().toISOString(), read, skipped, aborted, wallMs: Date.now() - wall0, ticks: this.tick() - tick0, tick: this.tick() };
            this.emit(done);
            this.ctx.log('done', { ...done, out: this.out });
        }
    }

    private skip(stop: Stop, reason: string): void {
        this.ctx.log('skip', { stop: stop.key, reason });
        this.emit({ kind: 'skip', utc: new Date().toISOString(), stop: stop.key, reason, tick: this.tick() });
    }

    /** Go to the stop and read its shelf `repeat` times, `every` ticks apart. */
    private async visit(stop: Stop): Promise<void> {
        const wall0 = Date.now();
        const tick0 = this.tick();
        await this.goTo(stop);
        let leg = { ms: Date.now() - wall0, ticks: this.tick() - tick0 };
        for (let n = 1; n <= this.opt.repeat; n++) {
            this.checkSignal();
            const started = this.tick();
            await this.readShelf(stop, n, leg);
            leg = { ms: 0, ticks: 0 };
            if (n < this.opt.repeat) {
                while (this.tick() - started < this.opt.every) {
                    this.checkSignal();
                    await waitTicks(this.sdk, Math.min(50, this.opt.every - (this.tick() - started)));
                }
            }
        }
    }

    // ------------------------------------------------------------ travel

    /** Walk on the current land mass: out of the underground and across the toll gate as needed (toll-gate.ts travelTo). */
    private async walk(t: Tile, tolerance = 2): Promise<void> {
        this.checkSignal();
        const r = await travelTo(this.bot, this.sdk, t, { tolerance, log: this.ctx.log, signal: this.ctx.signal });
        this.checkSignal();
        if (!r.ok) throw new Error(`walk to (${t.x}, ${t.z}): ${r.reason} at (${this.here().x}, ${this.here().z})`);
    }

    private async goTo(stop: Stop): Promise<void> {
        const entry = stop.entry;
        if (inRangingGuild(this.here()) && entry?.kind !== 'guild-door') await this.throughGuildDoor(false);
        if (entry?.kind === 'trapdoor' && isUnderground(this.here())) return this.walk(stop.stand, 3);
        if (entry?.kind === 'guild-door' && inRangingGuild(this.here())) return this.walk(stop.stand, 3);
        const approach = entry?.kind === 'trapdoor' ? entry.ground : entry?.kind === 'guild-door' ? entry.outside : stop.stand;
        const sailor: Sailor = { bot: this.bot, sdk: this.sdk, log: this.ctx.log, walk: t => this.walk(t, 2) };
        await sailTo(sailor, approach);
        await this.walk(approach, entry ? 1 : 3);
        if (entry?.kind === 'trapdoor') await this.descend(entry);
        if (entry?.kind === 'guild-door') await this.throughGuildDoor(true);
        if (entry) await this.walk(stop.stand, 3);
    }

    /** Down a trapdoor (opening it first when closed) until the player is underground. */
    private async descend(entry: Extract<Entry, { kind: 'trapdoor' }>): Promise<void> {
        for (let attempt = 1; attempt <= 5 && !isUnderground(this.here()); attempt++) {
            this.checkSignal();
            const loc = this.state.nearbyLocs
                .filter(l => /trapdoor/i.test(l.name) && cheb(l, entry.ground) <= 3)
                .sort((a, b) => cheb(a, entry.ground) - cheb(b, entry.ground))[0];
            const op = loc?.optionsWithIndex.find(o => /^climb[- ]down$/i.test(o.text)) ?? loc?.optionsWithIndex.find(o => /^open$/i.test(o.text));
            if (!loc || !op) {
                this.ctx.log('trapdoor not in view', { attempt, at: this.here() });
                await waitTicks(this.sdk, 2);
                continue;
            }
            await this.bot.interactLoc(loc, op.text);
            await waitUntil(this.sdk, s => !!s.player && isUnderground({ x: s.player.worldX, z: s.player.worldZ }), { maxTicks: 10 });
        }
        if (!isUnderground(this.here())) throw new Error(`could not climb down the trapdoor at (${entry.ground.x}, ${entry.ground.z})`);
    }

    /** Through the Ranging Guild door, in or out (the in-side needs current Ranged 40). */
    private async throughGuildDoor(entering: boolean): Promise<void> {
        const d = RANGING_GUILD_DOOR;
        await this.walk(entering ? d.outside : d.inside, 1);
        for (let attempt = 1; attempt <= 4; attempt++) {
            this.checkSignal();
            const door = this.state.nearbyLocs.find(l => /^guild door$/i.test(l.name) && cheb(l, d.door) <= 1);
            if (!door) {
                this.ctx.log('guild door not in view', { attempt, at: this.here() });
                await waitTicks(this.sdk, 2);
                continue;
            }
            await this.bot.interactLoc(door, 'Open');
            const r = await waitUntil(this.sdk, s => !!s.player && inRangingGuild({ x: s.player.worldX, z: s.player.worldZ }) === entering, { maxTicks: 10 });
            if (r.ok) return;
            await this.bot.dismissBlockingUI(); // the doorman's "You must be a level 40 ranger"
            this.ctx.log('guild door retry', { attempt, at: this.here(), ranged: this.ranged() });
        }
        throw new Error(`could not ${entering ? 'enter' : 'leave'} the Ranging Guild from (${this.here().x}, ${this.here().z})`);
    }

    // ------------------------------------------------------------ the shelf

    private async readShelf(stop: Stop, read: number, leg: { ms: number; ticks: number }): Promise<void> {
        let message = '';
        for (let attempt = 1; attempt <= 3 && !this.state.shop.isOpen; attempt++) {
            this.checkSignal();
            const r = await this.bot.openShop(stop.npc);
            if (r.success) break;
            message = r.message;
            this.ctx.log('open shop retry', { stop: stop.key, attempt, message, at: this.here() });
            await this.walk(stop.stand, 2);
            await waitTicks(this.sdk, 2);
        }
        if (!this.state.shop.isOpen) throw new Error(`openShop: ${message}`);
        try {
            // The shop flag and the stock arrive in separate packets.
            await waitUntil(this.sdk, s => s.shop.isOpen && s.shop.shopItems.length > 0, { maxTicks: 5 });
            const s = this.state;
            const shop = { title: s.shop.title, shopConfig: s.shop.shopConfig ? { ...s.shop.shopConfig } : undefined, shopItems: s.shop.shopItems.map(i => ({ ...i })) };
            const utc = new Date().toISOString();
            const tick = s.tick;
            const values = await this.valueAll(shop.shopItems);
            const records = shelfRecords({ stop: stop.key, read, utc, tick, at: this.here(), legMs: leg.ms, legTicks: leg.ticks, shop, values });
            for (const r of records) this.emit(r);
            const missing = shop.shopItems.filter(i => !values.has(lower(i.name))).map(i => i.name);
            this.ctx.log('shelf', { stop: stop.key, read, title: shop.title, items: shop.shopItems.length, valued: values.size, missing, legMs: leg.ms, legTicks: leg.ticks });
        } finally {
            await this.bot.closeShop();
        }
    }

    /**
     * The server's live buy price of each item: the shop's Value option, answered
     * with "<name>: currently costs <n>gp." (shop.rs2). Clicks go out in batches;
     * an item without an answer is asked once more. Prices by lower-cased name.
     */
    private async valueAll(items: ShopItem[]): Promise<Map<string, number>> {
        const values = new Map<string, number>();
        let pending = items;
        for (let pass = 0; pass < 2 && pending.length > 0; pass++) {
            for (let i = 0; i < pending.length; i += VALUE_BATCH) {
                this.checkSignal();
                if (!this.sdk.getState()?.shop.isOpen) return values;
                const batch = pending.slice(i, i + VALUE_BATCH);
                const seen = new Map<string, number>();
                for (const m of this.state.gameMessages) seen.set(msgKey(m), (seen.get(msgKey(m)) ?? 0) + 1);
                const collect = (s: BotWorldState) => {
                    const left = new Map(seen);
                    for (const m of s.gameMessages) {
                        const k = msgKey(m);
                        const old = left.get(k) ?? 0;
                        if (old > 0) {
                            left.set(k, old - 1);
                            continue;
                        }
                        const v = m.type === 0 ? parseValueMessage(m.text) : null;
                        if (v) values.set(lower(v.name), v.price);
                    }
                    return batch.every(b => values.has(lower(b.name)));
                };
                for (const it of batch) await this.sdk.sendClickComponentWithOption(SHOP_STOCK_COMPONENT, VALUE_OPTION, it.slot);
                await waitUntil(this.sdk, collect, { maxTicks: VALUE_WAIT_TICKS });
                collect(this.state);
            }
            pending = pending.filter(it => !values.has(lower(it.name)));
        }
        return values;
    }
}

export const role: Role = {
    name: 'shelf-reader',
    produces: [],
    async run(ctx) {
        await new ShelfReader(ctx, parseOptions(ctx.options)).run();
    }
};

if (import.meta.main) {
    // Flags become role options (the account is the one bare argument); ROLE_OPTIONS still works and the flags win.
    const flags = parseArgs(process.argv.slice(2));
    process.env.ROLE_OPTIONS = JSON.stringify({ ...(JSON.parse(process.env.ROLE_OPTIONS ?? '{}') as Record<string, unknown>), ...flags });
    parseOptions(JSON.parse(process.env.ROLE_OPTIONS) as Record<string, unknown>); // fail on a bad option before logging in
    await runStandalone(role);
}
