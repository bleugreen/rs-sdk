// Read-only look at bones dev accounts through the dev gateway (observe mode never takes control).
//   bun docs/speedrun/scripts/bones-dev/peek.ts ACCOUNT [ACCOUNT...]   (from the dev copy's root)
import { BotSDK } from '../../../../sdk/index';

const port = process.env.BONES_PORT ?? '7782';
for (const account of process.argv.slice(2)) {
    const sdk = new BotSDK({ botUsername: account, gatewayUrl: `ws://127.0.0.1:${port}`, connectionMode: 'observe', autoReconnect: false, autoLaunchBrowser: false, showChat: false, readyTimeout: 0 });
    try {
        await sdk.connect();
        const s = await sdk.waitForCondition(st => !!st.player, 10_000);
        const p = s.player!;
        const hp = s.skills.find(k => k.name === 'Hitpoints');
        console.log(JSON.stringify({
            account, tick: s.tick, at: [p.worldX, p.worldZ, p.level], hp: `${hp?.level}/${hp?.baseLevel}`, inCombat: p.combat?.inCombat, anim: p.animId,
            inv: s.inventory.map(i => i.name + (i.count > 1 ? ` x${i.count}` : '')).join(', '),
            npcs: s.nearbyNpcs.slice(0, 10).map(n => `${n.name}@${n.x},${n.z}${n.inCombat ? '*' : ''}`).join(' '),
            players: s.nearbyPlayers.slice(0, 8).map(q => q.name).join(', '),
            msgs: s.gameMessages.slice(-4).map(m => m.text), dialog: s.dialog?.isOpen
        }));
    } catch (e) {
        console.log(JSON.stringify({ account, error: String(e) }));
    }
    await sdk.disconnect().catch(() => undefined);
}
process.exit(0);
