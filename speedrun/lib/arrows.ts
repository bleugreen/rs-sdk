// Arrows: arrowheads on headless arrows, up to 15 an action (arrows.rs2 @make_arrows, rows in
// arrows.dbrow). The one tier table on the speedrun side: the stun pack's start check
// (skills/thieving.ts) and the standalone Fletching fallback (skills/fletching.ts) both read it.
// The page's stun-actions.ts ARROW_TIERS repeats the names and levels (the webclient cannot
// import speedrun/); thieving.test.ts checks the two agree, arrows.test.ts checks this one
// against the content.

export type ArrowTier = 'rune' | 'adamant' | 'mithril' | 'steel' | 'iron' | 'bronze';

export interface ArrowTierRow {
    tier: ArrowTier;
    /** Fletching level the content checks against `stat(fletching)` (arrows.dbrow `level`). */
    level: number;
    /** Base xp per arrow (arrows.dbrow `experience` is in tenths). */
    xpPerArrow: number;
    /** `<tier>_arrowheads`: the game shows them as '<Tier> arrowtips'. */
    tips: number;
    /** `<tier>_arrow`, the product. */
    arrow: number;
}

/** `headless_arrow`, the other input of every tier. */
export const HEADLESS_ARROW = 53;

/** `make_arrows` takes min(tips, headless, 15) an action (arrows.dbrow `product,<arrow>,15`). */
export const ARROWS_PER_ACTION = 15;

/** Best first, as the stun pack and item-cycle's stack mode pick them. */
export const ARROW_TIERS: readonly ArrowTierRow[] = [
    { tier: 'rune', level: 75, xpPerArrow: 12.5, tips: 44, arrow: 892 },
    { tier: 'adamant', level: 60, xpPerArrow: 10, tips: 43, arrow: 890 },
    { tier: 'mithril', level: 45, xpPerArrow: 7.5, tips: 42, arrow: 888 },
    { tier: 'steel', level: 30, xpPerArrow: 5, tips: 41, arrow: 886 },
    { tier: 'iron', level: 15, xpPerArrow: 2.5, tips: 40, arrow: 884 },
    { tier: 'bronze', level: 1, xpPerArrow: 1.3, tips: 39, arrow: 882 }
];

export function arrowTier(tier: ArrowTier): ArrowTierRow {
    const row = ARROW_TIERS.find(r => r.tier === tier);
    if (!row) throw new Error(`unknown arrow tier '${tier}' (have: ${ARROW_TIERS.map(r => r.tier).join(', ')})`);
    return row;
}
