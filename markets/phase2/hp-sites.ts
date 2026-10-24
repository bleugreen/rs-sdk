/**
 * Where each fresh account trains Hitpoints (docs/markets/hp-training.md 'Sites'). One site cannot feed many bots: a
 * site gives back only its spawns' hitpoints a tick (hp-train.ts `Site.supply`, 0.43-0.98 for the low sites) and a
 * bot at full pace on the cows uses ~0.6. The rs/544 lab put 20 accounts on the Lumbridge pen's 0.89 and most were
 * still under HP 30 after 5,300 ticks. So the runner spreads its accounts over every low site, the next one always
 * to the site with the most supply per bot, and caps each site; an account that finds every site full waits on the
 * coins earner (run.ts) until one has room.
 *
 * Pure: the runner holds one instance for the whole process.
 */
import { LOW_SITES, SITES, type SiteId } from '../methods/hp-train.ts';

/** The least supply (hitpoints a tick) a site's cap leaves each of its bots by default: about 40% of full pace. */
export const SUPPLY_PER_BOT = 0.25;

export type HpSiteCaps = Partial<Record<SiteId, number>>;

/** Each low site's cap: its supply over `perBot`, rounded, at least 1. */
export function defaultCaps(perBot = SUPPLY_PER_BOT): HpSiteCaps {
    return Object.fromEntries(LOW_SITES.map(id => [id, Math.max(1, Math.round(SITES[id].supply / perBot))]));
}

export class HpSites {
    private readonly at = new Map<string, SiteId>();

    constructor(readonly caps: HpSiteCaps) {}

    private count(id: SiteId): number {
        let n = 0;
        for (const s of this.at.values()) if (s === id) n++;
        return n;
    }

    private open(): SiteId[] {
        return LOW_SITES.filter(id => this.count(id) < (this.caps[id] ?? 0));
    }

    /**
     * The site for `account`: the one it already holds, else the open site whose supply per bot stays highest with it
     * added (ties to the site nearer Lumbridge). Null when every site is at its cap.
     */
    take(account: string): SiteId | null {
        const held = this.at.get(account);
        if (held) return held;
        let best: SiteId | null = null;
        let share = -1;
        for (const id of this.open()) {
            const s = SITES[id].supply / (this.count(id) + 1);
            if (s > share) {
                share = s;
                best = id;
            }
        }
        if (best) this.at.set(account, best);
        return best;
    }

    release(account: string): void {
        this.at.delete(account);
    }

    hasRoom(): boolean {
        return this.open().length > 0;
    }

    /** Accounts on each site with a cap. */
    occupancy(): Record<string, number> {
        return Object.fromEntries(LOW_SITES.filter(id => (this.caps[id] ?? 0) > 0).map(id => [id, this.count(id)]));
    }

    capacity(): number {
        return LOW_SITES.reduce((n, id) => n + (this.caps[id] ?? 0), 0);
    }
}
