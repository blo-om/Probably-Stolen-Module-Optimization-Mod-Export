// How often a reachable stepped target gets relaxed: AgeWell, Quality target 250, N runs of S seconds
//   node scripts/abtest-relax.mjs [runs] [seconds]
import { createServer } from 'vite';

const RUNS = Number(process.argv[2]) || 10, SECONDS = Number(process.argv[3]) || 4;
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
    const md = await server.ssrLoadModule('/src/machineDefaults.ts');
    const { runOptimizationEngine } = await server.ssrLoadModule('/src/solver/engine.ts');
    const { initializeBoard, calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
    let n = 0;
    const mod = (displayName, shape, color, effects = ['None', 'None']) => ({ id: `t${n++}`, shape, color, displayName, effects, effectValues: [0, 0], isInfinite: false, isLocked: false });
    const many = (k, f) => Array.from({ length: k }, f);
    const inventory = () => [
        ...many(4, () => mod('Performance Module', 'L4_Base', 'Red')), ...many(2, () => mod('Performance Module', 'Square4_Base', 'Red', ['Premium', 'None'])),
        ...many(3, () => mod('Overclock Module', 'P5', 'Red')), ...many(4, () => mod('Quality Module', 'T4_Base', 'Yellow')), ...many(2, () => mod('Quality Module', 'L3', 'Yellow')),
        ...many(3, () => mod('Refinement Module', 'C5', 'Yellow')), ...many(3, () => mod('Efficiency Module', 'Square4_Base', 'Green')), ...many(2, () => mod('Eco Module', 'P5', 'Green')),
        ...many(6, () => mod('Node (Medium)', 'Node1x2', 'White')), mod('Neural Core Module (Capped)', 'Square4_Base', 'Purple'),
    ];
    const kind = 'AgeWell 1';
    const ignoreStats = md.defaultIgnoreStats(kind);
    const config = {
        id: 'a', tier: 3, targetStats: { Performance: null, Quality: 250, Efficiency: null }, ignoreStats,
        maximizeStats: { ...md.defaultMaximizeStats(ignoreStats), Quality: false }, statPriority: { Performance: 1, Quality: 1, Efficiency: 1 },
        targetSteps: { Quality: md.statBreakpoints(kind, 'Quality').map(b => b.value) }, sumPE: true, worthlessBelowSteps: md.worthlessBelowSteps(kind),
        cheapEnergyAt: md.cheapEnergyAt(kind),
    };
    const got = [];
    for (let i = 0; i < RUNS; i++) {
        const inv = inventory();
        const isSolving = { current: true };
        let last = null, firstAt = null;
        const t0 = Date.now();
        const timer = setTimeout(() => { isSolving.current = false; }, SECONDS * 1000);
        await runOptimizationEngine([config], [initializeBoard(3)], inv, inv, isSolving, u => {
            last = u.get('a');
            const q = calculateBoardStats(last.board, inv).totals.Quality;
            if (firstAt === null && q >= 250) firstAt = Date.now() - t0;
        }, { stall: 0 });
        clearTimeout(timer);
        const q = calculateBoardStats(last.board, inv).totals.Quality;
        got.push(q);
        console.log(`run ${i + 1}: Quality ${q}${firstAt !== null ? `, 250 first reached at ${firstAt} ms` : ', 250 never reached'}`);
    }
    console.log(`${got.filter(q => q >= 250).length}/${RUNS} met the target in ${SECONDS}s`);
} finally {
    await server.close();
}
