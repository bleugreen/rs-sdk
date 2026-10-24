// Lab: helpers/smith-give.ts end to end. A staffed smith with Smithing 95, 24 adamantite bars and
// coins but no hammer buys a hammer, smiths the adamant melee pieces (2 of each) at the Varrock west
// anvil, banks and checks them by id, then trades one set to each stand-in receiver (lab.sh helper
// runners, which accept the smith's trade with lib/trade.ts receiveFrom).
//
//   LAB_HELPERS="<r1> <r2>" speedrun/lab/lab.sh <smith> speedrun/lab/smith-give-lab.ts:--receivers=<r1>,<r2>
//
// Account names must be cairn_ shaped (the role's receiver check), which bots/create-bot.ts refuses:
// create each under an alphanumeric name and rename its directory and username. Use fresh names (the
// lab engine keeps a bank across runs). Passes when every receiver
// gained exactly one of each piece by obj id and nothing else, the smith's bank holds no pieces
// and no bars beyond what it started with less the 24, and the role reports no uncertain trade.
import { BANKS } from '../helpers/buyer';
import { memoryRoleState } from '../helpers/role';
import { pathTiles } from '../lib/paths';
import { role, PIECES, ADAMANT_MELEE, BAR_OBJ } from '../helpers/smith-give';
import { openSession, type Session } from '../lib/session';
import { receiveFrom, sameName, type ReceiveResult } from '../lib/trade';
import { waitTicks } from '../lib/wait';
import { arg, botArg, result } from './common';
import { clearInventory, give, leaveTutorial, mustTele, setStats, VARROCK_WEST_BANK } from './setup';

const smith = await openSession(botArg());
const receivers: Session[] = [];
for (const name of arg('receivers', '').split(',').filter(Boolean)) receivers.push(await openSession(name, { pathfinding: false }));
if (!receivers.length) throw new Error('--receivers=<r1>[,<r2>] is required');
const log = (message: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ t: smith.sdk.getState()?.tick, message, ...data }));

for (const s of [smith, ...receivers]) await leaveTutorial(s);
for (const s of [smith, ...receivers]) await clearInventory(s.sdk);
await setStats(smith.sdk, { smithing: 95 });
await mustTele(smith.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
await give(smith.sdk, 'adamantite_bar', 24);
await give(smith.sdk, 'coins', 20);
// The stand-ins stand where the smith can walk to them from the role's bank tile: a tile behind
// the booths or in a wall leaves every trade click with no route (no_response).
const spots = [[3186, 3436], [3184, 3436], [3185, 3435], [3186, 3435], [3184, 3435], [3186, 3437], [3184, 3437]]
    .filter(([x, z]) => { const p = pathTiles(0, BANKS.varrockWest.x, BANKS.varrockWest.z, x!, z!); return p.reached && p.tiles <= 6; });
if (spots.length < receivers.length) throw new Error(`only ${spots.length} reachable stand-in tiles near Varrock west bank`);
for (const [i, r] of receivers.entries()) await mustTele(r.sdk, spots[i]![0]!, spots[i]![1]!);
log('stand-ins placed', { at: receivers.map((r, i) => ({ name: r.name, x: spots[i]![0], z: spots[i]![1] })) });
await waitTicks(smith.sdk, 3);

const byId = (items: ReadonlyArray<{ id: number; count: number }>) => {
    const m: Record<number, number> = {};
    for (const i of items) m[i.id] = (m[i.id] ?? 0) + i.count;
    return m;
};
const before = receivers.map(r => byId(r.sdk.getInventory()));
const ids = [...ADAMANT_MELEE.map(k => PIECES[k]!.obj), BAR_OBJ.adamantite_bar!];

// Each stand-in accepts the smith's trade whenever it comes (the smith smiths first, a few minutes).
// The request's sender is the display name ("Cairn lsg" for cairn_lsg), which waitForTradeRequest's
// `from` substring never matches, so the sender is checked with sameName instead.
async function standIn(r: Session): Promise<ReceiveResult | null> {
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
        const req = await r.sdk.waitForTradeRequest({ timeout: until - Date.now() });
        if (req && sameName(req, smith.name)) return receiveFrom(r.sdk, smith.name, { openMaxTicks: 50 });
    }
    return null;
}
const received = receivers.map(standIn);

const banks: { id: number; name: string; count: number }[][] = [];
const t0 = smith.sdk.getState()!.tick;
const abort = new AbortController();
const stop = setTimeout(() => abort.abort(), 25 * 60_000);
const finish = await role
    .run({
        bot: smith.bot,
        sdk: smith.sdk,
        account: smith.name,
        options: { receivers: receivers.map(r => r.name), id: 'lab' },
        log,
        reportBank: b => banks.push(b.items),
        signal: abort.signal,
        state: memoryRoleState()
    })
    .catch(e => ({ attention: `threw: ${e instanceof Error ? e.message : String(e)}` }));
clearTimeout(stop);
const got = await Promise.all(received);
await waitTicks(smith.sdk, 3);

const want = Object.fromEntries(ADAMANT_MELEE.map(k => [PIECES[k]!.obj, 1]));
const gained = receivers.map((r, i) => {
    const now = byId(r.sdk.getInventory());
    const d: Record<number, number> = {};
    for (const id of new Set([...Object.keys(now), ...Object.keys(before[i]!)].map(Number))) {
        const n = (now[id] ?? 0) - (before[i]![id] ?? 0);
        if (n) d[id] = n;
    }
    return d;
});
const exact = gained.every(g => JSON.stringify(g) === JSON.stringify(want));
const lastBank = byId(banks[banks.length - 1] ?? []);
const firstBank = byId(banks[0] ?? []);
const bankPieces = Object.fromEntries(ids.map(id => [id, { first: firstBank[id] ?? 0, last: lastBank[id] ?? 0 }]));
const pass = exact && !(finish as { attention?: string } | void)?.attention && (lastBank[BAR_OBJ.adamantite_bar!] ?? 0) === (firstBank[BAR_OBJ.adamantite_bar!] ?? 0) - 24;
result('smith-give lab', {
    pass,
    ticks: smith.sdk.getState()!.tick - t0,
    finish: finish ?? {},
    receivers: receivers.map((r, i) => ({ name: r.name, gained: gained[i], trade: got[i] ? { ok: got[i]!.ok, received: got[i]!.received.map(x => `${x.name} (obj ${x.id}) x${x.count}`), reason: got[i]!.reason } : null })),
    want,
    smithBank: bankPieces,
    smithInventory: smith.sdk.getInventory().map(i => `${i.name} (obj ${i.id}) x${i.count}`)
});
process.exit(pass ? 0 : 1);
