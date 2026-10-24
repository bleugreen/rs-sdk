/**
 * The phase-2 plan (docs/markets/phase2.md 'Running'): which account runs which method, and the runner's knobs.
 * Pure: parsing and validation, each method's setup sequence, and the split of fallback logins across a mix.
 *
 * A plan names accounts, so the plan file lives outside the checkout like the accounts list; the committed
 * example (`plan.example.json`) uses placeholder names.
 */
import { LOW_SITES } from '../methods/hp-train.ts';
import { defaultCaps, type HpSiteCaps } from './hp-sites.ts';

/** Methods the runner can bring a fresh account to and run (docs/markets/phase2.md 'Per-login rates'). */
export const METHODS = ['knights', 'heroes', 'guards', 'iron', 'shilo'] as const;
export type MethodId = (typeof METHODS)[number];

/** Rows of the phase-2 table the runner refuses, with the reason it gives. */
export const UNSUPPORTED: Readonly<Record<string, string>> = {
    steel: 'no complete steel loop exists: smelter.ts smelt mode runs from banked ore, and nothing alternates the iron, coal and smelting legs',
    runite: 'not measured (the lab bots stalled in the Lava Maze dungeon) and needs Mining and Smithing 85',
    battlestaves: 'the inputs (unpowered orbs, cosmic runes) have no supply'
};

/** The working cap on concurrent sessions from one address (docs/markets/scaling-limits.md 'Answer'). */
export const MAX_LOGINS = 45;
/** A sale offer never carries more than this, whatever the plan says (the per-call cap's ceiling). */
export const HARD_SALE_CAP = 5_000;

export interface MethodNeeds {
    thieving?: number;
    mining?: number;
    /** Trains Hitpoints first (the plan's `hp`), so pickpocket failures cost little food. */
    hp: boolean;
    /** Eats sharks from the bank (the plan's shark supply). */
    sharks: boolean;
    /** Works out of East Ardougne (the ship route from Port Sarim, 60 coins). */
    ardougne: boolean;
    /** Needs a staged account: the runner checks levels but cannot do the quests. */
    staged?: string;
}

export const NEEDS: Readonly<Record<MethodId, MethodNeeds>> = {
    knights: { thieving: 55, hp: true, sharks: true, ardougne: true },
    heroes: { thieving: 80, hp: true, sharks: true, ardougne: true },
    guards: { hp: true, sharks: false, ardougne: false },
    iron: { mining: 15, hp: false, sharks: false, ardougne: true },
    shilo: { mining: 40, hp: false, sharks: false, ardougne: false, staged: 'Shilo Village complete and the account at the Shilo gem rocks; no quest bot exists for Jungle Potion or Shilo Village' }
};

export type Mix = Partial<Record<MethodId, number>>;

export interface AccountPlan {
    account: string;
    method: MethodId;
    /** Hitpoints to train before the method (the plan's `hp` when absent; 10 or less skips it). */
    hp?: number;
    /** Role options merged over the method's defaults (and the plan's per-method `options`). */
    options?: Record<string, unknown>;
}

export interface SharkPlan {
    /** 'bank': markets has put sharks in each account's bank; 'buy': the runner buys them at the Exchange. */
    source: 'bank' | 'buy';
    /** Sharks one account buys before it travels (source 'buy'). */
    perAccount: number;
    /**
     * Planning figures for the whole-plan bound: sharks a login eats an hour, over how many hours. The default 40 is
     * the lab's median at HP 40 (rs/544: 15 knights, 28-44 an hour), not the 30 first assumed.
     */
    perLoginHour: number;
    hours: number;
    /** The most a shark may cost: the buy offer's limit price and the bound the book is checked against. */
    ceiling: number;
    /** Fewer sharks than this after a purchase (or none left in the bank) sends the account to the food fallback. */
    minimum: number;
    /**
     * A food-redirected shark eater goes back to buy sharks and its method once its coins cover this many at the
     * ceiling (sharks.ts rebuyDecision; source 'buy' only). Defaults to `perAccount`.
     */
    rebuyMinSharks: number;
    /** Minutes the buy offer waits for its fill before the remainder is cancelled. */
    fillMinutes: number;
}

export interface RampPlan {
    /** Knights logins online after each step, cumulative (the last step is capped at the knights count). */
    steps: number[];
    holdMinutes: number;
    /** Stop adding knights when a step's median gp a tick per login is more than this far below the first step's. */
    dropPct: number;
    /** A step's hold starts when every admitted login is pickpocketing, or this long after the step opened. */
    admitTimeoutMinutes: number;
    /** Where the knights logins not yet admitted go when the ramp stops (plan B's mix by default). */
    fallbackMix: Mix;
}

export interface SellPlan {
    /** Off until markets enables it. */
    enabled: boolean;
    /** Most units one offer carries (at most HARD_SALE_CAP). */
    cap: number;
    /** Minutes of the method between sale errands. */
    everyMinutes: number;
    /** Item name to the lowest price it may sell at; only these items are ever sold. */
    floors: Record<string, number>;
    /** Minutes an offer waits for its fill before the remainder is cancelled. */
    fillMinutes: number;
}

export interface Plan {
    accounts: AccountPlan[];
    /** Concurrent sessions, pending logins included: the plan's login count. */
    maxSessions: number;
    /** Wall ms between two login starts from this address. */
    loginSpacingMs: number;
    hp: number;
    /** Accounts each low Hitpoints site takes at once (hp-sites.ts); 0 closes a site. */
    hpSites: HpSiteCaps;
    sharks: SharkPlan;
    ramp: RampPlan | null;
    /** Where an account goes when the sharks run out: plan B's lower-food methods. */
    foodFallbackMix: Mix;
    ledger: { everyTicks: number; bookMinutes: number };
    sell: SellPlan;
    /** Role options per method, merged over the defaults. */
    options: Partial<Record<MethodId, Record<string, unknown>>>;
}

/** Methods worked within walking distance of the Exchange (Varrock west bank): the only ones a sale can run from. */
export const SALE_ROUTE: readonly MethodId[] = ['guards'];

export const PLAN_B_MIX: Mix = { iron: 12, heroes: 8, guards: 23 };
export const LOW_FOOD_MIX: Mix = { iron: 12, guards: 23 };

export const DEFAULTS = {
    loginSpacingMs: 2_000,
    hp: 40,
    sharks: { source: 'bank', perAccount: 200, perLoginHour: 40, hours: 72, ceiling: 701, minimum: 28, fillMinutes: 10 } satisfies Omit<SharkPlan, 'rebuyMinSharks'>,
    ramp: { steps: [8, 20, 43], holdMinutes: 15, dropPct: 10, admitTimeoutMinutes: 30, fallbackMix: PLAN_B_MIX } satisfies RampPlan,
    ledger: { everyTicks: 50, bookMinutes: 15 },
    sell: { enabled: false, cap: 500, everyMinutes: 120, floors: {}, fillMinutes: 10 } satisfies SellPlan
};

/** Role options each method starts from (markets/methods/pickpocket.ts, mine.ts, speedrun/helpers/coins.ts). */
export const ROLE_DEFAULTS: Readonly<Record<MethodId, Record<string, unknown>>> = {
    knights: { target: 'knight', food: 'Shark', foodPerTrip: 0, bankAt: 50_000 },
    heroes: { target: 'hero', food: 'Shark', foodPerTrip: 0, bankAt: 50_000 },
    // 'auto' climbs men, Al-Kharid warriors, then Varrock guards from guardLevel (coins.ts)
    guards: { target: 'auto', guardLevel: 40 },
    iron: { site: 'iron' },
    shilo: { site: 'shilo' }
};

export class PlanError extends Error {
    constructor(readonly problems: string[]) {
        super(`the plan is not valid:\n  ${problems.join('\n  ')}`);
        this.name = 'PlanError';
    }
}

const NAME = /^[a-z0-9_ ]{1,12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Parse and validate a plan; throws PlanError listing every problem at once. */
export function parsePlan(raw: unknown): Plan {
    const problems: string[] = [];
    if (!isObj(raw)) throw new PlanError(['the plan must be a JSON object']);
    const known = ['accounts', 'maxSessions', 'loginSpacingMs', 'hp', 'hpSites', 'sharks', 'ramp', 'foodFallbackMix', 'ledger', 'sell', 'options'];
    for (const k of Object.keys(raw)) if (!known.includes(k)) problems.push(`unknown key '${k}'`);

    const num = (where: string, v: unknown, def: number, o: { min?: number; max?: number; integer?: boolean } = {}): number => {
        if (v === undefined) return def;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            problems.push(`${where} must be a number`);
            return def;
        }
        if (o.integer && !Number.isInteger(v)) problems.push(`${where} must be a whole number`);
        if (o.min !== undefined && v < o.min) problems.push(`${where} must be at least ${o.min}`);
        if (o.max !== undefined && v > o.max) problems.push(`${where} must be at most ${o.max}`);
        return v;
    };
    const method = (where: string, v: unknown): MethodId | null => {
        if (typeof v === 'string' && (METHODS as readonly string[]).includes(v)) return v as MethodId;
        if (typeof v === 'string' && UNSUPPORTED[v]) problems.push(`${where}: '${v}' is not supported: ${UNSUPPORTED[v]}`);
        else problems.push(`${where}: method must be one of ${METHODS.join(', ')}`);
        return null;
    };
    const mix = (where: string, v: unknown, def: Mix): Mix => {
        if (v === undefined) return def;
        if (!isObj(v)) {
            problems.push(`${where} must be an object of method weights`);
            return def;
        }
        const out: Mix = {};
        for (const [k, w] of Object.entries(v)) {
            const m = method(`${where}.${k}`, k);
            if (m) out[m] = num(`${where}.${k}`, w, 0, { min: 0 });
        }
        if (!Object.values(out).some(w => (w ?? 0) > 0)) problems.push(`${where} needs at least one method with a weight above 0`);
        return out;
    };

    // accounts
    const accounts: AccountPlan[] = [];
    if (!Array.isArray(raw.accounts) || raw.accounts.length === 0) problems.push('accounts must be a non-empty list');
    else {
        const seen = new Set<string>();
        raw.accounts.forEach((a, i) => {
            const where = `accounts[${i}]`;
            if (!isObj(a)) return problems.push(`${where} must be an object`);
            for (const k of Object.keys(a)) if (!['account', 'method', 'hp', 'options'].includes(k)) problems.push(`${where}: unknown key '${k}'`);
            const name = typeof a.account === 'string' ? a.account.trim() : '';
            if (!NAME.test(name)) problems.push(`${where}: account must be 1-12 letters, digits, '_' or spaces`);
            const key = name.toLowerCase().replace(/[_ ]/g, ' ');
            if (seen.has(key)) problems.push(`${where}: account '${name}' is listed twice`);
            seen.add(key);
            const m = method(where, a.method);
            if (a.options !== undefined && !isObj(a.options)) problems.push(`${where}: options must be an object`);
            const hp = a.hp === undefined ? undefined : num(`${where}.hp`, a.hp, 10, { min: 10, max: 99, integer: true });
            if (m) accounts.push({ account: name, method: m, ...(hp === undefined ? {} : { hp }), ...(isObj(a.options) ? { options: a.options } : {}) });
        });
    }
    if (accounts.length > MAX_LOGINS) problems.push(`${accounts.length} accounts is more than the ${MAX_LOGINS} logins one address holds (scaling-limits.md)`);

    // sessions: every method runs until stopped, so the plan's count of accounts is the count of sessions
    const maxSessions = num('maxSessions', raw.maxSessions, Math.min(MAX_LOGINS, Math.max(1, accounts.length)), { min: 1, max: MAX_LOGINS, integer: true });
    if (accounts.length > maxSessions) problems.push(`maxSessions ${maxSessions} is below the ${accounts.length} accounts: every method runs until stopped, so the rest would never log in`);

    // sharks
    const sk = raw.sharks === undefined ? {} : raw.sharks;
    if (!isObj(sk)) problems.push('sharks must be an object');
    const s = isObj(sk) ? sk : {};
    const source = s.source ?? DEFAULTS.sharks.source;
    if (source !== 'bank' && source !== 'buy') problems.push("sharks.source must be 'bank' or 'buy'");
    const perAccount = num('sharks.perAccount', s.perAccount, DEFAULTS.sharks.perAccount, { min: 1, max: 20_000, integer: true });
    const sharks: SharkPlan = {
        source: source === 'buy' ? 'buy' : 'bank',
        perAccount,
        perLoginHour: num('sharks.perLoginHour', s.perLoginHour, DEFAULTS.sharks.perLoginHour, { min: 0 }),
        hours: num('sharks.hours', s.hours, DEFAULTS.sharks.hours, { min: 0 }),
        ceiling: num('sharks.ceiling', s.ceiling, DEFAULTS.sharks.ceiling, { min: 1, integer: true }),
        minimum: num('sharks.minimum', s.minimum, DEFAULTS.sharks.minimum, { min: 1, integer: true }),
        fillMinutes: num('sharks.fillMinutes', s.fillMinutes, DEFAULTS.sharks.fillMinutes, { min: 0, max: 30 }),
        rebuyMinSharks: num('sharks.rebuyMinSharks', s.rebuyMinSharks, perAccount, { min: 1, max: perAccount, integer: true })
    };
    if (sharks.source === 'buy' && sharks.rebuyMinSharks < sharks.minimum) problems.push(`sharks.rebuyMinSharks ${sharks.rebuyMinSharks} is below sharks.minimum ${sharks.minimum}: a rebuy that small sends the account straight back to the food fallback`);

    // ramp: null turns it off (every knights login is admitted at once)
    let ramp: RampPlan | null = null;
    if (raw.ramp !== null) {
        const r = raw.ramp === undefined ? {} : raw.ramp;
        if (!isObj(r)) problems.push('ramp must be an object or null');
        const o = isObj(r) ? r : {};
        let steps = DEFAULTS.ramp.steps;
        if (o.steps !== undefined) {
            if (!Array.isArray(o.steps) || o.steps.length === 0 || !o.steps.every(x => Number.isInteger(x) && (x as number) > 0)) problems.push('ramp.steps must be a non-empty list of whole numbers above 0');
            else if (!o.steps.every((x, i) => i === 0 || (x as number) > (o.steps as number[])[i - 1]!)) problems.push('ramp.steps must rise');
            else steps = o.steps as number[];
        }
        ramp = {
            steps: rampSteps(steps, accounts.filter(a => a.method === 'knights').length),
            holdMinutes: num('ramp.holdMinutes', o.holdMinutes, DEFAULTS.ramp.holdMinutes, { min: 0 }),
            dropPct: num('ramp.dropPct', o.dropPct, DEFAULTS.ramp.dropPct, { min: 0, max: 100 }),
            admitTimeoutMinutes: num('ramp.admitTimeoutMinutes', o.admitTimeoutMinutes, DEFAULTS.ramp.admitTimeoutMinutes, { min: 0 }),
            fallbackMix: mix('ramp.fallbackMix', o.fallbackMix, DEFAULTS.ramp.fallbackMix)
        };
    }
    const foodFallbackMix = mix('foodFallbackMix', raw.foodFallbackMix, LOW_FOOD_MIX);
    for (const [where, m] of [['foodFallbackMix', foodFallbackMix], ['ramp.fallbackMix', ramp?.fallbackMix ?? {}]] as const) {
        if ((m.knights ?? 0) > 0) problems.push(`${where} cannot send logins to the knights`);
    }
    if ((foodFallbackMix.heroes ?? 0) > 0) problems.push('foodFallbackMix cannot use the heroes: they eat four times the knights\' sharks');

    const lg = isObj(raw.ledger) ? raw.ledger : {};
    if (raw.ledger !== undefined && !isObj(raw.ledger)) problems.push('ledger must be an object');
    const ledger = {
        everyTicks: num('ledger.everyTicks', lg.everyTicks, DEFAULTS.ledger.everyTicks, { min: 1, integer: true }),
        bookMinutes: num('ledger.bookMinutes', lg.bookMinutes, DEFAULTS.ledger.bookMinutes, { min: 1 })
    };

    const sl = isObj(raw.sell) ? raw.sell : {};
    if (raw.sell !== undefined && !isObj(raw.sell)) problems.push('sell must be an object');
    const floors: Record<string, number> = {};
    if (sl.floors !== undefined) {
        if (!isObj(sl.floors)) problems.push('sell.floors must map item names to prices');
        else for (const [k, v] of Object.entries(sl.floors)) floors[k] = num(`sell.floors.${k}`, v, 1, { min: 1, integer: true });
    }
    if (sl.enabled !== undefined && typeof sl.enabled !== 'boolean') problems.push('sell.enabled must be true or false');
    const sell: SellPlan = {
        enabled: sl.enabled === true,
        cap: num('sell.cap', sl.cap, DEFAULTS.sell.cap, { min: 1, max: HARD_SALE_CAP, integer: true }),
        everyMinutes: num('sell.everyMinutes', sl.everyMinutes, DEFAULTS.sell.everyMinutes, { min: 1 }),
        floors,
        fillMinutes: num('sell.fillMinutes', sl.fillMinutes, DEFAULTS.sell.fillMinutes, { min: 0, max: 30 })
    };
    if (sell.enabled && Object.keys(floors).length === 0) problems.push('sell.enabled needs sell.floors: nothing is sold without a floor');
    if (sell.enabled) {
        // the fallback mixes take accounts only from the knights (the ramp) and the shark eaters (the food)
        const knights = accounts.some(a => a.method === 'knights');
        const eaters = accounts.some(a => NEEDS[a.method].sharks) || (knights && Object.keys(ramp?.fallbackMix ?? {}).some(m => NEEDS[m as MethodId].sharks));
        const methods = [...accounts.map(a => a.method), ...(knights ? Object.keys(ramp?.fallbackMix ?? {}) : []), ...(eaters ? Object.keys(foodFallbackMix) : [])] as MethodId[];
        const away = [...new Set(methods)].filter(m => !SALE_ROUTE.includes(m));
        if (away.length) problems.push(`sell.enabled: ${away.join(', ')} accounts cannot reach the Exchange (no return trip from Ardougne or Shilo exists yet); enable sales in a plan without them`);
    }

    let hpSites = defaultCaps();
    if (raw.hpSites !== undefined) {
        if (!isObj(raw.hpSites)) problems.push('hpSites must map Hitpoints sites to the accounts each takes at once');
        else {
            hpSites = {};
            for (const [k, v] of Object.entries(raw.hpSites)) {
                if (!(LOW_SITES as string[]).includes(k)) problems.push(`hpSites.${k}: not a low Hitpoints site (${LOW_SITES.join(', ')})`);
                else hpSites[k as keyof HpSiteCaps] = num(`hpSites.${k}`, v, 0, { min: 0, max: MAX_LOGINS, integer: true });
            }
            if (!Object.values(hpSites).some(n => (n ?? 0) > 0) && accounts.some(a => NEEDS[a.method].hp)) problems.push('hpSites closes every site, so no account could train Hitpoints');
        }
    }

    const options: Plan['options'] = {};
    if (raw.options !== undefined) {
        if (!isObj(raw.options)) problems.push('options must map methods to role options');
        else
            for (const [k, v] of Object.entries(raw.options)) {
                const m = method(`options.${k}`, k);
                if (m && !isObj(v)) problems.push(`options.${k} must be an object`);
                else if (m) options[m] = v as Record<string, unknown>;
            }
    }

    if (problems.length) throw new PlanError(problems);
    return {
        accounts,
        maxSessions,
        loginSpacingMs: num('loginSpacingMs', raw.loginSpacingMs, DEFAULTS.loginSpacingMs, { min: 0 }),
        hp: num('hp', raw.hp, DEFAULTS.hp, { min: 10, max: 99, integer: true }),
        hpSites,
        sharks,
        ramp,
        foodFallbackMix,
        ledger,
        sell,
        options
    };
}

/** The ramp's steps for `knights` logins: those below the count, then the count itself. */
export function rampSteps(steps: readonly number[], knights: number): number[] {
    if (knights <= 0) return [];
    const below = steps.filter(s => s < knights);
    return [...below, knights];
}

// ------------------------------------------------------------------ setup sequences

export type Stage =
    | { do: 'tutorial' }
    | { do: 'hp'; to: number }
    /** Pickpocket with coins.ts (men, Al-Kharid warriors, Varrock guards) until Thieving `to`. */
    | { do: 'thieving'; to: number }
    /** At least `n` coins in the pack: from the bank, else earned on the Lumbridge men. */
    | { do: 'coins'; n: number }
    /** Mining to `to` with speedrun/skills/mining.ts's lite-client steps (copper at Rimmington, to 15 at most). */
    | { do: 'mining'; to: number }
    | { do: 'wield'; item: string }
    /** Wait for the knights ramp to admit this login, earning on the Varrock guards meanwhile. */
    | { do: 'admission' }
    | { do: 'buy-sharks' }
    | { do: 'to-ardougne' }
    | { do: 'method'; method: MethodId };

export const SHIP_COINS = 100;

/** Everything an account does from a fresh login to its method, in order. Each stage is skipped once its goal holds. */
export function sequenceFor(a: Pick<AccountPlan, 'method' | 'hp'>, plan: Pick<Plan, 'hp' | 'sharks' | 'ramp'>): Stage[] {
    const n = NEEDS[a.method];
    if (n.staged) return [{ do: 'method', method: a.method }];
    const out: Stage[] = [{ do: 'tutorial' }];
    const hp = a.hp ?? plan.hp;
    if (n.hp && hp > 10) out.push({ do: 'hp', to: hp });
    if (n.thieving) out.push({ do: 'thieving', to: n.thieving });
    if (a.method === 'knights' && plan.ramp) out.push({ do: 'admission' });
    if (n.sharks && plan.sharks.source === 'buy') out.push({ do: 'buy-sharks' });
    if (n.mining) {
        out.push({ do: 'coins', n: SHIP_COINS });
        out.push({ do: 'mining', to: Math.min(n.mining, 15) });
        out.push({ do: 'wield', item: 'pickaxe' });
    }
    if (n.ardougne) {
        if (!n.mining) out.push({ do: 'coins', n: SHIP_COINS });
        out.push({ do: 'to-ardougne' });
    }
    out.push({ do: 'method', method: a.method });
    return out;
}

/** The role options for an account: the method's defaults, the plan's per-method options, then the account's own. */
export function roleOptions(a: AccountPlan, plan: Pick<Plan, 'options'>): Record<string, unknown> {
    return { ...ROLE_DEFAULTS[a.method], ...(plan.options[a.method] ?? {}), ...(a.options ?? {}) };
}

// ------------------------------------------------------------------ fallback split

/** `n` logins split across `mix` in proportion to its weights (largest remainder; ties go to the earlier method). */
export function fallbackMix(n: number, mix: Mix): Map<MethodId, number> {
    const entries = (Object.entries(mix) as [MethodId, number][]).filter(([, w]) => w > 0);
    const total = entries.reduce((t, [, w]) => t + w, 0);
    const out = new Map<MethodId, number>();
    if (n <= 0 || total <= 0) return out;
    const quotas = entries.map(([m, w], i) => ({ m, i, q: (w * n) / total }));
    for (const { m, q } of quotas) out.set(m, Math.floor(q));
    let left = n - [...out.values()].reduce((a, b) => a + b, 0);
    for (const { m } of [...quotas].sort((a, b) => b.q - Math.floor(b.q) - (a.q - Math.floor(a.q)) || a.i - b.i)) {
        if (left-- <= 0) break;
        out.set(m, out.get(m)! + 1);
    }
    return out;
}

/**
 * The method for the next fallback login, given those already sent: the one furthest below its share of the
 * mix at the new total, so logins arriving one at a time end up split as `fallbackMix` would split them at once.
 */
export function nextFallback(assigned: ReadonlyMap<MethodId, number>, mix: Mix): MethodId | null {
    const k = [...assigned.values()].reduce((a, b) => a + b, 0) + 1;
    const target = fallbackMix(k, mix);
    let best: MethodId | null = null;
    let gap = 0;
    for (const [m, t] of target) {
        const g = t - (assigned.get(m) ?? 0);
        if (g > gap) {
            gap = g;
            best = m;
        }
    }
    return best;
}
