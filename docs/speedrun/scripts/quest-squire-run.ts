// The Knight's Sword, end to end, as tick-stamped segments (docs/speedrun/quests/knights_sword.md).
//
//   bun docs/speedrun/scripts/quest-squire-run.ts <bot> [--from 0..4] [--mining 10] [--pick steel_pickaxe]
//
// Teleports are not cast: the script ::tele's to the spell's or the glory's
// landing tile and prints a TELEPORT line, and the document costs it with the
// measured primitive (spell 4 ticks, glory 6; docs/speedrun/quests/primitives.md).
// Everything after the landing is walked and measured.
//   0  Falador: squire starts the quest; Varrock: Reldo
//   1  glory to Draynor, walk to the ice dungeon, mine blurite, Thurgo (pie, then the sword talk)
//   2  Falador: squire (portrait hint), castle ladders to Sir Vyvin's cupboard
//   3  glory to Draynor, walk to Thurgo: portrait, then blurite + 2 iron bars for the sword
//   4  Falador: squire takes the sword
// Helper-supplied (tradeable): redberry pie, 2 iron bars, pickaxe.
import { runScript } from '../../../sdk/runner';
import {
    arg, cheat, driveDialog, getvar, invCount, opLoc, opLocText, pos, Recorder, settle, setup, talk, tele, tick, waitTicksFor, walk, wear,
} from './quest-lib';

const FROM = Number(arg('from', '0'));
const MINING = Number(arg('mining', '10'));
const PICK = arg('pick', 'steel_pickaxe');
const VYVIN_CUPBOARD_SHUT = 2271, VYVIN_CUPBOARD_OPEN = 2272;
const BLURITE = 2110;
const ROCKS: [number, number][] = [[3049, 9566], [3059, 9564]];

const teleports: string[] = [];

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const rec = new Recorder(sdk, `The Knight's Sword (from ${FROM}, Mining ${MINING}, ${PICK})`);
    const stage = async () => `stage ${await getvar(sdk, 'squire')}`;
    const teleport = async (what: string, x: number, z: number) => { teleports.push(what); console.log(`TELEPORT ${what}`); await tele(sdk, x, z); };
    await setup(sdk, {
        stats: { mining: MINING, hitpoints: 60, defence: 60, attack: 60, strength: 60 },
        give: [[PICK, 1], ['redberry_pie', 1], ['iron_bar', 2]],
    });
    await wear(sdk, /pickaxe/i).catch(() => {}); // wieldable pickaxes free a slot; mining works either way

    if (FROM === 0) {
        await cheat(sdk, 'setvar squire 0');
        await teleport('Falador teleport (2965,3378)', 2965, 3378);
        await rec.seg('walk to the squire (2977,3342)', 'travel', async c => { await walk(bot, sdk, c, 2977, 3343, 1); });
        await rec.seg('squire: start', 'dialogue', async c => {
            await talk(sdk, c, /^squire$/i, ['And how is life as a squire?', 'I can make a new sword if you like...', 'So would these dwarves make another one?', "Ok, I'll give it a go."]);
            return stage();
        });
        await teleport('Varrock teleport (3213,3424)', 3213, 3424);
        await rec.seg('walk to Reldo (3209,3495), round the palace west side', 'travel', async c => {
            // the SDK collision snapshot sees a gap at (3212,3438) that the server blocks; go round
            for (const [x, z] of [[3182, 3436], [3180, 3470], [3206, 3480], [3210, 3494]] as [number, number][]) await walk(bot, sdk, c, x, z, 1);
        });
        await rec.seg('Reldo: Imcando dwarves', 'dialogue', async c => {
            await talk(sdk, c, /reldo/i, [/imcando/i]);
            return stage();
        });
    }
    if (FROM <= 1) {
        if (FROM === 1) await cheat(sdk, 'setvar squire 2');
        await teleport('Amulet of glory, Draynor Village (3105,3251)', 3105, 3251);
        await rec.seg('walk to the ice dungeon trapdoor (3008,3150)', 'travel', async c => { await walk(bot, sdk, c, 3008, 3151, 1); });
        await rec.seg('climb down', 'interaction', async c => {
            await opLocText(sdk, c, 3008, 3150, /climb-down/i);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 0) > 6000, 20);
        });
        await rec.seg('walk to blurite (3049,9566)', 'travel', async c => { await walk(bot, sdk, c, 3048, 9567, 1); });
        await rec.seg(`mine one blurite (Mining ${MINING})`, 'interaction', async c => {
            const t0 = tick(sdk);
            let clicks = 0;
            while (invCount(sdk, /blurite/i) === 0 && tick(sdk) - t0 < 300) {
                const rock = ROCKS.map(([x, z]) => sdk.getNearbyLocs().find(l => l.id === BLURITE && l.x === x && l.z === z)).find(Boolean);
                if (rock) { await opLoc(sdk, c, BLURITE, rock.x, rock.z, 1); clicks++; }
                await waitTicksFor(sdk, () => invCount(sdk, /blurite/i) > 0, 12);
            }
            return `clicks=${clicks}`;
        });
        await rec.seg('walk back to the ladder (3008,9550)', 'travel', async c => { await walk(bot, sdk, c, 3008, 9551, 1); });
        await rec.seg('climb up', 'interaction', async c => {
            await opLocText(sdk, c, 3008, 9550, /climb-up/i);
            await waitTicksFor(sdk, s => (s.player?.worldZ ?? 9999) < 6000, 20);
        });
        await rec.seg('walk to Thurgo (3001,3144)', 'travel', async c => { await walk(bot, sdk, c, 3002, 3144, 1); });
        await rec.seg('Thurgo: redberry pie', 'dialogue', async c => {
            await talk(sdk, c, /thurgo/i, ['Would you like a redberry pie?']);
            return stage();
        });
        await rec.seg('Thurgo: can you make me a special sword?', 'dialogue', async c => {
            await talk(sdk, c, /thurgo/i);
            return stage();
        });
    }
    if (FROM <= 2) {
        if (FROM === 2) { await cheat(sdk, 'setvar squire 4'); await cheat(sdk, 'give blurite_ore 1'); }
        await teleport('Falador teleport (2965,3378)', 2965, 3378);
        await rec.seg('walk to the squire', 'travel', async c => { await walk(bot, sdk, c, 2977, 3343, 1); });
        await rec.seg('squire: picture of the sword', 'dialogue', async c => {
            await talk(sdk, c, /^squire$/i);
            return stage();
        });
        await rec.seg('walk to the castle ladder (2994,3341)', 'travel', async c => { await walk(bot, sdk, c, 2993, 3341, 0); });
        await rec.seg('ladders up to the second floor', 'interaction', async c => {
            await opLocText(sdk, c, 2994, 3341, /climb-up/i);
            await waitTicksFor(sdk, s => s.player?.level === 1, 20);
            await opLocText(sdk, c, 2996, 3341, /climb-up/i);
            await waitTicksFor(sdk, s => s.player?.level === 2, 20);
        });
        await rec.seg('walk to Vyvin\'s cupboard (2984,3336)', 'travel', async c => { await walk(bot, sdk, c, 2985, 3336, 1); });
        await rec.seg('open + search cupboard: portrait', 'interaction', async c => {
            const vy = sdk.getState()!.nearbyNpcs.find(n => /vyvin/i.test(n.name));
            const note = `vyvin at ${vy?.x},${vy?.z}, me ${JSON.stringify(pos(sdk))}`;
            for (let attempt = 0; attempt < 12 && invCount(sdk, /portrait/i) === 0; attempt++) {
                if (sdk.getNearbyLocs().find(l => l.id === VYVIN_CUPBOARD_SHUT)) {
                    await opLoc(sdk, c, VYVIN_CUPBOARD_SHUT, 2984, 3336, 1);
                    await waitTicksFor(sdk, () => !!sdk.getNearbyLocs().find(l => l.id === VYVIN_CUPBOARD_OPEN), 10);
                }
                await opLoc(sdk, c, VYVIN_CUPBOARD_OPEN, 2984, 3336, 1);
                await waitTicksFor(sdk, s => invCount(sdk, /portrait/i) > 0 || !!s.dialog?.isOpen, 10);
                if (sdk.getState()!.dialog?.isOpen) await driveDialog(sdk, c, [], 2);
            }
            return `${note}; portrait=${invCount(sdk, /portrait/i)}`;
        });
    }
    if (FROM <= 3) {
        if (FROM === 3) { await cheat(sdk, 'setvar squire 5'); await cheat(sdk, 'give knights_portrait 1'); await cheat(sdk, 'give blurite_ore 1'); }
        await teleport('Amulet of glory, Draynor Village (3105,3251)', 3105, 3251);
        await rec.seg('walk Draynor to Thurgo', 'travel', async c => { await walk(bot, sdk, c, 3002, 3144, 1); });
        await rec.seg('Thurgo: portrait', 'dialogue', async c => {
            await talk(sdk, c, /thurgo/i);
            return stage();
        });
        await rec.seg('Thurgo: blurite + 2 iron bars, sword', 'dialogue', async c => {
            await talk(sdk, c, /thurgo/i);
            return `sword=${invCount(sdk, /blurite sword/i)}`;
        });
    }
    if (FROM <= 4) {
        if (FROM === 4) { await cheat(sdk, 'setvar squire 6'); await cheat(sdk, 'give faladian_sword 1'); }
        await teleport('Falador teleport (2965,3378)', 2965, 3378);
        await rec.seg('walk to the squire', 'travel', async c => { await walk(bot, sdk, c, 2977, 3343, 1); });
        await rec.seg('squire: hand over the sword', 'dialogue', async c => {
            await talk(sdk, c, /^squire$/i);
            await settle(sdk, 2, 10);
            return stage();
        });
        const s = sdk.getState()!;
        console.log('final', s.skills.filter(k => /smithing/i.test(k.name)).map(k => `${k.name} ${k.level} xp=${k.experience}`).join(', '));
    }
    console.log(`teleports used (cost from primitives.md): ${teleports.join('; ')}`);
    rec.report();
}, { timeout: 60 * 60_000 });
