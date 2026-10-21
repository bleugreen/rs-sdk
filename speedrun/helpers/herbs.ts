// Herb gatherer: kills chaos druids for herbs (irit is the line that matters), does Druidic
// Ritual, identifies the herbs and makes unfinished potions at the bank, and reports.
// Built on the bone collector's combat engine (bones.ts: training on cows, fishing for food,
// fighting, looting, banking), pointed at a chaos-druid spot.
//
//   bun speedrun/helpers/herbs.ts <account>
//   ROLE_OPTIONS='{"spot":"chaos_druids_taverley","train":40}' bun speedrun/helpers/herbs.ts <account>
//
// Stages, chosen afresh from observed state every cycle:
//   1. tutorial, combat training, fishing kit   (bones.ts)
//   2. Druidic Ritual  the four raw meats near Lumbridge, Kaqemeex, Sanfew, the Cauldron of
//                      Thunder in Taverley dungeon (two animated suits of armour guard its
//                      door), Sanfew, Kaqemeex. Done when Herblore is above 1.
//   3. herbs           farm the spot (bones.ts); after each bank visit, identify every herb
//                      the level allows and mix irit (Herblore 45) and guam leaves with vials
//                      of water into unfinished potions.
// Options are the bone collector's (train, fish, eatAt, ...) plus `spot` (chaos_druids:
// Edgeville dungeon, 11 spawns, Wilderness 1-3; chaos_druids_taverley: 6 spawns), `ritual`
// (default true), `process` (default true), `guamUnf` (guam unfinished potions to make,
// default 41). docs/speedrun/helpers/herbs.md has the sources and the measured rates.
import type { InventoryItem, NearbyLoc } from '../../sdk/types';
import type { BankSnapshot, Role, RoleContext } from './role';
import { runStandalone } from './role';
import { Run, parseOptions as bonesOptions } from './bones';

interface Tile { x: number; z: number }
interface Box { x1: number; z1: number; x2: number; z2: number }
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const inBox = (b: Box, t: Tile) => t.x >= b.x1 && t.x <= b.x2 && t.z >= b.z1 && t.z <= b.z2;
const sleepTicks = (run: Run, n: number) => run.sdk.waitForTicks(n);

// ---------------------------------------------------------------------------
// Items (ids from server/content/pack/obj.pack)
// ---------------------------------------------------------------------------

/** Unidentified herbs by item id. Every one of them is named "Herb" in game. */
export const UNID_HERBS: Readonly<Record<number, string>> = {
    199: 'guam', 201: 'marrentill', 203: 'tarromin', 205: 'harralander', 207: 'ranarr', 209: 'irit',
    211: 'avantoe', 213: 'kwuarm', 215: 'cadantine', 217: 'dwarf weed', 219: 'torstol',
    2485: 'lantadyme', 3049: 'toadflax', 3051: 'snapdragon'
};
/** Herblore level to identify each herb (herbs.obj identified_herb_level; guam has none, so the level-3 default). */
export const IDENTIFY_LEVEL: Readonly<Record<string, number>> = {
    guam: 3, marrentill: 5, tarromin: 11, harralander: 20, ranarr: 25, toadflax: 30, irit: 40, avantoe: 48,
    kwuarm: 54, snapdragon: 59, cadantine: 65, lantadyme: 67, 'dwarf weed': 70, torstol: 75
};
/**
 * Unfinished potions the role can make: clean herb id, unfinished potion id, Herblore level
 * (brew_potion.struct), and the finished potion's secondary. Every unfinished potion is named
 * "Unfinished potion"; only the id tells them apart.
 */
export const UNF: Readonly<Record<string, { herb: number; unf: number; level: number; secondary: string }>> = {
    guam: { herb: 249, unf: 91, level: 3, secondary: 'eye of newt (attack, 25 base)' },
    marrentill: { herb: 251, unf: 93, level: 5, secondary: 'unicorn horn dust (antipoison, 37.5)' },
    tarromin: { herb: 253, unf: 95, level: 12, secondary: 'limpwurt root (strength, 50)' },
    harralander: { herb: 255, unf: 97, level: 22, secondary: 'chocolate dust (energy, 67.5)' },
    ranarr: { herb: 257, unf: 99, level: 30, secondary: 'snape grass (prayer, 87.5)' },
    irit: { herb: 259, unf: 101, level: 45, secondary: 'eye of newt (super attack, 100)' },
    avantoe: { herb: 261, unf: 103, level: 50, secondary: 'snape grass (fishing, 112.5)' },
    kwuarm: { herb: 263, unf: 105, level: 55, secondary: 'limpwurt root (super strength, 125)' }
};
/**
 * Herbs made into unfinished potions by default: the herb-table mix the run trains on
 * (docs/speedrun/research/supply-fallbacks.md section 5). Marrentill is left out: its
 * secondary, unicorn horn dust, is scarce.
 */
const DEFAULT_UNF = ['kwuarm', 'avantoe', 'irit', 'ranarr', 'harralander', 'tarromin', 'guam'];
const VIAL_OF_WATER = 227;
const EMPTY_VIAL = 229;
const EYE_OF_NEWT = 221;
const COINS = 995;
/** Herbs whose potion takes an eye of newt (attack, super attack). */
const NEWT_HERBS = ['guam', 'irit'];
const HERB_NAME = /^herb$/i;

/** True when Herblore can identify the unidentified herb with this id. */
export function canIdentify(id: number, herblore: number): boolean {
    const herb = UNID_HERBS[id];
    return herb !== undefined && herblore >= (IDENTIFY_LEVEL[herb] ?? 99);
}

const HERB_SPOTS = ['chaos_druids', 'chaos_druids_taverley'];

/**
 * Loot on top of the herbs. Vials of water (10/128 kills) feed the unfinished potions;
 * the rest are small stackables. Bones and the druids' junk stay on the floor.
 */
const HERB_LOOT = '^(vial of water|coins|law rune|nature rune|snape grass|limpwurt root)$';

export function herbOptions(raw: Record<string, unknown>) {
    const spot = typeof raw.spot === 'string' ? raw.spot : 'chaos_druids';
    if (!HERB_SPOTS.includes(spot)) throw new Error(`herbs: spot must be one of ${HERB_SPOTS.join(', ')} (got '${spot}')`);
    return {
        bones: bonesOptions({ train: 40, loot: HERB_LOOT, ...raw, spot }),
        reportMinutes: typeof raw.reportMinutes === 'number' ? raw.reportMinutes : 10,
        ritual: raw.ritual !== false,
        process: raw.process !== false,
        unf: unfList(raw.unf),
        /** Shop trips to Jatix (vials, eyes of newt) from the Falador west bank. */
        supply: raw.supply !== false,
        /** Start a shop trip once this many vials and eyes of newt together are wanted. */
        supplyBatch: typeof raw.supplyBatch === 'number' ? raw.supplyBatch : 20,
        /** Fixed eye of newt target; by default one per guam and irit held. */
        eyes: typeof raw.eyes === 'number' ? raw.eyes : undefined
    };
}
type HerbOptions = ReturnType<typeof herbOptions>;

/** `unf` option: herb names to mix, highest level first (vials of water are the scarce input). */
export function unfList(raw: unknown): string[] {
    const names = Array.isArray(raw) ? raw.map(String) : DEFAULT_UNF;
    for (const n of names) if (!UNF[n]) throw new Error(`herbs: unknown unf herb '${n}' (known: ${Object.keys(UNF).join(', ')})`);
    return [...names].sort((a, b) => UNF[b]!.level - UNF[a]!.level);
}

/** The next unfinished potion to mix: the highest-level herb in the bank that the level allows, if there are vials. */
export function nextMix(bank: readonly { id: number; count: number }[], herblore: number, herbs: readonly string[]): { herb: number; unf: number } | null {
    const count = (id: number) => bank.find(i => i.id === id)?.count ?? 0;
    if (count(VIAL_OF_WATER) === 0) return null;
    for (const name of herbs) {
        const u = UNF[name]!;
        if (herblore >= u.level && count(u.herb) > 0) return { herb: u.herb, unf: u.unf };
    }
    return null;
}

/**
 * What the bank still needs from Jatix's shop in Taverley: vials of water for every herb
 * (unidentified or clean) on the mix list that is not already in a vial, and an eye of newt
 * for every guam and irit, whether still a herb or already an unfinished potion. Empty
 * vials in the bank count as vials (the next trip fills them). `eyes` overrides the eye of
 * newt target with a fixed count.
 */
export function shopNeeds(bank: readonly { id: number; count: number }[], herbs: readonly string[], eyes?: number): { vials: number; eyes: number } {
    const count = (id: number) => bank.find(i => i.id === id)?.count ?? 0;
    const unid = (name: string) => Object.entries(UNID_HERBS).filter(([, h]) => h === name).reduce((a, [id]) => a + count(Number(id)), 0);
    const herbsToMix = herbs.reduce((a, h) => a + count(UNF[h]!.herb) + unid(h), 0);
    const newt = NEWT_HERBS.reduce((a, h) => a + count(UNF[h]!.herb) + unid(h) + count(UNF[h]!.unf), 0);
    return {
        vials: Math.max(0, herbsToMix - count(VIAL_OF_WATER) - count(EMPTY_VIAL)),
        eyes: Math.max(0, (eyes ?? newt) - count(EYE_OF_NEWT))
    };
}

/** Herbs picked up, by herb name, from a loot-by-id record; non-herb ids are ignored. */
export function herbTally(byId: Readonly<Record<number, number>>): { total: number; byHerb: Record<string, number> } {
    const byHerb: Record<string, number> = {};
    let total = 0;
    for (const [id, n] of Object.entries(byId)) {
        const herb = UNID_HERBS[Number(id)];
        if (!herb) continue;
        byHerb[herb] = (byHerb[herb] ?? 0) + n;
        total += n;
    }
    return { total, byHerb };
}

// ---------------------------------------------------------------------------
// Druidic Ritual
// ---------------------------------------------------------------------------

const KAQEMEEX: Tile = { x: 2924, z: 3486 };
/** Sanfew is upstairs (level 1) in the Taverley house with Jatix's shop; spiral stairs at (2898, 3428). */
const SANFEW_STAIRS: Tile = { x: 2898, z: 3428 };
const TAVERLEY_LADDER: Tile = { x: 2884, z: 3397 };
const TAVERLEY_LADDER_BOTTOM: Tile = { x: 2884, z: 9798 };
/** The Cauldron of Thunder, behind the double door at (2889, 9830-9831); the room is east of the door. */
const CAULDRON: Tile = { x: 2893, z: 9831 };
const CAULDRON_DOOR_X = 2889;
const CAULDRON_OUTSIDE: Tile = { x: 2888, z: 9831 };
const SUITS_AREA: Box = { x1: 2880, z1: 9822, x2: 2895, z2: 9840 };
/** Jatix's herblore shop, Taverley: 800 empty vials, 800 eyes of newt, 3 pestles and mortars (taverly.inv). */
const JATIX: Tile = { x: 2899, z: 3427 };
/** Two fountains just north of Jatix; a vial fills in one zero-delay packet (water_sources.rs2). */
const TAVERLEY_FOUNTAIN: Tile = { x: 2891, z: 3439 };
const FALADOR_WEST_BANK: Tile = { x: 2946, z: 3368 };

interface Meat { raw: RegExp; enchanted: RegExp; npc: RegExp; area: Box; centre: Tile }
/** The four meats, each from the nearest monster to the Lumbridge cow field where training ends. */
const MEATS: Meat[] = [
    { raw: /^raw beef$/i, enchanted: /^enchanted beef$/i, npc: /^cow$/i, area: { x1: 3242, z1: 3255, x2: 3265, z2: 3298 }, centre: { x: 3253, z: 3282 } },
    { raw: /^raw chicken$/i, enchanted: /^enchanted chicken$/i, npc: /^chicken$/i, area: { x1: 3222, z1: 3293, x2: 3238, z2: 3303 }, centre: { x: 3230, z: 3298 } },
    { raw: /^raw bear meat$/i, enchanted: /^enchanted bear$/i, npc: /^bear$/i, area: { x1: 3150, z1: 3210, x2: 3190, z2: 3245 }, centre: { x: 3168, z: 3228 } },
    { raw: /^raw rat meat$/i, enchanted: /^enchanted rat$/i, npc: /^giant rat$/i, area: { x1: 3195, z1: 3175, x2: 3230, z2: 3210 }, centre: { x: 3211, z: 3192 } }
];

class Herbalist {
    private farmStart: { at: number; kills: number } | null = null;
    private readonly startedAt = Date.now();
    /** Last full bank snapshot (with ids), from the bones engine's bank visits and our own. */
    bankItems: BankSnapshot['items'] | null = null;
    /** Set once this session has walked the Kaqemeex -> Sanfew start of the quest. */
    private ritualStarted = false;
    private processedAfterBank = true;
    readonly made: Record<string, number> = {};
    identified = 0;
    readonly bought: Record<string, number> = {};
    filled = 0;
    /** No shop trip before this time (set when the bank is short of coins). */
    private supplyAfter = 0;

    constructor(readonly run: Run, readonly ctx: RoleContext, readonly opt: HerbOptions) {}

    herblore(): number { return this.run.level('Herblore'); }
    ritualDone(): boolean { return this.herblore() > 1; }
    level(): number { return this.run.pos().level; }
    inv(): InventoryItem[] { return this.run.state().inventory; }

    noteBank(items: BankSnapshot['items']): void {
        this.bankItems = items;
        this.processedAfterBank = false;
    }

    // ---- dialogue and movement helpers ----

    /** Talk to an NPC and click through its pages, choosing options that match `choose`. */
    async talk(npc: RegExp, choose: RegExp, maxPages = 30): Promise<boolean> {
        const r = await this.run.bot.talkTo(npc);
        if (!r.success) {
            this.ctx.log('talk failed', { npc: String(npc), reason: r.message });
            return false;
        }
        let idle = 0;
        for (let page = 0; page < maxPages && idle < 4; page++) {
            const d = this.run.sdk.getDialog();
            if (!d?.isOpen) { idle++; await sleepTicks(this.run, 1); continue; }
            idle = 0;
            const pick = d.options.find(o => choose.test(o.text));
            if (d.options.length && pick) await this.run.sdk.clickDialogByText(pick.text);
            else if (d.options.length) await this.run.sdk.clickDialogByText(d.options[d.options.length - 1]!.text);
            else await this.run.sdk.sendClickDialog(0);
            await sleepTicks(this.run, 1);
        }
        await this.run.bot.dismissBlockingUI();
        return true;
    }

    /** Spiral stairs between level 0 and 1. */
    async stairs(up: boolean): Promise<boolean> {
        const want = up ? 1 : 0;
        for (let attempt = 0; attempt < 4 && this.level() !== want; attempt++) {
            if (dist(this.run.pos(), SANFEW_STAIRS) > 3) await this.run.walk(SANFEW_STAIRS.x, SANFEW_STAIRS.z, 2, 300_000);
            const loc = (await this.run.sdk.scanNearbyLocs(6)).find(l => /stair/i.test(l.name) && l.optionsWithIndex.some(o => (up ? /climb-up/i : /climb-down/i).test(o.text)));
            if (!loc) { await sleepTicks(this.run, 2); continue; }
            await this.run.bot.interactLoc(loc, up ? /climb-up/i : /climb-down/i);
            await this.run.waitFor(s => s.player?.level === want, 8);
        }
        return this.level() === want;
    }

    /** Leave the dungeon or an upper floor before a long surface walk. */
    async toSurface(): Promise<boolean> {
        if (this.level() === 1 && dist(this.run.pos(), SANFEW_STAIRS) < 10) return this.stairs(false);
        if (this.run.underground()) {
            if (this.run.pos().x >= CAULDRON_DOOR_X && dist(this.run.pos(), CAULDRON) < 8) await this.throughCauldronDoor(false);
            if (!(await this.run.walk(TAVERLEY_LADDER_BOTTOM.x, TAVERLEY_LADDER_BOTTOM.z, 2, 120_000))) return false;
            return this.run.climb(/ladder/i, /climb-up/i, false, TAVERLEY_LADDER_BOTTOM);
        }
        return true;
    }

    // ---- Druidic Ritual ----

    async ritualStep(): Promise<void> {
        const has = (re: RegExp) => this.run.carrying(re);
        const enchanted = MEATS.filter(m => has(m.enchanted)).length;
        if (enchanted === MEATS.length) {
            this.run.phase('ritual:hand-in');
            if (!(await this.toSurface())) return;
            if (!(await this.stairs(true))) return;
            await this.talk(/^sanfew$/i, /yes|ok, i'll do that|i'll get on with it/i);
            if (MEATS.some(m => has(m.enchanted))) {
                // Sanfew took nothing: the quest was never started this account; start it and come back.
                this.ritualStarted = false;
                await this.stairs(false);
                await this.startRitual();
                return;
            }
            await this.stairs(false);
            await this.run.walk(KAQEMEEX.x, KAQEMEEX.z, 2, 300_000);
            await this.talk(/^kaqemeex$/i, /very well|in search of a quest|will try and help/i);
            await this.run.waitFor(() => this.ritualDone(), 10);
            this.ctx.log('druidic ritual', { done: this.ritualDone(), herblore: this.herblore() });
            return;
        }
        const missing = MEATS.filter(m => !has(m.raw) && !has(m.enchanted));
        if (missing.length) {
            const m = missing[0]!;
            this.run.phase(`ritual:meat ${m.raw.source}`);
            if (!(await this.toSurface())) return;
            await this.run.surfaceFight({ npc: m.npc, area: m.area, centre: m.centre, loot: m.raw });
            return;
        }
        if (!this.ritualStarted) {
            this.run.phase('ritual:start');
            await this.startRitual();
            return;
        }
        this.run.phase('ritual:cauldron');
        await this.dipMeats();
    }

    async startRitual(): Promise<void> {
        if (!(await this.toSurface())) return;
        if (!(await this.run.walk(KAQEMEEX.x, KAQEMEEX.z, 2, 300_000))) return;
        await this.talk(/^kaqemeex$/i, /in search of a quest|will try and help|very well/i);
        if (!(await this.stairs(true))) return;
        await this.talk(/^sanfew$/i, /purify the varrock|ok, i'll do that|i'll get on with it/i);
        await this.stairs(false);
        this.ritualStarted = true;
        this.ctx.log('druidic ritual started');
    }

    /** Through the cauldron room's door: each of the first two opens from outside animates a suit of armour, fought here. */
    async throughCauldronDoor(entering: boolean): Promise<boolean> {
        const inside = () => this.run.pos().x > CAULDRON_DOOR_X;
        for (let attempt = 0; attempt < 8 && inside() !== entering; attempt++) {
            const suit = this.run.state().nearbyNpcs.find(n => /^suit of armour$/i.test(n.name) && n.hp !== 0);
            if (suit) {
                await this.run.fight({ npc: /^suit of armour$/i, area: SUITS_AREA, centre: CAULDRON_OUTSIDE, loot: null });
                continue;
            }
            if (entering && dist(this.run.pos(), CAULDRON_OUTSIDE) > 1) await this.run.walk(CAULDRON_OUTSIDE.x, CAULDRON_OUTSIDE.z, 0, 120_000);
            const door = (await this.run.sdk.scanNearbyLocs(4))
                .filter(l => /door/i.test(l.name) && l.x === CAULDRON_DOOR_X && (l.z === 9830 || l.z === 9831))
                .sort((a, b) => a.distance - b.distance)[0] as NearbyLoc | undefined;
            if (door && door.optionsWithIndex.some(o => /open/i.test(o.text))) await this.run.bot.interactLoc(door, /open/i);
            await sleepTicks(this.run, 2);
            const target: Tile = entering ? { x: CAULDRON.x - 1, z: CAULDRON.z } : CAULDRON_OUTSIDE;
            if (!this.run.state().nearbyNpcs.some(n => /^suit of armour$/i.test(n.name) && n.hp !== 0)) await this.run.walk(target.x, target.z, 0, 30_000);
        }
        return inside() === entering;
    }

    async dipMeats(): Promise<void> {
        if (!this.run.underground()) {
            if (this.level() !== 0 && !(await this.stairs(false))) return;
            if (!(await this.run.walk(TAVERLEY_LADDER.x, TAVERLEY_LADDER.z + 1, 2, 300_000))) return;
            if (!(await this.run.climb(/ladder/i, /climb-down/i, true, TAVERLEY_LADDER))) return;
        }
        if (this.run.pos().x <= CAULDRON_DOOR_X) {
            if (!(await this.run.walk(CAULDRON_OUTSIDE.x, CAULDRON_OUTSIDE.z, 1, 120_000))) return;
            if (!(await this.throughCauldronDoor(true))) return;
        }
        const cauldron = (await this.run.sdk.scanNearbyLocs(6)).find(l => /cauldron of thunder/i.test(l.name));
        if (!cauldron) { this.ctx.log('ritual: no cauldron in view', { at: [this.run.pos().x, this.run.pos().z] }); return; }
        for (const m of MEATS) {
            if (!this.run.carrying(m.raw)) continue;
            await this.run.bot.useItemOnLoc(m.raw, cauldron);
            await this.run.waitFor(s => s.inventory.some(i => m.enchanted.test(i.name)), 6);
        }
        const dipped = MEATS.filter(m => this.run.carrying(m.enchanted)).length;
        this.ctx.log('ritual: dipped', { enchanted: dipped });
        if (dipped === 0) this.ritualStarted = false; // the cauldron refused: Sanfew has not been spoken to on this account
    }

    // ---- processing at the bank ----

    /** Work waiting in the bank after the last visit: herbs to identify, or herbs and vials to mix. */
    pending(): { identify: number | null; mix: { herb: number; unf: number } | null } {
        const items = this.bankItems ?? [];
        const lv = this.herblore();
        const identify = items.find(i => canIdentify(i.id, lv) && i.count > 0)?.id ?? null;
        return { identify, mix: nextMix(items, lv, this.opt.unf) };
    }

    /** One processing round at the bank: identify one stack, or mix 14 unfinished potions. */
    async processStep(): Promise<boolean> {
        const { identify, mix } = this.pending();
        if (identify === null && mix === null) { this.processedAfterBank = true; return false; }
        if (!this.run.nearBank()) { this.processedAfterBank = true; return false; }
        this.run.phase('process');
        const bot = this.run.bot, sdk = this.run.sdk;
        const open = await bot.openBank();
        if (!open.success) { this.ctx.log('process: bank did not open', { reason: open.message }); this.processedAfterBank = true; return false; }
        // Everything but the kit goes back first (the bones engine left the kit in the bag).
        for (const id of [...new Set(this.inv().filter(i => HERB_NAME.test(i.name) || /^(unfinished potion|vial of water|.+ leaf|marrentill|tarromin|harralander|ranarr weed|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|toadflax|snapdragon)$/i.test(i.name)).map(i => i.id))]) {
            const it = this.inv().find(i => i.id === id);
            if (it) await bot.depositItem(it, -1);
        }
        const free = () => 28 - this.inv().length;
        const bank = () => sdk.getBankItems();
        if (identify !== null) {
            const b = bank().find(i => i.id === identify);
            if (b) await bot.withdrawItem(b, Math.min(b.count, free()));
        } else if (mix) {
            const herb = bank().find(i => i.id === mix.herb), vial = bank().find(i => i.id === VIAL_OF_WATER);
            const n = Math.min(14, herb?.count ?? 0, vial?.count ?? 0, Math.floor(free() / 2));
            if (herb && vial && n > 0) {
                await bot.withdrawItem(herb, n);
                await bot.withdrawItem(vial, n);
            }
        }
        this.noteBank(bank().map(i => ({ id: i.id, name: i.name, count: i.count })));
        this.ctx.reportBank({ items: this.bankItems! });
        await bot.closeBank();
        await this.run.waitFor(s => !s.interface?.isOpen, 4);
        if (identify !== null) await this.identifyCarried();
        else if (mix) await this.mixCarried(mix.herb, mix.unf);
        return true;
    }

    async identifyCarried(): Promise<void> {
        const sdk = this.run.sdk;
        const lv = this.herblore();
        const todo = this.inv().filter(i => canIdentify(i.id, lv));
        for (const it of todo) {
            const op = it.optionsWithIndex.find(o => /identify/i.test(o.text));
            if (op) await sdk.sendUseItem(it.slot, op.opIndex);
        }
        await this.run.waitFor(s => !s.inventory.some(i => canIdentify(i.id, lv)), 12);
        const left = this.inv().filter(i => canIdentify(i.id, lv)).length;
        this.identified += todo.length - left;
        await this.run.bot.dismissBlockingUI();
    }

    async mixCarried(herbId: number, unfId: number): Promise<void> {
        const sdk = this.run.sdk;
        const before = this.inv().filter(i => i.id === unfId).length;
        const herbs = this.inv().filter(i => i.id === herbId);
        const vials = this.inv().filter(i => i.id === VIAL_OF_WATER);
        for (let k = 0; k < Math.min(herbs.length, vials.length); k++) {
            await sdk.sendUseItemOnItem(herbs[k]!.slot, vials[k]!.slot);
        }
        await this.run.waitFor(s => !s.inventory.some(i => i.id === herbId) || !s.inventory.some(i => i.id === VIAL_OF_WATER), 12);
        const made = this.inv().filter(i => i.id === unfId).length - before;
        const key = `${Object.entries(UNF).find(([, u]) => u.herb === herbId)?.[0] ?? herbId} (unf)`;
        this.made[key] = (this.made[key] ?? 0) + made;
        await this.run.bot.dismissBlockingUI();
    }

    // ---- shop trips: Jatix (Taverley) for empty vials and eyes of newt, the fountain to fill ----

    nearFaladorBank(): boolean { return !this.run.underground() && dist(this.run.pos(), FALADOR_WEST_BANK) <= 8; }

    /** True when the bank's shop needs (vials to fill, eyes of newt) add up to a batch. */
    supplyDue(): boolean {
        if (!this.opt.supply || !this.bankItems || Date.now() < this.supplyAfter || !this.nearFaladorBank()) return false;
        const need = shopNeeds(this.bankItems, this.opt.unf, this.opt.eyes);
        const emptyBanked = this.bankItems.find(i => i.id === EMPTY_VIAL)?.count ?? 0;
        return need.vials + emptyBanked + need.eyes >= this.opt.supplyBatch;
    }

    /**
     * One round trip from the Falador west bank: coins and banked empty vials out, empty vials
     * then eyes of newt from Jatix with the bag space left, the vials filled at the fountain,
     * everything banked.
     */
    async supplyTrip(): Promise<void> {
        const run = this.run, bot = run.bot, sdk = run.sdk;
        this.run.phase('supply');
        const need = shopNeeds(this.bankItems ?? [], this.opt.unf, this.opt.eyes);
        const open = await bot.openBank();
        if (!open.success) { this.ctx.log('supply: bank did not open', { reason: open.message }); return; }
        await this.depositAll();
        const coins = sdk.getBankItems().find(i => i.id === COINS);
        if (coins) await bot.withdrawItem(coins, coins.count);
        const empty = sdk.getBankItems().find(i => i.id === EMPTY_VIAL);
        if (empty) await bot.withdrawItem(empty, Math.min(empty.count, 27));
        await bot.closeBank();
        const carried = (id: number) => this.inv().filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
        const free = () => 28 - this.inv().length;
        if (need.vials > carried(EMPTY_VIAL) || need.eyes > 0) {
            if (!(await this.run.walk(JATIX.x, JATIX.z, 3, 300_000))) return;
            const shop = await bot.openShop(/^jatix$/i);
            if (!shop.success) { this.ctx.log('supply: shop did not open', { reason: shop.message }); return; }
            await this.buy('vials', EMPTY_VIAL, Math.min(free(), need.vials - carried(EMPTY_VIAL)));
            await this.buy('eyes', EYE_OF_NEWT, Math.min(free(), need.eyes));
            await bot.closeShop();
        }
        if (carried(EMPTY_VIAL) > 0) await this.fillVials();
        await this.run.walk(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3, 300_000);
        const back = await bot.openBank();
        if (!back.success) return;
        await this.depositAll();
        this.noteBank(sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })));
        this.ctx.reportBank({ items: this.bankItems! });
        await bot.closeBank();
        this.ctx.log('supply', { bought: this.bought, filled: this.filled, need: shopNeeds(this.bankItems!, this.opt.unf, this.opt.eyes) });
    }

    /**
     * Buy up to `want` of an item from the open shop. A buy can come back short (one Buy-10
     * packet's purchase not seen in time), so keep buying while each attempt makes progress.
     */
    async buy(key: string, id: number, want: number): Promise<void> {
        const sdk = this.run.sdk;
        const coins = () => this.inv().filter(i => i.id === COINS).reduce((a, i) => a + i.count, 0);
        let got = 0;
        for (let attempt = 0; attempt < 5 && got < want; attempt++) {
            const item = sdk.getState()?.shop?.shopItems.find(i => i.id === id);
            if (!item) return;
            const afford = Math.floor(coins() / Math.max(1, item.buyPrice));
            const n = Math.min(want - got, item.count, afford);
            if (n <= 0) {
                if (afford < want - got) {
                    this.ctx.log('supply: short of coins', { item: key, coins: coins(), price: item.buyPrice, want: want - got });
                    this.supplyAfter = Date.now() + 30 * 60_000;
                }
                return;
            }
            const bought = (await this.run.bot.buyFromShop(item, n)).amountBought ?? 0;
            if (bought === 0) return;
            got += bought;
            this.bought[key] = (this.bought[key] ?? 0) + bought;
        }
    }

    /** With the bank open, deposit every carried stack. */
    async depositAll(): Promise<void> {
        for (const id of [...new Set(this.inv().map(i => i.id))]) {
            const it = this.inv().find(i => i.id === id);
            if (it) await this.run.bot.depositItem(it, -1);
        }
    }

    /** Fill every carried empty vial at the Taverley fountain: the first use walks there, then one packet per vial. */
    async fillVials(): Promise<void> {
        const sdk = this.run.sdk;
        if (!(await this.run.walk(TAVERLEY_FOUNTAIN.x, TAVERLEY_FOUNTAIN.z + 1, 3, 120_000))) return;
        const fountain = (await sdk.scanNearbyLocs(8)).filter(l => /^fountain$/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
        if (!fountain) { this.ctx.log('supply: no fountain in view', { at: [this.run.pos().x, this.run.pos().z] }); return; }
        const empties = () => this.inv().filter(i => i.id === EMPTY_VIAL).length;
        let stall = 0, first = true;
        while (empties() > 0 && stall < 3) {
            const before = empties();
            const vial = this.inv().find(i => i.id === EMPTY_VIAL)!;
            if (first || stall > 0) await this.run.bot.useItemOnLoc(vial, fountain);
            else await sdk.sendUseItemOnLoc(vial.slot, fountain.x, fountain.z, fountain.id);
            first = false;
            if (await this.run.waitFor(() => empties() < before, 5)) { this.filled += before - empties(); stall = 0; } else stall++;
        }
    }

    // ---- the cycle ----

    async cycle(): Promise<void> {
        const run = this.run;
        if (run.inTutorial() || !run.trainingDone()) return run.cycle();
        if (this.opt.ritual && !this.ritualDone()) {
            await run.bot.dismissBlockingUI();
            if (run.sdk.isBankOpen() || run.state().shop?.isOpen) await run.bot.closeInterface();
            run.noteRespawn();
            await run.equipUpgrades();
            return this.ritualStep();
        }
        if (this.opt.process && this.ritualDone() && !this.processedAfterBank) {
            if (await this.processStep()) return;
        }
        if (this.supplyDue()) return this.supplyTrip();
        return run.cycle();
    }

    // ---- rates ----

    snapshot(): Record<string, unknown> {
        const tally = herbTally(this.run.lootedById);
        if (!this.farmStart && tally.total > 0) this.farmStart = { at: Date.now(), kills: this.run.kills - 1 };
        const per = (n: number, ms: number) => (ms > 60_000 ? Math.round((n * 3_600_000) / ms * 10) / 10 : null);
        const farmMs = this.farmStart ? Date.now() - this.farmStart.at : 0;
        const farmKills = this.farmStart ? this.run.kills - this.farmStart.kills : 0;
        const irit = tally.byHerb.irit ?? 0;
        const banked = (id: number) => this.bankItems?.find(i => i.id === id)?.count ?? 0;
        return {
            herbs: tally.total,
            byHerb: tally.byHerb,
            vials: this.run.lootedById[VIAL_OF_WATER] ?? 0,
            farmKills,
            farmHours: Number((farmMs / 3_600_000).toFixed(3)),
            killsPerHour: per(farmKills, farmMs),
            herbsPerHour: per(tally.total, farmMs),
            iritPerHour: per(irit, farmMs),
            identified: this.identified,
            made: this.made,
            bought: this.bought,
            filled: this.filled,
            bank: {
                unf: Object.fromEntries(Object.entries(UNF).map(([n, u]) => [n, banked(u.unf)]).filter(([, c]) => c)),
                unidentified: Object.values(UNID_HERBS).length ? (this.bankItems ?? []).filter(i => UNID_HERBS[i.id]).reduce((a, i) => a + i.count, 0) : 0,
                vials: banked(VIAL_OF_WATER),
                eyes: banked(EYE_OF_NEWT)
            },
            herblore: this.herblore(),
            hoursSinceStart: Number(((Date.now() - this.startedAt) / 3_600_000).toFixed(3))
        };
    }
}

export const role: Role = {
    name: 'herbs',
    produces: [/^herb$/i, /^unfinished potion$/i, /^(guam leaf|irit leaf|vial of water|eye of newt)$/i],
    async run(ctx: RoleContext): Promise<void> {
        const opt = herbOptions(ctx.options);
        await ctx.sdk.waitForReady(60_000);
        // The bones engine reports its bank visits through ctx; keep a copy (with ids) for processing.
        let herbalist: Herbalist | null = null;
        const runCtx: RoleContext = { ...ctx, reportBank: snap => { herbalist?.noteBank(snap.items); ctx.reportBank(snap); } };
        const run = new Run(runCtx, opt.bones);
        herbalist = new Herbalist(run, ctx, opt);
        ctx.log('start', { spot: opt.bones.spot.id, train: opt.bones.train, fish: opt.bones.fish, ritual: opt.ritual, ...run.summary(), herblore: herbalist.herblore() });
        let nextReport = Date.now() + opt.reportMinutes * 60_000;
        let errors = 0;
        while (!ctx.signal.aborted) {
            try {
                await herbalist.cycle();
                errors = 0;
            } catch (e) {
                errors++;
                ctx.log('cycle error', { error: String(e), errors });
                await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * errors)));
            }
            const snap = herbalist.snapshot();
            if (Date.now() >= nextReport) {
                ctx.log('herbs', { ...snap, levels: run.summary().levels });
                nextReport = Date.now() + opt.reportMinutes * 60_000;
            }
        }
        ctx.log('stopped', { ...herbalist.snapshot(), ...run.summary() });
    }
};

if (import.meta.main) await runStandalone(role);
