import { afterEach, describe, expect, test } from 'bun:test';
import { baseState, FakeSdk } from './fake-sdk';
import { minePathfinder, mineWorld } from './fake-underground';
import { travelTo, type Tile, type TollGateSdk } from './toll-gate';
import { climbToSurface, EDGEVILLE_LADDER, GUILD_DOOR, GUILD_LADDER, ICE_LADDER, isUnderground, NO_WAY_UP, surfacePlan, TAVERLEY_LADDER, type SurfaceStep } from './underground';

/** rs/197, 2026-10-22 02:34Z: cairn_h22 at the adamantite rocks, behind the guild door. */
const ADDY_ROCKS = { x: 3039, z: 9766 };
const GUILD_CENTRE = { x: 3042, z: 9740 };
const NURMOF = { x: 2998, z: 9846 };
const TAVERLEY_BABY_BLUES = { x: 2901, z: 9765 };
/** rs/331, 2026-10-22 13:04Z: cairn_h85 at the Taverley chaos druids, 'no known way up'. */
const TAVERLEY_DRUIDS = { x: 2936, z: 9847 };
/** The dragons role's safe tile, behind the dusty key door. */
const TAVERLEY_SAFE_TILE = { x: 2901, z: 9810 };
/** Taverley's strip east of x 2959, inside the Dwarven Mine's box but not part of the mine. */
const TAVERLEY_EAST_STRIP = { x: 2965, z: 9785 };
/** cairn_h45 at the Edgeville dungeon chaos druids, 2026-10-22 (Wilderness 1-3). */
const EDGEVILLE_DRUIDS = { x: 3110, z: 9931 };
/** The Varrock sewers: a dungeon this module does not know. */
const VARROCK_SEWERS = { x: 3237, z: 9866 };
const FALADOR_WEST_BANK = { x: 2946, z: 3368 };
const VARROCK_WEST = { x: 3185, z: 3436 };
const FALADOR_EAST_BANK = { x: 3013, z: 3357 };

const up = (l: typeof GUILD_LADDER): SurfaceStep[] => [{ kind: 'walk', to: l.stand, tol: 2 }, { kind: 'climb', ladder: l }];

describe('surfacePlan', () => {
    test('from the adamantite rocks (3039,9766) with Mining 60: through the guild door, then the cellar ladder', () => {
        expect(surfacePlan(ADDY_ROCKS, 85)).toEqual([{ kind: 'walk', to: GUILD_DOOR.mineSide, tol: 1 }, { kind: 'door' }, ...up(GUILD_LADDER)]);
    });

    test('in the guild cellar, the door tile included: the cellar ladder only', () => {
        expect(surfacePlan(GUILD_CENTRE, 85)).toEqual(up(GUILD_LADDER));
        expect(surfacePlan(GUILD_DOOR.at, 85)).toEqual(up(GUILD_LADDER));
    });

    test('the door needs Mining 60: below it, the mine is left by the Ice Mountain ladder', () => {
        expect(surfacePlan(ADDY_ROCKS, 59)).toEqual(up(ICE_LADDER));
    });

    test('the north mine (Nurmof) uses the Ice Mountain ladder, whatever the Mining level', () => {
        expect(surfacePlan(NURMOF, 99)).toEqual(up(ICE_LADDER));
        expect(surfacePlan(NURMOF, 1)).toEqual(up(ICE_LADDER));
    });

    test('on the surface there is nothing to do; an unknown dungeon has no plan', () => {
        expect(surfacePlan(VARROCK_WEST, 1)).toEqual([]);
        expect(surfacePlan(VARROCK_SEWERS, 99)).toBeNull();
    });

    test('the Edgeville dungeon (the chaos druids in the Wilderness part): its ladder up beside the trapdoor', () => {
        expect(surfacePlan(EDGEVILLE_DRUIDS, 1)).toEqual(up(EDGEVILLE_LADDER));
    });

    test('Taverley Dungeon (druids, baby blues, the dragon room, the strip beside the mine): its ladder', () => {
        for (const t of [TAVERLEY_DRUIDS, TAVERLEY_BABY_BLUES, TAVERLEY_SAFE_TILE, TAVERLEY_EAST_STRIP]) expect(surfacePlan(t, 1)).toEqual(up(TAVERLEY_LADDER));
    });
});

let ticker: ReturnType<typeof setInterval> | null = null;
afterEach(() => {
    if (ticker) clearInterval(ticker);
    ticker = null;
});

function world(at: Tile, mining: number) {
    const fake = new FakeSdk(baseState({ player: { worldX: at.x, worldZ: at.z, hp: 10, maxHp: 10 } as never }));
    const { climbs } = mineWorld(fake, mining);
    const { bot, calls } = minePathfinder(fake);
    ticker = setInterval(() => fake.tick(), 1);
    const pos = () => ({ x: fake.state!.player!.worldX, z: fake.state!.player!.worldZ });
    return { fake, sdk: fake as unknown as TollGateSdk, bot, calls, climbs, pos };
}

describe('climbToSurface', () => {
    test('from the adamantite rocks: walks to the door, opens it, walks to the ladder, climbs into the guild', async () => {
        const w = world(ADDY_ROCKS, 85);
        expect(await climbToSurface(w.bot, w.sdk)).toEqual({ ok: true });
        expect(w.calls.map(c => c.to)).toEqual([[GUILD_DOOR.mineSide.x, GUILD_DOOR.mineSide.z], [GUILD_LADDER.stand.x, GUILD_LADDER.stand.z]]);
        expect(w.fake.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args[2])).toEqual([GUILD_DOOR.id, GUILD_LADDER.id]);
        expect(w.pos()).toEqual({ x: GUILD_LADDER.stand.x, z: GUILD_LADDER.stand.z - 6400 });
    });

    test('the door refuses (Mining drained below 60 since the plan): reports it and closes the message', async () => {
        const w = world(ADDY_ROCKS, 59);
        // The plan is read from the state; force the door route to meet the refusal.
        w.fake.push(s => ({ skills: s.skills.map(k => ({ ...k, level: 60 })) }));
        const r = await climbToSurface(w.bot, w.sdk);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('guild door');
        expect(w.fake.state!.dialog.isOpen).toBe(false);
        expect(isUnderground(w.pos())).toBe(true);
    });

    test('an unknown dungeon: fails at once without a walk', async () => {
        const w = world(VARROCK_SEWERS, 99);
        const r = await climbToSurface(w.bot, w.sdk);
        expect(r).toEqual({ ok: false, reason: `${NO_WAY_UP} from (3237, 9866)` });
        expect(w.calls).toEqual([]);
    });

    test('from the Edgeville druids: walks to the ladder and climbs out beside Edgeville bank', async () => {
        const w = world(EDGEVILLE_DRUIDS, 1);
        expect(await climbToSurface(w.bot, w.sdk)).toEqual({ ok: true });
        expect(w.climbs).toEqual([EDGEVILLE_LADDER.at]);
        expect(w.pos()).toEqual({ x: EDGEVILLE_LADDER.stand.x, z: EDGEVILLE_LADDER.stand.z - 6400 });
    });

    test('rs/331: from the Taverley chaos druids, walks to the ladder and climbs out beside Taverley', async () => {
        const w = world(TAVERLEY_DRUIDS, 1);
        expect(await climbToSurface(w.bot, w.sdk)).toEqual({ ok: true });
        expect(w.calls.map(c => c.to)).toEqual([[TAVERLEY_LADDER.stand.x, TAVERLEY_LADDER.stand.z]]);
        expect(w.climbs).toEqual([TAVERLEY_LADDER.at]);
        expect(w.pos()).toEqual({ x: TAVERLEY_LADDER.stand.x, z: TAVERLEY_LADDER.stand.z - 6400 });
    });
});

describe('travelTo from underground', () => {
    test('rs/197: from the adamantite rocks to Varrock west, it climbs out first and never asks for a surface tile underground', async () => {
        const w = world(ADDY_ROCKS, 85);
        const r = await travelTo(w.bot, w.sdk, VARROCK_WEST);
        expect(r).toEqual({ ok: true, paid: 0 });
        expect(w.pos()).toEqual(VARROCK_WEST);
        expect(w.calls.filter(c => c.underground).every(c => isUnderground({ x: c.to[0], z: c.to[1] }))).toBe(true);
        expect(w.calls.at(-1)).toEqual({ to: [VARROCK_WEST.x, VARROCK_WEST.z], underground: false });
    });

    test('without the climb, the same walk ends in the guild cellar, as it did live', async () => {
        const w = world(ADDY_ROCKS, 85);
        const r = await w.bot.walkTo(VARROCK_WEST.x, VARROCK_WEST.z);
        expect(r.success).toBe(false);
        expect(w.pos()).toEqual({ x: 3047, z: 9732 });
    });

    test('from the north mine to Falador east bank: the Ice Mountain ladder, then the walk', async () => {
        const w = world(NURMOF, 99);
        const r = await travelTo(w.bot, w.sdk, FALADOR_EAST_BANK);
        expect(r).toEqual({ ok: true, paid: 0 });
        expect(w.calls.map(c => c.to)).toEqual([[ICE_LADDER.stand.x, ICE_LADDER.stand.z], [FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z]]);
        expect(w.climbs).toEqual([ICE_LADDER.at]);
    });

    test('an unknown dungeon fails with the reason, before any walk', async () => {
        const w = world(VARROCK_SEWERS, 99);
        const r = await travelTo(w.bot, w.sdk, VARROCK_WEST);
        expect(r).toEqual({ ok: false, paid: 0, reason: `${NO_WAY_UP} from (3237, 9866)` });
        expect(w.calls).toEqual([]);
    });

    test('rs/331: from the Taverley druids to Falador west bank (an H21e handover): the ladder, then the walk', async () => {
        const w = world(TAVERLEY_DRUIDS, 1);
        const r = await travelTo(w.bot, w.sdk, FALADOR_WEST_BANK);
        expect(r).toEqual({ ok: true, paid: 0 });
        expect(w.calls.map(c => c.to)).toEqual([[TAVERLEY_LADDER.stand.x, TAVERLEY_LADDER.stand.z], [FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z]]);
        expect(w.pos()).toEqual(FALADOR_WEST_BANK);
    });
});
