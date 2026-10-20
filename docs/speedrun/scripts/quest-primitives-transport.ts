// Transport timing: ships (Port Sarim <-> Karamja, Port Sarim -> Entrana,
// Ardougne -> Brimhaven), the gnome glider and the Shantay Pass. Ticks from
// the first click (talk to the NPC) to arrival, split into the dialogue and the
// ride, plus disembarking where the ship lands you on its deck.
// Run: bun docs/speedrun/scripts/quest-primitives-transport.ts <botname> [route]
// Routes: karamja entrana brimhaven musa glider shantay

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { cheat, give, invCount, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';

const ONLY = process.argv[3];
const far = (p0: ReturnType<typeof pos>, d = 20) => (s: BotWorldState) => { const p = pos(s); return p.level !== p0.level || Math.abs(p.x - p0.x) + Math.abs(p.z - p0.z) > d; };

/** Answer a conversation as fast as possible; resolves when `until` holds. */
async function converse(sdk: BotSDK, start: () => Promise<unknown>, answers: RegExp[], until: (s: BotWorldState) => boolean, maxTicks = 120) {
    let lastPage = '';
    let pages = 0, choices = 0, lastDialogTick = -1, firstDialogTick = -1;
    const unsub = sdk.onStateUpdate(s => {
        const d = s.dialog;
        if (!d.isOpen || d.isWaiting || !d.pageId || d.pageId === lastPage) return;
        lastPage = d.pageId;
        if (firstDialogTick < 0) firstDialogTick = s.tick;
        lastDialogTick = s.tick;
        if (d.options.length > 1) {
            const opt = d.options.find(o => answers.some(a => a.test(o.text)));
            if (!opt) { console.log('NO ANSWER for', d.options.map(o => o.text)); return; }
            choices++;
            void sdk.sendClickDialog(opt.index);
        } else {
            pages++;
            void sdk.sendClickDialog(0);
        }
    });
    const t0 = now(sdk);
    await start();
    const r = await waitUntil(sdk, until, maxTicks);
    unsub();
    return { t0, arriveTick: r?.tick ?? null, total: r ? r.tick - t0 : null, pages, choices, firstDialog: firstDialogTick - t0, lastDialogToArrive: r && lastDialogTick >= 0 ? r.tick - lastDialogTick : null, at: pos(r?.state ?? sdk.getState()), coinsSpent: 0 };
}

async function talk(sdk: BotSDK, npc: RegExp) {
    const n = sdk.findNearbyNpc(npc);
    if (!n) throw new Error('npc not found ' + npc + ' near ' + JSON.stringify(pos(sdk.getState())) + ': ' + sdk.getState()!.nearbyNpcs.map(x => x.name).join(','));
    const op = n.optionsWithIndex.find(o => /talk/i.test(o.text))!;
    await sdk.sendInteractNpc(n.index, op.opIndex);
}

/** Cross the gangplank off a ship deck (level 1) and time it. */
async function disembark(sdk: BotSDK) {
    // close the arrival mesbox first if it is still up (counted separately)
    let mesbox = 0;
    const t0 = now(sdk);
    if (sdk.getState()!.dialog.isOpen) {
        await waitUntil(sdk, s => !s.dialog.isWaiting, 5);
        await sdk.sendClickDialog(0);
        mesbox = 1;
        await waitUntil(sdk, s => !s.dialog.isOpen, 10);
    }
    const t1 = now(sdk);
    const plank = sdk.getState()!.nearbyLocs.filter(l => /gangplank/i.test(l.name) && l.optionsWithIndex.some(o => /cross/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
    if (!plank) return { error: 'no gangplank', mesbox };
    const p0 = pos(sdk.getState());
    await sdk.sendInteractLoc(plank.x, plank.z, plank.id, plank.optionsWithIndex.find(o => /cross/i.test(o.text))!.opIndex);
    const r = await waitUntil(sdk, s => pos(s).level !== p0.level, 20);
    return { mesboxTicks: t1 - t0, plankDist: plank.distance, crossTicks: r ? r.tick - t1 : null, total: r ? r.tick - t0 : null, at: pos(r?.state ?? sdk.getState()) };
}

await runScript(async ({ sdk }) => {
    if (invCount(sdk.getState(), /^coins$/i) < 1000) await give(sdk, 'coins', 10000);
    console.log('coins', invCount(sdk.getState(), /^coins$/i));
    const want = (r: string) => !ONLY || ONLY === r;
    const out: Record<string, unknown> = {};

    const ship = async (name: string, starts: { x: number; z: number } | Array<{ x: number; z: number }>, npc: RegExp, answers: RegExp[]) => {
        const runs = [];
        const cands = Array.isArray(starts) ? starts : [starts];
        for (let i = 0; i < 2; i++) {
            // first start tile from which the NPC is reachable
            for (const from of cands) {
                await tele(sdk, from.x, from.z);
                await waitTicks(sdk, 3);
                if (sdk.findNearbyNpc(npc, { reachable: true } as any)) break;
            }
            const c0 = invCount(sdk.getState(), /^coins$/i);
            const p0 = pos(sdk.getState());
            const ride = await converse(sdk, () => talk(sdk, npc), answers, far(p0, 40));
            ride.coinsSpent = c0 - invCount(sdk.getState(), /^coins$/i);
            await waitTicks(sdk, 1);
            const off = pos(sdk.getState()).level === 1 ? await disembark(sdk) : null;
            runs.push({ ride, disembark: off });
            console.log(name, JSON.stringify(runs[runs.length - 1]));
        }
        out[name] = runs;
        result(`transport.${name}`, runs);
    };

    if (want('karamja')) await ship('portSarimToKaramja', { x: 3029, z: 3217 }, /^(seaman lorris|seaman thresnor|captain tobias)$/i, [/^Yes please/]);
    if (want('musa')) await ship('karamjaToPortSarim', [{ x: 2954, z: 3146 }, { x: 2955, z: 3146 }, { x: 2956, z: 3147 }, { x: 2953, z: 3147 }, { x: 2954, z: 3148 }, { x: 2956, z: 3146 }], /^customs officer$/i, [/journey on this ship/i, /Search away/i, /^Ok\.?$/]);
    if (want('brimhaven')) await ship('ardougneToBrimhaven', { x: 2681, z: 3276 }, /^captain barnaby$/i, [/^Yes please/]);
    if (want('entrana')) {
        // Entrana bans weapons and armour: drop everything but runes and coins.
        for (const it of [...sdk.getState()!.inventory].reverse()) if (!/rune$|^coins$/i.test(it.name)) { await sdk.sendDropItem(it.slot); await waitTicks(sdk, 1); }
        await ship('portSarimToEntrana', { x: 3047, z: 3234 }, /^monk of entrana$/i, [/^Yes, okay, I'm ready/]);
    }
    if (want('glider')) {
        await cheat(sdk, 'setvar grandtree 160'); await waitTicks(sdk, 1);
        const runs = [];
        for (const [dest, comp] of [['kar_hewo', 828], ['gandius', 824]] as const) {
            await tele(sdk, 2465, 3499, 3);
            await waitTicks(sdk, 3);
            const p0 = pos(sdk.getState());
            const t0 = now(sdk);
            const r = await converse(sdk, () => talk(sdk, /^captain errdo$|pilot/i), [/take me on the glider/i], s => s.modalOpen, 40);
            const tMap = now(sdk);
            await sdk.sendClickComponent(comp);
            const a = await waitUntil(sdk, far(p0, 40), 20);
            runs.push({ dest, dialogue: { pages: r.pages, choices: r.choices, ticksToMap: tMap - t0 }, mapClickToArrive: a ? a.tick - tMap : null, total: a ? a.tick - t0 : null, at: pos(a?.state ?? sdk.getState()) });
            console.log('glider', JSON.stringify(runs[runs.length - 1]));
        }
        out.glider = runs;
        result('transport.glider', runs);
    }
    if (want('shantay')) {
        const runs = [];
        for (let i = 0; i < 3; i++) {
            if (invCount(sdk.getState(), /shantay pass/i) < 1) await give(sdk, 'shantay_pass', 5);
            await tele(sdk, 3304, 3119);
            await waitTicks(sdk, 3);
            const gate = sdk.getState()!.nearbyLocs.find(l => /shantay pass/i.test(l.name) && l.optionsWithIndex.some(o => /go-through/i.test(o.text)));
            if (!gate) { runs.push({ error: 'no gate' }); continue; }
            const p0 = pos(sdk.getState());
            const disc = invCount(sdk.getState(), /disclaimer/i) > 0;
            const r = await converse(sdk, () => sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find(o => /go-through/i.test(o.text))!.opIndex), [/poster doesn't scare me/i], s => pos(s).z < p0.z - 3 && !s.dialog.isOpen, 60);
            runs.push({ hadDisclaimer: disc, gateDist: gate.distance, ...r });
            console.log('shantay', JSON.stringify(runs[runs.length - 1]));
            // north-bound: free and no dialogue
            await waitTicks(sdk, 2);
            const g2 = sdk.getState()!.nearbyLocs.find(l => /shantay pass/i.test(l.name));
            if (g2) {
                const q0 = pos(sdk.getState());
                const t0 = now(sdk);
                await sdk.sendInteractLoc(g2.x, g2.z, g2.id, g2.optionsWithIndex.find(o => /go-through/i.test(o.text))!.opIndex);
                const b = await waitUntil(sdk, s => pos(s).z > q0.z + 2, 20);
                runs.push({ northbound: true, from: q0, ticks: b ? b.tick - t0 : null });
                console.log('shantay north', JSON.stringify(runs[runs.length - 1]));
            }
        }
        out.shantay = runs;
        result('transport.shantay', runs);
    }
}, { timeout: 900_000 });
