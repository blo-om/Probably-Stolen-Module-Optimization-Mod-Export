// Specials (machine-specific, Alarm, Junk Processing, Blast) in storage are never put on a board, locked or not
//   node scripts/test-no-specials.mjs
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
    const { runOptimizationEngine } = await server.ssrLoadModule('/src/solver/engine.ts');
    const { initializeBoard } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
    let n = 0;
    const mod = (displayName, shape, color) => ({ id: `t${n++}`, shape, color, displayName, effects: ['None', 'None'], effectValues: [0, 0], isInfinite: false, isLocked: false });
    const specialsInStorage = [
        mod('Hydroreed Filter Hydroponic Module', 'Line4', 'Grey'), mod('Fillerweed Production Hydroponic Module', 'Line4', 'Grey'),
        mod('Furnace Module (Blast)', 'Line4', 'Grey'), mod('Alarm Transmitter Module', 'Line4', 'DarkRed'),
    ];
    // A Quality target the board meets easily, an unlocked Solvent Recovery on it: the downgrade used to swap it for a weaker special
    const onBoard = mod('Evaporator Solvent Recovery Module', 'Line4', 'Grey');
    const inventory = [onBoard, ...Array.from({ length: 6 }, () => mod('Quality Module', 'Square4_Base', 'Yellow')), ...specialsInStorage];
    const config = { id: 'm', tier: 3, targetStats: { Performance: null, Quality: 20, Efficiency: null }, ignoreStats: { Performance: true, Quality: false, Efficiency: true },
        maximizeStats: { Performance: false, Quality: false, Efficiency: false }, statPriority: { Performance: 1, Quality: 1, Efficiency: 1 } };
    const board = initializeBoard(3);
    for (let x = 0; x < 4; x++) board[0][x] = onBoard;
    const isSolving = { current: true };
    let last = null;
    setTimeout(() => { isSolving.current = false; }, 3000);
    await runOptimizationEngine([config], [board], inventory, inventory, isSolving, u => { last = u; }, { stall: 0 });
    const placed = new Set();
    for (const row of last.get('m').board) for (const cell of row) if (cell && cell !== 'Locked') placed.add(cell.displayName);
    const wrong = specialsInStorage.filter(s => placed.has(s.displayName));
    console.log('on the board:', [...placed].join(', '));
    console.log(wrong.length === 0 ? 'PASS: no special taken from storage' : `FAIL: ${wrong.map(s => s.displayName).join(', ')}`);
} finally {
    await server.close();
}
