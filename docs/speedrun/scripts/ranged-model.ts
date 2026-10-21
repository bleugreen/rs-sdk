#!/usr/bin/env bun
/**
 * Ranged route model: integrates the measured per-tick rates (300 ms lab,
 * ranged-cannon.ts) over the xp curve and prints the tick totals that
 * docs/speedrun/skills/ranged.md quotes.
 *
 *   bun docs/speedrun/scripts/ranged-model.ts
 *
 * Rates are base xp per tick as functions of the Ranged level (piecewise
 * linear between measured points, flat outside them). Level xp comes from
 * the engine's table (server/engine/src/engine/entity/Player.ts:77-85).
 */

// ---- level table (base xp) ----
const LEVEL_XP: number[] = [0, 0]; // LEVEL_XP[L] = base xp at level L
{
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_XP[i + 2] = (Math.floor(acc / 4) * 10) / 10 / 25;
    }
}
const XP99 = LEVEL_XP[99];
const levelOf = (xp: number) => { let l = 1; while (l < 99 && LEVEL_XP[l + 1] <= xp) l++; return l; };

type Curve = [number, number][]; // [level, value]
const at = (c: Curve, l: number) => {
    if (l <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (l <= c[i][0]) { const [l0, v0] = c[i - 1], [l1, v1] = c[i]; return v0 + ((v1 - v0) * (l - l0)) / (l1 - l0); }
    return c[c.length - 1][1];
};

// ---- measured rates (base xp per tick, 300 ms unless noted) ----
const M = {
    // cannon alone, rune scimitar wielded (melee accuracy), poison spiders; independent of Ranged level
    cannonScim: 11.52,
    // cannon + rapid rune knives at the spiders: total Ranged and HP
    cannonKnivesR: [[70, 17.34], [85, 18.69], [99, 22.72]] as Curve,
    cannonKnivesH: [[70, 2.12], [85, 2.42], [99, 3.28]] as Curve,
    // rapid knives alone on moss giants (best knife per level). 10, 30, 50, 70, 99 at 300 ms;
    // 1 (accurate iron knife), 20 and 40 from the 100 ms sweep.
    knivesR: [[1, 0.14], [10, 0.41], [20, 1.25], [30, 2.17], [40, 4.0], [50, 5.37], [70, 8.13], [99, 8.75]] as Curve,
    knivesH: [[1, 0.05], [10, 0.13], [20, 0.41], [30, 0.71], [40, 1.33], [50, 1.77], [70, 2.68], [99, 2.89]] as Curve,
    // longrange knives alone, Ranged/Defence 70 (2 + 2 per damage)
    longD: 2.63, longR: 2.63, longH: 1.74,
    // cannon + longrange rune knives at the spiders, Ranged/Defence 70
    cannonLongR: 12.07, cannonLongD: 2.19, cannonLongH: 1.45,
    // cannon + defensive melee (rune scimitar, Defence 70) at the spiders
    cannonMeleeR: 11.03, cannonMeleeD: 5.6, cannonMeleeH: 1.85,
    // melee alone, defensive, at the spiders: 6.64 + 2.18 (measured). Separate-melee plans use
    // rs/30's best single-combat target, the Yanille ogres at 300 ms (combat-rate.ts): 9.2-9.3
    // Defence on defensive at Defence 85-98, 8.99-10.08 Strength on aggressive; HP = 1/3
    meleeD: 9.25, meleeH: 3.08,
};

/** Ticks to raise Ranged from xp a to b at rate(level). */
const integrate = (a: number, b: number, rate: (l: number) => number, extra?: (l: number) => number) => {
    let t = 0, x = a, byproduct = 0;
    while (x < b) {
        const l = levelOf(x);
        const next = Math.min(b, l < 99 ? LEVEL_XP[l + 1] : b);
        const r = rate(l);
        const dt = (next - x) / r;
        t += dt; byproduct += (extra?.(l) ?? 0) * dt; x = next;
    }
    return { ticks: t, byproduct };
};

type Plan = { name: string; ticks: number; note: string };
/**
 * Plans from Ranged xp R0 with melee gaps D (Defence) and S (Strength) and a Hitpoints gap H.
 * Strength is only ever trained by melee (aggressive is assumed to run at the defensive rate,
 * at the spiders and at the ogres alike). Separate melee is rs/30's best single-combat target.
 */
const plans = (R0: number, D: number, H: number, S = 0): Plan[] => {
    const out: Plan[] = [];
    const R = XP99 - R0;
    const hRest = (h: number) => Math.max(0, H - h) / M.meleeH;
    const knifePhase = (r1: number) => integrate(r1, XP99, l => (l >= 70 ? at(M.cannonKnivesR, l) : M.cannonScim), l => (l >= 70 ? at(M.cannonKnivesH, l) : 0));
    // (a) cannon alone for Ranged, then melee for Def/Str, then melee for the HP left
    {
        const tR = R / M.cannonScim, tM = (D + S) / M.meleeD, h = tM * M.meleeH;
        out.push({ name: '(a) cannon alone, then melee for Def/Str/HP', ticks: tR + tM + hRest(h), note: `cannon ${tR.toFixed(0)} + melee ${tM.toFixed(0)} + HP-only ${hRest(h).toFixed(0)}` });
    }
    // (b) hand only: longrange until Defence closes, then rapid knives to 99; Strength by melee
    {
        const tL = D / M.longD;
        const r1 = Math.min(XP99, R0 + tL * M.longR);
        const k = integrate(r1, XP99, l => at(M.knivesR, l), l => at(M.knivesH, l));
        const tS = S / M.meleeD;
        const h = tL * M.longH + k.byproduct + tS * M.meleeH;
        out.push({ name: '(b) hand only: longrange, then rapid knives (+ melee for Str)', ticks: tL + k.ticks + tS + hRest(h), note: `longrange ${tL.toFixed(0)} + rapid ${k.ticks.toFixed(0)}${S ? ` + Str melee ${tS.toFixed(0)}` : ''}; HP ${h.toFixed(0)}` });
    }
    // (c) cannon + longrange until Defence closes, then cannon + rapid knives; Strength by melee
    {
        const tL = D / M.cannonLongD;
        const r1 = Math.min(XP99, R0 + tL * M.cannonLongR);
        const k = knifePhase(r1);
        const tS = S / M.meleeD;
        const h = tL * M.cannonLongH + k.byproduct + tS * M.meleeH;
        out.push({ name: '(c) cannon + longrange, then cannon + rapid knives', ticks: tL + k.ticks + tS + hRest(h), note: `cannon+longrange ${tL.toFixed(0)} (Ranged to ${levelOf(r1)}) + cannon+rapid ${k.ticks.toFixed(0)}${S ? ` + Str melee ${tS.toFixed(0)}` : ''}; HP ${h.toFixed(0)}` });
    }
    // (d) cannon + melee at the spiders for everything
    {
        const tR = R / M.cannonMeleeR, tM = (D + S) / M.cannonMeleeD, tH = H / M.cannonMeleeH;
        out.push({ name: '(d) cannon + melee at the spiders throughout', ticks: Math.max(tR, tM, tH), note: `Ranged ${tR.toFixed(0)}, melee ${tM.toFixed(0)}, HP ${tH.toFixed(0)}` });
    }
    // (e)/(f) cannon + melee at the spiders until the first of {melee gap, Ranged 99} closes; then
    // (e) cannon + rapid knives for the Ranged left, or (f) melee alone at the ogres for the melee left
    {
        const tR = R / M.cannonMeleeR, tM = (D + S) / M.cannonMeleeD;
        const t1 = Math.min(tR, tM);
        let h = t1 * M.cannonMeleeH, t2 = 0, note = '';
        if (tM <= tR) {
            const r1 = R0 + t1 * M.cannonMeleeR, k = knifePhase(r1);
            t2 = k.ticks; h += k.byproduct;
            note = `cannon+melee ${t1.toFixed(0)} (Ranged to ${levelOf(r1)}) + cannon+rapid ${t2.toFixed(0)}`;
        } else {
            const mLeft = (D + S) - t1 * M.cannonMeleeD;
            t2 = mLeft / M.meleeD; h += t2 * M.meleeH;
            note = `cannon+melee ${t1.toFixed(0)} (Ranged 99, melee ${(t1 * M.cannonMeleeD).toFixed(0)} done) + melee alone ${t2.toFixed(0)}`;
        }
        out.push({ name: tM <= tR ? '(e) cannon + melee until the melee gap closes, then cannon + rapid knives' : '(f) cannon + melee until Ranged 99, then melee alone', ticks: t1 + t2 + hRest(h), note: `${note}; HP ${h.toFixed(0)}` });
    }
    // (g) no parallel: melee alone for Def/Str, cannon + rapid knives for Ranged
    {
        const tM = (D + S) / M.meleeD, k = knifePhase(R0);
        const h = tM * M.meleeH + k.byproduct;
        out.push({ name: '(g) melee alone for Def/Str, then cannon + knives for Ranged', ticks: tM + k.ticks + hRest(h), note: `melee ${tM.toFixed(0)} + cannon+knives ${k.ticks.toFixed(0)}; HP ${h.toFixed(0)}` });
    }
    return out.sort((x, y) => x.ticks - y.ticks);
};

const show = (title: string, ps: Plan[]) => {
    console.log(`\n${title}`);
    for (const p of ps) console.log(`  ${p.ticks.toFixed(0).padStart(6)}  ${p.name}  [${p.note}]`);
};

// ---- Ranged alone ----
const cannonTo = (a: number, b: number) => (b - a) / M.cannonScim;
const knifeTo = (a: number, b: number) => integrate(a, b, l => at(M.knivesR, l)).ticks;
const best1to99 = cannonTo(0, LEVEL_XP[70]) + integrate(LEVEL_XP[70], XP99, l => at(M.cannonKnivesR, l)).ticks;
console.log(`level xp: 50 ${LEVEL_XP[50].toFixed(1)}, 70 ${LEVEL_XP[70].toFixed(1)}, 99 ${XP99.toFixed(1)}`);
console.log(`Ranged 1->50: cannon (melee weapon) ${cannonTo(0, LEVEL_XP[50]).toFixed(0)} ticks; knives only ${knifeTo(0, LEVEL_XP[50]).toFixed(0)} ticks`);
console.log(`Ranged 1->99: cannon to 70 then cannon + rapid knives ${best1to99.toFixed(0)} ticks; cannon alone ${cannonTo(0, XP99).toFixed(0)}; knives only ${knifeTo(0, XP99).toFixed(0)}`);
const knivesHP = integrate(0, XP99, l => at(M.knivesR, l), l => at(M.knivesH, l)).byproduct;
console.log(`  knives-only HP by-product 1->99: ${knivesHP.toFixed(0)} base`);

// ---- with-MM scenarios (rs/3). Ranged 50 before MM plus ~485 from the Jungle Demon fight
// (monkey_madness.md: 430-540). Attack and Strength capped unless stated. ----
const R0 = LEVEL_XP[50] + 485;
show(`with MM option 1, Holy Grail off (Ranged from ${R0.toFixed(0)} = level ${levelOf(R0)}, Def gap 19,938, HP gap 4,938)`, plans(R0, 19938, 4938));
show('same, Waterfall off too (Strength gap 4,938 as well)', plans(R0, 19938, 4938, 4938));
show('Package B: MM option 1 + Dragon Slayer (Def gap 1,288, HP gap 4,938, Str 0)', plans(R0, 1288, 4938));
show('with MM option 1 and Holy Grail (Def gap 4,638, HP gap 4,938)', plans(R0, 4638, 4938));
show('with MM + Holy Grail + Fremennik Trials (Def gap 1,826, HP gap 2,126)', plans(R0, 1826, 2126));
show('Ranged only, from the with-MM start (no Def/HP gap)', plans(R0, 0, 0));

// ---- ordering: Ranged 70 (cannon) before MM instead of 50; the Jungle Demon fight drops from
// 267 to 178 ticks (monkey_madness.md, quest-mm-demon.ts) ----
{
    const pre50 = cannonTo(0, LEVEL_XP[50]), pre70 = cannonTo(0, LEVEL_XP[70]);
    const e50 = Math.min(...plans(LEVEL_XP[50] + 485, 19938, 4938).filter(p => /^\((e|f)\)/.test(p.name)).map(p => p.ticks));
    const e70 = Math.min(...plans(LEVEL_XP[70] + 485, 19938, 4938).filter(p => /^\((e|f)\)/.test(p.name)).map(p => p.ticks));
    console.log(`
pre-MM Ranged 50: ${pre50.toFixed(0)} pre + demon 267 + post-MM best ${e50.toFixed(0)} = ${(pre50 + 267 + e50).toFixed(0)}`);
    console.log(`pre-MM Ranged 70: ${pre70.toFixed(0)} pre + demon 178 + post-MM best ${e70.toFixed(0)} = ${(pre70 + 178 + e70).toFixed(0)}`);
        console.log(`no cannon at all: knives 1->50 ${knifeTo(0, LEVEL_XP[50]).toFixed(0)} + demon 267 + (b) ${plans(LEVEL_XP[50] + 485, 19938, 4938).find(p => p.name.startsWith('(b)'))!.ticks.toFixed(0)}`);
}
