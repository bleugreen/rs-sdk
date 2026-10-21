// Loc changes on bridged tiles must land where the static index keys them.
//
// ClientBuild.finishBuild pushes every tile whose level-1 mapl has LinkBelow
// down a level (World.pushDown), so on a bridge, pier or platform the browser's
// level-0 scene holds the locs the map files put on level 1. The LocIndex keeps
// raw map levels, so SceneLite has to translate. When it did not, a door the
// server opened on a bridged floor was recorded at map level 0, which the
// CollisionBuilder's bridge shift sends to level -1 and drops, while the static
// closed door at map level 1 stayed in collision: the router never saw the door
// open ("I can't reach that!"), and locSceneInfo could not find the door at all.
//
// Needs no network: the loc index, LocType and the interface baseline are stubbed.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import './dom-shim.js';

import LocType from '#/config/LocType.js';
import CollisionMap from '#/dash3d/CollisionMap.js';
import { LocAngle } from '#/dash3d/LocAngle.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { LocShape } from '#/dash3d/LocShape.js';
import { MapFlag } from '#/dash3d/MapFlag.js';
import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import { LiteClient } from './LiteClient.js';
import { dispatch } from './protocol/incoming.js';
import { zonePacket } from './protocol/zone.js';

const BASE_X = 3200;
const BASE_Z = 3200;
/** Zone origin in build-area tiles, i.e. what the packet carries. */
const ZONE_X = 48;
const ZONE_Z = 48;

/** The closed door, in build-area tiles, at (2,2) inside the zone. */
const DOOR_X = ZONE_X + 2;
const DOOR_Z = ZONE_Z + 2;
const CLOSED_DOOR = 1533;
const OPEN_DOOR = 1534;

/** Every tile of the zone is bridged, like the fishing platform floor. */
function bridged(worldX: number, worldZ: number): boolean {
    const x = worldX - BASE_X - ZONE_X;
    const z = worldZ - BASE_Z - ZONE_Z;
    return x >= 0 && z >= 0 && x < 8 && z < 8;
}

const index = {
    mapFlags(level: number, worldX: number, worldZ: number): number {
        return level === 1 && bridged(worldX, worldZ) ? MapFlag.LinkBelow : 0;
    },
    // The map files put the closed door on level 1, as they do for any loc on
    // a bridged floor.
    lookup(layer: LocLayer, level: number, worldX: number, worldZ: number): number {
        if (layer === LocLayer.WALL && level === 1 && worldX === BASE_X + DOOR_X && worldZ === BASE_Z + DOOR_Z) {
            return (CLOSED_DOOR << 7) | (LocShape.WALL_STRAIGHT << 2) | LocAngle.WEST;
        }
        return 0;
    }
};

function makeClient(name: string): LiteClient {
    const c = new LiteClient({
        connection: { out: Packet.alloc(1), isClosed: false } as never,
        locIndex: index as never,
        username: name,
        password: 'x'
    });
    c.mapBuildBaseX = BASE_X;
    c.mapBuildBaseZ = BASE_Z;
    c.world.setBase(BASE_X, BASE_Z);
    c.minusedlevel = 0;
    return c;
}

/** One zone-packet body: the 3-bit-each position byte, then the payload. */
function zoneOp(dx: number, dz: number, write: (buf: Packet) => void): Packet {
    const buf = Packet.alloc(1);
    buf.p1((dx << 4) | dz);
    write(buf);
    buf.pos = 0;
    return buf;
}

/** What the server sends to open the door: delete it, add the swung-open leaf beside it. */
function openDoor(c: LiteClient): void {
    c.zoneUpdateX = ZONE_X;
    c.zoneUpdateZ = ZONE_Z;
    zonePacket(c, zoneOp(2, 2, b => b.p1((LocShape.WALL_STRAIGHT << 2) | LocAngle.WEST)), ServerProt.LOC_DEL);
    zonePacket(
        c,
        zoneOp(1, 2, b => {
            b.p1((LocShape.WALL_STRAIGHT << 2) | LocAngle.NORTH);
            b.p2(OPEN_DOOR);
        }),
        ServerProt.LOC_ADD_CHANGE
    );
}

function routingCollision(c: LiteClient): CollisionMap {
    c.world.collisionDirty = true;
    c.ensureCollision();
    return c.collision[0]!;
}

/** Level-0 collision with exactly the given walls, built by CollisionMap itself. */
function expectedCollision(walls: Array<[number, number, LocAngle]>): CollisionMap {
    const map = new CollisionMap();
    map.reset();
    for (const [x, z, angle] of walls) {
        map.addWall(x, z, LocShape.WALL_STRAIGHT, angle, true);
    }
    return map;
}

function differingTiles(actual: CollisionMap, expected: CollisionMap): number {
    let n = 0;
    for (let i = 0; i < expected.flags.length; i++) {
        if (actual.flags[i] !== expected.flags[i]) {
            n++;
        }
    }
    return n;
}

const originalLocList = LocType.list;

useStubBaseline();

beforeAll(() => {
    // Every loc in these tests is a 1x1 door that blocks walking.
    (LocType as unknown as { list: (id: number) => LocType }).list = (id: number) =>
        ({ id, blockwalk: true, blockrange: true, active: true, width: 1, length: 1, forceapproach: 0 }) as LocType;
});

afterAll(() => {
    (LocType as unknown as { list: typeof originalLocList }).list = originalLocList;
});

describe('loc changes on bridged tiles', () => {
    test('a bridged loc is visible at the player level and routes as closed', () => {
        const c = makeClient('bridge1');

        expect((c.world.wallType(0, DOOR_X, DOOR_Z) >> 14) & 0x7fff).toBe(CLOSED_DOOR);
        expect(c.locSceneInfo(DOOR_X, DOOR_Z, CLOSED_DOOR)).toEqual({ shape: LocShape.WALL_STRAIGHT, angle: LocAngle.WEST });
        expect(differingTiles(routingCollision(c), expectedCollision([[DOOR_X, DOOR_Z, LocAngle.WEST]]))).toBe(0);
    });

    test('a door the server opens on a bridged floor opens for routing', () => {
        const c = makeClient('bridge2');
        openDoor(c);

        // The closed leaf is gone from both the scene and the router; the open
        // leaf is in both.
        expect(c.locSceneInfo(DOOR_X, DOOR_Z, CLOSED_DOOR)).toBeNull();
        expect(c.locSceneInfo(DOOR_X - 1, DOOR_Z, OPEN_DOOR)).toEqual({ shape: LocShape.WALL_STRAIGHT, angle: LocAngle.NORTH });
        expect(differingTiles(routingCollision(c), expectedCollision([[DOOR_X - 1, DOOR_Z, LocAngle.NORTH]]))).toBe(0);
    });

    test('a zone reset on a bridged floor closes the door again', () => {
        const c = makeClient('bridge3');
        openDoor(c);
        expect(c.world.overlayEntries.size).toBe(2);

        const buf = Packet.alloc(1);
        buf.p1(ZONE_X);
        buf.p1(ZONE_Z);
        buf.pos = 0;
        dispatch(c, ServerProt.UPDATE_ZONE_FULL_FOLLOWS, buf, 2);

        expect(c.world.overlayEntries.size).toBe(0);
        expect(c.locSceneInfo(DOOR_X, DOOR_Z, CLOSED_DOOR)).toEqual({ shape: LocShape.WALL_STRAIGHT, angle: LocAngle.WEST });
        expect(differingTiles(routingCollision(c), expectedCollision([[DOOR_X, DOOR_Z, LocAngle.WEST]]))).toBe(0);
    });
});
