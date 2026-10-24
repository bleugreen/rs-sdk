import { abortable, executionContext } from '../../sdk/execution-context';
import type { BotWorldState } from '../../sdk/types';
import type { Role, RoleContext } from '../../speedrun/helpers/role';

/**
 * Run `role` under `ctx` until `stop` names a reason (checked on every published state), the role returns, or
 * `ctx.signal` aborts (rethrown). Returns the reason, or 'returned'. Aborting the role mid-errand is safe for the
 * roles markets drives: each re-plans from the state it finds when it starts.
 */
export async function runRoleUntil(role: Role, ctx: RoleContext, stop?: (s: BotWorldState) => string | null): Promise<string> {
    const parent = ctx.signal;
    const ctl = new AbortController();
    const onParent = () => ctl.abort(parent.reason);
    parent.addEventListener('abort', onParent, { once: true });
    if (parent.aborted) onParent();
    let why: string | null = null;
    const check = (s: BotWorldState | null) => {
        if (why || !stop || !s?.inGame || !s.player) return;
        const r = stop(s);
        if (r) {
            why = r;
            ctl.abort(new Error(r));
        }
    };
    check(ctx.sdk.getState());
    const off = ctx.sdk.onStateUpdate(check);
    try {
        if (!ctl.signal.aborted) await executionContext.run({ signal: ctl.signal }, () => abortable(role.run({ ...ctx, signal: ctl.signal })));
    } catch (e) {
        if (!ctl.signal.aborted) throw e;
    } finally {
        off();
        parent.removeEventListener('abort', onParent);
    }
    parent.throwIfAborted();
    return why ?? 'returned';
}
