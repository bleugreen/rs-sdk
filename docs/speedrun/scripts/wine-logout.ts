// Clean logout of helper accounts whose lite clients are still running, before the
// clients are stopped (cairn://p/rs/47; docs/speedrun/helpers/wine.md, "Stopping").
// Wine helpers and the couriers that supply the wine maker (any cairn_hNN or mule).
//
//   GATEWAY_URL=ws://127.0.0.1:8540 bun docs/speedrun/scripts/wine-logout.ts <account> ...
//
// Stop each account's role first. For every account the script attaches a control
// SDK to the running client, prints its position and inventory, and logs out
// through the logout button (logoutClean: waits out combat, then confirms the
// player left the world). Exit code 1 when any account is still in the world.
import { closeSession, logoutClean, openSession } from '../../../speedrun/lib/session';

const accounts = process.argv.slice(2);
if (accounts.length === 0) throw new Error('usage: wine-logout.ts <account> ...');
for (const name of accounts) {
    if (!/^cairn_(h\d\d|mule\d)$/.test(name)) throw new Error(`${name}: not a helper account (cairn_hNN or cairn_muleN)`);
}

let failed = 0;
for (const name of accounts) {
    try {
        const s = await openSession(name, { pathfinding: false });
        const st = s.sdk.getState();
        const pos = st?.player ? { x: st.player.worldX, z: st.player.worldZ, level: st.player.level } : null;
        const inv = (st?.inventory ?? []).map(i => `${i.name} x${i.count}`);
        const out = await logoutClean(s);
        console.log(`RESULT ${name} ${JSON.stringify({ ok: out.ok, latencyTicks: out.latencyTicks, reason: out.reason, pos, inv })}`);
        if (!out.ok) failed++;
        await closeSession(s);
    } catch (e) {
        failed++;
        console.log(`RESULT ${name} ${JSON.stringify({ ok: false, reason: String(e) })}`);
    }
}
process.exit(failed ? 1 : 0);
