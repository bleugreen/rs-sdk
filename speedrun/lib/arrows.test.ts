import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ARROW_TIERS, ARROWS_PER_ACTION, arrowTier, HEADLESS_ARROW } from './arrows';

const ROOT = join(import.meta.dir, '../..');

function objPack(): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
        const r = line.match(/^(\d+)=(\S+)$/);
        if (r) m.set(r[2]!, Number(r[1]));
    }
    return m;
}

/** arrows.dbrow: each row's data fields by name. */
function dbrows(): Map<string, Record<string, string>> {
    const rows = new Map<string, Record<string, string>>();
    let cur: Record<string, string> | null = null;
    for (const line of readFileSync(join(ROOT, 'server/content/scripts/skill_fletching/configs/arrows/arrows.dbrow'), 'utf8').split('\n')) {
        const h = line.match(/^\[(\w+)\]$/);
        if (h) rows.set(h[1]!, (cur = {}));
        const d = line.match(/^data=(\w+),(.*)$/);
        if (d && cur) cur[d[1]!] = d[2]!.trim();
    }
    return rows;
}

describe('ARROW_TIERS', () => {
    test('every tier matches arrows.dbrow (tips, product and count, level, xp in tenths) and obj.pack', () => {
        const pack = objPack();
        const rows = dbrows();
        expect(rows.size).toBe(ARROW_TIERS.length);
        for (const t of ARROW_TIERS) {
            const row = rows.get(`fletching_${t.tier}_arrow`)!;
            expect({ tier: t.tier, item: row.item, product: row.product, metal: row.metal, level: Number(row.level), xp: Number(row.experience) / 10 }).toEqual({
                tier: t.tier,
                item: `${t.tier}_arrowheads`,
                product: `${t.tier}_arrow,${ARROWS_PER_ACTION}`,
                metal: t.tier,
                level: t.level,
                xp: t.xpPerArrow
            });
            expect({ tier: t.tier, tips: t.tips, arrow: t.arrow }).toEqual({ tier: t.tier, tips: pack.get(`${t.tier}_arrowheads`)!, arrow: pack.get(`${t.tier}_arrow`)! });
        }
        expect(HEADLESS_ARROW).toBe(pack.get('headless_arrow')!);
    });

    test('best first: levels strictly descending, xp with them', () => {
        for (let i = 1; i < ARROW_TIERS.length; i++) {
            expect(ARROW_TIERS[i]!.level).toBeLessThan(ARROW_TIERS[i - 1]!.level);
            expect(ARROW_TIERS[i]!.xpPerArrow).toBeLessThan(ARROW_TIERS[i - 1]!.xpPerArrow);
        }
        expect(arrowTier('adamant').arrow).toBe(890);
        expect(() => arrowTier('dragon' as never)).toThrow(/unknown arrow tier 'dragon'/);
    });
});
