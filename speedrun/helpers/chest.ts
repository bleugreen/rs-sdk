// chest (role): blood runes from the two trapped chests in the Chaos Druid Tower
// basement, North Ardougne.
//
//   bun speedrun/helpers/chest.ts <account>        (ROLE_OPTIONS='{"bankAt":40}')
//
// The content (skill_thieving/configs/chests/trapped_chest.dbrow, row
// trapped_chest_chest_blood_runes; scripts/thieving.rs2 disarm_trapped_chest):
// "Search for traps" (op2) at Thieving 59 gives 2 blood runes and 500 coins,
// turns the chest into the looted loc 2572 for respawn_ticks scaled by the
// world's player count (~scale_by_playercount: 400 * (4000 - players) / 4000),
// and then fires a "second magical trap" that teleports the player to
// (2584, 3337) in East Ardougne. "Open" (op1) only springs the trap for damage,
// so it is never clicked. The chests are world-global: whoever searches first
// takes them.
//
// Where (maps/m40_152.jm2, loc 2569 chest_blood_runes): two chests, at
// (2586, 9734) and (2586, 9737). The only way in is the tower's locked door at
// (2565, 3356) (locked_door.dbrow loc_2554: Pick Lock at Thieving 46, about 29%
// a try at 99, no delay after a failure) and the cellar ladder at (2562, 3356).
// So every loot is a round trip: teleported out, walk ~25 tiles back to the
// door, pick it, climb down, ~30 tiles through the cave.
//
// Who: the cave holds seven ogres (level 53, three within two tiles of the
// chests) and five bats (27), all on the `cowardly` hunt, which Npc.ts skips for
// a player whose combat level is above twice the NPC's. A combat-107+ account is
// never attacked there; anything lower would be hunted by the ogres, and a
// 10-Hitpoint coin earner killed. The role refuses to run below `minCombat`.
//
// Rate ceiling: one account keeps both chests cycling (the walk back is a small
// part of the respawn), so two chests give 4 blood runes per respawn period;
// a second account adds nothing unless other players take chests first.
// docs/speedrun/helpers/chest.md has the measured rate.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { act } from '../lib/act';
import { ensureRunOn } from '../lib/run-mode';
import { travelTo } from '../lib/toll-gate';
import { waitTicks } from '../lib/wait';
import { chebyshev, invCount, opIndex, pos, skillLevel } from '../lib/world';
import { closeBank, openBank } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Pt {
    x: number;
    z: number;
}

export const CHEST_LOC = 2569;
/** The looted chest (loc_2572), in place for the respawn. */
export const LOOTED_LOC = 2572;
/** The opened chest (loc_2574), the 4 ticks between search and loot. */
export const OPENED_LOC = 2574;
export const CHESTS: readonly Pt[] = [
    { x: 2586, z: 9734 },
    { x: 2586, z: 9737 }
];
/** The chests' forceapproach is north; this tile is north of both and clear of the ogre spawns. */
export const CHEST_APPROACH: Pt = { x: 2586, z: 9739 };
export const DOOR: Pt = { x: 2565, z: 3356 };
export const DOOR_OUTSIDE: Pt = { x: 2566, z: 3356 };
export const LADDER_DOWN: Pt = { x: 2562, z: 3356 };
export const LADDER_TOP: Pt = { x: 2560, z: 3356 };
/** trapped_chest.dbrow tele_coord 0_40_52_24_9. */
export const LANDING: Pt = { x: 2584, z: 3337 };
/** East Ardougne north bank (bank notice boards at 2616-2618, 3330). */
export const BANK: Pt = { x: 2617, z: 3333 };
/** East of White Wolf Mountain: a walk from the Lumbridge side goes through here first (lib/kandarin.ts). */
export const TAVERLEY: Pt = { x: 2880, z: 3410 };

/** Ogres are level 53: `cowardly` hunts a player of combat level at most 106. */
export const SAFE_COMBAT = 107;
export const THIEVING_LEVEL = 59;
export const BLOOD = /^blood rune$/i;
const COINS = /^coins$/i;
const FOOD = /^(kebab|shark|lobster|swordfish|tuna|salmon|trout|cake|2\/3 cake|slice of cake|bread|meat pie|half a meat pie|cooked meat|cooked chicken|shrimps)$/i;

export type Zone = 'basement' | 'tower' | 'upstairs' | 'near' | 'away';

/** Where the player stands, as the role cares about it. */
export function zoneOf(p: { x: number; z: number; level: number }): Zone {
    if (p.level === 0 && p.x >= 2550 && p.x <= 2600 && p.z >= 9720 && p.z <= 9770) return 'basement';
    if (p.x >= 2557 && p.x <= 2564 && p.z >= 3351 && p.z <= 3361) return p.level === 0 ? 'tower' : 'upstairs';
    if (p.level === 0 && p.z < 6400 && chebyshev(p, DOOR) <= 120) return 'near';
    return 'away';
}

export type ChestSeen = 'ready' | 'looted' | 'unknown';

/** Each chest's state from the published locs: ready (2569), looted or opening (2572, 2574), or out of view. */
export function chestStates(locs: readonly Pick<NearbyLoc, 'x' | 'z' | 'id'>[]): ChestSeen[] {
    return CHESTS.map(c => {
        const here = locs.filter(l => l.x === c.x && l.z === c.z);
        if (here.some(l => l.id === CHEST_LOC)) return 'ready';
        if (here.some(l => l.id === LOOTED_LOC || l.id === OPENED_LOC)) return 'looted';
        return 'unknown';
    });
}

export type Step =
    | { do: 'travel' }
    | { do: 'bank' }
    | { do: 'door' }
    | { do: 'ladder' }
    | { do: 'downstairs' }
    | { do: 'approach' }
    | { do: 'loot'; chest: number }
    | { do: 'wait' };

export interface PlanInput {
    zone: Zone;
    at: Pt;
    chests: readonly ChestSeen[];
    /** Blood runes in the inventory. */
    carried: number;
    bankAt: number;
    /** A bank visit failed recently: carry on looting instead of retrying it. */
    bankBlocked: boolean;
}

/**
 * The next step. Banking happens only on the surface near Ardougne, where the
 * teleport drops the player anyway; inside the tower or the cave the role always
 * heads for the chests. In the cave: the nearest ready chest, else walk until
 * both chests are in view, else wait beside them for a respawn.
 */
export function planStep(i: PlanInput): Step {
    switch (i.zone) {
        case 'away':
            return { do: 'travel' };
        case 'near':
            return i.carried >= i.bankAt && !i.bankBlocked ? { do: 'bank' } : { do: 'door' };
        case 'upstairs':
            return { do: 'downstairs' };
        case 'tower':
            return { do: 'ladder' };
        case 'basement': {
            const ready = CHESTS.map((c, n) => ({ n, d: chebyshev(c, i.at) })).filter(c => i.chests[c.n] === 'ready');
            ready.sort((a, b) => a.d - b.d || a.n - b.n);
            if (ready.length > 0) return { do: 'loot', chest: ready[0]!.n };
            if (i.chests.some(c => c === 'unknown')) return { do: 'approach' };
            return { do: 'wait' };
        }
    }
}

/** The engine's combat level (Player.ts getCombatLevel) from base levels. */
export function combatLevel(l: { attack: number; strength: number; defence: number; hitpoints: number; prayer: number; ranged: number; magic: number }): number {
    const base = 0.25 * (l.defence + l.hitpoints + Math.floor(l.prayer / 2));
    const melee = 0.325 * (l.attack + l.strength);
    const range = 0.325 * (Math.floor(l.ranged / 2) + l.ranged);
    const magic = 0.325 * (Math.floor(l.magic / 2) + l.magic);
    return Math.floor(base + Math.max(melee, range, magic));
}

/** Why this account must not run the role, or null. */
export function refusal(combat: number, thieving: number, minCombat = SAFE_COMBAT): string | null {
    if (combat < minCombat) return `combat level ${combat} is below ${minCombat}: the basement's ogres (level 53) would attack`;
    if (thieving < THIEVING_LEVEL) return `Thieving ${thieving} is below ${THIEVING_LEVEL}`;
    return null;
}

/** Blood runes per hour from a count over a span, or null for a span too short to say. */
export function perHour(count: number, ms: number): number | null {
    return ms >= 60_000 ? Math.round((count * 3_600_000) / ms) : null;
}

export interface ChestOptions {
    /** Carried blood runes that send the player to the bank after a loot. */
    bankAt: number;
    /** Coins left in the inventory after banking. */
    keepCoins: number;
    /** Stop (finish the role) once this many blood runes were gained over the assignment; 0 runs on. */
    target: number;
    minCombat: number;
    /** Ticks between progress lines. */
    reportTicks: number;
}

export function chestOptions(raw: Record<string, unknown>): ChestOptions {
    const num = (k: string, d: number) => {
        const v = raw[k];
        if (v === undefined) return d;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`chest: options.${k} must be a non-negative integer`);
        return v;
    };
    return {
        bankAt: Math.max(2, num('bankAt', 40)),
        keepCoins: num('keepCoins', 1000),
        target: num('target', 0),
        minCombat: num('minCombat', SAFE_COMBAT),
        reportTicks: Math.max(100, num('reportTicks', 1000))
    };
}

/** Durable progress in the account's role state, so a restart neither resets nor double-counts it. */
interface Progress {
    gained: number;
    opens: number;
    banked: number;
}
const STATE_KEY = 'chest';

class ChestRunner {
    private readonly o: ChestOptions;
    private progress: Progress;
    /** This session only (rates). */
    private opens = 0;
    private gained = 0;
    private coins = 0;
    private taken = 0;
    private readonly startedAt = Date.now();
    private startTick = 0;
    private lastReportTick = 0;
    private lastOpenTick = -1;
    private teleportedAt = -1;
    private bankBlockedUntil = -1;
    private waitingSince = -1;
    /** Last chest states seen in the cave, to notice a chest someone else took. */
    private seen: ChestSeen[] = CHESTS.map(() => 'unknown');
    private lootedByUs = new Set<number>();

    constructor(private readonly ctx: RoleContext) {
        this.o = chestOptions(ctx.options);
        const p = ctx.state.get(STATE_KEY) as Partial<Progress> | undefined;
        this.progress = { gained: p?.gained ?? 0, opens: p?.opens ?? 0, banked: p?.banked ?? 0 };
    }

    private get s(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private check(): void {
        if (this.ctx.signal.aborted) throw new Error('aborted');
    }

    async run(): Promise<void> {
        const s = this.s;
        const lv = (k: string) => this.ctx.sdk.getSkill(k)?.baseLevel ?? 1;
        const combat = combatLevel({ attack: lv('Attack'), strength: lv('Strength'), defence: lv('Defence'), hitpoints: lv('Hitpoints'), prayer: lv('Prayer'), ranged: lv('Ranged'), magic: lv('Magic') });
        const no = refusal(combat, lv('Thieving'), this.o.minCombat);
        if (no) {
            // Throwing would restart into the same refusal; log it and idle so a person reassigns the account.
            this.ctx.log('refused', { reason: no });
            while (!this.ctx.signal.aborted) await waitTicks(this.ctx.sdk, 500);
            return;
        }
        this.startTick = s.tick;
        this.lastReportTick = s.tick;
        this.ctx.log('start', { options: this.o, combat, thieving: lv('Thieving'), at: pos(s), carried: invCount(s, BLOOD), progress: this.progress });
        await ensureRunOn(this.ctx.sdk, m => this.ctx.log('run toggle', { message: m }));

        let phase: Step['do'] | null = null;
        while (!this.ctx.signal.aborted) {
            if (this.o.target > 0 && this.progress.gained >= this.o.target) {
                this.report('target reached');
                return;
            }
            await this.ctx.bot.dismissBlockingUI();
            await this.eatIfLow();
            const st = this.s;
            const here = pos(st);
            const zone = zoneOf(here);
            const chests = zone === 'basement' ? this.observe(st) : this.seen;
            const step = planStep({ zone, at: here, chests, carried: invCount(st, BLOOD), bankAt: this.o.bankAt, bankBlocked: st.tick < this.bankBlockedUntil });
            if (step.do !== phase && step.do !== 'wait') this.ctx.log('phase', { phase: step.do, at: here });
            if (step.do !== 'wait') this.waitingSince = -1;
            phase = step.do;
            if (st.tick - this.lastReportTick >= this.o.reportTicks) this.report('progress');
            try {
                await this.do(step);
            } catch (e) {
                if (this.ctx.signal.aborted) break;
                this.ctx.log('step error', { step: step.do, error: String(e).slice(0, 300) });
                await waitTicks(this.ctx.sdk, 5);
            }
        }
        this.report('stop');
    }

    /** Chest states in view; a chest seen ready that turned looted without our search was taken by someone else. */
    private observe(st: BotWorldState): ChestSeen[] {
        const now = chestStates(st.nearbyLocs);
        now.forEach((c, n) => {
            if (this.seen[n] === 'ready' && c === 'looted' && !this.lootedByUs.has(n)) {
                this.taken++;
                const others = st.nearbyPlayers.filter(p => chebyshev(p, CHESTS[n]!) <= 6).length;
                this.ctx.log('chest taken by someone else', { chest: n, playersNear: others, taken: this.taken });
            }
            if (c !== 'looted') this.lootedByUs.delete(n);
        });
        this.seen = now.map((c, n) => (c === 'unknown' ? this.seen[n]! : c));
        return now;
    }

    private async do(step: Step): Promise<void> {
        switch (step.do) {
            case 'travel':
                return this.travel();
            case 'bank':
                return this.bank();
            case 'door':
                return this.door();
            case 'ladder':
                return this.climb(LADDER_DOWN, /^climb-down$/i, s => zoneOf(pos(s)) === 'basement');
            case 'downstairs':
                return this.climb(LADDER_TOP, /^climb-down$/i, s => pos(s).level === 0);
            case 'approach':
                return this.walk(CHEST_APPROACH, 2);
            case 'loot':
                return this.loot(step.chest);
            case 'wait':
                if (this.waitingSince < 0) {
                    this.waitingSince = this.s.tick;
                    this.ctx.log('waiting for a respawn', { sinceLastOpen: this.lastOpenTick < 0 ? null : this.s.tick - this.lastOpenTick });
                }
                await waitTicks(this.ctx.sdk, 1);
                return;
        }
    }

    private async walk(to: Pt, tolerance: number): Promise<void> {
        const r = await travelTo(this.ctx.bot, this.ctx.sdk, to, { tolerance, log: this.ctx.log, signal: this.ctx.signal });
        if (!r.ok) {
            this.ctx.log('walk failed', { to, reason: r.reason, at: pos(this.s) });
            await waitTicks(this.ctx.sdk, 3);
        }
    }

    /** To the tower door from anywhere: through Taverley first when east of White Wolf Mountain. */
    private async travel(): Promise<void> {
        const t0 = this.s.tick;
        this.ctx.log('travelling to the Chaos Druid Tower', { from: pos(this.s) });
        if (pos(this.s).x >= TAVERLEY.x - 10) await this.walk(TAVERLEY, 4);
        this.check();
        await this.walk(DOOR_OUTSIDE, 3);
        this.ctx.log('travelled', { at: pos(this.s), ticks: this.s.tick - t0 });
    }

    /** Pick the tower's lock until inside (a failed pick has no delay, so a resend every 2 still ticks). */
    private async door(): Promise<void> {
        if (chebyshev(pos(this.s), DOOR_OUTSIDE) > 12) await this.walk(DOOR_OUTSIDE, 2);
        this.check();
        const door = this.s.nearbyLocs.find(l => l.x === DOOR.x && l.z === DOOR.z && opIndex(l, /^pick lock$/i) !== undefined);
        if (!door) {
            // Open (the door swung by someone) or out of view: walk in.
            await this.ctx.sdk.sendWalk(LADDER_DOWN.x + 1, LADDER_DOWN.z, true);
            await waitTicks(this.ctx.sdk, 3);
            return;
        }
        const op = opIndex(door, /^pick lock$/i)!;
        const r = await act(this.ctx.sdk, () => this.ctx.sdk.sendInteractLoc(door.x, door.z, door.id, op), s => zoneOf(pos(s)) === 'tower', { resendEvery: 2, maxResends: 40, maxTicks: 90 });
        if (!r.ok) this.ctx.log('door not picked', { ticks: r.ticks, tries: r.resends + 1, at: pos(this.s) });
    }

    private async climb(at: Pt, op: RegExp, done: (s: BotWorldState) => boolean): Promise<void> {
        const ladder = this.s.nearbyLocs.find(l => l.x === at.x && l.z === at.z && opIndex(l, op) !== undefined);
        if (!ladder) {
            this.ctx.log('ladder not in view', { at: pos(this.s), ladder: at });
            await waitTicks(this.ctx.sdk, 3);
            return;
        }
        const r = await act(this.ctx.sdk, () => this.ctx.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, opIndex(ladder, op)!), done, { resendEvery: 4, maxTicks: 30 });
        if (!r.ok) this.ctx.log('ladder failed', { at: pos(this.s) });
    }

    /** Search one chest; done when the runes land, the trap teleports us, or someone else's search turns it. */
    private async loot(n: number): Promise<void> {
        const c = CHESTS[n]!;
        const st = this.s;
        const chest = st.nearbyLocs.find(l => l.x === c.x && l.z === c.z && l.id === CHEST_LOC);
        const op = chest ? opIndex(chest, /^search for traps$/i) : undefined;
        if (!chest || op === undefined) return;
        const blood0 = invCount(st, BLOOD);
        const coins0 = invCount(st, COINS);
        const t0 = st.tick;
        const gainedRunes = (s: BotWorldState) => invCount(s, BLOOD) > blood0;
        const r = await act(
            this.ctx.sdk,
            () => this.ctx.sdk.sendInteractLoc(c.x, c.z, CHEST_LOC, op),
            s => gainedRunes(s) || zoneOf(pos(s)) !== 'basement' || chestStates(s.nearbyLocs)[n] === 'looted',
            { resendEvery: 5, maxResends: 4, maxTicks: 40 }
        );
        let s = this.s;
        if (!gainedRunes(s) && chestStates(s.nearbyLocs)[n] === 'looted' && zoneOf(pos(s)) === 'basement') {
            // The chest turned before our runes landed: ours is mid-search, or someone else's search won.
            for (let i = 0; i < 6 && !gainedRunes(s); i++) s = await waitTicks(this.ctx.sdk, 1);
        }
        if (!gainedRunes(s)) {
            if (!r.ok) this.ctx.log('search timed out', { chest: n, ticks: s.tick - t0, at: pos(s) });
            return;
        }
        this.lootedByUs.add(n);
        this.seen[n] = 'looted';
        const blood = invCount(s, BLOOD) - blood0;
        const coins = Math.max(0, invCount(s, COINS) - coins0);
        this.opens++;
        this.gained += blood;
        this.coins += coins;
        this.progress = { ...this.progress, gained: this.progress.gained + blood, opens: this.progress.opens + 1 };
        await this.ctx.state.set(STATE_KEY, this.progress);
        const trip = this.teleportedAt >= 0 ? t0 - this.teleportedAt : null;
        const since = this.lastOpenTick >= 0 ? s.tick - this.lastOpenTick : null;
        this.lastOpenTick = s.tick;
        // The second trap teleports us out a few ticks after the loot.
        for (let i = 0; i < 8 && zoneOf(pos(s)) === 'basement'; i++) s = await waitTicks(this.ctx.sdk, 1);
        this.teleportedAt = s.tick;
        this.ctx.log('looted', { chest: n, blood, coins, carried: invCount(s, BLOOD), searchTicks: s.tick - t0, returnTrip: trip, sinceLastOpen: since, opens: this.opens, gained: this.gained, assignment: this.progress.gained, landed: pos(s) });
    }

    private async bank(): Promise<void> {
        await this.walk(BANK, 3);
        if (chebyshev(pos(this.s), BANK) > 6) {
            this.bankBlockedUntil = this.s.tick + 600;
            return;
        }
        if (!(await openBank(this.ctx))) {
            this.bankBlockedUntil = this.s.tick + 600;
            this.ctx.log('bank would not open; looting on', { at: pos(this.s) });
            return;
        }
        const blood = invCount(this.s, BLOOD);
        if (blood > 0) {
            const r = await this.ctx.bot.depositItem(BLOOD, -1);
            if (!r.success) this.ctx.log('deposit failed', { item: 'Blood rune', message: r.message });
        }
        const extra = invCount(this.s, COINS) - this.o.keepCoins;
        if (extra > 0) {
            const r = await this.ctx.bot.depositItem(COINS, extra);
            if (!r.success) this.ctx.log('deposit failed', { item: 'Coins', message: r.message });
        }
        await waitTicks(this.ctx.sdk, 1);
        const deposited = blood - invCount(this.s, BLOOD);
        const items = this.ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));
        this.ctx.reportBank({ items });
        await closeBank(this.ctx);
        if (deposited > 0) {
            this.progress = { ...this.progress, banked: this.progress.banked + deposited };
            await this.ctx.state.set(STATE_KEY, this.progress);
        }
        this.ctx.log('banked', { blood: deposited, inBank: items.find(i => BLOOD.test(i.name))?.count ?? 0, coinsInBank: items.find(i => COINS.test(i.name))?.count ?? 0 });
    }

    private async eatIfLow(): Promise<void> {
        const p = this.s.player!;
        if (p.hp * 2 > p.maxHp) return;
        const food = this.s.inventory.find(i => FOOD.test(i.name) && i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));
        const op = food?.optionsWithIndex.find(o => /^eat$/i.test(o.text));
        if (food && op) {
            await this.ctx.sdk.sendUseItem(food.slot, op.opIndex);
            await waitTicks(this.ctx.sdk, 2);
            this.ctx.log('ate', { food: food.name, hp: this.s.player!.hp, maxHp: p.maxHp });
        }
    }

    private report(message: string): void {
        const s = this.ctx.sdk.getState();
        const ticks = (s?.tick ?? this.startTick) - this.startTick;
        const ms = Date.now() - this.startedAt;
        this.lastReportTick = s?.tick ?? 0;
        this.ctx.log(message, {
            opens: this.opens,
            blood: this.gained,
            coins: this.coins,
            takenByOthers: this.taken,
            ticks,
            minutes: Math.round(ms / 60_000),
            bloodPerHour: perHour(this.gained, ms),
            bloodPer1000Ticks: ticks > 0 ? +((this.gained * 1000) / ticks).toFixed(1) : null,
            msPerTick: ticks > 0 ? Math.round(ms / ticks) : null,
            assignment: this.progress
        });
    }
}

export const role: Role = {
    name: 'chest',
    produces: [/^Blood rune$/, /^Coins$/],
    run: ctx => new ChestRunner(ctx).run()
};

if (import.meta.main) await runStandalone(role);
