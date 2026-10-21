// Mage Arena travel in: Ardougne teleport landing -> wilderness lever -> Deserted Keep -> mage bank
// ladder -> Kolodion in the cellar.
//
//   bun docs/speedrun/scripts/quest-magearena-travel.ts <botname>
//
// Setup (untimed): teleport to the Ardougne teleport landing (magic_spells.dbrow tele_coord
// 0_41_51_37_37), a knife in the inventory for the webs (a knife has no weapon category, so
// can_enter_mage_arena accepts it). Each segment logs ticks and the tiles walked; the lever
// segment ends on the Deserted Keep arrival, not after the dialogue's close is confirmed.
import { runScript } from '../../../sdk/runner';
import { act, opLoc, slotOf, walkTo } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitOrThrow, waitTicks } from '../../../speedrun/lib/wait';
import { at, findLoc, findNpc, invItem, messagesSince, pos } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { give, mustTele } from '../../../speedrun/lab/setup';

const SLASHED = /slash the web apart/i;
const WEB_RESULT = /slash the web apart|fail to cut through/i; // web.rs2

await runScript(async ({ bot, sdk }) => {
    if (!invItem(sdk, /^knife$/i)) await give(sdk, 'knife', 1);
    // FROM=keep starts at the lever's landing; FROM=edgeville at the glory's Edgeville landing
    // (no Plague City, so no Ardougne teleport) and walks north to the ladder.
    const FROM = process.env.FROM ?? 'ardougne';
    const fromKeep = FROM === 'keep';
    const fromEdge = FROM === 'edgeville';
    const start = fromKeep ? [3154, 3924] : fromEdge ? [3087, 3496] : [2661, 3301];
    await mustTele(sdk, start[0]!, start[1]!);
    await waitTicks(sdk, 3);
    const rec = new Recorder(sdk, `Mage Arena travel (from ${FROM})`);
    const t0 = currentTick(sdk);
    const log = (msg: string) => { const t = currentTick(sdk); console.log(`[t=${t} +${t - t0}] ${msg}`); };

    if (!fromKeep && !fromEdge) {
        // 1. walk to the lever and pull it
        rec.begin('ardougne->lever', 'travel');
        let leverLoc = await findLoc(sdk, { name: /lever/i, radius: 15 });
        if (!leverLoc) {
            const r = await walkTo(bot, sdk, 2563, 3311, 2);
            log(`walk to lever: ${r.ok ? 'ok' : r.message} at ${JSON.stringify(pos(sdk))}`);
            leverLoc = await findLoc(sdk, { name: /lever/i, radius: 10 });
        }
        if (!leverLoc) throw new Error('lever not found');
        rec.end(`${leverLoc.name} at ${leverLoc.x},${leverLoc.z}`);
        rec.begin('lever', 'mixed');
        rec.interact();
        const op = leverLoc.options[0]!;
        if (!(await opLoc(sdk, leverLoc, op, s => s.dialog.isOpen, { maxTicks: 30 })).ok) throw new Error('the lever opened no dialogue');
        const d1 = await converse(sdk, ["Yes I'm brave."], { until: s => pos(s).z > 3800, maxTicks: 80 });
        if (!d1.ok) throw new Error(`timed out waiting for: arrive at the Deserted Keep (${d1.reason})`);
        rec.dialogue(d1);
        rec.end(`now ${JSON.stringify(pos(sdk))}`);
    }

    // 2. Deserted Keep -> ladder at 3091,3957; webs at 3093/3095,3957 and 3158,3951
    rec.begin('keep->ladder', 'travel');
    const from2 = pos(sdk);
    // The keep's only exit is the web at 3158,3951 (north wall); two more webs guard the ladder.
    // Walk toward each goal; when the path is blocked, knife the nearest web (50% per try).
    let slashTries = 0;
    const goals: [number, number][] = fromEdge
        ? [[3096, 3957], [3094, 3957], [3092, 3957]]
        : [[3158, 3950], [3158, 3953], [3096, 3957], [3094, 3957], [3092, 3957]];
    for (const [gx, gz] of goals) {
        const there = at(gx, gz, 0, 1);
        for (let attempt = 0; attempt < 12; attempt++) {
            if (there(sdk.getState()!)) break;
            const p = sdk.findPath(gx, gz);
            if (p.success && p.reachedDestination) {
                const r = await walkTo(bot, sdk, gx, gz, 1);
                log(`walk to ${gx},${gz}: ${r.message} at ${JSON.stringify(pos(sdk))}`);
                continue;
            }
            const web = await findLoc(sdk, { name: /^web$/i, op: 'Slash', radius: 12 });
            if (!web) {
                // The client's static collision still holds slashed webs; let the server path it.
                log(`client finds no path to ${gx},${gz}; sending a direct walk`);
                await sdk.sendWalk(gx, gz, true);
                await waitOrThrow(sdk, there, 80, `walk to ${gx},${gz}`);
                break;
            }
            const t = currentTick(sdk) + 1; // the last failed try's message must not count
            const knife = slotOf(sdk, /^knife$/i);
            rec.interact();
            await act(sdk, () => sdk.sendUseItemOnLoc(knife, web.x, web.z, web.id), s => messagesSince(s, t, WEB_RESULT).length > 0, { maxTicks: 30 });
            slashTries++;
            const ok = messagesSince(sdk, t, SLASHED).length > 0;
            log(`knife on web at ${web.x},${web.z}: ${ok ? 'slashed' : 'failed'}`);
            if (ok) {
                // step through the slashed web with a server-side walk
                await sdk.sendWalk(gx, gz, true);
                await waitOrThrow(sdk, there, 80, `walk to ${gx},${gz}`);
                break;
            }
        }
    }
    log(`web slash attempts: ${slashTries}`);
    rec.end(`from ${JSON.stringify(from2)} to ${JSON.stringify(pos(sdk))}, ${slashTries} slash attempts`);

    // 3. climb down, walk to Kolodion
    rec.begin('ladder down', 'interaction');
    const ladder = await findLoc(sdk, { name: /ladder/i, radius: 5 });
    if (!ladder) throw new Error('ladder not found');
    rec.interact();
    if (!(await opLoc(sdk, ladder, 'Climb-down', s => pos(s).z > 4600, { maxTicks: 20 })).ok) throw new Error('timed out waiting for: arrive in the cellar');
    rec.end(`now ${JSON.stringify(pos(sdk))}`);
    const kol = findNpc(sdk, /^Kolodion$/);
    log(`Kolodion at ${kol?.x},${kol?.z} distance ${kol?.distance}`);
    log(`TOTAL ${fromKeep || fromEdge ? FROM : 'ardougne'} landing -> cellar: ${rec.total().ticks} ticks`);
    rec.report();
}, { timeout: 5 * 60_000, printState: false });
