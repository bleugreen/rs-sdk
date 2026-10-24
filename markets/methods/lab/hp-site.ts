// Site probe for the Hitpoints trainer (docs/markets/hp-training.md): is a melee target
// reachable, what does it do to a Defence-1 account, and how fast does it give damage.
//
//   speedrun/lab/lab.sh <bot> markets/methods/lab/hp-site.ts:--site=crabs:--ticks=600:--att=40:--str=40:--hp=40
//
// Staged by staff cheats (::setstat, ::give, ::tele): a site comparison only, never the
// fresh-account measurement (lab/hp-run.ts does that). For the crabs it first walks from
// Seers' bank to the crabs and back, timing both legs.
import type { BotWorldState } from '../../../sdk/types';
import { closeSession, openSession } from '../../../speedrun/lib/session';
import { waitTicks } from '../../../speedrun/lib/wait';
import { arg, botArg, result } from '../../../speedrun/lab/common';
import { clearInventory, give, leaveTutorial, mustTele, setStats } from '../../../speedrun/lab/setup';
import { SITES, type SiteId } from '../hp-train';
import { fightFor } from '../hp-train';

const site = SITES[arg('site', 'crabs') as SiteId];
if (!site) throw new Error(`--site must be one of ${Object.keys(SITES).join(', ')}`);
const ticks = Number(arg('ticks', '600'));
const session = await openSession(botArg());
const { sdk, bot } = session;
await leaveTutorial(session);
await waitTicks(sdk, 2);
await setStats(sdk, { attack: Number(arg('att', '40')), strength: Number(arg('str', '40')), hitpoints: Number(arg('hp', '40')), defence: 1 });
await clearInventory(sdk);
await give(sdk, arg('weapon', 'mithril_scimitar'));
const w = sdk.getState()!.inventory.find(i => /scimitar|sword/i.test(i.name));
if (w) await bot.equipItem(w);
await waitTicks(sdk, 2);
const t = (s: BotWorldState | null) => s?.tick ?? 0;

if (site.bank && arg('walk', '1') === '1') {
    await mustTele(sdk, site.bank.x, site.bank.z);
    const t0 = t(sdk.getState());
    const r = await bot.walkTo(site.centre.x, site.centre.z, 4, { timeout: 400_000 });
    const p = sdk.getState()!.player!;
    result('walk-out', { ok: r.success, message: r.message, ticks: t(sdk.getState()) - t0, at: [p.worldX, p.worldZ] });
} else await mustTele(sdk, site.centre.x, site.centre.z);

if (Number(arg('kebabs', '0'))) await give(sdk, 'kebab', Number(arg('kebabs', '0')));
// Per tick: awake crabs beside us (1 tile), and in combat within 3; HP and kebabs every 25 ticks.
const adjacent: Record<number, number> = {};
let lastT = -1;
const offDiag = sdk.onStateUpdate(st => {
    if (!st.player || st.tick === lastT) return;
    lastT = st.tick;
    const near = st.nearbyNpcs.filter(n => site.npc.test(n.name) && n.hp !== 0 && n.distance <= 1).length;
    adjacent[near] = (adjacent[near] ?? 0) + 1;
    if (st.tick % 25 === 0) console.log(`DIAG ${st.tick} hp ${st.player.hp}/${st.player.maxHp} kebabs ${st.inventory.filter(i => /^kebab$/i.test(i.name)).length} adjacent ${near} inCombatNear ${st.nearbyNpcs.filter(n => site.npc.test(n.name) && n.inCombat && n.distance <= 3).length} hits ${st.combatEvents.filter(e => e.type === 'damage_taken' && e.tick >= st.tick - 25).map(e => `${e.sourceIndex}:${e.damage}`).join(',')}`);
});
const s0 = sdk.getState()!;
result('npcs', s0.nearbyNpcs.filter(n => site.npc.test(n.name) || /^rocks$/i.test(n.name)).map(n => ({ name: n.name, x: n.x, z: n.z, ops: n.optionsWithIndex.map(o => o.text) })));
const f = await fightFor(sdk, bot, site, { maxTicks: ticks, food: /^kebab$/i, eatAt: 8, eatHalf: true, log: (m, d) => console.log(`LOG ${m} ${JSON.stringify(d ?? {})}`) });
offDiag();
result('fight', { ...f, adjacentTicks: adjacent });

if (site.bank && arg('walk', '1') === '1') {
    const t0 = t(sdk.getState());
    const r = await bot.walkTo(site.bank.x, site.bank.z, 3, { timeout: 400_000 });
    result('walk-back', { ok: r.success, message: r.message, ticks: t(sdk.getState()) - t0 });
}
await closeSession(session);
process.exit(0);
