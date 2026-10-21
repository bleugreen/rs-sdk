// Mule, courier and hand-off giver.
//
// mule (role `mule`): one or two accounts standing at Varrock west bank. It
//   accepts trades only from courier accounts (`^cairn_h\d+$` by default) and the
//   configured scored account, deposits whatever it receives, and reports its
//   bank after every change. With `packages` configured it is also the GIVER for
//   the scored account: it holds the next package in its inventory, offers it
//   the moment a trade opens, and verifies partner and offer on both screens. With
//   `ge` configured it lists items on the Grand Exchange and collects proceeds.
//
// courier (role `courier`): any helper account can be switched to it. Banks are
//   shared across booths, so the courier walks to Varrock west bank, withdraws its
//   produce there as notes, trades it to the mule, and walks back to where it was.
//
// The scored account's side of a hand-off is `requestPackage` + `receivePackage`.
// How the run uses them, and their measured cost in ticks: docs/speedrun/helpers/mule.md.
//
// Run standalone (lite client already running for the account):
//   ROLE_OPTIONS='{...}' bun speedrun/helpers/mule.ts <account>            # mule
//   ROLE_OPTIONS='{...}' bun speedrun/helpers/mule.ts <account> courier    # courier
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { offerSatisfies } from '../../sdk/trade-helpers';
import type { BankItem, GameMessage, InventoryItem, TradeItem, TradeItemSpec } from '../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import { runStandalone, type Role, type RoleContext } from './role';

// ============ Places ============

/** Where the mule stands: inside Varrock west bank, in reach of the booths, off the GE table. */
export const MULE_STAND = { x: 3185, z: 3436 };
export const DEFAULT_COURIERS = '^cairn_h\\d+$';
const PM_RECEIVED_TYPES = [3, 7];

function onTutorialIsland(x: number, z: number): boolean {
    return x >= 3050 && x <= 3156 && z >= 3056 && z <= 3136;
}

// ============ Pure helpers (unit tested in mule.test.ts) ============

/**
 * Accounts are configured by login name (`cairn_h05`) but the game shows display
 * names (`Cairn H05`: underscores become spaces, words are title-cased). Compare
 * both in this canonical form.
 */
export function canonName(name: string): string {
    return name.trim().toLowerCase().replace(/[\s_]+/g, '_');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A RegExp that matches exactly this account's display name, for findNearbyPlayer / tradeWith. */
export function playerPattern(account: string): RegExp {
    const parts = canonName(account).split('_').filter(Boolean).map(escapeRegExp);
    return new RegExp(`^${parts.join('[ _]')}$`, 'i');
}

/** Whether a display name (or login name) matches an account-name RegExp written against login names. */
export function accountMatches(displayName: string | null | undefined, pattern: RegExp): boolean {
    if (!displayName) return false;
    return pattern.test(canonName(displayName));
}

/** Option values arrive as JSON: strings are case-insensitive RegExp sources. */
export function toRegExps(value: unknown): RegExp[] {
    const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return list.map(v => (v instanceof RegExp ? v : new RegExp(String(v), 'i')));
}

export interface PackageItem {
    /** Exact item name, case-insensitive ("Unfermented wine"). */
    item: string;
    /** How many; -1 = everything the bank has. */
    amount: number;
    /** Withdraw as banknotes (one slot per item type). Default false. */
    noted?: boolean;
}

export interface Package {
    name: string;
    items: PackageItem[];
}

export interface Withdrawal {
    bankItem: BankItem;
    amount: number;
    noted: boolean;
}

export interface PackagePlan {
    withdrawals: Withdrawal[];
    missing: { item: string; wanted: number; have: number }[];
    /** Inventory slots the package occupies once withdrawn. */
    slots: number;
}

/**
 * Map a package onto the bank. Unnoted unstackable items take one slot each; a
 * package that does not fit in 28 slots is reported as `slots > 28` for the caller
 * to refuse.
 */
export function planPackage(pkg: Package, bank: BankItem[], stackable: (name: string) => boolean = isStackableName): PackagePlan {
    const withdrawals: Withdrawal[] = [];
    const missing: PackagePlan['missing'] = [];
    let slots = 0;
    for (const spec of pkg.items) {
        const want = spec.item.trim().toLowerCase();
        const bankItem = bank.find(b => b.name.toLowerCase() === want);
        const have = bankItem?.count ?? 0;
        const amount = spec.amount === -1 ? have : spec.amount;
        if (!bankItem || amount <= 0 || have < amount) {
            missing.push({ item: spec.item, wanted: spec.amount, have });
            continue;
        }
        const noted = spec.noted ?? false;
        withdrawals.push({ bankItem, amount, noted });
        slots += noted || stackable(bankItem.name) ? 1 : amount;
    }
    return { withdrawals, missing, slots };
}

/**
 * Items that stack unnoted (coins, runes, ammunition). Bank data does not say, so
 * this only sizes a package against 28 slots; a wrong guess shows up as a failed
 * withdrawal, never as a wrong trade.
 */
export function isStackableName(name: string): boolean {
    return /^coins$| rune$|arrows?$|arrowtips$|arrowheads$|bolts$|darts?$|dart tips?$|^feathers?$|knife$|cannonballs?$/i.test(name);
}

/** Aggregate an inventory or offer into id -> count. */
export function countById(items: Array<{ id: number; count: number }>): Map<number, number> {
    const map = new Map<number, number>();
    for (const item of items) map.set(item.id, (map.get(item.id) ?? 0) + item.count);
    return map;
}

/** Exact multiset equality by item id: same ids, same counts, nothing extra. */
export function sameItems(a: Map<number, number>, b: Map<number, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, count] of a) if (b.get(id) !== count) return false;
    return true;
}

/** True when `inventory` holds at least everything in `held`. */
export function holds(inventory: Map<number, number>, held: Map<number, number>): boolean {
    for (const [id, count] of held) if ((inventory.get(id) ?? 0) < count) return false;
    return true;
}

/** One slot per distinct item id: offering "All" on it moves every item of that id. */
export function firstSlotPerId(items: InventoryItem[]): InventoryItem[] {
    const seen = new Set<number>();
    const out: InventoryItem[] = [];
    for (const item of [...items].sort((x, y) => x.slot - y.slot)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}

/** Parse a package request PM: "<name>" or "pkg <name>". */
export function parsePackageRequest(text: string, packages: Package[]): Package | null {
    const name = text.trim().replace(/^pkg\s+/i, '').toLowerCase();
    return packages.find(p => p.name.toLowerCase() === name) ?? null;
}

/** Bank items a courier should carry: every item matching a pattern, noted, up to `freeSlots` types. */
export function courierPicks(bank: BankItem[], patterns: RegExp[], freeSlots: number): BankItem[] {
    return bank
        .filter(b => b.count > 0 && patterns.some(p => p.test(b.name)))
        .slice(0, Math.max(0, freeSlots));
}

// ============ Chat cursors ============

/** Unseen messages of some chat types. Requests that land between polls are never lost. */
class ChatCursor {
    private seen: number;
    constructor(
        private readonly sdk: BotSDK,
        private readonly types: number[]
    ) {
        this.seen = this.maxKey(this.read());
    }
    private read(): GameMessage[] {
        return this.sdk.getChat({ types: this.types, limit: 100, includeSelf: false });
    }
    private key(m: GameMessage): number {
        return m.observationId ?? m.tick;
    }
    private maxKey(ms: GameMessage[]): number {
        return ms.reduce((max, m) => Math.max(max, this.key(m)), -1);
    }
    next(): GameMessage[] {
        const ms = this.read();
        const fresh = ms.filter(m => this.key(m) > this.seen);
        this.seen = Math.max(this.seen, this.maxKey(ms));
        return fresh;
    }
}

// ============ Small SDK helpers ============

function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? 0;
}

async function nextTick(sdk: BotSDK, maxMs = 2_000): Promise<void> {
    const t = tick(sdk);
    await sdk.waitForCondition(s => s.tick > t, maxMs).catch(() => {});
}

function freeSlots(sdk: BotSDK): number {
    return 28 - sdk.getInventory().length;
}

function bankSnapshot(sdk: BotSDK) {
    return { items: sdk.getBankItems().map(b => ({ id: b.id, name: b.name, count: b.count })) };
}

async function ensureOutOfTutorial(ctx: RoleContext): Promise<void> {
    const { sdk, bot } = ctx;
    await sdk.waitForReady(30_000).catch(() => {});
    for (let i = 0; i < 30; i++) {
        const p = sdk.getState()?.player;
        if (p && !onTutorialIsland(p.worldX, p.worldZ)) return;
        if (i === 0) ctx.log('skipping tutorial', { x: p?.worldX, z: p?.worldZ });
        await bot.skipTutorial();
        await sdk.waitForTicks(2).catch(() => {});
    }
    throw new Error('Could not leave the tutorial');
}

function distanceTo(sdk: BotSDK, x: number, z: number): number {
    const p = sdk.getState()?.player;
    if (!p) return Infinity;
    return Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - z));
}

async function walkNear(ctx: RoleContext, x: number, z: number, tolerance: number): Promise<boolean> {
    for (let attempt = 0; attempt < 5 && distanceTo(ctx.sdk, x, z) > tolerance; attempt++) {
        if (ctx.signal.aborted) return false;
        const p = ctx.sdk.getState()?.player;
        ctx.log('walking', { from: p ? [p.worldX, p.worldZ] : null, to: [x, z] });
        const r = await ctx.bot.walkTo(x, z, tolerance);
        if (!r.success) ctx.log('walk failed', { x, z, message: r.message });
    }
    return distanceTo(ctx.sdk, x, z) <= tolerance;
}

async function openBank(ctx: RoleContext): Promise<boolean> {
    if (ctx.sdk.isBankOpen()) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
        const r = await ctx.bot.openBank();
        if (r.success) return true;
        ctx.log('openBank failed', { message: r.message });
        await ctx.sdk.waitForTicks(2).catch(() => {});
    }
    return false;
}

async function closeBank(ctx: RoleContext): Promise<void> {
    if (ctx.sdk.isBankOpen()) await ctx.bot.closeBank();
}

/**
 * Deposit every inventory item whose id is not in `keep`, one "All" per item id,
 * sent without waiting between them (the server drains 5 per tick in order), then
 * confirmed once from state. Kept separate so it can switch to speedrun/lib/bank.ts.
 */
export async function depositAllExcept(sdk: BotSDK, keep: Map<number, number> = new Map()): Promise<boolean> {
    const targets = firstSlotPerId(sdk.getInventory()).filter(i => !keep.has(i.id));
    if (targets.length === 0) return true;
    await Promise.all(targets.map(i => sdk.sendBankDeposit(i.slot, -1)));
    const ids = new Set(targets.map(i => i.id));
    try {
        await sdk.waitForCondition(s => !s.inventory.some(i => ids.has(i.id)), 5_000 + targets.length * 400);
        return true;
    } catch {
        return false;
    }
}

// ============ Giver ============

export type GiverMode = 'burst' | 'stock';

export interface GiveResult {
    success: boolean;
    message: string;
    /** Server ticks from the trade being open to the items leaving this inventory. */
    ticks: number;
    gave: TradeItem[];
    received: TradeItem[];
}

function diffItems(before: InventoryItem[], after: InventoryItem[]): { gained: TradeItem[]; lost: TradeItem[] } {
    const b = countById(before);
    const a = countById(after);
    const names = new Map<number, string>();
    for (const i of [...before, ...after]) names.set(i.id, i.name);
    const gained: TradeItem[] = [];
    const lost: TradeItem[] = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const d = (a.get(id) ?? 0) - (b.get(id) ?? 0);
        const name = names.get(id) ?? 'Unknown';
        if (d > 0) gained.push({ slot: -1, id, name, count: d });
        if (d < 0) lost.push({ slot: -1, id, name, count: -d });
    }
    return { gained, lost };
}

/**
 * Give `items` (inventory entries; all of each id) to `partner` in the trade that
 * is already open with them. The one function both modes sit behind, so the
 * implementation can switch to speedrun/lib/trade.ts when it lands.
 *
 * burst: one "Offer All" per item id plus the accept, sent back to back; the
 *   server drains them 5 per tick in order, so the accept lands after the last
 *   offer. Then once per tick: re-accept if the partner's offer changed, and on
 *   both screens check the partner is exactly `partner` and our offer is exactly
 *   `items` before accepting; any mismatch declines (nothing changes hands).
 * stock: the SDK's bot.trade (offers one item at a time, waiting for each).
 */
export async function giveOpenTrade(
    sdk: BotSDK,
    bot: BotActions,
    partner: string,
    items: InventoryItem[],
    mode: GiverMode = 'burst',
    timeoutMs = 60_000
): Promise<GiveResult> {
    const startTick = tick(sdk);
    const invBefore = sdk.getInventory();
    const expected = countById(items);
    const done = (success: boolean, message: string): GiveResult => {
        const { gained, lost } = diffItems(invBefore, sdk.getInventory());
        return { success, message, ticks: tick(sdk) - startTick, gave: lost, received: gained };
    };

    const open = sdk.getTradeState();
    if (!open.isOpen || !accountMatches(open.partner, new RegExp(`^${escapeRegExp(canonName(partner))}$`))) {
        return done(false, `No trade open with ${partner} (open: ${open.isOpen}, partner: ${open.partner})`);
    }

    if (mode === 'stock') {
        const names = firstSlotPerId(items).map(i => ({ item: new RegExp(`^${escapeRegExp(i.name)}$`, 'i'), amount: -1 }));
        const r = await bot.trade(playerPattern(partner), { give: names, timeout: timeoutMs });
        return { success: r.success, message: r.message, ticks: tick(sdk) - startTick, gave: r.gave, received: r.received };
    }

    const exactPartner = new RegExp(`^${escapeRegExp(canonName(partner))}$`);
    const deadline = Date.now() + timeoutMs;
    const decline = async (why: string) => {
        await bot.declineTrade();
        return done(false, `Declined: ${why}`);
    };

    const slots = firstSlotPerId(items);
    await Promise.all([...slots.map(i => sdk.sendOfferItem(i.slot, -1)), sdk.sendAcceptTrade()]);
    let lastAcceptTick = tick(sdk);
    let lastReofferTick = tick(sdk);
    let closedTicks = 0;

    while (Date.now() < deadline) {
        await nextTick(sdk);
        const t = sdk.getTradeState();
        const now = tick(sdk);
        if (!t.isOpen) {
            // The offer->confirm switch closes the side modal for a moment; only two
            // ticks without a screen mean the session ended.
            if (++closedTicks < 2) continue;
            const inv = countById(sdk.getInventory());
            const gone = [...expected].every(([id, n]) => (inv.get(id) ?? 0) <= (countById(invBefore).get(id) ?? 0) - n);
            return done(gone, gone ? `Gave package to ${partner}` : 'Trade closed before completion');
        }
        closedTicks = 0;
        if (!accountMatches(t.partner, exactPartner)) return decline(`partner is ${t.partner}, expected ${partner}`);
        const mine = countById(t.myOffer);
        if (t.screen === 'offer') {
            for (const id of mine.keys()) if (!expected.has(id)) return decline('our offer holds an item outside the package');
            if (!sameItems(mine, expected)) {
                // An offer the server dropped (packet lost or refused) is re-sent after 3 quiet ticks.
                if (now - lastReofferTick >= 3) {
                    lastReofferTick = now;
                    const inv = sdk.getInventory().filter(i => expected.has(i.id) && (mine.get(i.id) ?? 0) < expected.get(i.id)!);
                    await Promise.all(firstSlotPerId(inv).map(i => sdk.sendOfferItem(i.slot, -1)));
                }
                continue;
            }
            if (!t.myAccepted && now !== lastAcceptTick) {
                lastAcceptTick = now;
                await sdk.sendAcceptTrade();
            }
        } else if (t.screen === 'confirm') {
            if (!sameItems(mine, expected)) return decline('confirm screen offer differs from the package');
            if (!t.myAccepted && now !== lastAcceptTick) {
                lastAcceptTick = now;
                await sdk.sendAcceptTrade();
            }
        }
    }
    return decline('timed out');
}

// ============ Receiver (the scored account's side) ============

export interface ReceiveOptions {
    /** The mule's account name. */
    mule: string;
    /**
     * What the offer must contain before accepting (re-checked on the confirm
     * screen). Without it, the receiver accepts once the mule has accepted its own
     * offer, which the burst giver does right after its last item.
     */
    want?: TradeItemSpec[];
    timeoutMs?: number;
}

export interface ReceiveResult {
    success: boolean;
    message: string;
    /** Ticks on this account's clock from the trade request to the items in the inventory. */
    ticks: number;
    received: TradeItem[];
}

/**
 * Ask the mule for a named package by private message. Send it early (before
 * walking to the bank); it costs no ticks, and the mule withdraws the package and
 * pre-requests a trade while this account is on its way.
 */
export async function requestPackage(sdk: BotSDK, mule: string, packageName: string): Promise<void> {
    await sdk.sendPrivateMessage(mule, packageName);
}

/**
 * Receive a package from the mule. Sends one trade request (which opens the
 * trade at once when the mule has already requested this account), accepts the
 * moment the offer is complete, re-verifies on the confirm screen, and returns
 * when the items are in the inventory. Gives nothing.
 */
export async function receivePackage(sdk: BotSDK, bot: BotActions, options: ReceiveOptions): Promise<ReceiveResult> {
    const startTick = tick(sdk);
    const invBefore = sdk.getInventory();
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    const exact = new RegExp(`^${escapeRegExp(canonName(options.mule))}$`);
    const result = (success: boolean, message: string): ReceiveResult => ({
        success,
        message,
        ticks: tick(sdk) - startTick,
        received: diffItems(invBefore, sdk.getInventory()).gained
    });

    // retryOnBusy: the mule is briefly "busy" while its bank is open (re-arming the next package).
    const opened = await bot.tradeWith(playerPattern(options.mule), Math.max(1, deadline - Date.now()), { retryOnBusy: true });
    if (!opened.success) return result(false, opened.message);

    const complete = (offer: TradeItem[], partnerAccepted: boolean): boolean =>
        offer.length > 0 && (options.want ? offerSatisfies(options.want, offer) : partnerAccepted);

    let lastAcceptTick = -1;
    let closedTicks = 0;
    let theirFinal: TradeItem[] = [];
    while (Date.now() < deadline) {
        const t = sdk.getTradeState();
        const now = tick(sdk);
        if (!t.isOpen) {
            const got = countById(diffItems(invBefore, sdk.getInventory()).gained);
            if (theirFinal.length > 0 && holds(got, countById(theirFinal))) return result(true, 'Received package');
            if (++closedTicks >= 3) return result(false, 'Trade closed before completion');
        } else {
            closedTicks = 0;
            if (!accountMatches(t.partner, exact)) {
                await bot.declineTrade();
                return result(false, `Declined: partner is ${t.partner}`);
            }
            if (t.screen === 'offer' && complete(t.theirOffer, t.partnerAccepted) && !t.myAccepted && now !== lastAcceptTick) {
                lastAcceptTick = now;
                await sdk.sendAcceptTrade();
            } else if (t.screen === 'confirm') {
                if (options.want && !offerSatisfies(options.want, t.theirOffer)) {
                    await bot.declineTrade();
                    return result(false, 'Declined: confirm screen offer does not satisfy want');
                }
                theirFinal = t.theirOffer;
                if (!t.myAccepted && now !== lastAcceptTick) {
                    lastAcceptTick = now;
                    await sdk.sendAcceptTrade();
                }
            }
        }
        // Wait on any state update, not only a new tick: the inventory update and the
        // screen change can land mid-tick and the result should be observed at once.
        await sdk.waitForStateChange(1_000).catch(() => {});
    }
    if (sdk.getTradeState().isOpen) await bot.declineTrade();
    return result(false, 'Timed out');
}

// ============ Mule ============

export interface GeOrder {
    /** Exact item name as in the bank. */
    item: string;
    quantity: number | 'all';
    /** Price per item in coins. */
    price: number;
    /**
     * Fill the scored account's standing buy offer: list only while the market's
     * best bid equals `price` (so the fill goes to that bidder, not a higher one).
     */
    fill?: boolean;
}

export interface MuleOptions {
    /** The scored account served with packages (and allowed to trade). */
    serve?: string;
    /** Courier account-name RegExp source(s), matched against login names. */
    couriers?: string | string[];
    packages?: Package[];
    /** 'order': serve packages in order, one per trade from `serve`. 'request': only after a PM naming one. */
    serveMode?: 'order' | 'request';
    giver?: GiverMode;
    /** Send `serve` a trade request when a package is ready and it comes within 12 tiles. Default true. */
    preRequest?: boolean;
    stand?: { x: number; z: number };
    ge?: { orders?: GeOrder[]; collectEveryMin?: number };
}

function muleOptions(raw: Record<string, unknown>): Required<Omit<MuleOptions, 'serve' | 'ge'>> & Pick<MuleOptions, 'serve' | 'ge'> {
    const o = raw as MuleOptions;
    const packages = (o.packages ?? []).map(p => ({
        name: String(p.name),
        items: p.items.map(i => ({ item: String(i.item), amount: Number(i.amount), noted: Boolean(i.noted) }))
    }));
    for (const p of packages) {
        for (const i of p.items) if (!Number.isInteger(i.amount) || (i.amount < 1 && i.amount !== -1)) throw new Error(`Package ${p.name}: bad amount for ${i.item}`);
    }
    return {
        serve: o.serve,
        couriers: o.couriers ?? DEFAULT_COURIERS,
        packages,
        serveMode: o.serveMode ?? 'order',
        giver: o.giver ?? 'burst',
        preRequest: o.preRequest ?? true,
        stand: o.stand ?? MULE_STAND,
        ge: o.ge
    };
}

class Mule {
    private readonly o: ReturnType<typeof muleOptions>;
    private readonly courierPatterns: RegExp[];
    private readonly requests: ChatCursor;
    private readonly pms: ChatCursor;
    /** Package to serve next, or null. */
    private pending: Package | null = null;
    private nextIndex = 0;
    /** Ids/counts of the pending package while it sits in the inventory. */
    private held: Map<number, number> | null = null;
    private shortSince = 0;
    private needsBank = true;
    private lastPreRequest = 0;
    private lastGeCollect = 0;
    private readonly geDone = new Set<string>();

    constructor(private readonly ctx: RoleContext) {
        this.o = muleOptions(ctx.options);
        this.courierPatterns = toRegExps(this.o.couriers);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
        this.pms = new ChatCursor(ctx.sdk, PM_RECEIVED_TYPES);
        if (this.o.serveMode === 'order') this.pending = this.o.packages[0] ?? null;
    }

    private isServe(name: string | null | undefined): boolean {
        return !!this.o.serve && canonName(name ?? '') === canonName(this.o.serve);
    }

    private isCourier(name: string | null | undefined): boolean {
        return this.courierPatterns.some(p => accountMatches(name, p));
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        await walkNear(ctx, this.o.stand.x, this.o.stand.z, 3);
        ctx.log('mule ready', { serve: this.o.serve, packages: this.o.packages.map(p => p.name), giver: this.o.giver, serveMode: this.o.serveMode });

        while (!ctx.signal.aborted) {
            try {
                await this.cycle();
            } catch (e) {
                ctx.log('cycle error', { error: String(e) });
                await ctx.sdk.waitForTicks(5).catch(() => {});
            }
        }
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        await closeBank(ctx);
    }

    private async cycle(): Promise<void> {
        const { ctx } = this;
        const { sdk } = ctx;

        // 1. Package requests by PM from the scored account.
        for (const pm of this.pms.next()) {
            if (!this.isServe(pm.sender)) continue;
            const pkg = parsePackageRequest(pm.text, this.o.packages);
            ctx.log('package request', { from: pm.sender, text: pm.text, found: pkg?.name ?? null });
            if (pkg && pkg !== this.pending) {
                this.pending = pkg;
                this.held = null;
                this.shortSince = 0;
            }
        }

        // 2. Trade requests: the scored account first, then couriers; anyone else is ignored.
        const requesters = [...new Set(this.requests.next().map(m => m.sender))];
        requesters.sort((a, b) => Number(this.isServe(b)) - Number(this.isServe(a)));
        for (const name of requesters) {
            if (this.isServe(name)) await this.serveTrade(name);
            else if (this.isCourier(name)) await this.courierTrade(name);
            else ctx.log('ignored trade request', { from: name });
        }
        // A request that raced the cursor can leave a screen open.
        const open = sdk.getTradeState();
        if (open.isOpen) {
            if (this.isServe(open.partner)) await this.serveTrade(open.partner!);
            else if (this.isCourier(open.partner)) await this.courierTrade(open.partner!);
            else await ctx.bot.declineTrade();
        }

        // 3. Housekeeping between trades.
        if (this.needsBank || this.wantsPackage()) await this.bankCycle();
        if (this.o.ge && Date.now() - this.lastGeCollect > (this.o.ge.collectEveryMin ?? 10) * 60_000) await this.geCycle();
        this.preRequest();
        if (Date.now() - this.lastPreRequest > 20_000 && distanceTo(sdk, this.o.stand.x, this.o.stand.z) > 3 && !sdk.getTradeState().isOpen) {
            await walkNear(ctx, this.o.stand.x, this.o.stand.z, 3);
        }
        await nextTick(sdk);
    }

    private wantsPackage(): boolean {
        if (!this.pending || this.held) return false;
        // A package the bank cannot fill is re-checked once a minute, not every tick.
        return this.shortSince === 0 || Date.now() - this.shortSince > 60_000;
    }

    private packageReady(): boolean {
        return !!this.pending && !!this.held && holds(countById(this.ctx.sdk.getInventory()), this.held);
    }

    private preRequest(): void {
        const { sdk } = this.ctx;
        if (!this.o.preRequest || !this.o.serve || !this.packageReady()) return;
        if (Date.now() - this.lastPreRequest < 15_000) return;
        const target = sdk.findNearbyPlayer(playerPattern(this.o.serve));
        if (!target || target.distance > 12) return;
        this.lastPreRequest = Date.now();
        // Fire and forget: the scored account sees "wishes to trade", and its own
        // request then opens the trade on the tick it lands.
        void sdk.sendTradeRequest(target.index);
        this.ctx.log('pre-requested', { serve: this.o.serve, package: this.pending?.name });
    }

    /** Deposit everything that is not the held package, report the bank, and withdraw the pending package. */
    private async bankCycle(): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        if (sdk.getTradeState().isOpen) return;
        if (!(await openBank(ctx))) return;
        const keep = this.packageReady() ? this.held! : new Map<number, number>();
        if (!(await depositAllExcept(sdk, keep))) ctx.log('deposit incomplete', { inventory: sdk.getInventory().map(i => `${i.name} x${i.count}`) });
        if (!this.packageReady()) this.held = null;

        if (this.pending && !this.held) {
            const plan = planPackage(this.pending, sdk.getBankItems());
            if (plan.missing.length || plan.slots > 28) {
                if (this.shortSince === 0) ctx.log('package short', { package: this.pending.name, missing: plan.missing, slots: plan.slots });
                this.shortSince = Date.now();
            } else {
                let ok = true;
                for (const w of plan.withdrawals) {
                    const r = await bot.withdrawItem(w.bankItem, w.amount, { asNote: w.noted });
                    if (!r.success) {
                        ok = false;
                        ctx.log('withdraw failed', { item: w.bankItem.name, amount: w.amount, message: r.message });
                        break;
                    }
                }
                if (ok) {
                    this.held = countById(sdk.getInventory());
                    this.shortSince = 0;
                    ctx.log('package ready', { package: this.pending.name, items: sdk.getInventory().map(i => `${i.name} x${i.count}`) });
                } else {
                    await depositAllExcept(sdk);
                    this.shortSince = Date.now();
                }
            }
        }
        ctx.reportBank(bankSnapshot(sdk));
        this.needsBank = false;
        await closeBank(ctx);
    }

    private async openTradeWith(name: string): Promise<boolean> {
        const { sdk, bot } = this.ctx;
        const t = sdk.getTradeState();
        if (t.isOpen && canonName(t.partner ?? '') === canonName(name)) return true;
        await closeBank(this.ctx);
        const r = await bot.tradeWith(playerPattern(name), 15_000, { retryOnBusy: true });
        if (!r.success) this.ctx.log('trade open failed', { with: name, message: r.message });
        return r.success;
    }

    private async serveTrade(name: string): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        if (!this.packageReady()) {
            // Nothing to give: take what the scored account hands back.
            await this.receiveFrom(name);
            return;
        }
        if (!(await this.openTradeWith(name))) return;
        const pkg = this.pending!;
        const items = sdk.getInventory().filter(i => this.held!.has(i.id));
        // 30 s, not 60: a pre-request can open a trade the scored account did not ask for
        // yet (it accepts a stale request of theirs), and that screen must not linger.
        const r = await giveOpenTrade(sdk, bot, this.o.serve!, items, this.o.giver, 30_000);
        ctx.log('hand-off', {
            to: name,
            package: pkg.name,
            success: r.success,
            giverTicks: r.ticks,
            stacks: this.held!.size,
            mode: this.o.giver,
            result: r.message,
            received: r.received.map(i => `${i.name} x${i.count}`)
        });
        if (r.success) {
            this.held = null;
            if (this.o.serveMode === 'order') {
                this.nextIndex++;
                this.pending = this.o.packages[this.nextIndex] ?? null;
            } else {
                this.pending = null;
            }
        }
        this.needsBank = true;
    }

    private async courierTrade(name: string): Promise<void> {
        const { ctx } = this;
        // Room for a full courier load: bank the held package if it crowds the inventory.
        if (freeSlots(ctx.sdk) < 24 && !ctx.sdk.getTradeState().isOpen) {
            if (await openBank(ctx)) {
                await depositAllExcept(ctx.sdk);
                this.held = null;
                await closeBank(ctx);
            }
        }
        await this.receiveFrom(name);
    }

    private async receiveFrom(name: string): Promise<void> {
        const { ctx } = this;
        if (!(await this.openTradeWith(name))) return;
        // Give nothing, accept any non-empty offer: couriers and the scored account only
        // hand stock in. A session that stays empty is declined so it cannot hold the mule.
        const r = await ctx.bot.trade(playerPattern(name), {
            accept: offer => offer.length > 0,
            rejectAfterMs: 30_000,
            timeout: 90_000,
            requestTimeout: 5_000
        });
        ctx.log('received', {
            from: name,
            success: r.success,
            result: r.message,
            received: r.received.map(i => `${i.name} x${i.count}`),
            gave: r.gave.map(i => `${i.name} x${i.count}`)
        });
        if (r.success) this.needsBank = true;
    }

    // ---- Grand Exchange ----

    private async geCycle(): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        this.lastGeCollect = Date.now();
        if (sdk.getTradeState().isOpen) return;
        await closeBank(ctx);
        const opened = await bot.openGE();
        if (!opened.success) {
            ctx.log('GE open failed', { message: opened.message });
            return;
        }
        const offers = sdk.getGEState()?.offers ?? [];
        if (offers.some(o => o.items > 0 || o.coins > 0)) {
            const c = await bot.collectGE();
            ctx.log('GE collected', { success: c.success, items: c.items, coins: c.coins, message: c.message });
            this.needsBank = true;
        }
        const listed = new Set(
            (sdk.getGEState()?.offers ?? []).filter(o => o.side === 'sell' && o.state === 'open').map(o => `${o.item}@${o.price}`)
        );
        await bot.closeInterface();

        for (const order of this.o.ge?.orders ?? []) {
            const key = `${order.item}@${order.price}`;
            if (this.geDone.has(key)) continue;
            await this.geSell(order, listed);
        }
        // Proceeds and unsold notes go back to the bank on the next bank cycle.
        if (sdk.getInventory().some(i => !this.held?.has(i.id))) this.needsBank = true;
    }

    private async geSell(order: GeOrder, listed: Set<string>): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        const key = `${order.item}@${order.price}`;
        if (!(await openBank(ctx))) return;
        const bankItem = sdk.getBankItems().find(b => b.name.toLowerCase() === order.item.toLowerCase());
        if (!bankItem) {
            await closeBank(ctx);
            ctx.log('GE: nothing to sell', { item: order.item });
            return;
        }
        if (listed.has(`${bankItem.id}@${order.price}`)) {
            this.geDone.add(key);
            await closeBank(ctx);
            return;
        }
        let quantity = order.quantity === 'all' ? bankItem.count : Math.min(order.quantity, bankItem.count);
        if (order.fill) {
            const quote = await sdk.getMarketItem(bankItem.id).catch(() => null);
            if (!quote || quote.bid !== order.price) {
                await closeBank(ctx);
                ctx.log('GE fill: best bid is not the expected price, not listing', { item: order.item, bid: quote?.bid ?? null, price: order.price });
                return;
            }
            quantity = Math.min(quantity, quote.buyQuantity ?? quantity);
        }
        const w = await bot.withdrawItem(bankItem, quantity, { asNote: true });
        ctx.reportBank(bankSnapshot(sdk));
        await closeBank(ctx);
        if (!w.success) {
            ctx.log('GE: withdraw failed', { item: order.item, message: w.message });
            this.needsBank = true;
            return;
        }
        const opened = await bot.openGE();
        if (!opened.success) {
            ctx.log('GE open failed', { message: opened.message });
            this.needsBank = true;
            return;
        }
        const placed = await bot.placeGEOffer({ item: bankItem.id, side: 'sell', quantity: w.amountWithdrawn ?? quantity, price: order.price });
        ctx.log('GE sell', { item: order.item, quantity: w.amountWithdrawn ?? quantity, price: order.price, success: placed.success, outcome: placed.outcome, message: placed.message });
        if (placed.success) this.geDone.add(key);
        await bot.closeInterface();
        this.needsBank = true;
    }
}

export const role: Role = {
    name: 'mule',
    produces: [],
    async run(ctx) {
        await new Mule(ctx).run();
    }
};

// ============ Courier ============

export interface CourierOptions {
    mule: string;
    /** Item-name RegExp sources, case-insensitive. */
    items: string | string[];
    /** Make the trip only when the bank holds at least this many matching item types. Default 1. */
    minStacks?: number;
    /** Walk back to where the trip started. Default true. */
    returnHome?: boolean;
}

/**
 * One courier trip. Safe to restart at any point: an open trade is declined
 * (both sides keep their items), notes already carried are offered first, and
 * the bank is the source of truth for what is left to carry.
 */
export async function courierTrip(ctx: RoleContext): Promise<{ trades: number; carried: string[] }> {
    const o = ctx.options as unknown as CourierOptions;
    if (!o.mule) throw new Error('courier: options.mule is required');
    const patterns = toRegExps(o.items);
    if (patterns.length === 0) throw new Error('courier: options.items is required');
    const minStacks = o.minStacks ?? 1;
    const { sdk, bot } = ctx;
    const carried: string[] = [];
    let trades = 0;

    await ensureOutOfTutorial(ctx);
    await bot.dismissBlockingUI();
    if (sdk.getTradeState().isOpen) await bot.declineTrade();
    const p = sdk.getState()?.player;
    if (!p) throw new Error('courier: no player state');
    const home = { x: p.worldX, z: p.worldZ };
    const matching = () => sdk.getInventory().filter(i => patterns.some(re => re.test(i.name)));
    const keepNonMatching = () => countById(sdk.getInventory().filter(i => !patterns.some(re => re.test(i.name))));

    if (!(await walkNear(ctx, MULE_STAND.x, MULE_STAND.z, 4))) throw new Error('courier: could not reach Varrock west bank');

    for (let round = 0; round < 20 && !ctx.signal.aborted; round++) {
        if (!(await openBank(ctx))) throw new Error('courier: could not open the bank');
        // Matching items already carried (produce, or notes from an interrupted trip)
        // go in first: the bank un-notes them, and everything comes back out as notes.
        if (matching().length) await depositAllExcept(sdk, keepNonMatching());
        const picks = courierPicks(sdk.getBankItems(), patterns, freeSlots(sdk));
        if (round === 0 && picks.length + matching().length < minStacks) {
            ctx.log('courier: not enough stock to carry', { stacks: picks.length, minStacks });
            ctx.reportBank(bankSnapshot(sdk));
            await closeBank(ctx);
            break;
        }
        for (const b of picks) {
            const r = await bot.withdrawItem(b, -1, { asNote: true });
            if (!r.success) ctx.log('courier: withdraw failed', { item: b.name, message: r.message });
        }
        ctx.reportBank(bankSnapshot(sdk));
        await closeBank(ctx);

        const give = matching();
        if (give.length === 0) break;
        const mule = sdk.findNearbyPlayer(playerPattern(o.mule));
        if (!mule) {
            ctx.log('courier: mule not in sight; banking the notes again', { mule: o.mule });
            if (await openBank(ctx)) {
                await depositAllExcept(sdk, keepNonMatching());
                ctx.reportBank(bankSnapshot(sdk));
                await closeBank(ctx);
            }
            break;
        }
        const r = await bot.trade(playerPattern(o.mule), {
            give: firstSlotPerId(give).map(i => ({ item: new RegExp(`^${escapeRegExp(i.name)}$`, 'i'), amount: -1 })),
            requestTimeout: 60_000,
            timeout: 60_000,
            retryOnBusy: true
        });
        ctx.log('courier: trade', { success: r.success, message: r.message, gave: r.gave.map(i => `${i.name} x${i.count}`) });
        if (!r.success) break;
        trades++;
        carried.push(...r.gave.map(i => `${i.name} x${i.count}`));
        // Another round only if the bank still holds matching stock.
        if (!(await openBank(ctx))) break;
        const left = courierPicks(sdk.getBankItems(), patterns, 28);
        ctx.reportBank(bankSnapshot(sdk));
        if (left.length === 0) {
            await closeBank(ctx);
            break;
        }
    }

    // Anything matching still carried (a failed trade) goes back to the bank.
    if (matching().length && (await openBank(ctx))) {
        await depositAllExcept(sdk, keepNonMatching());
        ctx.reportBank(bankSnapshot(sdk));
    }
    await closeBank(ctx);
    if (o.returnHome !== false) await walkNear(ctx, home.x, home.z, 3);
    ctx.log('courier: trip done', { trades, carried });
    return { trades, carried };
}

export const courier: Role = {
    name: 'courier',
    produces: [],
    async run(ctx) {
        await courierTrip(ctx);
    }
};

export const roles: Role[] = [role, courier];

if (import.meta.main) await runStandalone(process.argv[3] === 'courier' ? courier : role);
