// The wealth board's value for a bank, computed the way LoginServer.ts updateHiscores does:
// sum of ObjType.cost * count over the bank. Lab accounts above staff level 1 have no board row
// (hiscoreEligible), so lab scripts compute it themselves from the content configs.

import { readFileSync } from 'node:fs';

import type { BotWorldState } from '../../sdk/types';

/** ObjType.cost by obj id; a cert costs what its linked item costs (ObjType.toCertificate). */
export function loadCosts(): Map<number, number> {
    const idOf = new Map<string, number>();
    for (const line of readFileSync('server/content/pack/obj.pack', 'utf8').split('\n')) {
        const m = /^(\d+)=(\w+)/.exec(line);
        if (m) idOf.set(m[2]!, Number(m[1]));
    }
    // Older unpacked revisions first, the current one next, hand-written configs last, so later wins.
    const rank = (f: string) => {
        const m = /^_unpack\/(\d+)\//.exec(f);
        return m ? Number(m[1]) : 10_000;
    };
    const files = [...new Bun.Glob('**/*.obj').scanSync('server/content/scripts')].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const costOf = new Map<string, number>();
    for (const f of files) {
        let cur: string | null = null;
        for (const raw of readFileSync(`server/content/scripts/${f}`, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[(\w+)\]$/.exec(line);
            if (head) { cur = head[1]!; continue; }
            const c = /^cost=(\d+)$/.exec(line);
            if (cur && c) costOf.set(cur, Number(c[1]));
        }
    }
    const byId = new Map<number, number>();
    for (const [name, id] of idOf) {
        const base = name.startsWith('cert_') ? name.slice(5) : name;
        byId.set(id, costOf.get(name) ?? costOf.get(base) ?? 1);
    }
    return byId;
}

export type Snap = { bank: Record<string, number>; inv: Record<string, number>; ground: Record<string, number>; boardValue: number };

/** Bank, inventory and nearby-ground counts by name, and the board value of the bank. */
export function snap(costs: Map<number, number>, s: BotWorldState | null): Snap {
    const add = (o: Record<string, number>, k: string, n: number) => { o[k] = (o[k] ?? 0) + n; };
    const bank: Record<string, number> = {}, inv: Record<string, number> = {}, ground: Record<string, number> = {};
    let boardValue = 0;
    for (const i of s?.bank.items ?? []) { add(bank, i.name, i.count); boardValue += (costs.get(i.id) ?? 1) * i.count; }
    for (const i of s?.inventory ?? []) add(inv, i.name, i.count);
    for (const g of s?.groundItems ?? []) if (g.distance <= 3) add(ground, g.name, g.count);
    return { bank, inv, ground, boardValue };
}

export const total = (x: Snap, name: string) => (x.bank[name] ?? 0) + (x.inv[name] ?? 0) + (x.ground[name] ?? 0);
