// Melee rate model and level integration for docs/speedrun/skills/combat.md.
//
// Rate per swing from the engine's formulas (read): hit if randominc(A) > randominc(D)
// (player_combat.rs2 player_npc_hit_roll), A = (floor(att*prayer)+8+style)*(bonus+64),
// D = (def+9)*(defbonus+64) (npc_combat.rs2 npc_defence_roll_specific), max hit
// floor((effstr*(strbonus+64)+320)/640) (combat.rs2 combat_maxhit), damage uniform 0..max and
// capped at the NPC's remaining hp (player_melee.rs2), 4 base xp per damage to the style's
// skill and 1.33 to Hitpoints (combat.rs2 give_combat_experience).
// Kill time: exact expected swings to remove `hp` (dynamic programme over remaining hp).
// Potion boost: averaged over drinking at half of the fresh boost (super potions +5+15%).
// Calibration: measured / model over the 300 ms samples (combat-rate.ts, ogres) = CAL.
//
// Run: bun docs/speedrun/scripts/combat-model.ts

export const CAL = 0.944; // mean of 0.921, 0.932, 1.009, 0.938, 0.922 (300 ms, ogres, Attack 99)

export const lvlXp: number[] = [0, 0]; // base xp to reach level L (Player.ts levelExperience / 10 / 25... in base units)
{
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        lvlXp[i + 2] = Math.floor(acc / 4) / 25;
    }
}
export function levelOf(base: number): number { let l = 1; while (l < 99 && lvlXp[l + 1] <= base) l++; return l; }

const hitp = (A: number, D: number) => (A > D ? 1 - (D + 2) / (2 * (A + 1)) : A / (2 * (D + 1)));
function swingsToKill(hp: number, M: number, p: number): number {
    const E = [0];
    for (let h = 1; h <= hp; h++) {
        let s = 0;
        for (let k = 1; k <= M; k++) s += E[Math.max(0, h - k)];
        E[h] = (1 + (p / (M + 1)) * s) / (p - p / (M + 1));
    }
    return E[hp];
}

export type Style = 'aggressive' | 'defensive' | 'accurate' | 'controlled';
export type Target = { name: string; hp: number; def: number; sdef: number };
export const OGRE: Target = { name: 'Ogre', hp: 60, def: 43, sdef: 0 };

// Best weapon the Attack level allows (scimitars: 4-tick, slash; scimitars.obj).
export function weapon(att: number): { name: string; slash: number; str: number } {
    if (att >= 40) return { name: 'rune scimitar', slash: 45, str: 44 };
    if (att >= 30) return { name: 'adamant scimitar', slash: 29, str: 28 };
    if (att >= 20) return { name: 'mithril scimitar', slash: 21, str: 20 };
    if (att >= 10) return { name: 'black scimitar', slash: 19, str: 14 };
    if (att >= 5) return { name: 'steel scimitar', slash: 15, str: 14 };
    return { name: 'iron scimitar', slash: 10, str: 9 };
}

export type Opts = { pots: boolean; prayer: number; amulet: boolean; tgt: Target };
export const DEFAULT: Opts = { pots: true, prayer: 43, amulet: true, tgt: OGRE };

/** Model base xp per tick to the trained skill (before calibration), plus the inputs. */
export function model0(att: number, str: number, style: Style, o: Opts = DEFAULT) {
    const w = weapon(att);
    const freshA = o.pots ? 5 + Math.floor(att * 0.15) : 0;
    const freshS = o.pots ? 5 + Math.floor(str * 0.15) : 0;
    // Ultimate Strength (31) and Incredible Reflexes (34), base Prayer level (prayers.dbrow).
    const prA = o.prayer >= 34 ? 1.15 : o.prayer >= 16 ? 1.1 : o.prayer >= 7 ? 1.05 : 1;
    const prS = o.prayer >= 31 ? 1.15 : o.prayer >= 13 ? 1.1 : o.prayer >= 4 ? 1.05 : 1;
    const sA = style === 'accurate' ? 3 : style === 'controlled' ? 1 : 0;
    const sS = style === 'aggressive' ? 3 : style === 'controlled' ? 1 : 0;
    // Controlled on a scimitar is the stab "lunge" (weapon_slash_table): stab bonus 7 for rune.
    const bonus = style === 'controlled' ? Math.round(w.slash * 7 / 45) : w.slash;
    let E = 0, Msum = 0, psum = 0, n = 0;
    for (let f = 0; f <= 10; f++) {
        const bA = Math.round(freshA * (1 - f / 20)), bS = Math.round(freshS * (1 - f / 20));
        const A = (Math.floor((att + bA) * prA) + 8 + sA) * (bonus + 64);
        const M = Math.floor(((Math.floor((str + bS) * prS) + 8 + sS) * (w.str + (o.amulet ? 10 : 0) + 64) + 320) / 640);
        const p = hitp(A, (o.tgt.def + 9) * (o.tgt.sdef + 64));
        E += swingsToKill(o.tgt.hp, M, p); Msum += M; psum += p; n++;
    }
    E /= n;
    return { E, M: Msum / n, p: psum / n, rate: o.tgt.hp / E /* = 4*hp per kill / 4 ticks per swing */ };
}

export function rate(att: number, str: number, style: Style, o: Opts = DEFAULT): number {
    return model0(att, str, style, o).rate * CAL;
}

/**
 * Ticks to take `skill` from base xp `from` to `to` with the given style, where the other two
 * melee stats are fixed (or follow the trained one when `follow`). Returns ticks and the HP xp earned.
 */
export function integrate(skill: 'attack' | 'strength' | 'defence', from: number, to: number, fixed: { att: number; str: number }, o: Opts = DEFAULT) {
    const style: Style = skill === 'attack' ? 'accurate' : skill === 'strength' ? 'aggressive' : 'defensive';
    let x = from, ticks = 0;
    while (x < to) {
        const L = levelOf(x);
        const att = skill === 'attack' ? L : fixed.att;
        const str = skill === 'strength' ? L : fixed.str;
        const r = rate(att, str, style, o);
        const step = Math.min(to - x, Math.max(1, lvlXp[Math.min(99, L + 1)] - x));
        ticks += step / r;
        x += step;
    }
    return { ticks: Math.round(ticks), hpXp: Math.round((to - from) / 3) };
}

if (import.meta.main) {
    const X99 = lvlXp[99];
    console.log('level table check: 40', lvlXp[40].toFixed(1), '70', lvlXp[70].toFixed(1), '99', X99.toFixed(1));
    // Calibration samples (300 ms, ogres, combat-rate.ts)
    const cal: Array<[string, number, number, Style, number]> = [
        ['Str 40->62, Att 40', 40, 51, 'aggressive', 4.14],
        ['Str 70->82', 99, 76, 'aggressive', 7.58],
        ['Str 90->95', 99, 92, 'aggressive', 8.99],
        ['Str 95->99', 99, 97, 'aggressive', 10.08],
        ['Def 85->91, Str 99', 99, 99, 'defensive', 9.34],
        ['Def 95->98, Str 99', 99, 99, 'defensive', 9.18],
    ];
    for (const [n, a, s, st, m] of cal) {
        const r = model0(a, s, st, { ...DEFAULT, prayer: 80 });
        console.log(`cal ${n}: max ${r.M.toFixed(1)} hit ${r.p.toFixed(3)} model ${r.rate.toFixed(2)} measured ${m} ratio ${(m / r.rate).toFixed(3)}`);
    }
    // Rate curve (calibrated), Attack 99
    for (const L of [40, 50, 60, 70, 80, 85, 90, 93, 95, 99]) {
        console.log(`curve L=${L}: Str(aggr, Att 99) ${rate(99, L, 'aggressive').toFixed(2)}  Def(def, Att/Str 99) ${rate(99, 99, 'defensive').toFixed(2)}  Att(acc, Str 99) ${rate(L, 99, 'accurate').toFixed(2)}  all three = L: aggr ${rate(L, L, 'aggressive').toFixed(2)}`);
    }
    // Styles at 70/70 and 99/99
    for (const L of [70, 99]) {
        const s = (['accurate', 'aggressive', 'defensive', 'controlled'] as Style[]).map(st => `${st} ${rate(L, L, st).toFixed(2)}`);
        console.log(`styles at ${L}/${L}: ${s.join(', ')} (controlled splits its xp three ways)`);
    }
    // Boost options at 99/99
    for (const [n, o] of [['full', DEFAULT], ['no pots', { ...DEFAULT, pots: false }], ['no prayer', { ...DEFAULT, prayer: 1 }], ['neither', { ...DEFAULT, pots: false, prayer: 1 }], ['no amulet', { ...DEFAULT, amulet: false }]] as Array<[string, Opts]>) {
        console.log(`boosts ${n}: Str 95 ${rate(99, 95, 'aggressive', o).toFixed(2)}  Def ${rate(99, 99, 'defensive', o).toFixed(2)}`);
    }
    const bands = [[1, 40], [40, 70], [70, 85], [85, 93], [93, 99]];
    const show = (name: string, skill: 'attack' | 'strength' | 'defence', fixed: { att: number; str: number }) => {
        const parts = bands.map(([a, b]) => `${a}-${b}: ${integrate(skill, lvlXp[a], lvlXp[b], fixed).ticks}`);
        console.log(`${name} 1->99 ${integrate(skill, 0, X99, fixed).ticks} ticks  [${parts.join(', ')}]`);
    };
    show('Attack (Str 99)', 'attack', { att: 0, str: 99 });
    show('Strength (Att 99)', 'strength', { att: 99, str: 0 });
    show('Defence (Att/Str 99)', 'defence', { att: 99, str: 99 });
    // Scenarios (rs/3 route of 22:28)
    const sc = (name: string, skill: 'attack' | 'strength' | 'defence', base: number, fixed: { att: number; str: number }) => {
        const r = integrate(skill, base, X99, fixed);
        console.log(`${name}: from ${base} base (level ${levelOf(base)}) gap ${(X99 - base).toFixed(0)} -> ${r.ticks} ticks, HP ${r.hpXp}`);
        return r;
    };
    console.log('--- with MM option 1 ---');
    const mmDef = sc('Defence', 'defence', 20000, { att: 99, str: 99 });
    console.log(`HP: gap ${(X99 - 35000).toFixed(0)}, covered by the Defence training's ${mmDef.hpXp}`);
    console.log('--- no MM ---');
    const nStr = sc('Strength (Att 99)', 'strength', 13750, { att: 99, str: 0 });
    const nDef = sc('Defence (Att/Str 99)', 'defence', 0, { att: 99, str: 99 });
    const hpStart = lvlXp[10];
    const hpLeft = X99 - hpStart - nStr.hpXp - nDef.hpXp;
    console.log(`HP: start ${hpStart.toFixed(0)} (level 10), from Str+Def ${nStr.hpXp + nDef.hpXp}, left ${hpLeft.toFixed(0)}; on melee alone (Attack style, xp wasted) ${Math.round(hpLeft / (rate(99, 99, 'accurate') / 3))} ticks`);
    console.log(`no-MM melee total ${nStr.ticks + nDef.ticks} ticks before HP`);
    console.log('--- sensitivity ---');
    sc('Strength from Waterfall + Dragon Slayer (32,400)', 'strength', 32400, { att: 99, str: 0 });
    sc('Defence from Dragon Slayer (18,650)', 'defence', 18650, { att: 99, str: 99 });
    sc('Defence from Holy Grail (15,300)', 'defence', 15300, { att: 99, str: 99 });
    sc('Strength from Waterfall + Haunted Mine (35,750)', 'strength', 35750, { att: 99, str: 0 });
}
