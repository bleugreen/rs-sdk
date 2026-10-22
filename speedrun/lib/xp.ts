// The engine's level curve, in the units the published state carries.
//
// The engine keeps stats in tenths and levels them by `levelExperience`
// (server/engine/src/engine/entity/Player.ts); UPDATE_STAT sends stats / 10, so a
// state's `skills[].experience` is game xp. Content scripts award base xp, and the
// server multiplies every award by NODE_XPRATE, 25 on the demo and the lab, so
// game xp = base x 25 (docs/speedrun/skills/README.md, "Units"). The curve uses
// 2^(level/10), not RuneScape's 2^(level/7): level 99 is 39,938.32 base.

/** Game xp per base xp point (server WorldConfig xpRate). */
export const XP_RATE = 25;

/** LEVEL_XP[level] is the game xp at which `level` starts, for levels 1 to 99. */
const LEVEL_XP: readonly number[] = (() => {
    const table = [0, 0];
    let acc = 0;
    for (let level = 1; level < 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        table[level + 1] = Math.floor(acc / 4);
    }
    return table;
})();

/** The game xp at which `level` (1 to 99) starts. */
export function xpForLevel(level: number): number {
    if (!Number.isInteger(level) || level < 1 || level > 99) throw new Error(`level must be an integer from 1 to 99, got ${level}`);
    return LEVEL_XP[level]!;
}

/** The base level `xp` game xp gives (the engine's getLevelByExp). */
export function levelForXp(xp: number): number {
    let level = 1;
    while (level < 99 && LEVEL_XP[level + 1]! <= xp) level++;
    return level;
}

/** Game xp for an amount of base xp, as the docs and quest rewards quote it. */
export function baseToXp(base: number): number {
    return Math.round(base * XP_RATE);
}
