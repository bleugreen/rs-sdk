// The shelf reader's read-only guarantee. The role never holds the raw bot or
// SDK: it gets these views, which refuse every buy, sell, Grand Exchange, trade
// and drop method by name, so neither the reader nor a speedrun helper it
// passes them to can spend or move an item. The one inventory-button click the
// reader needs, the shop's Value option, is allowed only on the shop's own
// stock component with option 1; options 2-4 there are Buy 1/5/10
// (shop.rs2 [inv_button2..4,shop_template:inv]).
//
// read-only.test.ts checks the refusals; shelf-reader.test.ts checks that the
// reader's sources never name a trading method in the first place.

/** The shop's stock inventory (shop_template:inv, StateCollector SHOP_TEMPLATE_INV_ID). */
export const SHOP_STOCK_COMPONENT = 3900;
/** INV_BUTTON1 on the shop's stock: "Value", answered with a game message and nothing else. */
export const VALUE_OPTION = 1;

/**
 * Method names the views refuse. Matched against every property read, so a
 * method added to the SDK later under one of these words is refused too.
 */
const REFUSED = [/shop(buy|sell)/i, /(buy|sell)(from|to)?shop/i, /GE[A-Z]|GE$/, /trade/i, /drop/i, /(offer|retract)item/i, /^(buy|sell)/i];

export function isRefused(name: string): boolean {
    return REFUSED.some(re => re.test(name));
}

export class ReadOnlyViolation extends Error {}

function view<T extends object>(target: T, label: string, check?: (name: string, args: unknown[]) => void): T {
    return new Proxy(target, {
        get(t, prop) {
            const name = String(prop);
            if (typeof prop === 'string' && isRefused(name)) {
                return () => {
                    throw new ReadOnlyViolation(`shelf reader is read-only: ${label}.${name} refused`);
                };
            }
            const v = Reflect.get(t, prop, t) as unknown;
            if (typeof v !== 'function') return v;
            // Bound to the real object: the SDK's own internals keep working unchanged.
            const fn = (v as (...a: unknown[]) => unknown).bind(t);
            return check
                ? (...args: unknown[]) => {
                      check(name, args);
                      return fn(...args);
                  }
                : fn;
        }
    });
}

/** The SDK, without its trading methods, and with inventory-button clicks limited to the shop's Value option. */
export function readOnlySdk<T extends object>(sdk: T): T {
    return view(sdk, 'sdk', (name, args) => {
        if (name !== 'sendClickComponentWithOption') return;
        const [component, option] = args as [number, number | undefined];
        if (component !== SHOP_STOCK_COMPONENT || (option ?? 1) !== VALUE_OPTION) {
            throw new ReadOnlyViolation(`shelf reader is read-only: inventory button ${option ?? 1} on component ${component} refused (only Value, option ${VALUE_OPTION} on ${SHOP_STOCK_COMPONENT})`);
        }
    });
}

/** The bot actions, without their trading methods. */
export function readOnlyBot<T extends object>(bot: T): T {
    return view(bot, 'bot');
}
