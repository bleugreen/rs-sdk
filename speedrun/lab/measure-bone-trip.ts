// The S07 bone giver's restock round trip: Falador west bank to the giver's tile
// at the Taverley oaks (2913,3494) and willows (2920,3407), and back, walked with
// the SDK's pathfinding walk as the role does (mule.ts walkNear). Ticks from the
// first walk click to arrival. --trials=N per leg pair; even trials start with
// full run energy (::~energy), odd ones with whatever the previous trip left,
// as a giver making trip after trip would have.
//
//   NODE_TICKRATE=300 speedrun/lab/lab.sh boneTrip speedrun/lab/measure-bone-trip.ts:--trials=2
import { closeSession, openSession } from '../lib/session';
import { arg, botArg, result } from './common';
import { cheat, leaveTutorial, near, tele } from './setup';

const trials = Number(arg('trials', '2'));
const session = await openSession(botArg());
const { sdk, bot } = session;
await leaveTutorial(session);
const BANK = { x: 2946, z: 3368 };
const SITES = { oak: { x: 2913, z: 3494 }, willow: { x: 2920, z: 3407 } };
const energy = () => (sdk.getState()?.player as { runEnergy?: number } | undefined)?.runEnergy ?? null;

async function leg(to: { x: number; z: number }): Promise<{ ticks: number; ok: boolean; energyAfter: number | null }> {
    const t0 = sdk.getState()!.tick;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        await bot.walkTo(to.x, to.z, 1, { timeout: 180_000 });
        ok = near(sdk.getState(), to.x, to.z, 1);
    }
    return { ticks: sdk.getState()!.tick - t0, ok, energyAfter: energy() };
}

if (!(await tele(sdk, BANK.x, BANK.z))) throw new Error('could not teleport to Falador west bank');
for (const [name, site] of Object.entries(SITES)) {
    for (let i = 0; i < trials; i++) {
        if (i % 2 === 0) await cheat(sdk, '~energy');
        const out = await leg(site);
        const back = await leg(BANK);
        result(`bank -> ${name} -> bank (trial ${i}, ${i % 2 === 0 ? 'full energy' : 'energy left over'})`, { out, back, roundTrip: out.ticks + back.ticks });
    }
}
await closeSession(session);
process.exit(0);
