// Does a bury fit knife fly fishing? (docs/speedrun/research/bones-placement.md, section 3)
//
//   bun docs/speedrun/scripts/bones-fly.ts <bot> --mode=knife|knifebury|bury5 [--level=70] [--prayer=43] [--ticks=400]
//
// Lumbridge river, standing tile (3241,3248) (fishing.md section 2). Labels are state.tick; a roll
// on R shows at label R (#20) and a packet sent at label t lands on t+1. Phase p = t - R:
//   knife      p0: [knife on logs, button 8889, drop, click]: the knife writes R+3, the click finds
//              the clock 2 ahead and the continuation rolls on R+3 (tick-manipulation.md section 5).
//   knifebury  the Woodcutting plan that works (bones-wc.ts): p0 [knife, button, drop, bury], p2 [click]
//              landing on R+3. By reading it cannot roll: attempt_fish_trout_salmon has no roll branch
//              for %action_delay = map_clock (freshfish.rs2:37-52), it only hands over to
//              fish_trout_salmon, which runs on a later tick and re-arms +4.
//   bury5      p0 [drop, bury] (clears the interaction, so the clock stays at R; the bury's delay
//              rejects R+2), p2 [knife, button, click] landing R+3: the knife writes R+5, the click
//              continues at +2, the roll is on R+5. A 5-tick cycle with a bone in it, the best a bury
//              can do on this clock by reading.
// Bones are topped up with ::give (trade cost is measured in bones-wc.ts). A spot that moves keeps
// its index; a changed tile re-bootstraps on the nearest spot.
import { appendFileSync, writeFileSync } from 'fs';
import { hostname, loadavg } from 'os';
import type { BotWorldState } from '../../../sdk/types';
import { closeSession, openSession } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';

const argv = process.argv.slice(2);
const kv = (k: string, d: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BOT = argv.find(a => !a.startsWith('-'))!;
const MODE = kv('mode', 'bury5');
const LEVEL = Number(kv('level', '70'));
const PRAYER = Number(kv('prayer', '43'));
const TICKS = Number(kv('ticks', '400'));
if (!['knife', 'knifebury', 'bury5'].includes(MODE)) { console.error('--mode=knife|knifebury|bury5'); process.exit(2); }
const CYCLE = MODE === 'bury5' ? 5 : 3;
const BURY = MODE !== 'knife';
const STAND: [number, number] = [3241, 3248];
const LOG = kv('log', `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/bones-fly-${MODE}-L${LEVEL}${kv('tag', '') ? '-' + kv('tag', '') : ''}.log`);
writeFileSync(LOG, `# bones-fly ${argv.join(' ')} host=${hostname()} load=${loadavg().map(x => x.toFixed(1)).join('/')} tickrate=${process.env.NODE_TICKRATE} at=${new Date().toISOString()}\n`);
const log = (l: string) => appendFileSync(LOG, l + '\n');
const xpOf = (s: BotWorldState, k: string) => s.skills.find(x => x.name.toLowerCase() === k)?.experience ?? 0;
const items = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).sort((a, b) => a.slot - b.slot);

const sess = await openSession(BOT, { pathfinding: false });
const sdk = sess.sdk;
await sess.bot.skipTutorial?.().catch(() => {});
for (const it of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(it.slot);
await waitTicks(sdk, 2);
for (const c of [`::setstat fishing ${LEVEL}`, `::setstat prayer ${PRAYER}`, '::give fly_fishing_rod 1', '::give feather 3000', '::give knife 1', '::give logs 1', ...(BURY ? ['::give dragon_bones 20'] : [])]) await sdk.sendSay(c);
const [sx, sz] = STAND;
for (let i = 0; i < 6 && !(sdk.getState()?.player?.worldX === sx && sdk.getState()?.player?.worldZ === sz); i++) {
    await sdk.sendSay(`::tele 0,${sx >> 6},${sz >> 6},${sx & 63},${sz & 63}`);
    await waitUntil(sdk, s => s.player?.worldX === sx && s.player?.worldZ === sz, { maxTicks: 8 });
}
await waitTicks(sdk, 4);
if (sdk.getState()?.dialog?.isOpen) await sdk.sendClickDialog(0);

type Spot = { index: number; op: number; tile: string };
const spots = (s: BotWorldState): Spot[] =>
    s.nearbyNpcs.filter(n => /^fishing spot$/i.test(n.name) && n.optionsWithIndex.some(o => /^lure$/i.test(o.text)))
        .sort((a, b) => a.distance - b.distance)
        .map(n => ({ index: n.index, op: n.optionsWithIndex.find(o => /^lure$/i.test(o.text))!.opIndex, tile: `${(n as any).tileX ?? n.x},${(n as any).tileZ ?? n.z}` }));
let current: Spot | null = null;
const s0 = sdk.getState()!;
const f0 = xpOf(s0, 'fishing'), p0x = xpOf(s0, 'prayer');
let lastF = f0, lastP = p0x, R: number | null = null, acted = -1, sinceXp = 0, moves = 0, resyncs = 0, sent = 0, buriesSent = 0;
const catches: number[] = [], buries: number[] = [], breaks: number[] = [];
const fire = (t: number, what: string, p: Promise<{ success: boolean; message?: string }>) => { sent++; log(`T${t} send ${what}`); p.then(r => { if (!r.success) log(`T${t} FAIL ${what}: ${r.message}`); }).catch(() => {}); };
const click = (s: BotWorldState) => { if (current) fire(s.tick, `click spot #${current.index}@${current.tile}`, sdk.sendInteractNpc(current.index, current.op)); };
const knife = (s: BotWorldState) => {
    const k = items(s, /^knife$/i)[0], l = items(s, /^logs$/i)[0];
    if (!l) { fire(s.tick, 'give logs (slip)', sdk.sendSay('::give logs 1')); return; }
    fire(s.tick, 'knife on logs', sdk.sendUseItemOnItem(k!.slot, l.slot));
    fire(s.tick, 'button 8889', sdk.sendClickComponent(8889) as Promise<{ success: boolean; message?: string }>);
};
const drop = (s: BotWorldState) => { const f = items(s, /^raw /i)[0]; if (f) fire(s.tick, `drop ${f.name}`, sdk.sendDropItem(f.slot)); };
const bury = (s: BotWorldState) => { const b = items(s, /^dragon bones$/i)[0]; if (b) { fire(s.tick, 'bury', sdk.sendUseItem(b.slot, b.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1)); buriesSent++; } };
const phase0 = (s: BotWorldState) => {
    if (MODE === 'bury5') { drop(s); bury(s); return; }
    knife(s); drop(s);
    if (MODE === 'knifebury') bury(s); else click(s);
};
const startTick = s0.tick;

await new Promise<void>(resolve => {
    const off = sdk.onStateUpdate(s => {
        if (!s?.inGame) return;
        const t = s.tick;
        const f = xpOf(s, 'fishing'), pr = xpOf(s, 'prayer');
        let rolled = false;
        if (f > lastF) { catches.push(t); log(`T${t} FISH +${(f - lastF) / 25}`); lastF = f; rolled = true; }
        if (pr > lastP) { buries.push(t); lastP = pr; log(`T${t} PRAYER`); }
        if (t - startTick >= TICKS) { off(); resolve(); return; }
        if (acted === t) return;
        acted = t;
        if (BURY && items(s, /^dragon bones$/i).length < 4) fire(t, 'give bones (trade stand-in)', sdk.sendSay('::give dragon_bones 8'));
        const all = spots(s);
        const cur = current && all.find(x => x.index === current!.index);
        if (current && (!cur || cur.tile !== current.tile)) { moves++; log(`T${t} MOVE ${current.tile} -> ${cur?.tile ?? 'gone'}`); current = null; R = null; }
        if (!current) current = all[0] ?? null;
        if (!current) return;
        if (rolled) { R = t; sinceXp = 0; }
        if (R === null) { phase0(s); R = t; breaks.push(t); log(`T${t} bootstrap`); return; }
        while (t - R >= CYCLE) { R += CYCLE; sinceXp++; }
        if (sinceXp > 8) { resyncs++; log(`T${t} resync`); R = null; sinceXp = 0; return; }
        const p = t - R;
        if (p === 0) { phase0(s); return; }
        if (p === 2 && MODE === 'knifebury') click(s);
        if (p === 2 && MODE === 'bury5') { knife(s); click(s); }
        if (p === 1 && MODE === 'knife' && s.dialog?.isOpen) { fire(t, 'dismiss', sdk.sendClickDialog(0)); click(s); }
    });
});

const span = sdk.getState()!.tick - startTick;
const gaps: number[] = [];
for (let i = 1; i < catches.length; i++) if (!breaks.some(b => b >= catches[i - 1]! && b < catches[i]!)) gaps.push(catches[i]! - catches[i - 1]!);
const h: Record<number, number> = {};
for (const g of gaps) h[g] = (h[g] ?? 0) + 1;
const fBase = (lastF - f0) / 25;
const out = [
    `== bones-fly ${MODE} L${LEVEL} (NODE_TICKRATE=${process.env.NODE_TICKRATE}, host ${hostname()}, load ${loadavg().map(x => x.toFixed(1)).join('/')}) ==`,
    `span ${span}; catches ${catches.length} = ${(span / Math.max(1, catches.length)).toFixed(2)} ticks per catch; base fishing ${fBase} = ${(fBase / span).toFixed(3)} per tick`,
    `catch gaps (no rebuild inside) ${Object.entries(h).map(([k, v]) => `${k}:${v}`).join(' ')}`,
    `bones buried ${buries.length} of ${buriesSent} = ${(buries.length / span).toFixed(3)} per tick; spot moves ${moves}; resyncs ${resyncs}; packets ${sent}`,
    `RESULT ${JSON.stringify({ mode: MODE, level: LEVEL, span, catches: catches.length, fBase, fPerTick: fBase / span, bones: buries.length, bonesPerTick: buries.length / span, moves, resyncs, gaps: h })}`
].join('\n');
log(out);
console.log(out);
await closeSession(sess).catch(() => {});
process.exit(0);
