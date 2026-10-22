# Enchant (amulets of magic and strength)

`speedrun/helpers/enchant.ts` (role `enchant`) casts the Enchant spells on the strung amulets
in its own bank, banks the products, and stops. The scored run's **H7 (amulet of magic)** and
**H22 (amulet of strength)** are made this way from the [jeweller](jeweller.md)'s strung
sapphire and ruby amulets.

```
ROLE_OPTIONS='{"bank":{"x":3185,"z":3436},"max":{"sapphire":1,"ruby":1}}' bun speedrun/helpers/enchant.ts cairn_h88
```

| Option | Default | Meaning |
|---|---|---|
| `bank` | the nearest booth in reach | `{ x, z }` of the bank to work at; reached with `travelTo` |
| `max` | every one banked | `{ sapphire?, ruby? }`: the most of each amulet to enchant |

## Spells and items

From `server/content` (`magic_spells.dbrow`, `obj.pack`); `enchant.test.ts` pins both.

| Amulet (strung) | Spell | Magic | Runes per cast | Product |
|---|---|---|---|---|
| Sapphire amulet, obj 1694 | Lvl-1 Enchant | 7 | 1 water, 1 cosmic | Amulet of magic, obj 1727 |
| Ruby amulet, obj 1698 | Lvl-3 Enchant | 49 | 5 fire, 1 cosmic | Amulet of strength, obj 1725 |

A strung amulet has the same name as its unstrung one ("Sapphire amulet", ids 1694 and 1675),
so the role, and any handover that moves the amulets, goes by obj id. The products' names are
unique, so a handover can name them.

## How it runs

Each bank visit empties the inventory into the bank, reads the plan from the bank alone
(`enchantPlan`: every strung amulet up to `max`, as many as fit beside one slot per rune
stack), withdraws the amulets and runes, closes the bank, and casts. A rerun after a stop or a
relog enchants whatever is still unenchanted, so the role keeps no role state. It finishes when
a visit finds nothing to cast.

- **All or nothing per visit.** If the Magic level is below any planned spell, or the bank is
  short of any rune, nothing is withdrawn and the role finishes with an attention line naming
  what is short. An elemental staff is not counted.
- **Casts wait out the cast delay.** `bot.enchantItem` returns on the cast's xp, while the
  cast's delay still holds the player for `CAST_DELAY_TICKS` (skills/magic.ts). A second cast
  clicked inside it is dropped by the server and times out, so the role waits that out first.
- A visit that makes nothing stops the role with an attention line instead of repeating itself.

## Done for attempt 1 (2026-10-22, cairn://p/rs/442)

Caster cairn_h88 (Magic 66), borrowed from its standalone guild-wait. It received the amulets
and one water rune from cairn_h80 (a direct-path handover by id) and 2 cosmic + 5 fire from
cairn_mule1's surplus (a fleet one-shot with `--return`). It enchanted both at Varrock west
bank at 18:14Z and handed them to cairn_mule1, which banks Amulet of magic 1 and Amulet of
strength 1 (18:15:47Z). The second cast of that run was clicked inside the first cast's delay
and timed out; the role recovered on its next bank visit, and the wait above now prevents it.
