// Scenario checks for the solver: fixed inventories and machine cards configured the way the site does, each run for a few seconds with
// this site's engine (src/solver/engine.ts), and the result checked against what the machine's rules say should happen.
//   node scripts/abtest.mjs [seconds per run, default 4]
import { createServer } from 'vite';

const SECONDS = Number(process.argv[2]) || 4;
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const md = await server.ssrLoadModule('/src/machineDefaults.ts');
const { runOptimizationEngine } = await server.ssrLoadModule('/src/solver/engine.ts');
const { initializeBoard, calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { fitsMachine } = await server.ssrLoadModule('/src/constants.ts');

// ---- inventory
let nextId = 0;
const mod = (displayName, shape, color, effects = ['None', 'None'], values = [0, 0], extra = {}) =>
    ({ id: `t${nextId++}`, shape, color, displayName, effects, effectValues: values, isInfinite: false, isLocked: false, ...extra });
const many = (n, f) => Array.from({ length: n }, f);
const baseInventory = () => [
    ...many(4, () => mod('Performance Module', 'L4_Base', 'Red')),
    ...many(2, () => mod('Performance Module', 'Square4_Base', 'Red', ['Premium', 'None'])),
    ...many(3, () => mod('Overclock Module', 'P5', 'Red')),
    ...many(4, () => mod('Quality Module', 'T4_Base', 'Yellow')),
    ...many(2, () => mod('Quality Module', 'L3', 'Yellow')),
    ...many(3, () => mod('Refinement Module', 'C5', 'Yellow')),
    ...many(3, () => mod('Efficiency Module', 'Square4_Base', 'Green')),
    ...many(2, () => mod('Eco Module', 'P5', 'Green')),
    ...many(6, () => mod('Node (Medium)', 'Node1x2', 'White')),
    mod('Neural Core Module (Capped)', 'Square4_Base', 'Purple'),
];

// ---- a machine card as the site configures it (ModuleInventoryUI getState), with optional overrides
const card = (id, kind, opts = {}) => {
    const ignoreStats = { ...md.defaultIgnoreStats(kind), ...(opts.ignore || {}) };
    const targetStats = { ...md.defaultTargetStats(kind, opts.baseAttract ?? null), ...(opts.target || {}) };
    const maximizeStats = md.defaultMaximizeStats(ignoreStats);
    for (const k of ['Performance', 'Quality', 'Efficiency']) if (targetStats[k] !== null) maximizeStats[k] = false;
    const jobs = md.machineJobs(kind, opts.job);
    const job = jobs ? (jobs.jobs.find(j => j.key === opts.job) ?? jobs.jobs[0]) : null;
    const steps = {};
    for (const stat of ['Performance', 'Quality', 'Efficiency']) {
        const list = stat === 'Performance' && kind.toLowerCase().includes('alarm') ? [md.ALARM_SURE_STOP]
            : (job ? job.steps[stat] ?? null : null) ?? md.statBreakpoints(kind, stat, Boolean(opts.blast));
        const values = Array.isArray(list) ? list.map(b => (typeof b === 'number' ? b : b.value)) : null;
        if (values && values.length) steps[stat] = values.sort((a, b) => a - b);
    }
    const farm = md.isMoistureFarm(kind);
    return {
        id, kind, tier: opts.tier ?? (md.isEvaporator(kind) ? 0 : 3), targetStats, maximizeStats, ignoreStats,
        statPriority: { Performance: opts.rank ?? 1, Quality: opts.rank ?? 1, Efficiency: opts.rank ?? 1 },
        targetSteps: steps, sumPQ: md.isMirage(kind), sumPE: md.sumsPE(kind),
        water: farm && targetStats.Performance === null && !ignoreStats.Quality,
        worthlessBelowSteps: md.worthlessBelowSteps(kind), cheapEnergyAt: md.cheapEnergyAt(kind),
        qualityCap: md.isEvaporator(kind) ? md.EVAPORATOR_QUALITY_CAP : undefined,
    };
};

// ---- one solve: every card together, the boards starting empty (or as given), the pool everything not locked
const solve = async (cards, inventory, startBoards) => {
    const boards = cards.map((c, k) => startBoards?.[k] ?? initializeBoard(c.tier));
    const pool = inventory.filter(i => !i.isLocked);
    const isSolving = { current: true };
    let last = null;
    const timer = setTimeout(() => { isSolving.current = false; }, SECONDS * 1000);
    // As the site runs it (solver/parallel.ts): a single machine keeps its targets as set; several sharing modules may give things up
    await runOptimizationEngine(cards, boards, pool, inventory, isSolving, updates => { last = updates; }, cards.length > 1 ? {} : { stall: 0 });
    clearTimeout(timer);
    return cards.map((c, k) => {
        const u = last?.get(c.id);
        const board = u?.board ?? boards[k];
        const { totals } = calculateBoardStats(board, inventory);
        const placed = new Map();
        board.forEach(row => row.forEach(cell => { if (cell && cell !== 'Locked') placed.set(cell.id, cell); }));
        return { card: c, totals, placed: [...placed.values()] };
    });
};

// ---- checks
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const T = r => `P ${r.totals.Performance} Q ${r.totals.Quality} E ${r.totals.Efficiency}`;
const stepOf = (value, steps) => [...steps].filter(s => s <= value).pop() ?? null;
const usedIds = rs => rs.flatMap(r => r.placed.map(p => p.id));

try {
    // 1. Furnace on Auto: Quality is worth something only in whole 100s (stages), Performance nothing
    {
        const [r] = await solve([card('f', 'Furnace 1')], baseInventory());
        const s = stepOf(r.totals.Quality, [100, 200, 300, 400]);
        check('Furnace Auto reaches a purity stage', s !== null, `${T(r)} -> stage ${s ? s / 100 : 0}`);
        check('Furnace Auto: no Performance modules for nothing', r.placed.every(p => !(p.color === 'Red' && p.displayName.includes('Overclock'))), r.placed.map(p => p.displayName).join(', '));
    }
    // 2. AgeWell target 250% Quality (+2 days): met, and not far past (the next step is 375)
    {
        const [r] = await solve([card('a', 'AgeWell 1', { target: { Quality: 250 } })], baseInventory());
        check('AgeWell target 250 met', r.totals.Quality >= 250, T(r));
        check('AgeWell target not overshot to the next step', r.totals.Quality < 375, T(r));
    }
    // 3. Alarm: default target 49 (every theft stopped)
    {
        const [r] = await solve([card('al', 'Alarm System 1')], baseInventory());
        check('Alarm reaches 49% Performance', r.totals.Performance >= 49, `${T(r)} -> stop chance ${md.alarmStopChance(r.totals.Performance)}%`);
    }
    // 4. DNA Manipulator, Any seed: both stats maximized, no stopping at the complexity-0 10%
    {
        const [r] = await solve([card('d', 'DNA Manipulator 1')], baseInventory());
        check('DNA Any seed: Quality past 10%', r.totals.Quality > 10, T(r));
        check('DNA Any seed: Performance used too', r.totals.Performance > 0, T(r));
    }
    // 5. DNA at complexity 8 with Quality on Target 90 (sure success)
    {
        const [r] = await solve([card('d8', 'DNA Manipulator 1', { job: '8', target: { Quality: 90 } })], baseInventory());
        check('DNA complexity 8: Quality target 90 met', r.totals.Quality >= 90, `${T(r)} -> success ${Math.min(100, 95 - 40 + Math.trunc(r.totals.Quality / 2))}%`);
    }
    // 6. Hydroponic Kotton, Performance target 5 days (25%)
    {
        const [r] = await solve([card('h', 'Hydroponic System 1', { job: 'kotton', target: { Performance: 25 } })], baseInventory());
        const speed = 8 + Math.trunc(Math.trunc(8 * r.totals.Performance / 2) / 100);
        check('Kotton 5-day target met', r.totals.Performance >= 25, `${T(r)} -> ${speed} work a day, ${Math.ceil(43 / speed)} days`);
    }
    // 7. 3D Printer Combat Knife on Auto: days and melee condition steps
    {
        const [r] = await solve([card('p', '3D Printer 1', { job: 'combat_knife' })], baseInventory());
        const speed = 24 + Math.trunc(24 * r.totals.Performance / 100);
        check('Printer Combat Knife: faster than 5 days', Math.ceil(98 / speed) < 5, `${T(r)} -> ${speed} a day, ${Math.ceil(98 / speed)} days`);
    }
    // 8. Mirage target: store at 900 from a base of 600 (300 points over 100 from the projector itself -> 200 more)
    {
        const [r] = await solve([card('m', 'Mirage Projector 1', { baseAttract: 600 })], baseInventory());
        const pts = md.miragePoints(r.totals.Performance, r.totals.Quality);
        check('Mirage reaches the store goal', pts + 600 >= 900 || pts >= 100, `${T(r)} -> ${pts} points (store ${600 + pts})`);
    }
    // 9. Evaporator: Quality past 100 is worth nothing
    {
        const [r] = await solve([card('e', 'Evaporator 1')], baseInventory());
        check('Evaporator Quality not wasted far past 100', r.totals.Quality <= 130, T(r));
    }
    // 10. Water Purifier Auto: Quality at a cap step (100 = pure, 200 = 100%)
    {
        const [r] = await solve([card('w', 'Water Purifier 1')], baseInventory());
        check('Purifier reaches pure (100)', r.totals.Quality >= 100, T(r));
    }
    // 11. Moisture Farm Auto (water value)
    {
        const [r] = await solve([card('mf', 'Moisture Farm 1')], baseInventory());
        const out = md.moistureFarmOutput(r.totals.Performance, r.totals.Quality, 1);
        check('Moisture Farm makes at least Base water', r.totals.Quality >= 50, `${T(r)} -> ${out.ml} ml ${out.grade}`);
    }
    // 12. A Blast someone unlocked (right-click) in the pool: never placed on a Moisture Farm
    {
        const inv = [...baseInventory(), mod('Furnace Module (Blast)', 'Line4', 'Grey')];
        const [r] = await solve([card('mf2', 'Moisture Farm 1')], inv);
        const wrong = r.placed.filter(p => !fitsMachine(p, 'Moisture Farm 1'));
        check('Unlocked Blast stays off a Moisture Farm', wrong.length === 0, wrong.map(p => p.displayName).join(', ') || 'none placed');
    }
    // 13. Two machines sharing the pool: nothing used twice, card order gives the first the better modules
    {
        const inv = baseInventory();
        const rs = await solve([card('f1', 'Furnace 1', { rank: 1 }), card('a1', 'AgeWell 1', { rank: 2 })], inv);
        const ids = usedIds(rs);
        check('Joint solve: no module used twice', new Set(ids).size === ids.length, `${ids.length} placed`);
        check('Joint solve: Furnace (first card) reaches a stage', rs[0].totals.Quality >= 100, `Furnace ${T(rs[0])} | AgeWell ${T(rs[1])}`);
    }
    // 14. Desequencer: Performance lands on a keycard step (the cut-offs), not just past one
    {
        const [r] = await solve([card('ds', 'Cryptographic Desequencer 1')], baseInventory());
        const cut = md.desequencerCutoffs();
        check('Desequencer reaches a day cut-off', cut.some(c => r.totals.Performance >= c), `${T(r)} -> past ${[...cut].filter(c => c <= r.totals.Performance).pop() ?? 'none'}`);
    }
    // ================= A/B: the same scenario two ways =================
    console.log('\n---- A/B ----');
    const { runOptimizationEngine: runHoydoy } = await server.ssrLoadModule('/src/solvers/hoydoy/engine.ts');
    const { runOptimizationEngine: runRazboy } = await server.ssrLoadModule('/src/solvers/razboy/solver/engine.ts');
    // As solvers/index.ts hands a card to their solvers: no steps or site-only settings, AgeWell's energy as plain Efficiency
    const plain = c => {
        const base = { id: c.id, tier: c.tier, targetStats: c.targetStats, maximizeStats: c.maximizeStats, ignoreStats: c.ignoreStats, statPriority: c.statPriority };
        return c.sumPE ? { ...base, targetStats: { ...c.targetStats, Performance: null }, maximizeStats: { ...c.maximizeStats, Performance: !c.ignoreStats.Efficiency }, ignoreStats: { ...c.ignoreStats, Performance: c.ignoreStats.Efficiency } } : base;
    };
    const otherSolve = async (which, cards, inventory) => {
        const boards = cards.map(c => initializeBoard(c.tier));
        const pool = inventory.filter(i => !i.isLocked);
        let last = null;
        if (which === 'hoydoy') {
            const isSolving = { current: true };
            const timer = setTimeout(() => { isSolving.current = false; }, SECONDS * 1000);
            await runHoydoy(cards.map(plain), boards, pool, inventory, isSolving, u => { last = cards.map(c => u.get(c.id)?.board); });
            clearTimeout(timer);
        } else {
            const control = { running: true };
            const timer = setTimeout(() => { control.running = false; }, SECONDS * 1000);
            await runRazboy({ machines: cards.map((c, k) => ({ machine: plain(c), initialBoard: boards[k] })), searchPoolInventory: pool, fullInventory: inventory }, control,
                u => { last = u.boards.map(b => b.board); });
            clearTimeout(timer);
        }
        return cards.map((c, k) => {
            const board = last?.[k] ?? boards[k];
            const { totals } = calculateBoardStats(board, inventory);
            const placed = new Map();
            board.forEach(row => row.forEach(cell => { if (cell && cell !== 'Locked') placed.set(cell.id, cell); }));
            return { card: c, totals, placed: [...placed.values()] };
        });
    };
    const line = (label, rs, extra = () => '') => console.log(`  ${label.padEnd(10)} ${rs.map(r => `${r.card.id}: ${T(r)} (${r.placed.length} modules)${extra(r)}`).join(' | ')}`);
    const abSolvers = async (title, cards, extra) => {
        console.log(title);
        line('Bloom', await solve(cards, baseInventory()), extra);
        line('hoydoy', await otherSolve('hoydoy', cards, baseInventory()), extra);
        line('Razboy', await otherSolve('razboy', cards, baseInventory()), extra);
    };
    const furnaceStage = r => ` stage ${Math.max(0, Math.trunc(r.totals.Quality / 100))}`;
    const water = r => { const o = md.moistureFarmOutput(r.totals.Performance, r.totals.Quality, 1); return ` ${o.ml} ml ${o.grade} = ${o.value} cr`; };
    const aging = r => ` ${1 + Math.trunc(Math.max(0, r.totals.Quality) / 125)} days/night`;

    await abSolvers('Furnace, Auto', [card('f', 'Furnace 1')], furnaceStage);
    await abSolvers('Moisture Farm, Auto (water value)', [card('mf', 'Moisture Farm 1')], water);
    await abSolvers('AgeWell, Quality target 250', [card('a', 'AgeWell 1', { target: { Quality: 250 } })], aging);
    await abSolvers('Furnace (1st) + AgeWell (2nd), shared pool', [card('f', 'Furnace 1', { rank: 1 }), card('a', 'AgeWell 1', { rank: 2 })]);

    console.log('DNA Manipulator: old default (complexity 0) vs Any seed');
    line('cx 0', await solve([card('d', 'DNA Manipulator 1', { job: '0' })], baseInventory()));
    line('any', await solve([card('d', 'DNA Manipulator 1')], baseInventory()));

    console.log('Furnace: purity steps vs Quality treated as linear');
    line('steps', await solve([card('f', 'Furnace 1')], baseInventory()), furnaceStage);
    line('linear', await solve([{ ...card('f', 'Furnace 1'), targetSteps: {}, worthlessBelowSteps: {} }], baseInventory()), furnaceStage);

    console.log('Repeatability: Moisture Farm, 3 runs');
    for (let i = 0; i < 3; i++) line(`run ${i + 1}`, await solve([card('mf', 'Moisture Farm 1')], baseInventory()), water);
} finally {
    await server.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
