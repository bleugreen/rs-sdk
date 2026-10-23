// The mule delivery's cancellable passage crossing. Its own module, importing no helper,
// so mule.ts and the lab harness can use it without a cycle through questitems.ts.
import type { BotSDK } from '../../sdk/index';
import type { NearbyLoc } from '../../sdk/types';
import { classifyPage } from '../lib/dialogue';
import { CLICK_ATTEMPTS, LOC_WAIT_TICKS, type Crossing, type Passage, type Tile } from '../lib/passages';

/** A delivery crossing's inputs: no BotActions, and a stop predicate the delivery owns. */
export interface DeliveryCrosser {
    sdk: BotSDK;
    /** Checked before every input and after every awaited scan, walk or tick. */
    stopped: () => boolean;
    log: (message: string, data?: Record<string, unknown>) => void;
    /** Walk to a tile on this side; throws when it cannot. */
    walk: (t: Tile) => Promise<void>;
}

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const here = (sdk: BotSDK): Tile => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0 });
function checkStopped(stopped: () => boolean): void {
    if (stopped()) throw new Error('passage crossing stopped');
}

async function deliveryPassageLoc(c: DeliveryCrosser, passage: Passage): Promise<NearbyLoc | null> {
    for (let t = 0; ; t++) {
        checkStopped(c.stopped);
        const scanned = await c.sdk.scanNearbyLocs(6);
        checkStopped(c.stopped);
        const loc = scanned
            .filter(l => passage.loc.test(l.name) && l.optionsWithIndex.some(o => passage.option.test(o.text)))
            .sort((a, b) => cheb(a, passage.at) - cheb(b, passage.at))[0];
        if (loc) return loc;
        if (t >= LOC_WAIT_TICKS) return null;
        await c.sdk.waitForTicks(1);
    }
}

/**
 * lib/passages.ts's `cross` for a mule delivery, which may be cancelled at any input. It checks
 * `stopped` before every input and after every awaited scan, walk or tick, and sends the scanned
 * option itself, because BotActions.interactLoc can walk and retry without consulting the caller.
 * The scored path and the other helpers keep the lib's `cross`.
 */
export async function crossForDelivery(c: DeliveryCrosser, crossing: Crossing): Promise<void> {
    const { passage, from, to } = crossing;
    checkStopped(c.stopped);
    await c.walk(from);
    checkStopped(c.stopped);
    for (let attempt = 0; attempt < CLICK_ATTEMPTS; attempt++) {
        const loc = await deliveryPassageLoc(c, passage);
        checkStopped(c.stopped);
        if (!loc) {
            const seen = (await c.sdk.scanNearbyLocs(3)).map(l => `${l.name}@${l.x},${l.z}`).join(', ');
            throw new Error(`${passage.name} is not in view from ${JSON.stringify(here(c.sdk))} after ${LOC_WAIT_TICKS} ticks (in view: ${seen})`);
        }
        const option = loc.optionsWithIndex.find(o => passage.option.test(o.text))!;
        const r = await c.sdk.sendInteractLoc(loc.x, loc.z, loc.id, option.opIndex);
        checkStopped(c.stopped);
        for (let t = 0; t < 16 && cheb(here(c.sdk), to) > 1; t++) {
            checkStopped(c.stopped);
            const s = c.sdk.getState();
            if (s?.dialog.isOpen && !s.dialog.isWaiting) {
                if (classifyPage(s.dialog) === 'choice') {
                    const opt = s.dialog.options.find(o => (passage.answers ?? []).some(a => a.test(o.text)));
                    if (!opt) throw new Error(`${passage.name}: no answer among ${s.dialog.options.map(o => o.text).join(' | ')}`);
                    await c.sdk.sendClickDialog(opt.index);
                } else await c.sdk.sendClickDialog(0);
            }
            checkStopped(c.stopped);
            await c.sdk.waitForTicks(1);
            checkStopped(c.stopped);
        }
        if (cheb(here(c.sdk), to) <= 1) return c.log('passage', { name: passage.name, at: here(c.sdk) });
        c.log('passage retry', { name: passage.name, attempt, detail: r.message, at: here(c.sdk) });
    }
    throw new Error(`could not cross the ${passage.name}: still at ${JSON.stringify(here(c.sdk))}`);
}
