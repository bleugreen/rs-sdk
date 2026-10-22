// Temporary probe: what does ::~itest 25 do on the lab engine?
import { openSession, closeSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { botArg } from './common';
import { cheat } from './setup';

const s = await openSession(botArg(), { pathfinding: false });
const sdk = s.sdk;
const cmd = process.argv.find(a => a.startsWith('--cmd='))?.slice(6) ?? '~itest 25';
const t0 = sdk.getState()!.tick;
sdk.onStateUpdate(st => {
    const p = st.player!;
    const msgs = (st.gameMessages ?? []).filter(m => (m as { tick?: number }).tick === undefined || (m as { tick: number }).tick >= t0).slice(-2).map(m => m.text);
    console.log(`tick ${st.tick - t0} at ${p.worldX},${p.worldZ} run=${st.varps?.option_run} anim=${p.animId} msgs=${JSON.stringify(msgs)}`);
});
await cheat(sdk, cmd);
await waitTicks(sdk, 14);
await closeSession(s);
process.exit(0);
