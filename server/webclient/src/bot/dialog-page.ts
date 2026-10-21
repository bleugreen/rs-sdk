import IfType from '#/config/IfType.js';

type DialogClient = { chatModalId: number };

// Tokens belong to the client instance, not an interface ID: servers reuse the
// same interface and button IDs for successive dialogue pages.
//
// A page keeps its token after its Continue is sent. Waiting for the server is
// published as `isWaiting`, and ActionExecutor refuses guarded clicks while it
// holds; minting a new token instead would make the spent page look like the
// next one to anything that watches for the id to change.
const pages = new WeakMap<object, { signature: string; token: string }>();
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let revision = 0;

export function invalidateDialogPage(client: object): void {
    pages.delete(client);
}

/** Call after text/hide packets too, so an unsampled A -> B -> A stays stale. */
export function getDialogPageId(instance: object): string | undefined {
    const client = instance as DialogClient;
    if (typeof client.chatModalId !== 'number' || client.chatModalId === -1) {
        invalidateDialogPage(client);
        return undefined;
    }

    const components: unknown[] = [];
    const seen = new Set<number>();
    const visit = (id: number): void => {
        if (seen.has(id)) return;
        seen.add(id);
        const com = IfType.list[id];
        if (!com) return;
        components.push([id, com.text, com.buttonText, com.buttonType, com.hide, com.children]);
        if (com.children) for (const child of com.children) visit(child);
    };
    visit(client.chatModalId);
    if (!components.length) {
        invalidateDialogPage(client);
        return undefined;
    }

    const signature = JSON.stringify([client.chatModalId, components]);
    let page = pages.get(client);
    if (!page || page.signature !== signature) {
        page = { signature, token: `${session}:${++revision}` };
        pages.set(client, page);
    }
    return page.token;
}
