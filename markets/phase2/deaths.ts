/**
 * Deaths in the phase-2 runner (docs/markets/phase2.md 'Deaths'): each account's recent Hitpoints, every hit it took
 * and where the hit came from, and a record when it dies, for the ledger's `death` lines and report.ts. Pure apart
 * from reading the published state the runner already observes.
 *
 * A hit is a fall in current Hitpoints between two published states at the same maximum. Its source is read from
 * what the same window published:
 * - 'pickpocket': "You fail to pick" (pickpocket.dbrow's fixed stun_damage);
 * - 'kebab': a dodgy kebab (kebab.rs2 deals 3-4 on 2 rolls in 32);
 * - 'npc:<name>': a combat hit with an npc source. The lite client also publishes our own hits on a target as
 *   damage_taken with source index -1 (markets/methods/lab/hp-site.ts), so only events with a source index count;
 * - 'player': a combat hit from another player;
 * - 'unknown' otherwise.
 * A death's cause is the source of the most damage over the last CAUSE_TICKS ticks before it.
 */
import type { BotWorldState } from '../../sdk/types';

/** Ticks of hits and messages kept, and the window a death's cause is read over. */
export const CAUSE_TICKS = 100;
/** Hitpoints samples a death record carries. */
const TRACE_SAMPLES = 40;

export interface Hit {
    tick: number;
    damage: number;
    /** Current Hitpoints after the hit. */
    hp: number;
    source: string;
}

export interface DeathRecord {
    tick: number;
    at: { x: number; z: number; level: number };
    maxHp: number;
    /** [tick, hp] for the last published states before the death. */
    trace: [number, number][];
    /** Hits in the CAUSE_TICKS before the death, oldest first. */
    hits: Hit[];
    /** Damage over CAUSE_TICKS by source. */
    damage: Record<string, number>;
    cause: string;
    /** The death was inferred from a respawn the runner saw after it, not from the dead state itself. */
    missed: boolean;
    thieving: number;
    carriedCoins: number;
    food: number;
    /** The account's last game messages (system messages only). */
    messages: string[];
    /** Npcs within 5 tiles, by name. */
    npcsNear: Record<string, number>;
    playersNear: number;
}

const FAIL = /you fail to pick/i;
const DODGY = /tasted (very |a bit )?dodgy/i;
const FOOD = /^(kebab|shark|lobster|swordfish|tuna|salmon|trout|cake|2\/3 cake|slice of cake|bread|meat pie|half a meat pie|cooked meat|cooked chicken|shrimps)$/i;

/** Damage over the window ending at `tick`, by source, and the source with the most. */
export function causeOf(hits: readonly Hit[], tick: number): { cause: string; damage: Record<string, number> } {
    const damage: Record<string, number> = {};
    for (const h of hits) if (tick - h.tick <= CAUSE_TICKS) damage[h.source] = (damage[h.source] ?? 0) + h.damage;
    const cause = Object.entries(damage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    return { cause, damage };
}

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** One session's watch over one account. A new session starts a new watch (the client's respawn count restarts). */
export class DeathWatch {
    private samples: { tick: number; hp: number; maxHp: number }[] = [];
    private hits: Hit[] = [];
    private messages: { tick: number; text: string }[] = [];
    private combat: { tick: number; source: string }[] = [];
    private readonly seen = new Set<string>();
    private dead = false;
    private respawns: number | null = null;

    /** Read one published state; returns a record when it shows a death not yet recorded. */
    observe(s: BotWorldState): DeathRecord | null {
        const p = s.player;
        if (!p) return null;
        const t = s.tick;
        for (const m of s.gameMessages ?? []) {
            if (m.type !== 0) continue;
            const key = `m:${m.observationId ?? `${m.tick}:${m.text}`}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            this.messages.push({ tick: m.tick, text: m.text });
        }
        for (const e of s.combatEvents ?? []) {
            if (e.type !== 'damage_taken' || e.targetType !== 'player' || e.sourceIndex < 0) continue;
            const key = `c:${e.tick}:${e.sourceType}:${e.sourceIndex}:${e.damage}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            const npc = e.sourceType === 'npc' ? s.nearbyNpcs.find(n => n.index === e.sourceIndex) : undefined;
            this.combat.push({ tick: e.tick, source: e.sourceType === 'npc' ? `npc:${npc?.name ?? `#${e.sourceIndex}`}` : 'player' });
        }

        const prev = this.samples.at(-1);
        if (prev && p.hp < prev.hp && p.maxHp === prev.maxHp) {
            this.hits.push({ tick: t, damage: prev.hp - p.hp, hp: p.hp, source: this.sourceBetween(prev.tick - 1, t) });
        }
        if (prev && prev.tick === t) this.samples[this.samples.length - 1] = { tick: t, hp: p.hp, maxHp: p.maxHp };
        else this.samples.push({ tick: t, hp: p.hp, maxHp: p.maxHp });
        this.trim(t);

        const respawned = this.respawns !== null && p.respawnCount > this.respawns;
        this.respawns = p.respawnCount;
        if (p.isDead || p.hp <= 0) {
            const first = !this.dead;
            this.dead = true;
            return first ? this.record(s, false) : null;
        }
        const missed = respawned && !this.dead;
        this.dead = false;
        return missed ? this.record(s, true) : null;
    }

    private sourceBetween(from: number, to: number): string {
        const inWindow = (tick: number) => tick >= from && tick <= to;
        const texts = this.messages.filter(m => inWindow(m.tick)).map(m => m.text);
        if (texts.some(x => FAIL.test(x))) return 'pickpocket';
        if (texts.some(x => DODGY.test(x))) return 'kebab';
        return this.combat.filter(c => inWindow(c.tick)).at(-1)?.source ?? 'unknown';
    }

    private trim(t: number): void {
        const keep = <T extends { tick: number }>(xs: T[]) => xs.filter(x => t - x.tick <= CAUSE_TICKS);
        this.hits = keep(this.hits);
        this.messages = keep(this.messages);
        this.combat = keep(this.combat);
        if (this.samples.length > TRACE_SAMPLES) this.samples = this.samples.slice(-TRACE_SAMPLES);
        if (this.seen.size > 4000) this.seen.clear();
    }

    private record(s: BotWorldState, missed: boolean): DeathRecord {
        const p = s.player!;
        const me = { x: p.worldX, z: p.worldZ };
        const npcsNear: Record<string, number> = {};
        for (const n of s.nearbyNpcs) if (cheb(me, { x: n.tileX ?? n.x, z: n.tileZ ?? n.z }) <= 5) npcsNear[n.name] = (npcsNear[n.name] ?? 0) + 1;
        const { cause, damage } = causeOf(this.hits, s.tick);
        return {
            tick: s.tick,
            at: { ...me, level: p.level },
            maxHp: p.maxHp,
            trace: this.samples.map(x => [x.tick, x.hp]),
            hits: [...this.hits],
            damage,
            cause,
            missed,
            thieving: s.skills.find(k => k.name === 'Thieving')?.baseLevel ?? 1,
            carriedCoins: s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0),
            food: s.inventory.filter(i => FOOD.test(i.name)).length,
            messages: this.messages.slice(-12).map(m => `${m.tick} ${m.text}`),
            npcsNear,
            playersNear: (s.nearbyPlayers ?? []).filter(o => cheb(me, { x: o.x, z: o.z }) <= 5).length
        };
    }
}
