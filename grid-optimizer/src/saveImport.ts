// ES3 inventories are JSON strings embedded in a save which is not necessarily
// valid JSON as a whole (for example, Unity dictionaries can use numeric keys).
function parseInventoryJson<T>(text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        // Chinese saves can escape typographic quotes as \“ and \”. JSON only
        // allows escaping ASCII quotes. Consume escape pairs so valid literal
        // backslashes (\\) and all other escapes retain their original meaning.
        const repaired = text.replace(/\\([\s\S])/g, (pair, char: string) =>
            '“”‘’'.includes(char) ? char : pair);
        if (repaired === text) throw error;
        return JSON.parse(repaired) as T;
    }
}

export function readSaveInventory<T>(text: string, key: string): T[] | null {
    const keyIdx = text.indexOf(`"${key}"`);
    if (keyIdx === -1) return null;
    const colonIdx = text.indexOf(':', keyIdx);
    let quoteStart = colonIdx + 1;
    while (/\s/.test(text[quoteStart] ?? '') && quoteStart < text.length) quoteStart++;
    if (text[quoteStart] !== '"') throw new Error(`Malformed ${key} string.`);
    let quoteEnd = -1;
    for (let i = quoteStart + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') { quoteEnd = i; break; }
    }
    if (quoteEnd === -1) throw new Error(`Malformed ${key} string.`);
    const decoded = parseInventoryJson<string>(text.substring(quoteStart, quoteEnd + 1));
    const inventory = parseInventoryJson<{ saveItems?: T[] }>(decoded);
    if (!inventory || !Array.isArray(inventory.saveItems)) throw new Error(`Missing saveItems in ${key}.`);
    return inventory.saveItems;
}

// Stable identifiers observed in game saves. Names and custom names remain
// untouched when building machine paths for the in-game import mod. These
// canonical names are only for the optimizer's existing type/stat rules.
const ITEM_NAMES: Readonly<Record<string, string>> = {
    moisture_farm: 'Moisture Farm',
    furnace: 'Furnace',
    desequencer: 'Cryptographic Desequencer',
    security_alarm: 'Alarm System',
    wine_rack: 'AgeWell',
    system_module_performance: 'Performance Module',
    system_module_quality: 'Quality Module',
    system_module_efficiancy: 'Efficiency Module',
    system_module_overclock: 'Overclock Module',
    system_module_fineness: 'Refinement Module',
    system_module_eco: 'Eco Module',
    node_medium: 'Node (Medium)',
    alarm_module_transmitter: 'Alarm Transmitter Module',
    // The other machines and modules the optimizer knows (identifiers from English saves and the game's item tables)
    water_purifier: 'Water Purifier',
    mirage_projector: 'Mirage Projector',
    furnace_module_blast: 'Furnace Module (Blast)',
    furnace_module_junk: 'Furnace Module (Junk Processing)',
    system_capped_neural_core: 'Neural Core Module (Capped)',
    system_uncapped_neural_core: 'Neural Core Module (Uncapped)',
    // Full release: the new machines with a module bay, Streamlining (named in the game's tables, never spawned) and the
    // machine-only modules (the same names as constants.ts MACHINE_MODULES; this file is kept free of imports for its tests)
    hydroponic: 'Hydroponic System',
    plant_dna_manipulator: 'DNA Manipulator',
    printer: '3D Printer',
    deal_maker: 'Deal Maker',
    evaporator: 'Evaporator',
    system_module_streamlining: 'Streamlining Module',
    node_small: 'Node (Small)',
    farm_module_nutrifruit: 'Nutrifruit Hydroponic Module',
    farm_module_dream_cap: 'Dream Cap Neutralizer Hydroponic Module',
    farm_module_kotton_loom: 'Kotton Auto Loom Hydroponic Module',
    farm_module_nightmare_cap: 'Dream Cap Nightmare Hydroponic Module',
    farm_module_fillerweed_production: 'Fillerweed Production Hydroponic Module',
    farm_module_hydroreed_filter: 'Hydroreed Filter Hydroponic Module',
    farm_module_smuggler: 'Hydroponic Smuggler Module',
    dna_manipulator_module_stabilizer: 'Genetic Stabilizer Module',
    dna_manipulator_module_positive_filter: 'Positive Trait Filter Module',
    dna_manipulator_module_negative_filter: 'Negative Trait Filter Module',
    dna_manipulator_module_precision: 'Precision Extraction Module',
    printer_module_metal: 'Metal Printer Module',
    printer_module_cnc: 'Computer Numerical Control Module',
    printer_module_melee_batch: 'Melee Batch Module',
    evaporator_module_solvent_recovery: 'Evaporator Solvent Recovery Module',
};

export function getSaveItemName(item: { identifier?: string; name?: string }): string {
    return (item.identifier && Object.hasOwn(ITEM_NAMES, item.identifier) ? ITEM_NAMES[item.identifier] : undefined)
        ?? item.name ?? '';
}
