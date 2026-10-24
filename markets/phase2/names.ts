/**
 * Keeping markets' account names out of the phase-2 runner's output (markets/lib/accounts.ts: the names never appear
 * in anything committed or shared). Pure.
 *
 * - Every output line names an account by its alias, `a01` for the plan's first account and so on, so the plan file
 *   (kept outside the checkout with the names list) is the only map back to a name.
 * - Every string value of every record is scrubbed of the plan's names before it is written, so a name a role or a
 *   server message carries in its text leaves as the alias too. Keys are left alone: the scrub cannot rewrite a
 *   record's shape.
 * - A run on real accounts must list every plan account in the names file, so the public readers that exclude our
 *   accounts (lib/accounts.ts writerExclusion) exclude these too. Placeholder data (a lab run) skips that check.
 */
import type { Exclusion } from '../lib/accounts.ts';

export const aliasOf = (index: number): string => `a${String(index + 1).padStart(2, '0')}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces each name (any case, `_` or a space between its words) with its alias inside a string. */
export function nameScrubber(accounts: readonly string[]): (text: string) => string {
    const rules = accounts
        .map((a, i) => ({ words: a.trim().split(/[_ ]+/).filter(Boolean), alias: aliasOf(i) }))
        .filter(r => r.words.length > 0)
        // longest first, so a name that contains another is replaced whole
        .sort((a, b) => b.words.join(' ').length - a.words.join(' ').length)
        .map(r => ({ re: new RegExp(r.words.map(escape).join('[_ ]+'), 'gi'), alias: r.alias }));
    return text => rules.reduce((t, r) => t.replace(r.re, r.alias), text);
}

/** A copy of `value` with every string inside it scrubbed. */
export function scrubRecord<T>(value: T, scrub: (text: string) => string): T {
    if (typeof value === 'string') return scrub(value) as T;
    if (Array.isArray(value)) return value.map(v => scrubRecord(v, scrub)) as T;
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = scrubRecord(v, scrub);
        return out as T;
    }
    return value;
}

/** Problems with running these accounts under `exclusion`: every one must be on the names list (none with placeholder data). */
export function unlistedAccounts(accounts: readonly string[], exclusion: Pick<Exclusion, 'excludes' | 'source'>): string[] {
    if (exclusion.source === null) return [];
    return accounts.flatMap((a, i) => (exclusion.excludes(a) ? [] : [`${aliasOf(i)} (accounts[${i}]) is not on the names list ${exclusion.source}: add it there before it runs`]));
}
