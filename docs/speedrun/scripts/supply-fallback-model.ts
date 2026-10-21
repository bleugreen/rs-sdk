#!/usr/bin/env bun
/**
 * Supply-fallback model (rs/129): the tick cost of each at-risk supply line in SUPPLIES.md,
 * as deltas against RUN-ORDER.md's step rows, priced from the existing skill models and
 * their measured cadences. No server needed.
 *
 *   bun docs/speedrun/scripts/supply-fallback-model.ts [section ...]
 *
 * Sections: prayer smithing fletching crafting herblore runecraft combat woodcutting (default all).
 *
 * Every constant names its source. Labels: m measured, r read, i inferred (arithmetic here),
 * e estimated (an allowance set here by judgement). The page that explains the output is
 * docs/speedrun/research/supply-fallbacks.md.
 */

const want = new Set(process.argv.slice(2));
const on = (s: string) => want.size === 0 || want.has(s);
const f0 = (x: number) => Math.round(x).toLocaleString('en-US');
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const sgn = (x: number) => (Math.round(x) > 0 ? '+' : '') + f0(x);
const table = (head: string[], rows: (string | number)[][]) => {
    console.log(`| ${head.join(' | ')} |`);
    console.log(`|${head.map(() => '---').join('|')}|`);
    for (const r of rows) console.log(`| ${r.join(' | ')} |`);
    console.log('');
};

// ---- level table (r: Player.ts:77-85; base xp = game xp / 25), as in every skill model ----
const LEVEL_XP: number[] = [0, 0];
{
    let acc = 0;
    for (let level = 1; level <= 98; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_XP.push(Math.floor(acc / 4) / 25);
    }
}
const XP99 = LEVEL_XP[99]!;
const levelOf = (xp: number) => { let L = 1; while (L < 99 && xp >= LEVEL_XP[L + 1]! - 1e-9) L++; return L; };

// =====================================================================================
// Prayer (RUN-ORDER S10a, S18b, S25b)
// =====================================================================================
if (on('prayer')) {
    const BONE = { dragon: 72, baby: 30, big: 15 }; // r, bones.obj via prayer.md section 5
    const BOOTH = 58 / 28; // m, prayer.md section 2: 58-tick bank cycle per 28 bones (RUN-ORDER S25b uses it)
    const STUN = 196; // i, interleaving.md section 8: ~100 stuns x 1.96 bones (m per stun)
    const PLAN = { early: 11, stun: 196, booth: 348, s10a: 21, s25b: 721 }; // RUN-ORDER S10a, S18b, S25b
    const XP43 = LEVEL_XP[43]!;
    // Fill order: best bone first. Returns bone counts by type used, total, and the feasibility.
    const plan = (dragon: number, baby: number, big: number) => {
        let need = XP99, bones = 0, used = { dragon: 0, baby: 0, big: 0 };
        for (const [k, have] of [['dragon', dragon], ['baby', baby], ['big', big]] as const) {
            const take = Math.min(have, Math.ceil(Math.max(0, need) / BONE[k]));
            used[k] = take; need -= take * BONE[k]; bones += take;
        }
        // Prayer 43 before TGV (S10a): best bones first, buried on the spot at 2 ticks each, 2n-1 (m: 11 bones 21 ticks)
        let x = 0, early = 0;
        for (const k of ['dragon', 'baby', 'big'] as const) for (let i = 0; i < used[k] && x < XP43; i++) { x += BONE[k]; early++; }
        const booth = Math.max(0, bones - STUN - early);
        const s10a = 2 * early - 1;
        const s25b = booth * BOOTH;
        return { used, bones, early, booth, s10a, s25b, short: Math.max(0, need), delta: (s10a - PLAN.s10a) + (s25b - PLAN.s25b) };
    };
    console.log('## Prayer\n');
    console.log(`Base xp for 99: ${f1(XP99)}; for 43: ${f1(XP43)} (r, level table). Booth ${f2(BOOTH)} ticks per bone (m, prayer.md section 2); stuns carry ${STUN} bones (i, interleaving.md section 8).\n`);
    console.log('### A. Dragon bones held D, babydragon bones as many as needed (farm continues), no big bones\n');
    const rowsA: (string | number)[][] = [];
    for (const d of [555, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50, 0]) {
        const p = plan(d, 99999, 0);
        rowsA.push([d, p.used.baby, p.bones, p.early, p.booth, f0(p.s10a + p.s25b), sgn(p.delta)]);
    }
    table(['Dragon bones D', 'Babydragon used', 'Total bones', 'S10a bones', 'S25b booth bones', 'S10a + S25b ticks', 'Delta vs RUN-ORDER (expected and best)'], rowsA);
    console.log('### B. Held now plus D dragon bones: 470 babydragon, 673 big bones, nothing more farmed\n');
    const rowsB: (string | number)[][] = [];
    for (const d of [555, 450, 350, 300, 250, 219, 200, 100, 0]) {
        const p = plan(d, 470, 673);
        rowsB.push([d, p.used.baby, p.used.big, p.bones, p.booth, p.short > 0 ? `**short ${f0(p.short)} base** (${Math.ceil(p.short / 30)} more babydragon)` : sgn(p.delta)]);
    }
    table(['Dragon bones D', 'Babydragon used', 'Big used', 'Total bones', 'S25b booth bones', 'Delta, or the shortfall'], rowsB);
    const perDragon = { baby: (72 / 30 - 1) * BOOTH, big: (72 / 15 - 1) * BOOTH };
    console.log(`Marginal cost of one dragon bone not held: ${f2(perDragon.baby)} ticks if a babydragon bone replaces it, ${f2(perDragon.big)} if big bones do (i). One babydragon bone replaced by big bones: ${f2((30 / 15 - 1) * BOOTH)}.\n`);
    const minD = Math.ceil((XP99 - 470 * 30 - 673 * 15) / 72);
    console.log(`Feasibility with today's 470 babydragon + 673 big: D >= ${minD} dragon bones, or ${Math.ceil((XP99 - 673 * 15) / 30) - 470} more babydragon bones (i).\n`);
}

// =====================================================================================
// Smithing (RUN-ORDER S25a)
// =====================================================================================
if (on('smithing')) {
    const PB = { mithril: { level: 68, xp: 250 }, adamant: { level: 88, xp: 312.5 } }; // r, smithing.md section 4 (smithing.struct, smithing.dbrow)
    const PER_ITEM = 35 / 5; // m, smithing.md section 2: one inventory of 5 platebodies 31-39 ticks, mean 35
    const PLAN_ADAMANT = 340; // r, smithing.md section 7 (exact; SUPPLIES.md carries 365 with the +25 margin)
    // From the bottom of 68 (mithril unlock) to 99: mithril until 88, then adamant while bars last, then mithril.
    const items = (adamantBars: number) => {
        let x = LEVEL_XP[68]!, m = 0, a = 0, left = Math.floor(adamantBars / 5);
        while (x < XP99) {
            if (levelOf(x) >= 88 && left > 0) { x += PB.adamant.xp; a++; left--; } else { x += PB.mithril.xp; m++; }
        }
        return { m, a, total: m + a };
    };
    const base = items(PLAN_ADAMANT);
    console.log('## Smithing\n');
    console.log(`Platebodies from 68 to 99 on the plan: ${base.m} mithril + ${base.a} adamant (i; smithing.md section 7 has 56 + 68 from the measured route, which starts the band a level off). Every platebody costs ${PER_ITEM} ticks with the trade turnaround (m).\n`);
    const rows: (string | number)[][] = [];
    for (const bars of [365, 340, 300, 250, 200, 150, 100, 50, 0]) {
        const it = items(bars);
        rows.push([bars, it.a, it.m, it.m * 5 + 25, sgn((it.total - base.total) * PER_ITEM)]);
    }
    table(['Adamantite bars held', 'Adamant platebodies', 'Mithril platebodies (68-99)', 'Mithril bars needed (+25 margin)', 'Delta vs S25a (expected and best)'], rows);
    console.log(`Marginal: ${f2((PB.adamant.xp / PB.mithril.xp - 1) * PER_ITEM / 5)} ticks per adamantite bar not held (i).\n`);
}

// =====================================================================================
// Fletching (RUN-ORDER S18d)
// =====================================================================================
if (on('fletching')) {
    // r, fletching.md section 2: 15 arrows per action; base xp per action by arrowhead tier
    const TIERS = [
        { name: 'bronze', level: 1, xp: 19.5 }, { name: 'iron', level: 15, xp: 37.5 }, { name: 'steel', level: 30, xp: 75 },
        { name: 'mithril', level: 45, xp: 112.5 }, { name: 'adamant', level: 60, xp: 150 },
    ];
    const run = (adamantHeads: number) => {
        let x = 0, acts: Record<string, number> = {}, adLeft = Math.floor(adamantHeads / 15);
        while (x < XP99) {
            const L = levelOf(x);
            let t = [...TIERS].reverse().find(t => t.level <= L && (t.name !== 'adamant' || adLeft > 0))!;
            if (t.name === 'adamant') adLeft--;
            x += t.xp; acts[t.name] = (acts[t.name] ?? 0) + 1;
        }
        const total = Object.values(acts).reduce((a, b) => a + b, 0);
        return { acts, total };
    };
    const base = run(3735);
    console.log('## Fletching\n');
    const rows: (string | number)[][] = [];
    for (const heads of [3735, 3000, 2000, 1000, 400, 0]) {
        const r = run(heads);
        rows.push([heads, r.acts.adamant ?? 0, r.acts.mithril ?? 0, r.total, (r.acts.mithril ?? 0) * 15, r.total * 15, sgn((r.total - base.total) * 0.2), `${f1(((r.acts.mithril ?? 0) + (r.acts.adamant ?? 0)) / 7.3)}`]);
    }
    table(['Adamant arrowheads held', 'Adamant actions', 'Mithril actions', 'Total actions', 'Mithril arrowheads', 'Headless arrows', 'Standalone delta (0.2 ticks per action, m)', 'Stuns for the top two tiers (7.3 actions per stun, m)'], rows);
}

// =====================================================================================
// Crafting (RUN-ORDER S25d)
// =====================================================================================
if (on('crafting')) {
    const GEM = { sapphire: 50, emerald: 67.5, ruby: 85, diamond: 107.5 }; // r, gem.dbrow via crafting.md section 2
    const START = LEVEL_XP[45]!; // RUN-ORDER S25d starts at 45 (Dwarf Cannon 750 + Goblin Diplomacy 200)
    const need = XP99 - START;
    const PER_GEM = 121 / 364; // i, RUN-ORDER S25d: 121 ticks for 364 diamonds (crafting.md: 117 measured from 43)
    const PLAN = 364;
    // drop-table mix (r, shared_droptables.rs2 randomjewel: of 128, sapphire 32, emerald 16, ruby 8, diamond 2)
    const MIX: [keyof typeof GEM, number][] = [['sapphire', 32], ['emerald', 16], ['ruby', 8], ['diamond', 2]];
    const mixXp = MIX.reduce((a, [g, w]) => a + GEM[g] * w, 0) / MIX.reduce((a, [, w]) => a + w, 0);
    const fill = (diamonds: number, per: number) => diamonds + Math.ceil(Math.max(0, need - diamonds * GEM.diamond) / per);
    console.log('## Crafting\n');
    console.log(`Base xp 45 -> 99: ${f0(need)}; ${f2(PER_GEM)} ticks per gem (i). Drop-table mix: ${f1(mixXp)} base per gem.\n`);
    const rows: (string | number)[][] = [];
    for (const d of [364, 250, 150, 50, 5, 0]) {
        const cell = (per: number) => { const g = fill(d, per); return `${g} gems, ${sgn((g - PLAN) * PER_GEM)}`; };
        rows.push([d, cell(GEM.ruby), cell(GEM.emerald), cell(GEM.sapphire), cell(mixXp)]);
    }
    table(['Uncut diamonds held', 'Rest in rubies', 'Rest in emeralds', 'Rest in sapphires', 'Rest in the drop-table mix'], rows);
    const HL = Math.ceil(need / 35); // r, hard leather body 35 base
    console.log(`Hard leather bodies only: ${HL} bodies at 26 per ~7.5-tick inventory (i, crafting.md section 2) = ${f0(HL / 26 * 7.5)} ticks, ${sgn(HL / 26 * 7.5 - 121)}.\n`);
    console.log(`Gem-table drops behind each plan (i): 364 diamonds alone = ${f0(364 * 64)} jewel-table drops (2 in 128); the mix needs ${f0(fill(0, mixXp) * 128 / 58)} drops for ${fill(0, mixXp)} gems.\n`);
}

// =====================================================================================
// Herblore (RUN-ORDER S25e)
// =====================================================================================
if (on('herblore')) {
    const START = LEVEL_XP[28]!; // Druidic Ritual 250 base
    const need = XP99 - START;
    const PER_POTION = 5.07 / 14; // m, herblore.md section 2: steady cycle 5.07 ticks per 14 mixes
    const PLAN = 418, PLAN_TICKS = 170; // supply-safe list: 27 guam + 391 irit (herblore.md section 7; RUN-ORDER S25e)
    const GUAM_TO_45 = 27;
    // r, brew_potion.struct (exp in tenths); herb weights of 128 from shared_droptables.rs2 randomherb
    const MIX = [
        { herb: 'guam', w: 32, xp: 25, with: 'eye of newt (shop)', level: 3 },
        { herb: 'tarromin', w: 18, xp: 50, with: 'limpwurt root (giant drops)', level: 12 },
        { herb: 'harralander', w: 14, xp: 67.5, with: 'chocolate dust (shop)', level: 26 },
        { herb: 'ranarr', w: 11, xp: 87.5, with: 'snape grass (prayer potion)', level: 38 },
        { herb: 'irit', w: 8, xp: 100, with: 'eye of newt', level: 45 },
        { herb: 'avantoe', w: 6, xp: 112.5, with: 'snape grass (fishing potion)', level: 50 },
        { herb: 'kwuarm', w: 5, xp: 125, with: 'limpwurt root', level: 55 },
    ];
    const mixXp = MIX.reduce((a, m) => a + m.w * m.xp, 0) / MIX.reduce((a, m) => a + m.w, 0);
    const nonIrit = MIX.filter(m => m.herb !== 'irit');
    const nonIritXp = nonIrit.reduce((a, m) => a + m.w * m.xp, 0) / nonIrit.reduce((a, m) => a + m.w, 0);
    const potions = (irit: number, per: number) => {
        const rem = need - GUAM_TO_45 * 25 - irit * 100;
        return GUAM_TO_45 + irit + Math.ceil(Math.max(0, rem) / per);
    };
    console.log('## Herblore\n');
    console.log(`Base xp 28 -> 99: ${f0(need)}; ${f2(PER_POTION)} ticks per potion (m cycle); herb-table mix ${f1(mixXp)} base per potion, ${f1(nonIritXp)} without irit.\n`);
    const rows: (string | number)[][] = [];
    for (const irit of [391, 300, 200, 100, 50, 0]) {
        const cell = (per: number) => { const p = potions(irit, per); return `${p}, ${sgn((p - PLAN) * PER_POTION)}`; };
        rows.push([irit, cell(25), cell(50), cell(67.5), cell(nonIritXp)]);
    }
    table(['Irit (unf) held (of 391 + 14 spare)', 'Rest as attack potions (guam)', 'Rest as strength (tarromin)', 'Rest as energy (harralander)', 'Rest as the non-irit herb-table mix'], rows);
    const pMix = Math.ceil(need / mixXp);
    console.log(`Whole herb-table mix incl. irit: ${pMix} potions, ${sgn((pMix - PLAN) * PER_POTION)}; herb drops behind it ${f0(pMix * 128 / 94)} (of which irit ${f0(pMix * 8 / 94)}); behind the supply-safe 391 irit: ${f0(391 * 16)} herb drops (i).\n`);
    table(['Herb', 'Share of drops (of 128)', 'Potion base xp', 'Secondary', 'Herblore level'], MIX.map(m => [m.herb, m.w, m.xp, m.with, m.level]));
}

// =====================================================================================
// Runecraft (RUN-ORDER S21)
// =====================================================================================
if (on('runecraft')) {
    const XP = { air: 5, fire: 7, body: 7.5, nature: 9 }; // r, runecraft.dbrow via runecraft.md section 4
    const x44 = LEVEL_XP[44]!;
    const crafts = (per: number, ess = 27) => Math.ceil((XP99 - x44) / (ess * per));
    const CYCLE = 7, PLAN_CRAFTS = 161, PLAN = 1132; // m cycle; RUN-ORDER S21 (161 x 7 + 5)
    const RELOG = 3.6, SESSION = 5; // i, RUN-ORDER section 4 (2 m + tail); m, the session's first trade
    console.log('## Runecraft\n');
    console.log(`Crafts 44 -> 99 at 27 essence: nature ${crafts(XP.nature)}, body ${crafts(XP.body)}, fire ${crafts(XP.fire)}, air ${crafts(XP.air)} (i).\n`);
    const alt = (name: string, per: number, travel: number, note: string) => {
        const c = crafts(per);
        return [name, c, c * 27, sgn(c * 27 - 4347), sgn((c - PLAN_CRAFTS) * CYCLE + travel), note];
    };
    table(['Altar 44-99', 'Crafts', 'Essence', 'Essence vs H17', 'Delta (crafts at 7 ticks + travel change, i/e)', 'Talisman source'], [
        alt('nature (plan)', XP.nature, 0, 'rare drop table only'),
        alt('body', XP.body, -26, 'hill giants drop 1-5 per account-hour (BONES); ruins (3052,3444)'),
        alt('fire', XP.fire, 0, 'not checked'),
        alt('air', XP.air, -35, 'Duke Horacio, goblins; ruins (2984,3291)'),
    ]);
    // Batches: SCORED logs out while the next batch of givers is staged in the room (logged-out ticks are free).
    const batch = (served: number) => (Math.ceil(PLAN_CRAFTS / served) - 1) * (RELOG + SESSION);
    const R = 25; // e: a relayed talisman's pipeline per entry (keeper trade ~5, enter 2-3, walk 3, trade turn, walk 3, exit, hand back ~5)
    const rows: (string | number)[][] = [];
    for (const T of [1, 2, 4, 6, 17]) {
        // with a keeper: talismans relayed at the ruins; the staging while SCORED is logged out is unlimited by T;
        // while SCORED is in, the keeper feeds T/R entries per tick against 1/7 consumed
        const feed = 7 * T / R;
        const withKeeper = feed >= 1 ? 0 : batch(Math.floor(17 / (1 - feed)));
        // without a keeper: each giver keeps its talisman, so at most T givers (SCORED hands its own over once)
        const noKeeper = T >= 17 ? 0 : batch(T);
        rows.push([T, withKeeper === 0 ? '0 (continuous)' : `${sgn(withKeeper)} (${Math.ceil(PLAN_CRAFTS / Math.floor(17 / (1 - feed)))} batches)`, noKeeper === 0 ? '0 (roster)' : `${sgn(noKeeper)} (${Math.ceil(PLAN_CRAFTS / T)} batches)`]);
    }
    console.log(`Talisman count against the 17-giver roster (keeper pipeline R = ${R} ticks per entry, e; extra batch = relog ${RELOG} + session trade ${SESSION}):\n`);
    table(['Nature talismans held (all accounts)', 'With a keeper at the ruins', 'Without a keeper (relog batches of T givers)'], rows);
    const outside = { stock: 4200 - 1127, tuned: crafts(XP.nature, 26) * 20 - 1127 };
    console.log(`SCORED leaving the room each cycle (one talisman, its own): nature 25 ticks per craft stock (m, runecraft.md section 4: ${crafts(XP.nature, 26)} crafts of 26) = ${sgn(outside.stock)}; ~20 tuned (e) = ${sgn(outside.tuned)}.\n`);
}

// =====================================================================================
// Combat finish (RUN-ORDER S14, S27) and the cannon
// =====================================================================================
if (on('combat')) {
    // r: hit roll randominc(A) > randominc(D) (player_combat.rs2:65); A = (eff+8)(bonus+64), D = (def+9)(bonus+64);
    // poison spider defence 52, slash 17, ranged 14 (helper-fed-and-combat.md section 1, on main).
    const hc = (A: number, D: number) => (A > D ? 1 - (D + 2) / (2 * (A + 1)) : A / (2 * (D + 1)));
    const D_SLASH = 61 * 81, D_RANGED = 61 * 78;
    const maxHit = (eff: number, bonus: number) => Math.floor((eff * (bonus + 64) + 320) / 640);
    // Weapons (r, scimitars.obj, longswords.obj, 2hswords.obj): slash, strength, attack rate
    const W = {
        'rune scimitar': { slash: 45, str: 44, rate: 4 },
        'rune longsword': { slash: 47, str: 49, rate: 5 },
        'adamant scimitar': { slash: 29, str: 28, rate: 4 },
        'mithril scimitar': { slash: 21, str: 20, rate: 4 },
        'rune 2h sword (cannon-only phases)': { slash: 69, str: 70, rate: 7 },
    } as const;
    // Kit melee: effective attack 135 (+8 = 143), effective strength 143 (helper-fed-and-combat.md section 1)
    const kitMelee = (w: { slash: number; str: number; rate: number }, glory: boolean) => {
        const h = hc(143 * (w.slash + (glory ? 10 : 0) + 64), D_SLASH);
        const mh = maxHit(143, w.str + (glory ? 6 : 0));
        return { cannon: h, melee: (h * mh / 2) * (4 / w.rate) };
    };
    const bare = (w: { slash: number }) => hc(107 * (w.slash + 64), D_SLASH); // S14: Attack 99, no boosts (rs/31)
    const KREF = kitMelee(W['rune scimitar'], true);
    // Ranged kit (ranging potion, effective 120): knife +25/+24, magic shortbow +69 attack with rune arrows +49 strength
    const rng = (atk: number, str: number, glory: boolean) => ({ h: hc(120 * (atk + (glory ? 10 : 0) + 64), D_RANGED), mh: maxHit(120, str) });
    const knife = rng(25, 24, true);

    // rs/91 kit rates (m; cannon-kit-model.ts on main), cannon and hand shares from helper-fed-and-combat.md section 3
    type Curve = [number, number][];
    const at = (c: Curve, l: number) => { if (l <= c[0]![0]) return c[0]![1]; for (let i = 1; i < c.length; i++) if (l <= c[i]![0]) { const [l0, v0] = c[i - 1]!, [l1, v1] = c[i]!; return v0 + ((v1 - v0) * (l - l0)) / (l1 - l0); } return c[c.length - 1]![1]; };
    const CANNON: Curve = [[76, 11.75], [87.5, 12.35], [99, 12.44]];
    const HAND: Curve = [[76, 7.71], [87.5, 9.60], [99, 10.46]];
    const HANDH: Curve = [[76, 2.57], [87.5, 3.19], [99, 3.48]];
    const MELEE = { R: 13.655, D: 7.65, H: 2.534 }, SCIM = 13.64, MELEE_H = 3.08;
    const R0 = LEVEL_XP[50]! + 485, D_GAP = 1288, H_GAP = 4938;
    const integrate = (a: number, b: number, rate: (l: number) => number, extra: (l: number) => number) => {
        let t = 0, x = a, by = 0;
        while (x < b - 1e-9) { const l = levelOf(x), next = Math.min(b, l < 99 ? LEVEL_XP[l + 1]! : b), r = rate(l), dt = (next - x) / r; t += dt; by += extra(l) * dt; x = next; }
        return { t, by };
    };
    type Opt = { cannonMelee?: number; meleeD?: number; cannonR?: number; hand?: number; noCannonAfter?: number };
    const planE = (o: Opt = {}) => {
        const cm = o.cannonMelee ?? 1, md = o.meleeD ?? 1, cr = o.cannonR ?? 1, hd = o.hand ?? 1;
        const t1 = D_GAP / (MELEE.D * md);
        const r1 = R0 + t1 * MELEE.R * cm;
        let h = t1 * MELEE.H * md;
        const k = integrate(r1, XP99, l => (l >= 70 ? at(CANNON, l) * cr + at(HAND, l) * hd : SCIM * cm), l => (l >= 70 ? at(HANDH, l) * hd : 0));
        h += k.by;
        const hRest = Math.max(0, H_GAP - h) / MELEE_H;
        return { total: t1 + k.t + hRest, t1, k: k.t, hRest };
    };
    const base = planE();
    console.log('## Combat finish (S27) and the pre-MM session (S14)\n');
    console.log(`Plan (e) with rs/91's kit reproduces ${f0(base.total)} (RUN-ORDER S27: 1,857): melee ${f0(base.t1)}, cannon phases ${f0(base.k)}, HP-only ${f0(base.hRest)} (i).\n`);

    // Weapon fallbacks
    const wRows: (string | number)[][] = [];
    for (const [name, w] of Object.entries(W)) {
        const k = kitMelee(w, true);
        const cm = k.cannon / KREF.cannon, md = k.melee / KREF.melee;
        const s14 = 113 * bare(W['rune scimitar']) / bare(w);
        const p = name.startsWith('rune 2h') ? planE({ cannonMelee: cm }) : planE({ cannonMelee: cm, meleeD: md });
        wRows.push([name, f2(bare(w)), sgn(s14 - 113), f2(cm), f2(md), sgn(p.total - base.total)]);
    }
    table(['Weapon', 'S14 cannon hit chance (bare, Attack 99)', 'S14 delta (113 m base)', 'S27 cannon factor (kit)', 'S27 melee Defence factor (kit)', 'S27 delta'], wRows);

    // Ranged hand weapon: knives vs magic shortbow, glory or not
    const bow = rng(69, 49, true);
    const bowNoG = rng(69, 49, false);
    const knifeNoG = rng(25, 24, false);
    const HAND_BOW = 7.36 / 8.13; // m, ranged.md section 4: moss giants, Ranged 70, no cannon (100 ms)
    const variants: [string, Opt][] = [
        ['rune knives, glory (plan)', {}],
        ['magic shortbow + rune arrows, glory', { cannonR: bow.h / knife.h, hand: HAND_BOW }],
        ['rune knives, no glory', { cannonR: knifeNoG.h / knife.h, hand: (knifeNoG.h * knifeNoG.mh) / (knife.h * knife.mh), cannonMelee: kitMelee(W['rune scimitar'], false).cannon / KREF.cannon, meleeD: kitMelee(W['rune scimitar'], false).melee / KREF.melee }],
        ['magic shortbow, no glory', { cannonR: bowNoG.h / knife.h, hand: HAND_BOW * bowNoG.h / bow.h, cannonMelee: kitMelee(W['rune scimitar'], false).cannon / KREF.cannon, meleeD: kitMelee(W['rune scimitar'], false).melee / KREF.melee }],
        ['no hand weapon: cannon with the scimitar throughout', { hand: 0, cannonR: SCIM / 12.2 }],
    ];
    const vRows = variants.map(([n, o]) => { const p = planE(o); return [n, f2(o.cannonR ?? 1), f2(o.hand ?? 1), f0(p.total), sgn(p.total - base.total), f0(p.hRest)]; });
    table(['S27 variant', 'Cannon share factor', 'Hand share factor', 'S27 ticks', 'Delta', 'HP-only ticks inside'], vRows);

    // Cannonballs short: each missing ball's cannon xp is earned at the hand rate instead
    console.log(`Cannonball cost (i): finish ${f2(20.9 / at(HAND, 87.5))} ticks per missing ball (20.9 Ranged per ball, m, config 4, made up at the hand share ${f2(at(HAND, 87.5))}); S14 about ${f1(19.6 / (1337 / 628))} per missing ball (19.6 per ball against the knives-only 1-50 average, ranged.md).\n`);

    // No cannon at all: hand-only, magic shortbow, ranging potion
    const HAND_ONLY: Curve = [[50, 5.37], [70, 8.13], [99, 8.75]]; // m, ranged.md section 4 sweep (rune knives, rapid, no kit)
    const HAND_ONLY_H: Curve = [[50, 1.77], [70, 2.68], [99, 2.89]];
    const handOnly = (factor: number) => {
        const t1 = D_GAP / 9.34; // m, rs/30 kit Defence at the ogres (quests README section 6)
        const k = integrate(R0, XP99, l => at(HAND_ONLY, l) * factor, l => at(HAND_ONLY_H, l) * factor);
        const h = k.by + t1 * 3.08;
        return t1 + k.t + Math.max(0, H_GAP - h) / MELEE_H;
    };
    const nk = handOnly(1), nb = handOnly(HAND_BOW), nbp = handOnly(HAND_BOW * 1.21);
    console.log(`No cannon, S27 by hand from Ranged ~54 (i): rune knives ${f0(nk)}; magic shortbow ${f0(nb)}; magic shortbow + ranging potion (x1.21, helper-fed-and-combat.md section 1) ${f0(nbp)}. Against 1,857: ${sgn(nk - 1857)}, ${sgn(nb - 1857)}, ${sgn(nbp - 1857)}.\n`);
}

// =====================================================================================
// Woodcutting axe (RUN-ORDER S07)
// =====================================================================================
if (on('woodcutting')) {
    // r, trees.dbrow successchance per axe; productexp/10; woodcutting-model.ts success formula
    const T = {
        normal: { req: 1, xp: 25, fells: true, lohi: { rune: [224, 700], adamant: [192, 600], mithril: [160, 500] } },
        oak: { req: 15, xp: 37.5, fells: false, lohi: { rune: [112, 350], adamant: [96, 300], mithril: [80, 250] } },
        willow: { req: 30, xp: 67.5, fells: false, lohi: { rune: [56, 175], adamant: [48, 150], mithril: [40, 125] } },
    } as const;
    type Axe = 'rune' | 'adamant' | 'mithril';
    const p = (lo: number, hi: number, L: number) => Math.min(Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1, 256) / 256;
    const rate = (axe: Axe, L: number) => Math.max(...Object.values(T).filter(t => t.req <= L).map(t => { const [lo, hi] = t.lohi[axe]; const s = p(lo, hi, L); return (t.xp * s) / (t.fells ? 4 + s : 4); }));
    const ticks = (axe: Axe) => { let t = 0; for (let L = 1; L < 99; L++) t += (LEVEL_XP[L + 1]! - LEVEL_XP[L]!) / rate(axe, L); return t; };
    const willowFrom = (axe: Axe) => { for (let L = 30; L < 99; L++) { const o = T.oak.lohi[axe], w = T.willow.lohi[axe]; if (67.5 * p(w[0], w[1], L) > 37.5 * p(o[0], o[1], L)) return L; } return 99; };
    const rune = ticks('rune');
    console.log('## Woodcutting axe\n');
    const rows = (['rune', 'adamant', 'mithril'] as Axe[]).map(a => { const r = ticks(a) / rune; return [a, willowFrom(a), f2(r), sgn(3460 * (r - 1)), sgn(3958 * (r - 1))]; });
    table(['Axe', 'Willow beats oak from', 'Ideal ticks ratio to rune', 'S07 knife delta (3,460)', 'S07 plain delta (3,958)'], rows);
}
