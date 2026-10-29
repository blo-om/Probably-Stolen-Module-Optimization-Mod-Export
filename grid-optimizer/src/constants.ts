import type {ModuleShape, ModuleColor, ItemEffect, ModuleTemplate} from './types';

export const SHAPE_DEFINITIONS: { [key in ModuleShape]: number[][] } = {
    Node1x2: [[1], [1]],
    L3: [[1, 0], [1, 1]],
    L4_Base: [[1, 0], [1, 0], [1, 1]],
    T4_Base: [[1, 1, 1], [0, 1, 0]],
    Square4_Base: [[1, 1], [1, 1]],
    L4_High: [[1, 0], [1, 0], [1, 1]],
    T4_High: [[1, 1, 1], [0, 1, 0]],
    Square4_High: [[1, 1], [1, 1]],
    P5: [[1, 1], [1, 1], [1, 0]],
    C5: [[1, 1], [1, 0], [1, 1]],
    Line4: [[1, 1, 1, 1]],
    Line2: [[1, 1]],
};

export const COLOR_MAP: { [key in ModuleColor]: string } = {
    White: '#e0e0e0',
    Red: '#ff4d4d',
    Yellow: '#ffd700',
    Green: '#4caf50',
    Purple: '#9c27b0',
    DarkRed: '#8b0000',
    Grey: '#808080'
};

export const EFFECTS_LIST: ItemEffect[] = [
    'None', 'Premium', 'Inferior', 'Overcharged', 'Degrading',
    'Negative Feedback', 'Receiver', 'Side Mount', 'Top Mount', 'Learning Algorithm'
];

export const MODULE_TEMPLATES: ModuleTemplate[] = [];

// Base & High Tier
(['Red', 'Yellow', 'Green'] as ModuleColor[]).forEach((color) => {
    const group = color === 'Red' ? 'Performance' : color === 'Yellow' ? 'Quality' : 'Efficiency';
    MODULE_TEMPLATES.push({ shape: 'L3', color, size: 3, tier: 'Base', shapeType: 'L', displayName: group, group });
    MODULE_TEMPLATES.push({ shape: 'L4_Base', color, size: 4, tier: 'Base', shapeType: 'L', displayName: group, group });
    MODULE_TEMPLATES.push({ shape: 'T4_Base', color, size: 4, tier: 'Base', shapeType: 'T', displayName: group, group });
    MODULE_TEMPLATES.push({ shape: 'Square4_Base', color, size: 4, tier: 'Base', shapeType: 'Square', displayName: group, group });

    const highName = color === 'Red' ? 'Overclock' : color === 'Yellow' ? 'Refinement' : 'Eco';
    MODULE_TEMPLATES.push({ shape: 'L4_High', color, size: 4, tier: 'High', shapeType: 'L', displayName: highName, group });
    MODULE_TEMPLATES.push({ shape: 'T4_High', color, size: 4, tier: 'High', shapeType: 'T', displayName: highName, group });
    MODULE_TEMPLATES.push({ shape: 'Square4_High', color, size: 4, tier: 'High', shapeType: 'Square', displayName: highName, group });
    MODULE_TEMPLATES.push({ shape: 'P5', color, size: 5, tier: 'High', shapeType: 'P', displayName: highName, group });
    MODULE_TEMPLATES.push({ shape: 'C5', color, size: 5, tier: 'High', shapeType: 'C', displayName: highName, group });
});

// Specials
MODULE_TEMPLATES.push({ shape: 'Square4_High', color: 'Purple', size: 4, tier: 'Special', shapeType: 'Square', displayName: 'Neural Core Module (Uncapped)', group: 'Special' });
MODULE_TEMPLATES.push({ shape: 'Square4_Base', color: 'Purple', size: 4, tier: 'Special', shapeType: 'Square', displayName: 'Neural Core Module (Capped)', group: 'Special' });
MODULE_TEMPLATES.push({ shape: 'Line4', color: 'DarkRed', size: 4, tier: 'Special', shapeType: 'Line', displayName: 'Alarm Transmitter Module', group: 'Special' });
MODULE_TEMPLATES.push({ shape: 'Line4', color: 'Grey', size: 4, tier: 'Special', shapeType: 'Line', displayName: 'Furnace Module (Junk Processing)', group: 'Special' });
MODULE_TEMPLATES.push({ shape: 'Line4', color: 'Grey', size: 4, tier: 'Special', shapeType: 'Line', displayName: 'Furnace Module (Blast)', group: 'Special' });

/* Modules that only fit one machine (ModuleDirectory: MODULE_TYPE_HYDROPONIC, _DNA_MANIPULATOR, _PRINTER, _EVAPORATOR). Like the Blast,
 * they are there for what they do, not their stats, so they stay on their machine (isSpecialModule). Stats as the game gives them
 * (InitModuleItem: Performance, Efficiency, Quality), shape from their sprite (1x4, the two Dream Cap Nightmare / Smuggler ones 1x2)
 */
export const MACHINE_MODULES: { id: string; name: string; shape: ModuleShape; P: number; Q: number; E: number }[] = [
    { id: 'farm_module_nutrifruit', name: 'Nutrifruit Hydroponic Module', shape: 'Line4', P: -10, Q: 0, E: -10 },
    { id: 'farm_module_dream_cap', name: 'Dream Cap Neutralizer Hydroponic Module', shape: 'Line4', P: 15, Q: 0, E: 15 },
    { id: 'farm_module_kotton_loom', name: 'Kotton Auto Loom Hydroponic Module', shape: 'Line4', P: -50, Q: 0, E: -100 },
    { id: 'farm_module_nightmare_cap', name: 'Dream Cap Nightmare Hydroponic Module', shape: 'Line2', P: -33, Q: 0, E: -50 },
    { id: 'farm_module_fillerweed_production', name: 'Fillerweed Production Hydroponic Module', shape: 'Line4', P: 0, Q: 0, E: -25 },
    { id: 'farm_module_hydroreed_filter', name: 'Hydroreed Filter Hydroponic Module', shape: 'Line4', P: 0, Q: 0, E: -15 },
    { id: 'farm_module_smuggler', name: 'Hydroponic Smuggler Module', shape: 'Line2', P: 0, Q: 0, E: 0 },
    { id: 'dna_manipulator_module_stabilizer', name: 'Genetic Stabilizer Module', shape: 'Line4', P: -50, Q: 0, E: -25 },
    { id: 'dna_manipulator_module_positive_filter', name: 'Positive Trait Filter Module', shape: 'Line4', P: 0, Q: 0, E: -25 },
    { id: 'dna_manipulator_module_negative_filter', name: 'Negative Trait Filter Module', shape: 'Line4', P: 0, Q: 0, E: -25 },
    { id: 'dna_manipulator_module_precision', name: 'Precision Extraction Module', shape: 'Line4', P: -75, Q: 0, E: -75 },
    { id: 'printer_module_metal', name: 'Metal Printer Module', shape: 'Line4', P: 0, Q: 0, E: -50 },
    { id: 'printer_module_cnc', name: 'Computer Numerical Control Module', shape: 'Line4', P: -25, Q: 0, E: -25 },
    { id: 'printer_module_melee_batch', name: 'Melee Batch Module', shape: 'Line4', P: -50, Q: 0, E: -50 },
    { id: 'evaporator_module_solvent_recovery', name: 'Evaporator Solvent Recovery Module', shape: 'Line4', P: 0, Q: 50, E: -25 },
];
const MACHINE_MODULE_NAMES = new Set(MACHINE_MODULES.map(m => m.name));
export const isMachineModuleName = (name: string) => MACHINE_MODULE_NAMES.has(name);
for (const m of MACHINE_MODULES) {
    MODULE_TEMPLATES.push({ shape: m.shape, color: 'Grey', size: m.shape === 'Line2' ? 2 : 4, tier: 'Special', shapeType: 'Line', displayName: m.name, group: 'Special' });
}

export const NODE_TEMPLATE: ModuleTemplate = { shape: 'Node1x2', color: 'White', size: 2, tier: 'Base', shapeType: 'Node', displayName: 'Node (Medium)', group: 'All' };