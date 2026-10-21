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
import {
    arg, cheat, driveDialog, getvar, inBox, invCount, invSlot, opLoc, opLocText, pos, Recorder, settle, setup, talk, tele, useOnLoc, waitAt, waitNear, waitTicksFor, walk,
} from './quest-lib';

const FROM = Number(arg('from', '0'));
const TO = Number(arg('to', '4'));

// loc ids from server/content/pack/loc.pack; tiles from the maps
const RAFT = 1987, BOOKCASE = 1989, GOLRIE_CRATE = 1990, GOLRIE_GATE = 1991, TOMBSTONE = 1992, TOMB = 1993,
    CHEST_SHUT = 1994, CHEST_OPEN = 1995, ROCK = 1996, BAX_CRATE = 1999, BAX_DOOR2 = 2002, PILLAR = 2004,
    STATUE_QUEEN = 2006, LEDGE_DOOR = 2010, CHALICE = 2014, TREE = 2020;
const PILLARS: [number, number][] = [[2562, 9910], [2562, 9912], [2562, 9914], [2569, 9910], [2569, 9912], [2569, 9914]];

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const rec = new Recorder(sdk, `Waterfall Quest (from ${FROM} to ${TO})`);
    const stage = async () => `stage ${await getvar(sdk, 'waterfall_quest')}`;
    await setup(sdk, { stats: { hitpoints: 40 }, give: [['rope', 1]] });

    if (FROM === 0) {
        await cheat(sdk, 'setvar waterfall_quest 0');
        await tele(sdk, 2522, 3496);
        await rec.seg('Almera: start', 'dialogue', async c => {
            await talk(sdk, c, /almera/i, ['How can I help?']);
            return stage();
        });
        await rec.seg('walk to raft (2509,3493)', 'travel', async c => {
            await walk(bot, sdk, c, 2510, 3493, 1);
        });
        await rec.seg('raft to the island + forced Hudon dialogue', 'mixed', async c => {
            await opLoc(sdk, c, RAFT, 2509, 3493, 1);
            await waitTicksFor(sdk, s => !!s.dialog?.isOpen, 30);
            await driveDialog(sdk, c, [], 3, 200, s => inBox(s, 2510, 3476, 2514, 3485));
            return stage();
        });
        await rec.seg('swim for the rock: washed to (2527,3413)', 'wait', async c => {
            await walk(bot, sdk, c, 2512, 3476, 0);
            await opLoc(sdk, c, ROCK, 2512, 3468, 1);
            await waitAt(sdk, 2527, 3413, 0, 40);
        });
        await rec.seg('walk to Hadley\'s stairs (2517,3429)', 'travel', async c => {
            await walk(bot, sdk, c, 2517, 3428, 1);
        });
        await rec.seg('stairs up, search bookcase, read book, stairs down', 'interaction', async c => {
            await opLocText(sdk, c, 2517, 3429, /climb-up/i);
            await waitTicksFor(sdk, s => s.player?.level === 1, 20);
            await opLoc(sdk, c, BOOKCASE, 2520, 3426, 1);
            await waitTicksFor(sdk, () => invCount(sdk, /book on baxtorian/i) > 0, 20);
            await sdk.sendUseItem(invSlot(sdk, /book on baxtorian/i), 1); c.interactions++;
            await waitTicksFor(sdk, s => s.modalOpen || !!s.interface?.isOpen, 6);
            await sdk.sendCloseModal().catch(() => {}); c.interactions++;
            await opLocText(sdk, c, 2518, 3430, /climb-down/i);
            await waitTicksFor(sdk, s => s.player?.level === 0, 20);
            return stage();
        });
    }
    if (FROM <= 1 && TO >= 1) {
        if (FROM === 1) { await cheat(sdk, 'setvar waterfall_quest 3'); await tele(sdk, 2517, 3428); }
        await rec.seg('walk Hemenster to Tree Gnome Village cellar ladder (2533,3155)', 'travel', async c => {
            await walk(bot, sdk, c, 2533, 3156, 1);
        });
        await rec.seg('ladder down into Golrie\'s dungeon', 'interaction', async c => {
            await opLocText(sdk, c, 2533, 3155, /climb-down/i);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 0) > 6000, 20);
        });
        await rec.seg('walk to crate (2548,9565)', 'travel', async c => {
            await walk(bot, sdk, c, 2548, 9566, 1);
        });
        await rec.seg('search crate: key', 'interaction', async c => {
            await opLoc(sdk, c, GOLRIE_CRATE, 2548, 9565, 1);
            await waitTicksFor(sdk, () => invCount(sdk, /key/i) > 0, 20);
        });
        await rec.seg('walk to Golrie\'s gate (2515,9575)', 'travel', async c => {
            await walk(bot, sdk, c, 2515, 9574, 0);
        });
        await rec.seg('key on gate, walk through', 'interaction', async c => {
            await useOnLoc(sdk, c, /key/i, GOLRIE_GATE, 2515, 9575);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 0) >= 9576, 20);
        });
        await rec.seg('Golrie: pebble', 'dialogue', async c => {
            await talk(sdk, c, /golrie/i);
            return `pebble=${invCount(sdk, /pebble/i)}`;
        });
        await rec.seg('gate out, walk to ladder (2533,9555)', 'travel', async c => {
            await walk(bot, sdk, c, 2533, 9556, 1);
        });
        await rec.seg('ladder up', 'interaction', async c => {
            await opLocText(sdk, c, 2533, 9555, /climb-up/i);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 9999) < 6000, 20);
        });
    }
    if (FROM <= 2 && TO >= 2) {
        if (FROM === 2) { await cheat(sdk, 'setvar waterfall_quest 3'); await cheat(sdk, 'give glarials_pebble_waterfall_quest 1'); await tele(sdk, 2533, 3156); }
        await rec.seg('walk Tree Gnome Village to Glarial\'s tombstone (2558,3444)', 'travel', async c => {
            await walk(bot, sdk, c, 2558, 3443, 1);
        });
        await rec.seg('pebble on tombstone: into the tomb', 'wait', async c => {
            await useOnLoc(sdk, c, /pebble/i, TOMBSTONE, 2558, 3444);
            await waitAt(sdk, 2554, 9844, 0, 30);
            return stage();
        });
        await rec.seg('walk to chest (2530,9844)', 'travel', async c => {
            await walk(bot, sdk, c, 2531, 9844, 1);
        });
        await rec.seg('open + search chest: amulet', 'interaction', async c => {
            await opLoc(sdk, c, CHEST_SHUT, 2530, 9844, 1);
            await waitTicksFor(sdk, () => !!sdk.getNearbyLocs().find(l => l.id === CHEST_OPEN && l.x === 2530 && l.z === 9844), 20);
            await opLoc(sdk, c, CHEST_OPEN, 2530, 9844, 1);
            await waitTicksFor(sdk, () => invCount(sdk, /amulet/i) > 0, 20);
        });
        await rec.seg('walk to Glarial\'s tomb (2542,9811)', 'travel', async c => {
            await walk(bot, sdk, c, 2542, 9812, 1);
        });
        await rec.seg('search tomb: urn', 'interaction', async c => {
            await opLoc(sdk, c, TOMB, 2542, 9811, 1);
            await waitTicksFor(sdk, () => invCount(sdk, /urn/i) > 0, 20);
            await settle(sdk, 1, 10);
        });
        await rec.seg('walk to ladder (2556,9844)', 'travel', async c => {
            await walk(bot, sdk, c, 2555, 9844, 1);
        });
        await rec.seg('ladder up', 'interaction', async c => {
            await opLocText(sdk, c, 2556, 9844, /climb-up/i);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 9999) < 6000, 20);
            return `at ${JSON.stringify(pos(sdk))}`;
        });
    }
    if (FROM <= 3 && TO >= 3) {
        if (FROM === 3) {
            await cheat(sdk, 'setvar waterfall_quest 4');
            await cheat(sdk, 'give glarials_amulet_waterfall_quest 1');
            await cheat(sdk, 'give glarials_urn_full_waterfall_quest 1');
            await tele(sdk, 2558, 3443);
        }
        for (const r of ['airrune', 'earthrune', 'waterrune']) await cheat(sdk, `give ${r} 6`);
        await rec.seg('walk tombstone to raft (2509,3493)', 'travel', async c => {
            await walk(bot, sdk, c, 2510, 3493, 1);
        });
        await rec.seg('raft to the island', 'wait', async c => {
            await opLoc(sdk, c, RAFT, 2509, 3493, 1);
            await waitTicksFor(sdk, s => inBox(s, 2510, 3476, 2514, 3485), 30);
            await settle(sdk, 1, 20);
        });
        await rec.seg('rope on rock: wade to the rock', 'interaction', async c => {
            await walk(bot, sdk, c, 2512, 3476, 0);
            await useOnLoc(sdk, c, /^rope$/i, ROCK, 2512, 3468);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 9999) <= 3469, 30);
            await settle(sdk, 1, 20);
            return `at ${JSON.stringify(pos(sdk))}`;
        });
        await rec.seg('rope on tree: down to the ledge', 'interaction', async c => {
            await useOnLoc(sdk, c, /^rope$/i, TREE, 2512, 3465);
            await waitAt(sdk, 2511, 3463, 0, 20);
        });
        await rec.seg('ledge door (amulet held): into the falls', 'wait', async c => {
            await opLoc(sdk, c, LEDGE_DOOR, 2511, 3464, 1);
            await waitAt(sdk, 2575, 9861, 0, 20);
            return stage();
        });
        await rec.seg('walk to crate (2589,9888)', 'travel', async c => {
            await walk(bot, sdk, c, 2589, 9887, 1);
        });
        await rec.seg('search crate: key', 'interaction', async c => {
            await opLoc(sdk, c, BAX_CRATE, 2589, 9888, 1);
            await waitTicksFor(sdk, () => invCount(sdk, /key/i) > 0, 20);
        });
        await rec.seg('walk to puzzle-room door (2566,9901)', 'travel', async c => {
            await walk(bot, sdk, c, 2566, 9900, 0);
        });
        await rec.seg('key on door: into the puzzle room', 'interaction', async c => {
            await useOnLoc(sdk, c, /key/i, BAX_DOOR2, 2566, 9901);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 0) >= 9902, 20);
            return stage();
        });
    }
    if (FROM <= 4 && TO >= 4) {
        if (FROM === 4) {
            await cheat(sdk, 'setvar waterfall_quest 6');
            await cheat(sdk, 'setvar pillar_waterfall_quest 0');
            await cheat(sdk, 'give glarials_amulet_waterfall_quest 1');
            await cheat(sdk, 'give glarials_urn_full_waterfall_quest 1');
            for (const r of ['airrune', 'earthrune', 'waterrune']) await cheat(sdk, `give ${r} 6`);
            await tele(sdk, 2566, 9902);
        }
        await rec.seg('18 runes on the 6 pillars', 'interaction', async c => {
            for (const [x, z] of PILLARS) {
                for (const rune of [/^air rune$/i, /^earth rune$/i, /^water rune$/i]) {
                    const before = invCount(sdk, rune);
                    await useOnLoc(sdk, c, rune, PILLAR, x, z);
                    const ok = await waitTicksFor(sdk, () => invCount(sdk, rune) < before, 20);
                    if (!ok) throw new Error(`rune ${rune} not placed on pillar ${x},${z}`);
                }
            }
            return `pillar bits ${await getvar(sdk, 'pillar_waterfall_quest')}`;
        });
        await rec.seg('amulet on Glarial\'s statue: raised to the chalice', 'interaction', async c => {
            await useOnLoc(sdk, c, /amulet/i, STATUE_QUEEN, 2565, 9916);
            await waitAt(sdk, 2603, 9914, 0, 30);
            return stage();
        });
        await rec.seg('urn on the chalice: reward', 'interaction', async c => {
            await useOnLoc(sdk, c, /urn/i, CHALICE, 2603, 9910);
            await waitTicksFor(sdk, () => invCount(sdk, /diamond/i) > 0, 30);
            return stage();
        });
        const s = sdk.getState()!;
        console.log('final skills', s.skills.filter(k => /attack|strength/i.test(k.name)).map(k => `${k.name} ${k.level} xp=${k.experience}`).join(', '));
    }
    rec.report();
}, { timeout: 60 * 60_000 });
