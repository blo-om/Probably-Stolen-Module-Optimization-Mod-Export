/* The layout search, on typed boards (see typedCore.ts)
 *
 * Ruin and recreate over a set of machines that share one inventory: each iteration rebuilds one board (all of them when the search stagnates),
 * sometimes offering it a module off another board, and keeps the result if the set scores at least as well. The score is lexicographic over tiers
 * (targets by card order, then maximized stats by card order, then a tiebreak). Restarts go back to the record, now and then resetting one board
 *
 * Same search and objective as the object-board engine it replaced; what changed is the representation: boards are Int16Arrays of module indices,
 * modules are rows in typed arrays, and the scoring functions are the exact typed equivalents (checked cell for cell against the originals)
 */
import type { InventoryItem, ModuleShape, Stats } from '../types';
import { applyInternalEffects } from '../utils';
import type { Orientation } from '../utils';
import { calculateBoardStats, indexInventoryById, isSpecialModule, buildSearchPool, generateCodeFromState } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import { createTypedCore, CELLS, EMPTY, LOCKED, NEIGHBOR_DX, NEIGHBOR_DY, totalOf, waterValue, waterProgress, cheapEfficiency } from './typedCore';
import type { Board, MachineParams, Totals } from './typedCore';
import { createStallClock, EASE_STALL, RELAX_STALL } from './stall';

const STAT_KEYS: (keyof Stats)[] = ['Performance', 'Quality', 'Efficiency'];

// Overclocks are worth placing even where their Performance is not needed (a Learning Algorithm one only grows while it sits in a machine),
// so each placed one earns a little more in the tiebreak than the "fewer pieces" nudge costs; a Learning Algorithm one twice that
const OVERCLOCK_BONUS = 8;
// The fill only commits a placement that scores above zero, and one whose stats this machine does not score comes to exactly zero
// A nudge this small lifts an Overclock over that bar without outranking any placement that earns something
const OVERCLOCK_PLACEMENT_NUDGE = 0.001;

// How much harder the placement heuristic leans on a stat per rank it is above the least important one
// The acceptance test is strictly ordered on its own; this only points the greedy fill in the same direction
const PRIORITY_WEIGHT_STEP = 4;

/* How many pool entries the fill looks at before committing to one
 * Drawing a few candidates and keeping the best-scoring one biases the sample toward modules worth placing
 * Small on purpose: a large tournament would propose the same board every iteration and stop exploring
 */
const DRAW_TOURNAMENT = 4;
// Most draws a fill makes; past this the draw is only turning up modules that are already placed
const MAX_DRAWS = 192;

/* One rebuild in REPACK_ONE_IN, and every stagnant one, lifts all of a board's specials and puts them back down together in a random arrangement
 * found by a short backtracking search, so two of them can trade places or move as a pair. The layout they came from is always a valid answer
 */
const REPACK_ONE_IN = 4;
const REPACK_STEP_LIMIT = 1024;

// How much of a target's pull on the draw survives once the board already meets it; never zero, or a met target could not be defended
const TARGET_MET_DRAW_SCALE = 0.25;

/* Moisture Farm water (Auto for both stats) is priced by grade, and a grade only goes up when several Quality modules replace volume at
 * once: every single swap on the way loses volume without reaching the grade, so the search never takes it. One water farm fill in
 * WATER_AIM_SHARE aims at the next grade instead: the farm's unlocked volume modules come off, Quality modules go on until that grade's
 * Quality, then the rest is filled as usual. Kept only if the water is worth more. On the lock benchmark (11 machines, farms first or
 * farms only, equal or card-order priority) 0.5 made 5% more farm value from scratch and 4% more after locking and clearing; 0.9 cost
 */
const WATER_AIM_SHARE = 0.5;
/* After something is given up (eased or relaxed), the most important Auto stat short of its top breakpoint gets PROMOTE_SHARE of the
 * rebuilds until it reaches its next one, each lifting that board's modules that do not raise it and placing only ones that do until it
 * gets there (kept only if the score is no worse). On save_14's 33 machines the AgeWells (second priority) reached ~6 more breakpoints
 * by 30 s with the farms level; the 11-machine bench held level or better in priority order, a few more targets met
 */
const PROMOTE_SHARE = 0.25;
// Lowest Quality of each water grade above the worst (typedCore.ts WATER_GRADES)
const WATER_GRADE_QUALITY = [-50, 0, 50, 100, 150];

// How many big ruins may come back empty-handed before the search goes back to the record
const RESTART_AFTER_STAGNATIONS = 8;
const STAGNATION_LIMIT = 150;

// A missed stepped target costs this much on top of the distance, so reaching one fully always beats getting close on two
const STEP_MISS_PENALTY = 50;

// Every so many restarts one board goes back to its initial state instead of the record
const FRESH_START_EVERY = 4;
// One iteration in so many offers the rebuilt board one module off another board of the set
const STEAL_ONE_IN = 4;

const NODE_VALUE = 3;

const FRAME_BUDGET_MS = 12;
const TIMER_YIELD_INTERVAL_MS = 32;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const shuffle = <T,>(arr: T[] | Int16Array | Int32Array, count = arr.length) => {
    for (let i = count - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
};

// Hands the event loop back without setTimeout's ~4ms clamp; every so often through a timer anyway so timers cannot starve
const createYielder = () => {
    const timerYield = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });
    if (typeof MessageChannel === 'undefined') return { portYield: timerYield, timerYield, dispose: () => {} };
    const channel = new MessageChannel();
    let pending: (() => void) | null = null;
    channel.port1.onmessage = () => { const resolve = pending; pending = null; if (resolve) resolve(); };
    return {
        portYield: () => new Promise<void>(resolve => { pending = resolve; channel.port2.postMessage(0); }),
        timerYield,
        dispose: () => { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); }
    };
};

const compareTiers = (a: Float64Array, b: Float64Array) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
};

const statIsIgnored = (m: MachineConfig, key: keyof Stats) => Boolean(m.ignoreStats?.[key]);
const priorityOf = (m: MachineConfig, key: keyof Stats) => m.statPriority?.[key] ?? 1;

// With sumPQ or water (see MachineConfig) Quality folds into Performance, and with sumPE Performance folds into Efficiency,
// so the folded stat is ignored as a stat of its own
// A water farm with a Quality target keeps it as a target of its own (the lowest grade it may make), its water value maximized above it
const foldsQuality = (m: MachineConfig) => Boolean(m.sumPQ || (m.water && (m.targetStats.Quality ?? null) === null));
const folded = (m: MachineConfig, k: keyof Stats) => (foldsQuality(m) && k === 'Quality') || (Boolean(m.sumPE) && k === 'Performance');
const paramsOf = (m: MachineConfig): MachineParams => ({
    ignored: STAT_KEYS.map(k => statIsIgnored(m, k) || folded(m, k)),
    target: STAT_KEYS.map(k => folded(m, k) ? null : m.targetStats[k]),
    maximize: STAT_KEYS.map(k => !folded(m, k) && Boolean(m.maximizeStats?.[k])),
    sumPQ: Boolean(m.sumPQ),
    water: Boolean(m.water),
    sumPE: Boolean(m.sumPE),
    capP: m.performanceCap,
    cheapE: m.cheapEnergyAt,
});

// A machine's value of stat s: its own total, except Performance on a sumPQ machine (Performance + Quality) or a water one (water value),
// and Efficiency on a sumPE machine (Efficiency + Performance)
// (Performance past capP counts for nothing: a Moisture Farm's container holds 6000 ml)
// A water farm's Purity target is the grade it is to make: Quality past it is worth nothing more (so it does not overshoot)
const waterQuality = (p: MachineParams, q: number) => (p.target[1] !== null ? Math.min(q, p.target[1]) : q);
const statOf = (p: MachineParams, t: Totals, s: number) => {
    const tp = p.capP !== undefined ? Math.min(t.p, p.capP) : t.p;
    return s === 0 && p.water ? waterValue(tp, waterQuality(p, t.q)) : s === 0 && p.sumPQ ? tp + t.q : s === 2 && p.sumPE ? t.e + t.p : s === 0 ? tp : totalOf(t, s);
};

// How much a maximized point of each stat is worth: Efficiency half, so Performance and Quality always come first
const MAXIMIZE_WEIGHT = [1, 1, 0.5];
// What a maximized stat at `v` is worth: its weight, and Efficiency past the machine's 4 energy a day much less (see cheapEfficiency)
const maximizedWorth = (p: MachineParams, v: number, s: number) => (s === 2 ? cheapEfficiency(v, p.cheapE) : v) * MAXIMIZE_WEIGHT[s];

// A scored board: its totals, and its tiebreak once worked out (tbGen says under which targets)
type Scored = Totals & { tb: number; tbGen: number };

/* Knobs of the search. The defaults are the search as it runs by default; the rest exist so variants can be run side by side (see solver/parallel.ts)
 *   tournament       DRAW_TOURNAMENT
 *   ruinMax          most pieces an ordinary ruin takes off a board
 *   stagnationLimit  non-improving iterations before a big ruin
 *   repackOneIn      REPACK_ONE_IN
 *   swapOneIn        one iteration in so many is a same-shape swap instead of a rebuild (0: never; default 6)
 *   relayoutOneIn    one iteration in so many re-lays one board's own modules in a new order instead of a rebuild (0: never)
 *   ease             Auto stats with breakpoints may be eased when the search stalls (see StallOrder; 0: never). On by default: on
 *                    all-Auto A/B scenarios (12 runs a side, 20 s, scored by the step each stat reaches in the game) the total rose 2-7%,
 *                    the priority order held level, and targets elsewhere were met as often or more
 *   polish           near-target polish (see polishNearTargets; 0: off). On by default: on A/B scenarios with most machines on targets near
 *                    what they reach (28 runs a side, 8 s), the hardest near miss (AgeWell 250, reached ~245) was met 16 times against 7;
 *                    other targets and the overall score within noise; ~3% of the search time
 *   waterAim         share of water farm fills that aim at the next grade (WATER_AIM_SHARE; 0: never)
 *   promote          share of rebuilds that go to the promoted stat after a give-up (PROMOTE_SHARE; 0: never)
 */
export type EngineTuning = {
    tournament?: number;
    ruinMax?: number;
    stagnationLimit?: number;
    repackOneIn?: number;
    swapOneIn?: number;
    relayoutOneIn?: number;
    polish?: number;
    ease?: number;
    waterAim?: number;
    promote?: number;
    // 0: a stalled search running on its own never gives anything up (no relax, no ease); with workers the coordinator decides
    stall?: number;
};

/* Tried on the A/B benches and dropped (details in the git history): late-acceptance hill climbing, relaxing the farthest target
 * first, sharing records between workers, a bonus per breakpoint reached on Auto, easing in card order, polishing Auto stats near a
 * breakpoint (with modules from donors that stay on theirs), scoring Auto stats by the breakpoint reached, and a GPU search
 */

/* What a stalled search gives up, one at a time (see stallOrder):
 *   ease   an Auto stat with breakpoints stops at the step it has reached (see stallOrders): it becomes a target at that step and is no longer maximized,
 *          so the modules pushing it towards a next step it cannot reach go where they count (points between steps do nothing in the game)
 *   relax  an unmet stepped target drops one step
 */
// ease: the step to hold, or null to stop caring about the stat altogether (below its first step, where nothing it does counts)
// mIdx -1: the water farms' Purity targets go on (see lateTargets)
export type StallOrder = { mIdx: number; s: number; ease?: number | null };

export type EngineUpdates = Map<string, { board: any[][], totals: Stats, pieceStats: Map<string, Stats>, code: string, ownTotals?: Stats }>;

/* What a stalled search gives up next (see StallOrder); empty when nothing is left. Shared by the engine and the worker coordinator
 * (solver/parallel.ts), so both pick the same
 *   1. Auto stats with breakpoints at or past their lowest step, and below it too where nothing below the first step counts
 *      (MachineConfig.worthlessBelowSteps: a Furnace under 100% makes a +0 ingot however close it is; a Moisture Farm under 0 still
 *      makes worse water, so it is left alone there). Such a stat is dropped altogether rather than held at a step.
 *      All that are less than EASE_BATCH_SHARE of the way to their next step go at once; otherwise the EASE_LEAST_SHARE of them with
 *      the least progress (at least one; lowest priority on a tie), so a stat close to its next step keeps its chance longest
 *   2. then the unmet stepped target of the lowest priority, one step
 */
const EASE_BATCH_SHARE = 0.5;
// One at a time made big sets wait a stall for every Auto stat (see solver/stall.ts)
const EASE_LEAST_SHARE = 0.25;
export const stallOrders = (machines: MachineConfig[], targets: (number | null)[][], maximize: boolean[][], valueOf: (mIdx: number, s: number) => number): StallOrder[] => {
    const eases: { mIdx: number; s: number; rank: number; step: number | null; progress: number }[] = [];
    let relax: { mIdx: number; s: number; rank: number } | null = null;
    machines.forEach((m, mIdx) => STAT_KEYS.forEach((key, s) => {
        const steps = m.targetSteps?.[key];
        if (!steps || steps.length === 0 || statIsIgnored(m, key) || folded(m, key)) return;
        const rank = priorityOf(m, key);
        const target = targets[mIdx][s];
        const value = valueOf(mIdx, s);
        if (target === null && maximize[mIdx][s]) {
            const sorted = [...steps].sort((a, b) => a - b);
            const reached = sorted.filter(v => v <= value);
            if (reached.length === 0) {
                if (!m.worthlessBelowSteps?.[key]) return;
                eases.push({ mIdx, s, rank, step: null, progress: sorted[0] > 0 ? Math.max(0, value) / sorted[0] : 0 });
                return;
            }
            const step = reached[reached.length - 1];
            const next = sorted.find(v => v > value);
            eases.push({ mIdx, s, rank, step, progress: next === undefined ? 1 : (value - step) / (next - step) });
        } else if (target !== null && value < target) {
            if (relax === null || rank > relax.rank || (rank === relax.rank && mIdx > relax.mIdx)) relax = { mIdx, s, rank };
        }
    }));
    const batch = eases.filter(e => e.progress < EASE_BATCH_SHARE);
    if (batch.length > 0) return batch.map(e => ({ mIdx: e.mIdx, s: e.s, ease: e.step }));
    if (eases.length > 0) {
        eases.sort((a, b) => a.progress - b.progress || b.rank - a.rank || b.mIdx - a.mIdx);
        return eases.slice(0, Math.max(1, Math.ceil(eases.length * EASE_LEAST_SHARE))).map(e => ({ mIdx: e.mIdx, s: e.s, ease: e.step }));
    }
    const r = relax as { mIdx: number; s: number } | null;
    return r !== null ? [{ mIdx: r.mIdx, s: r.s }] : [];
};

export const runOptimizationEngine = async (
    callerMachines: MachineConfig[],
    initialObjectBoards: any[][][],
    searchPoolInventory: InventoryItem[],
    fullInventory: InventoryItem[],
    isSolvingRef: { current: boolean },
    // `tiers` is the reported layout's score against the targets as they stand (relaxed ones lowered), so a relaxed layout can win
    onUpdate: (updates: EngineUpdates, tiers: number[]) => void,
    tuning: EngineTuning = {},
    // Set when several searches run together (solver/parallel.ts): they must relax the same targets at the same time, or their reports
    // could not be ranked, so the coordinator decides and this hands over its orders (machine, stat index) instead of the own clock
    relaxOrders?: () => StallOrder[]
) => {
    const TOURNAMENT = tuning.tournament ?? DRAW_TOURNAMENT;
    const RUIN_MAX = tuning.ruinMax ?? 3;
    const STAGNATION = tuning.stagnationLimit ?? STAGNATION_LIMIT;
    const REPACK_EVERY = tuning.repackOneIn ?? REPACK_ONE_IN;
    const WATER_AIM = tuning.waterAim ?? WATER_AIM_SHARE;
    const PROMOTE = tuning.promote ?? PROMOTE_SHARE;
    // On by default: measured better or level on every benchmark scenario at 1 in 6 (1 in 3 cost the all-Auto case)
    const SWAP_EVERY = tuning.swapOneIn ?? 6;
    const RELAYOUT_EVERY = tuning.relayoutOneIn ?? 0;
    const POLISH = tuning.polish ?? 1;
    const EASE = tuning.ease ?? 1;
    const STALL = tuning.stall ?? 1;
    // Targets can be relaxed during the run, so the engine works on copies; codes are always written with the targets as they were set
    const machines: MachineConfig[] = callerMachines.map(m => ({ ...m, targetStats: { ...m.targetStats } }));
    const machineCount = machines.length;
    const params = machines.map(paramsOf);
    const callerParams = callerMachines.map(paramsOf);

    // ---- modules as indices
    // Everything the solve can meet: the full inventory, anything already on a board, and the search pool's own objects
    const itemList: InventoryItem[] = [];
    const seenIds = new Set<string>();
    const addItem = (item: InventoryItem) => { if (!seenIds.has(item.id)) { seenIds.add(item.id); itemList.push(item); } };
    fullInventory.forEach(addItem);
    initialObjectBoards.forEach(b => b.forEach((row: any[]) => row.forEach(cell => { if (cell && cell !== 'Locked') addItem(cell); })));
    searchPoolInventory.forEach(addItem);

    const internalById = new Map<string, Stats>();
    itemList.forEach(item => internalById.set(item.id, applyInternalEffects(item)));
    const core = createTypedCore(itemList, item => internalById.get(item.id)!);
    const N = core.count;
    const idx = (item: InventoryItem) => core.indexOf.get(item.id)!;

    // A module that came in locked on a board (right-click; the specials, Alarm / Junk Processing / Blast, start locked) belongs to its
    // board: it moves around it but never leaves. An unlocked special may be taken off; it is never put on another board (see buildSearchPool)
    const fixed = new Uint8Array(N);
    initialObjectBoards.forEach(b => b.forEach((row: any[]) => row.forEach(cell => { if (cell && cell !== 'Locked' && cell.isLocked) fixed[idx(cell)] = 1; })));
    const overclock = new Uint8Array(N);
    const ocBonus = new Float64Array(N);
    itemList.forEach((item, i) => {
        if (item.displayName.includes('Overclock')) {
            overclock[i] = 1;
            ocBonus[i] = item.effects.includes('Learning Algorithm') ? OVERCLOCK_BONUS * 2 : OVERCLOCK_BONUS;
        }
    });

    const toTyped = (board: any[][]): Board => {
        const out = new Int16Array(CELLS);
        for (let c = 0; c < CELLS; c++) {
            const cell = board[(c - c % 7) / 7][c % 7];
            out[c] = !cell ? EMPTY : cell === 'Locked' ? LOCKED : idx(cell);
        }
        return out;
    };
    const initialBoards = initialObjectBoards.map(toTyped);
    const lockedMask = (b: Board) => { let m = ''; for (let c = 0; c < CELLS; c++) m += b[c] === LOCKED ? '1' : '0'; return m; };

    // ---- the search pool
    const searchPool = buildSearchPool(searchPoolInventory, internalById, machines).map(idx);
    const P = searchPool.length;
    const poolOf = new Int32Array(N).fill(-1);
    searchPool.forEach((it, i) => { poolOf[it] = i; });
    const poolOrder = new Int32Array(P);
    for (let i = 0; i < P; i++) poolOrder[i] = i;
    const poolShapes = [...new Set(searchPool.map(it => core.shape[it]))];
    const poolShapeCount = poolShapes.length;

    // ---- tiers
    const activeRanks = new Set<number>();
    for (const m of machines) for (const key of STAT_KEYS) if (!statIsIgnored(m, key)) activeRanks.add(priorityOf(m, key));
    if (activeRanks.size === 0) activeRanks.add(1);
    const rankOrder = [...activeRanks].sort((a, b) => a - b);
    const tierCount = rankOrder.length;
    const tierOfRank = new Map<number, number>(rankOrder.map((r, i) => [r, i]));
    // Tier of each machine's stat, -1 when ignored
    const tierOfStat = machines.map((m, mIdx) => STAT_KEYS.map((k, s) => params[mIdx].ignored[s] ? -1 : tierOfRank.get(priorityOf(m, k))!));
    const stepsOf = machines.map(m => STAT_KEYS.map(k => m.targetSteps?.[k]));
    /* Interchangeable machines: same priority for every stat, same settings, same locked cells (neighbouring identical cards share a
     * priority in Run All). The same layout does the same on any of them, so reports hand the best layouts to the earliest cards
     * (see orderGroups): they reach the better breakpoints first and get the scarce modules, and the total is unchanged
     */
    const groupOf = (() => {
        const keys = machines.map((m, mIdx) => JSON.stringify([tierOfStat[mIdx], params[mIdx], stepsOf[mIdx], lockedMask(initialBoards[mIdx]),
            m.performanceCap ?? null, m.worthlessBelowSteps ?? null]));
        const groups: number[][] = [];
        keys.forEach((k, mIdx) => {
            const g = groups.find(gr => keys[gr[0]] === k);
            if (g) g.push(mIdx); else groups.push([mIdx]);
        });
        return groups.filter(g => g.length > 1);
    })();

    /* Tier layout, most important first:
     *   [0 .. tierCount)              target shortfall, one tier per priority rank (card order): every target outranks every maximized stat,
     *                                 and among targets the first card's come first
     *   [tierCount .. 2 * tierCount)  maximized stats, one tier per priority rank
     *   [2 * tierCount]               tiebreak (see tiebreakOf)
     */
    const RANK_OFFSET = tierCount;
    const TIEBREAK_TIER = 2 * tierCount;
    const TIER_LENGTH = 2 * tierCount + 1;
    const currentTiers = new Float64Array(TIER_LENGTH);
    const epochTiers = new Float64Array(TIER_LENGTH).fill(-Infinity);
    const bestTiers = new Float64Array(TIER_LENGTH).fill(-Infinity);
    const recordTiers = new Float64Array(TIER_LENGTH);

    // A machine whose every enabled stat is held to a target only has to reach them, with the least valuable modules that do
    const isTargetOnly = params.map(p => {
        let hasTarget = false;
        for (let s = 0; s < 3; s++) {
            if (p.ignored[s]) continue;
            if (p.maximize[s]) return false;
            if (p.target[s] !== null) hasTarget = true;
        }
        return hasTarget;
    });
    const meetsTargets = (p: MachineParams, t: Totals) => {
        for (let s = 0; s < 3; s++) {
            const target = p.target[s];
            if (!p.ignored[s] && target !== null && statOf(p, t, s) < target) return false;
        }
        return true;
    };

    // What a module is worth to the machines that maximize (Nodes a little; specials and Overclocks nothing)
    const maximized = [0, 1, 2].filter(s => params.some(p => (!p.ignored[s] && p.maximize[s]) || (s === 1 && (p.sumPQ || p.water) && p.maximize[0])
        || (s === 0 && p.sumPE && p.maximize[2])));
    const valueStats = maximized.length > 0 ? maximized : [0, 1, 2];
    const value = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        if (fixed[i] && isSpecialModule(itemList[i])) continue;
        if (overclock[i]) continue;
        if (core.white[i]) { value[i] = NODE_VALUE; continue; }
        let v = 0;
        for (const s of valueStats) v += Math.max(0, s === 0 ? core.IP[i] : s === 1 ? core.IQ[i] : core.IE[i]);
        value[i] = v;
    }

    // ---- tiebreak: target-only machines pay for the value they hold, the rest a small cost per piece; overshoot and Overclocks on both
    const tbStamp = new Int32Array(N);
    let tbStampGen = 0;
    let tbGen = 0;
    const tiebreakOf = (mIdx: number, board: Board, t: Totals) => {
        const p = params[mIdx];
        let overshoot = 0;
        for (let s = 0; s < 3; s++) {
            const target = p.target[s];
            if (p.ignored[s] || target === null || p.maximize[s]) continue;
            const v = statOf(p, t, s);
            if (v > target) overshoot += v - target;
        }
        const g = ++tbStampGen;
        let held = 0, bonus = 0;
        for (let c = 0; c < CELLS; c++) {
            const a = board[c];
            if (a < 0 || tbStamp[a] === g) continue;
            tbStamp[a] = g;
            held += value[a];
            bonus += ocBonus[a];
        }
        return isTargetOnly[mIdx] ? held + overshoot - bonus : t.pieces * 5 + overshoot - bonus;
    };
    const score = (board: Board): Scored => ({ ...core.boardTotals(board), tb: 0, tbGen: -1 });

    // Scores a set of boards into `tiers`; `ps` is whose targets to measure against (this run's, or the caller's for reports)
    // `steer`: scores for the search to climb by, where a water farm's progress towards its next grade (waterProgress) counts with its
    // value; without it, the real value only (the record, and everything shown), with that progress as a tiebreak
    const scoreInto = (tiers: Float64Array, statsFor: (mIdx: number) => Scored, boardFor: (mIdx: number) => Board, ps: MachineParams[] = params, steer = false) => {
        tiers.fill(0);
        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
            const st = statsFor(mIdx);
            const p = ps[mIdx];
            for (let s = 0; s < 3; s++) {
                const ti = tierOfStat[mIdx][s];
                if (ti < 0) continue;
                const v = statOf(p, st, s);
                const target = p.target[s];
                if (target !== null && v < target) {
                    tiers[ti] -= (target - v) * 10000;
                    if (stepsOf[mIdx][s]) tiers[ti] -= STEP_MISS_PENALTY * 10000;
                }
                if (p.maximize[s]) {
                    tiers[ti + RANK_OFFSET] += maximizedWorth(p, v, s) * 10;
                    if (s === 0 && p.water) {
                        const progress = waterProgress(p.capP !== undefined ? Math.min(st.p, p.capP) : st.p, waterQuality(p, st.q)) * 10;
                        if (steer) tiers[ti + RANK_OFFSET] += progress * MAXIMIZE_WEIGHT[0]; else tiers[TIEBREAK_TIER] += progress;
                    }
                }
            }
            // Only changes with the board (each scored board has its own Scored) and with the targets (tbGen)
            if (ps === params) {
                if (st.tbGen !== tbGen) { st.tb = tiebreakOf(mIdx, boardFor(mIdx), st); st.tbGen = tbGen; }
                tiers[TIEBREAK_TIER] -= st.tb;
            } else {
                tiers[TIEBREAK_TIER] -= tiebreakOf(mIdx, boardFor(mIdx), st);
            }
        }
    };
    const reportTiers = (statsFor: (mIdx: number) => Scored, boardFor: (mIdx: number) => Board) => {
        const tiers = new Float64Array(TIER_LENGTH);
        scoreInto(tiers, statsFor, boardFor);
        return Array.from(tiers);
    };

    // ---- boards
    const currentBoards = initialBoards.map(b => b.slice());
    const currentStats: Scored[] = currentBoards.map(score);
    const bestBoards = currentBoards.map(b => b.slice());
    const bestStats: Scored[] = [...currentStats];
    const testBoards = currentBoards.map(b => b.slice());
    const rebuiltStats: Scored[] = [...currentStats];
    const openCellCount = initialBoards.map(b => { let n = 0; for (let c = 0; c < CELLS; c++) if (b[c] !== LOCKED) n++; return n; });

    // ---- the fill's weights and draw tables
    const targetedStats = params.map(p => [0, 1, 2].filter(s => p.target[s] !== null));
    const boost = (mIdx: number, s: number) => tierOfStat[mIdx][s] < 0 ? 1 : Math.pow(PRIORITY_WEIGHT_STEP, tierCount - 1 - tierOfStat[mIdx][s]);
    const baseWeights = params.map((p, mIdx) => [0, 1, 2].map(s => {
        if (p.ignored[s]) return 0;
        let w = 0;
        if (p.maximize[s]) w += 10 * MAXIMIZE_WEIGHT[s];
        if (p.target[s] !== null) w += 15;
        return w * boost(mIdx, s);
    }));

    // What each pool entry is worth to a machine per cell, for choosing what the fill is offered; one table per combination of met targets
    const drawValues: Float64Array[][] = params.map((p, mIdx) => {
        const targeted = targetedStats[mIdx];
        const tables: Float64Array[] = [];
        for (let mask = 0; mask < (1 << targeted.length); mask++) {
            const w = [0, 1, 2].map(s => {
                if (p.ignored[s]) return 0;
                let v = p.maximize[s] ? 10 * MAXIMIZE_WEIGHT[s] : 0;
                const ti = targeted.indexOf(s);
                if (ti !== -1) v += 15 * ((mask & (1 << ti)) !== 0 ? TARGET_MET_DRAW_SCALE : 1);
                return v * Math.pow(PRIORITY_WEIGHT_STEP, tierCount - 1 - tierOfStat[mIdx][s]);
            });
            if (p.sumPQ || p.water) w[1] = w[0];
            if (p.sumPE) w[0] = w[2];
            const values = new Float64Array(P);
            const stated: number[] = [];
            for (let i = 0; i < P; i++) {
                const it = searchPool[i];
                if (core.white[it] || core.size[it] === 0) continue;
                values[i] = (core.IP[it] * w[0] + core.IQ[it] * w[1] + core.IE[it] * w[2]) / core.size[it];
                stated.push(values[i]);
            }
            // Nodes are worth what they add beside other modules, which only the placement sees; the median keeps them drawn like an ordinary module
            if (stated.length > 0) {
                stated.sort((a, b) => a - b);
                const median = stated[stated.length >> 1];
                for (let i = 0; i < P; i++) if (core.white[searchPool[i]]) values[i] = median;
            }
            tables.push(values);
        }
        return tables;
    });

    // ---- scratch
    const placedMark = new Int32Array(P);
    const consumedMark = new Int32Array(P);
    let markGen = 0;
    let consumedGen = 0;
    const itemStamp = new Int32Array(N);
    let itemGen = 0;
    const pieces: number[] = [];
    const removed = new Uint8Array(N);
    const specialsOnBoard: { item: number; cells: number[] }[][] = machines.map(() => []);
    const freeCells: number[] = [];
    const rebuiltMachines: number[] = [];
    const isRebuilt: boolean[] = new Array(machineCount).fill(false);
    const infeasible = new Set<ModuleShape>();
    const stealItems: number[] = [];
    const stealOwners: number[] = [];

    const rebuildFreeCells = (board: Board) => {
        freeCells.length = 0;
        for (let c = 0; c < CELLS; c++) if (board[c] === EMPTY) freeCells.push(c);
        shuffle(freeCells);
    };
    const compactFreeCells = (board: Board) => {
        let w = 0;
        for (let c = 0; c < freeCells.length; c++) if (board[freeCells[c]] === EMPTY) freeCells[w++] = freeCells[c];
        freeCells.length = w;
    };
    const fits = (board: Board, x: number, y: number, o: Orientation) => {
        if (x + o.minX < 0 || x + o.maxX > 6 || y + o.minY < 0 || y + o.maxY > 4) return false;
        for (let i = 0; i < o.count; i++) if (board[(y + o.ys[i]) * 7 + x + o.xs[i]] !== EMPTY) return false;
        return true;
    };
    const put = (board: Board, x: number, y: number, o: Orientation, v: number) => {
        for (let i = 0; i < o.count; i++) board[(y + o.ys[i]) * 7 + x + o.xs[i]] = v;
    };
    const shapeFitsAnywhere = (shape: ModuleShape, board: Board) => {
        const orientations = core.orientations[searchPool.find(it => core.shape[it] === shape)!];
        if (!orientations) return false;
        for (let c = 0; c < freeCells.length; c++) {
            const x = freeCells[c] % 7, y = (freeCells[c] - x) / 7;
            for (const o of orientations) if (fits(board, x, y, o)) return true;
        }
        return false;
    };
    const shapeOrientations = new Map<ModuleShape, Orientation[] | undefined>();
    for (const it of searchPool) if (!shapeOrientations.has(core.shape[it])) shapeOrientations.set(core.shape[it], core.orientations[it]);

    // Commits `it` at its best-scoring placement among the free cells; `incumbent` is where a relocated piece already stands
    const committed = new Float64Array(3);
    const placeBestFit = (it: number, board: Board, boardIsEmpty: boolean, w: number[], cur: number[], p: MachineParams,
        incumbent: { x: number; y: number; o: Orientation } | null = null) => {
        const orientations = core.orientations[it];
        if (!orientations) return false;
        let bestX = -1, bestY = -1;
        let bestO: Orientation | null = null;
        let best = incumbent !== null ? -Infinity : 0.0001;
        let d0 = 0, d1 = 0, d2 = 0;
        const nudge = overclock[it] ? OVERCLOCK_PLACEMENT_NUDGE : 0;
        const zeroOk = nudge > 0;
        if (incumbent !== null) {
            const s = core.evalPlacement(it, incumbent.x, incumbent.y, incumbent.o, board, boardIsEmpty, w[0], w[1], w[2], cur[0], cur[1], cur[2], p, zeroOk);
            if (s !== -Infinity) {
                best = s + nudge;
                d0 = core.delta[0]; d1 = core.delta[1]; d2 = core.delta[2];
                bestX = incumbent.x; bestY = incumbent.y; bestO = incumbent.o;
            }
        }
        for (let c = 0; c < freeCells.length; c++) {
            const x = freeCells[c] % 7, y = (freeCells[c] - x) / 7;
            for (let k = 0; k < orientations.length; k++) {
                const o = orientations[k];
                if (x + o.minX < 0 || x + o.maxX > 6 || y + o.minY < 0 || y + o.maxY > 4) continue;
                const s = core.evalPlacement(it, x, y, o, board, boardIsEmpty, w[0], w[1], w[2], cur[0], cur[1], cur[2], p, zeroOk) + nudge;
                if (s > best && s !== -Infinity) {
                    best = s;
                    d0 = core.delta[0]; d1 = core.delta[1]; d2 = core.delta[2];
                    bestX = x; bestY = y; bestO = o;
                }
            }
        }
        if (!bestO) return false;
        put(board, bestX, bestY, bestO, it);
        compactFreeCells(board);
        committed[0] = d0; committed[1] = d1; committed[2] = d2;
        return true;
    };

    // Lifts every special on the board and puts them all back in one random arrangement (see REPACK_ONE_IN); false, board unchanged, if none turns up
    const repackSpecials = (board: Board, specials: { item: number; cells: number[] }[]) => {
        for (const sp of specials) for (const c of sp.cells) board[c] = EMPTY;
        const order = specials.slice();
        shuffle(order);
        let steps = 0;
        const placeFrom = (k: number): boolean => {
            if (k === order.length) return true;
            const it = order[k].item;
            const orientations = core.orientations[it];
            if (!orientations) return false;
            const options: [number, number, Orientation][] = [];
            for (let c = 0; c < CELLS; c++) {
                if (board[c] !== EMPTY) continue;
                const x = c % 7, y = (c - x) / 7;
                for (const o of orientations) if (fits(board, x, y, o)) options.push([x, y, o]);
            }
            shuffle(options);
            for (const [x, y, o] of options) {
                if (++steps > REPACK_STEP_LIMIT) return false;
                put(board, x, y, o, it);
                if (placeFrom(k + 1)) return true;
                put(board, x, y, o, EMPTY);
            }
            return false;
        };
        if (placeFrom(0)) {
            rebuildFreeCells(board);
            return true;
        }
        for (const sp of specials) for (const c of sp.cells) board[c] = sp.item;
        return false;
    };

    // Target-only machines swap modules for weaker unused ones of the same shape while every target stays met
    const downgradeTargetMachines = (boards: Board[]) => {
        if (!isTargetOnly.some(Boolean)) return false;
        const g = ++itemGen;
        for (const b of boards) for (let c = 0; c < CELLS; c++) if (b[c] >= 0) itemStamp[b[c]] = g;
        const spare: number[] = [];
        for (const item of searchPoolInventory) {
            const it = idx(item);
            if (!item.isLocked && !fixed[it] && !core.white[it] && itemStamp[it] !== g) spare.push(it);
        }
        let changed = false;
        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
            if (!isTargetOnly[mIdx]) continue;
            const board = boards[mIdx];
            const own: number[] = [];
            const og = ++itemGen;
            for (let c = 0; c < CELLS; c++) {
                const a = board[c];
                if (a >= 0 && !fixed[a] && !core.white[a] && itemStamp[a] !== og) { itemStamp[a] = og; own.push(a); }
            }
            own.sort((a, b) => value[b] - value[a]);
            const swap = (from: number, to: number) => { for (let c = 0; c < CELLS; c++) if (board[c] === from) board[c] = to; };
            for (const piece of own) {
                const candidates = spare.filter(q => core.shape[q] === core.shape[piece] && value[q] < value[piece]).sort((a, b) => value[a] - value[b]);
                for (const cand of candidates) {
                    swap(piece, cand);
                    if (meetsTargets(params[mIdx], core.boardTotals(board))) {
                        spare.splice(spare.indexOf(cand), 1);
                        spare.push(piece);
                        changed = true;
                        break;
                    }
                    swap(cand, piece);
                }
            }
        }
        return changed;
    };

    /* Learning Algorithm Overclocks only grow while they sit in a machine, so any left unused go into free space in what gets reported
     * Machines with Efficiency off first, none with an Efficiency target, a spot touching no Node preferred. Done on a copy, not in the search
     */
    const learningAlgorithms = searchPoolInventory
        .filter(item => item.displayName.includes('Overclock') && item.effects.includes('Learning Algorithm') && !item.isLocked && !item.id.includes('_clone_'))
        .map(idx);
    const laOrder = machines.map((_, mIdx) => mIdx)
        .filter(mIdx => callerParams[mIdx].target[2] === null || params[mIdx].ignored[2])
        .sort((a, b) => Number(!params[a].ignored[2]) - Number(!params[b].ignored[2]));
    const withSpareLearningAlgorithms = (boards: Board[]) => {
        if (learningAlgorithms.length === 0) return null;
        const g = ++itemGen;
        for (const b of boards) for (let c = 0; c < CELLS; c++) if (b[c] >= 0) itemStamp[b[c]] = g;
        const spare = learningAlgorithms.filter(it => itemStamp[it] !== g);
        if (spare.length === 0) return null;
        let out: Board[] | null = null;
        const changed = new Set<number>();
        for (const it of spare) {
            const orientations = core.orientations[it];
            if (!orientations) continue;
            type Spot = { mIdx: number; x: number; y: number; o: Orientation; nodes: number };
            let best = null as Spot | null;
            for (const mIdx of laOrder) {
                const board = (out ?? boards)[mIdx];
                for (let c = 0; c < CELLS; c++) {
                    const x = c % 7, y = (c - x) / 7;
                    for (const o of orientations) {
                        if (!fits(board, x, y, o)) continue;
                        let nodes = 0;
                        for (let i = 0; i < o.count; i++) {
                            const cx = x + o.xs[i], cy = y + o.ys[i];
                            for (let d = 0; d < 4; d++) {
                                const nx = cx + NEIGHBOR_DX[d], ny = cy + NEIGHBOR_DY[d];
                                if (nx < 0 || nx > 6 || ny < 0 || ny > 4) continue;
                                const a = board[ny * 7 + nx];
                                if (a >= 0 && core.white[a]) nodes++;
                            }
                        }
                        if (best === null || nodes < best.nodes) best = { mIdx, x, y, o, nodes };
                    }
                }
                if (best !== null && (best as Spot).nodes === 0) break;
            }
            // Assigned inside the loops, which TypeScript's narrowing does not follow
            const spot = best as Spot | null;
            if (spot === null) continue;
            if (out === null) out = boards.map(b => b.slice());
            put(out[spot.mIdx], spot.x, spot.y, spot.o, it);
            changed.add(spot.mIdx);
        }
        return out ? { boards: out, changed } : null;
    };

    // The lowest-priority unmet stepped target drops one step (or is dropped below its lowest), and the record is re-scored against that
    /* Water farms' Purity targets start off: the farms first make the most valuable water they can (on Auto), and the targets go on at the
     * first give-up, which is when the free search has stalled. Held as targets from the start they kept the farms from trying other
     * module mixes: on save_14 (33 machines, every farm on Target: Pure, 8 runs, 60 s) 81,112 credits a day, 82,408 this way, still
     * every farm Pure. Tried and dropped with it: holding every machine's targets back the same way (worse on target scenarios),
     * clearing a target farm's Quality modules now and then, and a same-shape swap sweep when stagnant (both no better or worse)
     * Only when the search gives things up (several machines); a single machine run keeps its targets from the start
     */
    const lateTargets: [number, number][] = [];
    if (machineCount > 1 && (relaxOrders || STALL)) {
        params.forEach((p, mIdx) => { if (p.water && p.target[1] !== null) { lateTargets.push([mIdx, p.target[1]]); p.target[1] = null; } });
        if (lateTargets.length > 0) { tbGen++; scoreInto(bestTiers, (m) => bestStats[m], (m) => bestBoards[m]); }
    }
    const switchTargetsOn = () => {
        for (const [mIdx, t] of lateTargets) params[mIdx].target[1] = t;
        lateTargets.length = 0;
        tbGen++;
        scoreInto(bestTiers, (m) => bestStats[m], (m) => bestBoards[m]);
    };
    const relaxLowestTarget = () => {
        if (lateTargets.length > 0) { switchTargetsOn(); return true; }
        const orders = stallOrders(machines, params.map(p => p.target), params.map(p => EASE ? p.maximize : [false, false, false]), (mIdx, s) => statOf(params[mIdx], bestStats[mIdx], s));
        if (orders.length > 0 && orders[0].ease === undefined && !stall.due(RELAX_STALL)) return false;
        for (const order of orders) applyOrder(order);
        return orders.length > 0;
    };
    const applyOrder = (order: StallOrder) => {
        if (order.mIdx < 0) {
            switchTargetsOn();
        } else if (order.ease !== undefined) {
            params[order.mIdx].target[order.s] = order.ease;
            params[order.mIdx].maximize[order.s] = false;
            tbGen++;
            scoreInto(bestTiers, (m) => bestStats[m], (m) => bestBoards[m]);
        } else {
            lowerTarget(order.mIdx, order.s);
        }
    };
    const lowerTarget = (mIdx: number, s: number) => {
        const current = params[mIdx].target[s];
        const steps = stepsOf[mIdx][s];
        if (current === null || !steps) return;
        const lower = steps.filter(v => v < current);
        params[mIdx].target[s] = lower.length > 0 ? lower[lower.length - 1] : null;
        // Below its lowest step the stat still counts (an Alarm's stop chance, Moisture Farm purity turning to Rust) unless nothing
        // below that step does (worthlessBelowSteps): then it is maximized at its card's priority instead of dropped
        if (lower.length === 0) params[mIdx].maximize[s] = !machines[mIdx].worthlessBelowSteps?.[STAT_KEYS[s]];
        tbGen++;
        scoreInto(bestTiers, (m) => bestStats[m], (m) => bestBoards[m]);
    };

    // ---- reporting
    const currentCodes: string[] = new Array(machineCount).fill('');
    const codeIsStale: boolean[] = new Array(machineCount).fill(true);
    const inventoryById = indexInventoryById(itemList);
    const codeFor = (mIdx: number, objectBoard: (InventoryItem | 'Locked' | null)[][]) => {
        const usedClones = new Set<string>();
        objectBoard.forEach(row => row.forEach(cell => { if (cell && cell !== 'Locked' && cell.id.includes('_clone_')) usedClones.add(cell.id); }));
        const inventoryForCode = fullInventory.filter(item => !item.id.includes('_clone_') || usedClones.has(item.id));
        return generateCodeFromState(machines[mIdx].tier, machines[mIdx].maximizeStats, callerMachines[mIdx].targetStats, inventoryForCode, objectBoard);
    };
    let pendingUpdate = false;
    // For each machine, whose layout it reports: within each interchangeable group the layouts sorted best first (the group's
    // maximized value, Performance and Quality before Efficiency) go to the cards in order. A layout holding a machine's own
    // special module (fixed) stays where it is
    const orderGroups = (boards: Board[], stats: Scored[]) => {
        const from = boards.map((_, mIdx) => mIdx);
        for (const group of groupOf) {
            const free = group.filter(mIdx => { const b = boards[mIdx]; for (let c = 0; c < CELLS; c++) if (b[c] >= 0 && fixed[b[c]]) return false; return true; });
            // Only machines whose goals are still the same: easing or relaxing can have given them different targets since the start
            const bySettings = new Map<string, number[]>();
            for (const mIdx of free) { const k = JSON.stringify(params[mIdx]); bySettings.set(k, [...(bySettings.get(k) ?? []), mIdx]); }
            bySettings.forEach(movable => {
                if (movable.length < 2) return;
                const worth = (j: number) => { let w = 0; for (let s = 0; s < 3; s++) if (params[j].maximize[s]) w += maximizedWorth(params[j], statOf(params[j], stats[j], s), s); return w; };
                const sorted = [...movable].sort((a, b) => worth(b) - worth(a) || a - b);
                movable.forEach((mIdx, i) => { from[mIdx] = sorted[i]; });
            });
        }
        return from;
    };
    const flushUpdate = () => {
        if (!pendingUpdate) return;
        pendingUpdate = false;
        const updates: EngineUpdates = new Map();
        const spare = withSpareLearningAlgorithms(bestBoards);
        const unordered = spare ? spare.boards : bestBoards;
        const unorderedStats = spare ? unordered.map((b, mIdx) => spare.changed.has(mIdx) ? score(b) : bestStats[mIdx]) : bestStats;
        const from = orderGroups(unordered, unorderedStats);
        const boards = from.map(j => unordered[j]);
        const stats = from.map(j => unorderedStats[j]);
        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
            const objectBoard = core.toObjectBoard(boards[mIdx]);
            // Totals and per-piece stats as the rest of the app computes them
            const full = calculateBoardStats(objectBoard, itemList, inventoryById, internalById);
            let code: string;
            if (spare || from[mIdx] !== mIdx) {
                code = codeFor(mIdx, objectBoard);
                codeIsStale[mIdx] = true;
            } else {
                if (codeIsStale[mIdx]) { currentCodes[mIdx] = codeFor(mIdx, objectBoard); codeIsStale[mIdx] = false; }
                code = currentCodes[mIdx];
            }
            // ownTotals: this machine's own layout, before the group ordering handed it another one; the coordinator gives things up by
            // these, since the search holds each machine to what its own layout reached
            const own = unorderedStats[mIdx];
            updates.set(machines[mIdx].id, { board: objectBoard, totals: full.totals, pieceStats: full.pieceStats, code, ownTotals: { Performance: own.p, Quality: own.q, Efficiency: own.e } });
        }
        onUpdate(updates, reportTiers((mIdx) => stats[mIdx], (mIdx) => boards[mIdx]));
    };

    // ---- the search
    let stagnationCounter = 0;
    let stagnationRuns = 0;
    let restarts = 0;
    // Checked on the clock (every yield), not only at restarts, which can be far apart on big sets; the clock runs from the last
    // significant improvement (solver/stall.ts), so a search still making real gains is left alone however long it takes
    const stall = createStallClock(now);
    /* Promote (PROMOTE_SHARE): after something was given up, the most important Auto stat short of its top breakpoint (closest to its next on a tie)
     * gets half the rebuilds until it reaches that next breakpoint, each first placing only what raises it (see the fill)
     */
    const promoted: { current: { mIdx: number; s: number; v: number } | null } = { current: null };
    const pickPromote = () => {
        let best: { mIdx: number; s: number; v: number; tier: number; progress: number } | null = null;
        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
            const p = params[mIdx];
            if (p.water) continue;
            for (let s = 0; s < 3; s++) {
                const steps = stepsOf[mIdx][s];
                if (!steps || !p.maximize[s] || p.ignored[s] || p.target[s] !== null) continue;
                const x = statOf(p, bestStats[mIdx], s);
                const sorted = [...steps].sort((a, b) => a - b);
                const next = sorted.find(v => v > x);
                if (next === undefined) continue;
                const below = [...sorted].reverse().find(v => v <= x) ?? Math.min(0, x);
                const progress = (x - below) / Math.max(1, next - below);
                const tier = tierOfStat[mIdx][s];
                if (!best || tier < best.tier || (tier === best.tier && progress > best.progress)) best = { mIdx, s, v: next, tier, progress };
            }
        }
        return best ? { mIdx: best.mIdx, s: best.s, v: best.v } : null;
    };
    const checkRelax = () => {
        let relaxed = false;
        if (relaxOrders) {
            const orders = relaxOrders();
            for (const order of orders) applyOrder(order);
            relaxed = orders.length > 0;
        } else if (STALL) {
            stall.observe(bestTiers);
            // Easing comes after EASE_STALL of the stall time, relaxing a target after RELAX_STALL (see solver/stall.ts)
            if (stall.due(EASE_STALL)) relaxed = relaxLowestTarget();
        }
        const pr = promoted.current;
        if (pr && statOf(params[pr.mIdx], bestStats[pr.mIdx], pr.s) >= pr.v) promoted.current = null;
        if (relaxed) {
            if (PROMOTE) promoted.current = pickPromote();
            // The record was re-scored against the lowered target; progress is measured from there, and it is reported on the new scale
            pendingUpdate = true;
            stall.reset(bestTiers);
            for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                currentBoards[mIdx].set(bestBoards[mIdx]);
                currentStats[mIdx] = bestStats[mIdx];
            }
            epochTiers.fill(-Infinity);
        }
    };

    const cur = [0, 0, 0];
    const w = [0, 0, 0];

    const beginMove = (boards: number[]) => {
        rebuiltMachines.length = 0;
        for (let mIdx = 0; mIdx < machineCount; mIdx++) isRebuilt[mIdx] = false;
        for (const mIdx of boards) {
            rebuiltMachines.push(mIdx);
            isRebuilt[mIdx] = true;
            testBoards[mIdx].set(currentBoards[mIdx]);
        }
    };

    /* Same-shape swap: a module on one board trades places with a module of the same shape on another board or off the boards entirely
     * Same shape means the same cells fit it, so nothing is re-packed: it is the cheap move for "which machine gets this module",
     * which a rebuild only finds when it happens to lift and redraw the right pieces
     */
    const swapPieces: number[] = [];
    const swapOwners: number[] = [];
    const trySwap = () => {
        swapPieces.length = 0;
        swapOwners.length = 0;
        const g = ++itemGen;
        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
            const b = currentBoards[mIdx];
            for (let c = 0; c < CELLS; c++) {
                const a = b[c];
                if (a < 0 || itemStamp[a] === g) continue;
                itemStamp[a] = g;
                if (fixed[a] || core.white[a]) continue;
                swapPieces.push(a);
                swapOwners.push(mIdx);
            }
        }
        if (swapPieces.length === 0) return false;
        const k = Math.floor(Math.random() * swapPieces.length);
        const a = swapPieces[k], owner = swapOwners[k];
        const shape = core.shape[a];
        // Partners: same shape, on another board, or in the pool and on no board
        let partner = -1, partnerOwner = -1, seen = 0;
        for (let i = 0; i < swapPieces.length; i++) {
            const b = swapPieces[i];
            if (b === a || swapOwners[i] === owner || core.shape[b] !== shape) continue;
            if (Math.random() * ++seen < 1) { partner = b; partnerOwner = swapOwners[i]; }
        }
        for (let i = 0; i < P; i++) {
            const b = searchPool[i];
            if (b === a || itemStamp[b] === g || core.shape[b] !== shape || fixed[b] || core.white[b]) continue;
            if (Math.random() * ++seen < 1) { partner = b; partnerOwner = -1; }
        }
        if (partner === -1) return false;
        beginMove(partnerOwner === -1 ? [owner] : [owner, partnerOwner]);
        const ta = testBoards[owner];
        for (let c = 0; c < CELLS; c++) if (ta[c] === a) ta[c] = partner;
        if (partnerOwner !== -1) {
            const tb = testBoards[partnerOwner];
            for (let c = 0; c < CELLS; c++) if (tb[c] === partner) tb[c] = a;
        }
        return true;
    };

    /* Re-layout: one board's own modules lifted and put back one by one in a new random order, each at its best cell
     * The same set in a different arrangement; a module that no longer fits is left out and goes back to the pool
     */
    const relayoutPieces: number[] = [];
    const tryRelayout = () => {
        const k = Math.floor(Math.random() * machineCount);
        beginMove([k]);
        const board = testBoards[k];
        relayoutPieces.length = 0;
        const g = ++itemGen;
        for (let c = 0; c < CELLS; c++) {
            const a = board[c];
            if (a < 0 || fixed[a]) continue;
            if (itemStamp[a] !== g) { itemStamp[a] = g; relayoutPieces.push(a); }
            board[c] = EMPTY;
        }
        if (relayoutPieces.length < 2) return false;
        shuffle(relayoutPieces);
        rebuildFreeCells(board);
        let boardIsEmpty = freeCells.length === openCellCount[k];
        const t = core.boardTotals(board);
        cur[0] = t.p; cur[1] = t.q; cur[2] = t.e;
        w[0] = baseWeights[k][0]; w[1] = baseWeights[k][1]; w[2] = baseWeights[k][2];
        for (const it of relayoutPieces) {
            if (placeBestFit(it, board, boardIsEmpty, w, cur, params[k])) {
                boardIsEmpty = false;
                cur[0] += committed[0]; cur[1] += committed[1]; cur[2] += committed[2];
            }
        }
        return true;
    };

    /* Near-target polish: when the record misses a target by a little, the last points usually need one exact exchange (this module
     * for that one, one out and two in) that random rebuilds rarely hit. So once per new record, each target missed by at most
     * POLISH_NEAR of its size gets a systematic look on its own board:
     *   every spare module (and every module on another board) in every free spot, after taking off nothing or any one module,
     *   plus the best second module after the best first one
     * Placements are ranked on the missing stat by the fast placement estimate; the best POLISH_TOP are scored in full, and the best
     * that beats the record is kept. A stepped target's move must reach the step: getting closer to a step it still misses changes nothing
     * in the game, and taking modules for that cost the targets below it. Repeats while it finds something, within POLISH_BUDGET_MS a record
     */
    const POLISH_NEAR = 0.25;
    const POLISH_TOP = 24;
    const POLISH_BUDGET_MS = 60;
    const polishOwner = new Int16Array(N);
    const polishMark = new Float64Array(TIER_LENGTH).fill(NaN);
    const polishTiers = new Float64Array(TIER_LENGTH);
    const polishBestTiers = new Float64Array(TIER_LENGTH);
    const polishBoard = new Int16Array(CELLS);
    const polishOther = new Int16Array(CELLS);
    // Interchangeable modules (same shape, colour, name and effects) share a class; one of each class per owner is enough to try
    const classOf = new Int32Array(N);
    {
        const classes = new Map<string, number>();
        for (let it = 0; it < N; it++) {
            const item = core.items[it];
            const key = `${item.shape}|${item.color}|${item.displayName}|${item.effects.join(',')}|${item.effectValues.join(',')}`;
            let c = classes.get(key);
            if (c === undefined) { c = classes.size; classes.set(key, c); }
            classOf[it] = c;
        }
    }
    type PolishMove = { a: number; it: number; x: number; y: number; o: Orientation; it2: number; x2: number; y2: number; o2: Orientation | null; gain: number };
    const polishMoves: PolishMove[] = [];
    const keepMove = (m: PolishMove) => {
        if (polishMoves.length >= POLISH_TOP && m.gain <= polishMoves[polishMoves.length - 1].gain) return;
        let i = polishMoves.length;
        while (i > 0 && polishMoves[i - 1].gain < m.gain) i--;
        polishMoves.splice(i, 0, m);
        if (polishMoves.length > POLISH_TOP) polishMoves.pop();
    };
    const lift = (board: Board, it: number) => { for (let c = 0; c < CELLS; c++) if (board[c] === it) board[c] = EMPTY; };
    // The best placement of any candidate on `board` for stat `s` of machine `k`; `skip` is left out. Returns the stat gain, or -Infinity
    const bestAdd = (k: number, s: number, board: Board, reps: number[], skip: number, out: PolishMove, second: boolean) => {
        let empty = true;
        for (let c = 0; c < CELLS; c++) if (board[c] >= 0) { empty = false; break; }
        let best = -Infinity;
        const sumPQ = s === 0 && params[k].sumPQ;
        for (const it of reps) {
            if (it === skip) continue;
            const orientations = core.orientations[it];
            if (!orientations) continue;
            for (let c = 0; c < CELLS; c++) {
                if (board[c] !== EMPTY) continue;
                const x = c % 7, y = (c - x) / 7;
                for (const o of orientations) {
                    const r = core.evalPlacement(it, x, y, o, board, empty, 0, 0, 0, 0, 0, 0, params[k], true);
                    if (r <= -9000) continue;
                    const g = sumPQ ? core.delta[0] + core.delta[1] : core.delta[s];
                    if (g <= best) continue;
                    best = g;
                    if (second) { out.it2 = it; out.x2 = x; out.y2 = y; out.o2 = o; } else { out.it = it; out.x = x; out.y = y; out.o = o; }
                }
            }
        }
        return best;
    };
    // Every placement worth a full look for one removal (`a`, or -1 for none) goes to polishMoves
    const scanAdds = (k: number, s: number, board: Board, reps: number[], a: number, baseValue: number, valueNow: number) => {
        let empty = true;
        for (let c = 0; c < CELLS; c++) if (board[c] >= 0) { empty = false; break; }
        const sumPQ = s === 0 && params[k].sumPQ;
        for (const it of reps) {
            const orientations = core.orientations[it];
            if (!orientations) continue;
            for (let c = 0; c < CELLS; c++) {
                if (board[c] !== EMPTY) continue;
                const x = c % 7, y = (c - x) / 7;
                for (const o of orientations) {
                    const r = core.evalPlacement(it, x, y, o, board, empty, 0, 0, 0, 0, 0, 0, params[k], true);
                    if (r <= -9000) continue;
                    const gain = baseValue + (sumPQ ? core.delta[0] + core.delta[1] : core.delta[s]) - valueNow;
                    if (gain <= 0) continue;
                    keepMove({ a, it, x, y, o, it2: -1, x2: 0, y2: 0, o2: null, gain });
                }
            }
        }
    };
    const valueOf = (k: number, s: number, t: Totals) => statOf(params[k], t, s);
    const polishTarget = (k: number, s: number, deadline: number) => {
        polishOwner.fill(-1);
        for (let m = 0; m < machineCount; m++) for (let c = 0; c < CELLS; c++) { const a = bestBoards[m][c]; if (a >= 0) polishOwner[a] = m; }
        const reps: number[] = [];
        const seen = new Set<number>();
        for (const it of searchPool) {
            if (fixed[it] || polishOwner[it] === k) continue;
            const key = classOf[it] * (machineCount + 1) + polishOwner[it] + 1;
            if (seen.has(key)) continue;
            seen.add(key);
            reps.push(it);
        }
        const pieces: number[] = [-1];
        const g = ++itemGen;
        for (let c = 0; c < CELLS; c++) {
            const a = bestBoards[k][c];
            if (a < 0 || fixed[a] || itemStamp[a] === g) continue;
            itemStamp[a] = g;
            pieces.push(a);
        }
        const valueNow = valueOf(k, s, bestStats[k]);
        const mustReach = stepsOf[k][s] ? params[k].target[s] : null;
        polishMoves.length = 0;
        const two: PolishMove = { a: -1, it: -1, x: 0, y: 0, o: null as any, it2: -1, x2: 0, y2: 0, o2: null, gain: 0 };
        for (const a of pieces) {
            if (now() > deadline) return false;
            polishBoard.set(bestBoards[k]);
            if (a >= 0) lift(polishBoard, a);
            const baseValue = a >= 0 ? valueOf(k, s, core.boardTotals(polishBoard)) : valueNow;
            scanAdds(k, s, polishBoard, reps, a, baseValue, valueNow);
            // One out, two in: the best first module, then the best second next to it
            const g1 = bestAdd(k, s, polishBoard, reps, -1, two, false);
            if (g1 === -Infinity) continue;
            put(polishBoard, two.x, two.y, two.o, two.it);
            const g2 = bestAdd(k, s, polishBoard, reps, two.it, two, true);
            if (g2 !== -Infinity && baseValue + g1 + g2 > valueNow) keepMove({ ...two, a, gain: baseValue + g1 + g2 - valueNow });
        }
        // Full scores for the shortlist
        polishBestTiers.set(bestTiers);
        let pick: PolishMove | null = null;
        for (const mv of polishMoves) {
            polishBoard.set(bestBoards[k]);
            if (mv.a >= 0) lift(polishBoard, mv.a);
            const owners: number[] = [];
            for (const [it, x, y, o] of [[mv.it, mv.x, mv.y, mv.o], [mv.it2, mv.x2, mv.y2, mv.o2]] as [number, number, number, Orientation | null][]) {
                if (it < 0 || !o) continue;
                if (!fits(polishBoard, x, y, o)) { owners.length = 0; owners.push(-2); break; }
                put(polishBoard, x, y, o, it);
                if (polishOwner[it] >= 0) owners.push(polishOwner[it]);
            }
            if (owners[0] === -2) continue;
            // A module taken off another board leaves that board; two from the same board are not tried
            if (owners.length > 1 && owners[0] === owners[1]) continue;
            const otherStats = new Map<number, Scored>();
            const otherBoards = new Map<number, Board>();
            for (const j of owners) {
                const b = bestBoards[j].slice();
                if (mv.it >= 0 && polishOwner[mv.it] === j) lift(b, mv.it);
                if (mv.it2 >= 0 && polishOwner[mv.it2] === j) lift(b, mv.it2);
                otherBoards.set(j, b);
                otherStats.set(j, score(b));
            }
            const mine = score(polishBoard);
            // A stepped target only counts once reached: points towards a step it still misses do nothing in the game
            if (mustReach !== null && valueOf(k, s, mine) < mustReach) continue;
            scoreInto(polishTiers, (m) => m === k ? mine : otherStats.get(m) ?? bestStats[m], (m) => m === k ? polishBoard : otherBoards.get(m) ?? bestBoards[m]);
            if (compareTiers(polishTiers, polishBestTiers) > 0) {
                polishBestTiers.set(polishTiers);
                pick = mv;
                polishOther.set(polishBoard);
                (pick as any).boards = otherBoards;
            }
        }
        if (pick === null) return false;
        bestBoards[k].set(polishOther);
        bestStats[k] = score(bestBoards[k]);
        ((pick as any).boards as Map<number, Board>).forEach((b, j) => { bestBoards[j].set(b); bestStats[j] = score(bestBoards[j]); });
        scoreInto(bestTiers, (m) => bestStats[m], (m) => bestBoards[m]);
        // The search carries on from where it is (sending it back to the record measured worse); it meets the record at its next restart
        codeIsStale.fill(true);
        pendingUpdate = true;
        return true;
    };
    const polishNearTargets = () => {
        if (!POLISH || compareTiers(bestTiers, polishMark) === 0) return;
        const deadline = now() + POLISH_BUDGET_MS;
        let improved = true;
        while (improved) {
            improved = false;
            for (let k = 0; k < machineCount && !improved; k++) {
                for (let s = 0; s < 3 && !improved; s++) {
                    const target = params[k].target[s];
                    if (params[k].ignored[s] || target === null) continue;
                    const v = valueOf(k, s, bestStats[k]);
                    if (v >= target || target - v > POLISH_NEAR * Math.max(Math.abs(target), 100)) continue;
                    if (polishTarget(k, s, deadline)) improved = true;
                    // Out of time: this record is left as it is, not tried again every frame
                    else if (now() > deadline) { polishMark.set(bestTiers); return; }
                }
            }
        }
        polishMark.set(bestTiers);
    };

    const { portYield, timerYield, dispose } = createYielder();
    let lastYield = now();
    let lastTimerYield = lastYield;

    try {
        while (isSolvingRef.current) {
            const isStagnant = stagnationCounter >= STAGNATION;

            const special = !isStagnant && (
                (SWAP_EVERY > 0 && Math.random() * SWAP_EVERY < 1 && trySwap()) ||
                (RELAYOUT_EVERY > 0 && Math.random() * RELAYOUT_EVERY < 1 && tryRelayout())
            );
            if (!special) {
            // One random board per iteration; a stagnant set rebuilds every board at once, the only step that can make a coordinated swap
            const rebuildAll = isStagnant && machineCount > 1;
            const targetMIdx = promoted.current && Math.random() < PROMOTE ? promoted.current.mIdx : Math.floor(Math.random() * machineCount);
            rebuiltMachines.length = 0;
            if (rebuildAll) {
                for (let mIdx = 0; mIdx < machineCount; mIdx++) rebuiltMachines.push(mIdx);
                shuffle(rebuiltMachines);
            } else {
                rebuiltMachines.push(targetMIdx);
            }
            for (let mIdx = 0; mIdx < machineCount; mIdx++) isRebuilt[mIdx] = false;
            for (const mIdx of rebuiltMachines) {
                isRebuilt[mIdx] = true;
                testBoards[mIdx].set(currentBoards[mIdx]);
            }

            // Ruin: a few pieces off each rebuilt board (half to nine tenths when stagnant); specials stay for the fill to move. Everything left is marked placed
            markGen++;
            for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                const board = isRebuilt[mIdx] ? testBoards[mIdx] : currentBoards[mIdx];
                if (isRebuilt[mIdx]) {
                    pieces.length = 0;
                    const specials = specialsOnBoard[mIdx];
                    specials.length = 0;
                    const g = ++itemGen;
                    for (let c = 0; c < CELLS; c++) {
                        const a = board[c];
                        if (a < 0) continue;
                        if (fixed[a]) {
                            let entry = specials.find(e => e.item === a);
                            if (entry === undefined) { entry = { item: a, cells: [] }; specials.push(entry); }
                            entry.cells.push(c);
                            continue;
                        }
                        if (itemStamp[a] !== g) { itemStamp[a] = g; pieces.push(a); }
                    }
                    if (pieces.length > 0) {
                        const removeCount = isStagnant
                            ? Math.max(1, Math.floor(pieces.length * (0.5 + Math.random() * 0.4)))
                            : Math.floor(Math.random() * Math.min(RUIN_MAX, pieces.length)) + 1;
                        shuffle(pieces);
                        for (let i = 0; i < removeCount; i++) removed[pieces[i]] = 1;
                        for (let c = 0; c < CELLS; c++) {
                            const a = board[c];
                            if (a < 0) continue;
                            if (removed[a]) board[c] = EMPTY;
                            else if (poolOf[a] >= 0) placedMark[poolOf[a]] = markGen;
                        }
                        for (let i = 0; i < removeCount; i++) removed[pieces[i]] = 0;
                    } else {
                        for (let c = 0; c < CELLS; c++) { const a = board[c]; if (a >= 0 && poolOf[a] >= 0) placedMark[poolOf[a]] = markGen; }
                    }
                } else {
                    for (let c = 0; c < CELLS; c++) { const a = board[c]; if (a >= 0 && poolOf[a] >= 0) placedMark[poolOf[a]] = markGen; }
                }
            }

            // Steal: one module off another board is made drawable for this fill
            let offered = -1;
            let offeredOwner = -1;
            if (machineCount > 1 && !isStagnant && Math.random() * STEAL_ONE_IN < 1) {
                stealItems.length = 0;
                stealOwners.length = 0;
                for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                    if (mIdx === targetMIdx) continue;
                    const g = ++itemGen;
                    const b = currentBoards[mIdx];
                    for (let c = 0; c < CELLS; c++) {
                        const a = b[c];
                        if (a < 0 || poolOf[a] < 0 || itemStamp[a] === g) continue;
                        itemStamp[a] = g;
                        stealItems.push(poolOf[a]);
                        stealOwners.push(mIdx);
                    }
                }
                if (stealItems.length > 0) {
                    const k = Math.floor(Math.random() * stealItems.length);
                    offered = stealItems[k];
                    offeredOwner = stealOwners[k];
                    placedMark[offered] = 0;
                }
            }

            consumedGen++;

            for (const fillMIdx of rebuiltMachines) {
                const p = params[fillMIdx];
                w[0] = baseWeights[fillMIdx][0]; w[1] = baseWeights[fillMIdx][1]; w[2] = baseWeights[fillMIdx][2];
                // A maximized stat behind the average of its rank's machines gets pushed harder
                if (machineCount > 1) {
                    for (let s = 0; s < 3; s++) {
                        if (p.ignored[s] || !p.maximize[s] || p.target[s] !== null) continue;
                        const ti = tierOfStat[fillMIdx][s];
                        let sum = 0, cnt = 0;
                        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                            if (tierOfStat[mIdx][s] !== ti) continue;
                            sum += statOf(params[mIdx], currentStats[mIdx], s);
                            cnt++;
                        }
                        if (cnt > 1 && statOf(p, currentStats[fillMIdx], s) < sum / cnt) w[s] *= 2;
                    }
                }

                const board = testBoards[fillMIdx];
                // A water farm aims at its next grade now and then (see WATER_AIM_SHARE): its unlocked volume modules make room for Quality
                if (p.water && Math.random() < WATER_AIM) {
                    const q = currentStats[fillMIdx].q;
                    const next = WATER_GRADE_QUALITY.find(g => g > q && (p.target[1] === null || g <= p.target[1]));
                    if (next !== undefined) {
                        p.aimQ = next;
                        for (let c = 0; c < CELLS; c++) {
                            const a = board[c];
                            if (a < 0 || fixed[a] || core.white[a] || core.IP[a] <= core.IQ[a]) continue;
                            board[c] = EMPTY;
                            if (poolOf[a] >= 0) placedMark[poolOf[a]] = 0;
                        }
                    }
                }
                const raises = (it: number, s: number) => s === 0 && p.sumPQ ? core.IP[it] + core.IQ[it] : s === 2 && p.sumPE ? core.IE[it] + core.IP[it] : s === 0 ? core.IP[it] : s === 1 ? core.IQ[it] : core.IE[it];
                const promote = promoted.current;
                if (promote && fillMIdx === promote.mIdx && !p.water && statOf(p, currentStats[fillMIdx], promote.s) < promote.v) {
                    p.aimS = promote.s; p.aimV = promote.v;
                    // Room for it: the board's unlocked modules that do not raise that stat come off
                    for (let c = 0; c < CELLS; c++) {
                        const a = board[c];
                        if (a < 0 || fixed[a] || core.white[a] || raises(a, promote.s) > 0) continue;
                        board[c] = EMPTY;
                        if (poolOf[a] >= 0) placedMark[poolOf[a]] = 0;
                    }
                }
                rebuildFreeCells(board);
                let boardIsEmpty = freeCells.length === openCellCount[fillMIdx];
                let t = core.boardTotals(board);
                cur[0] = t.p; cur[1] = t.q; cur[2] = t.e;

                // Specials first: all together now and then (see REPACK_ONE_IN), otherwise each offered a better cell with the others standing still
                const specials = specialsOnBoard[fillMIdx];
                const repacked = specials.length > 0 && (isStagnant || Math.random() * REPACK_EVERY < 1) && repackSpecials(board, specials);
                if (repacked) {
                    boardIsEmpty = false;
                    t = core.boardTotals(board);
                    cur[0] = t.p; cur[1] = t.q; cur[2] = t.e;
                } else {
                    for (const sp of specials) {
                        const orientations = core.orientations[sp.item];
                        if (!orientations) continue;
                        // The cells, in row-major order, say which orientation it stands in (orientations are anchored on their first cell)
                        const anchor = sp.cells[0];
                        const hx = anchor % 7, hy = (anchor - hx) / 7;
                        let home: Orientation | null = null;
                        for (const o of orientations) {
                            if (o.count !== sp.cells.length) continue;
                            let ok = true;
                            for (let i = 0; i < o.count; i++) if (sp.cells[i] !== anchor + o.ys[i] * 7 + o.xs[i]) { ok = false; break; }
                            if (ok) { home = o; break; }
                        }
                        for (const c of sp.cells) { board[c] = EMPTY; freeCells.push(c); }
                        placeBestFit(sp.item, board, boardIsEmpty, w, cur, p, home === null ? null : { x: hx, y: hy, o: home });
                        boardIsEmpty = false;
                        t = core.boardTotals(board);
                        cur[0] = t.p; cur[1] = t.q; cur[2] = t.e;
                    }
                }

                // Which targets the accepted board already meets picks the draw table
                const targeted = targetedStats[fillMIdx];
                let metMask = 0;
                for (let i = 0; i < targeted.length; i++) {
                    const target = p.target[targeted[i]];
                    if (target === null || statOf(p, currentStats[fillMIdx], targeted[i]) >= target) metMask |= 1 << i;
                }
                const values = drawValues[fillMIdx][metMask];

                infeasible.clear();
                for (const shape of poolShapes) if (!shapeFitsAnywhere(shape, board)) infeasible.add(shape);
                // Aiming at a grade: a first pass places only modules that add Quality, until the grade is reached
                for (let pass = p.aimQ !== undefined || p.aimS !== undefined ? 0 : 1; pass < 2; pass++) {
                let drawn = 0;
                while (drawn < P && drawn < MAX_DRAWS && infeasible.size < poolShapeCount) {
                    // Best of DRAW_TOURNAMENT random candidates; the losers stay in the undrawn region of the permutation
                    const remaining = P - drawn;
                    let swapAt = drawn + Math.floor(Math.random() * remaining);
                    for (let k = 1; k < TOURNAMENT && k < remaining; k++) {
                        const alt = drawn + Math.floor(Math.random() * remaining);
                        if (values[poolOrder[alt]] > values[poolOrder[swapAt]]) swapAt = alt;
                    }
                    const pi = poolOrder[swapAt];
                    poolOrder[swapAt] = poolOrder[drawn];
                    poolOrder[drawn] = pi;
                    drawn++;

                    if (placedMark[pi] === markGen || consumedMark[pi] === consumedGen) continue;
                    const it = searchPool[pi];
                    if (pass === 0 && p.aimQ !== undefined && (core.IQ[it] <= 0 || cur[1] >= p.aimQ)) continue;
                    if (pass === 0 && p.aimS !== undefined) {
                        const s = p.aimS;
                        const cv = s === 0 && p.sumPQ ? cur[0] + cur[1] : s === 2 && p.sumPE ? cur[2] + cur[0] : cur[s];
                        if (raises(it, s) <= 0 || cv >= p.aimV!) continue;
                    }
                    const shape = core.shape[it];
                    if (infeasible.has(shape)) continue;
                    if (freeCells.length < core.size[it]) { infeasible.add(shape); continue; }
                    if (!core.orientations[it]) continue;

                    if (placeBestFit(it, board, boardIsEmpty, w, cur, p)) {
                        boardIsEmpty = false;
                        consumedMark[pi] = consumedGen;
                        // Only steers the rest of this fill; the rebuilt board is scored exactly afterwards
                        cur[0] += committed[0]; cur[1] += committed[1]; cur[2] += committed[2];
                    } else {
                        infeasible.add(shape);
                    }
                }
                }
            }
            for (const mIdx of rebuiltMachines) { delete params[mIdx].aimQ; delete params[mIdx].aimS; delete params[mIdx].aimV; }

            // The fill took the offered module: lift it off its owner, which is then judged along with the rebuilt board
            if (offered !== -1 && consumedMark[offered] === consumedGen) {
                const stolen = searchPool[offered];
                const src = currentBoards[offeredOwner];
                const dst = testBoards[offeredOwner];
                for (let c = 0; c < CELLS; c++) dst[c] = src[c] === stolen ? EMPTY : src[c];
                isRebuilt[offeredOwner] = true;
                rebuiltMachines.push(offeredOwner);
            }
            }

            for (const mIdx of rebuiltMachines) rebuiltStats[mIdx] = score(testBoards[mIdx]);
            const statsFor = (mIdx: number) => isRebuilt[mIdx] ? rebuiltStats[mIdx] : currentStats[mIdx];
            const boardsFor = (mIdx: number) => isRebuilt[mIdx] ? testBoards[mIdx] : currentBoards[mIdx];
            scoreInto(currentTiers, statsFor, boardsFor, params, true);

            if (!isSolvingRef.current) break;

            // Judged against the best of this attempt, so a restart can climb from a deliberately worse board
            const ordering = compareTiers(currentTiers, epochTiers);
            const improved = ordering > 0;
            const accept = improved || (ordering === 0 && Math.random() > 0.5);
            if (accept) {
                if (improved) epochTiers.set(currentTiers);
                for (const mIdx of rebuiltMachines) {
                    currentBoards[mIdx].set(testBoards[mIdx]);
                    currentStats[mIdx] = rebuiltStats[mIdx];
                }
                if (improved) {
                    stagnationCounter = 0;
                    // The record moves only when the real score does (see scoreInto)
                    scoreInto(recordTiers, statsFor, boardsFor);
                    if (compareTiers(recordTiers, bestTiers) > 0) {
                        bestTiers.set(recordTiers);
                        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                            bestBoards[mIdx].set(currentBoards[mIdx]);
                            bestStats[mIdx] = currentStats[mIdx];
                        }
                        // Every code lists the modules the other machines are not using, so all of them go stale
                        codeIsStale.fill(true);
                        pendingUpdate = true;
                    }
                } else {
                    stagnationCounter++;
                }
            } else {
                stagnationCounter++;
            }

            if (isStagnant) {
                stagnationCounter = 0;
                // Hand strong modules held by target-only machines back to the pool while the search can still use them
                if (downgradeTargetMachines(currentBoards)) {
                    for (let mIdx = 0; mIdx < machineCount; mIdx++) currentStats[mIdx] = score(currentBoards[mIdx]);
                }
                if (++stagnationRuns >= RESTART_AFTER_STAGNATIONS) {
                    stagnationRuns = 0;
                    epochTiers.fill(-Infinity);
                    for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                        currentBoards[mIdx].set(bestBoards[mIdx]);
                        currentStats[mIdx] = bestStats[mIdx];
                    }
                    // Now and then one board goes back to its initial state, minus what the others have taken since
                    if (++restarts % FRESH_START_EVERY === 0) {
                        const k = Math.floor(Math.random() * machineCount);
                        const g = ++itemGen;
                        for (let mIdx = 0; mIdx < machineCount; mIdx++) {
                            if (mIdx === k) continue;
                            for (let c = 0; c < CELLS; c++) if (currentBoards[mIdx][c] >= 0) itemStamp[currentBoards[mIdx][c]] = g;
                        }
                        const b = currentBoards[k];
                        for (let c = 0; c < CELLS; c++) {
                            const a = initialBoards[k][c];
                            b[c] = a >= 0 && itemStamp[a] === g ? EMPTY : a;
                        }
                        currentStats[k] = score(b);
                    }
                }
            }

            if (now() - lastYield >= FRAME_BUDGET_MS) {
                checkRelax();
                polishNearTargets();
                flushUpdate();
                if (now() - lastTimerYield >= TIMER_YIELD_INTERVAL_MS) {
                    await timerYield();
                    lastTimerYield = now();
                } else {
                    await portYield();
                }
                lastYield = now();
            }
        }
    } finally {
        // Final clean-up of the reported layout: target-only machines give up any module a weaker one can replace
        if (relaxOrders) checkRelax();
        if (downgradeTargetMachines(bestBoards)) {
            for (let mIdx = 0; mIdx < machineCount; mIdx++) bestStats[mIdx] = score(bestBoards[mIdx]);
            codeIsStale.fill(true);
            pendingUpdate = true;
        }
        flushUpdate();
        dispose();
    }
};
