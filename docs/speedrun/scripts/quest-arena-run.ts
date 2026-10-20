// Fight Arena, end to end, as tick-stamped segments (docs/speedrun/quests/fight_arena.md).
//
//   bun docs/speedrun/scripts/quest-arena-run.ts <bot> [--stats 70] [--general yes|no] [--from 0|3|5|9]
//
// Starts next to Lady Servil with helper-supplied gear (rune scimitar, rune
// kiteshield, rune platelegs, amulet of power, 20 swordfish, 10 coins) and
// melee stats set to --stats. --from 5 jumps to the cell-keys stage
// (::setvar arenaquest 5, keys and Khazard armour given) and starts at Jeremy,
// which isolates the fight chain. --general yes also kills General Khazard,
// which the quest does not require (lady_servil.rs2:8-13 pays out at stage 12).
import { runScript } from '../../../sdk/runner';
import {
    inBox, arg, cheat, driveDialog, fight, getvar, opLoc, pos, Recorder, settle, setup, talk, tele, tick, useOnLoc, waitTicksFor, walk, wear, invCount,
} from './quest-lib';

const STATS = Number(arg('stats', '70'));
const GENERAL = arg('general', 'no') === 'yes';
const FROM = Number(arg('from', '0'));
const FOOD = /swordfish/i;
const EAT_AT = Math.max(12, Math.floor(STATS * 0.45));

// loc ids from server/content/pack/loc.pack, tiles from the maps
const CHEST_SHUT = 75, CHEST_OPEN = 76;
const DOOR1 = 81;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const rec = new Recorder(sdk, `Fight Arena (melee ${STATS}, general=${GENERAL}, from=${FROM})`);
    await setup(sdk, {
        stats: { attack: STATS, strength: STATS, defence: STATS, hitpoints: STATS, thieving: 1 },
        give: [['rune_scimitar', 1], ['rune_kiteshield', 1], ['rune_platelegs', 1], ['amulet_of_power', 1], ['coins', 10], ['swordfish', 20]],
    });
    for (const re of [/rune scimitar/i, /rune kiteshield/i, /rune platelegs/i, /amulet of power/i]) await wear(sdk, re);

    if (FROM === 0) {
        await cheat(sdk, 'setvar arenaquest 0');
        await tele(sdk, 2567, 3197);
        await rec.seg('Lady Servil: start', 'dialogue', async c => {
            await talk(sdk, c, /lady servil/i, ['Can I help you?']);
            return `stage ${await getvar(sdk, 'arenaquest')}`;
        });
        await rec.seg('walk to guard chest (2613,3189)', 'travel', async c => {
            await walk(bot, sdk, c, 2613, 3188, 1);
        });
        await rec.seg('open + search chest, wear helm + armour', 'interaction', async c => {
            await opLoc(sdk, c, CHEST_SHUT, 2613, 3189, 1);
            await waitTicksFor(sdk, () => !!sdk.getNearbyLocs().find(l => l.id === CHEST_OPEN && l.x === 2613 && l.z === 3189), 20);
            await opLoc(sdk, c, CHEST_OPEN, 2613, 3189, 1);
            await waitTicksFor(sdk, s => s.inventory.some(i => /khazard armour/i.test(i.name)) || !!s.dialog?.isOpen, 20);
            await driveDialog(sdk, c, [], 2);
            await wear(sdk, /khazard helmet/i); c.interactions++;
            await wear(sdk, /khazard armour/i); c.interactions++;
            return `stage ${await getvar(sdk, 'arenaquest')}`;
        });
        await rec.seg('walk to north prison door (2617,3171)', 'travel', async c => {
            await walk(bot, sdk, c, 2617, 3173, 0);
        });
        await rec.seg('north prison door (guard lets you in)', 'interaction', async c => {
            await opLoc(sdk, c, DOOR1, 2617, 3171, 1);
            await waitTicksFor(sdk, s => !!s.dialog?.isOpen || (s.player?.worldZ ?? 9999) < 3171, 20);
            await driveDialog(sdk, c, [], 2);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 9999) < 3171, 10);
        });
        await rec.seg('walk to drunk guard (2615,3141)', 'travel', async c => {
            await walk(bot, sdk, c, 2616, 3142, 1);
        });
        await rec.seg('drunk guard: first talk', 'dialogue', async c => {
            await talk(sdk, c, 254);
            return `stage ${await getvar(sdk, 'arenaquest')}`;
        });
    }
    if (FROM === 3) {
        await cheat(sdk, 'give khazard_helmet 1');
        await cheat(sdk, 'give khazard_platemail 1');
        await wear(sdk, /khazard helmet/i);
        await wear(sdk, /khazard armour/i);
        await tele(sdk, 2616, 3142);
        await cheat(sdk, 'setvar arenaquest 3');
    }
    if (FROM <= 3) {
        await rec.seg('walk to west prison door (2585,3141)', 'travel', async c => {
            await walk(bot, sdk, c, 2585, 3141, 0);
        });
        await rec.seg('west prison door, out', 'interaction', async c => {
            await opLoc(sdk, c, DOOR1, 2585, 3141, 1);
            await waitTicksFor(sdk, s => (s.player?.worldX ?? 0) < 2585, 10);
        });
        await rec.seg('walk to barman (2566,3140)', 'travel', async c => {
            await walk(bot, sdk, c, 2567, 3140, 1);
        });
        await rec.seg('barman: buy Khali brew', 'dialogue', async c => {
            await talk(sdk, c, /khazard barman/i, [/khali brew/i]);
            return `brew=${invCount(sdk, /khali brew/i)}`;
        });
        await rec.seg('walk back to west prison door', 'travel', async c => {
            await walk(bot, sdk, c, 2583, 3141, 0);
        });
        await rec.seg('west prison door, in (guard lets you in)', 'interaction', async c => {
            await opLoc(sdk, c, DOOR1, 2585, 3141, 1);
            await waitTicksFor(sdk, s => !!s.dialog?.isOpen || (s.player?.worldX ?? 0) >= 2585, 20);
            await driveDialog(sdk, c, [], 2);
            await waitTicksFor(sdk, s => (s.player?.worldX ?? 0) >= 2585, 10);
        });
        await rec.seg('walk back to drunk guard', 'travel', async c => {
            await walk(bot, sdk, c, 2616, 3142, 1);
        });
        await rec.seg('drunk guard: give brew, get keys', 'dialogue', async c => {
            await talk(sdk, c, 254);
            return `stage ${await getvar(sdk, 'arenaquest')} keys=${invCount(sdk, /keys/i)}`;
        });
        await rec.seg('walk to Jeremy (2616,3168)', 'travel', async c => {
            await walk(bot, sdk, c, 2618, 3167, 0);
        });
    } else if (FROM >= 5) {
        await cheat(sdk, 'give khazard_helmet 1');
        await cheat(sdk, 'give khazard_platemail 1');
        await cheat(sdk, 'give khazard_cellkeys 1');
        await wear(sdk, /khazard helmet/i);
        await wear(sdk, /khazard armour/i);
        await tele(sdk, 2618, 3167);
        await cheat(sdk, 'setvar arenaquest 5');
    }

    // ---- the fight chain: everything from the keys to stage 12 ----
    const chainStart = tick(sdk);
    if (FROM === 9) {
        await tele(sdk, 2600, 3142);
        await cheat(sdk, 'setvar arenaquest 9');
    }
    if (FROM < 9) await rec.seg('Jeremy: free him, cutscene into the arena', 'mixed', async c => {
        await talk(sdk, c, /jeremy servil/i, [], 1, s => inBox(s, 2581, 3151, 2606, 3171));
        return `stage ${await getvar(sdk, 'arenaquest')} at ${JSON.stringify(pos(sdk))}`;
    });
    if (FROM < 9) await rec.seg('fight: Khazard ogre', 'fight', async c => {
        const r = await fight(sdk, c, /khazard ogre/i, { food: FOOD, eatAt: EAT_AT });
        return JSON.stringify(r);
    });
    if (FROM < 9) await rec.seg('ogre dead: General dialogue + cell cutscene', 'mixed', async c => {
        await driveDialog(sdk, c, [], 3, 400, s => inBox(s, 2586, 3139, 2601, 3143));
        return `stage ${await getvar(sdk, 'arenaquest')} at ${JSON.stringify(pos(sdk))}`;
    });
    await rec.seg('Hengrad: talk, guard escorts you to the arena', 'mixed', async c => {
        await talk(sdk, c, /hengrad/i, [], 1, s => inBox(s, 2581, 3151, 2606, 3171));
        return `at ${JSON.stringify(pos(sdk))}`;
    });
    await rec.seg('fight: Khazard scorpion', 'fight', async c => {
        const r = await fight(sdk, c, /khazard scorpion/i, { food: FOOD, eatAt: EAT_AT });
        return JSON.stringify(r);
    });
    await rec.seg('scorpion dead: General summons Bouncer', 'mixed', async c => {
        await driveDialog(sdk, c, [], 3);
        return `stage ${await getvar(sdk, 'arenaquest')}`;
    });
    await rec.seg('fight: Bouncer', 'fight', async c => {
        const r = await fight(sdk, c, /bouncer/i, { food: FOOD, eatAt: EAT_AT });
        return JSON.stringify(r);
    });
    await rec.seg('Bouncer dead: General frees the Servils', 'mixed', async c => {
        await driveDialog(sdk, c, [], 2);
        return `stage ${await getvar(sdk, 'arenaquest')}`;
    });
    if (GENERAL) {
        await rec.seg('fight: General Khazard (optional)', 'fight', async c => {
            const r = await fight(sdk, c, /general khazard/i, { food: FOOD, eatAt: EAT_AT, maxTicks: 1500 });
            return JSON.stringify(r);
        });
    }
    console.log(`fight chain (keys to stage 12${GENERAL ? ' + General' : ''}): ${tick(sdk) - chainStart} ticks`);

    await rec.seg('leave arena, walk to Lady Servil', 'travel', async c => {
        await walk(bot, sdk, c, 2567, 3197, 1);
    });
    await rec.seg('Lady Servil: reward', 'dialogue', async c => {
        await talk(sdk, c, /lady servil/i);
        await settle(sdk, 2, 20);
        return `stage ${await getvar(sdk, 'arenaquest')}`;
    });
    const s = sdk.getState()!;
    console.log('final skills', s.skills.filter(k => /attack|thieving/i.test(k.name)).map(k => `${k.name} ${k.level} xp=${k.experience}`).join(', '));
    console.log(`hp ${s.player?.hp}/${s.player?.maxHp}, swordfish left ${invCount(sdk, FOOD)}`);
    rec.report();
}, { timeout: 60 * 60_000 });
