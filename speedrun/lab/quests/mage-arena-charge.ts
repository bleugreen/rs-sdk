// Mage Arena then a Charge probe, on a real account in ONE login, with no staff command and no
// chat: the demo's re-read of Charge (`charge.rs2`) after the engine changed under us. The fight is
// main's quests/mage-arena.ts, unchanged, run by demo-quest.ts's runDemoQuest in fixed dialogue;
// everything around it is this script's untimed staging.
//
//   bun speedrun/lab/quests/mage-arena-charge.ts <account> --fleet-account \
//       [--receive=<json>] [--meet=varrock|yanille] [--receive-minutes=40] [--casts=10] [--burst=5] [--trace=N] [--probe-only]
//
// --probe-only: the arena is already done (a relaunch after it): only the probe, where the account
// stands, then the logout.
//
// Phases, each skipped when the account's state shows it done, so a relaunch resumes:
//   out       a dragons-role account parked in Taverley dungeon's dragon room climbs out first
//   receive   at Varrock west bank (the couriers' tile, mule.ts MULE_STAND), take each one-shot
//             fleet handover in --receive ([{from, item, n}]) in whatever order the givers come
//   prayer    bank everything (worn too), bury big bones to Prayer 37 (Protect from Magic)
//   buy       GE: death runes to DEATH_RUNES, a knife; Magic Guild (over White Wolf Mountain):
//             blood runes to BLOOD_RUNES; bank the coins at Yanille
//   kit       the fight's kit only (mage-arena.ts kit('fire_blast') + the probe's runes + the
//             teleport out + potions, food and the knife), the staff of fire wielded
//   travel    on foot to the Ardougne lever, the lever, the keep's web, the ladder webs, the
//             ladder down (runner/legs.ts T15-16 without its Ardougne Teleport: no Plague City)
//   arena     mage-arena.ts A-F, spell fire_blast, from A
//   out       Camelot Teleport from the chamber (outside the Wilderness)
//   probe     PROBE_TICKS: one cast, one tick carrying --burst casts, then single casts, --casts in
//             all; every tick's runes, xp and game messages recorded
// then a confirmed logout. Damage taken in the Wilderness with a player in view is printed as
// ATTACK; the legs carry on to the nearest exit (the cellar), as the fight does (its finish
// teleports to the cellar), so a stop never strands the account deep in the Wilderness.

import type { BotWorldState } from '../../../sdk/types';
import { wield } from '../../lib/act';
import { crossFromKandarin, crossToKandarin, westOfTaverley, type Traveller } from '../../lib/kandarin';
import { closeSession, loadBotEnv, openSession, type Session } from '../../lib/session';
import { TickLog, type TickRow } from '../../lib/ticks';
import { receiveFrom } from '../../lib/trade';
import { FOOD, hopsDestination, runTo, teleport, travel, wildernessLevel, within, type Hop } from '../../lib/travel';
import { nextTick, waitTicks, waitUntil } from '../../lib/wait';
import { invCount, invItem, pos, skillLevel, skillXp, worn } from '../../lib/world';
import * as mageArena from '../../quests/mage-arena';
import { DUSTY_KEY_DOOR, TAVERLEY_DUNGEON_BOTTOM, TAVERLEY_DUNGEON_LADDER } from '../../helpers/bones';
import { BANKS, Buyer, SHOPS } from '../../helpers/buyer';
import { GUILD, SAFE_ROUTE } from '../../helpers/dragons';
import { accountMatches, ChatCursor, MULE_STAND, playerPattern } from '../../helpers/mule';
import { TRADE_REQUEST_CHAT_TYPE } from '../../../sdk/types';
import { memoryRoleState, type RoleContext } from '../../helpers/role';
import { arg, botArg, result } from '../common';
import { startLoopbackGateway } from '../loopback-gateway';
import { confirmedLogout } from './aereck-burst';
import { checkDemoTarget, formatDemoTable, runDemoQuest } from './demo-quest';
import { trace } from './run';

export const SPELL = 'fire_blast' as const;
export const DEATH_RUNES = mageArena.SPELL_RUNES[SPELL];
/** Charge: 3 blood, 3 air and 3 fire a cast (magic_spells.dbrow), the fire from the staff. */
export const CHARGE_RUNES = 3;
export const CHARGE_COMPONENT = 1193; // magic:charge (interface.pack)
export const MAX_CASTS = 10;
export const BLOOD_RUNES = MAX_CASTS * CHARGE_RUNES;
/** Camelot Teleport's runes (lib/travel.ts SPELLS): out of the chamber to a tile the fleet role can leave from. */
export const TELEPORT_OUT = 'camelot' as const;
export const AIR_RUNES = mageArena.AIR_RUNES + MAX_CASTS * CHARGE_RUNES + 5 + 25;
export const LAW_RUNES = 2;
/** Coins carried from Varrock west: the GE's death runes and knife, then the guild's blood runes, at their caps. */
export const DEATH_MAX = 500;
export const KNIFE_MAX = 55_000;
export const BLOOD_MAX = 700;
export const BUDGET = DEATH_RUNES * DEATH_MAX + KNIFE_MAX + BLOOD_RUNES * BLOOD_MAX;
export const PRAYER_LEVEL = mageArena.PROTECT_PRAYER_LEVEL;
export const FOOD_HELD = 2;
const BIG_BONES = /^big bones$/i;
const KNIFE = /^knife$/i;
const PRAYER_POTION = /^prayer potion\(\d\)$/i;
const STAFF = mageArena.FIRE_STAFF;

/** On foot from anywhere on the mainland to Kolodion's cellar: legs.ts T15-16 without the teleport. */
export const TO_CELLAR: readonly Hop[] = [
    { kind: 'run', to: { x: 2562, z: 3311, tol: 1 } },
    { kind: 'lever', lever: 'ardougne' },
    { kind: 'webs', goals: [[3158, 3950], [3158, 3953]] },
    { kind: 'run', to: { x: 3097, z: 3957, tol: 1 } },
    { kind: 'webs', goals: [[3094, 3957], [3092, 3957]] },
    { kind: 'loc', loc: { x: 3091, z: 3957, name: /ladder/i }, op: /^climb-down$/i, arrive: { x: mageArena.ARRIVAL.x, z: mageArena.ARRIVAL.z, tol: 4 }, label: 'mage bank ladder down' },
];

/** Clicks per tick: one cast alone, one tick carrying `burst`, then single casts up to `total`. */
export function probeTicks(total = MAX_CASTS, burst = 5): number[] {
    if (!Number.isInteger(total) || total < 1 || total > MAX_CASTS) throw new Error(`casts: 1..${MAX_CASTS}, got ${total}`);
    if (!Number.isInteger(burst) || burst < 1 || burst > 5) throw new Error(`burst: 1..5 (the engine decodes 5 user events a tick), got ${burst}`);
    if (total === 1) return [1];
    const b = Math.min(burst, total - 1);
    return [1, b, ...Array.from({ length: total - 1 - b }, () => 1)];
}

export interface ProbeSample {
    tick: number;
    blood: number;
    air: number;
    magicXp: number;
    messages: string[];
}

export interface ProbeTickRow {
    tick: number;
    clicks: number;
    /** Casts landed this tick, by blood runes spent (3 a cast). */
    casts: number;
    blood: number;
    air: number;
    xp: number;
    messages: string[];
}

/** One row per sampled tick after the first: the clicks sent on it and what changed since the tick before. */
export function probeRows(samples: readonly ProbeSample[], clicksAt: ReadonlyMap<number, number>): ProbeTickRow[] {
    const rows: ProbeTickRow[] = [];
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        const blood = a.blood - b.blood;
        rows.push({ tick: b.tick, clicks: clicksAt.get(a.tick) ?? 0, casts: Math.floor(blood / CHARGE_RUNES), blood, air: a.air - b.air, xp: b.magicXp - a.magicXp, messages: b.messages });
    }
    return rows;
}

/** Where the deliveries are taken: a bank and the tile beside it the givers walk to. */
export interface Meet {
    bank: typeof BANKS[keyof typeof BANKS];
    tile: { x: number; z: number };
}

/** --meet: `varrock` (the couriers' tile, mule.ts MULE_STAND; default) or `yanille` (beside the Magic Guild). */
export function meetAt(name: string): Meet {
    if (name === 'varrock') return { bank: BANKS.varrockWest, tile: { ...MULE_STAND } };
    if (name === 'yanille') return { bank: BANKS.yanille, tile: { x: BANKS.yanille.x, z: BANKS.yanille.z } };
    throw new Error(`--meet=${name}: want varrock or yanille`);
}

export interface Delivery {
    from: string;
    item: string;
    n: number;
}

export function parseDeliveries(raw: string): Delivery[] {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) throw new Error('--receive: want a JSON array of {from, item, n}');
    return list.map((d: Record<string, unknown>, i) => {
        const from = String(d.from ?? '');
        const item = String(d.item ?? '');
        const n = Number(d.n);
        if (!/^cairn_[a-z0-9_]+$/i.test(from)) throw new Error(`--receive[${i}].from must be a cairn_ account`);
        if (!item) throw new Error(`--receive[${i}].item is required`);
        if (!Number.isInteger(n) || n < 1) throw new Error(`--receive[${i}].n must be a positive integer`);
        return { from, item, n };
    });
}

/** Damage taken with another player in view, in the Wilderness: what the ATTACK line reports. */
export function attackSeen(prev: BotWorldState, next: BotWorldState): { tick: number; hp: number; lost: number; wilderness: number; players: string[] } | null {
    const p0 = prev.player;
    const p1 = next.player;
    if (!p0 || !p1 || p1.hp >= p0.hp) return null;
    const wild = wildernessLevel({ x: p1.worldX, z: p1.worldZ });
    if (wild <= 0) return null;
    const players = next.nearbyPlayers.filter(p => p.distance <= 15).map(p => p.name);
    return players.length ? { tick: next.tick, hp: p1.hp, lost: p0.hp - p1.hp, wilderness: wild, players } : null;
}

const say = (m: string, d?: Record<string, unknown>) => console.log(`mac: ${m}${d ? ` ${JSON.stringify(d)}` : ''}`);
const prayerLevel = (s: BotWorldState | null) => s?.skills.find(k => k.name.toLowerCase() === 'prayer')?.baseLevel ?? 0;
const state = (session: Session) => {
    const s = session.sdk.getState();
    if (!s?.player) throw new Error('no game state');
    return s;
};

function roleContext(session: Session, signal: AbortSignal): RoleContext {
    return {
        bot: session.bot, sdk: session.sdk, account: session.name, options: {}, signal, state: memoryRoleState(),
        log: (m, d) => say(`buyer ${m}`, d),
        // Every bank visit's full contents, by id, for the coordinator's before/after bank lines.
        reportBank: snap => say('bank', { stacks: snap.items.length, items: snap.items.map(i => `${i.id} ${i.name} ${i.count}`) }),
    };
}

/** The owed delivery whose giver sent one of these trade requests (handover.ts's give requests first). */
export function deliveryRequested(owed: readonly Delivery[], requests: readonly { sender: string }[]): Delivery | undefined {
    return owed.find(o => requests.some(m => accountMatches(m.sender, playerPattern(o.from))));
}

/**
 * Take each delivery as its giver asks to trade, at the couriers' tile. Only a request answers: a
 * giver merely in view may be parked there on another role (h84's mule stands on this tile).
 */
async function receiveAll(session: Session, buyer: Buyer, deliveries: Delivery[], minutes: number, meet: { x: number; z: number }): Promise<void> {
    const owed = deliveries.filter(d => buyer.held(d.item) < d.n);
    if (!owed.length) return;
    if (!(await buyer.walk({ ...meet }))) throw new Error(`receive: could not reach ${meet.x},${meet.z}`);
    say('waiting for deliveries', { owed });
    const requests = new ChatCursor(session.sdk, [TRADE_REQUEST_CHAT_TYPE]);
    const deadline = Date.now() + minutes * 60_000;
    while (owed.length && Date.now() < deadline) {
        const d = deliveryRequested(owed, requests.next());
        if (!d) {
            await waitTicks(session.sdk, 2);
            continue;
        }
        // Accept any part of a delivery: a giver may bring it in instalments (one potion as it is brewed).
        const item = new RegExp(`^${d.item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const r = await receiveFrom(session.sdk, d.from, { want: [{ item, amount: 1 }], maxTicks: 150 });
        const got = r.received.filter(i => item.test(i.name)).reduce((a, i) => a + i.count, 0);
        say('received', { from: d.from, ok: r.ok, ticks: r.ticks, received: r.received.map(i => `${i.name} x${i.count}`), ...(r.reason ? { reason: r.reason } : {}) });
        if (r.ok) {
            d.n -= got;
            if (d.n <= 0) owed.splice(owed.indexOf(d), 1);
            else say('delivery part', { from: d.from, item: d.item, stillOwed: d.n });
        }
    }
    if (owed.length) throw new Error(`receive: still owed after ${minutes} min: ${JSON.stringify(owed)}`);
}

/**
 * Taverley dungeon (dragons.ts): the blue dragons' room lies west of the dusty-key door. The ladder's
 * foot is west of the door too, but the corridor to it loops north round the room, so "in the room"
 * is "beside SAFE_ROUTE" (the room's walkable band), not "west of the door".
 */
export const inTaverleyDungeon = (t: { x: number; z: number }) => t.z > 9700 && t.z < 9900 && t.x > 2840 && t.x < 2960;
export const inDragonRoom = (t: { x: number; z: number }) =>
    inTaverleyDungeon(t) && t.x < DUSTY_KEY_DOOR.x && SAFE_ROUTE.some(r => Math.max(Math.abs(r.x - t.x), Math.abs(r.z - t.z)) <= 3);

/**
 * The ladder's foot to Taverley. The ladder is not on TAVERLEY_DUNGEON_BOTTOM itself (bones.ts climbs the
 * nearest ladder to it), and both ends are level 0, so the hop waits for the surface tile, not a level change.
 */
export const TAVERLEY_LADDER_UP: readonly Hop[] = [
    { kind: 'run', to: { ...TAVERLEY_DUNGEON_BOTTOM, tol: 2 } },
    { kind: 'loc', loc: { name: /ladder/i, op: /^climb-up$/i, near: TAVERLEY_DUNGEON_BOTTOM, radius: 10 }, op: /^climb-up$/i, arrive: { ...TAVERLEY_DUNGEON_LADDER, tol: 4 }, label: 'Taverley dungeon ladder up' },
];

/** SAFE_ROUTE back to the door from the tile nearest the player, one tile per click (dragons.ts walkRoute). */
export function routeOut(p: { x: number; z: number }): { x: number; z: number }[] {
    const back = [...SAFE_ROUTE].reverse();
    const d = (t: { x: number; z: number }) => Math.max(Math.abs(t.x - p.x), Math.abs(t.z - p.z));
    const i = back.reduce((best, t, j) => (d(t) < d(back[best]!) ? j : best), 0);
    return back.slice(i);
}

/**
 * Out of the dragon room (a dragons-role account logs out on its safe tile): SAFE_ROUTE reversed one
 * tile per click, never inside an adult's leash, the dusty-key door from inside, then up the ladder.
 */
async function leaveTaverleyDungeon(session: Session): Promise<void> {
    const sdk = session.sdk;
    if (!inTaverleyDungeon(pos(sdk))) return;
    if (inDragonRoom(pos(sdk))) {
        for (const t of routeOut(pos(sdk))) {
            for (let attempt = 0; attempt < 3 && (pos(sdk).x !== t.x || pos(sdk).z !== t.z); attempt++) {
                void sdk.sendWalk(t.x, t.z, false);
                await waitUntil(sdk, s => s.player?.worldX === t.x && s.player?.worldZ === t.z, { maxTicks: 4 });
            }
            if (pos(sdk).x !== t.x || pos(sdk).z !== t.z) throw new Error(`dragon room: route step to ${t.x},${t.z} failed at ${JSON.stringify(pos(sdk))}`);
        }
        for (let attempt = 0; attempt < 4 && pos(sdk).x < DUSTY_KEY_DOOR.x; attempt++) {
            const door = (await sdk.scanNearbyLocs(4)).find(l => /door|gate/i.test(l.name) && l.x === DUSTY_KEY_DOOR.x && l.z === DUSTY_KEY_DOOR.z);
            if (door) await session.bot.interactLoc(door, /open/i);
            await waitUntil(sdk, s => (s.player?.worldX ?? 0) >= DUSTY_KEY_DOOR.x, { maxTicks: 10 });
        }
        if (pos(sdk).x < DUSTY_KEY_DOOR.x) throw new Error('dragon room: the dusty-key door did not let us out');
    }
    const r = await travel(sdk, TAVERLEY_LADDER_UP, { bot: session.bot, log: true });
    if (!r.ok || inTaverleyDungeon(pos(sdk))) throw new Error(`Taverley dungeon: not out (${r.reason ?? 'still underground'})`);
    say('out of Taverley dungeon', { at: pos(sdk), ticks: r.ticks });
}

/** The Magic Guild's ground floor or its store upstairs (dragons.ts inGuild). */
export function inGuild(s: BotWorldState | null): boolean {
    const p = s?.player;
    const b = GUILD.box;
    return !!p && p.worldX >= b.x1 && p.worldX <= b.x2 && p.worldZ >= b.z1 && p.worldZ <= b.z2 && (p.level === 0 || p.level === 1);
}

/** The stairs at `at` to `level` (dragons.ts climbTo). */
async function climbStairs(session: Session, level: number, at: { x: number; z: number }): Promise<boolean> {
    const sdk = session.sdk;
    for (let attempt = 0; attempt < 4 && sdk.getState()?.player?.level !== level; attempt++) {
        const option = level > (sdk.getState()?.player?.level ?? 0) ? /climb-up/i : /climb-down/i;
        const p = pos(sdk);
        if (Math.max(Math.abs(p.x - at.x), Math.abs(p.z - at.z)) > 2) await runTo(sdk, { x: at.x, z: at.z, level: p.level, tol: 1 }, { bot: session.bot });
        const loc = (await sdk.scanNearbyLocs(6)).filter(l => /stair/i.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!loc) {
            await waitTicks(sdk, 2);
            continue;
        }
        await session.bot.interactLoc(loc, option);
        await waitUntil(sdk, s => s.player?.level === level, { maxTicks: 10 });
    }
    return sdk.getState()?.player?.level === level;
}

/** Through the guild's east door (Magic 66) and up to the store (dragons.ts enterGuild). */
async function enterGuild(session: Session): Promise<void> {
    const sdk = session.sdk;
    if (!inGuild(sdk.getState())) {
        const r = await runTo(sdk, { ...GUILD.outside, tol: 0 }, { bot: session.bot });
        if (!r.ok) throw new Error(`guild: could not reach its door (${r.reason ?? 'unknown'})`);
        for (let attempt = 0; attempt < 4 && !inGuild(sdk.getState()); attempt++) {
            const door = (await sdk.scanNearbyLocs(3)).find(l => /door/i.test(l.name) && l.x === GUILD.door.x && Math.abs(l.z - GUILD.door.z) <= 1);
            if (door) await session.bot.interactLoc(door, /open/i);
            if ((await waitUntil(sdk, s => inGuild(s), { maxTicks: 6 })).ok) break;
            void sdk.sendWalk(GUILD.inside.x, GUILD.inside.z, false);
            await waitUntil(sdk, s => inGuild(s), { maxTicks: 4 });
        }
        if (!inGuild(sdk.getState())) throw new Error(`guild: the door did not let us in at ${JSON.stringify(pos(sdk))}`);
    }
    if (!(await climbStairs(session, 1, GUILD.stairsUp))) throw new Error('guild: could not climb to the store');
}

/** Down the stairs and out of the east door (dragons.ts leaveGuild). */
async function leaveGuild(session: Session): Promise<void> {
    const sdk = session.sdk;
    if (sdk.getState()?.player?.level === 1 && !(await climbStairs(session, 0, GUILD.stairsDown))) throw new Error('guild: could not climb down');
    for (let attempt = 0; attempt < 4 && inGuild(sdk.getState()); attempt++) {
        await runTo(sdk, { ...GUILD.inside, tol: 0 }, { bot: session.bot });
        const door = (await sdk.scanNearbyLocs(3)).find(l => /door/i.test(l.name) && l.x === GUILD.door.x && Math.abs(l.z - GUILD.door.z) <= 1);
        if (door) await session.bot.interactLoc(door, /open/i);
        if ((await waitUntil(sdk, s => !inGuild(s), { maxTicks: 6 })).ok) break;
        void sdk.sendWalk(GUILD.outside.x, GUILD.outside.z, false);
        await waitUntil(sdk, s => !inGuild(s), { maxTicks: 4 });
    }
    if (inGuild(sdk.getState())) throw new Error('guild: could not leave');
}

/** Bury big bones from the bank until Prayer reaches `level`. */
async function prayerTo(session: Session, buyer: Buyer, level: number, bank: typeof BANKS[keyof typeof BANKS]): Promise<void> {
    const sdk = session.sdk;
    for (let clicks = 0; prayerLevel(state(session)) < level; clicks++) {
        if (clicks > 120) throw new Error(`prayer: still ${prayerLevel(state(session))} after ${clicks} bury clicks`);
        // A level-up page must not swallow the next click.
        if (state(session).dialog.isOpen) await session.bot.dismissBlockingUI();
        if (!invItem(sdk, BIG_BONES) || invItem(sdk, BIG_BONES)!.optionsWithIndex.every(o => !/^bury$/i.test(o.text))) {
            await buyer.atBank(bank, async () => {
                await buyer.depositAllBut([]);
                const have = sdk.getBankItems().find(i => BIG_BONES.test(i.name))?.count ?? 0;
                if (!have) throw new Error(`prayer: no big bones left at Prayer ${prayerLevel(state(session))}`);
                await session.bot.withdrawItem(BIG_BONES, Math.min(28, have));
            });
        }
        const bone = invItem(sdk, BIG_BONES)!;
        const op = bone.optionsWithIndex.find(o => /^bury$/i.test(o.text))!.opIndex;
        const xp0 = skillXp(sdk, 'prayer');
        void sdk.sendUseItem(bone.slot, op);
        const w = await waitUntil(sdk, s => skillXp(s, 'prayer') > xp0, { maxTicks: 6 });
        if (!w.ok) await waitTicks(sdk, 1);
    }
    say('prayer', { level: prayerLevel(state(session)), points: state(session).prayers?.prayerPoints });
}

/** Every worn item into the inventory (Kolodion refuses armour and melee weapons worn). */
async function unequipAll(session: Session): Promise<void> {
    for (const it of [...state(session).equipment]) {
        if (STAFF.test(it.name)) continue;
        await session.bot.unequipItem(it);
    }
}

/** The fight's kit and the probe's runes, the staff of fire wielded; the rest banked. */
async function withdrawKit(session: Session, buyer: Buyer, bank: typeof BANKS[keyof typeof BANKS]): Promise<void> {
    const sdk = session.sdk;
    // Before the bank opens: unequipItem dismisses blocking UI first, which would close the bank.
    await unequipAll(session);
    await buyer.atBank(bank, async () => {
        await buyer.depositAllBut([]);
        const take = async (re: RegExp, n: number) => {
            const b = sdk.getBankItems().find(i => re.test(i.name));
            if (!b || b.count < n) throw new Error(`kit: bank holds ${b?.count ?? 0} ${re}, want ${n}`);
            await session.bot.withdrawItem(re, n);
        };
        await take(STAFF, 1);
        await take(/^death rune$/i, DEATH_RUNES);
        await take(/^air rune$/i, AIR_RUNES);
        await take(/^blood rune$/i, BLOOD_RUNES);
        await take(/^law rune$/i, LAW_RUNES);
        await take(KNIFE, 1);
        const pots = sdk.getBankItems().filter(i => PRAYER_POTION.test(i.name));
        for (const p of pots) await session.bot.withdrawItem(p, p.count);
        const food = sdk.getBankItems().find(i => FOOD.test(i.name));
        if (food) await session.bot.withdrawItem(food, Math.min(FOOD_HELD, food.count));
    });
    const w = await wield(sdk, STAFF);
    if (!w.ok) throw new Error(`kit: the staff of fire would not wield (${w.reason ?? 'unknown'})`);
    const refusal = mageArena.entryRefusal(state(session));
    if (refusal) throw new Error(`kit: ${refusal}`);
}

const kitHeld = (s: BotWorldState) => invCount(s, /^death rune$/i) >= DEATH_RUNES && invCount(s, /^air rune$/i) >= AIR_RUNES && invCount(s, /^blood rune$/i) >= BLOOD_RUNES && !!invItem(s, KNIFE) && !!worn(s, STAFF);

const inCellarOrBeyond = (s: BotWorldState) => mageArena.inCellar(s) || mageArena.inArena(s) || mageArena.inChamber(s);

/**
 * Staging, the legs in, the arena and the teleport out: everything before the probe. A phase whose
 * effect the state already shows is skipped (kit held, already in the cellar, arena or chamber).
 */
async function toChargeTile(
    session: Session, buyer: Buyer, traveller: Traveller, deliveries: Delivery[], minutes: number, meet: Meet, log: TickLog, out: Record<string, unknown>, setRows: (rows: TickRow[]) => void
): Promise<void> {
    const s0 = state(session);
    if (!inCellarOrBeyond(s0) && !kitHeld(s0)) {
        await leaveTaverleyDungeon(session);
        // Each staging step runs only while its result is short (buyer.held counts the bank), so a
        // relaunch part-way picks up where the last login stopped, on either side of the mountain.
        await buyer.atBank(meet.bank, () => buyer.depositAllBut(['Coins']));
        await receiveAll(session, buyer, deliveries, minutes, meet.tile);
        await prayerTo(session, buyer, PRAYER_LEVEL, meet.bank);
        if (buyer.held('Death rune') < DEATH_RUNES || buyer.held('Knife') < 1) {
            if (westOfTaverley(pos(session.sdk))) await crossFromKandarin(traveller, BANKS.varrockWest, 'Varrock west');
            // `quantity` is the target holding, bank included (buyer.md): the kit is withdrawn from the bank.
            await buyer.atBank(BANKS.varrockWest, async () => {
                await buyer.depositAllBut([]);
                await buyer.setCoins(BUDGET);
            });
            say('bought', { ...(await buyer.buyAtGE({ item: 'Death rune', quantity: DEATH_RUNES, maxPrice: DEATH_MAX, source: 'ge' })) });
            say('bought', { ...(await buyer.buyAtGE({ item: 'Knife', quantity: 1, maxPrice: KNIFE_MAX, source: 'ge' })) });
        }
        if (!westOfTaverley(pos(session.sdk))) await crossToKandarin(traveller, SHOPS.magicGuild!.bank, 'Yanille');
        if (buyer.held('Blood rune') < BLOOD_RUNES) {
            // The store is upstairs behind the Magic-66 door, which the buyer's walk does not know.
            await enterGuild(session);
            say('bought', { ...(await buyer.buyAtShop({ item: 'Blood rune', quantity: BLOOD_RUNES, maxPrice: BLOOD_MAX, source: 'shop', shop: 'magicGuild', maxWaitTicks: 120 })) });
            await leaveGuild(session);
        }
        await withdrawKit(session, buyer, BANKS.yanille);
    }
    const sk = state(session);
    out.kit = { death: invCount(sk, /^death rune$/i), air: invCount(sk, /^air rune$/i), blood: invCount(sk, /^blood rune$/i), law: invCount(sk, /^law rune$/i), potions: sk.inventory.filter(i => PRAYER_POTION.test(i.name)).map(i => i.name), food: invCount(sk, FOOD), prayer: prayerLevel(sk) };
    say('kit', out.kit as Record<string, unknown>);

    if (!inCellarOrBeyond(sk)) {
        const r = await travel(session.sdk, TO_CELLAR, { bot: session.bot, eat: { food: FOOD, below: 40 }, log: true });
        out.travel = { ok: r.ok, ticks: r.ticks, ...(r.reason ? { reason: r.reason } : {}) };
        say('travel', out.travel as Record<string, unknown>);
        if (!r.ok || !within(session.sdk, hopsDestination(TO_CELLAR)!)) throw new Error(`travel to the cellar: ${r.reason ?? 'not arrived'}`);
    }

    // From the cellar the run starts at A (the kit check; the walk would skip it); from the arena or
    // the chamber (a relaunch) the resume walk picks the segment.
    const keepSharks = invCount(state(session), /^shark$/i);
    const q = await runDemoQuest(session, { module: mageArena, opts: { spell: SPELL, keepSharks }, ...(mageArena.inCellar(state(session)) ? { from: 'A' } : {}), log });
    setRows(q.rows);
    out.arena = { start: q.start, finished: q.finished, ...(q.error ? { error: q.error } : {}) };
    say('arena', out.arena as Record<string, unknown>);
    if (q.error || !q.finished) throw new Error(`mage arena: ${q.error ?? 'not finished'}`);

    const t = await teleport(session.sdk, TELEPORT_OUT, { bot: session.bot });
    out.teleport = { ok: t.ok, ticks: t.ticks, at: pos(session.sdk), ...(t.reason ? { reason: t.reason } : {}) };
    say('teleport', out.teleport as Record<string, unknown>);
    if (!t.ok) throw new Error(`teleport out: ${t.reason ?? 'failed'}`);
}

export interface ProbeResult {
    plan: number[];
    rows: ProbeTickRow[];
    before: { blood: number; air: number; magicXp: number; magic: number };
    after: { blood: number; air: number; magicXp: number; magic: number };
    landed: number;
    messages: string[];
}

/** Send the plan's clicks, each tick's batch at the start of a fresh tick, and sample every tick through the settle. */
export async function chargeProbe(sdk: Session['sdk'], plan: readonly number[], settleTicks = 6): Promise<ProbeResult> {
    const blood = (s: BotWorldState) => invCount(s, /^blood rune$/i);
    const air = (s: BotWorldState) => invCount(s, /^air rune$/i);
    const sample = (s: BotWorldState, since: number): ProbeSample => ({
        tick: s.tick, blood: blood(s), air: air(s), magicXp: skillXp(s, 'magic'),
        messages: s.gameMessages.filter(m => m.tick > since && m.tick <= s.tick).map(m => m.text),
    });
    const samples: ProbeSample[] = [];
    let last = -1;
    const unsub = sdk.onStateUpdate(s => {
        if (s.tick <= last) return;
        samples.push(sample(s, last < 0 ? s.tick - 1 : last));
        last = s.tick;
    });
    const clicksAt = new Map<number, number>();
    try {
        const s0 = await nextTick(sdk);
        const before = { blood: blood(s0), air: air(s0), magicXp: skillXp(s0, 'magic'), magic: skillLevel(s0, 'magic') };
        for (const n of plan) {
            const s = await nextTick(sdk);
            clicksAt.set(s.tick, n);
            for (let i = 0; i < n; i++) void sdk.sendClickComponent(CHARGE_COMPONENT);
        }
        const s1 = await waitTicks(sdk, settleTicks);
        const after = { blood: blood(s1), air: air(s1), magicXp: skillXp(s1, 'magic'), magic: skillLevel(s1, 'magic') };
        const start = samples.findIndex(x => x.tick >= s0.tick);
        const rows = probeRows(samples.slice(Math.max(0, start)), clicksAt);
        return { plan: [...plan], rows, before, after, landed: Math.floor((before.blood - after.blood) / CHARGE_RUNES), messages: rows.flatMap(r => r.messages) };
    } finally {
        unsub();
    }
}

async function main(): Promise<void> {
    const account = botArg();
    checkDemoTarget(loadBotEnv(account), { lab: false, fleetAccount: process.argv.includes('--fleet-account') });
    const deliveries = parseDeliveries(arg('receive', '[]'));
    const minutes = Number(arg('receive-minutes', '40'));
    const plan = probeTicks(Number(arg('casts', String(MAX_CASTS))), Number(arg('burst', '5')));
    const traceEvery = Number(arg('trace', '0'));
    const probeOnly = process.argv.includes('--probe-only');
    const meet = meetAt(arg('meet', 'varrock'));

    const gateway = await startLoopbackGateway(account, 'mac');
    const out: Record<string, unknown> = { account, plan };
    const log = TickLog.open(`mage-arena-charge-${account}`);
    let rows: TickRow[] = [];
    let exit = 1;
    const controller = new AbortController();
    try {
        const session = await openSession(account, { launch: true, readyTimeoutMs: 180_000 });
        const untrace = traceEvery > 0 ? trace(session.sdk, traceEvery) : () => undefined;
        let prev: BotWorldState | null = null;
        const attacks: unknown[] = [];
        const unwatch = session.sdk.onStateUpdate(s => {
            const a = prev ? attackSeen(prev, s) : null;
            if (a) {
                attacks.push(a);
                say('ATTACK', a);
            }
            prev = s;
        });
        const buyer = new Buyer(roleContext(session, controller.signal));
        const traveller: Traveller = { bot: session.bot, sdk: session.sdk, log: (m, d) => say(m, d), checkSignal: () => controller.signal.throwIfAborted() };
        try {
            const s0 = state(session);
            out.start = { at: [s0.player!.worldX, s0.player!.worldZ, s0.player!.level], prayer: prayerLevel(s0), magic: skillLevel(s0, 'magic'), hp: s0.player!.hp };
            say('start', out.start as Record<string, unknown>);
            if (!probeOnly) await toChargeTile(session, buyer, traveller, deliveries, minutes, meet, log, out, r => (rows = r));

            const probe = await chargeProbe(session.sdk, plan);
            out.probe = probe;
            say('probe', { landed: probe.landed, before: probe.before, after: probe.after });
            for (const r of probe.rows) say('probe tick', { ...r });
            out.attacks = attacks;
            exit = 0;
        } catch (e) {
            out.error = e instanceof Error ? e.message : String(e);
            say('ERROR', { error: out.error });
        } finally {
            unwatch();
            untrace();
            const s1 = session.sdk.getState();
            out.end = { at: [s1?.player?.worldX, s1?.player?.worldZ, s1?.player?.level], hp: s1?.player?.hp, prayer: prayerLevel(s1 ?? null), magicXp: s1 ? skillXp(s1, 'magic') : null };
            try {
                const lo = await confirmedLogout(session);
                out.logout = { ok: true, confirmedBy: lo.confirmedBy, latencyTicks: lo.latencyTicks };
            } catch (e) {
                out.logout = { ok: false, reason: e instanceof Error ? e.message : String(e) };
                exit = 2;
            }
            await closeSession(session);
        }
    } finally {
        gateway.kill('SIGTERM');
    }
    if (rows.length) console.log(`\n${formatDemoTable(rows)}\n`);
    result('mage_arena_charge', out);
    process.exit(exit);
}

if (import.meta.main) await main();
