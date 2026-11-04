// Force Learning: spare Learning Algorithm modules short of their cap go into machines even when they add nothing (or cost stats)
//   node scripts/abtest-learning.mjs [seconds]
import { createServer } from 'vite';

const SECONDS = Number(process.argv[2]) || 3;
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
    const { runOptimizationEngine } = await server.ssrLoadModule('/src/solver/engine.ts');
    const { initializeBoard, calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
    let n = 0;
    const mod = (displayName, shape, color, effects = ['None', 'None'], effectValues = [0, 0]) =>
        ({ id: `t${n++}`, shape, color, displayName, effects, effectValues, isInfinite: false, isLocked: false });
    const many = (k, f) => Array.from({ length: k }, f);
    const learning = (name, shape, color, v) => mod(name, shape, color, ['Learning Algorithm', 'None'], [v, 0]);

    const run = async (label, configs, inventory, force) => {
        const isSolving = { current: true };
        let last = null;
        const timer = setTimeout(() => { isSolving.current = false; }, SECONDS * 1000);
        await runOptimizationEngine(configs.map(c => ({ ...c, forceLearning: force })), configs.map(c => initializeBoard(c.tier)), inventory, inventory,
            isSolving, u => { last = u; }, { stall: 0 });
        clearTimeout(timer);
        const placed = new Set();
        for (const c of configs) for (const row of last.get(c.id).board) for (const cell of row) if (cell && cell !== 'Locked') placed.add(cell.id);
        const learners = inventory.filter(i => i.effects.includes('Learning Algorithm'));
        const fmt = (i) => `${i.displayName.replace(' Module', '')} ${i.effectValues[0]}%${placed.has(i.id) ? ' IN' : ' storage'}`;
        console.log(`${label} [force ${force ? 'on' : 'off'}]`);
        for (const c of configs) {
            const t = calculateBoardStats(last.get(c.id).board, inventory).totals;
            console.log(`  ${c.id}: P ${t.Performance} Q ${t.Quality} E ${t.Efficiency}${c.targetStats.Quality !== null ? ` (Quality target ${c.targetStats.Quality})` : ''}`);
        }
        console.log(`  learners: ${learners.map(fmt).join(' · ')}`);
    };

    // 1. Room to spare: a Quality machine with Efficiency off; the Efficiency learners are worth nothing there
    {
        const inv = () => {
            n = 0;
            return [
                ...many(3, () => mod('Quality Module', 'Square4_Base', 'Yellow')),
                learning('Efficiency Module', 'L4_Base', 'Green', 5), learning('Eco Module', 'P5', 'Green', 0),
                learning('Efficiency Module', 'Square4_Base', 'Green', 40), // maxed (cap 2 x 20): stays out
            ];
        };
        const config = { id: 'q', tier: 3, targetStats: { Performance: null, Quality: null, Efficiency: null }, ignoreStats: { Performance: true, Quality: false, Efficiency: true },
            maximizeStats: { Performance: false, Quality: true, Efficiency: false }, statPriority: { Performance: 1, Quality: 1, Efficiency: 1 } };
        await run('Room to spare', [config], inv(), false);
        await run('Room to spare', [config], inv(), true);
    }
    // 2. Full machine with a Quality target: a learner takes the place of a module of its shape, as long as the target holds
    {
        const inv = () => {
            n = 0;
            return [
                ...many(9, () => mod('Quality Module', 'Square4_Base', 'Yellow')),
                learning('Performance Module', 'Square4_Base', 'Red', 3), learning('Efficiency Module', 'Square4_Base', 'Green', 0),
            ];
        };
        const config = { id: 'full', tier: 3, targetStats: { Performance: null, Quality: 40, Efficiency: null }, ignoreStats: { Performance: true, Quality: false, Efficiency: true },
            maximizeStats: { Performance: false, Quality: true, Efficiency: false }, statPriority: { Performance: 1, Quality: 1, Efficiency: 1 } };
        await run('Full machine, Quality target 40', [config], inv(), false);
        await run('Full machine, Quality target 40', [config], inv(), true);
    }
    // 3. Four machines sharing more modules than fit, card order = priority: learners should go where they cost least (the target-only
    //    machine, then the least important one), and the search should not come out worse for the time the pass takes
    {
        const inv = () => {
            n = 0;
            return [
                ...many(8, () => mod('Quality Module', 'Square4_Base', 'Yellow')), ...many(6, () => mod('Refinement Module', 'C5', 'Yellow')),
                ...many(8, () => mod('Performance Module', 'L4_Base', 'Red')), ...many(4, () => mod('Overclock Module', 'P5', 'Red')),
                ...many(6, () => mod('Efficiency Module', 'T4_Base', 'Green')), ...many(4, () => mod('Eco Module', 'P5', 'Green')),
                ...many(4, () => mod('Node (Medium)', 'Node1x2', 'White')),
                learning('Quality Module', 'Square4_Base', 'Yellow', 2), learning('Performance Module', 'L4_Base', 'Red', 0),
                learning('Efficiency Module', 'T4_Base', 'Green', 4), learning('Refinement Module', 'C5', 'Yellow', 10),
                learning('Eco Module', 'P5', 'Green', 0), learning('Efficiency Module', 'L3', 'Green', 1),
            ];
        };
        const cfg = (id, prio, target, ignore, maximize) => ({ id, tier: 3, targetStats: { Performance: null, Quality: null, Efficiency: null, ...target },
            ignoreStats: ignore, maximizeStats: maximize, statPriority: { Performance: prio, Quality: prio, Efficiency: prio } });
        const configs = [
            cfg('1 Quality max', 1, {}, { Performance: true, Quality: false, Efficiency: true }, { Performance: false, Quality: true, Efficiency: false }),
            cfg('2 Perf max', 2, {}, { Performance: false, Quality: true, Efficiency: true }, { Performance: true, Quality: false, Efficiency: false }),
            cfg('3 Quality target 30', 3, { Quality: 30 }, { Performance: true, Quality: false, Efficiency: true }, { Performance: false, Quality: false, Efficiency: false }),
            cfg('4 Eff max', 4, {}, { Performance: true, Quality: true, Efficiency: false }, { Performance: false, Quality: false, Efficiency: true }),
        ];
        for (let r = 0; r < 2; r++) {
            await run(`Four machines, run ${r + 1}`, configs, inv(), false);
            await run(`Four machines, run ${r + 1}`, configs, inv(), true);
        }
    }
} finally {
    await server.close();
}
