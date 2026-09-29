import React, { useState, useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { encodeModExport, boardModules } from './modExport';
import { defaultIgnoreStats, defaultMaximizeStats, statBreakpoints, isDesequencer, isMirage, isMoistureFarm, worthlessBelowSteps, desequencerCutoffs, statHasNoEffect } from './machineDefaults';
import { StatGoals } from './components/StatGoals';
import { runParallelEngine } from './solver/parallel';
import type { Stats, GridTier, InventoryItem, FilterGroup, ItemEffect, ModuleColor, Point } from './types';
import { COLOR_MAP, EFFECTS_LIST, MODULE_TEMPLATES } from './constants';
import { formatStatValue, getStatColor, getBaseStats, PRECOMPUTED_OFFSETS } from './utils';
import { createPortal } from 'react-dom';
import { useOptimizer, calculateBoardStats, indexInventoryById } from './hooks/useOptimizer';
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

const InventoryItemRow = React.memo(({ item, isAnySolving, updateItemEffect, updateItemEffectValue, handleBlurEffectValue, onRemove, onDragStart, onToggleInfinite, onToggleLock }: any) => {
    return (
        <div
            onMouseDown={(e) => onDragStart(e, item)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#252526', borderRadius: '4px', borderLeft: `4px solid ${COLOR_MAP[item.color as ModuleColor]}`, cursor: (isAnySolving || item.isLocked) ? 'default' : 'grab', opacity: item.isLocked ? 0.6 : 1 }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                <MiniShape shape={item.shape} colorHex={COLOR_MAP[item.color as ModuleColor]} size="10px" />

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '4px', pointerEvents: 'none' }}>
                    <span style={{ fontSize: '0.9em', fontWeight: 'bold', color: '#eee' }}>{item.displayName}</span>

                    {item.shape !== 'Node1x2' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', pointerEvents: 'auto' }}>
                            {[0, 1].map((effectIdx) => {
                                const currentEffect = item.effects[effectIdx];
                                const showCustomInput = currentEffect === 'Learning Algorithm' || currentEffect === 'Degrading';

                                return (
                                    <div key={effectIdx} style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }} onMouseDown={(e) => e.stopPropagation()}>
                                        <select
                                            value={currentEffect}
                                            onChange={(e) => updateItemEffect(item, effectIdx as 0 | 1, e.target.value as ItemEffect)}
                                            disabled={isAnySolving}
                                            style={{ flex: 1, padding: '2px', fontSize: '0.7em', backgroundColor: '#111', color: '#eee', border: '1px solid #444', borderRadius: '3px', minWidth: '0', cursor: isAnySolving ? 'not-allowed' : 'pointer', opacity: isAnySolving ? 0.6 : 1 }}
                                        >
                                            {EFFECTS_LIST.filter(eff => eff === 'None' || eff !== item.effects[effectIdx === 0 ? 1 : 0]).map(eff => (
                                                <option key={eff} value={eff}>{eff === 'None' ? 'No Effect' : eff}</option>
                                            ))}
                                        </select>

                                        {showCustomInput && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} title="Custom Percentage Value">
                                                <input
                                                    type="number"
                                                    value={item.effectValues[effectIdx]}
                                                    onChange={(e) => updateItemEffectValue(item.id, effectIdx as 0 | 1, Number(e.target.value))}
                                                    onBlur={(e) => handleBlurEffectValue(item, effectIdx as 0 | 1, Number(e.target.value))}
                                                    disabled={isAnySolving}
                                                    style={{ width: '48px', padding: '1px', fontSize: '0.7em', backgroundColor: '#111', color: '#eee', border: '1px solid #444', borderRadius: '3px', textAlign: 'center', cursor: isAnySolving ? 'not-allowed' : 'auto', opacity: isAnySolving ? 0.6 : 1 }}
                                                />
                                                <span style={{ fontSize: '0.65em', color: '#aaa' }}>%</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%', pointerEvents: 'auto' }} onMouseDown={(e) => e.stopPropagation()}>
                            <label style={{ fontSize: '0.75em', color: '#ccc', display: 'flex', alignItems: 'center', gap: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={!!item.isInfinite}
                                    onChange={(e) => onToggleInfinite && onToggleInfinite(e.target.checked)}
                                    disabled={isAnySolving}
                                    style={{ margin: 0, cursor: isAnySolving ? 'not-allowed' : 'pointer' }}
                                />
                                Infinite Nodes
                            </label>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', marginLeft: '8px', alignItems: 'center', gap: '4px' }}>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onToggleLock(item.id, !item.isLocked)}
                    disabled={isAnySolving}
                    style={{
                        background: item.isLocked ? 'rgba(255, 77, 77, 0.1)' : 'transparent',
                        border: `1px solid ${item.isLocked ? '#ff4d4d' : '#555'}`,
                        color: item.isLocked ? '#ff4d4d' : '#aaa',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        cursor: isAnySolving ? 'not-allowed' : 'pointer',
                        fontSize: '0.75em',
                        fontWeight: 'bold',
                        minWidth: '60px'
                    }}
                >
                    {item.isLocked ? 'Unlock' : 'Lock'}
                </button>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onRemove(item.id)}
                    disabled={isAnySolving}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: isAnySolving ? '#444' : '#666',
                        cursor: isAnySolving ? 'not-allowed' : 'pointer',
                        fontSize: '1.4em',
                        padding: '8px',
                        marginRight: '-5px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    &times;
                </button>
            </div>
        </div>
    );
});

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
                                                   onStopAll
                                               }: any, ref) => {
    // Machine state loading handles fallback defaults from localStorage automatically
    const optimizer = useOptimizer(inventory, setInventory, machineId, getUsedItems, 3, isAnySolving);
    const [localHover, setLocalHover] = useState<{x: number, y: number} | null>(null);
    const [showPaths, setShowPaths] = useState(false);
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
    const machineIconUrl = machineIcon(machineType);
    // A Blast module shifts every Furnace breakpoint up by 100%
    const hasBlast = optimizer.board.some(row => row.some(cell => cell && cell !== 'Locked' && cell.displayName.includes('(Blast)')));
    // A Moisture Farm with Volume and Purity both on Auto is scored on the value of its water (see MachineConfig.water)
    const waterMode = () => isMoistureFarm(machineType)
        && (['Performance', 'Quality'] as const).every(k => !optimizer.ignoreStats[k] && optimizer.maximizeStats[k] && optimizer.targetStats[k] === null);
    // The values where each stat changes something on this machine, for the solver (see MachineConfig.targetSteps)
    const targetSteps = () => {
        const steps: Partial<Record<'Performance' | 'Quality' | 'Efficiency', number[]>> = {};
        for (const stat of ['Performance', 'Quality', 'Efficiency'] as const) {
            const list = stat === 'Performance' && isDesequencer(machineType) ? desequencerCutoffs() : statBreakpoints(machineType, stat, hasBlast)?.map(b => b.value);
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
    }, [limitKey, limitStats]);

    // A stat that does nothing on this machine has no card, so it must not be left on from an older setup either
    useEffect(() => {
        const stray = (['Performance', 'Quality', 'Efficiency'] as const).filter(k => statHasNoEffect(machineType, k) && !optimizer.ignoreStats[k]);
        if (stray.length > 0) optimizer.setIgnoreStats((prev: any) => ({ ...prev, ...Object.fromEntries(stray.map(k => [k, true])) }));
    }, [machineType, optimizer.ignoreStats]);

    // An enabled stat is maximized unless it has a target, or when its target is a limit it stays under
    // maximizeStats is derived from that, so the optimizer and the solution code see the same settings as before.
    useEffect(() => {
        const next = { Performance: false, Quality: false, Efficiency: false };
        let changed = false;
        for (const key of ['Performance', 'Quality', 'Efficiency'] as const) {
            next[key] = !optimizer.ignoreStats[key] && (optimizer.targetStats[key] === null || limitStats[key]);
            if (Boolean(optimizer.maximizeStats[key]) !== next[key]) changed = true;
        }
        if (changed) optimizer.setMaximizeStats(next);
    }, [optimizer.ignoreStats, optimizer.targetStats, optimizer.maximizeStats, limitStats]);

    useEffect(() => {
        if (machineType !== 'Select Machine...') {
            localStorage.setItem(`optimizer_machine_type_${machineId}`, machineType);
        }
    }, [machineType, machineId]);

    useEffect(() => {
        localStorage.setItem(`optimizer_machine_locked_${machineId}`, String(isMachineLocked));
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

    useImperativeHandle(ref, () => ({
        run: optimizer.runOptimization,
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
            sumPQ: isMirage(machineType),
            water: waterMode(),
            worthlessBelowSteps: worthlessBelowSteps(machineType),
            machineType
        }),
        isValidPlacement: optimizer.isValidPlacement,
        getBoard: () => optimizer.boardRef.current,
        applyUpdate: optimizer.applyUpdate,
        isLocked: () => isMachineLocked,
        getModExport: () => optimizer.solutionCode
            ? { name: machineType, code: optimizer.solutionCode, modules: boardModules(optimizer.boardRef.current) }
            : null
    }), [optimizer, isMachineLocked, machineType]);

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
                            {([['Perf', 'Performance'], ['Qual', 'Quality'], ['Effic', 'Efficiency']] as const).map(([label, stat]) => (
                                <div key={stat} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                                    <span style={{ color: '#aaa' }}>{label}:</span>
                                    <span style={{ color: getStatColor(optimizer.bestTotals[stat]) }}>{formatStatValue(optimizer.bestTotals[stat])}</span>
                                </div>
                            ))}
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
                                    optimizer.setTargetStats({ Performance: null, Quality: null, Efficiency: null });
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
                                    onMouseDown={(e) => {
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
                        machineType={machineType}
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
                    />

                    <div style={{ display: 'flex', gap: '5px', width: '100%' }}>
                        <button
                            onClick={() => {
                                if (currentSolving) {
                                    optimizer.stopOptimization();
                                    onSolvingChange(machineId, false);
                                    onStopAll();
                                } else {
                                    optimizer.runOptimization(targetSteps(), isMirage(machineType), waterMode(), worthlessBelowSteps(machineType));
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
                            onClick={() => navigator.clipboard.writeText(encodeModExport([{ name: machineType, code: optimizer.solutionCode, modules: boardModules(optimizer.boardRef.current) }]))}
                            disabled={!optimizer.solutionCode}
                            title="Copy this machine's layout for the Module Optimizer Import mod"
                            style={{ flex: 1, padding: '8px', fontSize: '0.85em', backgroundColor: '#2e4a35', color: 'white', border: '1px solid #4caf50', borderRadius: '6px', cursor: !optimizer.solutionCode ? 'not-allowed' : 'pointer', opacity: !optimizer.solutionCode ? 0.5 : 1 }}
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

// Rendering every row of a very large inventory costs a lot
const MAX_VISIBLE_INVENTORY_ROWS = 255;

export default function ModuleInventoryUI() {
    const [inventory, setInventory] = useState<InventoryItem[]>(() => {
        const savedInventory = localStorage.getItem('optimizer_inventory');
        if (savedInventory) {
            try { return JSON.parse(savedInventory); } catch (e) { return []; }
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


    const [invFilterGroup, setInvFilterGroup] = useState<FilterGroup | 'Placed' | 'NotPlaced'>('All');
    const [invFilterSize, setInvFilterSize] = useState<'All' | 3 | 4 | 5>('All');
    const [invFilterEffect, setInvFilterEffect] = useState<ItemEffect | 'All'>('All');

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
                    if (currentDrag.sourceMachineId !== null && !currentDrag.item.isLocked) {
                        machinesRef.current[currentDrag.sourceMachineId]?.remove(currentDrag.item.id);
                    }
                } else {
                    const machine = machinesRef.current[currentTarget.machineId];

                    if (currentDrag.item.isLocked && currentDrag.sourceMachineId !== currentTarget.machineId) {
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

    const handleToggleInfiniteNodes = useCallback((isInfinite: boolean) => {
        setInventory(prev => prev.map(invItem =>
            invItem.shape === 'Node1x2' ? { ...invItem, isInfinite } : invItem
        ));
    }, []);

    const handleToggleLock = useCallback((itemId: string, isLocked: boolean) => {
        setInventory(prev => prev.map(i => i.id === itemId ? { ...i, isLocked } : i));
    }, []);

    const getMaxCustomValue = (item: InventoryItem, effectIndex: number, newEffect?: ItemEffect) => {
        const base = getBaseStats(item);
        let maxPositiveBase = Math.max(
            base.Performance > 0 ? base.Performance : 0,
            base.Quality > 0 ? base.Quality : 0,
            base.Efficiency > 0 ? base.Efficiency : 0
        );

        const effectToEval = newEffect || item.effects[effectIndex];

        if (effectToEval === 'Learning Algorithm') {
            if (effectIndex === 1) {
                const first = item.effects[0];
                if (first === 'Premium') maxPositiveBase *= 1.2;
                else if (first === 'Inferior') maxPositiveBase *= 0.8;
                else if (first === 'Overcharged') maxPositiveBase *= 2.0;
                else if (first === 'Negative Feedback') maxPositiveBase *= 1.25;
            }
            return Math.floor(maxPositiveBase * 2);
        } else if (effectToEval === 'Degrading') {
            const otherEffect = effectIndex === 0 ? item.effects[1] : item.effects[0];
            if (otherEffect === 'Premium') maxPositiveBase *= 1.2;
            else if (otherEffect === 'Inferior') maxPositiveBase *= 0.8;
            else if (otherEffect === 'Overcharged') maxPositiveBase *= 2.0;
            else if (otherEffect === 'Negative Feedback') maxPositiveBase *= 1.25;

            return Math.floor(maxPositiveBase * 2);
        }
        return Math.floor(maxPositiveBase * 2);
    };

    const handleUpdateItemEffect = useCallback((item: InventoryItem, effectIndex: 0 | 1, newEffect: ItemEffect) => {
        setInventory(prev => prev.map(invItem => {
            if (invItem.id === item.id) {
                const updatedEffects: [ItemEffect, ItemEffect] = [...invItem.effects] as [ItemEffect, ItemEffect];
                updatedEffects[effectIndex] = newEffect;

                const updatedValues: [number, number] = [...invItem.effectValues] as [number, number];

                if (newEffect === 'Learning Algorithm' || newEffect === 'Degrading') {
                    const tempItem = { ...invItem, effects: updatedEffects };
                    updatedValues[effectIndex] = getMaxCustomValue(tempItem, effectIndex);
                }

                const otherIndex = effectIndex === 0 ? 1 : 0;
                const otherEffect = updatedEffects[otherIndex];
                if (otherEffect === 'Learning Algorithm' || otherEffect === 'Degrading') {
                    const tempItem = { ...invItem, effects: updatedEffects };
                    const maxOther = getMaxCustomValue(tempItem, otherIndex);
                    if (updatedValues[otherIndex] > maxOther) {
                        updatedValues[otherIndex] = maxOther;
                    }
                }

                return { ...invItem, effects: updatedEffects, effectValues: updatedValues };
            }
            return invItem;
        }));
    }, []);

    const handleUpdateItemEffectValue = useCallback((itemId: string, effectIndex: 0 | 1, newValue: number) => {
        setInventory(prev => prev.map(item => {
            if (item.id === itemId) {
                const updatedValues: [number, number] = [...item.effectValues] as [number, number];
                updatedValues[effectIndex] = Math.floor(newValue);
                return { ...item, effectValues: updatedValues };
            }
            return item;
        }));
    }, []);

    const handleBlurEffectValue = useCallback((item: InventoryItem, effectIndex: 0 | 1, rawValue: number) => {
        const maxLimit = getMaxCustomValue(item, effectIndex);
        const minLimit = 0;

        const val = isNaN(rawValue) ? minLimit : Math.floor(rawValue);
        const clampedValue = Math.max(minLimit, Math.min(maxLimit, val));

        setInventory(prev => prev.map(invItem => {
            if (invItem.id === item.id) {
                const updatedValues: [number, number] = [...invItem.effectValues] as [number, number];
                updatedValues[effectIndex] = clampedValue;
                return { ...invItem, effectValues: updatedValues };
            }
            return invItem;
        }));
    }, []);

    const handleRemoveItem = useCallback((itemId: string) => {
        setInventory(prev => prev.filter(i => i.id !== itemId));
        Object.values(machinesRef.current).forEach((m: any) => m?.remove(itemId));
    }, []);

    const handleInventoryDragStart = useCallback((e: React.MouseEvent, item: InventoryItem) => {
        if (isAnySolving || item.isLocked) { e.preventDefault(); return; }
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

    const allUsedItems = getUsedItems(null);

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

    const unusedModules = useMemo(() => {
        const used = getUsedItems(null);
        const groupOrder: Record<string, number> = { Red: 0, Yellow: 1, Green: 2, Purple: 3, DarkRed: 4, Grey: 5, White: 6 };
        const size = (item: InventoryItem) => PRECOMPUTED_OFFSETS.get(item.shape)?.[0]?.length ?? 0;
        return inventory
            .filter(item => !used.has(item.id) && !(item.isInfinite && [...used].some(id => id.startsWith(item.id + '_clone_'))))
            .sort((a, b) => (groupOrder[a.color] ?? 9) - (groupOrder[b.color] ?? 9) || size(b) - size(a) || a.displayName.localeCompare(b.displayName));
    }, [inventory, boardVersion, machines, getUsedItems]);
    /* Store / Retrieve: bank the unused modules in the machines' empty cells (the game keeps them there like any storage), and take
     * them back out. A module is only stored where it lowers none of that machine's stats that do something, largest first, machines in card
     * order, locked machines skipped. The stored ids are remembered so Retrieve takes out exactly those; a new solve forgets them
     */
    const [storedIds, setStoredIds] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('optimizer_stored_ids') || '[]'); } catch { return []; }
    });
    useEffect(() => {
        try { localStorage.setItem('optimizer_stored_ids', JSON.stringify(storedIds)); } catch { /* storage unavailable */ }
    }, [storedIds]);
    useEffect(() => { if (isAnySolving) setStoredIds([]); }, [isAnySolving]);
    const [storeNote, setStoreNote] = useState<string | null>(null);
    const handleStore = () => {
        const byId = indexInventoryById(expandedInventory);
        const statsOf = (board: any[][]) => calculateBoardStats(board, expandedInventory, byId).totals;
        const cards = machines.map(({ id }) => machinesRef.current[id]).filter(m => m && !m.isLocked());
        const stored: string[] = [];
        const candidates = unusedModules.filter(item => !item.isInfinite);
        for (const item of candidates) {
            const orientations = PRECOMPUTED_OFFSETS.get(item.shape);
            if (!orientations) continue;
            let placed = false;
            for (const card of cards) {
                const board: any[][] = card.getBoard();
                // Every stat that does something on this machine counts, Off or not: an Off Efficiency still costs energy in the game
                const type = card.getState().machineType;
                const before = statsOf(board);
                for (let y = 0; y < 5 && !placed; y++) {
                    for (let x = 0; x < 7 && !placed; x++) {
                        for (const offsets of orientations) {
                            if (!card.isValidPlacement(item, x, y, offsets)) continue;
                            const next = board.map(row => [...row]);
                            for (const pt of offsets) next[y + pt.y][x + pt.x] = item;
                            const after = statsOf(next);
                            const harmless = (['Performance', 'Quality', 'Efficiency'] as const).every(k => statHasNoEffect(type, k) || after[k] >= before[k]);
                            if (!harmless) continue;
                            card.place(item, x, y, offsets);
                            placed = true;
                            break;
                        }
                    }
                }
                if (placed) break;
            }
            if (placed) stored.push(item.id);
        }
        setStoredIds(stored);
        const left = candidates.length - stored.length;
        setStoreNote(stored.length === 0 ? 'No free spot takes a module without lowering a machine\'s stats'
            : left > 0 ? `${left} module${left === 1 ? '' : 's'} had no free spot that leaves the machine's stats as they are` : null);
    };
    const handleRetrieve = () => {
        for (const id of storedIds) Object.values(machinesRef.current).forEach((m: any) => m?.remove(id));
        setStoredIds([]);
        setStoreNote(null);
    };
    const filteredInventory = inventory.filter(item => {
        if (invFilterGroup === 'Placed') {
            const isPlaced = allUsedItems.has(item.id) || (item.isInfinite && Array.from(allUsedItems).some(usedId => usedId.startsWith(item.id + '_clone_')));
            if (!isPlaced) return false;
        } else if (invFilterGroup === 'NotPlaced') {
            const isPlaced = allUsedItems.has(item.id) || (item.isInfinite && Array.from(allUsedItems).some(usedId => usedId.startsWith(item.id + '_clone_')));
            if (isPlaced) return false;
        } else if (invFilterGroup !== 'All') {
            const template = MODULE_TEMPLATES.find(m => m.shape === item.shape && m.color === item.color);
            const group = template ? template.group : 'All';
            if (group !== invFilterGroup) return false;
        }
        if (invFilterSize !== 'All') {
            const offsets = PRECOMPUTED_OFFSETS.get(item.shape)?.[0];
            const size = offsets ? offsets.length : 0;
            if (size !== invFilterSize) return false;
        }
        if (invFilterEffect !== 'All') {
            if (invFilterEffect === 'None') {
                if (item.effects[0] !== 'None' || item.effects[1] !== 'None') return false;
            } else {
                if (item.effects[0] !== invFilterEffect && item.effects[1] !== invFilterEffect) return false;
            }
        }
        return true;
    });

    const visibleInventory = filteredInventory.length > MAX_VISIBLE_INVENTORY_ROWS
        ? filteredInventory.slice(0, MAX_VISIBLE_INVENTORY_ROWS)
        : filteredInventory;
    const hiddenInventoryCount = filteredInventory.length - visibleInventory.length;

    const allDisplayedLocked = filteredInventory.length > 0 && filteredInventory.every(item => item.isLocked);

    const handleToggleDisplayLock = () => {
        const targetState = !allDisplayedLocked;
        const filteredIds = new Set(filteredInventory.map(i => i.id));

        setInventory(prev => prev.map(item =>
            filteredIds.has(item.id) ? { ...item, isLocked: targetState } : item
        ));
    };

    const handleImportSave = useCallback((newItems: InventoryItem[], newMachines: { id: string, boardIds: (string | null)[][], machineType: string, tier: GridTier }[]) => {
        setInventory(newItems);

        newMachines.forEach(m => {
            // Each imported machine starts with the stats that matter for its type switched on
            const ignoreStats = defaultIgnoreStats(m.machineType);
            localStorage.setItem(`optimizer_machine_${m.id}`, JSON.stringify({ boardIds: m.boardIds, tier: m.tier, ignoreStats, maximizeStats: defaultMaximizeStats(ignoreStats) }));
            localStorage.setItem(`optimizer_machine_type_${m.id}`, m.machineType);
        });

        setMachines(prev => {
            prev.forEach(m => {
                localStorage.removeItem(`optimizer_machine_${m.id}`);
                localStorage.removeItem(`optimizer_machine_type_${m.id}`);
                localStorage.removeItem(`optimizer_machine_locked_${m.id}`);
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

    const handleRunAll = async () => {
        if (isAnySolving) {
            stopAll();
            return;
        }
        const active = machines.filter(m => {
            const ref = machinesRef.current[m.id];
            return ref && !ref.isLocked();
        });
        if (active.length === 0) return;

        // Modules on locked machines stay where they are
        const activeIds = new Set(active.map(m => m.id));
        const heldByLocked = new Set<string>();
        machines.forEach(m => {
            if (activeIds.has(m.id)) return;
            const board = machinesRef.current[m.id]?.getBoard();
            board?.forEach((row: any[]) => row.forEach(cell => { if (cell && cell !== 'Locked') heldByLocked.add(cell.id); }));
        });
        const engineInventory = expandedInventory.map(item => heldByLocked.has(item.id) ? { ...item, isLocked: true } : item);

        const configs = active.map((m, rank) => {
            const state = machinesRef.current[m.id].getState();
            const priority = rank + 1;
            return {
                id: m.id,
                tier: state.tier,
                targetStats: state.targetStats,
                maximizeStats: state.maximizeStats,
                ignoreStats: state.ignoreStats,
                statPriority: { Performance: priority, Quality: priority, Efficiency: priority },
                targetSteps: state.targetSteps,
                sumPQ: state.sumPQ,
                water: state.water,
                worthlessBelowSteps: state.worthlessBelowSteps
            };
        });
        const boards = active.map(m => machinesRef.current[m.id].getBoard());

        jointRunRef.current = { current: true };
        active.forEach(m => handleSolvingChange(m.id, true));
        try {
            await runParallelEngine(configs, boards, engineInventory, expandedInventory, jointRunRef.current, (updates) => {
                updates.forEach((update, id) => {
                    machinesRef.current[id]?.applyUpdate(update.board, update.totals, update.pieceStats, update.code);
                });
            });
        } finally {
            jointRunRef.current.current = false;
            active.forEach(m => handleSolvingChange(m.id, false));
        }
    };

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
                localStorage.removeItem(`optimizer_machine_locked_${m.id}`);
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
        localStorage.removeItem(`optimizer_machine_locked_${machineId}`);
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
                    padding: 20px;
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

                    {hoveredItem.originalPath && (
                        <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #333', fontSize: '0.75em', color: '#888', wordBreak: 'break-word', maxWidth: '250px' }}>
                            <span style={{ color: '#aaa' }}>Path: </span>{hoveredItem.originalPath}
                        </div>
                    )}
                </div>
            )}

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '10px', marginBottom: '34px', width: '100%', flexWrap: 'wrap' }}>
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
                <SaveFileImporter onImport={handleImportSave} />
                <button
                    onClick={handleClearAllMachines}
                    disabled={isAnySolving}
                    style={{ padding: '10px 24px', backgroundColor: 'rgba(255, 77, 77, 0.1)', color: '#ff4d4d', border: '1px solid #ff4d4d', borderRadius: '6px', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.95em' }}
                >
                    Delete All
                </button>
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
                            onStopAll={stopAll}
                        />
                      </div>
                    </div>
                ))}
            </div>

            {/* Unused Module Storage & Inventory */}
            <div className="bottom-layout">
                {/* Unused Module Storage */}
                <div style={{ flex: '2', backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '8px', border: '1px solid #2c2c2e', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '15px', paddingBottom: '12px', borderBottom: '1px solid #333' }}>
                        <span style={{ color: '#eee', fontWeight: 'bold', fontSize: '1em' }}>Unused Module Storage</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                            <span style={{ color: '#888', fontSize: '0.85em' }}>
                                {unusedModules.length} of {inventory.length} module{inventory.length === 1 ? '' : 's'}
                            </span>
                            <button
                                onClick={storedIds.length > 0 ? handleRetrieve : handleStore}
                                disabled={isAnySolving || (storedIds.length === 0 && unusedModules.every(item => item.isInfinite))}
                                title={storedIds.length > 0
                                    ? `Take the ${storedIds.length} stored module${storedIds.length === 1 ? '' : 's'} back out of the machines`
                                    : 'Put unused modules into free machine cells, only where they lower none of that machine\'s stats (energy included)'}
                                style={{
                                    background: storedIds.length > 0 ? '#333' : 'transparent', border: '1px solid #555', borderRadius: '6px',
                                    color: '#aaa', cursor: isAnySolving ? 'not-allowed' : 'pointer', fontSize: '0.75em', padding: '4px 10px', fontWeight: 'bold'
                                }}
                            >
                                {storedIds.length > 0 ? 'Retrieve' : 'Store'}
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
                                const canDrag = !isAnySolving && !item.isLocked;
                                return (
                                    <div
                                        key={item.id}
                                        className="catalog-card"
                                        onMouseDown={(e) => { if (canDrag) handleInventoryDragStart(e, item); }}
                                        title={[item.displayName, effects, item.originalPath ? `In game: ${item.originalPath}` : null, canDrag ? 'Drag onto a machine to place it' : null].filter(Boolean).join('\n')}
                                        style={{
                                            padding: '14px 10px', width: '135px', backgroundColor: '#252526',
                                            border: `1px solid ${COLOR_MAP[item.color as ModuleColor]}`, borderRadius: '6px',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                                            cursor: canDrag ? 'grab' : 'default', opacity: item.isLocked ? 0.6 : 1, userSelect: 'none'
                                        }}
                                    >
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

                {/* Inventory */}
                <div
                    style={{ flex: '1', backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '8px', border: '1px solid #2c2c2e', display: 'flex', flexDirection: 'column' }}
                    onMouseMove={() => {
                        if (dragState && dragState.sourceMachineId !== null) {
                            setDragTargetRefChange({ machineId: null, x: -1, y: -1 });
                        }
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center' }}>
                        <span style={{ color: '#888', fontSize: '0.9em' }}>
                            {filteredInventory.length.toLocaleString()} Selected
                            {hiddenInventoryCount > 0 && <span style={{ color: '#666' }}> (showing {MAX_VISIBLE_INVENTORY_ROWS})</span>}
                        </span>
                        <button
                            onClick={() => { setInventory([]); handleClearAll(); }}
                            disabled={isAnySolving || inventory.length === 0}
                            style={{
                                background: 'none', border: 'none', color: (isAnySolving || inventory.length === 0) ? '#555' : '#ff4d4d',
                                cursor: (isAnySolving || inventory.length === 0) ? 'not-allowed' : 'pointer',
                                fontSize: '0.85em', textDecoration: 'underline'
                            }}
                        >
                            Clear List
                        </button>
                    </div>

                    {/* Inventory Filters */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        <select value={invFilterGroup} onChange={(e) => setInvFilterGroup(e.target.value as FilterGroup | 'Placed' | 'NotPlaced')} style={{ flex: 1, minWidth: '110px', padding: '6px', backgroundColor: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px', outline: 'none', fontSize: '0.8em' }}>
                            <option value="All">All Groups</option>
                            <option value="Placed">Placed in Machine</option>
                            <option value="NotPlaced">Not Placed in Machine</option>
                            <option value="Performance">Performance</option>
                            <option value="Quality">Quality</option>
                            <option value="Efficiency">Efficiency</option>
                            <option value="Special">Special</option>
                        </select>
                        <select value={invFilterSize} onChange={(e) => setInvFilterSize(e.target.value === 'All' ? 'All' : Number(e.target.value) as any)} style={{ flex: 1, minWidth: '100px', padding: '6px', backgroundColor: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px', outline: 'none', fontSize: '0.8em' }}>
                            <option value="All">All Sizes</option>
                            <option value={3}>Size 3</option>
                            <option value={4}>Size 4</option>
                            <option value={5}>Size 5</option>
                        </select>
                        <select value={invFilterEffect} onChange={(e) => setInvFilterEffect(e.target.value as ItemEffect | 'All')} style={{ flex: 1, minWidth: '120px', padding: '6px', backgroundColor: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px', outline: 'none', fontSize: '0.8em' }}>
                            <option value="All">All Effects</option>
                            {EFFECTS_LIST.map(eff => <option key={eff} value={eff}>{eff === 'None' ? 'No Effect' : eff}</option>)}
                        </select>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                        <button onClick={handleToggleDisplayLock} disabled={isAnySolving || filteredInventory.length === 0} style={{ flex: 1, padding: '6px', backgroundColor: '#2d2d2d', color: '#eee', border: '1px solid #444', borderRadius: '4px', fontSize: '0.8em', cursor: (isAnySolving || filteredInventory.length === 0) ? 'not-allowed' : 'pointer' }}>
                            {allDisplayedLocked ? 'Unlock Displayed' : 'Lock Displayed'}
                        </button>
                    </div>

                    <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '5px' }}>
                        {visibleInventory.map((item) => (
                            <InventoryItemRow
                                key={item.id}
                                item={item}
                                isAnySolving={isAnySolving}
                                updateItemEffect={handleUpdateItemEffect}
                                updateItemEffectValue={handleUpdateItemEffectValue}
                                handleBlurEffectValue={handleBlurEffectValue}
                                onRemove={handleRemoveItem}
                                onDragStart={handleInventoryDragStart}
                                onToggleInfinite={handleToggleInfiniteNodes}
                                onToggleLock={handleToggleLock}
                            />
                        ))}

                        {hiddenInventoryCount > 0 && (
                            <div style={{ padding: '10px 12px', backgroundColor: '#252526', borderRadius: '4px', color: '#888', fontSize: '0.8em', textAlign: 'center' }}>
                                + {hiddenInventoryCount.toLocaleString()} more not shown.
                                <br />
                                The optimizer still uses every module — only this list is capped.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <DragGhost dragState={dragState} cellSize={cellSize} />
        </div>
    );
}