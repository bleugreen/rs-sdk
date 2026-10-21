// Underground Pass: timed segments, each started from a staged quest state
// (::setvar / ::tele / ::give) and played with real clicks. Travel follows the
// cheapest route from quest-underground-pass-route.ts (see Lab.travel).
//
//   bun docs/speedrun/scripts/quest-underground-pass-segments.ts <bot> <segment> [--grid=342] [--thieving=50] [--agility=99]
//
// Segments:
//   post      after completion: cave entrance to the Iban temple doors and through them
//             (Regicide's second traversal, %upass 10, %regicide_quest 2)
// Prints one line per step and a RESULT line.

import { runScript } from '../../../sdk/runner';
import { Lab, ibanmulti, BIT } from './quest-underground-pass-lib';
import { P, type T } from './quest-underground-pass-route';

const args = process.argv.slice(3);
const segment = args.find(a => !a.startsWith('--')) ?? 'post';
const opt = (name: string, d: number) => Number(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? d);
// Grid answers are three digits 1-5, each within 1 of the previous (upass_grid.rs2:47-58).
const GRID = opt('grid', 343);
const THIEVING = opt('thieving', 50);
const AGILITY = opt('agility', 99);

await runScript(async ({ bot, sdk }) => {
    const lab = new Lab(sdk, bot);
    await bot.dismissBlockingUI();
    await lab.cheat('setvar biohazard 16'); // ^biohazard_complete, needed by the cave entrance (quest_upass.rs2:81)
    const stats = async (s: Record<string, number>) => { for (const [k, v] of Object.entries(s)) await lab.cheat(`setstat ${k} ${v}`, 1); };
    const clearInv = async () => { for (const it of sdk.getInventory()) { await sdk.sendDropItem(it.slot); await sdk.waitForTicks(1); } };

    /** Walk the trap grid on its safe strips (upass_grid.rs2:61-83), from the east edge to the lever, and pull it. */
    const grid = async (answer: number) => {
        const d = [Math.floor(answer / 100) % 10, Math.floor(answer / 10) % 10, answer % 10];
        const row = (n: number) => 9673 + 2 * (n - 1);
        const pts: T[] = [[2477, row(d[0]), 0], [2474, row(d[0]), 0], [2474, row(d[1]), 0], [2469, row(d[1]), 0], [2469, row(d[2]), 0], [2466, row(d[2]), 0], [2466, 9673, 0]];
        await lab.act(`grid walk (answer ${answer})`, async () => {
            for (const p of pts) {
                if (lab.at(p)) continue;
                await sdk.sendWalk(p[0], p[1], true);
                const ok = await new Promise<boolean>(async res => {
                    for (let i = 0; i < 30; i++) { await sdk.waitForTicks(1); if (lab.at(p)) return res(true); if (lab.pos()[1] < 9600) return res(false); }
                    res(false);
                });
                if (!ok) throw new Error(`grid: did not reach ${p} (at ${lab.pos()})`);
            }
        }, undefined, { tiles: 'see route' });
        await lab.act('portcullis lever', () => lab.clickLoc(3337, 2466, 9672, 1), () => lab.at([2464, 9677, 0]));
    };

    if (segment === 'post') {
        await stats({ agility: AGILITY, thieving: THIEVING, ranged: 60, hitpoints: 99 });
        await lab.cheat('setvar upass 10');
        await lab.cheat('setvar regicide_quest 2');
        await lab.cheat(`setvar ibanmulti ${ibanmulti([BIT.started, BIT.orb1, BIT.orb2, BIT.orb3, BIT.orb4, BIT.badge1, BIT.badge2, BIT.badge3, BIT.horn, BIT.koftikInsane], GRID)}`);
        await clearInv();
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 1], ['spade', 1], ['swordfish', 5]] as const) await lab.give(n, c);
        await sdk.waitForTicks(2);
        await lab.equip(/^Shortbow$/i);
        for (const e of sdk.getEquipment()) if (/arrow/i.test(e.name)) await bot.unequipItem(e);
        await lab.teleTo(2434, 3313, 0);
        const t0 = lab.tick();
        await lab.travel('cave entrance -> Koftik at the bridge', [2448, 9716, 0]);
        await lab.talk('Koftik (damp cloth, %upass 10)', /Koftik/);
        await lab.act('wrap cloth on bronze arrow', () => lab.useItem(/^Damp cloth$/i, /^Bronze arrow$/i), () => sdk.countInventoryItems(/fire arrow/i) > 0);
        await lab.act('light it with the tinderbox', () => lab.useItem(/^Tinderbox$/i, /fire arrow/i), () => sdk.getInventory().some(i => i.name === 'Bronze fire arrows' && i.id === 942));
        await lab.act('wield the lit arrow', () => bot.equipItem(/^Bronze fire arrows$/i), () => sdk.getEquipment().some(e => /fire arrows/i.test(e.name)));
        await lab.travel('Koftik -> grid east edge (bridge shot, rope swing)', P.gridEast);
        await grid(GRID);
        await lab.travel('portcullis -> Iban temple doors', P.templeDoor);
        await lab.act('temple doors (east side, %regicide_quest 2)', () => lab.clickLoc(3334, 2143, 4647, 1), () => lab.pos()[0] < 2100);
        lab.record({ label: 'TOTAL cave entrance click to through the temple doors', ticks: lab.tick() - t0, at: lab.pos() });
    } else {
        throw new Error(`unknown segment ${segment}`);
    }
    lab.report(segment);
}, { timeout: 3_600_000, printState: false });
