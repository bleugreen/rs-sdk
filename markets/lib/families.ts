/**
 * The account families at the top of the wealth board, and a census of where their members appear: on which
 * boards, online or not, and on which bank tiles. Membership is by name only, so a census is evidence of a
 * naming pattern, not proof of one operator.
 */
import { playerNameKey, zoneOf, type Position } from './positions.ts';

/** Patterns over playerNameKey (lower case, `_` as a space). goo wants a digit so goondelf-style names stay out. */
export const FAMILIES: Record<string, RegExp> = {
    nick: /^nick/,
    banker: /^banker/,
    soko: /^soko/,
    kuro: /^kuro/,
    goo: /^goo\d/,
    stein: /^stein/
};

export function familyOf(name: string, families: Record<string, RegExp> = FAMILIES): string | null {
    const key = playerNameKey(name);
    for (const [family, re] of Object.entries(families)) if (re.test(key)) return family;
    return null;
}

export interface FamilyCensus {
    family: string;
    /** Every member seen on any source or online, by name key, sorted. */
    accounts: string[];
    online: string[];
    /** Members per source (a board, a bank search), by name key. */
    sources: Record<string, string[]>;
    /** Online members per bank zone; `elsewhere` for anyone outside every zone. */
    zones: Record<string, number>;
}

/** `sources` are named row lists (board pages, bank searches); `positions` one /playerpositions read. */
export function census(sources: Record<string, { name: string }[]>, positions: Position[], families: Record<string, RegExp> = FAMILIES): FamilyCensus[] {
    const out = new Map<string, FamilyCensus & { seen: Set<string> }>();
    for (const family of Object.keys(families)) out.set(family, { family, accounts: [], online: [], sources: {}, zones: {}, seen: new Set() });
    for (const [source, rows] of Object.entries(sources)) {
        for (const row of rows) {
            const family = familyOf(row.name, families);
            if (!family) continue;
            const c = out.get(family)!;
            const key = playerNameKey(row.name);
            const list = (c.sources[source] ??= []);
            if (!list.includes(key)) list.push(key);
            c.seen.add(key);
        }
    }
    for (const p of positions) {
        const family = familyOf(p.name, families);
        if (!family) continue;
        const c = out.get(family)!;
        const key = playerNameKey(p.name);
        c.online.push(key);
        c.seen.add(key);
        const zone = zoneOf(p) ?? 'elsewhere';
        c.zones[zone] = (c.zones[zone] ?? 0) + 1;
    }
    return [...out.values()].map(({ seen, ...c }) => ({ ...c, accounts: [...seen].sort(), online: c.online.sort() }));
}
