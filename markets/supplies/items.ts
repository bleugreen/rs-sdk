// The speedrun supplies this table prices: every stockpile line of docs/speedrun/SUPPLIES.md section 2
// that names an item, the quest items the fleet's quest-item gatherer buys at shops
// (speedrun/helpers/questitems.ts), and a few neighbours markets asks about (nature runes, raw shark,
// cut gems). `need` is the scored run's count from SUPPLIES.md section 2 (one attempt), null where the
// item is not a run total.

export type Group = 'Runes' | 'Arrows and fletching' | 'Potions' | 'Food' | 'Gems and jewellery' | 'Staves' | 'Bars and ores' | 'Skill supplies' | 'Gear and tools' | 'Quest items';

export interface Supply {
    /** The obj's display name (`name=`), or the label shown when `obj` pins the obj. */
    name: string;
    /** The obj's debugname, where the display name is shared (`Unfinished potion`, `Logs`). */
    obj?: string;
    group: Group;
    need: number | null;
    /** Shown beside the need: where the count comes from, or why there is none. */
    note?: string;
}

const s = (group: Group, name: string, need: number | null, note?: string, obj?: string): Supply => ({ group, name, need, note, obj });

export const SUPPLIES: Supply[] = [
    s('Runes', 'Blood rune', 570, 'Kolodion 70 + Charge 500'),
    s('Runes', 'Death rune', 110),
    s('Runes', 'Chaos rune', 40),
    s('Runes', 'Law rune', 55, '~55: the run\'s teleports'),
    s('Runes', 'Cosmic rune', 60),
    s('Runes', 'Air rune', 1650, '~1,650'),
    s('Runes', 'Fire rune', 85, '80 + ~5'),
    s('Runes', 'Water rune', 40, '~40'),
    s('Runes', 'Earth rune', 55, '50 + ~5'),
    s('Runes', 'Mind rune', null, 'helper Magic training only'),
    s('Runes', 'Nature rune', null, 'not on the list (alching)'),

    s('Arrows and fletching', 'Rune arrow', 200, 'Monkey Madness'),
    s('Arrows and fletching', 'Rune arrowtips', 570),
    s('Arrows and fletching', 'Adamant arrowtips', 2220),
    s('Arrows and fletching', 'Mithril arrowtips', 1485),
    s('Arrows and fletching', 'Steel arrowtips', 135),
    s('Arrows and fletching', 'Iron arrowtips', 90),
    s('Arrows and fletching', 'Bronze arrowtips', 60),
    s('Arrows and fletching', 'Headless arrow', 4560),
    s('Arrows and fletching', 'Arrow shaft', 4560, 'inside the headless arrows'),
    s('Arrows and fletching', 'Feather', 5140, '580 to SCORED + 4,560 in headless arrows'),

    s('Potions', 'Prayer potion(4)', 5),
    s('Potions', 'Superantipoison(4)', 2),
    s('Potions', 'Antipoison(4)', 3, '2 + the combat kit\'s 1'),
    s('Potions', 'Antipoison(3)', null, 'the shop\'s dose; H7 takes any dose'),
    s('Potions', 'Agility potion(4)', 1),
    s('Potions', 'Magic potion(4)', 1),
    s('Potions', 'Super attack(4)', 1),
    s('Potions', 'Super strength(4)', 1),
    s('Potions', 'Ranging potion(4)', null, 'none planned; only if a bid fills'),

    s('Food', 'Shark', 60, '~60'),
    s('Food', 'Raw shark', null, 'cook to sharks'),
    s('Food', 'Swordfish', null, 'fallback food'),
    s('Food', 'Lobster', null, 'fallback food'),
    s('Food', 'Cooked karambwan', null, 'fallback food', 'tbwt_cooked_karambwan'),
    s('Food', 'Cake', null, 'the knights\' stall food'),

    s('Gems and jewellery', 'Sapphire ring', 12),
    s('Gems and jewellery', 'Emerald ring', 27),
    s('Gems and jewellery', 'Ruby ring', 16),
    s('Gems and jewellery', 'Diamond ring', 5),
    s('Gems and jewellery', 'Amulet of magic', 1),
    s('Gems and jewellery', 'Amulet of strength', 1),
    s('Gems and jewellery', 'Gold bar', null, '1 per ring or amulet (62) + Monkey Madness 1'),
    s('Gems and jewellery', 'Uncut diamond', 391, 'Crafting'),
    s('Gems and jewellery', 'Uncut ruby', null),
    s('Gems and jewellery', 'Uncut emerald', null),
    s('Gems and jewellery', 'Uncut sapphire', null),
    s('Gems and jewellery', 'Diamond', null, 'cut: for the rings'),
    s('Gems and jewellery', 'Ruby', null, 'cut: for the rings'),
    s('Gems and jewellery', 'Emerald', null, 'cut: for the rings'),
    s('Gems and jewellery', 'Sapphire', null, 'cut: for the rings'),

    s('Staves', 'Staff of water', 1),
    s('Staves', 'Staff of fire', 1),
    s('Staves', 'Staff of air', null),

    s('Bars and ores', 'Adamantite bar', 365),
    s('Bars and ores', 'Mithril bar', 305),
    s('Bars and ores', 'Steel bar', 120),
    s('Bars and ores', 'Iron bar', 39),
    s('Bars and ores', 'Bronze bar', 15),
    s('Bars and ores', 'Adamantite ore', null, '365 bars need 365 + 2,190 coal'),
    s('Bars and ores', 'Mithril ore', null),
    s('Bars and ores', 'Iron ore', null),
    s('Bars and ores', 'Coal', null),

    s('Skill supplies', 'Rune essence', 5427),
    s('Skill supplies', 'Dragon bones', 555),
    s('Skill supplies', 'Babydragon bones', null, 'the bone mix\'s filler'),
    s('Skill supplies', 'Grapes', 520, 'one per wine (520 held)'),
    s('Skill supplies', 'Jug of water', 520, 'one per wine'),
    s('Skill supplies', 'Eye of newt', 481),
    s('Skill supplies', 'Limpwurt root', 249),
    s('Skill supplies', 'Snape grass', 206),
    s('Skill supplies', 'Vial of water', null, 'one per unfinished potion'),
    s('Skill supplies', 'Guam potion (unf)', 358, undefined, 'guamvial'),
    s('Skill supplies', 'Tarromin potion (unf)', 198, undefined, 'tarrominvial'),
    s('Skill supplies', 'Ranarr potion (unf)', 128, undefined, 'ranarrvial'),
    s('Skill supplies', 'Irit potion (unf)', 82, undefined, 'iritvial'),
    s('Skill supplies', 'Avantoe potion (unf)', 60, undefined, 'avantoevial'),
    s('Skill supplies', 'Kwuarm potion (unf)', 50, undefined, 'kwuarmvial'),
    s('Skill supplies', 'Magic logs', 107, 'Firemaking'),
    s('Skill supplies', 'Yew logs', 24),
    s('Skill supplies', 'Maple logs', 13),
    s('Skill supplies', 'Willow logs', 7),
    s('Skill supplies', 'Oak logs', 4),
    s('Skill supplies', 'Logs', 10, 'Firemaking 2 + 8 other', 'logs'),

    s('Gear and tools', 'Rune axe', 1),
    s('Gear and tools', 'Rune pickaxe', 1),
    s('Gear and tools', 'Mithril scimitar', 1),
    s('Gear and tools', 'Adamant full helm', 1),
    s('Gear and tools', 'Magic shortbow', 1, undefined, 'magic_shortbow'),
    s('Gear and tools', 'Knife', 1),
    s('Gear and tools', 'Fly fishing rod', 1),
    s('Gear and tools', 'Fishing rod', 1),
    s('Gear and tools', 'Fishing bait', 4),
    s('Gear and tools', 'Chisel', 1),
    s('Gear and tools', 'Hammer', 1),
    s('Gear and tools', 'Cannonball', 1270, 'restricted: Dwarf Cannon', 'mcannonball'),

    s('Quest items', 'Pot of flour', 1, "Cook's Assistant", 'pot_flour'),
    s('Quest items', 'Banana', 5, 'Monkey Madness'),
    s('Quest items', 'Raw beef', 1, 'Druidic Ritual'),
    s('Quest items', 'Raw chicken', 1, 'Druidic Ritual'),
    s('Quest items', 'Lobster pot', 1, 'Dragon Slayer'),
    s('Quest items', 'Silk', 1),
    s('Quest items', 'Rope', 1, 'Plague City'),
    s('Quest items', 'Spade', 1),
    s('Quest items', 'Swamp paste', 1, 'Sea Slug'),
    s('Quest items', 'Ball of wool', 1, 'Monkey Madness'),
    s('Quest items', 'Dwellberries', 1, 'Plague City'),
    s('Quest items', 'Chocolate dust', 1, 'Plague City'),
    s('Quest items', 'Bucket', 6, 'Plague City water 4 + milk 2'),
];

/**
 * Where each shop the table lists stands and what it takes to use it, read from the content (the
 * shopkeeper's spawn, the gate or door scripts named) and the fleet's notes. Shops not listed here
 * still appear, with their spawn tile only.
 */
export const SHOP_PLACES: Record<string, { place: string; needs?: string }> = {
    magicguildshop: { place: 'Magic Guild 1st floor, Yanille', needs: 'Magic 66 (guild door)' },
    runeshop: { place: "Aubury's, Varrock east" },
    magicshop: { place: "Betty's, Port Sarim" },
    magearena_runeshop: { place: 'Mage Arena cellar (Lundail)', needs: 'Wilderness ~53 via the Ardougne lever; three webs' },
    mm_magic_shop: { place: 'Ape Atoll (Tutab)', needs: 'Monkey Madness, monkey greegree; never restocks' },
    mm_scimitar_shop: { place: 'Ape Atoll (Daga)', needs: 'Monkey Madness, monkey greegree; never restocks' },
    mm_crafting_shop: { place: 'Ape Atoll (Hamab)', needs: 'Monkey Madness; never restocks' },
    mm_general_shop: { place: 'Ape Atoll (Ifaba)', needs: 'Monkey Madness; never restocks' },
    ranging_guild_bowshop: { place: 'Ranging Guild, Kandarin', needs: 'Ranged 40 (guild door)' },
    archeryshop2: { place: "Hickton's, Catherby" },
    lathastrainingstore: { place: 'Combat Training Camp, north of West Ardougne', needs: 'Biohazard (camp gate)' },
    gnomeshop_gulluck: { place: 'Grand Tree 2nd floor, Gnome Stronghold' },
    junglestore: { place: "Jiminua's, Karamja jungle", needs: 'ship to Karamja (30 gp)' },
    shilojunglestore: { place: "Obli's, Shilo Village", needs: 'Shilo Village' },
    generallegends: { place: "Legends' Guild 1st floor", needs: "Legends' Quest" },
    karamja_fishrestaurant: { place: 'Shrimp and Parrot, Brimhaven', needs: 'ship to Brimhaven' },
    fishingguild: { place: 'Fishing Guild, Hemenster', needs: 'Fishing 68 (guild door)' },
    gemshop: { place: "Herquin's, Falador" },
    gemshop2: { place: 'Gem trader, Al Kharid', needs: 'toll gate (10 gp) from Lumbridge' },
    ardougnegemstall: { place: 'Gem stall, East Ardougne market' },
    goldshop: { place: "Grum's, Port Sarim" },
    cheapringshop: { place: "Irksol's, Zanaris", needs: 'Lost City' },
    amuletshop: { place: "Davon's, Brimhaven", needs: 'ship to Brimhaven' },
    miningstore: { place: "Drogo's, Dwarven Mine", needs: 'underground (Ice Mountain trapdoor)' },
    pickaxeshop: { place: "Nurmof's, Dwarven Mine", needs: 'underground (Ice Mountain trapdoor)' },
    memberstaffshop: { place: "Zaff's, Varrock" },
    werewolfstore1: { place: "Rufus's, Canifis", needs: 'Priest in Peril' },
    viking_fishmonger: { place: 'Rellekka fishmonger', needs: 'Fremennik Trials' },
    etc_fishmonger: { place: 'Etceteria fishmonger', needs: 'Fremennik Trials (ship)' },
    misc_fishmonger: { place: 'Miscellania fishmonger', needs: 'Fremennik Trials (ship)' },
    fishingshop2: { place: "Harry's, Catherby" },
    fishingshop: { place: "Gerrant's, Port Sarim" },
    shilofishingshop: { place: "Fernahei's, Shilo Village", needs: 'Shilo Village' },
    bakery: { place: 'Bakery stall, East Ardougne market' },
    helmetshop: { place: "Peksa's, Barbarian Village" },
    scimitarshop: { place: "Zeke's, Al Kharid", needs: 'toll gate (10 gp) from Lumbridge' },
    shantayshop: { place: 'Shantay Pass', needs: 'toll gate (10 gp) from Lumbridge' },
    bedabincampshop: { place: 'Bedabin Camp, Kharidian Desert', needs: 'Shantay pass, desert heat' },
    lighthouseshop: { place: 'Lighthouse (Jossik)', needs: 'Horror from the Deep' },
    herbloreshop: { place: "Jatix's, Taverley" },
    herbloreshop2: { place: "Frincos's, Entrana", needs: 'ship to Entrana (no weapons or armour)' },
    herbloreshopogre: { place: "Gu'Tanoth ogre merchant", needs: 'Watchtower' },
    adventurershop: { place: "Aemad and Kortan's, East Ardougne" },
    wydinstore: { place: "Wydin's, Port Sarim" },
    clotheshop: { place: "Thessalia's, Varrock" },
    khazardshop: { place: 'Port Khazard general store' },
    gnomeshop_heck: { place: 'Grand Tree 1st floor (Heckel Funch)' },
    gnomeshop_hudo: { place: 'Grand Tree 1st floor (Hudo)' },
    cookeryshop: { place: "Frenita's, Yanille" },
    mm_food_shop: { place: 'Ape Atoll (Solihib)', needs: 'Monkey Madness; never restocks' },
    razmiregeneralstore: { place: "Razmire's, Mort'ton", needs: "Shades of Mort'ton" },
    razmirebuildingstore: { place: "Razmire's builders' store, Mort'ton", needs: "Shades of Mort'ton" },
    viking_general_store: { place: 'Rellekka general store', needs: 'Fremennik Trials' },
    werewolfgeneralstore: { place: 'Canifis general store', needs: 'Priest in Peril' },
    death_generalshop: { place: 'Burthorpe general store' },
    taxfree: { place: "Noterazzo's, Wilderness bandit camp", needs: 'Wilderness' },
    generalshop1: { place: 'Lumbridge general store' },
    generalshop2: { place: 'Varrock general store' },
    generalshop3: { place: 'Al Kharid general store', needs: 'toll gate (10 gp) from Lumbridge' },
    generalshop4: { place: 'Falador general store' },
    generalshop5: { place: 'Edgeville general store' },
    generalshop6: { place: 'Rimmington general store' },
    generalshop7: { place: 'Karamja general store', needs: 'ship to Karamja (30 gp)' },
    generalshop8: { place: 'Zanaris general store', needs: 'Lost City' },
    generalshopogre: { place: "Gu'Tanoth ogre trader", needs: 'Watchtower' },
    generaldwarf: { place: 'Dwarven Mine general store', needs: 'underground' },
    upassgeneralshop: { place: "Chadwell's, Underground Pass entrance" },
    arheinstore: { place: "Arhein's, Catherby" },
    gnomeshop: { place: "Bolkoy's, Tree Gnome Village" },
    craftingshop: { place: "Rommik's, Rimmington" },
    craftingshop2: { place: "Dommik's, Al Kharid", needs: 'toll gate (10 gp) from Lumbridge' },
};

/**
 * Shops whose live shelf no reader can see before the run: the read-only shelf reader has no account
 * that reaches them (rs/495, 2026-10-22). Their rows stay config-only.
 */
export const NO_LIVE_READ: Record<string, string> = {
    magicguildshop: 'no reader with Magic 66',
    cheapringshop: 'no reader with Lost City',
    magearena_runeshop: 'skipped: Wilderness death risk',
    ranging_guild_bowshop: 'no reader with Ranged 40',
};
