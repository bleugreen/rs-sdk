// Lab case for logoutClean on the lite client when nothing but the world confirms (rs/461's case,
// rs/511): attach to lab.sh's own lite runner (no child of this process), so the logout is confirmed
// by the published state, the gateway or, failing both, /playerpositions ('world').
//
//   NODE_TICKRATE=400 SPEEDRUN_TICK_MS=400 speedrun/lab/lab.sh <bot> speedrun/lab/lite-logout.ts
//
// RESULT: logoutClean's result (confirmedBy, sends, confirmTicks), and each signal read once after.
import { hostname } from 'os';
import { gatewayStatus, loggedOutBy, logoutClean, openSession } from '../lib/session';
import { demoOrigin, listedInWorld } from '../lib/demo-status';
import { tickMs } from '../lib/wait';
import { leaveTutorial } from './setup';

const bot = process.argv[2]!;
const s = await openSession(bot, { pathfinding: false });
await leaveTutorial(s);
const r = await logoutClean(s);
const after = {
    state: s.sdk.getState()?.inGame ?? null,
    gateway: await gatewayStatus(s),
    listed: await listedInWorld(demoOrigin(s.env.SERVER), s.env.BOT_USERNAME),
    loggedOutBy: await loggedOutBy(s, { world: true }),
};
console.log(`RESULT lite-logout ${JSON.stringify({ host: hostname(), tickMs: tickMs(), logout: r, after })}`);
process.exit(r.ok ? 0 : 1);
