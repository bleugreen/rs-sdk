// rc-solo: one account crafting air runes alone, for a measurement row on the demo's Runecraft
// board (rs/461). It is rehearsal-only: never part of the scored run's step chain. The account
// banks its own essence at Falador east and crafts at the air altar. Each trip is the S06 altar
// givers' restock loop (helpers/altar-room.ts `restock` and `enterRoom`, the same walk) with a craft
// where the giver trades. rehearse.ts runs it as a skill module (S00, these steps, a clean logout):
//
//   bun speedrun/rehearse.ts --skill=speedrun/tools/rc-solo.ts --client=lite --bot=<name> \
//       --skill-opt=courier='^<courier>$' [--to=99]
//   lab: LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> \
//       'speedrun/rehearse.ts:--skill=speedrun/tools/rc-solo.ts:--client=lite:--lab:--to=64:--skill-opt=labSeed=800'
//
// Steps: `rc-solo:talisman`, where Duke Horacio starts Rune Mysteries and hands over an air
// talisman (his dialogue answered a page at a time, never in bursts), then level bands of trips to
// `to`. A trip is the exit portal once the craft's delay is over, Falador east bank (the runes go
// in, one load comes out), the ruins, then the altar. The first bank visit takes in the essence: a
// supply trade from `courier` (the demo), or a staff-given stack (`labSeed`, the local lab only).
// From then on every load is one withdrawal, and a bank that can't make the next load stops the run
// (`nextAction` refuses; restock's `refuseShort`) instead of waiting for essence nobody is bringing.
//
// Options (strings are accepted, as --skill-opt passes them):
//   to       target Runecraft level, 2-99 (default 99; rehearse.ts passes --to)
//   courier  account-name RegExp source of the essence courier, accepted at the first bank visit
//   labSeed  noted essence staff-given into the pack at the first bank visit (local lab only)
//
// Every trip writes a zero-tick `rc-solo:trip` note row: its ticks from craft to craft and its
// legs. Results: docs/speedrun/rehearsals/runecraft.md.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { altarData, BankShort, count, enterRoom, ESSENCE, findAltar, inRoom, restock, type RestockOptions } from '../helpers/altar-room';
import { memoryRoleState, type RoleContext } from '../helpers/role';
import { act, talkTo } from '../lib/act';
import { levelUpInterrupt } from '../lib/converse';
import { withLevelUpDismissal } from '../lib/levelup';
import { ALTARS } from '../lib/runecraft';
import { logNote } from '../lib/ticks';
import { runTo, type Area } from '../lib/travel';
import { waitUntil, type Pred } from '../lib/wait';
import { opIndex, pos } from '../lib/world';
import { XP_RATE, xpForLevel } from '../lib/xp';
import { locAt, LOCS, TILES } from '../quests/dragon-slayer';
import type { Step, StepContext } from '../runner/step';
import { rcLevel, rcXp } from '../skills/runecraft';

export const skill = 'runecraft';

const ALTAR = altarData('air');
/** Essence per load: the talisman takes the 28th slot. */
export const LOAD = 27;
/** Game xp per essence at the air altar (5 base). */
export const XP_PER_ESSENCE = ALTARS.air!.xp * XP_RATE;
/**
 * The craft ends in `p_delay(3)`: delayed through T+4 for a craft on tick T, and a loc click sent
 * while delayed is dropped without a message (docs/speedrun/skills/runecraft.md section 4). The
 * portal click goes out on frame T+4, so it lands on T+5, the first free tick, and closes the
 * level-up dialog that opens on T+4.
 */
export const CRAFT_FREE_FRAME = 4;
/** Upper ends of the level bands (each a logout-safe step); `to` cuts the last one. */
export const BAND_ENDS: readonly number[] = [50, 70, 80, 85, 90, 93, 96, 98, 99];

const BIND = /bind the temple's power/i;
const DUKE = /^Duke Horacio$/i;
const INTERRUPTS = () => [levelUpInterrupt()];

export interface SoloOptions {
    to?: number | string;
    toLevel?: number | string;
    courier?: string;
    labSeed?: number | string;
    [k: string]: unknown;
}

export interface Resolved {
    to: number;
    courier?: string;
    labSeed?: number;
}

export function resolveOptions(opts: SoloOptions = {}): Resolved {
    const to = Number(opts.to ?? opts.toLevel ?? 99);
    if (!Number.isInteger(to) || to < 2 || to > 99) throw new Error(`rc-solo: to must be a level from 2 to 99 (got ${opts.to ?? opts.toLevel})`);
    let courier: string | undefined;
    if (opts.courier !== undefined && opts.courier !== '') {
        courier = String(opts.courier);
        new RegExp(courier, 'i'); // a bad pattern fails here, not at the bank
    }
    let labSeed: number | undefined;
    if (opts.labSeed !== undefined && opts.labSeed !== '') {
        labSeed = Number(opts.labSeed);
        if (!Number.isInteger(labSeed) || labSeed < 1) throw new Error(`rc-solo: labSeed must be a whole number of essence (got ${opts.labSeed})`);
    }
    return { to, ...(courier ? { courier } : {}), ...(labSeed ? { labSeed } : {}) };
}

/** The level bands from 1 to `to`, each ending at a BAND_ENDS level below `to`, the last at `to`. */
export function bands(to: number): { from: number; to: number }[] {
    const ends = [...BAND_ENDS.filter(e => e < to), to];
    let from = 1;
    return ends.map(end => {
        const b = { from, to: end };
        from = end;
        return b;
    });
}

/** What the trip decisions read from a state. */
export interface TripView {
    xp: number;
    inRoom: boolean;
    /** Rune essence carried (notes don't count: the altar takes only the item). */
    essence: number;
    talisman: boolean;
}

export function tripView(s: BotWorldState): TripView {
    return { xp: rcXp(s), inRoom: inRoom(s, ALTAR), essence: count(s, ESSENCE), talisman: count(s, ALTAR.talisman) > 0 };
}

/** The next load: a full one, or on the last trip just the essence that reaches `targetXp`. */
export function loadFor(xp: number, targetXp: number, load = LOAD): number {
    return Math.max(0, Math.min(load, Math.ceil((targetXp - xp) / XP_PER_ESSENCE)));
}

export type TripAction =
    | { kind: 'done' }
    | { kind: 'craft' }
    | { kind: 'enter' }
    | { kind: 'restock'; essence: number }
    | { kind: 'refuse'; reason: string };

/**
 * One decision of the loop, from any position, so a step resumed after a relog picks up where the
 * account stands. `bankEssence` is the bank's essence after the last visit's withdrawal, or null
 * before the first visit (the first visit is where the supply arrives).
 */
export function nextAction(v: TripView, o: { targetXp: number; bankEssence: number | null; load?: number }): TripAction {
    if (v.xp >= o.targetXp) return { kind: 'done' };
    if (v.inRoom && v.essence > 0) return { kind: 'craft' };
    const n = loadFor(v.xp, o.targetXp, o.load);
    if (!v.talisman) return { kind: 'refuse', reason: 'no air talisman carried: the ruins cannot be entered' };
    if (!v.inRoom && v.essence >= n) return { kind: 'enter' };
    const short = n - v.essence;
    if (o.bankEssence !== null && o.bankEssence < short) {
        return { kind: 'refuse', reason: `out of essence: the bank holds ${o.bankEssence} rune essence and the next load needs ${short} more (${o.targetXp - v.xp} xp short of the target)` };
    }
    return { kind: 'restock', essence: n };
}

const hasTalisman: Pred = s => count(s, ALTAR.talisman) > 0;

type Ctx = StepContext<any>;
type Sdk = Ctx['sdk'];

async function runToArea(sdk: Sdk, to: Area, what: string): Promise<void> {
    const t = await runTo(sdk, to);
    if (!t.ok) throw new Error(`rc-solo: run to ${what} failed (${t.reason ?? 'no reason'}) at ${JSON.stringify(t.at)}`);
}

async function operate(sdk: Sdk, l: Parameters<typeof locAt>[1], op: RegExp, arrived: Pred): Promise<void> {
    const loc = await locAt(sdk, l);
    const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, opIndex(loc, op) ?? 1), arrived, { maxTicks: 40, interrupts: INTERRUPTS() });
    if (!r.ok) throw new Error(`rc-solo: ${l.name} at ${l.x},${l.z} (${op.source}) failed (${r.reason ?? 'no reason'}) at ${JSON.stringify(pos(sdk))}`);
}

const STAIRS_FOOT = { x: LOCS.lumbridgeStairs.x + 1, z: LOCS.lumbridgeStairs.z - 1 };

/** Up the Lumbridge castle stairs, Duke Horacio's Rune Mysteries start (an air talisman), and down again. */
async function getTalisman(c: Ctx): Promise<void> {
    const sdk = c.sdk;
    const s = () => sdk.getState()!;
    if (!hasTalisman(s())) {
        if (pos(sdk).level === 0) {
            await runToArea(sdk, { ...STAIRS_FOOT, tol: 1 }, 'the castle stairs');
            await operate(sdk, LOCS.lumbridgeStairs, /climb-up/i, st => pos(st).level === 1);
        }
        await runToArea(sdk, { x: TILES.duke.x - 1, z: TILES.duke.z, level: 1, tol: 2 }, 'the Duke');
        // duke_horacio.rs2: a page, the choice, four pages, the choice, three pages ending in the
        // mesbox, and the talisman after it. A lost talisman (the quest already started) skips the
        // second choice, which `unmatched: 'stop'` allows.
        const r = await talkTo(sdk, DUKE, [/any quests for me/i, /sure, no problem/i], { burst: false, interrupts: INTERRUPTS(), unmatched: 'stop', maxTicks: 120, until: hasTalisman });
        if (!hasTalisman(s())) throw new Error(`rc-solo: Duke Horacio gave no air talisman: ${r.reason ?? ''}; ${r.transcript.slice(-3).join(' / ')}`);
        logNote(c.log, c.session, 'rc-solo:duke', { ticks: r.ticks, pages: r.pages, options: r.options });
    }
    if (pos(sdk).level === 1) {
        await runToArea(sdk, { ...STAIRS_FOOT, level: 1, tol: 1 }, 'the castle stairs');
        await operate(sdk, { ...LOCS.lumbridgeStairs, id: 1739, op: 'Climb-down', level: 1 }, /climb-down/i, st => pos(st).level === 0);
    }
}

interface Craft {
    /** The craft's tick: its bind message's frame. */
    tick: number;
    session: number;
}

/** The loop's memory across band steps: the bank's essence, the last craft, the trip count. */
export class Crafter {
    bankEssence: number | null = null;
    trips = 0;
    private last: Craft | null = null;
    private marks: Record<string, number> = {};
    private resends: Record<string, number> = {};

    constructor(readonly o: Resolved) {}

    get targetXp(): number {
        return xpForLevel(this.o.to);
    }

    private role(c: Ctx): RoleContext {
        return {
            bot: c.bot,
            sdk: c.sdk,
            account: c.session.name,
            options: {},
            log: (message: string, data?: Record<string, unknown>) => console.log(`[rc-solo] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`),
            reportBank: snap => {
                this.bankEssence = snap.items.filter(i => ESSENCE.test(i.name)).reduce((n, i) => n + i.count, 0);
            },
            signal: new AbortController().signal,
            state: memoryRoleState()
        } as RoleContext;
    }

    private restockOptions(essence: number): RestockOptions {
        // The supply comes on the first visit; after it, a short bank is the end of the essence.
        const first = this.bankEssence === null;
        return {
            kind: 'bank',
            essence,
            refuseShort: true,
            ...(first && this.o.courier ? { acceptFrom: this.o.courier } : {}),
            ...(first && this.o.labSeed ? { labSeed: { essence: this.o.labSeed } } : {})
        };
    }

    private mark(sdk: Sdk, leg: string): void {
        this.marks[leg] = sdk.getState()?.tick ?? -1;
    }

    /** Craft trips until Runecraft xp reaches `untilXp` (a band's end); the loads aim at the run's target. */
    async band(c: Ctx, untilXp: number): Promise<void> {
        const sdk = c.sdk;
        const role = this.role(c);
        this.marks = { start: sdk.getState()?.tick ?? -1 };
        for (;;) {
            const s = sdk.getState();
            if (!s) throw new Error('rc-solo: no state');
            if (rcXp(s) >= untilXp) break;
            const a = nextAction(tripView(s), { targetXp: this.targetXp, bankEssence: this.bankEssence });
            if (a.kind === 'done') break;
            if (a.kind === 'refuse') throw new Error(`rc-solo: ${a.reason}`);
            if (a.kind === 'craft') await this.craft(c);
            else if (a.kind === 'enter') {
                await enterRoom(role, ALTAR);
                this.mark(sdk, 'entered');
            } else {
                if (inRoom(s, ALTAR)) {
                    await this.exitPortal(c);
                    this.mark(sdk, 'out');
                }
                try {
                    await restock(role, ALTAR, this.restockOptions(a.essence), () => {});
                } catch (e) {
                    if (e instanceof BankShort) throw new Error(`rc-solo: out of essence: ${e.message}`);
                    throw e;
                }
                this.mark(sdk, 'banked');
            }
        }
        if (rcXp(sdk.getState()!) >= this.targetXp) await this.finish(c);
    }

    /** Click the altar from wherever the room put us; the craft is the bind message's frame. */
    private async craft(c: Ctx): Promise<void> {
        const sdk = c.sdk;
        const s = sdk.getState()!;
        const altar: NearbyLoc | undefined = findAltar({ sdk });
        if (!altar) throw new Error('rc-solo: no altar in sight from the room');
        const op = opIndex(altar, /craft/i) ?? 1;
        const xp0 = rcXp(s);
        const essence = count(s, ESSENCE);
        const sent = s.tick;
        const r = await act(sdk, () => sdk.sendInteractLoc(altar.x, altar.z, altar.id, op), st => rcXp(st) > xp0, { maxTicks: 30, resendEvery: 4, interrupts: INTERRUPTS() });
        if (!r.ok) throw new Error(`rc-solo: the altar click never crafted (${r.reason ?? 'no reason'})`);
        const now = sdk.getState()!;
        const bind = now.gameMessages.filter(m => m.tick > sent && BIND.test(m.text)).at(-1);
        // Without the message, the xp frame stands in (the message shows a frame earlier on the lite client).
        const tick = bind?.tick ?? now.tick - 1;
        this.resends.craft = r.resends;
        this.trips++;
        const prev = this.last && this.last.session === c.session.sessionId ? this.last : null;
        const m = this.marks;
        const from = prev?.tick ?? m.start ?? tick;
        const leg = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && a >= 0 && b >= 0 ? b - a : null);
        logNote(c.log, c.session, 'rc-solo:trip', {
            trip: this.trips,
            tick,
            ticks: tick - from,
            ...(prev ? {} : { first: true }),
            level: rcLevel(now),
            xp: rcXp(now),
            essence,
            legs: { out: leg(prev?.tick, m.out), bank: leg(m.out, m.banked), enter: leg(m.banked, m.entered), craft: leg(m.entered, tick) },
            resends: { ...this.resends },
            bankEssence: this.bankEssence
        });
        this.last = { tick, session: c.session.sessionId };
        this.marks = {};
        this.resends = {};
    }

    /** Out through the portal on the craft's first free tick (CRAFT_FREE_FRAME); a dropped click is re-sent. */
    private async exitPortal(c: Ctx): Promise<void> {
        const sdk = c.sdk;
        const last = this.last && this.last.session === c.session.sessionId ? this.last : null;
        if (last) await waitUntil(sdk, st => st.tick >= last.tick + CRAFT_FREE_FRAME, { maxTicks: CRAFT_FREE_FRAME + 2 });
        const portal = sdk
            .getNearbyLocs()
            .filter(l => /^portal$/i.test(l.name))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!portal) return; // restock's leaveRoom looks again
        const r = await act(sdk, () => sdk.sendInteractLoc(portal.x, portal.z, portal.id, 1), st => !inRoom(st, ALTAR), { maxTicks: 30, resendEvery: 3, interrupts: INTERRUPTS() });
        this.resends.portal = r.resends;
    }

    /** The target's last craft: answer its level-up once the delay ends, so the logout finds no dialog. */
    private async finish(c: Ctx): Promise<void> {
        const sdk = c.sdk;
        const last = this.last;
        if (!last || last.session !== c.session.sessionId) return;
        await withLevelUpDismissal(sdk, () => waitUntil(sdk, st => st.tick >= last.tick + CRAFT_FREE_FRAME + 2, { maxTicks: CRAFT_FREE_FRAME + 4 }));
    }
}

export function steps(opts: SoloOptions = {}): Step<any>[] {
    const o = resolveOptions(opts);
    const crafter = new Crafter(o);
    const talisman: Step<any> = {
        name: 'rc-solo:talisman',
        preconditions: () => true,
        run: c => getTalisman(c),
        postconditions: s => (!hasTalisman(s) ? 'no air talisman carried' : pos(s).level !== 0 ? 'still upstairs in Lumbridge castle' : true),
        logoutSafe: true,
        done: ob => hasTalisman(ob.state) || rcXp(ob.state) > 0
    };
    return [
        talisman,
        ...bands(o.to).map(
            (b): Step<any> => ({
                name: `rc-solo:air-${b.from}-${b.to}`,
                preconditions: s => (hasTalisman(s) || inRoom(s, ALTAR) ? true : 'no air talisman carried, and not in the air altar room'),
                run: c => crafter.band(c, xpForLevel(b.to)),
                postconditions: s => (rcLevel(s) >= b.to ? true : `Runecraft ${rcLevel(s)}, short of ${b.to}`),
                logoutSafe: true,
                done: ob => rcLevel(ob.state) >= b.to
            })
        )
    ];
}
