// Waterfall Quest, end to end, as tick-stamped segments (docs/speedrun/quests/waterfall.md).
//
//   bun docs/speedrun/scripts/quest-waterfall-run.ts <bot> [--from 0|1|2|3|4] [--to 4]
//
// Phases (each --from N jumps a lab account to the start of phase N with
// ::setvar waterfall_quest and the untradeable items it would hold):
//   0  Almera, raft to Hudon, swim off the island, Hadley's bookcase, read the book
//   1  walk to Tree Gnome Village, Golrie's dungeon: key, gate, pebble, back up
//   2  walk to Glarial's tombstone, the tomb: amulet and urn, back up
//   3  walk to the raft, raft, rope to the rock and tree, ledge door, key, door
//   4  18 runes on the pillars, amulet on the statue, urn on the chalice
// The account carries nothing but a rope (and, from phase 3, 6 each of air,
// earth and water runes): Glarial's tomb refuses weapons, armour and runes
// (quest_waterfall.rs2:44-100). Runes appear by ::give at phase 3; in a real run
// they are dropped before the tombstone and picked up after, or traded in.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { act, invOp, opLoc, slotOf, talkTo, walkTo } from '../../../speedrun/lib/act';
import { converse, type ConverseOptions } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { settled } from '../../../speedrun/lib/idle';
import type { ItemPattern } from '../../../speedrun/lib/items';
import { waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { at, invCount, pos, type NamePattern } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

function arg(name: string, dflt: string): string {
    const i = process.argv.indexOf('--' + name);
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : dflt;
}

/** True while the player stands inside the inclusive box on `level`. */
function inBox(s: BotWorldState, x0: number, z0: number, x1: number, z1: number, level = 0): boolean {
    const p = s.player;
    return !!p && p.level === level && p.worldX >= x0 && p.worldX <= x1 && p.worldZ >= z0 && p.worldZ <= z1;
}

const FROM = Number(arg('from', '0'));
const TO = Number(arg('to', '4'));

// loc ids from server/content/pack/loc.pack; tiles from the maps
const RAFT = 1987, BOOKCASE = 1989, GOLRIE_CRATE = 1990, GOLRIE_GATE = 1991, TOMBSTONE = 1992, TOMB = 1993,
    CHEST_SHUT = 1994, CHEST_OPEN = 1995, ROCK = 1996, BAX_CRATE = 1999, BAX_DOOR2 = 2002, PILLAR = 2004,
    STATUE_QUEEN = 2006, LEDGE_DOOR = 2010, CHALICE = 2014, TREE = 2020;
const PILLARS: [number, number][] = [[2562, 9910], [2562, 9912], [2562, 9914], [2569, 9910], [2569, 9912], [2569, 9914]];
const RUNES = ['airrune', 'earthrune', 'waterrune'];

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const rec = new Recorder(sdk, `Waterfall Quest (from ${FROM} to ${TO})`);
    const stage = async () => `stage ${await getvar(sdk, 'waterfall_quest')}`;
    const walk = async (x: number, z: number, tol: number) => {
        const r = await walkTo(bot, sdk, x, z, tol);
        if (!r.ok) throw new Error(`walk to ${x},${z} failed: ${r.message}`);
    };
    const talk = async (npc: NamePattern, choices: OptionPattern[] = [], until?: Pred) => {
        const r = await talkTo(sdk, npc, choices, until ? { until } : {});
        rec.interact(r.clicks);
        if (!r.opened) throw new Error(`no dialogue opened for ${String(npc)}`);
        if (!r.ok) throw new Error(`dialogue with ${String(npc)}: ${r.reason}`);
        rec.dialogue(r);
    };
    const drive = async (opts: ConverseOptions) => {
        const r = await converse(sdk, [], opts);
        if (!r.ok) throw new Error(`dialogue did not finish: ${r.reason}; at ${JSON.stringify(pos(sdk))}`);
        rec.dialogue(r);
    };
    /** Op 1 on the loc `id` at (x, z), waiting up to `maxTicks` for `done`. */
    const loc = async (id: number, x: number, z: number, done: Pred, maxTicks: number) => {
        rec.interact();
        return opLoc(sdk, { id, x, z }, 1, done, { maxTicks });
    };
    /** The loc at (x, z) offering `op` (ladders, stairs). */
    const climb = async (x: number, z: number, op: RegExp, done: Pred) => {
        rec.interact();
        return opLoc(sdk, { x, z, op }, op, done, { maxTicks: 20 });
    };
    /** Use an inventory item on the loc `id` at (x, z), waiting up to `maxTicks` for `done`. */
    const use = async (item: ItemPattern, id: number, x: number, z: number, done: Pred, maxTicks: number) => {
        const slot = slotOf(sdk, item);
        rec.interact();
        return act(sdk, () => sdk.sendUseItemOnLoc(slot, x, z, id), done, { maxTicks });
    };
    const must = (r: { ok: boolean }, what: string) => {
        if (!r.ok) throw new Error(`${what}; at ${JSON.stringify(pos(sdk))}`);
    };
    const settle = (still: number, maxTicks: number) => waitUntil(sdk, settled(still), { maxTicks });

    await clearInventory(sdk);
    await setStats(sdk, { hitpoints: 40 });
    await give(sdk, 'rope', 1);

    if (FROM === 0) {
        await setvar(sdk, 'waterfall_quest', 0);
        await setvar(sdk, 'pillar_waterfall_quest', 0);
        await mustTele(sdk, 2522, 3496);
        await rec.seg('Almera: start', async () => {
            await talk(/almera/i, ['How can I help?']);
            return stage();
        }, 'dialogue');
        await rec.seg('walk to raft (2509,3493)', () => walk(2510, 3493, 1), 'travel');
        await rec.seg('raft to the island + forced Hudon dialogue', async () => {
            await loc(RAFT, 2509, 3493, s => s.dialog.isOpen, 30);
            await drive({ maxTicks: 200, until: s => inBox(s, 2510, 3476, 2514, 3485) });
            return stage();
        }, 'mixed');
        await rec.seg('swim for the rock: washed to (2527,3413)', async () => {
            await walk(2512, 3476, 0);
            must(await loc(ROCK, 2512, 3468, at(2527, 3413), 40), 'never washed to 2527,3413');
        }, 'wait');
        await rec.seg('walk to Hadley\'s stairs (2517,3429)', () => walk(2517, 3428, 1), 'travel');
        await rec.seg('stairs up, search bookcase, read book, stairs down', async () => {
            await climb(2517, 3429, /climb-up/i, s => s.player?.level === 1);
            await loc(BOOKCASE, 2520, 3426, s => invCount(s, /book on baxtorian/i) > 0, 20);
            rec.interact();
            await invOp(sdk, /book on baxtorian/i, /^read$/i, s => s.modalOpen || !!s.interface?.isOpen, { maxTicks: 6 });
            await sdk.sendCloseModal().catch(() => {}); rec.interact();
            await climb(2518, 3430, /climb-down/i, s => s.player?.level === 0);
            return stage();
        }, 'interaction');
    }
    if (FROM <= 1 && TO >= 1) {
        if (FROM === 1) { await setvar(sdk, 'waterfall_quest', 3); await mustTele(sdk, 2517, 3428); }
        await rec.seg('walk Hemenster to Tree Gnome Village cellar ladder (2533,3155)', () => walk(2533, 3156, 1), 'travel');
        await rec.seg('ladder down into Golrie\'s dungeon', async () => {
            await climb(2533, 3155, /climb-down/i, s => (s.player?.worldZ ?? 0) > 6000);
        }, 'interaction');
        await rec.seg('walk to crate (2548,9565)', () => walk(2548, 9566, 1), 'travel');
        await rec.seg('search crate: key', async () => {
            await loc(GOLRIE_CRATE, 2548, 9565, s => invCount(s, /key/i) > 0, 20);
        }, 'interaction');
        await rec.seg('walk to Golrie\'s gate (2515,9575)', () => walk(2515, 9574, 0), 'travel');
        await rec.seg('key on gate, walk through', async () => {
            await use(/key/i, GOLRIE_GATE, 2515, 9575, s => (s.player?.worldZ ?? 0) >= 9576, 20);
        }, 'interaction');
        await rec.seg('Golrie: pebble', async () => {
            await talk(/golrie/i, [], s => invCount(s, /pebble/i) > 0);
            await drive({ idle: 4, openTicks: 4 });
            return `pebble=${invCount(sdk, /pebble/i)}`;
        }, 'dialogue');
        await rec.seg('walk to the gate, open it from inside', async () => {
            await walk(2515, 9576, 0);
            await loc(GOLRIE_GATE, 2515, 9575, s => (s.player?.worldZ ?? 9999) <= 9575, 15);
        }, 'interaction');
        await rec.seg('walk to ladder (2533,9555)', () => walk(2533, 9556, 1), 'travel');
        await rec.seg('ladder up', async () => {
            await climb(2533, 9555, /climb-up/i, s => (s.player?.worldZ ?? 9999) < 6000);
        }, 'interaction');
    }
    if (FROM <= 2 && TO >= 2) {
        if (FROM === 2) { await setvar(sdk, 'waterfall_quest', 3); await give(sdk, 'glarials_pebble_waterfall_quest', 1); await mustTele(sdk, 2533, 3156); }
        await rec.seg('walk Tree Gnome Village to Glarial\'s tombstone (2558,3444)', () => walk(2558, 3443, 1), 'travel');
        await rec.seg('pebble on tombstone: into the tomb', async () => {
            must(await use(/pebble/i, TOMBSTONE, 2558, 3444, at(2554, 9844), 30), 'never reached 2554,9844');
            return stage();
        }, 'wait');
        await rec.seg('walk to chest (2530,9844)', () => walk(2531, 9844, 1), 'travel');
        await rec.seg('open + search chest: amulet', async () => {
            await loc(CHEST_SHUT, 2530, 9844, s => s.nearbyLocs.some(l => l.id === CHEST_OPEN && l.x === 2530 && l.z === 9844), 20);
            await loc(CHEST_OPEN, 2530, 9844, s => invCount(s, /amulet/i) > 0, 20);
        }, 'interaction');
        await rec.seg('walk to Glarial\'s tomb (2542,9811)', () => walk(2542, 9812, 1), 'travel');
        await rec.seg('search tomb: urn', async () => {
            await loc(TOMB, 2542, 9811, s => invCount(s, /urn/i) > 0, 20);
            await settle(1, 10);
        }, 'interaction');
        await rec.seg('walk to ladder (2556,9844)', () => walk(2555, 9844, 1), 'travel');
        await rec.seg('ladder up', async () => {
            await climb(2556, 9844, /climb-up/i, s => (s.player?.worldZ ?? 9999) < 6000);
            return `at ${JSON.stringify(pos(sdk))}`;
        }, 'interaction');
    }
    if (FROM <= 3 && TO >= 3) {
        if (FROM === 3) {
            await setvar(sdk, 'waterfall_quest', 4);
            await give(sdk, ['glarials_amulet_waterfall_quest', 'glarials_urn_full_waterfall_quest'], 1);
            await mustTele(sdk, 2558, 3443);
        }
        await give(sdk, RUNES, 6);
        await rec.seg('walk tombstone to raft (2509,3493)', () => walk(2510, 3493, 1), 'travel');
        await rec.seg('raft to the island', async () => {
            await loc(RAFT, 2509, 3493, s => inBox(s, 2510, 3476, 2514, 3485), 30);
            await settle(1, 20);
        }, 'wait');
        await rec.seg('rope on rock: wade to the rock', async () => {
            await walk(2512, 3476, 0);
            await use(/^rope$/i, ROCK, 2512, 3468, s => (s.player?.worldZ ?? 9999) <= 3469, 30);
            await settle(1, 20);
            return `at ${JSON.stringify(pos(sdk))}`;
        }, 'interaction');
        await rec.seg('rope on tree: down to the ledge', async () => {
            must(await use(/^rope$/i, TREE, 2512, 3465, at(2511, 3463), 20), 'never reached 2511,3463');
        }, 'interaction');
        await rec.seg('ledge door (amulet held): into the falls', async () => {
            must(await loc(LEDGE_DOOR, 2511, 3464, at(2575, 9861), 20), 'never reached 2575,9861');
            return stage();
        }, 'wait');
        await rec.seg('walk to crate (2589,9888)', () => walk(2589, 9887, 1), 'travel');
        await rec.seg('search crate: key', async () => {
            await loc(BAX_CRATE, 2589, 9888, s => invCount(s, /key/i) > 0, 20);
        }, 'interaction');
        await rec.seg('walk to corridor door (2568,9893)', () => walk(2568, 9893, 0), 'travel');
        await rec.seg('key on corridor door, walk through', async () => {
            await use(/key/i, BAX_DOOR2, 2568, 9893, s => (s.player?.worldZ ?? 0) >= 9894, 20);
        }, 'interaction');
        await rec.seg('walk to puzzle-room door (2566,9901)', () => walk(2566, 9901, 0), 'travel');
        await rec.seg('key on door: into the puzzle room', async () => {
            await use(/key/i, BAX_DOOR2, 2566, 9901, s => (s.player?.worldZ ?? 0) >= 9902, 20);
            return stage();
        }, 'interaction');
    }
    if (FROM <= 4 && TO >= 4) {
        if (FROM === 4) {
            await setvar(sdk, 'waterfall_quest', 6);
            await setvar(sdk, 'pillar_waterfall_quest', 0);
            await give(sdk, ['glarials_amulet_waterfall_quest', 'glarials_urn_full_waterfall_quest'], 1);
            await give(sdk, RUNES, 6);
            await mustTele(sdk, 2566, 9902);
        }
        await rec.seg('18 runes on the 6 pillars', async () => {
            for (const [x, z] of PILLARS) {
                for (const rune of [/^air rune$/i, /^earth rune$/i, /^water rune$/i]) {
                    const before = invCount(sdk, rune);
                    must(await use(rune, PILLAR, x, z, s => invCount(s, rune) < before, 20), `rune ${rune} not placed on pillar ${x},${z}`);
                }
            }
            return `pillar bits ${await getvar(sdk, 'pillar_waterfall_quest')}`;
        }, 'interaction');
        await rec.seg('amulet on Glarial\'s statue: raised to the chalice', async () => {
            must(await use(/amulet/i, STATUE_QUEEN, 2565, 9916, at(2603, 9914), 30), 'never reached 2603,9914');
            return stage();
        }, 'interaction');
        await rec.seg('urn on the chalice: reward', async () => {
            await use(/urn/i, CHALICE, 2603, 9910, s => invCount(s, /diamond/i) > 0, 30);
            return stage();
        }, 'interaction');
        const s = sdk.getState()!;
        console.log('final skills', s.skills.filter(k => /attack|strength/i.test(k.name)).map(k => `${k.name} ${k.level} xp=${k.experience}`).join(', '));
    }
    rec.report();
}, { timeout: 60 * 60_000 });
