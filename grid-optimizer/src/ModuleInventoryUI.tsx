import React, { useState, useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { encodeModExport, boardModules } from './modExport';
import { rememberSaveSettings, restoreSaveSettings } from './saveSettings';
import { defaultIgnoreStats, statUnit, defaultMaximizeStats, defaultTargetStats, desequencerDayOptions, desequencerChipsetKey, desequencerAutoDaysKey, statBreakpoints, isDesequencer, isMirage, isMoistureFarm, MOISTURE_FARM_CAP, isAgeWell, worthlessBelowSteps, desequencerSpeed, desequencerCutoffs, statHasNoEffect, hiddenStat, statEffect, cheapEnergyAt, moistureFarmOutput, WATER_GRADES, MIRAGE_BASE_POINTS, STORE_BASE_ATTRACTIVENESS_KEY } from './machineDefaults';
import { StatGoals } from './components/StatGoals';
import { readSolver, runSelectedSolver, SOLVERS, writeSolver, type SolverKind } from './solvers';
import { StatPriorities } from './components/StatPriorities';
import type { Stats, GridTier, InventoryItem, ItemEffect, ModuleColor, Point } from './types';
import { COLOR_MAP } from './constants';
import { formatStatValue, getStatColor, PRECOMPUTED_OFFSETS } from './utils';
import { createPortal } from 'react-dom';
import { useOptimizer, calculateBoardStats, indexInventoryById, generateCodeFromState, isSpecialModule } from './hooks/useOptimizer';
import AddModuleMenu from './components/AddModuleMenu';

// Kept on its machine by the solver and by dragging once right-clicked (isLocked). The specials (Alarm Transmitter, Furnace Blast and
// Junk Processing) start locked, and can be unlocked the same way
const lockedToMachine = (item: InventoryItem) => Boolean(item.isLocked);

// Padlock, black and plain: a rounded body under a shackle, with a small round keyhole the module shows through
const LockIcon = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
        <path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="#000" strokeWidth="3" />
        <path fillRule="evenodd" fill="#000" d="M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z M12 14.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6Z" />
    </svg>
);

/* Where a module's lock goes, whatever way the piece is turned:
 *   T             its centre block (the one touching three others)
 *   P             the middle of its 2x2 square
 *   C, L of 4     the block in the middle of a straight run of three (the C's 3rd block, the L's 2nd block on its long side)
 *   L of 3        its corner block
 *   anything else (square, line, node) its exact middle, between blocks if need be
 * Returns the block the icon is drawn in and its offset from that block's centre, in blocks
 */
const lockSpot = (cells: Point[]) => {
    const has = (x: number, y: number) => cells.some(c => c.x === x && c.y === y);
    const at = (cell: Point, dx = 0, dy = 0) => ({ cell, dx, dy });
    const nb = (c: Point) => ({ l: has(c.x - 1, c.y), r: has(c.x + 1, c.y), u: has(c.x, c.y - 1), d: has(c.x, c.y + 1) });
    const count = (c: Point) => { const n = nb(c); return +n.l + +n.r + +n.u + +n.d; };
    const straight = (c: Point) => { const n = nb(c); return count(c) === 2 && ((n.l && n.r) || (n.u && n.d)); };
    if (cells.length === 5) {
        const corner = cells.find(c => has(c.x + 1, c.y) && has(c.x, c.y + 1) && has(c.x + 1, c.y + 1));
        if (corner) return at(corner, 0.5, 0.5);
    }
    const hub = cells.find(c => count(c) >= 3);
    if (hub) return at(hub);
    const runs = cells.filter(straight);
    if (runs.length === 1 && cells.length > 3) return at(runs[0]);
    if (cells.length === 3) { const bend = cells.find(c => count(c) === 2 && !straight(c)); if (bend) return at(bend); }
    const cx = cells.reduce((s, c) => s + c.x + 0.5, 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c.y + 0.5, 0) / cells.length;
    const cell = cells.reduce((b, c) => ((c.x + 0.5 - cx) ** 2 + (c.y + 0.5 - cy) ** 2 < (b.x + 0.5 - cx) ** 2 + (b.y + 0.5 - cy) ** 2 - 1e-6 ? c : b));
    return at(cell, cx - (cell.x + 0.5), cy - (cell.y + 0.5));
};
import MiniShape from './components/MiniShape';
import SaveFileImporter from './components/SaveFileImporter';

// offload mouse tracking to useRef; performance
const DragGhost = ({ dragState, cellSize }: { dragState: any, cellSize: number }) => {
    const ghostRef = useRef<HTMLDivElement>(null);
    const mousePos = useRef({ x: dragState?.initialMouseX || 0, y: dragState?.initialMouseY || 0 });

    useEffect(() => {
        if (!dragState) return;
        const onMove = (e: MouseEvent) => {
            mousePos.current = { x: e.clientX, y: e.clientY };
            if (ghostRef.current) {
                ghostRef.current.style.left = `${e.clientX - (dragState.dragOffsetX * cellSize) - (cellSize / 2)}px`;
                ghostRef.current.style.top = `${e.clientY - (dragState.dragOffsetY * cellSize) - (cellSize / 2)}px`;
            }
        };
        window.addEventListener('mousemove', onMove);
        return () => window.removeEventListener('mousemove', onMove);
    }, [dragState, cellSize]);

    if (!dragState) return null;

    return (
        <div ref={ghostRef} style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 9999,
            left: `${mousePos.current.x - (dragState.dragOffsetX * cellSize) - (cellSize / 2)}px`,
            top: `${mousePos.current.y - (dragState.dragOffsetY * cellSize) - (cellSize / 2)}px`
        }}>
            {dragState.offsets.map((pt: Point, idx: number) => (
                <div key={idx} style={{
                    position: 'absolute',
                    top: pt.y * cellSize,
                    left: pt.x * cellSize,
                    width: `${cellSize}px`,
                    height: `${cellSize}px`,
                    backgroundColor: COLOR_MAP[dragState.item.color as ModuleColor],
                    border: '2px solid rgba(0,0,0,0.5)',
                    boxSizing: 'border-box'
                }} />
            ))}
        </div>
    );
};

// Card header: machine icon on the left, about as tall as the stat % block, controls and name to its right.
const HEADER_TOP = 10;
const HEADER_HEIGHT = 52;
const ICON_SIZE = 46; // 20% under the first version's 58px

// Item art from the game (resources.assets sprites), in public/machines/. Picked by the machine's own name,
// so it works for save-imported paths ("... > Furnace 2") and hand-added cards ("Furnace 1") alike.
const MACHINE_ICONS: [string, string][] = [
    ['desequencer', 'desequencer'],
    ['purifier', 'water_purifier'],
    ['farm', 'moisture_farm'],
    ['alarm', 'alarm_system'],
    ['agewell', 'agewell'],
    ['projector', 'mirage_projector'],
    ['furnace', 'furnace'],
];

const machineIcon = (machineType: string): string | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = MACHINE_ICONS.find(([keyword]) => name.includes(keyword));
    return hit ? `${import.meta.env.BASE_URL}machines/${hit[1]}.png` : null;
};

const MachineInstance = React.memo(forwardRef(({
                                                   machineId,
                                                   inventory,
                                                   setInventory,
                                                   getUsedItems,
                                                   dragState,
                                                   setHoverInfo,
                                                   onDuplicate,
                                                   onDelete,
                                                   cellSize,
                                                   onSolvingChange,
                                                   onDragTargetRefChange,
                                                   isAnySolving,
                                                   isThisMachineSolving,
                                                   canDelete,
                                                   onReorderStart,
                                                   onBoardChange,
                                                   onStopMachine,
                                                   onToggleLock,
                                                   onRunMachine,
                                                   solverKind
                                               }: any, ref) => {
    // Machine state loading handles fallback defaults from localStorage automatically
    const optimizer = useOptimizer(inventory, setInventory, machineId, getUsedItems, 3, isAnySolving);
    // One lock per locked module, in the middle of the piece (see lockSpot): cell index -> offset from that cell's centre
    const lockCells = new Map<number, { dx: number; dy: number }>();
    {
        const pieces = new Map<string, Point[]>();
        optimizer.board.forEach((row: any[], y: number) => row.forEach((c: any, x: number) => {
            if (c && c !== 'Locked' && lockedToMachine(c)) { const list = pieces.get(c.id) ?? []; list.push({ x, y }); pieces.set(c.id, list); }
        }));
        pieces.forEach(cells => { const { cell, dx, dy } = lockSpot(cells); lockCells.set(cell.y * 7 + cell.x, { dx, dy }); });
    }
    const [localHover, setLocalHover] = useState<{x: number, y: number} | null>(null);
    const [showPaths, setShowPaths] = useState(false);
    /* The layout for the mod. Its code lists only the modules on this board: the mod only uses placed pieces, and the card's own code
     * lists every module owned, which the format caps at MAX_ENCODABLE_MODULES (255), so bigger saves had no code and could not export
     */
    const boardModulesList = (board: any[][]) => {
        const list: InventoryItem[] = [];
        const seen = new Set<string>();
        board.forEach(row => row.forEach(c => { if (c && c !== 'Locked' && !seen.has(c.id)) { seen.add(c.id); list.push(c); } }));
        return list;
    };
    const modExportEntry = () => {
        const board = optimizer.boardRef.current;
        const onBoard = boardModulesList(board);
        if (onBoard.length === 0) return null;
        const code = generateCodeFromState(optimizer.tier, optimizer.maximizeStats, optimizer.targetStats, onBoard, board);
        return code ? { name: machineType, code, modules: boardModules(board) } : null;
    };
    const boardHasModules = optimizer.board.some((row: any[]) => row.some(c => c && c !== 'Locked'));
    // Mouse position while over the machine icon, for its tooltip
    const [iconHover, setIconHover] = useState<{ x: number; y: number } | null>(null);

    // Manage local lock state
    const [isMachineLocked, setIsMachineLocked] = useState(() => {
        return localStorage.getItem(`optimizer_machine_locked_${machineId}`) === 'true';
    });

    const currentSolving = optimizer.isSolving || isThisMachineSolving;

    // Automatically load the machine name from save file
    const [machineType, setMachineType] = useState(() => {
        return localStorage.getItem(`optimizer_machine_type_${machineId}`) || 'Select Machine...';
    });

    // Save-imported machines are named by their path in the save ("Inv. > ..."); their name and tier come from
    // the save, so they are shown read-only. Machines added by hand keep the picker and the tier buttons.
    const isImportedMachine = machineType.startsWith('Inv.');
    // What kind of machine this is, for its icon, stats, defaults and breakpoints: the save item's own name, kept apart from the
    // card's name, which may be one the player gave it ("CMD Card" for a Desequencer). Cards added by hand are named by their type
    const [machineKind] = useState<string | null>(() => localStorage.getItem(`optimizer_machine_kind_${machineId}`));
    const typeKey = machineKind ?? machineType;
    const machineIconUrl = machineIcon(typeKey);
    // A Blast module shifts every Furnace breakpoint up by 100%
    const hasBlast = optimizer.board.some(row => row.some(cell => cell && cell !== 'Locked' && cell.displayName.includes('(Blast)')));
    // A Moisture Farm with Volume and Purity both on Auto is scored on the value of its water (see MachineConfig.water)
    // Volume on Auto and Purity on Auto or a Target: scored by the water's value (a Purity target is the lowest grade it may make)
    const waterMode = () => isMoistureFarm(typeKey)
        && !optimizer.ignoreStats.Performance && optimizer.maximizeStats.Performance && optimizer.targetStats.Performance === null
        && !optimizer.ignoreStats.Quality && (optimizer.maximizeStats.Quality || optimizer.targetStats.Quality !== null);
    /* Volume on a Target and Purity on Auto: Purity past Pure counts for nothing (MachineConfig.qualityCap). Counted in full, one farm of a
     * shared priority took Purity far past Pure while the others made Ghost water: 12 farms with the first four at 6000 ml (15 workers,
     * 40 s, 6 runs) 76,360 credits a day, those four Pure, Pure, Ghost, Ghost at worst; capped (with staging) 85,970, never below High-quality
     */
    const qualityCap = () => isMoistureFarm(typeKey)
        && !optimizer.ignoreStats.Performance && optimizer.targetStats.Performance !== null && !optimizer.maximizeStats.Performance
        && !optimizer.ignoreStats.Quality && optimizer.maximizeStats.Quality && optimizer.targetStats.Quality === null
        ? WATER_GRADES[WATER_GRADES.length - 1].from : undefined;
    // The values where each stat changes something on this machine, for the solver (see MachineConfig.targetSteps)
    // Desequencer: with its days on Auto, only the picked chipset's day breakpoints count; otherwise every chipset's
    const desequencerSteps = () => {
        try {
            if (localStorage.getItem(desequencerAutoDaysKey(machineId)) === '1') {
                const work = Number(localStorage.getItem(desequencerChipsetKey(machineId))) || 150;
                return desequencerDayOptions(work).map(o => o.value);
            }
        } catch { /* storage unavailable: every chipset's */ }
        return desequencerCutoffs();
    };
    const targetSteps = () => {
        const steps: Partial<Record<'Performance' | 'Quality' | 'Efficiency', number[]>> = {};
        for (const stat of ['Performance', 'Quality', 'Efficiency'] as const) {
            const list = stat === 'Performance' && isDesequencer(typeKey) ? desequencerSteps()
                // Alarm: the stop chance is 50% + Performance and tops out at 100%, so +50% is its one breakpoint
                : stat === 'Performance' && typeKey.toLowerCase().includes('alarm') ? [50]
                : statBreakpoints(typeKey, stat, hasBlast)?.map(b => b.value);
            if (list && list.length > 0) steps[stat] = [...list].sort((a, b) => a - b);
        }
        return steps;
    };

    // Stats in Limit mode (energy): the target is a ceiling and the stat is still optimized under it. Per machine, kept across reloads
    const limitKey = `optimizer_limit_${machineId}`;
    const [limitStats, setLimitStats] = useState<Record<'Performance' | 'Quality' | 'Efficiency', boolean>>(() => {
        try { return { Performance: false, Quality: false, Efficiency: false, ...JSON.parse(localStorage.getItem(limitKey) || '{}') }; }
        catch { return { Performance: false, Quality: false, Efficiency: false }; }
    });
    useEffect(() => {
        try { localStorage.setItem(limitKey, JSON.stringify(limitStats)); } catch { /* per-viewer convenience only */ }
        rememberSaveSettings();
    }, [limitKey, limitStats]);

    /* Goals per solver: each solver keeps its own Auto / Max / Target / Off choices, targets, Limit and priorities for this card
     * (optimizer_goals_<solver>_<id>, and per save, see saveSettings.ts), so switching solvers brings back what was set for that one.
     * The set in use is written to its solver's key on every change; a solver picked for the first time starts from the current set
     */
    const goalsKey = (kind: string) => `optimizer_goals_${kind}_${machineId}`;
    // null until the card first loads, which takes up the saved set of the solver picked then too (an import puts them back per save)
    const goalSolverRef = useRef<string | null>(null);
    useEffect(() => {
        if (goalSolverRef.current === solverKind) return;
        goalSolverRef.current = solverKind;
        let saved: any = null;
        try { saved = JSON.parse(localStorage.getItem(goalsKey(solverKind)) || 'null'); } catch { /* none */ }
        if (!saved) return;
        if (saved.targetStats) optimizer.setTargetStats(saved.targetStats);
        if (saved.ignoreStats) optimizer.setIgnoreStats(saved.ignoreStats);
        if (saved.statPriority) optimizer.setStatPriority(saved.statPriority);
        if (saved.limit) setLimitStats(saved.limit);
    }, [solverKind]);
    useEffect(() => {
        try {
            localStorage.setItem(goalsKey(goalSolverRef.current ?? solverKind), JSON.stringify({
                targetStats: optimizer.targetStats, ignoreStats: optimizer.ignoreStats, statPriority: optimizer.statPriority, limit: limitStats,
            }));
        } catch { /* per-viewer convenience only */ }
        rememberSaveSettings();
    }, [optimizer.targetStats, optimizer.ignoreStats, optimizer.statPriority, limitStats, solverKind]);

    // A stat that does nothing on this machine has no card, so it must not be left on from an older setup either
    useEffect(() => {
        const stray = (['Performance', 'Quality', 'Efficiency'] as const).filter(k => hiddenStat(typeKey, k) && !optimizer.ignoreStats[k]);
        if (stray.length > 0) optimizer.setIgnoreStats((prev: any) => ({ ...prev, ...Object.fromEntries(stray.map(k => [k, true])) }));
    }, [typeKey, optimizer.ignoreStats]);

    // An enabled stat is maximized unless it has a target, or when its target is a limit it stays under
    // maximizeStats is derived from that, so the optimizer and the solution code see the same settings as before.
    useEffect(() => {
        const next = { Performance: false, Quality: false, Efficiency: false };
        let changed = false;
        for (const key of ['Performance', 'Quality', 'Efficiency'] as const) {
            // A target that is still gone past: energy's At most on this site's solver; any stat with Max and Target both on for Razboy's and
            // hoydoy's (their toggles), so this site's solver keeps the goals its own cards show
            const limit = limitStats[key] && (solverKind !== 'bloom' || Boolean(statUnit(typeKey, key)?.lowerIsBetter));
            next[key] = !optimizer.ignoreStats[key] && (optimizer.targetStats[key] === null || limit);
            if (Boolean(optimizer.maximizeStats[key]) !== next[key]) changed = true;
        }
        if (changed) optimizer.setMaximizeStats(next);
    }, [optimizer.ignoreStats, optimizer.targetStats, optimizer.maximizeStats, limitStats, solverKind, typeKey]);

    useEffect(() => {
        if (machineType !== 'Select Machine...') {
            localStorage.setItem(`optimizer_machine_type_${machineId}`, machineType);
        }
    }, [machineType, machineId]);

    useEffect(() => {
        localStorage.setItem(`optimizer_machine_locked_${machineId}`, String(isMachineLocked));
        rememberSaveSettings();
    }, [isMachineLocked, machineId]);

    const uniqueModules = useMemo(() => {
        if (!showPaths) return [];
        const mods = new Map<string, InventoryItem>();
        optimizer.board.forEach(row => row.forEach(cell => {
            if (cell && cell !== 'Locked') {
                mods.set(cell.id, cell as InventoryItem);
            }
        }));
        return Array.from(mods.values());
    }, [showPaths, optimizer.board]);

    const runSolo = () => optimizer.runOptimization(targetSteps(), isMirage(typeKey), waterMode(), worthlessBelowSteps(typeKey), isAgeWell(typeKey),
        isMoistureFarm(typeKey) ? MOISTURE_FARM_CAP : undefined, cheapEnergyAt(typeKey), qualityCap());
    useImperativeHandle(ref, () => ({
        run: optimizer.runOptimization,
        runSolo,
        stop: optimizer.stopOptimization,
        clear: optimizer.resetBoard,
        place: optimizer.manuallyPlaceItem,
        remove: optimizer.manuallyRemoveItem,
        getState: () => ({
            tier: optimizer.tier,
            maximizeStats: optimizer.maximizeStats,
            targetStats: optimizer.targetStats,
            ignoreStats: optimizer.ignoreStats,
            statPriority: optimizer.statPriority,
            targetSteps: targetSteps(),
            sumPQ: isMirage(typeKey),
            water: waterMode(),
            sumPE: isAgeWell(typeKey),
            performanceCap: isMoistureFarm(typeKey) ? MOISTURE_FARM_CAP : undefined,
            qualityCap: qualityCap(),
            worthlessBelowSteps: worthlessBelowSteps(typeKey),
            cheapEnergyAt: cheapEnergyAt(typeKey),
            machineType,
            machineKind: typeKey
        }),
        isValidPlacement: optimizer.isValidPlacement,
        getBoard: () => optimizer.boardRef.current,
        applyUpdate: optimizer.applyUpdate,
        isLocked: () => isMachineLocked,
        getModExport: () => modExportEntry()
    }), [optimizer, isMachineLocked, machineType, typeKey]);

    useEffect(() => {
        if (dragState && dragState.sourceMachineId === machineId && dragState.initialTarget && localHover === null) {
            setLocalHover({ x: dragState.initialTarget.x, y: dragState.initialTarget.y });
        } else if (!dragState) {
            setLocalHover(null);
        }
    }, [dragState, machineId]);

    useEffect(() => {
        onSolvingChange(machineId, optimizer.isSolving);
    }, [optimizer.isSolving, machineId, onSolvingChange]);

    // Lets the page refresh "Unused Module Storage" whenever this board changes
    useEffect(() => {
        onBoardChange?.();
    }, [optimizer.board, onBoardChange]);

    const getCellStyles = (x: number, y: number, cell: any): React.CSSProperties => {
        if (cell === 'Locked') {
            return { backgroundColor: '#111', border: 'none', boxShadow: 'none' };
        }
        if (!cell) {
            return { backgroundColor: '#2a2a2a', border: 'none', boxShadow: 'inset 0 0 0 1px #333' };
        }

        const isSame = (nx: number, ny: number) => {
            if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) return false;
            const adj = optimizer.board[ny][nx];
            return adj && adj !== 'Locked' && (adj as InventoryItem).id === cell.id;
        };

        const bgColor = COLOR_MAP[cell.color as ModuleColor];
        const shadows: string[] = [];

        if (!isSame(x, y - 1)) shadows.push('inset 0 2px 0 #000');
        if (!isSame(x, y + 1)) shadows.push('inset 0 -2px 0 #000');
        if (!isSame(x - 1, y)) shadows.push('inset 2px 0 0 #000');
        if (!isSame(x + 1, y)) shadows.push('inset -2px 0 0 #000');

        const bgImages: string[] = [];
        const bgPositions: string[] = [];
        const bgSizes: string[] = [];

        if (isSame(x + 1, y) && isSame(x, y + 1) && !isSame(x + 1, y + 1)) {
            bgImages.push('linear-gradient(90deg, #000, #000)');
            bgPositions.push('bottom right');
            bgSizes.push('2px 2px');
        }
        if (isSame(x - 1, y) && isSame(x, y + 1) && !isSame(x - 1, y + 1)) {
            bgImages.push('linear-gradient(90deg, #000, #000)');
            bgPositions.push('bottom left');
            bgSizes.push('2px 2px');
        }
        if (isSame(x + 1, y) && isSame(x, y - 1) && !isSame(x + 1, y - 1)) {
            bgImages.push('linear-gradient(90deg, #000, #000)');
            bgPositions.push('top right');
            bgSizes.push('2px 2px');
        }
        if (isSame(x - 1, y) && isSame(x, y - 1) && !isSame(x - 1, y - 1)) {
            bgImages.push('linear-gradient(90deg, #000, #000)');
            bgPositions.push('top left');
            bgSizes.push('2px 2px');
        }

        return {
            backgroundColor: bgColor,
            border: 'none',
            boxShadow: shadows.join(', ') || 'none',
            backgroundImage: bgImages.length ? bgImages.join(', ') : 'none',
            backgroundPosition: bgPositions.length ? bgPositions.join(', ') : '0 0',
            backgroundSize: bgSizes.length ? bgSizes.join(', ') : 'auto',
            backgroundRepeat: bgImages.length ? 'no-repeat' : 'repeat'
        };
    };

    const getBoardFootprint = (itemId: string) => {
        const cells: Point[] = [];
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 7; x++) {
                const cell = optimizer.board[y][x];
                if (cell && cell !== 'Locked' && cell.id === itemId) cells.push({ x, y });
            }
        }
        if (cells.length === 0) return null;
        const minX = Math.min(...cells.map(p => p.x));
        const minY = Math.min(...cells.map(p => p.y));
        return { minX, minY, offsets: cells.map(p => ({ x: p.x - minX, y: p.y - minY })) };
    };

    const isTargetingThis = dragState && localHover !== null;
    const previewRootX = isTargetingThis ? localHover!.x - dragState.dragOffsetX : null;
    const previewRootY = isTargetingThis ? localHover!.y - dragState.dragOffsetY : null;

    const currentPreviewValid = isTargetingThis && previewRootX !== null && previewRootY !== null
        ? optimizer.isValidPlacement(dragState.item, previewRootX, previewRootY, dragState.offsets)
        : false;

    return (
        <div
            // The whole card background drags the card; the grid and the controls keep their own behaviour
            onPointerDown={(e) => { if (!isAnySolving) onReorderStart(machineId, e); }}
            style={{
                position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
                backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px', padding: `${HEADER_TOP + HEADER_HEIGHT + 10}px 15px 15px 15px`,
                width: 'max-content', boxSizing: 'border-box', cursor: isAnySolving ? 'default' : 'grab'
            }}>

            <div
                style={{ position: 'absolute', top: `${HEADER_TOP}px`, left: '15px', right: '10px', height: `${HEADER_HEIGHT}px`, display: 'flex', gap: '10px', zIndex: 10, alignItems: 'center' }}
            >
                <div
                    onMouseMove={(e) => { if (machineType !== 'Select Machine...') setIconHover({ x: e.clientX, y: e.clientY }); }}
                    onMouseLeave={() => setIconHover(null)}
                    onPointerDown={() => setIconHover(null)}
                    style={{ width: `${HEADER_HEIGHT}px`, height: `${HEADER_HEIGHT}px`, flexShrink: 0, backgroundColor: '#1a1a1a', border: '1px solid #2c2c2e', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}
                >
                    {machineIconUrl && (
                        <img
                            src={machineIconUrl}
                            alt=""
                            draggable={false}
                            style={{ width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px`, objectFit: 'contain', imageRendering: 'pixelated' }}
                        />
                    )}
                </div>
                {/* Same look as the module tooltip; in a portal so a card being dragged (transformed) can't shift it */}
                {iconHover && !dragState && createPortal(
                    <div style={{
                        position: 'fixed', top: iconHover.y + 15, left: iconHover.x + 15,
                        backgroundColor: 'rgba(0, 0, 0, 0.95)', border: '1px solid #4fb3bf', padding: '10px 15px', borderRadius: '6px',
                        zIndex: 1000, pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', minWidth: '150px'
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '2px', color: '#eee' }}>{machineType.split(' > ').pop()}</div>
                        <div style={{ fontSize: '0.75em', color: '#4fb3bf', marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '5px' }}>[Machine]</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9em' }}>
                            {([['Perf', 'Performance'], ['Qual', 'Quality'], ['Effic', 'Efficiency']] as const).map(([label, stat]) => {
                                const effect = statEffect(typeKey, stat);
                                const none = statHasNoEffect(typeKey, stat);
                                return (
                                    <div key={stat} style={{ opacity: none ? 0.5 : 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                                            <span style={{ color: '#aaa' }}>{label}:</span>
                                            <span style={{ color: getStatColor(optimizer.bestTotals[stat]) }}>{formatStatValue(optimizer.bestTotals[stat])}</span>
                                        </div>
                                        {effect && <div style={{ fontSize: '0.8em', color: '#777', maxWidth: '240px', lineHeight: 1.3 }}>{effect}</div>}
                                    </div>
                                );
                            })}
                        </div>
                        {isImportedMachine && (
                            <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #333', fontSize: '0.75em', color: '#888', wordBreak: 'break-word', maxWidth: '250px' }}>
                                <span style={{ color: '#aaa' }}>Path: </span>{machineType}
                            </div>
                        )}
                    </div>,
                    document.body
                )}
                <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '2px 0' , boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
                        <button
                            onClick={() => setShowPaths(!showPaths)}
                            style={{
                                background: showPaths ? '#333' : 'transparent', border: '1px solid #555',
                                borderRadius: '6px', color: '#aaa', cursor: 'pointer', fontSize: '0.75em',
                                padding: '4px 8px', fontWeight: 'bold'
                            }}
                        >
                            {showPaths ? 'Hide Paths' : 'Show Paths'}
                        </button>
                        <button
                            onClick={() => setIsMachineLocked(!isMachineLocked)}
                            disabled={isAnySolving}
                            style={{
                                background: isMachineLocked ? 'rgba(255, 77, 77, 0.1)' : 'transparent',
                                border: `1px solid ${isMachineLocked ? '#ff4d4d' : '#555'}`,
                                borderRadius: '6px', color: isMachineLocked ? '#ff4d4d' : '#aaa',
                                cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.75em',
                                padding: '4px 8px', fontWeight: 'bold'
                            }}
                        >
                            {isMachineLocked ? 'Unlock' : 'Lock'}
                        </button>
                    </div>
                    <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                        {isImportedMachine ? (
                            <span
                                title={machineType}
                                style={{ color: '#eee', fontSize: '0.95em', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', textAlign: 'right' }}
                            >
                                {machineType.split(' > ').pop()}
                            </span>
                        ) : (
                            <select
                                title={machineType !== "Select Machine..." ? machineType : undefined}
                                value={machineType}
                                onChange={(e) => {
                                    const selected = e.target.value;
                                    const allKeys = Object.keys(localStorage).filter(k => k.startsWith('optimizer_machine_type_'));
                                    let max = 0;

                                    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const regex = new RegExp(`(?:^|\\s|>\\s*)${escapeRegex(selected)}\\s+(\\d+)$`);

                                    allKeys.forEach(k => {
                                        if (k === `optimizer_machine_type_${machineId}`) return;
                                        const val = localStorage.getItem(k);
                                        if (val) {
                                            const match = val.match(regex);
                                            if (match) {
                                                const num = parseInt(match[1], 10);
                                                if (num > max) max = num;
                                            }
                                        }
                                    });
                                    setMachineType(`${selected} ${max + 1}`);
                                    optimizer.setIgnoreStats(defaultIgnoreStats(selected));
                                    // Goals are in the old machine's terms, so a new type starts from Max
                                    optimizer.setTargetStats(defaultTargetStats(selected));
                                    setLimitStats({ Performance: false, Quality: false, Efficiency: false });
                                }}
                                disabled={currentSolving}
                                style={{
                                    width: '100%', padding: '3px 6px', backgroundColor: '#222', color: '#eee',
                                    border: '1px solid #333', borderRadius: '6px', fontSize: '0.75em',
                                    outline: 'none', cursor: currentSolving ? 'not-allowed' : 'pointer',
                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden'
                                }}
                            >
                                <option value="Select Machine..." disabled>Select Machine...</option>
                                {machineType !== "Select Machine..." && !["Moisture Farm", "Furnace", "Water Purifier", "Alarm System", "AgeWell", "Cryptographic Desequencer", "Mirage Projector"].includes(machineType) && (
                                    <option value={machineType}>
                                        {machineType.length > 45 ? '...' + machineType.substring(machineType.length - 42) : machineType}
                                    </option>
                                )}
                                <option value="Moisture Farm">Moisture Farm</option>
                                <option value="Furnace">Furnace</option>
                                <option value="Water Purifier">Water Purifier</option>
                                <option value="Alarm System">Alarm System</option>
                                <option value="AgeWell">AgeWell</option>
                                <option value="Cryptographic Desequencer">Cryptographic Desequencer</option>
                                <option value="Mirage Projector">Mirage Projector</option>
                            </select>
                        )}
                    </div>
                </div>
            {canDelete && (
                    <button
                        onClick={() => onDelete(machineId)}
                        disabled={isAnySolving}
                        style={{
                            background: 'none', border: 'none', color: isAnySolving ? '#444' : '#666',
                            cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '1.2em', padding: '0 4px', alignSelf: 'flex-start', lineHeight: 1
                        }}
                        title="Delete Machine"
                    >
                        &times;
                    </button>
                )}
            </div>

            <div style={{ visibility: showPaths ? 'hidden' : 'visible', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                    className="grid-wrapper"
                    onMouseLeave={() => {
                        if (dragState) {
                            setLocalHover(null);
                            onDragTargetRefChange(null);
                        }
                    }}
                    style={{
                        gridTemplateColumns: `repeat(7, ${cellSize}px)`,
                        gridTemplateRows: `repeat(5, ${cellSize}px)`
                    }}
                >
                    {optimizer.board.map((row: any, y: number) =>
                        row.map((cell: any, x: number) => {
                            let isPreviewCell = false;

                            if (isTargetingThis && previewRootX !== null && previewRootY !== null) {
                                for (const pt of dragState.offsets) {
                                    if (previewRootX + pt.x === x && previewRootY + pt.y === y) {
                                        isPreviewCell = true;
                                        break;
                                    }
                                }
                            }

                            const isBeingDragged = dragState && dragState.sourceMachineId === machineId && cell && cell !== 'Locked' && dragState.item.id === cell.id;

                            return (
                                <div
                                    key={`${x}-${y}`}
                                    onMouseMove={(e) => {
                                        if (cell && cell !== 'Locked' && !dragState) {
                                            setHoverInfo({ x: e.clientX, y: e.clientY, cell, stats: optimizer.bestPieceStats.get(cell.id) });
                                        }
                                    }}
                                    onMouseLeave={() => setHoverInfo(null)}
                                    onContextMenu={(e) => {
                                        if (!cell || cell === 'Locked') return;
                                        e.preventDefault();
                                        if (isAnySolving) return;
                                        onToggleLock(cell.id);
                                    }}
                                    onMouseDown={(e) => {
                                        if (e.button !== 0) return;
                                        if (isAnySolving || !cell || cell === 'Locked') return;
                                        e.preventDefault();
                                        const footprint = getBoardFootprint(cell.id);
                                        if (!footprint) return;

                                        setHoverInfo(null);

                                        // prevent cursor being outside the grid when placing module by having the cursor drag modules from the center-most square (center of mass)
                                        const avgX = footprint.offsets.reduce((sum: number, p: Point) => sum + p.x, 0) / footprint.offsets.length;
                                        const avgY = footprint.offsets.reduce((sum: number, p: Point) => sum + p.y, 0) / footprint.offsets.length;

                                        let pivot = footprint.offsets[0];
                                        let minDist = Infinity;
                                        for (const p of footprint.offsets) {
                                            const dist = (p.x - avgX) ** 2 + (p.y - avgY) ** 2;
                                            if (dist < minDist) {
                                                minDist = dist;
                                                pivot = p;
                                            }
                                        }

                                        const dragOffsetX = pivot.x;
                                        const dragOffsetY = pivot.y;

                                        const initialTarget = {
                                            machineId,
                                            x: footprint.minX + dragOffsetX,
                                            y: footprint.minY + dragOffsetY
                                        };

                                        const evt = new CustomEvent('appDragStart', {
                                            detail: {
                                                item: cell,
                                                sourceMachineId: machineId,
                                                offsets: footprint.offsets,
                                                dragOffsetX,
                                                dragOffsetY,
                                                initialMouseX: e.clientX,
                                                initialMouseY: e.clientY,
                                                initialTarget
                                            }
                                        });
                                        window.dispatchEvent(evt);
                                    }}
                                    onMouseEnter={() => {
                                        if (dragState) {
                                            setLocalHover({ x, y });
                                            onDragTargetRefChange({ machineId, x, y });
                                        }
                                    }}
                                    style={{
                                        width: `${cellSize}px`,
                                        height: `${cellSize}px`,
                                        ...getCellStyles(x, y, cell),
                                        opacity: isBeingDragged ? 0.3 : 1,
                                        cursor: cell && cell !== 'Locked' ? (isAnySolving ? 'not-allowed' : 'grab') : 'default',
                                        boxSizing: 'border-box',
                                        position: 'relative'
                                    }}
                                >
                                    {lockCells.has(y * 7 + x) && (() => {
                                        const { dx, dy } = lockCells.get(y * 7 + x)!;
                                        const size = Math.max(14, Math.round(cellSize * 0.62));
                                        return (
                                            <span style={{
                                                position: 'absolute', left: `calc(50% + ${dx * cellSize}px)`, top: `calc(50% + ${dy * cellSize}px)`,
                                                transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 5, opacity: 0.85
                                            }}>
                                                <LockIcon size={size} />
                                            </span>
                                        );
                                    })()}
                                    {isPreviewCell && (
                                        <div style={{
                                            position: 'absolute', inset: 0,
                                            backgroundColor: currentPreviewValid ? 'rgba(20, 80, 20, 0.85)' : 'rgba(80, 20, 20, 0.85)',
                                            border: currentPreviewValid ? '2px solid rgba(100, 255, 100, 0.5)' : '2px solid rgba(255, 100, 100, 0.5)',
                                            zIndex: 10, pointerEvents: 'none'
                                        }} />
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                <div style={{ minHeight: '18px', marginTop: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                    {optimizer.warningMsg && (
                        <span style={{ color: '#ff4d4d', fontSize: '0.75em', textAlign: 'center', width: '100%' }}>
                            ⚠ {optimizer.warningMsg}
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>

                    {!isImportedMachine && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <div style={{ display: 'flex', gap: '5px', backgroundColor: '#222', padding: '5px', borderRadius: '6px' }}>
                            {[1, 2, 3].map((t) => (
                                <button key={t} onClick={() => optimizer.handleTierChange(t as GridTier)} disabled={currentSolving} style={{ padding: '6px 12px', fontSize: '0.85em', backgroundColor: optimizer.tier === t ? '#555' : 'transparent', color: 'white', border: 'none', borderRadius: '4px', cursor: currentSolving ? 'not-allowed' : 'pointer' }}>
                                    Tier {t}
                                </button>
                            ))}
                        </div>
                    </div>
                    )}

                    <StatGoals
                        machineType={typeKey}
                        machineId={machineId}
                        totals={optimizer.bestTotals}
                        ignoreStats={optimizer.ignoreStats}
                        targetStats={optimizer.targetStats}
                        setIgnoreStats={optimizer.setIgnoreStats}
                        setTargetStats={optimizer.setTargetStats}
                        disabled={currentSolving}
                        hasBlast={hasBlast}
                        limitStats={limitStats}
                        setLimitStats={setLimitStats}
                        width={(7 * cellSize + 22) / 0.8}
                        autoLabel={solverKind !== 'bloom' ? 'Max' : 'Auto'}
                        toggles={solverKind !== 'bloom'}
                    />
                    {solverKind !== 'bloom' && (
                        <StatPriorities
                            machineType={typeKey}
                            statPriority={optimizer.statPriority}
                            setStatPriority={optimizer.setStatPriority}
                            ignoreStats={optimizer.ignoreStats}
                            disabled={currentSolving}
                            width={(7 * cellSize + 22) / 0.8}
                        />
                    )}

                    <div style={{ display: 'flex', gap: '5px', width: '100%' }}>
                        <button
                            onClick={() => {
                                if (currentSolving) {
                                    onStopMachine(machineId);
                                } else if (isAnySolving) {
                                    onRunMachine(machineId);
                                } else {
                                    runSolo();
                                }
                            }}
                            disabled={inventory.length === 0 && !currentSolving}
                            style={{
                                flex: 1, padding: '8px', fontSize: '0.85em',
                                backgroundColor: currentSolving ? '#ff4d4d' : '#4caf50',
                                color: 'white', border: `1px solid ${currentSolving ? '#ff4d4d' : '#4caf50'}`, borderRadius: '6px', fontWeight: 'bold',
                                cursor: (inventory.length === 0 && !currentSolving) ? 'not-allowed' : 'pointer',
                                opacity: (inventory.length === 0 && !currentSolving) ? 0.5 : 1
                            }}
                        >
                            {currentSolving ? 'Stop' : 'Run'}
                        </button>
                        <button
                            onClick={optimizer.resetBoard}
                            disabled={isAnySolving}
                            style={{ flex: 1, padding: '8px', fontSize: '0.85em', backgroundColor: '#333', color: 'white', border: '1px solid #555', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer' }}
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => onDuplicate(machineId)}
                            disabled={isAnySolving}
                            style={{ flex: 1, padding: '8px', fontSize: '0.85em', backgroundColor: '#333', color: 'white', border: '1px solid #555', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer' }}
                        >
                            Duplicate
                        </button>
                        <button
                            onClick={() => { const entry = modExportEntry(); if (entry) navigator.clipboard.writeText(encodeModExport([entry])); }}
                            disabled={!boardHasModules}
                            title="Copy this machine's layout for the Module Optimizer Import mod"
                            style={{ flex: 1, padding: '8px', fontSize: '0.85em', backgroundColor: '#2e4a35', color: 'white', border: '1px solid #4caf50', borderRadius: '6px', cursor: !boardHasModules ? 'not-allowed' : 'pointer', opacity: !boardHasModules ? 0.5 : 1 }}
                        >
                            Export
                        </button>
                    </div>

                </div>
            </div>

            {showPaths && (
                <div style={{
                    position: 'absolute', top: `${HEADER_TOP + HEADER_HEIGHT + 10}px`, left: '15px', right: '15px', bottom: '15px',
                    backgroundColor: '#1a1a1a', borderRadius: '6px', border: '1px solid #333',
                    overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
                    zIndex: 5
                }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#ccc', textAlign: 'center', fontSize: '0.9em', textTransform: 'uppercase' }}>Module Paths</h4>
                    {uniqueModules.length > 0 ? uniqueModules.map(mod => {
                        const effs = mod.effects.filter(e => e !== 'None');
                        const effStr = effs.length > 0
                            ? ` (${effs.map(e => `${e}${e === 'Learning Algorithm' || e === 'Degrading' ? ` ${mod.effectValues[mod.effects.indexOf(e)]}%` : ''}`).join(', ')})`
                            : '';
                        const actualPath = (mod as any).originalPath || 'Manual';

                        return (
                            <div key={mod.id} style={{ padding: '8px', backgroundColor: '#252526', borderRadius: '4px', borderLeft: `3px solid ${COLOR_MAP[mod.color as ModuleColor]}` }}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.85em', color: '#eee', marginBottom: '4px' }}>
                                    {mod.displayName}<span style={{ color: '#aaa', fontWeight: 'normal' }}>{effStr}</span>
                                </div>
                                <div style={{ fontSize: '0.75em', color: '#888', wordBreak: 'break-word' }}>
                                    {actualPath}
                                </div>
                            </div>
                        );
                    }) : (
                        <div style={{ color: '#888', fontSize: '0.85em', textAlign: 'center', marginTop: '20px' }}>No modules placed.</div>
                    )}
                </div>
            )}
        </div>
    );
}))

export default function ModuleInventoryUI() {
    const [inventory, setInventory] = useState<InventoryItem[]>(() => {
        const savedInventory = localStorage.getItem('optimizer_inventory');
        if (savedInventory) {
            try {
                const items: InventoryItem[] = JSON.parse(savedInventory);
                // Saved before specials could be unlocked, when they were always locked: lock them once
                if (localStorage.getItem('optimizer_specials_locked') !== '1') {
                    localStorage.setItem('optimizer_specials_locked', '1');
                    return items.map(i => isSpecialModule(i) ? { ...i, isLocked: true } : i);
                }
                return items;
            } catch (e) { return []; }
        }
        return [];
    });

    useEffect(() => {
        localStorage.setItem('optimizer_inventory', JSON.stringify(inventory));
    }, [inventory]);

    const [machines, setMachines] = useState<{ id: string }[]>(() => {
        const saved = localStorage.getItem('optimizer_machine_list');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { }
        }
        return [{ id: `m_${Math.random().toString(36).substring(2,8)}` }];
    });

    useEffect(() => {
        localStorage.setItem('optimizer_machine_list', JSON.stringify(machines));
        rememberSaveSettings();
    }, [machines]);

    const machinesRef = useRef<Record<string, any>>({});
    const [solvingStates, setSolvingStates] = useState<Record<string, boolean>>({});

    const getUsedItems = useCallback((excludeId?: string | null) => {
        const used = new Set<string>();
        Object.entries(machinesRef.current).forEach(([id, m]: [string, any]) => {
            if (excludeId && id === excludeId) return;
            if (m) {
                const board = m.getBoard();
                if (board) {
                    for (let y = 0; y < 5; y++) {
                        for (let x = 0; x < 7; x++) {
                            const cell = board[y][x];
                            if (cell && cell !== 'Locked') used.add(cell.id);
                        }
                    }
                }
            }
        });
        return used;
    }, []);


    const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, cell: InventoryItem, stats?: Stats } | null>(null);

    const [dragState, setDragState] = useState<{
        item: InventoryItem;
        sourceMachineId: string | null;
        offsets: Point[];
        dragOffsetX: number;
        dragOffsetY: number;
        initialMouseX: number;
        initialMouseY: number;
        initialTarget?: any;
    } | null>(null);

    const dragHoverTargetRef = useRef<{ machineId: string | null, x: number, y: number } | null>(null);
    const setDragTargetRefChange = useCallback((target: any) => {
        dragHoverTargetRef.current = target;
    }, []);

    const expandedInventory = useMemo(() => {
        const expanded: InventoryItem[] = [];
        for (const item of inventory) {
            expanded.push(item);
            if (item.shape === 'Node1x2' && item.isInfinite) {
                const cloneCount = 17 * Math.max(1, machines.length);
                for (let i = 0; i < cloneCount; i++) {
                    expanded.push({ ...item, id: `${item.id}_clone_${i}` });
                }
            }
        }
        return expanded;
    }, [inventory, machines.length]);

    const hoveredItem = hoverInfo ? (expandedInventory.find(i => i.id === hoverInfo.cell.id) || hoverInfo.cell) : null;
    const dragRef = useRef(dragState);

    const isAnySolving = Object.values(solvingStates).some(s => s);

    useEffect(() => { dragRef.current = dragState; }, [dragState]);

    useEffect(() => {
        const handleAppDragStart = (e: any) => {
            setDragState(e.detail);
            if (e.detail.initialTarget) {
                dragHoverTargetRef.current = e.detail.initialTarget;
            }
        };
        window.addEventListener('appDragStart', handleAppDragStart);
        return () => window.removeEventListener('appDragStart', handleAppDragStart);
    }, []);

    useEffect(() => {
        if (!dragState) return;

        const handleMouseUp = () => {
            const currentDrag = dragRef.current;
            const currentTarget = dragHoverTargetRef.current;

            if (currentDrag) {
                if (!currentTarget || currentTarget.machineId === null) {
                    if (currentDrag.sourceMachineId !== null && !lockedToMachine(currentDrag.item)) {
                        machinesRef.current[currentDrag.sourceMachineId]?.remove(currentDrag.item.id);
                    }
                } else {
                    const machine = machinesRef.current[currentTarget.machineId];

                    if (currentDrag.sourceMachineId !== null && lockedToMachine(currentDrag.item) && currentDrag.sourceMachineId !== currentTarget.machineId) {
                        // Prevent moving a locked module into a different machine
                    } else if (machine) {
                        const targetX = currentTarget.x - currentDrag.dragOffsetX;
                        const targetY = currentTarget.y - currentDrag.dragOffsetY;

                        if (machine.isValidPlacement(currentDrag.item, targetX, targetY, currentDrag.offsets)) {
                            Object.keys(machinesRef.current).forEach(mId => {
                                if (mId !== currentTarget.machineId) {
                                    machinesRef.current[mId]?.remove(currentDrag.item.id);
                                }
                            });
                            machine.place(currentDrag.item, targetX, targetY, currentDrag.offsets);
                            if (currentDrag.sourceMachineId === null && Boolean(currentDrag.item.isLocked) !== isSpecialModule(currentDrag.item)) {
                                setInventory(prev => prev.map(i => i.id === currentDrag.item.id ? { ...i, isLocked: isSpecialModule(i) } : i));
                            }
                        }
                    }
                }
            }
            setDragState(null);
            dragHoverTargetRef.current = null;
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            const currentDrag = dragRef.current;
            if (!currentDrag) return;

            const key = e.key.toLowerCase();
            if (!['q', 'e', 'f'].includes(key)) return;

            // Q/E rotating and F flipping
            let transform = (p: Point) => p;
            let isFlipping = false;

            if (key === 'e') {
                transform = (p) => ({ x: -p.y, y: p.x });
            } else if (key === 'q') {
                transform = (p) => ({ x: p.y, y: -p.x });
            } else if (key === 'f') {
                transform = (p) => ({ x: -p.x, y: p.y });
                isFlipping = true;
            }

            let rawNewOffsets = currentDrag.offsets.map(transform);
            let minX = Math.min(...rawNewOffsets.map(p => p.x));
            let minY = Math.min(...rawNewOffsets.map(p => p.y));
            let newOffsets = rawNewOffsets.map(p => ({ x: p.x - minX, y: p.y - minY }));

            const areOffsetsEqual = (o1: Point[], o2: Point[]) => {
                if (o1.length !== o2.length) return false;
                const set1 = new Set(o1.map(p => `${p.x},${p.y}`));
                return o2.every(p => set1.has(`${p.x},${p.y}`));
            };

            if (areOffsetsEqual(currentDrag.offsets, newOffsets)) {
                if (isFlipping) {
                    const altTransform = (p: Point) => ({ x: p.x, y: -p.y });
                    const altRawNewOffsets = currentDrag.offsets.map(altTransform);
                    const altMinX = Math.min(...altRawNewOffsets.map(p => p.x));
                    const altMinY = Math.min(...altRawNewOffsets.map(p => p.y));
                    const altNewOffsets = altRawNewOffsets.map(p => ({ x: p.x - altMinX, y: p.y - altMinY }));

                    if (areOffsetsEqual(currentDrag.offsets, altNewOffsets)) {
                        return;
                    } else {
                        transform = altTransform;
                        minX = altMinX;
                        minY = altMinY;
                        newOffsets = altNewOffsets;
                    }
                } else {
                    return;
                }
            }

            const avgX = currentDrag.offsets.reduce((sum, p) => sum + p.x, 0) / currentDrag.offsets.length;
            const avgY = currentDrag.offsets.reduce((sum, p) => sum + p.y, 0) / currentDrag.offsets.length;
            let pivotOld = currentDrag.offsets[0];
            let minDist = Infinity;
            for (const p of currentDrag.offsets) {
                const dist = (p.x - avgX) ** 2 + (p.y - avgY) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    pivotOld = p;
                }
            }

            const offsetFromCenterX = currentDrag.dragOffsetX - pivotOld.x;
            const offsetFromCenterY = currentDrag.dragOffsetY - pivotOld.y;

            const pivotRawNew = transform(pivotOld);
            const pivotNew = { x: pivotRawNew.x - minX, y: pivotRawNew.y - minY };

            const newDX = pivotNew.x + offsetFromCenterX;
            const newDY = pivotNew.y + offsetFromCenterY;

            setDragState(prev => prev ? {
                ...prev,
                offsets: newOffsets,
                dragOffsetX: newDX,
                dragOffsetY: newDY
            } : null);
        };

        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [!!dragState]);

    // Right-click on a module in a machine: locks it to that machine (it can move around the board but never leaves it, like the
    // Alarm Transmitter and the Furnace specials, which always are), and again to unlock it
    const handleToggleLock = useCallback((itemId: string) => {
        setInventory(prev => prev.map(i => i.id === itemId ? { ...i, isLocked: !i.isLocked } : i));
    }, []);

    // Modules added from the Add Module menu are not in the save; they can be taken out of storage again
    const handleRemoveItem = useCallback((itemId: string) => {
        setInventory(prev => prev.filter(i => i.id !== itemId));
    }, []);

    const handleInventoryDragStart = useCallback((e: React.MouseEvent, item: InventoryItem) => {
        if (isAnySolving) { e.preventDefault(); return; }
        e.preventDefault();
        const offsets = PRECOMPUTED_OFFSETS.get(item.shape)?.[0] || [{x: 0, y: 0}];

        const avgX = offsets.reduce((sum: number, p: Point) => sum + p.x, 0) / offsets.length;
        const avgY = offsets.reduce((sum: number, p: Point) => sum + p.y, 0) / offsets.length;

        let pivot = offsets[0];
        let minDist = Infinity;
        for (const p of offsets) {
            const dist = (p.x - avgX) ** 2 + (p.y - avgY) ** 2;
            if (dist < minDist) {
                minDist = dist;
                pivot = p;
            }
        }

        const dragOffsetX = pivot.x;
        const dragOffsetY = pivot.y;

        const evt = new CustomEvent('appDragStart', {
            detail: {
                item,
                sourceMachineId: null,
                offsets,
                dragOffsetX,
                dragOffsetY,
                initialMouseX: e.clientX,
                initialMouseY: e.clientY
            }
        });
        window.dispatchEvent(evt);
    }, [isAnySolving]);


    // "Unused Module Storage": every owned module that no machine board holds. Boards live inside the cards, so
    // they report changes (throttled, since a running optimizer changes them many times a second).
    const [boardVersion, setBoardVersion] = useState(0);
    const boardBumpTimer = useRef<number | null>(null);
    const handleBoardChange = useCallback(() => {
        if (boardBumpTimer.current !== null) return;
        boardBumpTimer.current = window.setTimeout(() => {
            boardBumpTimer.current = null;
            setBoardVersion(v => v + 1);
        }, 150);
    }, []);

    const WINE_PER_AGEWELL = 6;
    /* Store stats at the top of the page, from the boards as they stand:
     *   water     what every Moisture Farm makes a day, by grade, and what it is worth (moistureFarmOutput)
     *   attract   last night's base attractiveness from the save plus the best Mirage Projector's 100 + Performance + Quality
     *             (projectors do not stack: the game takes the highest)
     *   theft     the chance a theft goes through: 100% minus the best Alarm System's stop chance, 50% + Performance up to 100%
     *             (alarms do not stack either)
     *   ingots    a Furnace smelts 1 ingot a day from 2 mats (scrap or ore), a Blast module makes it 2 from 3
     *   power     every machine's energy a day (statUnit Efficiency: the game's rule per machine, AgeWell with its Performance)
     *   wine      an AgeWell holds 6 bottles and ages them 1 day a night, +1 per full 125% Quality; shown is what the modules add
     *             a night with every AgeWell full (6 bottles x its extra days)
     *   cleaning  the sum of the Water Purifiers' Removal readouts: the extra a day Performance adds to each contaminant's removal,
     *             0.02 ml per 1% (statUnit Performance)
     *   work      a Desequencer decodes 33 + 33 * Performance / 100 work a day (desequencerSpeed)
     */
    const storeStats = useMemo(() => {
        let water = 0, farms = 0, projector: number | null = null, stop: number | null = null;
        const mlByGrade = new Map<string, number>();
        let ingots = 0, furnaces = 0, sources = 0;
        let power = 0, powered = 0, agewells = 0, agingDays = 0, purifiers = 0, cleaning = 0, desequencers = 0, work = 0;
        for (const { id } of machines) {
            const card = machinesRef.current[id];
            if (!card) continue;
            const state = card.getState();
            const kind: string = state.machineKind ?? state.machineType ?? '';
            const name = kind.toLowerCase();
            const farm = isMoistureFarm(kind), mirage = isMirage(kind), alarm = name.includes('alarm');
            const furnace = name.includes('furnace');
            const board = card.getBoard();
            const { totals } = calculateBoardStats(board, expandedInventory);
            const p = Math.trunc(totals.Performance), q = Math.trunc(totals.Quality);
            const energy = statUnit(kind, 'Efficiency');
            if (energy) {
                power += energy.fromPercent(isAgeWell(kind) ? totals.Efficiency + totals.Performance : totals.Efficiency, totals);
                powered++;
            }
            if (isAgeWell(kind)) {
                agewells++;
                agingDays += WINE_PER_AGEWELL * (1 + Math.floor(Math.max(0, q) / 125));
            }
            if (name.includes('water purifier')) {
                purifiers++;
                cleaning += statUnit(kind, 'Performance')?.fromPercent(p) ?? 0;
            }
            if (isDesequencer(kind)) {
                desequencers++;
                work += desequencerSpeed(p);
            }
            if (farm) {
                const out = moistureFarmOutput(p, q);
                water += out.value;
                farms++;
                mlByGrade.set(out.grade, (mlByGrade.get(out.grade) ?? 0) + out.ml);
            }
            if (mirage) projector = Math.max(projector ?? -Infinity, MIRAGE_BASE_POINTS + p + q);
            if (alarm) stop = Math.max(stop ?? -Infinity, Math.min(100, Math.max(0, 50 + p)));
            if (furnace) {
                const blast = board.some((row: any[]) => row.some(c => c && c !== 'Locked' && c.displayName.includes('(Blast)')));
                furnaces++;
                ingots += blast ? 2 : 1;
                sources += blast ? 3 : 2;
            }
        }
        let base: number | null = null;
        try { const v = localStorage.getItem(STORE_BASE_ATTRACTIVENESS_KEY); base = v === null ? null : Number(v); } catch { /* none */ }
        return { water: Math.round(water), farms, mlByGrade, projector, base, theft: 100 - (stop ?? 0), alarms: stop !== null, ingots, furnaces,
            sources, power, powered, agewells, agingDays, purifiers, cleaning: Math.round(cleaning * 100) / 100, desequencers, work };
    }, [boardVersion, machines, expandedInventory]);

    // The top bar is two rows at most: the buttons keep their two rows, and stat cells that do not fit in the width left over are
    // hidden, from the right (the order of the cells is their importance)
    const statsAreaRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const area = statsAreaRef.current;
        if (!area) return;
        const fit = () => {
            const width = area.clientWidth;
            const hidden: string[] = [];
            area.querySelectorAll<HTMLElement>('.store-stat').forEach(cell => {
                const out = cell.offsetLeft + cell.offsetWidth > width + 0.5;
                cell.style.visibility = out ? 'hidden' : '';
                if (out) hidden.push(cell.querySelector('.store-stat-label')?.textContent ?? '');
            });
            area.title = hidden.length ? `Not enough room for: ${hidden.filter(Boolean).join(', ')}` : '';
        };
        const observer = new ResizeObserver(fit);
        observer.observe(area);
        const grid = area.firstElementChild;
        if (grid) observer.observe(grid);
        fit();
        return () => observer.disconnect();
    }, [storeStats]);

    const unusedModules = useMemo(() => {
        const used = getUsedItems(null);
        const groupOrder: Record<string, number> = { Red: 0, Yellow: 1, Green: 2, Purple: 3, DarkRed: 4, Grey: 5, White: 6 };
        const size = (item: InventoryItem) => PRECOMPUTED_OFFSETS.get(item.shape)?.[0]?.length ?? 0;
        return inventory
            .filter(item => !used.has(item.id) && !(item.isInfinite && [...used].some(id => id.startsWith(item.id + '_clone_'))))
            .sort((a, b) => (groupOrder[a.color] ?? 9) - (groupOrder[b.color] ?? 9) || size(b) - size(a) || a.displayName.localeCompare(b.displayName));
    }, [inventory, boardVersion, machines, getUsedItems]);
    /* Store / Retrieve: bank the unused modules in the machines' empty cells (the game keeps them there like any storage), and take
     * them back out. A module is only stored where it lowers none of that machine's stats that do something (energy included),
     * largest first, machines in card order, locked machines skipped. When no free spot fits it, the machine's own modules may be
     * moved to make room (one, then two of them), as long as that still lowers none of its stats.
     * Retrieve takes out exactly the stored modules; a machine whose modules were moved gets its layout from before the Store back,
     * unless it has been changed since. A new solve forgets all of it
     */
    const [storedIds, setStoredIds] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('optimizer_stored_ids') || '[]'); } catch { return []; }
    });
    // Per machine whose modules Store moved: its layout before and after, as item ids
    type IdGrid = (string | null)[][];
    const [storedLayouts, setStoredLayouts] = useState<Record<string, { before: IdGrid; after: IdGrid }>>(() => {
        try { return JSON.parse(localStorage.getItem('optimizer_stored_layouts') || '{}'); } catch { return {}; }
    });
    useEffect(() => {
        try {
            localStorage.setItem('optimizer_stored_ids', JSON.stringify(storedIds));
            localStorage.setItem('optimizer_stored_layouts', JSON.stringify(storedLayouts));
        } catch { /* storage unavailable */ }
    }, [storedIds, storedLayouts]);
    useEffect(() => { if (isAnySolving) { setStoredIds([]); setStoredLayouts({}); } }, [isAnySolving]);
    const [storeNote, setStoreNote] = useState<string | null>(null);
    const idGrid = (board: any[][]): IdGrid => board.map(row => row.map(c => (c === 'Locked' ? 'Locked' : c ? c.id : null)));
    const handleStore = () => {
        const byId = indexInventoryById(expandedInventory);
        const statsOf = (board: any[][]) => calculateBoardStats(board, expandedInventory, byId).totals;
        const STATS = ['Performance', 'Quality', 'Efficiency'] as const;
        const deadline = performance.now() + 2000;
        const cards = machines.map(({ id }) => ({ id, card: machinesRef.current[id] })).filter(m => m.card && !m.card.isLocked());

        // Every placement of `item` on `board`: free, unlocked cells only
        const placementsOf = (board: any[][], item: InventoryItem) => {
            const out: { x: number; y: number; offsets: Point[] }[] = [];
            for (const offsets of PRECOMPUTED_OFFSETS.get(item.shape) ?? []) {
                for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) {
                    if (offsets.every(pt => { const px = x + pt.x, py = y + pt.y; return px >= 0 && px < 7 && py >= 0 && py < 5 && board[py][px] === null; })) {
                        out.push({ x, y, offsets });
                    }
                }
            }
            return out;
        };
        const put = (board: any[][], item: InventoryItem, at: { x: number; y: number; offsets: Point[] }) => {
            const next = board.map(row => [...row]);
            for (const pt of at.offsets) next[at.y + pt.y][at.x + pt.x] = item;
            return next;
        };
        const lift = (board: any[][], items: InventoryItem[]) =>
            board.map(row => row.map(c => (c && c !== 'Locked' && items.some(it => it.id === c.id) ? null : c)));

        // The layout with `item` stored on `board`, moving at most `moves` of the machine's own modules, or null
        const storeOn = (board: any[][], type: string, item: InventoryItem, moves: number): any[][] | null => {
            const before = statsOf(board);
            const harmless = (next: any[][]) => { const after = statsOf(next); return STATS.every(k => statHasNoEffect(type, k) || after[k] >= before[k]); };
            if (moves === 0) {
                for (const at of placementsOf(board, item)) { const next = put(board, item, at); if (harmless(next)) return next; }
                return null;
            }
            // Modules that may move: this machine's own, not locked by the player
            const own: InventoryItem[] = [];
            board.forEach(row => row.forEach(c => { if (c && c !== 'Locked' && !c.isLocked && !own.some(o => o.id === c.id)) own.push(c); }));
            const groups: InventoryItem[][] = moves === 1 ? own.map(o => [o]) : own.flatMap((a, i) => own.slice(i + 1).map(b => [a, b]));
            for (const group of groups) {
                if (performance.now() > deadline) return null;
                const freed = lift(board, group);
                for (const at of placementsOf(freed, item)) {
                    // The stored module first, then the moved ones back in anywhere they fit
                    const place = (b: any[][], rest: InventoryItem[]): any[][] | null => {
                        if (rest.length === 0) return harmless(b) ? b : null;
                        if (performance.now() > deadline) return null;
                        for (const spot of placementsOf(b, rest[0])) {
                            const done = place(put(b, rest[0], spot), rest.slice(1));
                            if (done) return done;
                        }
                        return null;
                    };
                    const done = place(put(freed, item, at), group);
                    if (done) return done;
                }
            }
            return null;
        };

        const stored: string[] = [];
        const layouts: Record<string, { before: IdGrid; after: IdGrid }> = {};
        const candidates = unusedModules.filter(item => !item.isInfinite);
        // Straight into free spots first for everything, then moving one module, then two, for what is left
        for (const moves of [0, 1, 2]) {
            for (const item of candidates) {
                if (stored.includes(item.id) || performance.now() > deadline) continue;
                for (const { id, card } of cards) {
                    const board: any[][] = card.getBoard();
                    const next = storeOn(board, card.getState().machineKind, item, moves);
                    if (!next) continue;
                    if (moves > 0 && !layouts[id]) layouts[id] = { before: idGrid(board), after: [] };
                    const { totals, pieceStats } = calculateBoardStats(next, expandedInventory, byId);
                    card.applyUpdate(next, totals, pieceStats, '');
                    stored.push(item.id);
                    break;
                }
            }
        }
        for (const { id, card } of cards) if (layouts[id]) layouts[id].after = idGrid(card.getBoard());
        setStoredIds(stored);
        setStoredLayouts(layouts);
        const left = candidates.length - stored.length;
        const moved = Object.keys(layouts).length;
        setStoreNote(stored.length === 0 ? 'No spot takes a module without lowering a machine\'s stats'
            : [left > 0 ? `${left} module${left === 1 ? '' : 's'} found no spot that leaves the machine's stats as they are` : '',
               moved > 0 ? `modules moved in ${moved} machine${moved === 1 ? '' : 's'} to make room` : ''].filter(Boolean).join('; ') || null);
    };
    const handleRetrieve = () => {
        const byId = indexInventoryById(expandedInventory);
        const same = (a: IdGrid, b: IdGrid) => a.length === b.length && a.every((row, y) => row.every((c, x) => c === b[y][x]));
        for (const [id, card] of Object.entries(machinesRef.current) as [string, any][]) {
            if (!card) continue;
            const layout = storedLayouts[id];
            if (layout && same(idGrid(card.getBoard()), layout.after)) {
                // Untouched since the Store: exactly the layout it had before
                const board = layout.before.map(row => row.map(c => (c === 'Locked' ? 'Locked' : c ? byId.get(c) ?? null : null)));
                const { totals, pieceStats } = calculateBoardStats(board, expandedInventory, byId);
                card.applyUpdate(board, totals, pieceStats, '');
            } else {
                for (const sid of storedIds) card.remove(sid);
            }
        }
        setStoredIds([]);
        setStoredLayouts({});
        setStoreNote(null);
    };
    const handleImportSave = useCallback((newItems: InventoryItem[], importedMachines: { id: string, boardIds: (string | null)[][], machineType: string, kind?: string, tier: GridTier }[], save: string) => {
        setInventory(newItems);

        // Each imported machine gets the settings remembered for it in this save (and the remembered card order); a machine new
        // to the save starts with the stats that matter for its type switched on, by what the machine is, not the name the player gave it
        const newMachines = restoreSaveSettings(save, importedMachines, m => {
            const kind = m.kind ?? m.machineType;
            const ignoreStats = defaultIgnoreStats(kind);
            let base: number | null = null;
            try { const v = localStorage.getItem(STORE_BASE_ATTRACTIVENESS_KEY); base = v === null ? null : Number(v); } catch { /* none */ }
            const targetStats = defaultTargetStats(kind, base);
            const maximizeStats = defaultMaximizeStats(ignoreStats);
            (['Performance', 'Quality', 'Efficiency'] as const).forEach(k => { if (targetStats[k] !== null) maximizeStats[k] = false; });
            return { boardIds: m.boardIds, tier: m.tier, ignoreStats, maximizeStats, targetStats };
        }, newItems, locks => {
            if (locks.size > 0) setInventory(newItems.map(it => locks.has(it.id) ? { ...it, isLocked: locks.get(it.id) } : it));
        });
        newMachines.forEach(m => {
            localStorage.setItem(`optimizer_machine_type_${m.id}`, m.machineType);
            if (m.kind) localStorage.setItem(`optimizer_machine_kind_${m.id}`, m.kind);
        });

        setMachines(prev => {
            prev.forEach(m => {
                localStorage.removeItem(`optimizer_machine_${m.id}`);
                localStorage.removeItem(`optimizer_machine_type_${m.id}`);
                localStorage.removeItem(`optimizer_machine_locked_${m.id}`); localStorage.removeItem(`optimizer_machine_kind_${m.id}`);
            });
            return newMachines.length > 0
                ? newMachines.map(m => ({ id: m.id }))
                : [{ id: `m_${Math.random().toString(36).substring(2,8)}` }];
        });

        machinesRef.current = {};
        setSolvingStates({});
    }, []);

    // Run All optimizes every unlocked machine together in one engine run, so modules are shared out between
    // them instead of each machine racing for whatever the others are not holding yet. Card order is priority:
    // each machine's stats get its position as their rank, and the engine compares ranks strictly, so the first
    // card gets the best layout its modules allow before the second is considered, and so on.
    const jointRunRef = useRef<{ current: boolean }>({ current: false });

    const stopAll = useCallback(() => {
        jointRunRef.current.current = false;
        Object.values(machinesRef.current).forEach((m: any) => m?.stop());
    }, []);

    /* One joint run over the machines in `ids` (in card order; locked ones left out): the search shares the modules between them,
     * relaxing and easing as Run All does. Every other machine keeps its modules. Run All is this over every machine, and pressing Run
     * on a card while others are running restarts as one joint run over all of them (see handleRunMachine)
     */
    const runJoint = async (ids: string[]) => {
        const chosen = new Set(ids);
        const active = machines.filter(m => {
            const ref = machinesRef.current[m.id];
            return chosen.has(m.id) && ref && !ref.isLocked();
        });
        if (active.length === 0) return;

        // Modules on the other machines (not chosen, or locked) stay where they are
        const activeIds = new Set(active.map(m => m.id));
        const heldByLocked = new Set<string>();
        machines.forEach(m => {
            if (activeIds.has(m.id)) return;
            const board = machinesRef.current[m.id]?.getBoard();
            board?.forEach((row: any[]) => row.forEach(cell => { if (cell && cell !== 'Locked') heldByLocked.add(cell.id); }));
        });
        const engineInventory = expandedInventory.map(item => heldByLocked.has(item.id) ? { ...item, isLocked: true } : item);

        /* Priority follows card order, except that neighbouring cards of the same kind of machine with the same settings share one:
         * the solver then maximizes their combined output instead of filling the first before the next. On four Moisture Farms with
         * four Neural Cores, sequential priority put all four cores in the first farm, past its 6000 ml cap (6000 ml of pure water);
         * shared priority spread them and made 8560 ml of pure water (+7% total water value)
         */
        const states = active.map(m => machinesRef.current[m.id].getState());
        const groupKey = (state: any) => JSON.stringify([
            String(state.machineKind).split(' > ').pop()!.replace(/\s+\d+$/, '').trim().toLowerCase(),
            state.ignoreStats, state.targetStats, state.maximizeStats, state.targetSteps,
        ]);
        const priorities: number[] = [];
        states.forEach((state, i) => {
            priorities.push(i === 0 ? 1 : groupKey(state) === groupKey(states[i - 1]) ? priorities[i - 1] : priorities[i - 1] + 1);
        });
        const configs = active.map((m, rank) => {
            const state = states[rank];
            const priority = priorities[rank];
            return {
                id: m.id,
                tier: state.tier,
                targetStats: state.targetStats,
                maximizeStats: state.maximizeStats,
                ignoreStats: state.ignoreStats,
                // Card order is priority on this site's solver; the others keep each card's own stat priorities, as their sites do
                statPriority: readSolver() === 'bloom' ? { Performance: priority, Quality: priority, Efficiency: priority } : state.statPriority,
                targetSteps: state.targetSteps,
                sumPQ: state.sumPQ,
                water: state.water,
                sumPE: state.sumPE,
                performanceCap: state.performanceCap,
                qualityCap: state.qualityCap,
                worthlessBelowSteps: state.worthlessBelowSteps,
                cheapEnergyAt: state.cheapEnergyAt
            };
        });
        const boards = active.map(m => machinesRef.current[m.id].getBoard());

        jointRunRef.current = { current: true };
        active.forEach(m => handleSolvingChange(m.id, true));
        // A card's own Run while others run: a single machine still runs on its own (a benchmark, nothing given up), a joint run as Run All
        if (active.length === 1) {
            jointRunRef.current.current = false;
            active.forEach(m => handleSolvingChange(m.id, false));
            machinesRef.current[active[0].id]?.runSolo();
            return;
        }
        try {
            await runSelectedSolver(readSolver(), configs, boards, engineInventory, expandedInventory, jointRunRef.current, (updates) => {
                updates.forEach((update, id) => {
                    machinesRef.current[id]?.applyUpdate(update.board, update.totals, update.pieceStats, update.code);
                });
            });
        } finally {
            jointRunRef.current.current = false;
            active.forEach(m => handleSolvingChange(m.id, false));
        }
    };

    const handleRunAll = async () => {
        if (isAnySolving) {
            stopAll();
            return;
        }
        // hoydoy's solver (solvers/index.ts) as on his site: every unlocked card starts its own search, each kept off what the others hold
        if (readSolver() === 'hoydoy') {
            machines.forEach(m => { const ref = machinesRef.current[m.id]; if (ref && !ref.isLocked()) ref.runSolo(); });
            return;
        }
        await runJoint(machines.map(m => m.id));
    };

    // Run on a card while other machines are running (alone or together): they stop, and one joint run starts over all of them and
    // this one, so they share modules as under Run All instead of each holding what the others had when it started
    const solvingRef = useRef(solvingStates);
    solvingRef.current = solvingStates;
    const handleRunMachine = async (id: string) => {
        // hoydoy: the card's own search starts next to the others, which carry on undisturbed
        if (readSolver() === 'hoydoy') { machinesRef.current[id]?.runSolo(); return; }
        const running = Object.entries(solvingRef.current).filter(([, on]) => on).map(([k]) => k);
        stopAll();
        for (let i = 0; i < 200 && Object.values(solvingRef.current).some(Boolean); i++) await new Promise(r => setTimeout(r, 50));
        await runJoint([...new Set([...running, id])]);
    };
    const runMachineRef = useRef(handleRunMachine);
    runMachineRef.current = handleRunMachine;
    const onRunMachine = useCallback((id: string) => { runMachineRef.current(id); }, []);

    // Stop on a card: only that machine leaves the solve. The run stops, and the machines still running carry on together from their
    // layouts as they are (one joint run, or a single machine's own run if one is left), the stopped one keeping its layout and modules
    const handleStopMachine = async (id: string) => {
        // hoydoy: only this card's search stops
        if (readSolver() === 'hoydoy') { machinesRef.current[id]?.stop(); return; }
        const remaining = Object.entries(solvingRef.current).filter(([k, on]) => on && k !== id).map(([k]) => k);
        stopAll();
        if (remaining.length === 0) return;
        for (let i = 0; i < 200 && Object.values(solvingRef.current).some(Boolean); i++) await new Promise(r => setTimeout(r, 50));
        await runJoint(remaining);
    };
    const stopMachineRef = useRef(handleStopMachine);
    stopMachineRef.current = handleStopMachine;
    const onStopMachine = useCallback((id: string) => { stopMachineRef.current(id); }, []);

    // Reordering cards (= priority): press on a card's header and drag. The card lifts and follows the pointer,
    // the other cards slide aside live as it passes over them, and it settles into its slot on release.
    // Positions are animated with FLIP: remember where every slot was, reorder, then let each card glide from
    // its old spot to its new one. Hit testing uses layout positions (offsetLeft/Top), which ignore the
    // in-flight animations, so a card that is still sliding can't make the order flicker back and forth.
    const containerRef = useRef<HTMLDivElement>(null);
    const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const orderRef = useRef(machines);
    orderRef.current = machines;
    const sortRef = useRef<{ id: string; grabX: number; grabY: number; x: number; y: number; startX: number; startY: number; started: boolean } | null>(null);
    const slotSnapshot = useRef<Map<string, { left: number; top: number }> | null>(null);
    const [sortingId, setSortingId] = useState<string | null>(null);
    const SORT_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    const SORT_MS = 220;
    const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const slotBox = (id: string) => {
        const el = slotRefs.current[id];
        const container = containerRef.current;
        if (!el || !container) return null;
        const c = container.getBoundingClientRect();
        return { left: c.left + el.offsetLeft, top: c.top + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    };

    // Keeps the lifted card under the pointer, wherever its slot currently is
    const followPointer = () => {
        const drag = sortRef.current;
        if (!drag || !drag.started) return;
        const card = cardRefs.current[drag.id];
        const box = slotBox(drag.id);
        if (!card || !box) return;
        card.style.transform = `translate(${drag.x - drag.grabX - box.left}px, ${drag.y - drag.grabY - box.top}px) scale(1.03)`;
    };

    useLayoutEffect(() => {
        const before = slotSnapshot.current;
        slotSnapshot.current = null;
        if (before) {
            const animate = !reduceMotion();
            orderRef.current.forEach(m => {
                if (m.id === sortRef.current?.id) return;
                const el = slotRefs.current[m.id];
                const old = before.get(m.id);
                if (!el || !old) return;
                const dx = old.left - el.offsetLeft;
                const dy = old.top - el.offsetTop;
                if (!dx && !dy) return;
                if (!animate) return;
                // Jump back to where it was drawn, then glide to the new slot
                el.style.transition = 'none';
                el.style.transform = `translate(${dx}px, ${dy}px)`;
                void el.offsetWidth;
                el.style.transition = `transform ${SORT_MS}ms ${SORT_EASE}`;
                el.style.transform = '';
            });
        }
        followPointer();
    }, [machines]);

    const handleSortMove = (e: PointerEvent) => {
        const drag = sortRef.current;
        if (!drag) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (!drag.started) {
            if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
            drag.started = true;
            setSortingId(drag.id);
            const card = cardRefs.current[drag.id];
            if (card) {
                card.style.transition = `box-shadow ${SORT_MS}ms ${SORT_EASE}`;
                card.style.zIndex = '50';
                card.style.boxShadow = '0 22px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(76, 175, 80, 0.35)';
                card.style.borderRadius = '8px';
            }
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'grabbing';
        }
        followPointer();

        // Over another card's slot? Move into it and let the rest slide
        for (const m of orderRef.current) {
            if (m.id === drag.id) continue;
            const box = slotBox(m.id);
            if (!box) continue;
            if (drag.x < box.left || drag.x > box.left + box.width || drag.y < box.top || drag.y > box.top + box.height) continue;
            const snapshot = new Map<string, { left: number; top: number }>();
            orderRef.current.forEach(o => {
                const el = slotRefs.current[o.id];
                if (el) snapshot.set(o.id, { left: el.offsetLeft, top: el.offsetTop });
            });
            slotSnapshot.current = snapshot;
            setMachines(prev => {
                const from = prev.findIndex(x => x.id === drag.id);
                const to = prev.findIndex(x => x.id === m.id);
                if (from < 0 || to < 0 || from === to) return prev;
                const next = [...prev];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                return next;
            });
            break;
        }
    };

    const handleSortEnd = () => {
        const drag = sortRef.current;
        sortRef.current = null;
        if (!drag || !drag.started) return;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        const card = cardRefs.current[drag.id];
        if (card) {
            const clear = () => {
                card.style.transition = '';
                card.style.transform = '';
                card.style.zIndex = '';
                card.style.boxShadow = '';
            };
            if (reduceMotion()) {
                clear();
            } else {
                card.style.transition = `transform ${SORT_MS}ms ${SORT_EASE}, box-shadow ${SORT_MS}ms ${SORT_EASE}`;
                card.style.transform = 'translate(0px, 0px) scale(1)';
                card.style.boxShadow = '0 0 0 0 rgba(0, 0, 0, 0)';
                window.setTimeout(clear, SORT_MS + 30);
            }
        }
        setSortingId(null);
    };

    const handleSortStart = (id: string, e: React.PointerEvent) => {
        if (e.button !== 0 || sortRef.current) return;
        // Controls and the module grid keep working as normal clicks and module drags
        if ((e.target as HTMLElement).closest('button, select, input, option, textarea, label, a, .grid-wrapper')) return;
        const card = cardRefs.current[id];
        if (!card) return;
        const rect = card.getBoundingClientRect();
        sortRef.current = {
            id, grabX: e.clientX - rect.left, grabY: e.clientY - rect.top,
            x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, started: false
        };
        // Bound once per drag, so the exact same functions are removed again (the handlers only touch refs and
        // state setters, so the ones from this render stay valid for the whole drag)
        const onMove = (ev: PointerEvent) => handleSortMove(ev);
        const onEnd = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
            handleSortEnd();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    };

    const [copiedAllForMod, setCopiedAllForMod] = useState(false);
    // Which solver lays the modules out (solvers/index.ts), read when a solve starts
    const [solverKind, setSolverKind] = useState<SolverKind>(readSolver);
    const handleCopyAllForMod = () => {
        const entries = machines
            .map(m => machinesRef.current[m.id]?.getModExport?.())
            .filter((e: any) => e && e.code);
        if (entries.length === 0) return;
        navigator.clipboard.writeText(encodeModExport(entries));
        setCopiedAllForMod(true);
        setTimeout(() => setCopiedAllForMod(false), 2000);
    };

    const handleClearAll = () => {
        Object.values(machinesRef.current).forEach((m: any) => {
            if (m && typeof m.isLocked === 'function' && !m.isLocked()) {
                m.clear();
            }
        });
    };

    const handleAddMachine = () => {
        setMachines(prev => [...prev, { id: `m_${Math.random().toString(36).substring(2,8)}` }]);
    };

    const handleClearAllMachines = () => {
        const preservedMachines: { id: string }[] = [];

        machines.forEach(m => {
            const machineRef = machinesRef.current[m.id];
            if (machineRef && machineRef.isLocked && machineRef.isLocked()) {
                preservedMachines.push(m);
            } else {
                localStorage.removeItem(`optimizer_machine_${m.id}`);
                localStorage.removeItem(`optimizer_machine_type_${m.id}`);
                localStorage.removeItem(`optimizer_machine_locked_${m.id}`); localStorage.removeItem(`optimizer_machine_kind_${m.id}`);
            }
        });

        if (preservedMachines.length === 0) {
            preservedMachines.push({ id: `m_${Math.random().toString(36).substring(2,8)}` });
            machinesRef.current = {};
            setSolvingStates({});
        } else {
            const nextRefs: Record<string, any> = {};
            const nextSolving: Record<string, boolean> = {};

            preservedMachines.forEach(m => {
                if (machinesRef.current[m.id]) nextRefs[m.id] = machinesRef.current[m.id];
                if (solvingStates[m.id]) nextSolving[m.id] = solvingStates[m.id];
            });

            machinesRef.current = nextRefs;
            setSolvingStates(nextSolving);
        }

        setMachines(preservedMachines);
    };

    const handleDuplicateMachine = useCallback((machineId: string) => {
        const machine = machinesRef.current[machineId];
        if (machine) {
            setMachines(prev => [...prev, { id: `m_${Math.random().toString(36).substring(2,8)}` }]);
        }
    }, []);

    const handleDeleteMachine = useCallback((machineId: string) => {
        setMachines(prev => prev.filter(m => m.id !== machineId));
        delete machinesRef.current[machineId];
        setSolvingStates(prev => {
            const next = { ...prev };
            delete next[machineId];
            return next;
        });
        localStorage.removeItem(`optimizer_machine_${machineId}`);
        localStorage.removeItem(`optimizer_machine_type_${machineId}`);
        localStorage.removeItem(`optimizer_machine_locked_${machineId}`); localStorage.removeItem(`optimizer_machine_kind_${machineId}`);
    }, []);

    const handleSolvingChange = useCallback((id: string, solving: boolean) => {
        setSolvingStates(prev => {
            if (prev[id] === solving) return prev;
            return { ...prev, [id]: solving };
        });
    }, []);

    const cellSize = machines.length <= 2 ? 50 : (machines.length <= 4 ? 40 : 35);


    return (
        <div className="main-container">

            <style>
                {`
                .catalog-card {
                    transition: transform 0.1s ease-in-out, box-shadow 0.1s ease-in-out, background-color 0.1s ease-in-out;
                }
                .catalog-card:hover {
                    transform: translateY(-2px);
                    background-color: #2a2a2a !important;
                    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.05);
                }
                .catalog-card:active {
                    transform: translateY(0);
                }
                input[type=number]::-webkit-inner-spin-button, 
                input[type=number]::-webkit-outer-spin-button { 
                    -webkit-appearance: none; 
                    margin: 0; 
                }
                input[type=number] { 
                    -moz-appearance: textfield; 
                }
                
                .main-container {
                    display: flex;
                    flex-direction: column;
                    min-height: 100vh;
                    background-color: #111;
                    color: #eee;
                    font-family: sans-serif;
                    padding: 6px 20px 20px;
                    user-select: none;
                }
                .stats-header {
                    display: flex;
                    gap: 40px;
                    margin-bottom: 15px;
                    background-color: #1a1a1a;
                    padding: 15px 30px;
                    border-radius: 8px;
                    border: 1px solid #333;
                }
                .grid-wrapper {
                    display: grid;
                    gap: 0px;
                    background-color: #222;
                    padding: 10px;
                    border-radius: 8px;
                    border: 1px solid #333;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                }
                .controls-wrapper {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    margin-top: 10px;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                }
                .solution-ui {
                    display: flex;
                    width: 100%;
                    margin-top: 15px;
                    gap: 10px;
                    justify-content: center;
                    align-items: center;
                }
                .solution-ui input {
                    flex: 1;
                    max-width: 500px;
                    padding: 8px;
                    font-size: 0.8em;
                    background-color: #111;
                    color: #eee;
                    border: 1px solid #444;
                    border-radius: 4px;
                }
                .toolbar {
                    flex-wrap: nowrap;
                }
                .toolbar .store-stats-area {
                    flex: 1 1 0;
                    min-width: 0;
                    overflow: hidden;
                    position: relative;
                }
                .toolbar .store-stats {
                    display: grid;
                    grid-template-rows: auto auto;
                    grid-auto-flow: column;
                    grid-auto-columns: max-content;
                    justify-content: start;
                    gap: 8px 18px;
                    align-items: center;
                    min-width: 0;
                    min-height: 3.6em;
                }
                .toolbar .store-stat {
                    display: flex;
                    flex-direction: column;
                    white-space: nowrap;
                    line-height: 1.25;
                    cursor: help;
                }
                .toolbar .store-stat-label {
                    font-size: 0.68em;
                    color: #888;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .toolbar .store-stat-value {
                    font-size: 1.1em;
                    font-weight: bold;
                    font-variant-numeric: tabular-nums;
                }
                .toolbar .store-stat-unit {
                    font-size: 0.62em;
                    color: #888;
                    font-weight: normal;
                }
                .toolbar .store-stat-grades {
                    display: flex;
                    gap: 8px;
                    align-items: baseline;
                    font-size: 0.75em;
                    line-height: 1.6em;
                    color: #aaa;
                    white-space: nowrap;
                }
                .toolbar .store-stat-grades b {
                    font-size: 1.25em;
                }
                .toolbar .store-stat-grades b {
                    color: #ddd;
                    font-variant-numeric: tabular-nums;
                }
                .toolbar .toolbar-buttons {
                    flex: 0 1 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    align-items: flex-end;
                    margin-left: auto;
                    padding-left: 15px;
                    border-left: 1px solid #2a2a2a;
                }
                .toolbar .toolbar-row {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    justify-content: flex-end;
                }
                .toolbar .store-stat-words {
                    display: inline-flex;
                    flex-direction: column;
                    vertical-align: middle;
                    margin-left: 5px;
                    font-size: 0.5em;
                    line-height: 1;
                    color: #888;
                    font-weight: normal;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .bottom-layout {
                    display: flex;
                    gap: 30px;
                    min-height: 0;
                    margin-top: 20px;
                    /* Fixed height (not flex-grown): storage and inventory scroll inside instead of stretching the page to fit every row */
                    flex: none;
                    height: 75vh;
                }
                .machines-container {
                    position: relative;
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    align-items: flex-start;
                    gap: 30px;
                    width: 100%;
                }
                
                @media (max-width: 768px) {
                    .main-container {
                        padding: 10px;
                        height: auto;
                    }
                    .bottom-layout {
                        flex-direction: column;
                        gap: 15px;
                        min-height: auto;
                        height: auto;
                    }
                    .stats-header {
                        gap: 15px;
                        padding: 10px;
                        width: 100%;
                        justify-content: space-around;
                    }
                    .grid-wrapper {
                        transform: scale(0.85);
                        transform-origin: top center;
                        margin-bottom: -25px;
                    }
                    .controls-wrapper {
                        flex-direction: column;
                        width: 100%;
                        align-items: stretch;
                    }
                    .solution-ui {
                        flex-wrap: wrap;
                    }
                    .solution-ui input {
                        max-width: 100%;
                        width: 100%;
                    }
                }
                @media (max-width: 400px) {
                    .grid-wrapper {
                        transform: scale(0.75);
                        margin-bottom: -50px;
                    }
                }
                `}
            </style>

            {/* Tooltip */}
            {hoveredItem && hoverInfo && !dragState && (
                <div style={{
                    position: 'fixed',
                    top: hoverInfo.y + 15,
                    left: hoverInfo.x + 15,
                    backgroundColor: 'rgba(0, 0, 0, 0.95)',
                    border: `1px solid ${COLOR_MAP[hoveredItem.color]}`,
                    padding: '10px 15px',
                    borderRadius: '6px',
                    zIndex: 1000,
                    pointerEvents: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    minWidth: '150px'
                }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px', color: COLOR_MAP[hoveredItem.color] }}>
                        {hoveredItem.displayName}
                    </div>
                    {(hoveredItem.effects[0] !== 'None' || hoveredItem.effects[1] !== 'None') && (
                        <div style={{ fontSize: '0.75em', color: '#aaa', fontStyle: 'italic', marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '5px' }}>
                            {hoveredItem.effects.filter(e => e !== 'None').map((e) => {
                                const actualIdx = hoveredItem.effects.indexOf(e as ItemEffect);
                                const val = hoveredItem.effectValues[actualIdx];
                                return `${e}${e === 'Learning Algorithm' || e === 'Degrading' ? ` (${val}%)` : ''}`;
                            }).join(', ')}
                        </div>
                    )}
                    {hoverInfo.stats ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9em', marginTop: '5px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#aaa' }}>Perf:</span>
                                <span style={{ color: getStatColor(hoverInfo.stats.Performance) }}>{formatStatValue(hoverInfo.stats.Performance)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#aaa' }}>Qual:</span>
                                <span style={{ color: getStatColor(hoverInfo.stats.Quality) }}>{formatStatValue(hoverInfo.stats.Quality)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#aaa' }}>Effic:</span>
                                <span style={{ color: getStatColor(hoverInfo.stats.Efficiency) }}>{formatStatValue(hoverInfo.stats.Efficiency)}</span>
                            </div>
                        </div>
                    ) : (
                        <div style={{ color: '#888', fontSize: '0.9em' }}>Calculating...</div>
                    )}

                    {lockedToMachine(hoveredItem) && (
                        <div style={{ marginTop: '8px', fontSize: '0.75em', color: '#9a9a9a' }}>
                            Locked to this machine · right-click to unlock
                        </div>
                    )}
                    {!lockedToMachine(hoveredItem) && (
                        <div style={{ marginTop: '8px', fontSize: '0.75em', color: '#666' }}>Right-click to lock it to this machine</div>
                    )}
                    {hoveredItem.originalPath && (
                        <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #333', fontSize: '0.75em', color: '#888', wordBreak: 'break-word', maxWidth: '250px' }}>
                            <span style={{ color: '#aaa' }}>Path: </span>{hoveredItem.originalPath}
                        </div>
                    )}
                </div>
            )}

            {/* Toolbar: stays pinned to the top of the window while the page scrolls */}
            <div className="toolbar" style={{
                display: 'flex', gap: '15px', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', marginBottom: '16px', width: '100%',
                boxSizing: 'border-box', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111', boxShadow: '0 6px 10px -6px rgba(0, 0, 0, 0.8)'
            }}>
                <div className="store-stats-area" ref={statsAreaRef}>
                <div className="store-stats">
                    {storeStats.farms > 0 && (
                        <div className="store-stat" title={[
                            `What ${storeStats.farms} Moisture Farm${storeStats.farms === 1 ? '' : 's'} make a day, as the boards stand, at the game's price per grade`,
                            '(credits per 100 ml: ' + WATER_GRADES.slice().reverse().map(g => `${g.name} ${g.price}`).join(', ') + ')',
                            'A farm makes 1000 ml a day, +10 ml per 1% Performance, up to 6000 ml',
                        ].join('\n')}>
                            <span className="store-stat-label">Water value</span>
                            <span className="store-stat-value" style={{ color: '#4fb3bf' }}>{storeStats.water.toLocaleString()}<span className="store-stat-unit"> credits / day</span></span>
                        </div>
                    )}
                    {storeStats.farms > 0 && (
                        <div className="store-stat" title="Water made a day by all Moisture Farms, by grade">
                            <span className="store-stat-label">Water production</span>
                            <span className="store-stat-grades">
                                {WATER_GRADES.slice().reverse().filter(g => storeStats.mlByGrade.has(g.name)).map(g => (
                                    <span key={g.name}>{g.name} <b>{storeStats.mlByGrade.get(g.name)!.toLocaleString()}</b></span>
                                ))}
                                <span>ml / day</span>
                            </span>
                        </div>
                    )}
                    {storeStats.furnaces > 0 && (
                        <div className="store-stat" title={[
                            `${storeStats.furnaces} Furnace${storeStats.furnaces === 1 ? '' : 's'}: ${storeStats.ingots} ingots a day from ${storeStats.sources} sources (scrap or ore)`,
                            'A Furnace makes 1 ingot from 2 sources, with a Blast module 2 from 3',
                        ].join('\n')}>
                            <span className="store-stat-label">Ingots a day</span>
                            <span className="store-stat-value" style={{ color: '#e0a050' }}>{storeStats.ingots}<span className="store-stat-unit"> from {storeStats.sources} mats</span></span>
                        </div>
                    )}
                    {storeStats.agewells > 0 && (
                        <div className="store-stat" title={[
                            `${storeStats.agewells} AgeWell${storeStats.agewells === 1 ? '' : 's'}, ${WINE_PER_AGEWELL} bottles each: ${storeStats.agewells * WINE_PER_AGEWELL} bottles`,
                            `With all of them full, the modules add ${storeStats.agingDays - storeStats.agewells * WINE_PER_AGEWELL} aging days a night`,
                            `(${storeStats.agingDays} in all, against ${storeStats.agewells * WINE_PER_AGEWELL} with no modules: 1 day a bottle,`,
                            '+1 for every full 125% Quality)',
                        ].join('\n')}>
                            <span className="store-stat-label">Wine</span>
                            <span className="store-stat-value" style={{ color: '#c25b7f' }}>
                                {storeStats.agingDays - storeStats.agewells * WINE_PER_AGEWELL}
                                <span className="store-stat-words"><span>extra days at</span><span>max capacity</span></span>
                            </span>
                        </div>
                    )}
                    {storeStats.purifiers > 0 && (
                        <div className="store-stat" title={[
                            `The Removal of ${storeStats.purifiers} Water Purifier${storeStats.purifiers === 1 ? '' : 's'} added up, as each card shows it:`,
                            'the extra a day Performance removes of each contaminant, 0.02 ml per 1% (heavy metals; chemicals 0.03, the rest 0.05).',
                            'Never below the purity floor that Quality sets',
                        ].join('\n')}>
                            <span className="store-stat-label">Contaminants removed</span>
                            <span className="store-stat-value" style={{ color: '#7fc8a9' }}>{storeStats.cleaning.toLocaleString()}<span className="store-stat-unit"> ml / day</span></span>
                        </div>
                    )}
                    {storeStats.desequencers > 0 && (
                        <div className="store-stat" title={`Decoding work a day over ${storeStats.desequencers} Cryptographic Desequencer${storeStats.desequencers === 1 ? '' : 's'}: 33 + 33 × Performance / 100 each (a keycard needs 75 to 150 work by chipset)`}>
                            <span className="store-stat-label">Desequencer</span>
                            <span className="store-stat-value" style={{ color: '#6fa8ff' }}>{storeStats.work}<span className="store-stat-unit"> / day</span></span>
                        </div>
                    )}
                    {storeStats.powered > 0 && (
                        <div className="store-stat" title={`Energy a day over ${storeStats.powered} machine${storeStats.powered === 1 ? '' : 's'}, by the game's rule for each (Efficiency, and Performance on the AgeWell)`}>
                            <span className="store-stat-label">Power</span>
                            <span className="store-stat-value" style={{ color: '#f2d24b' }}>{storeStats.power}<span className="store-stat-unit"> / day</span></span>
                        </div>
                    )}
                    {(storeStats.base !== null || storeStats.projector !== null) && (
                        <div className="store-stat" title={[
                            'Projected store attractiveness:',
                            `  last night's base, without bonuses (from the save): ${storeStats.base ?? 'import a save to see it'}`,
                            `  best Mirage Projector: ${storeStats.projector === null ? 'none' : `+${storeStats.projector}`} (100 + Performance + Quality; projectors do not stack)`,
                        ].join('\n')}>
                            <span className="store-stat-label">Attractiveness</span>
                            <span className="store-stat-value" style={{ color: '#c58af9' }}>
                                {storeStats.base === null ? '?' : (storeStats.base + (storeStats.projector ?? 0)).toLocaleString()}
                                {storeStats.projector !== null && <span className="store-stat-unit"> (+{storeStats.projector} projector)</span>}
                            </span>
                        </div>
                    )}
                    {storeStats.farms + storeStats.furnaces + (storeStats.alarms ? 1 : 0) + (storeStats.projector !== null ? 1 : 0) > 0 && (
                        <div className="store-stat" title={storeStats.alarms
                            ? "Chance a theft goes through: 100% minus the best Alarm System's stop chance (50% + Performance, up to 100%; alarms do not stack)"
                            : 'No Alarm System: nothing stops a theft'}>
                            <span className="store-stat-label">Theft chance</span>
                            <span className="store-stat-value" style={{ color: storeStats.theft > 0 ? '#ff4d4d' : '#4caf50' }}>{storeStats.theft}%</span>
                        </div>
                    )}
                </div>
                </div>
                <div className="toolbar-buttons">
                <div className="toolbar-row">
                <button
                    onClick={handleRunAll}
                    disabled={inventory.length === 0 && !isAnySolving}
                    style={{
                        padding: '10px 24px',
                        backgroundColor: isAnySolving ? '#ff4d4d' : '#4caf50',
                        color: 'white',
                        border: isAnySolving ? '1px solid #ff4d4d' : '1px solid #2e4a35',
                        borderRadius: '6px',
                        fontWeight: 'bold',
                        cursor: (inventory.length === 0 && !isAnySolving) ? 'not-allowed' : 'pointer',
                        opacity: (inventory.length === 0 && !isAnySolving) ? 0.5 : 1,
                        fontSize: '0.95em'
                    }}
                >
                    {isAnySolving ? 'Stop All Optimizers' : 'Run All Optimizers'}
                </button>
                <button
                    onClick={handleClearAll}
                    disabled={isAnySolving}
                    style={{ padding: '10px 24px', backgroundColor: '#333333', color: '#eee', border: '1px solid #555555', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.95em' }}
                >
                    Clear All
                </button>
                <button
                    onClick={handleAddMachine}
                    disabled={isAnySolving}
                    style={{ padding: '10px 24px', backgroundColor: '#333333', color: '#eee', border: '1px solid #555555', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.95em' }}
                >
                    + Add Machine
                </button>
                <button
                    onClick={handleCopyAllForMod}
                    disabled={isAnySolving}
                    title="Copy every machine's code with its name, for the Module Optimizer Import mod"
                    style={{ padding: '10px 24px', backgroundColor: '#2e4a35', color: '#eee', border: '1px solid #4caf50', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.95em' }}
                >
                    {copiedAllForMod ? 'Copied!' : 'Export All'}
                </button>
                </div>
                <div className="toolbar-row">
                <SaveFileImporter onImport={handleImportSave} />
                <button
                    onClick={handleClearAllMachines}
                    disabled={isAnySolving}
                    style={{ padding: '10px 24px', backgroundColor: 'rgba(255, 77, 77, 0.1)', color: '#ff4d4d', border: '1px solid #ff4d4d', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.95em' }}
                >
                    Delete All
                </button>
                <div role="radiogroup" aria-label="Solver" title="Which solver lays the modules out (when a solve starts)"
                    style={{ display: 'flex', alignItems: 'center', border: '1px solid #555555', borderRadius: '6px', overflow: 'hidden', opacity: isAnySolving ? 0.5 : 1 }}>
                    {SOLVERS.map(s => (
                        <button key={s.value} role="radio" aria-checked={solverKind === s.value} title={s.title}
                            disabled={isAnySolving}
                            onClick={() => { writeSolver(s.value); setSolverKind(s.value); }}
                            style={{
                                padding: '10px 14px', border: 'none', borderRadius: 0, fontSize: '0.95em',
                                backgroundColor: solverKind === s.value ? '#2e4a35' : '#333333',
                                color: solverKind === s.value ? '#fff' : '#aaa', fontWeight: solverKind === s.value ? 'bold' : 'normal',
                                cursor: isAnySolving ? 'not-allowed' : 'pointer',
                            }}>
                            {s.label}
                        </button>
                    ))}
                </div>
                </div>
                </div>
            </div>

            {/* Main Grid & Controls */}
            {/* Card order is priority: a small left-to-right arrow over the machine cards */}
            {machines.length > 1 && (
                <div
                    title="Run All gives the best modules to the first card, then the next, and so on. Drag a card by its header to change the order."
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 12px 4px', color: '#888', fontSize: '0.75em', userSelect: 'none' }}
                >
                    <span style={{ fontWeight: 'bold', letterSpacing: '0.08em', color: '#aaa' }}>PRIORITY</span>
                    <span style={{ display: 'flex', alignItems: 'center', width: '140px' }}>
                        <span style={{ flex: 1, height: '2px', background: 'linear-gradient(to right, rgba(76, 175, 80, 0.15), rgba(76, 175, 80, 0.9))' }} />
                        <span style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '8px solid rgba(76, 175, 80, 0.9)' }} />
                    </span>
                    <span>drag cards to reorder</span>
                </div>
            )}
            <div className="machines-container" ref={containerRef}>
                {machines.map(m => (
                    <div
                        key={m.id}
                        ref={(el) => { slotRefs.current[m.id] = el; }}
                        style={{
                            position: 'relative',
                            borderRadius: '8px',
                            // The slot a lifted card will drop into
                            outline: sortingId === m.id ? '2px dashed rgba(76, 175, 80, 0.55)' : 'none',
                            outlineOffset: '-2px',
                            backgroundColor: sortingId === m.id ? 'rgba(76, 175, 80, 0.04)' : 'transparent',
                            transition: 'background-color 150ms ease'
                        }}
                    >
                      <div
                        ref={(el) => { cardRefs.current[m.id] = el; }}
                        style={{ position: 'relative', willChange: sortingId === m.id ? 'transform' : undefined }}
                      >
                        <MachineInstance
                            machineId={m.id}
                            ref={(el: any) => { if (el) machinesRef.current[m.id] = el; }}
                            inventory={expandedInventory}
                            setInventory={setInventory}
                            getUsedItems={getUsedItems}
                            dragState={dragState}
                            setHoverInfo={setHoverInfo}
                            onDuplicate={handleDuplicateMachine}
                            onDelete={handleDeleteMachine}
                            cellSize={cellSize}
                            onSolvingChange={handleSolvingChange}
                            onDragTargetRefChange={setDragTargetRefChange}
                            isAnySolving={isAnySolving}
                            isThisMachineSolving={solvingStates[m.id] || false}
                            canDelete={machines.length > 1}
                            onReorderStart={handleSortStart}
                            onBoardChange={handleBoardChange}
                            onStopMachine={onStopMachine}
                            solverKind={solverKind}
                            onToggleLock={handleToggleLock}
                            onRunMachine={onRunMachine}
                        />
                      </div>
                    </div>
                ))}
            </div>

            {/* Unused Module Storage */}
            <div className="bottom-layout">
                {/* Unused Module Storage */}
                <div style={{ flex: '1', minWidth: 0, backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '8px', border: '1px solid #2c2c2e', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '15px', paddingBottom: '12px', borderBottom: '1px solid #333' }}>
                        <span style={{ color: '#eee', fontWeight: 'bold', fontSize: '1em' }}>Unused Module Storage</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ color: '#888', fontSize: '0.85em' }}>
                                {unusedModules.length} of {inventory.length} module{inventory.length === 1 ? '' : 's'}
                            </span>
                            <AddModuleMenu onAdd={item => setInventory(prev => [...prev, item])} disabled={isAnySolving} />
                            <button
                                onClick={storedIds.length > 0 ? handleRetrieve : handleStore}
                                disabled={isAnySolving || (storedIds.length === 0 && unusedModules.every(item => item.isInfinite))}
                                title={storedIds.length > 0
                                    ? `Take the ${storedIds.length} stored module${storedIds.length === 1 ? '' : 's'} back out of the machines`
                                    : 'Put unused modules into free machine cells, only where they lower none of that machine\'s stats (energy included)'}
                                style={{
                                    background: '#4caf50', border: '1px solid #2e4a35', borderRadius: '6px', color: 'white',
                                    cursor: isAnySolving ? 'not-allowed' : 'pointer', opacity: isAnySolving ? 0.5 : 1,
                                    fontSize: '0.9em', padding: '6px 16px', fontWeight: 'bold'
                                }}
                            >
                                {storedIds.length > 0 ? '↓ Retrieve' : '↑ Store'}
                            </button>
                        </span>
                    </div>
                    {storeNote && <div style={{ color: '#888', fontSize: '0.8em', marginTop: '-8px', marginBottom: '10px' }}>{storeNote}</div>}

                    {unusedModules.length === 0 ? (
                        <div style={{ color: '#777', fontSize: '0.85em', textAlign: 'center', padding: '30px 10px' }}>
                            {inventory.length === 0
                                ? 'Import a save to see your modules here.'
                                : 'Every module you own is placed in a machine.'}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', overflowY: 'auto', alignContent: 'flex-start', padding: '5px 5px 20px 5px', justifyContent: 'center' }}>
                            {unusedModules.map(item => {
                                const effects = item.effects
                                    .map((eff, i) => eff === 'None' ? null
                                        : (eff === 'Learning Algorithm' || eff === 'Degrading') ? `${eff} ${item.effectValues[i]}%` : eff)
                                    .filter(Boolean)
                                    .join(' · ');
                                const where = item.originalPath ? item.originalPath.split(' > ').pop() : null;
                                const canDrag = !isAnySolving;
                                const added = item.uid === undefined && item.id.includes('_added_');
                                return (
                                    <div
                                        key={item.id}
                                        className="catalog-card"
                                        onMouseDown={(e) => { if (canDrag) handleInventoryDragStart(e, item); }}
                                        title={[item.displayName, effects, item.originalPath ? `In game: ${item.originalPath}` : added ? 'Added here, not in your save' : null, canDrag ? 'Drag onto a machine to place it' : null].filter(Boolean).join('\n')}
                                        style={{
                                            padding: '14px 10px', width: '135px', backgroundColor: '#252526',
                                            border: `1px solid ${COLOR_MAP[item.color as ModuleColor]}`, borderRadius: '6px',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                                            cursor: canDrag ? 'grab' : 'default', userSelect: 'none', position: 'relative'
                                        }}
                                    >
                                        {added && (
                                            <button
                                                onMouseDown={e => e.stopPropagation()}
                                                onClick={() => handleRemoveItem(item.id)}
                                                disabled={isAnySolving}
                                                title="Remove this added module"
                                                style={{ position: 'absolute', top: '2px', right: '4px', background: 'none', border: 'none', color: '#777', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '1.1em', lineHeight: 1, padding: '2px' }}
                                            >
                                                &times;
                                            </button>
                                        )}
                                        <div style={{ height: '50px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                            <MiniShape shape={item.shape} colorHex={COLOR_MAP[item.color as ModuleColor]} />
                                        </div>
                                        <span style={{ fontSize: '0.7em', color: '#ccc', marginTop: '12px', textAlign: 'center', fontWeight: 'bold' }}>
                                            {item.displayName}
                                        </span>
                                        {effects && (
                                            <span style={{ fontSize: '0.62em', color: '#9ab', marginTop: '5px', textAlign: 'center' }}>{effects}</span>
                                        )}
                                        {where && (
                                            <span style={{ fontSize: '0.6em', color: '#666', marginTop: '5px', textAlign: 'center' }}>{where}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>

            <DragGhost dragState={dragState} cellSize={cellSize} />
        </div>
    );
}