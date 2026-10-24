// Processing recipes: inputs that a skill turns into an output with a different store cost.
// The board counts ObjType.cost, so a recipe adds `output cost - input cost` of board value per
// action whatever the market pays. Each table's per-action cycle comes from the measured skill
// docs (docs/speedrun/skills/*.md, at 300 ms; per-tick figures carry across tick periods) and is
// marked `measured` or `estimated`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, parseConfigBlocks, type ConfigBlock, type Obj } from './content.ts';

export interface DbRow {
    name: string;
    table: string;
    /** column -> each `data=column,...` line's remaining fields. */
    data: Map<string, string[][]>;
}

export function parseDbRows(text: string): DbRow[] {
    return parseConfigBlocks(text).map(b => {
        const data = new Map<string, string[][]>();
        for (const l of b.lines) {
            if (l.key !== 'data') continue;
            const [col, ...rest] = l.value.split(',');
            const list = data.get(col!) ?? [];
            list.push(rest);
            data.set(col!, list);
        }
        return { name: b.name, table: b.lines.find(l => l.key === 'table')?.value ?? '', data };
    });
}

function structParams(b: ConfigBlock): Map<string, string> {
    const m = new Map<string, string>();
    for (const l of b.lines) {
        if (l.key !== 'param') continue;
        const c = l.value.indexOf(',');
        m.set(l.value.slice(0, c), l.value.slice(c + 1));
    }
    return m;
}

export interface Part {
    obj: string;
    n: number;
}

export interface Cycle {
    /** Ticks per action including bank turnaround. */
    ticks: number;
    basis: 'measured' | 'estimated';
    source: string;
}

export interface Recipe {
    skill: string;
    row: string;
    level: number;
    inputs: Part[];
    output: Part;
    /** Chance an action yields the output (cooking burns, opal cutting). */
    success: number;
    cycle: Cycle;
}

// Per-action cycles. An "action" is one row of the recipe (one platebody, one set of 15 arrows).
export const CYCLES = {
    smithing: { ticks: 8, basis: 'estimated', source: 'smithing.md: 5 ticks per item on make-5 plus a 15-18 tick bank restock per 5-item inventory' },
    smelting: { ticks: 5, basis: 'estimated', source: 'smelting.rs2 delays: 4 ticks per further bar, plus bank turnaround' },
    gems: { ticks: 0.3, basis: 'measured', source: 'crafting.md: 0.2 ticks per cut, 27 gems per 8.2 ticks with the bank cycle' },
    arrows: { ticks: 0.2, basis: 'measured', source: 'fletching.md: 5 delay-free actions per tick, 15 arrows each' },
    stringing: { ticks: 0.29, basis: 'estimated', source: 'fletching.md: delay-free like herblore; 14 per inventory with bank' },
    cutLogs: { ticks: 3, basis: 'estimated', source: 'fletching.md: queued make-X, not measured' },
    bolts: { ticks: 0.3, basis: 'estimated', source: 'gem-cutting cycle assumed (chisel on gem)' },
    jewellery: { ticks: 3, basis: 'estimated', source: 'crafting.md: queued, 2-3 ticks per item, unmeasured' },
    battlestaves: { ticks: 0.29, basis: 'estimated', source: 'use-item-on-item; herblore cycle assumed' },
    herblore: { ticks: 0.29, basis: 'measured', source: 'herblore.md: 0.2 per mix, 4 ticks per 14-potion bank cycle' },
    cooking: { ticks: 3.6, basis: 'measured', source: 'cooking.md: 3 ticks per cook, about 18 ticks per 28-item bank trip' },
    enchant: { ticks: 3.2, basis: 'measured', source: 'magic.md: 3.0-3.11 ticks per cast, 4-tick bank visit per 24-26 casts' },
} satisfies Record<string, Cycle>;

/** Inputs the fletching tables leave implicit, per dbrow file. */
const FLETCH_SECONDARY: Record<string, string | null> = {
    arrows: 'headless_arrow',
    darts: 'feather',
    stringing: 'bow_string',
    bolts: null,
};

export function smithingRecipes(text: string): Recipe[] {
    return parseDbRows(text).filter(r => r.table === 'smithing').map(r => ({
        skill: 'smithing',
        row: r.name,
        level: Number(r.data.get('levelrequired')?.[0]?.[0] ?? 1),
        inputs: [{ obj: r.data.get('bar')![0]![0]!, n: Number(r.data.get('bar_amount')?.[0]?.[0] ?? 1) }],
        output: { obj: r.data.get('product')![0]![0]!, n: Number(r.data.get('product_amount')?.[0]?.[0] ?? 1) },
        success: 1,
        cycle: CYCLES.smithing,
    }));
}

export function smeltingRecipes(text: string): Recipe[] {
    return parseConfigBlocks(text).map(b => {
        const p = structParams(b);
        const inputs: Part[] = [{ obj: p.get('ingredient')!, n: Number(p.get('bar_count') ?? 1) }];
        if (p.has('ingredient_secondary')) inputs.push({ obj: p.get('ingredient_secondary')!, n: Number(p.get('ingredient_secondary_count') ?? 1) });
        return { skill: 'smithing', row: b.name, level: Number(p.get('levelrequired') ?? 1), inputs, output: { obj: p.get('product')!, n: 1 }, success: 1, cycle: CYCLES.smelting };
    });
}

/** stat_random(low, high) at `level` (PlayerOps.ts STAT_RANDOM): succeeds when value > random(256). */
export function statChance(low: number, high: number, level: number): number {
    const l = Math.min(99, level);
    const value = Math.floor((low * (99 - l)) / 98) + Math.floor((high * (l - 1)) / 98) + 1;
    return Math.max(0, Math.min(1, value / 256));
}

export function gemRecipes(text: string): Recipe[] {
    return parseDbRows(text).filter(r => r.table === 'gem_cutting_table').map(r => {
        const rate = r.data.get('success_rate')?.[0];
        return {
            skill: 'crafting',
            row: r.name,
            level: Number(r.data.get('level')?.[0]?.[0] ?? 1),
            inputs: [{ obj: r.data.get('uncut_gem')![0]![0]!, n: 1 }],
            output: { obj: r.data.get('cut_gem')![0]![0]!, n: 1 },
            success: rate ? statChance(Number(rate[0]), Number(rate[1]), 99) : 1,
            cycle: CYCLES.gems,
        };
    });
}

/** fletching_table rows of one dbrow file (`arrows`, `darts`, `stringing`, `bolts`). */
export function fletchingRecipes(kind: keyof typeof FLETCH_SECONDARY, text: string): Recipe[] {
    const secondary = FLETCH_SECONDARY[kind];
    const cycle = kind === 'stringing' ? CYCLES.stringing : kind === 'bolts' ? CYCLES.bolts : CYCLES.arrows;
    return parseDbRows(text).filter(r => r.table === 'fletching_table').map(r => {
        const [product, count] = r.data.get('product')![0]!;
        const n = Number(count ?? 1);
        const item = r.data.get('item')![0]![0]!;
        // Arrows, darts and tipped bolts take one head and one secondary per unit (a tipped bolt
        // spends a tip and a plain `bolt`, bolts.rs2); bolt tips are cut, several from one gem.
        const tipping = kind === 'bolts' && item.endsWith('_bolttips');
        const perUnit = kind === 'bolts' && !tipping ? 1 : n;
        const inputs: Part[] = [{ obj: item, n: perUnit }];
        const second = tipping ? 'bolt' : secondary;
        if (second) inputs.push({ obj: second, n: perUnit });
        return { skill: 'fletching', row: r.name, level: Number(r.data.get('level')?.[0]?.[0] ?? 1), inputs, output: { obj: product!, n }, success: 1, cycle };
    });
}

export function cutLogRecipes(text: string): Recipe[] {
    const out: Recipe[] = [];
    for (const r of parseDbRows(text).filter(r => r.table === 'fletch_bow_table')) {
        const log = r.data.get('log')![0]![0]!;
        const shafts = r.data.get('shafts')?.[0]?.[0];
        if (shafts) out.push({ skill: 'fletching', row: `${r.name}_shafts`, level: 1, inputs: [{ obj: log, n: 1 }], output: { obj: 'arrow_shaft', n: Number(shafts) }, success: 1, cycle: CYCLES.cutLogs });
        for (const kind of ['shortbow', 'longbow']) {
            const v = r.data.get(kind)?.[0];
            if (v) out.push({ skill: 'fletching', row: `${r.name}_${kind}`, level: Number(v[1]), inputs: [{ obj: log, n: 1 }], output: { obj: v[0]!, n: 1 }, success: 1, cycle: CYCLES.cutLogs });
        }
    }
    return out;
}

export function jewelleryRecipes(text: string): Recipe[] {
    const out: Recipe[] = [];
    for (const b of parseConfigBlocks(text)) {
        const p = structParams(b);
        const product = p.get('product');
        if (!product) continue;
        const level = Number(p.get('levelrequired') ?? 1);
        const inputs: Part[] = [{ obj: 'gold_bar', n: 1 }];
        if (p.has('gem')) inputs.push({ obj: p.get('gem')!, n: 1 });
        out.push({ skill: 'crafting', row: b.name, level, inputs, output: { obj: product, n: 1 }, success: 1, cycle: CYCLES.jewellery });
        const strung = p.get('strung');
        if (strung) out.push({ skill: 'crafting', row: `${b.name}_strung`, level: 1, inputs: [{ obj: product, n: 1 }, { obj: 'ball_of_wool', n: 1 }], output: { obj: strung, n: 1 }, success: 1, cycle: CYCLES.stringing });
    }
    return out;
}

export function battlestaffRecipes(text: string): Recipe[] {
    return parseConfigBlocks(text).flatMap(b => {
        const p = structParams(b);
        if (!p.has('product') || !p.has('ingredient')) return [];
        return [{ skill: 'crafting', row: b.name, level: Number(p.get('levelrequire') ?? 1), inputs: [{ obj: p.get('ingredient')!, n: 1 }, { obj: 'battlestaff', n: 1 }], output: { obj: p.get('product')!, n: 1 }, success: 1, cycle: CYCLES.battlestaves }];
    });
}

export function potionRecipes(text: string): Recipe[] {
    return parseConfigBlocks(text).flatMap(b => {
        const p = structParams(b);
        if (!p.has('brew_potion_mixture')) return [];
        return [{
            skill: 'herblore',
            row: b.name,
            level: Number(p.get('brew_potion_level') ?? 1),
            inputs: [{ obj: p.get('brew_potion_ingredient')!, n: 1 }, { obj: p.get('brew_potion_solvent')!, n: 1 }],
            output: { obj: p.get('brew_potion_mixture')!, n: 1 },
            success: 1,
            cycle: CYCLES.herblore,
        }];
    });
}

export function cookingRecipes(text: string): Recipe[] {
    return parseDbRows(text).filter(r => r.table === 'cooking_generic' && r.data.has('uncooked')).map(r => {
        const range = r.data.get('successchance_range')?.[0] ?? r.data.get('successchance')?.[0];
        const inputs: Part[] = [{ obj: r.data.get('uncooked')![0]![0]!, n: 1 }];
        const extra = r.data.get('additional')?.[0]?.[0];
        if (extra) inputs.push({ obj: extra, n: 1 });
        return {
            skill: 'cooking',
            row: r.name,
            level: Number(r.data.get('levelrequired')?.[0]?.[0] ?? 1),
            inputs,
            output: { obj: r.data.get('cooked')![0]![0]!, n: 1 },
            success: range ? statChance(Number(range[0]), Number(range[1]), 99) : 1,
            cycle: CYCLES.cooking,
        };
    });
}

/** Enchant spells' convertobj lines, with the spell's runes as inputs. */
export function enchantRecipes(text: string): Recipe[] {
    const out: Recipe[] = [];
    for (const r of parseDbRows(text).filter(r => r.table === 'magic_spell_table' && r.data.has('convertobj'))) {
        const runes: Part[] = [];
        const req = r.data.get('runesrequired')?.[0] ?? [];
        for (let i = 0; i + 1 < req.length; i += 2) if (req[i] && req[i] !== 'null') runes.push({ obj: req[i]!, n: Number(req[i + 1]) });
        const level = Number(r.data.get('levelrequired')?.[0]?.[0] ?? 1);
        for (const c of r.data.get('convertobj')!) {
            out.push({ skill: 'magic', row: `${r.name}:${c[0]}`, level, inputs: [{ obj: c[0]!, n: 1 }, ...runes], output: { obj: c[1]!, n: 1 }, success: 1, cycle: CYCLES.enchant });
        }
    }
    return out;
}

export function loadRecipes(dir = CONTENT_DIR): Recipe[] {
    const s = (p: string) => readFileSync(join(dir, 'scripts', p), 'utf8');
    return [
        ...smithingRecipes(s('skill_smithing/configs/smithing/smithing.dbrow')),
        ...smeltingRecipes(s('skill_smithing/configs/smelting/smelting.struct')),
        ...gemRecipes(s('skill_crafting/configs/gem/gem.dbrow')),
        ...fletchingRecipes('arrows', s('skill_fletching/configs/arrows/arrows.dbrow')),
        ...fletchingRecipes('darts', s('skill_fletching/configs/darts/darts.dbrow')),
        ...fletchingRecipes('stringing', s('skill_fletching/configs/stringing/bows.dbrow')),
        ...fletchingRecipes('bolts', s('skill_fletching/configs/bolts/bolts.dbrow')),
        ...cutLogRecipes(s('skill_fletching/configs/cut_logs/cut_logs.dbrow')),
        ...jewelleryRecipes(s('skill_crafting/configs/jewellery/jewellery.struct')),
        ...battlestaffRecipes(s('skill_crafting/configs/battlestaves/battlestaves.struct')),
        ...potionRecipes(s('skill_herblore/configs/brewing/brew_potion.struct')),
        ...cookingRecipes(s('skill_cooking/configs/cooking_source/cooking_generic.dbrow')),
        ...enchantRecipes(s('skill_magic/configs/magic_spells.dbrow')),
    ];
}

export interface PricedRecipe extends Recipe {
    inputCost: number;
    outputCost: number;
    /** Board value added per action: output cost x success - input cost. */
    addedPerAction: number;
    addedPerTick: number;
    /** Board multiple: output cost / input cost. */
    multiple: number;
    missing: string[];
}

export function priceRecipe(r: Recipe, objs: Map<string, Obj>): PricedRecipe {
    const missing: string[] = [];
    const cost = (p: Part) => {
        const o = objs.get(p.obj);
        if (!o) missing.push(p.obj);
        return (o?.cost ?? 0) * p.n;
    };
    const inputCost = r.inputs.reduce((s, p) => s + cost(p), 0);
    const outputCost = cost(r.output) * r.success;
    const addedPerAction = outputCost - inputCost;
    return { ...r, inputCost, outputCost, addedPerAction, addedPerTick: addedPerAction / r.cycle.ticks, multiple: inputCost > 0 ? outputCost / inputCost : Infinity, missing };
}
