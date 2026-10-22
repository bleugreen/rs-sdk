// Kit giver: hands a rehearsal account its starter kit at Lumbridge, right after
// the account's tutorial skip, and takes the kit's tools back after its 99.
//
//   ROLE_OPTIONS='{"kits":{"cairn_chops":"rune_axe:1,knife:1,logs:1"},"serve":"cairn_chops"}' \
//     bun speedrun/helpers/kits.ts cairn_mule2
//
// One account (cairn_mule2) runs it. With `serve` set it stages that receiver's
// kit: it banks everything at Draynor, withdraws the kit (chopping any normal
// logs the bank is short of), and stands at the tutorial's exit tile, Lumbridge
// (3222,3222). The moment the receiver appears there it requests a trade and
// offers the kit with speedrun/lib/trade.ts give(), one exact-count offer per
// item, re-requesting until the receiver's receiveFrom answers. Without `serve`,
// or once the kit is given, it only takes returns: a trade request from any kit
// receiver is answered with receiveFrom (it gives nothing), and what came back
// is banked at Draynor.
//
// Purchases are not this role's job: the axe is a `bidder` line, the shop items a
// `buyer` list, feathers and coins come by `bidder.ts <earner> fund`. How it all
// fits, and how to stop it cleanly: docs/speedrun/helpers/kits.md.
//
// With `stall` set instead, the role is one cake trip for a borrowed high-level
// account: over White Wolf Mountain to the East Ardougne baker's stall, steal
// until `target` cakes are held, bank them, and bring them back noted to the kit
// giver at Lumbridge (stallTrip below).
//
// With `load` set instead, the role is the receiving side for an account that
// must log in already carrying a full pack (a Firemaking dropper): it leaves the
// tutorial, banks every starter item, takes its kit from the giver with
// receiveFrom, walks to its park tile and finishes (loadTrip below).
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { crossFromKandarin, crossToKandarin, type Traveller } from '../lib/kandarin';
import { give, receiveFrom, sameName, type GiveResult, type GiveSpec, type WantSpec } from '../lib/trade';
import { BANKS, Buyer, type Tile } from './buyer';
import { ChatCursor, isStackableName, planPackage, type PackageItem } from './mule';
import { runStandalone, type Role, type RoleContext, type RoleFinish, type RoleState } from './role';
import { waitForPlayer } from './wine';

/** Where the tutorial's last label drops a new account (tutorial.rs2 tutorial_complete, p_telejump 0_50_50_22_22). */
export const LUMBRIDGE_SPAWN: Tile = { x: 3222, z: 3222 };
/** The tutorial leaves 18 starter items in a new account's pack, so 10 slots are free. */
export const RECEIVER_FREE_SLOTS = 10;
/** Normal trees near Lumbridge (the ones grapes.ts chops by the chicken farm), tried when none is in view. */
export const LUMBRIDGE_TREES: Tile[] = [
    { x: 3230, z: 3279 },
    { x: 3213, z: 3287 },
    { x: 3212, z: 3297 },
    { x: 3236, z: 3317 }
];
const LOGS = 'Logs';

// ============ Pure helpers (unit tested in kits.test.ts) ============

/** A debug name as the harness spells it (`fly_fishing_rod`) to the game's display name (`Fly fishing rod`). */
export function displayName(name: string): string {
    const words = name.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A kit as rs/150's harness writes it, `rune_axe:1,knife:1,logs:1` (append `:noted`
 * for banknotes, `cake:38:noted`), or as a list of `{ item, amount, noted? }`.
 */
export function parseKit(spec: unknown, where = 'kit'): PackageItem[] {
    const items: PackageItem[] = [];
    if (typeof spec === 'string') {
        for (const part of spec.split(',').map(p => p.trim()).filter(Boolean)) {
            const [name, count, flag, ...rest] = part.split(':').map(p => p.trim());
            if (!name || rest.length || (flag !== undefined && flag !== 'noted')) throw new Error(`${where}: cannot read "${part}" (want name:count or name:count:noted)`);
            items.push({ item: displayName(name), amount: Number(count ?? 1), noted: flag === 'noted' });
        }
    } else if (Array.isArray(spec)) {
        for (const raw of spec as Array<Record<string, unknown>>) {
            items.push({ item: displayName(String(raw?.item ?? '')), amount: Number(raw?.amount ?? 1), noted: raw?.noted === true });
        }
    } else {
        throw new Error(`${where}: a kit is a "name:count,..." string or a list of { item, amount }`);
    }
    if (items.length === 0) throw new Error(`${where}: empty kit`);
    const seen = new Set<string>();
    for (const i of items) {
        if (!i.item) throw new Error(`${where}: an item has no name`);
        if (!Number.isInteger(i.amount) || i.amount < 1) throw new Error(`${where}: bad count for ${i.item}`);
        const key = `${i.item.toLowerCase()}|${i.noted}`;
        if (seen.has(key)) throw new Error(`${where}: ${i.item} is listed twice`);
        seen.add(key);
    }
    return items;
}

/** Inventory slots the kit takes in the receiver's pack: one per unstackable item, one per stack or banknote. */
export function kitSlots(kit: readonly PackageItem[]): number {
    return kit.reduce((n, i) => n + (i.noted || isStackableName(i.item) ? 1 : i.amount), 0);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What give() offers: each kit item by its exact name and count. lib/trade matches
 * a string as a substring (`Shark` would also take `Raw shark`, `Logs` `Oak logs`),
 * so every name is anchored.
 */
export function giveSpecs(kit: readonly PackageItem[]): GiveSpec[] {
    return kit.map(i => ({ item: new RegExp(`^${escapeRegExp(i.item)}$`, 'i'), n: i.amount }));
}

/** True when the inventory holds at least the whole kit (by exact name, notes counted with their item). */
export function kitHeld(inventory: ReadonlyArray<Pick<InventoryItem, 'name' | 'count'>>, kit: readonly PackageItem[]): boolean {
    const have = new Map<string, number>();
    for (const i of inventory) have.set(i.name.toLowerCase(), (have.get(i.name.toLowerCase()) ?? 0) + i.count);
    const want = new Map<string, number>();
    for (const i of kit) want.set(i.item.toLowerCase(), (want.get(i.item.toLowerCase()) ?? 0) + i.amount);
    for (const [name, n] of want) if ((have.get(name) ?? 0) < n) return false;
    return true;
}

/**
 * Split a kit into what the bank supplies and how many normal logs must be
 * chopped first: logs are cut by the giver itself rather than bought.
 */
export function splitLogs(kit: readonly PackageItem[], bankLogs: number): { fromBank: PackageItem[]; chop: number } {
    const fromBank: PackageItem[] = [];
    let chop = 0;
    for (const i of kit) {
        if (i.item.toLowerCase() !== LOGS.toLowerCase() || i.noted) {
            fromBank.push(i);
            continue;
        }
        const take = Math.min(i.amount, bankLogs);
        chop += i.amount - take;
        if (take > 0) fromBank.push({ ...i, amount: take });
    }
    return { fromBank, chop };
}

export interface KitOptions {
    /** Kit id -> kit. A kit id is the receiver's login name, or `name+label` for a further kit to the same receiver. */
    kits: Record<string, PackageItem[]>;
    /** Kit ids to stage and serve, in order (keys of `kits`); one with a delivery record is passed over. Empty = returns only. */
    serve: string[];
    /** Where to stand (default the tutorial's exit tile). */
    stand: Tile;
    /** Bank for staging and for returns (default Draynor, the nearest booths to Lumbridge on the ground floor). */
    bank: Tile;
    /** Accounts whose trades are answered with receiveFrom and banked (default: every kit receiver). */
    returns: string[];
    /** Free slots a receiver has (default 10, after the tutorial's starter items). */
    freeSlots: number;
    /** Normal logs held back in the bank for later (never put into a kit); chopped up to this count at start. Default 0. */
    keepLogs: number;
}

function tileOption(raw: unknown, fallback: Tile, key: string): Tile {
    if (raw === undefined) return fallback;
    const t = raw as Partial<Tile>;
    if (typeof t?.x !== 'number' || typeof t?.z !== 'number') throw new Error(`kits: ${key} must be { x, z }`);
    return { x: t.x, z: t.z };
}

export function kitOptions(raw: Record<string, unknown>): KitOptions {
    const rawKits = raw.kits;
    if (!rawKits || typeof rawKits !== 'object' || Array.isArray(rawKits)) throw new Error('kits: options.kits must map receiver names to kits');
    const freeSlots = raw.freeSlots === undefined ? RECEIVER_FREE_SLOTS : Number(raw.freeSlots);
    if (!Number.isInteger(freeSlots) || freeSlots < 1 || freeSlots > 28) throw new Error('kits: freeSlots must be 1-28');
    const kits: Record<string, PackageItem[]> = {};
    for (const [to, spec] of Object.entries(rawKits as Record<string, unknown>)) {
        const name = to.trim().toLowerCase();
        if (!KIT_ID.test(name)) throw new Error(`kits: "${to}" is not a login name or name+label`);
        const kit = parseKit(spec, `kits.${name}`);
        const slots = kitSlots(kit);
        // A labelled kit follows an earlier one, once the receiver has made room (dropped its starter items).
        const room = name.includes('+') ? 28 : freeSlots;
        if (slots > room) throw new Error(`kits.${name}: needs ${slots} slots, the receiver has ${room} free`);
        kits[name] = kit;
    }
    const rawServe = raw.serve === undefined || raw.serve === null || raw.serve === '' ? [] : Array.isArray(raw.serve) ? raw.serve : [raw.serve];
    const serve = rawServe.map(s => String(s).trim().toLowerCase());
    for (const s of serve) if (!kits[s]) throw new Error(`kits: serve "${s}" has no kit`);
    if (new Set(serve).size !== serve.length) throw new Error('kits: serve lists a kit twice');
    const returns = raw.returns === undefined ? [...new Set(Object.keys(kits).map(receiverOf))] : (raw.returns as unknown[]).map(r => String(r).trim().toLowerCase());
    const keepLogs = raw.keepLogs === undefined ? 0 : Number(raw.keepLogs);
    if (!Number.isInteger(keepLogs) || keepLogs < 0 || keepLogs > 27) throw new Error('kits: keepLogs must be 0-27');
    return { kits, serve, stand: tileOption(raw.stand, LUMBRIDGE_SPAWN, 'stand'), bank: tileOption(raw.bank, BANKS.draynor, 'bank'), returns, freeSlots, keepLogs };
}

/** A kit id: the receiver's login name, or `name+label` for a further kit to the same receiver (a top-up). */
const KIT_ID = /^[a-z0-9_]{1,12}(\+[a-z0-9_-]{1,16})?$/;

/** The login name a kit id is for (`cairn_jumps+topup` -> `cairn_jumps`). */
export function receiverOf(kitId: string): string {
    return kitId.split('+')[0]!;
}

/** The first kit id in `serve` with no delivery record, or null when every one has one. */
export function nextKit(serve: readonly string[], state: Pick<RoleState, 'get'>): string | null {
    return serve.find(r => state.get(kitDeliveryKey(r)) === undefined) ?? null;
}

/**
 * Each kit is given once, even across role or launcher restarts. Keyed by kit id; a
 * plain id is the receiver's name, so records written before kit ids still hold.
 */
export function kitDeliveryKey(kitId: string): string {
    return `kits.delivery:${kitId.trim().toLowerCase()}`;
}

/** Several kits as one list, the same item (and noted flag) summed: what one staging carries. */
export function mergeKits(kits: ReadonlyArray<readonly PackageItem[]>): PackageItem[] {
    const out: PackageItem[] = [];
    for (const kit of kits) {
        for (const i of kit) {
            const same = out.find(o => o.item.toLowerCase() === i.item.toLowerCase() && !!o.noted === !!i.noted);
            if (same) same.amount += i.amount;
            else out.push({ ...i });
        }
    }
    return out;
}

const choppedLogs = (kit: readonly PackageItem[]) => kit.some(i => i.item.toLowerCase() === LOGS.toLowerCase() && !i.noted);

/**
 * The kits one staging carries: `pending`, then the undelivered kits right after it in
 * `serve` for the same receiver, while they fit the giver's 28 slots together (one
 * kept for the axe when there are logs to chop). The next kit is then already in the
 * pack when the first has gone.
 */
export function carryGroup(serve: readonly string[], pending: string, kits: Readonly<Record<string, readonly PackageItem[]>>, state: Pick<RoleState, 'get'>): string[] {
    const group = [pending];
    for (const id of serve.slice(serve.indexOf(pending) + 1)) {
        if (receiverOf(id) !== receiverOf(pending)) break;
        if (state.get(kitDeliveryKey(id)) !== undefined) continue;
        const load = mergeKits([...group, id].map(g => kits[g]!));
        if (kitSlots(load) + (choppedLogs(load) ? 1 : 0) > 28) break;
        group.push(id);
    }
    return group;
}

/**
 * Persist intent before calling the shared giver. Only an unopened trade with
 * the complete kit still held is safe to retry automatically; any other failure
 * needs the receiver's log before another kit can be sent.
 */
export async function giveKitOnce(
    state: RoleState,
    kitId: string,
    kit: readonly PackageItem[],
    send: () => Promise<GiveResult>,
    held: () => boolean
): Promise<GiveResult | null> {
    const key = kitDeliveryKey(kitId);
    if (state.get(key) !== undefined) return null;
    const receiver = receiverOf(kitId);
    const record = (outcome: string) => ({ outcome, receiver, ...(kitId !== receiver ? { kitId } : {}), kit, at: new Date().toISOString() });
    await state.set(key, record('giving'));
    const result = await send();
    const unopened = result.reason === 'no_response' || result.reason === 'player_not_found';
    await state.set(key, result.ok ? record('delivered') :
        unopened && held() ? undefined : record('uncertain'));
    return result;
}

// ============ The role ============

const HEARTBEAT_MS = 5 * 60_000;
/** Free slots a return may need (a kit's tools and leftovers); with fewer, the giver banks its pack first. */
export const RETURN_ROOM = 4;

/** The pack has fewer than RETURN_ROOM free slots (a staged full-pack kit leaves none). */
export const needsRoomForReturn = (inventory: readonly unknown[]): boolean => 28 - inventory.length < RETURN_ROOM;

/** Re-check a kit the bank cannot fill once a minute, not every tick. */
const SHORT_RETRY_MS = 60_000;

const describe = (items: ReadonlyArray<{ name?: string; item?: string; count?: number; amount?: number }>) =>
    items.map(i => `${i.name ?? i.item} x${i.count ?? i.amount}`);

class KitGiver {
    private readonly o: KitOptions;
    private readonly buyer: Buyer;
    private readonly requests: ChatCursor;
    /** Receiver whose kit is still to give; null once given (or with no `serve`). */
    private pending: string | null;
    private staged = false;
    private shortSince = 0;
    private needsBank = false;
    private lastLog = 0;
    private seenReceiver = false;
    private logsKept = false;

    constructor(private readonly ctx: RoleContext) {
        this.o = kitOptions(ctx.options);
        this.buyer = new Buyer(ctx);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
        this.pending = nextKit(this.o.serve, ctx.state);
    }

    /** On to the next kit in `serve` that has no delivery record; one carried from the last staging is served from the pack. */
    private advance(): void {
        this.pending = nextKit(this.o.serve, this.ctx.state);
        this.staged = this.pending !== null && kitHeld(this.ctx.sdk.getInventory(), this.kit);
        if (this.staged) this.log('kit carried', { serve: this.pending, kit: describe(this.kit) });
        this.seenReceiver = false;
        this.shortSince = 0;
    }

    private log(message: string, data?: Record<string, unknown>): void {
        this.lastLog = Date.now();
        this.ctx.log(message, data);
    }

    private get kit(): PackageItem[] {
        return this.pending ? this.o.kits[this.pending]! : [];
    }

    private distanceToStand(): number {
        const p = this.ctx.sdk.getState()?.player;
        if (!p) return Infinity;
        return Math.max(Math.abs(p.worldX - this.o.stand.x), Math.abs(p.worldZ - this.o.stand.z));
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await this.buyer.prepare();
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        const recorded = this.o.serve.filter(r => ctx.state.get(kitDeliveryKey(r)) !== undefined);
        this.log('kits ready', { serve: this.pending, kit: this.pending ? describe(this.kit) : null, queue: this.o.serve, recorded, stand: this.o.stand, returns: this.o.returns, keepLogs: this.o.keepLogs });
        while (!ctx.signal.aborted) {
            try {
                await this.cycle();
            } catch (e) {
                this.log('cycle error', { error: String(e) });
                await ctx.sdk.waitForTicks(5).catch(() => {});
            }
        }
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
    }

    private async cycle(): Promise<void> {
        const { sdk } = this.ctx;
        if (this.pending && this.ctx.state.get(kitDeliveryKey(this.pending)) !== undefined) {
            this.log('prior hand-off recorded; not serving another kit', { to: this.pending, record: this.ctx.state.get(kitDeliveryKey(this.pending)) });
            this.advance();
        }
        if (!this.logsKept && this.o.keepLogs > 0 && !sdk.getTradeState().isOpen) {
            await this.keepLogs();
            this.logsKept = true;
        }
        if (this.pending && !this.staged) {
            if (this.shortSince && Date.now() - this.shortSince < SHORT_RETRY_MS) {
                await this.takeReturns();
                await sdk.waitForTicks(2).catch(() => {});
                return;
            }
            this.staged = await this.stage();
            if (!this.staged) return;
        }
        if (!this.pending && this.needsBank) await this.bankReturns();
        if (this.distanceToStand() > 3 && !sdk.getTradeState().isOpen) await this.buyer.walk(this.o.stand);
        if (this.pending && this.staged) await this.serve();
        await this.takeReturns();
        if (Date.now() - this.lastLog > HEARTBEAT_MS) {
            this.log(this.pending ? 'waiting' : 'idle', { serve: this.pending, receiverSeen: this.seenReceiver, inventory: describe(sdk.getInventory()) });
        }
        await sdk.waitForTicks(1).catch(() => {});
    }

    /** Bank everything, withdraw the kit, chop missing logs, and end at the stand with the kit in the pack. */
    private async stage(): Promise<boolean> {
        const { sdk, bot } = this.ctx;
        const to = this.pending!;
        const group = carryGroup(this.o.serve, to, this.o.kits, this.ctx.state);
        const load = mergeKits(group.map(id => this.o.kits[id]!));
        let chop = 0;
        let short: unknown = null;
        await this.buyer.atBank(this.o.bank, async () => {
            await this.buyer.depositAllBut([]);
            const bank = sdk.getBankItems();
            const split = splitLogs(load, Math.max(0, (bank.find(b => sameName(b.name, LOGS))?.count ?? 0) - this.o.keepLogs));
            const plan = planPackage({ name: receiverOf(to), items: split.fromBank }, bank);
            if (plan.missing.length) {
                short = plan.missing;
                return;
            }
            for (const w of plan.withdrawals) {
                const r = await bot.withdrawItem(w.bankItem, w.amount, { asNote: w.noted });
                if (!r.success) throw new Error(`withdraw ${w.bankItem.name} x${w.amount}: ${r.message}`);
            }
            chop = split.chop;
            const hasAxe = sdk.getInventory().some(i => /axe$/i.test(i.name) && !/pickaxe$/i.test(i.name));
            if (chop > 0 && !hasAxe) {
                const axe = sdk.getBankItems().find(b => /^bronze axe$/i.test(b.name));
                if (!axe) throw new Error('logs to chop and no axe in the bank');
                await bot.withdrawItem(axe, 1);
            }
        });
        if (short) {
            if (!this.shortSince) this.log('kit short', { serve: to, missing: short });
            this.shortSince = Date.now();
            return false;
        }
        this.shortSince = 0;
        if (chop > 0 && !(await this.chopLogs(load.find(i => sameName(i.item, LOGS))!.amount))) return false;
        if (!(await this.buyer.walk(this.o.stand))) throw new Error('could not reach the stand');
        if (!kitHeld(sdk.getInventory(), load)) throw new Error(`kit not in the pack after staging: ${describe(sdk.getInventory()).join(', ')}`);
        this.log('kit staged', { serve: to, kit: describe(this.kit), ...(group.length > 1 ? { carrying: group.slice(1) } : {}), at: this.o.stand });
        return true;
    }

    /** Top the bank's normal logs up to `keepLogs`, chopping the shortfall with the bronze axe. */
    private async keepLogs(): Promise<void> {
        const { sdk, bot } = this.ctx;
        let short = 0;
        let inBank = 0;
        const banked = () => sdk.getBankItems().find(b => sameName(b.name, LOGS))?.count ?? 0;
        await this.buyer.atBank(this.o.bank, async () => {
            await this.buyer.depositAllBut([]);
            inBank = banked();
            short = this.o.keepLogs - inBank;
            if (short <= 0) return;
            const axe = sdk.getBankItems().find(b => /^bronze axe$/i.test(b.name));
            if (!axe) throw new Error('keepLogs: no bronze axe in the bank');
            await bot.withdrawItem(axe, 1);
        });
        if (short > 0) {
            const ok = await this.chopLogs(short);
            await this.buyer.atBank(this.o.bank, async () => {
                await this.buyer.depositAllBut([]);
                inBank = banked();
            });
            if (!ok) this.log('keepLogs short', { want: this.o.keepLogs, short });
        }
        // Read inside atBank: the bank list is empty once the bank closes.
        this.log('logs kept', { keepLogs: this.o.keepLogs, inBank });
    }

    /** Chop normal trees until the pack holds `want` Logs. */
    private async chopLogs(want: number): Promise<boolean> {
        const { sdk, bot } = this.ctx;
        const logs = () => sdk.getInventory().filter(i => sameName(i.name, LOGS)).reduce((a, i) => a + i.count, 0);
        let tree = 0;
        for (let attempt = 0; logs() < want && attempt < 40 && !this.ctx.signal.aborted; attempt++) {
            if (!sdk.findNearbyLoc(/^tree$/i)) await this.buyer.walk(LUMBRIDGE_TREES[tree++ % LUMBRIDGE_TREES.length]!);
            const r = await bot.chopTree(/^tree$/i);
            if (!r.success) {
                this.log('chop failed', { detail: r.message });
                await this.buyer.walk(LUMBRIDGE_TREES[tree++ % LUMBRIDGE_TREES.length]!);
            }
        }
        this.log('chopped', { logs: logs(), want });
        return logs() >= want;
    }

    /** Offer the kit once the receiver is in view; give() re-requests until it answers. */
    private async serve(): Promise<void> {
        const { sdk } = this.ctx;
        const id = this.pending!;
        const to = receiverOf(id);
        const s = sdk.getState();
        if (!s?.nearbyPlayers.some(p => sameName(p.name, to))) return;
        if (!this.seenReceiver) this.log('receiver in view', { serve: id, tick: s.tick });
        this.seenReceiver = true;
        if (!kitHeld(sdk.getInventory(), this.kit)) {
            this.staged = false;
            return;
        }
        const r = await giveKitOnce(this.ctx.state, id, this.kit,
            () => give(sdk, to, giveSpecs(this.kit), { openTimeoutMs: 30_000 }),
            () => kitHeld(sdk.getInventory(), this.kit));
        if (!r) return;
        this.log('hand-off', {
            to,
            ...(id !== to ? { kitId: id } : {}),
            ok: r.ok,
            reason: r.reason ?? null,
            giverTicks: r.ticks,
            gave: describe(r.gave),
            kit: describe(this.kit),
            tick: sdk.getState()?.tick ?? null,
            at: new Date().toISOString()
        });
        // The receiver's own trade request lands in the chat too; it is this trade's, not a return.
        this.requests.next();
        if (r.ok) {
            this.needsBank = true;
            this.advance();
        } else if (this.ctx.state.get(kitDeliveryKey(id)) !== undefined) {
            this.log('hand-off unsettled; check receiver before serving again', { to: id, inventory: describe(sdk.getInventory()) });
            this.needsBank = true;
            this.advance();
        }
    }

    /** Answer a trade request from a kit receiver (tools coming back): take, give nothing. */
    private async takeReturns(): Promise<void> {
        const { sdk } = this.ctx;
        const senders = [...new Set(this.requests.next().map(m => m.sender))].filter(n => this.o.returns.some(r => sameName(r, n)) && !(this.pending && sameName(n, receiverOf(this.pending))));
        for (const from of senders) {
            if (needsRoomForReturn(sdk.getInventory())) await this.makeRoom(from);
            const r = await receiveFrom(sdk, from, { openTimeoutMs: 20_000 });
            this.log('returned', { from, ok: r.ok, reason: r.reason ?? null, received: describe(r.received), ticks: r.ticks });
            if (r.ok) this.needsBank = true;
        }
    }

    /**
     * Bank the pack (a staged kit) so a return can land; the next cycle stages the kit
     * again. The returner's trade request stays open meanwhile, so this works when the
     * stand is beside the bank; with a far bank the returner may give up first.
     */
    private async makeRoom(from: string): Promise<void> {
        this.log('return needs room; banking the pack', { from, serve: this.pending, inventory: describe(this.ctx.sdk.getInventory()) });
        await this.buyer.atBank(this.o.bank, () => this.buyer.depositAllBut([]));
        this.staged = false;
        this.needsBank = false;
        if (this.distanceToStand() > 3) await this.buyer.walk(this.o.stand);
    }

    private async bankReturns(): Promise<void> {
        await this.buyer.atBank(this.o.bank, () => this.buyer.depositAllBut([]));
        this.needsBank = false;
        this.log('banked', {});
    }
}

// ============ Stall trip (cakes) ============

/**
 * The east baker's stall in the Ardougne market and the tile north of it
 * (m41_51.jm2). Measured in the lab (cairn://p/rs/161, 2026-10-21, 300 ms ticks,
 * 99 combat stats): 77 steals, 55 cakes per 1,000 ticks from this tile when
 * nothing is clicked for STALL_BACKOFF_TICKS after a guard contact; clicking
 * through combat gave 8 cakes, because every click inside the engine's 10-tick
 * %lastcombat window is refused (stealing.rs2). The stall body hides the player
 * from the baker on most ticks; the west stall is in view of three guards.
 */
export const BAKER_STALL: Tile = { x: 2667, z: 3310 };
export const BAKER_STALL_TILE: Tile = { x: 2667, z: 3312 };
/** East Ardougne south bank (booths at 2656,3283 and 2656,3286). */
export const ARDOUGNE_SOUTH_BANK: Tile = { x: 2654, z: 3285 };
export const STALL_BACKOFF_TICKS = 11;
/** controls:com_2 sets auto-retaliate on (player_controls.rs2); kandarin.ts's crossing turns it off. */
const IF_AUTO_RETALIATE_ON = 150;
const STALL_JUNK = /^(bread|chocolate slice)$/i;

export interface StallOptions {
    /** Cakes to end with (bank + pack). */
    target: number;
    /** Who gets the cakes: the kit giver, standing at `deliverAt`. */
    deliverTo: string;
    deliverAt: Tile;
    /** Food names the trip keeps in the pack; everything else is banked before leaving. */
    food: string[];
}

export function stallOptions(raw: unknown): StallOptions {
    const o = (raw ?? {}) as Record<string, unknown>;
    const target = Number(o.target ?? 55);
    if (!Number.isInteger(target) || target < 1) throw new Error('kits: stall.target must be a positive whole number');
    if (typeof o.deliverTo !== 'string' || !o.deliverTo) throw new Error('kits: stall.deliverTo is required (the kit giver)');
    const food = (Array.isArray(o.food) ? o.food : ['Kebab']).map(String);
    return { target, deliverTo: o.deliverTo.toLowerCase(), deliverAt: tileOption(o.deliverAt, LUMBRIDGE_SPAWN, 'stall.deliverAt'), food };
}

export interface StallView {
    tick: number;
    /** The stall offers Steal (it is not depleted). */
    stallUp: boolean;
    onTile: boolean;
    /** Last tick with any combat contact: damage either way, a target, or the "during combat" refusal. */
    lastContactTick: number;
    /** Cakes banked this trip plus cakes in the pack. */
    held: number;
    target: number;
    freeSlots: number;
    junk: boolean;
    hp: number;
    maxHp: number;
    hasFood: boolean;
}

export type StallAction = 'done' | 'eat' | 'flee' | 'bank' | 'walk' | 'steal' | 'drop' | 'wait';

/**
 * One decision per tick at the stall. Steal only while the stall is up and no
 * combat contact happened in the last STALL_BACKOFF_TICKS; drop bread and
 * chocolate slices in the gaps (and when the pack is full), bank when it is full
 * of cakes, eat below half health and give up below a third with no food.
 */
export function decideStall(v: StallView): StallAction {
    if (v.held >= v.target) return 'done';
    if (v.hp * 3 < v.maxHp) return v.hasFood ? 'eat' : 'flee';
    if (v.hp * 2 < v.maxHp && v.hasFood) return 'eat';
    if (v.freeSlots === 0) return v.junk ? 'drop' : 'bank';
    if (!v.onTile) return 'walk';
    if (v.stallUp && v.tick - v.lastContactTick >= STALL_BACKOFF_TICKS) return 'steal';
    return v.junk ? 'drop' : 'wait';
}

/** The latest combat contact visible in a state (combat events, a held target, the last hit taken). */
export function lastContact(s: Pick<BotWorldState, 'tick' | 'combatEvents' | 'player' | 'gameMessages'>, since: number): number {
    let t = since;
    for (const e of s.combatEvents ?? []) t = Math.max(t, e.tick);
    const c = s.player?.combat;
    if (c) {
        if (c.inCombat || c.targetIndex >= 0) t = Math.max(t, s.tick);
        if (c.lastDamageTick > 0) t = Math.max(t, c.lastDamageTick);
    }
    for (const m of s.gameMessages ?? []) if (/during combat/i.test(m.text)) t = Math.max(t, m.tick);
    return t;
}

const countNamed = (items: ReadonlyArray<{ name: string; count: number }>, name: string) =>
    items.filter(i => sameName(i.name, name)).reduce((a, i) => a + i.count, 0);

/**
 * One cake trip. Bank everything but food at Varrock west, cross to Ardougne,
 * steal at the east baker's stall until `target` cakes are held, bank them at
 * the south bank, withdraw them noted, cross back and give them to the kit giver.
 */
export async function stallTrip(ctx: RoleContext): Promise<{ cakes: number; delivered: number }> {
    const o = stallOptions(ctx.options.stall);
    const { sdk, bot } = ctx;
    const buyer = new Buyer(ctx);
    const t: Traveller = { bot, sdk, log: ctx.log, checkSignal: () => { if (ctx.signal.aborted) throw new Error('aborted'); } };
    const keep = (name: string) => o.food.some(f => sameName(f, name));
    const state = () => {
        const s = sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    };
    await buyer.prepare();
    await bot.dismissBlockingUI();
    if (sdk.getTradeState().isOpen) await bot.declineTrade();
    const retaliateWas = sdk.getState()?.autoRetaliateEnabled;

    let banked = 0;
    await buyer.atBank(BANKS.varrockWest, async () => {
        for (const it of firstNames(state().inventory)) if (!keep(it)) await bot.depositItem(it, -1);
        banked = countNamed(sdk.getBankItems(), 'Cake');
    });
    ctx.log('stall: leaving', { target: o.target, cakesInBank: banked, carrying: describe(state().inventory) });
    await crossToKandarin(t, BAKER_STALL_TILE, "the Ardougne baker's stall");
    await sdk.sendClickComponent(IF_AUTO_RETALIATE_ON);

    let contact = -STALL_BACKOFF_TICKS;
    let steals = 0;
    const t0 = state().tick;
    let last: StallAction | null = null;
    while (!ctx.signal.aborted) {
        const s = state();
        contact = lastContact(s, contact);
        const stall = s.nearbyLocs.find(l => l.x === BAKER_STALL.x && l.z === BAKER_STALL.z && l.optionsWithIndex.some(op => /^steal/i.test(op.text)));
        const p = s.player!;
        const view: StallView = {
            tick: s.tick,
            stallUp: !!stall,
            onTile: p.worldX === BAKER_STALL_TILE.x && p.worldZ === BAKER_STALL_TILE.z,
            lastContactTick: contact,
            held: banked + countNamed(s.inventory, 'Cake'),
            target: o.target,
            freeSlots: 28 - s.inventory.length,
            junk: s.inventory.some(i => STALL_JUNK.test(i.name)),
            hp: sdk.getSkill('Hitpoints')?.level ?? 0,
            maxHp: sdk.getSkill('Hitpoints')?.baseLevel ?? 1,
            hasFood: s.inventory.some(i => keep(i.name))
        };
        const action = decideStall(view);
        if (action !== last && action !== 'steal' && action !== 'wait') ctx.log('stall', { action, held: view.held, steals, tick: s.tick });
        last = action;
        if (action === 'done' || action === 'flee') break;
        if (action === 'eat') await bot.eatFood(s.inventory.find(i => keep(i.name)));
        else if (action === 'drop') await bot.dropItem(s.inventory.find(i => STALL_JUNK.test(i.name))!, 'all');
        else if (action === 'walk') await bot.walkTo(BAKER_STALL_TILE.x, BAKER_STALL_TILE.z, 0);
        else if (action === 'steal') {
            const op = stall!.optionsWithIndex.find(x => /^steal/i.test(x.text))!;
            steals++;
            await sdk.sendInteractLoc(stall!.x, stall!.z, stall!.id, op.opIndex);
        } else if (action === 'bank') {
            await buyer.atBank(ARDOUGNE_SOUTH_BANK, async () => {
                await bot.depositItem(/^cake$/i, -1);
                banked = countNamed(sdk.getBankItems(), 'Cake');
            });
        }
        await sdk.waitForTicks(1).catch(() => {});
    }
    const cakes = banked + countNamed(state().inventory, 'Cake');
    ctx.log('stall: stopped stealing', { cakes, target: o.target, clicks: steals, ticks: state().tick - t0, hp: sdk.getSkill('Hitpoints')?.level });

    // Every cake into the bank, then out again as one noted stack for the walk home.
    let carried = 0;
    await buyer.atBank(ARDOUGNE_SOUTH_BANK, async () => {
        for (const it of firstNames(state().inventory)) if (!keep(it)) await bot.depositItem(it, -1);
        const stack = sdk.getBankItems().find(b => sameName(b.name, 'Cake'));
        if (stack) await bot.withdrawItem(stack, stack.count, { asNote: true });
        carried = countNamed(state().inventory, 'Cake');
    });
    await crossFromKandarin(t, o.deliverAt, 'the kit giver');
    if (retaliateWas === true) await sdk.sendClickComponent(IF_AUTO_RETALIATE_ON);
    let delivered = 0;
    if (carried > 0) {
        const r = await give(sdk, o.deliverTo, [{ item: /^cake$/i, n: 'all' }], { openTimeoutMs: 120_000 });
        delivered = r.gave.filter(i => sameName(i.name, 'Cake')).reduce((a, i) => a + i.count, 0);
        ctx.log('stall: delivered', { to: o.deliverTo, ok: r.ok, reason: r.reason ?? null, delivered, ticks: r.ticks });
    }
    // Anything undelivered goes back to this account's bank.
    if (countNamed(state().inventory, 'Cake') > 0) await buyer.atBank(BANKS.draynor, () => buyer.depositAllBut(o.food));
    return { cakes, delivered };
}

// ============ Loading a full pack (Firemaking droppers) ============

export interface LoadOptions {
    /** The kit giver's login name (cairn_mule2). */
    from: string;
    /** Exactly what the pack holds when the role ends. */
    kit: PackageItem[];
    /** Where the starter items are banked and the kit is taken (default Draynor, where the giver stands). */
    bank: Tile;
    /** The exact tile to end on, which is where the account logs in next time; null stays at the bank. */
    park: Tile | null;
}

export function loadOptions(raw: unknown): LoadOptions {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('load: options.load must be { from, kit, bank?, park? }');
    const o = raw as Record<string, unknown>;
    const from = String(o.from ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,12}$/.test(from)) throw new Error("load: from must be the giver's login name");
    const kit = parseKit(o.kit, 'load.kit');
    const slots = kitSlots(kit);
    if (slots > 28) throw new Error(`load.kit: needs ${slots} slots, a pack has 28`);
    const park = o.park === undefined || o.park === null ? null : tileOption(o.park, LUMBRIDGE_SPAWN, 'load.park');
    return { from, kit, bank: tileOption(o.bank, BANKS.draynor, 'load.bank'), park };
}

/** The pack holds the kit at its exact counts and nothing else (a held fm-row dropper drops every item it carries). */
export function loadedExactly(inventory: ReadonlyArray<Pick<InventoryItem, 'name' | 'count'>>, kit: readonly PackageItem[]): boolean {
    const total = (rows: Array<[string, number]>) => {
        const m = new Map<string, number>();
        for (const [name, n] of rows) m.set(name, (m.get(name) ?? 0) + n);
        return m;
    };
    const have = total(inventory.map(i => [i.name.toLowerCase(), i.count]));
    const want = total(kit.map(i => [i.item.toLowerCase(), i.amount]));
    return have.size === want.size && [...want].every(([name, n]) => have.get(name) === n);
}

/** What receiveFrom waits for: each kit item by its exact name and count (`Logs` must not match `Oak logs`). */
export function wantSpecs(kit: readonly PackageItem[]): WantSpec[] {
    return kit.map(i => ({ item: new RegExp(`^${escapeRegExp(i.item)}$`, 'i'), amount: i.amount }));
}

/** Trade attempts before giving up; each waits up to LOAD_WAIT_MS for the giver to come into view. */
const LOAD_ATTEMPTS = 6;
const LOAD_WAIT_MS = 10 * 60_000;

/**
 * The receiving side of a full-pack load: tutorial, bank the starter items,
 * take the kit, park. A trade that delivered anything short of the kit is not
 * retried: the role ends with an attention line for a person.
 */
export async function loadTrip(ctx: RoleContext): Promise<RoleFinish> {
    const o = loadOptions(ctx.options.load);
    const { sdk, bot } = ctx;
    const buyer = new Buyer(ctx);
    const pack = () => sdk.getInventory();
    await buyer.prepare();
    await bot.dismissBlockingUI();
    if (sdk.getTradeState().isOpen) await bot.declineTrade();
    if (!loadedExactly(pack(), o.kit)) {
        const keep = kitHeld(pack(), o.kit) ? o.kit.map(i => i.item) : [];
        await buyer.atBank(o.bank, () => buyer.depositAllBut(keep));
        ctx.log('load: waiting for the giver', { from: o.from, kit: describe(o.kit), freeSlots: 28 - pack().length });
        for (let attempt = 1; attempt <= LOAD_ATTEMPTS && !kitHeld(pack(), o.kit) && !ctx.signal.aborted; attempt++) {
            if (!(await waitForPlayer(sdk, o.from, LOAD_WAIT_MS))) {
                ctx.log('load: giver not in view', { from: o.from, attempt });
                continue;
            }
            const r = await receiveFrom(sdk, o.from, { want: wantSpecs(o.kit), openTimeoutMs: 120_000 });
            ctx.log('load: trade', { from: o.from, attempt, ok: r.ok, reason: r.reason ?? null, received: describe(r.received), ticks: r.ticks });
            if (r.received.length > 0) break;
        }
    }
    if (!loadedExactly(pack(), o.kit)) {
        ctx.log('load: NOT loaded', { from: o.from, inventory: describe(pack()), kit: describe(o.kit) });
        return { attention: `load from ${o.from} incomplete (holds ${describe(pack()).join(', ') || 'nothing'}): read both logs before loading again` };
    }
    const parked = o.park ? await parkOn(ctx, buyer, o.park) : true;
    const p = sdk.getState()?.player;
    ctx.log('loaded', { from: o.from, kit: describe(o.kit), at: p ? { x: p.worldX, z: p.worldZ } : null, park: o.park, parked, tick: sdk.getState()?.tick ?? null });
    return parked ? {} : { attention: `loaded but not on the park tile (${o.park!.x},${o.park!.z})` };
}

/** Stand on exactly `t` (the plain walk stops within a few tiles). */
async function parkOn(ctx: RoleContext, buyer: Buyer, t: Tile): Promise<boolean> {
    const on = () => {
        const p = ctx.sdk.getState()?.player;
        return !!p && p.worldX === t.x && p.worldZ === t.z;
    };
    await buyer.walk(t);
    for (let i = 0; i < 5 && !on() && !ctx.signal.aborted; i++) {
        await ctx.bot.walkTo(t.x, t.z, 0);
        await ctx.sdk.waitForTicks(1).catch(() => {});
    }
    return on();
}

/** One name per distinct inventory item, for depositing every stack once. */
function firstNames(inventory: ReadonlyArray<{ name: string }>): string[] {
    return [...new Set(inventory.map(i => i.name))];
}

export const role: Role = {
    name: 'kits',
    produces: [],
    async run(ctx) {
        if (ctx.options.stall !== undefined) await stallTrip(ctx);
        else if (ctx.options.load !== undefined) return loadTrip(ctx);
        else await new KitGiver(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
