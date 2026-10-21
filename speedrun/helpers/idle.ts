// Idle: hold an account logged in and do nothing but log a heartbeat. Used to
// park an account under the fleet (so nothing else logs it in) and to measure
// what the fleet itself costs per account. It does not skip the tutorial, so a
// fresh account waits on Tutorial Island, out of everybody's way.
import { runStandalone, type Role } from './role';

export const role: Role = {
    name: 'idle',
    produces: [],
    async run(ctx) {
        const minutes = typeof ctx.options.heartbeatMinutes === 'number' ? ctx.options.heartbeatMinutes : 5;
        while (!ctx.signal.aborted) {
            const p = ctx.sdk.getState()?.player;
            ctx.log('idle', { x: p?.worldX, z: p?.worldZ, stateAgeMs: ctx.sdk.getStateAge() });
            await new Promise<void>(resolve => {
                const t = setTimeout(resolve, minutes * 60_000);
                ctx.signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
            });
        }
    }
};

if (import.meta.main) await runStandalone(role);
