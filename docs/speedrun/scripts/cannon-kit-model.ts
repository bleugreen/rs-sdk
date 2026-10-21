#!/usr/bin/env bun
/**
 * Package B combat-finish model with the rs/91 lab rates (cannon-kit.ts, 300 ms, 400-tick
 * windows). Same structure as rs/31's ranged-model.ts plan (e): cannon + defensive melee
 * at the poison spiders until the Defence gap closes, then the cannon with a scimitar
 * until Ranged 70, then cannon + rapid rune knives to 99; Hitpoints is a by-product and any
 * remainder is meleed at rs/30's ogres.
 *
 *   bun docs/speedrun/scripts/cannon-kit-model.ts
 *
 * Knife-phase curves are base Ranged (and Hitpoints) per tick at the time-averaged Ranged
 * level of each measured window (a window from 70 ends near 82, so it is placed at 76;
 * from 85 near 90.5, at 87.5; 99 is held). Piecewise linear, flat outside the points.
 */

const LEVEL_XP: number[] = [0, 0];
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
type Curve = [number, number][];
const at = (c: Curve, l: number) => {
    if (l <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (l <= c[i][0]) { const [l0, v0] = c[i - 1], [l1, v1] = c[i]; return v0 + ((v1 - v0) * (l - l0)) / (l1 - l0); }
    return c[c.length - 1][1];
};
const integrate = (a: number, b: number, rate: (l: number) => number, extra: (l: number) => number) => {
    let t = 0, x = a, by = 0;
    while (x < b) {
        const l = levelOf(x), next = Math.min(b, l < 99 ? LEVEL_XP[l + 1] : b), r = rate(l), dt = (next - x) / r;
        t += dt; by += extra(l) * dt; x = next;
    }
    return { t, by };
};

type Rates = {
    name: string;
    melee: { R: number; D: number; H: number }; // cannon + defensive melee at the spiders
    scim: number;                                // cannon alone with a scimitar wielded (below 70)
    knivesR: Curve; knivesH: Curve;              // cannon + rapid rune knives
};
// rs/31 (ranged.md section 1): bare rune scimitar or knives, Prayer 99, ::setstat survival.
const RS31: Rates = {
    name: 'rs/31 measured (bare kit)',
    melee: { R: 11.03, D: 5.6, H: 1.85 }, scim: 11.52,
    knivesR: [[70, 17.34], [85, 18.69], [99, 22.72]], knivesH: [[70, 2.12], [85, 2.42], [99, 3.28]],
};
// rs/91 config 1 (control: Prayer 43, Protect from Melee held, prayer potions and sharks
// eaten in the window). Means of 1 run at 70, 3 at 85, 2 at 99. Melee phase and scimitar
// cannon are rs/31's (config 1 is knives only).
const CONTROL: Rates = {
    name: 'rs/91 control (config 1)',
    melee: RS31.melee, scim: RS31.scim,
    knivesR: [[76, 17.40], [87.5, 18.56], [99, 19.88]], knivesH: [[76, 2.03], [87.5, 2.38], [99, 2.59]],
};
// rs/91 kit. Melee phase and scimitar cannon: config 5 (super attack + super strength,
// glory, Protect from Melee + Ultimate Strength + Incredible Reflexes flicked, super
// antipoison), 1 run each. Knives: config 4 (Protect from Melee flicked, ranging potion,
// glory, super antipoison, no food): 1 run at 70, 3 at 85; at 99 the hand-thrown share is
// the mean of 3 runs (10.46) and the cannon share the mean of the 5 runs whose cannon
// never ran dry (12.44), because two runs at 99 lost their top-ups (see helper-fed-and-combat.md).
const KIT: Rates = {
    name: 'rs/91 full kit (configs 4 and 5)',
    melee: { R: 13.655, D: 7.65, H: 2.534 }, scim: 13.64,
    knivesR: [[76, 19.46], [87.5, 21.95], [99, 22.90]], knivesH: [[76, 2.57], [87.5, 3.19], [99, 3.48]],
};
const KNIVES_ONLY_KIT: Rates = { ...KIT, name: 'kit in the knives phase only (bare melee phase)', melee: RS31.melee, scim: RS31.scim };

const MELEE_H = 3.08; // rs/30's ogres, Hitpoints per tick while finishing HP by melee
const R0 = LEVEL_XP[50] + 485; // Ranged 50 before MM + the Jungle Demon fight
const D_GAP = 1288, H_GAP = 4938; // Package B after MM + Dragon Slayer

const planE = (r: Rates, switchLevel = 70) => {
    const t1 = D_GAP / r.melee.D;
    const r1 = R0 + t1 * r.melee.R;
    let h = t1 * r.melee.H;
    const k = integrate(r1, XP99, l => (l >= switchLevel ? at(r.knivesR, l) : r.scim), l => (l >= switchLevel ? at(r.knivesH, l) : 0));
    h += k.by;
    const hRest = Math.max(0, H_GAP - h) / MELEE_H;
    return { total: t1 + k.t + hRest, melee: t1, knives: k.t, rangedAfterMelee: levelOf(r1), hp: h, hRest };
};
// Scimitar for the whole finish: cannon + defensive melee throughout (Defence is capped after
// the gap closes, so its xp is wasted; Hitpoints still accrues).
const scimitarOnly = (r: Rates) => {
    const t = (XP99 - R0) / r.melee.R;
    return { total: Math.max(t, H_GAP / r.melee.H, D_GAP / r.melee.D), t };
};

console.log(`Ranged start ${R0.toFixed(0)} base (level ${levelOf(R0)}); 70 = ${LEVEL_XP[70].toFixed(0)}, 85 = ${LEVEL_XP[85].toFixed(0)}, 99 = ${XP99.toFixed(0)}`);
for (const r of [RS31, CONTROL, KNIVES_ONLY_KIT, KIT]) {
    const p = planE(r);
    console.log(`${r.name.padEnd(48)} plan (e) ${p.total.toFixed(0).padStart(5)} ticks: melee ${p.melee.toFixed(0)} (Ranged to ${p.rangedAfterMelee}), cannon/knives ${p.knives.toFixed(0)}, HP by-product ${p.hp.toFixed(0)}, HP-only ${p.hRest.toFixed(0)}`);
}
for (const r of [RS31, KIT]) {
    const s = scimitarOnly(r);
    console.log(`${r.name.padEnd(48)} scimitar whole finish ${s.total.toFixed(0).padStart(5)} ticks`);
}
