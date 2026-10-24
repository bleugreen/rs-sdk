// S25e, Herblore 28 -> 99 at the Varrock west booth (STEP-MANIFEST.md entry 27;
// docs/speedrun/skills/herblore.md, section 9 "Module"). SCORED stands on (3185,3436)
// beside booth (3186,3436) and mixes finished potions, 14 unfinished potions and 14
// secondaries an inventory, 5 a tick, through the page's item-cycle program
// (server/webclient/src/bot/programs/item-cycle.ts) driven by lib/item-cycle.ts. Every
// reaction (the bank seen open, the refill seen) happens in the page on the decoded tick.
//
// Supplies arrive in H21e, by trade from the trade giver (rs/117), as noted stacks in the
// H21d + H21e trade: the program's first bank visit deposits every stack and the bank
// unnotes them. No vials. The module plays whatever mix is banked, the best potion the
// level allows at each visit.
//
// The close stows: once the target shows, one more visit deposits everything held (the last
// load's unused halves and its potions), so S25c starts at the booth with 28 free.
//
// One step: every inventory boundary is safe to log out at, and the program restarts from
// any inventory (a reset visit), so `inProgress` + `resume` cover a mid-band logout, and a
// logout between the target and the stow resumes into the stow alone.

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { planRoute, runItemCycle, stockFrom, type Booth, type ItemRecipe, type RoutePlan } from '../lib/item-cycle';
import { xpForLevel } from '../lib/xp';
import type { Observed, Step, StepContext } from '../runner/step';

export const skill = 'herblore';

export const STEP_NAME = 'S25e herblore';

/** The step's tile and booth (herblore.md section 1). */
export const SCORED_TILE = { x: 3185, z: 3436 } as const;
/**
 * Varrock west's booth: loc `bankbooth` (2213). Op 2, Use-quickly, opens the bank directly
 * (`[oploc2,bankbooth] @openbank`, bank_booth.rs2); op 1, Use, starts the banker dialogue.
 */
export const VARROCK_WEST: Booth = { x: 3186, z: 3436, id: 2213, option: 2, stand: SCORED_TILE };
const QUICK_BANK = /^use-quickly$/i;

/** Herblore after Druidic Ritual's 250 base (quest_druid.rs2): level 28. */
export const POST_RITUAL_XP = 250 * 25;
/** brew_potion.param: every potion without its own level needs 3. */
export const MIN_LEVEL = 3;
const INVENTORY = 28;

export interface HerbRecipe extends ItemRecipe {
    /** The brew_potion.struct row and the content debugnames the ids resolve from. */
    struct: string;
    unf: string;
    secondary: string;
    product: string;
}

const H = (name: string, struct: string, level: number, xp: number, unf: string, a: number, secondary: string, b: number, product: string, p: number): HerbRecipe => ({ name, struct, level, xp, unf, a, secondary, b, product, products: [p] });

/**
 * Every finished potion brewed from an unfinished potion and a secondary (brew_potion.struct:
 * level, brew_potion_exp / 10 base xp), with obj ids from obj.pack. herblore.test.ts checks
 * each row against the content. Quest-only mixes are left out (EXCLUDED_STRUCTS).
 */
export const HERB_RECIPES: readonly HerbRecipe[] = [
    H('attack', '3dose1attack', 3, 25, 'guamvial', 91, 'eye_of_newt', 221, '3dose1attack', 121),
    H('antipoison', '3doseantipoison', 5, 37.5, 'marrentillvial', 93, 'unicorn_horn_dust', 235, '3doseantipoison', 175),
    H('strength', '3dose1strength', 12, 50, 'tarrominvial', 95, 'limpwurt_root', 225, '3dose1strength', 115),
    H('restore', '3dose1restore', 22, 62.5, 'harralandervial', 97, 'red_spiders_eggs', 223, '3dosestatrestore', 127),
    H('energy', '3dose1energy', 26, 67.5, 'harralandervial', 97, 'chocolate_dust', 1975, '3dose1energy', 3010),
    H('defence', '3dose1defense', 30, 75, 'ranarrvial', 99, 'white_berries', 239, '3dose1defense', 133),
    H('agility', '3dose1agility', 34, 80, 'toadflaxvial', 3002, 'toads_legs', 2152, '3dose1agility', 3034),
    H('prayer', '3doseprayerrestore', 38, 87.5, 'ranarrvial', 99, 'snape_grass', 231, '3doseprayerrestore', 139),
    H('superattack', '3dose2attack', 45, 100, 'iritvial', 101, 'eye_of_newt', 221, '3dose2attack', 145),
    H('superantipoison', '3dose2antipoison', 48, 106.3, 'iritvial', 101, 'unicorn_horn_dust', 235, '3dose2antipoison', 181),
    H('fishing', '3dosefisherspotion', 50, 112.5, 'avantoevial', 103, 'snape_grass', 231, '3dosefisherspotion', 151),
    H('superenergy', '3dose2energy', 52, 117.5, 'avantoevial', 103, 'mortmyremushroom', 2970, '3dose2energy', 3018),
    H('superstrength', '3dose2strength', 55, 125, 'kwuarmvial', 105, 'limpwurt_root', 225, '3dose2strength', 157),
    H('weaponpoison', 'weapon_poison', 60, 137.5, 'kwuarmvial', 105, 'dragon_scale_dust', 241, 'weapon_poison', 187),
    H('superrestore', '3dose2restore', 63, 142.5, 'snapdragonvial', 3004, 'red_spiders_eggs', 223, '3dose2restore', 3026),
    H('superdefence', '3dose2defense', 66, 150, 'cadantinevial', 107, 'white_berries', 239, '3dose2defense', 163),
    H('antifire', '3dose1antidragon', 69, 157.5, 'lantadymevial', 2483, 'dragon_scale_dust', 241, '3dose1antidragon', 2454),
    H('ranging', '3doserangerspotion', 72, 162.5, 'dwarfweedvial', 109, 'wine_of_zamorak', 245, '3doserangerspotion', 169),
    H('magic', '3dose1magic', 76, 172.5, 'lantadymevial', 2483, 'cactus_potato', 3138, '3dose1magic', 3042),
    H('zamorak', '3dosepotionofzamorak', 78, 175, 'torstolvial', 111, 'jangerberries', 247, '3dosepotionofzamorak', 189)
];

/** brew_potion.struct rows that take an unfinished potion but are quest steps, not training. */
export const EXCLUDED_STRUCTS: Readonly<Record<string, string>> = {
    blamish_oil: "Ernest the Chicken's oil (quest item)",
    mort_serum3_tarrominvial: "Shades of Mort'ton serum (quest item)",
    mort_serum3_ashesvial: "Shades of Mort'ton serum (quest item)",
    eadgar_ground_troll_thistle_potion: "Eadgar's Ruse (quest item)"
};

/** Banknote id -> item id for every recipe input (a note's id is its item's + 1 in obj.pack). */
export const HERB_NOTES: ReadonlyMap<number, number> = new Map([...new Set(HERB_RECIPES.flatMap(r => [r.a, r.b!]))].map(id => [id + 1, id]));

/**
 * The H21e hand-off, as data (SUPPLIES.md owns the counts; rs/158 freezes them). The giver
 * trades the noted stacks beside the booth before S25, in the same trade as H21d's gems.
 */
export const handOff = {
    id: 'H21e',
    giver: 'trade giver (rs/117)',
    tile: SCORED_TILE,
    booth: { x: VARROCK_WEST.x, z: VARROCK_WEST.z },
    when: 'before S25, in the H21d+H21e trade',
    package: 'noted unf + secondaries per SUPPLIES.md H21e',
    vials: 0
} as const;

export interface HerbloreOptions {
    /** Target level (default 99). */
    to?: number;
    /** Recipe names to play (default all of HERB_RECIPES). */
    recipes?: string[];
    booth?: Booth;
    /** Mixing is members-only (brew_potion.rs2) and the state carries no world flag: the demo is members (fly.toml NODE_MEMBERS). */
    members?: boolean;
    /** Hand-written cap on mixes (the demo's 28). */
    maxActions?: number;
}

export function recipesFor(names?: readonly string[]): HerbRecipe[] {
    if (!names) return [...HERB_RECIPES];
    return names.map(n => {
        const r = HERB_RECIPES.find(x => x.name === n);
        if (!r) throw new Error(`unknown herblore recipe '${n}' (have: ${HERB_RECIPES.map(x => x.name).join(', ')})`);
        return r;
    });
}

function herb(s: BotWorldState) {
    return s.skills.find(k => k.name.toLowerCase() === 'herblore');
}

export function herbloreLevel(s: BotWorldState): number {
    return herb(s)?.baseLevel ?? 0;
}

export function herbloreXp(s: BotWorldState): number {
    return herb(s)?.experience ?? 0;
}

export function boothLoc(s: BotWorldState, booth: Booth = VARROCK_WEST): NearbyLoc | undefined {
    return s.nearbyLocs.find(l => l.id === booth.id && l.x === booth.x && l.z === booth.z);
}

/** The booth's quick-bank op as the loc offers it, else the booth's own. */
export function boothFor(s: BotWorldState, booth: Booth = VARROCK_WEST): Booth {
    const op = boothLoc(s, booth)?.optionsWithIndex.find(o => QUICK_BANK.test(o.text))?.opIndex;
    return op ? { ...booth, option: op } : booth;
}

function cycleIds(recipes: readonly HerbRecipe[]): Set<number> {
    return new Set(recipes.flatMap(r => [r.a, r.b!, r.a + 1, r.b! + 1, ...r.products]));
}

/** Inventory items that are not a recipe input, product or input note: each blocks a working slot. */
export function otherItems(s: BotWorldState, recipes: readonly HerbRecipe[] = HERB_RECIPES): string[] {
    const ours = cycleIds(recipes);
    return s.inventory.filter(i => !ours.has(i.id)).map(i => i.name);
}

/** The cycle's own items held (inputs, their notes, potions): what the stow clears. */
export function cycleItems(s: BotWorldState, recipes: readonly HerbRecipe[] = HERB_RECIPES): string[] {
    const ours = cycleIds(recipes);
    return s.inventory.filter(i => i.count > 0 && ours.has(i.id)).map(i => i.name);
}

/** The route the visible supplies give: bank plus inventory while the bank is open, else the inventory. */
export function visibleRoute(s: BotWorldState, opts: HerbloreOptions = {}): { plan: RoutePlan; bankSeen: boolean } {
    const bankSeen = !!s.bank?.isOpen;
    const view = bankSeen ? s : { ...s, bank: { ...s.bank, items: [] } };
    return { plan: planRoute(Math.max(herbloreXp(s), 0), opts.to ?? 99, recipesFor(opts.recipes), stockFrom(view as BotWorldState, HERB_NOTES)), bankSeen };
}

export function reached(s: BotWorldState, to = 99): boolean {
    return herbloreLevel(s) >= to;
}

export function preconditions(s: BotWorldState, opts: HerbloreOptions = {}): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    const to = opts.to ?? 99;
    if (reached(s, to)) return true; // a run past its stop only stows what it holds
    const level = herbloreLevel(s);
    if (level < MIN_LEVEL) return `Herblore ${level} is below ${MIN_LEVEL}: Druidic Ritual first (every potion needs level ${MIN_LEVEL}, brew_potion.param)`;
    if (opts.members === false) return 'not a members world: mixing is members-only (brew_potion.rs2)';
    let recipes: HerbRecipe[];
    try {
        recipes = recipesFor(opts.recipes);
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    const booth = opts.booth ?? VARROCK_WEST;
    // right after a login the position is published before the scene's locs
    if (s.nearbyLocs.length && !boothLoc(s, booth)) return `no bank booth (${booth.x},${booth.z}) in view (at ${s.player.worldX},${s.player.worldZ})`;
    const other = otherItems(s, recipes);
    if (other.length) return `${other.length} other items (${[...new Set(other)].join(', ')}): need ${INVENTORY} free slots`;
    const { plan, bankSeen } = visibleRoute(s, opts);
    if (plan.reaches) return true;
    // The whole stock is in sight while the bank is open, or while H21e's notes are held (the trade
    // lands the package at once). Otherwise it is banked out of sight (the published state carries
    // no bank items while the bank is closed): the program's first visit reads it and faults
    // `out of supplies` with the counts if it falls short.
    if (bankSeen || holdsNotes(s, recipes)) return `supplies short: ${Math.ceil(plan.xpShort / 25)} base xp (they reach Herblore ${plan.level}; ${describe(plan)})`;
    return true;
}

function holdsNotes(s: BotWorldState, recipes: readonly HerbRecipe[]): boolean {
    const notes = new Set(recipes.flatMap(r => [r.a + 1, r.b! + 1]));
    return s.inventory.some(i => notes.has(i.id));
}

function describe(plan: RoutePlan): string {
    const used = Object.entries(plan.byRecipe).map(([n, k]) => `${n} ${k}`).join(', ');
    return used ? `${plan.actions} mixes: ${used}` : 'nothing mixable at this level';
}

export function herbloreStep(opts: HerbloreOptions = {}): Step<any> {
    const to = opts.to ?? 99;
    // every herb item, not only opts.recipes': the stow deposits all of them
    const held = (s: BotWorldState) => cycleItems(s);
    const done = (s: BotWorldState) => reached(s, to) && held(s).length === 0;
    const entry = async (ctx: StepContext<any>) => {
        const s = ctx.sdk.getState();
        if (!s) throw new Error('no state');
        await runItemCycle(
            { sdk: ctx.sdk, session: ctx.session, log: ctx.log },
            {
                mode: 'pair',
                skill: 'herblore',
                recipes: recipesFor(opts.recipes).map(({ name, level, xp, a, b, products }) => ({ name, level, xp, a, b, products })),
                booth: boothFor(s, opts.booth ?? VARROCK_WEST),
                untilLevel: to,
                ...(opts.maxActions !== undefined ? { maxActions: opts.maxActions } : {}),
                stow: true,
                step: STEP_NAME
            }
        );
    };
    return {
        name: STEP_NAME,
        preconditions: s => preconditions(s, opts),
        run: entry,
        resume: entry,
        postconditions: s => {
            const left = held(s);
            if (left.length) return `the stow left ${[...new Set(left)].join(', ')} in the inventory`;
            return reached(s, to) || opts.maxActions !== undefined ? true : `Herblore ${herbloreLevel(s)} < ${to}`;
        },
        logoutSafe: true,
        done: (o: Observed) => done(o.state),
        inProgress: (o: Observed) => {
            const s = o.state;
            if (!s.player || done(s)) return false;
            return reached(s, to) || (herbloreXp(s) > POST_RITUAL_XP && herbloreXp(s) < xpForLevel(to));
        }
    };
}

/** The step-module convention (`skill`, `steps()`): one step, S25e. */
export function steps(opts: HerbloreOptions = {}): Step<any>[] {
    return [herbloreStep(opts)];
}
