import { useState, useRef, useEffect } from 'react';
import type {GridTier, InventoryItem, Stats, TargetStats, Point, ModuleShape, ModuleColor, ItemEffect} from '../types';
import type { Orientation } from '../utils';
import { getBaseStats, applyInternalEffects, PRECOMPUTED_ORIENTATIONS, roundStat } from '../utils';
import { MODULE_TEMPLATES } from '../constants';
import { runParallelEngine } from '../solver/parallel';


const SHAPE_MAP: ModuleShape[] = ['Node1x2', 'L3', 'L4_Base', 'T4_Base', 'Square4_Base', 'L4_High', 'T4_High', 'Square4_High', 'P5', 'C5', 'Line4'];
const COLOR_MAP_KEYS: ModuleColor[] = ['White', 'Red', 'Yellow', 'Green', 'Purple', 'DarkRed', 'Grey'];
const EFFECT_MAP: ItemEffect[] = ['None', 'Premium', 'Inferior', 'Overcharged', 'Degrading', 'Negative Feedback', 'Receiver', 'Side Mount', 'Top Mount', 'Learning Algorithm'];

const BASE85_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

function encodeBase85(bytes: Uint8Array): string {
    let num = 1n;
    for (let i = 0; i < bytes.length; i++) {
        num = (num << 8n) | BigInt(bytes[i]);
    }
    let str = "";
    while (num > 0n) {
        str = BASE85_ALPHABET[Number(num % 85n)] + str;
        num /= 85n;
    }
    return str;
}

function decodeBase85(str: string): Uint8Array {
    str = str.trim();
    let num = 0n;
    for (let i = 0; i < str.length; i++) {
        const val = BASE85_ALPHABET.indexOf(str[i]);
        if (val === -1) throw new Error("Invalid base85 character");
        num = (num * 85n) + BigInt(val);
    }
    let hex = num.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes.slice(1);
}

class BitWriter {
    bytes: number[] = [];
    currentByte = 0;
    bitPos = 0;

    write(value: number, numBits: number) {
        for (let i = numBits - 1; i >= 0; i--) {
            const bit = (value >> i) & 1;
            this.currentByte = (this.currentByte << 1) | bit;
            this.bitPos++;
            if (this.bitPos === 8) {
                this.bytes.push(this.currentByte);
                this.currentByte = 0;
                this.bitPos = 0;
            }
        }
    }

    toBase85(): string {
        if (this.bitPos > 0) {
            this.bytes.push(this.currentByte << (8 - this.bitPos));
        }
        return encodeBase85(new Uint8Array(this.bytes));
    }
}

class BitReader {
    bytes: Uint8Array;
    bytePos = 0;
    bitPos = 7;

    constructor(base85: string) {
        this.bytes = decodeBase85(base85);
    }

    read(numBits: number): number {
        let value = 0;
        for (let i = 0; i < numBits; i++) {
            if (this.bytePos >= this.bytes.length) throw new Error("EOF");
            const bit = (this.bytes[this.bytePos] >> this.bitPos) & 1;
            value = (value << 1) | bit;
            this.bitPos--;
            if (this.bitPos < 0) {
                this.bitPos = 7;
                this.bytePos++;
            }
        }
        return value;
    }
}

// effects is a fixed 2-slot tuple
// counting it directly avoids the closure + intermediate array that Array.prototype.filter allocates on every call.
const countEffect = (item: InventoryItem, effect: ItemEffect) => {
    let n = 0;
    if (item.effects[0] === effect) n++;
    if (item.effects[1] === effect) n++;
    return n;
};

// The code format stores the module count in 8 bits,
// so a larger inventory would encode a wrapped count and produce a code that decodes into something else entirely
// Emit nothing rather than something corrupt.
export const MAX_ENCODABLE_MODULES = 255;

export const generateCodeFromState = (
    currentTier: GridTier,
    maxStats: { Performance: boolean, Quality: boolean, Efficiency: boolean },
    tarStats: TargetStats,
    inv: InventoryItem[],
    brd: (InventoryItem | 'Locked' | null)[][]
) => {
    if (inv.length > MAX_ENCODABLE_MODULES) return '';

    const writer = new BitWriter();

    writer.write(currentTier, 2);

    writer.write(maxStats.Performance ? 1 : 0, 1);
    writer.write(maxStats.Quality ? 1 : 0, 1);
    writer.write(maxStats.Efficiency ? 1 : 0, 1);

    const writeTarget = (val: number | null) => {
        if (val === null) {
            writer.write(0, 1);
        } else {
            writer.write(1, 1);
            writer.write(val + 2048, 12);
        }
    };
    writeTarget(tarStats.Performance);
    writeTarget(tarStats.Quality);
    writeTarget(tarStats.Efficiency);

    writer.write(inv.length, 8);

    const placedItemsMap = new Map<string, number[]>();
    brd.forEach((row, y) => row.forEach((cell, x) => {
        if (cell && cell !== 'Locked') {
            if (!placedItemsMap.has(cell.id)) {
                placedItemsMap.set(cell.id, []);
            }
            placedItemsMap.get(cell.id)!.push(y * 7 + x);
        }
    }));

    inv.forEach(item => {
        writer.write(SHAPE_MAP.indexOf(item.shape), 4);
        writer.write(COLOR_MAP_KEYS.indexOf(item.color), 3);

        const positions = placedItemsMap.get(item.id) || [];
        writer.write(positions.length, 3);
        positions.forEach(p => writer.write(p, 6));

        item.effects.forEach((eff, idx) => {
            if (eff === 'None') {
                writer.write(0, 1);
            } else {
                writer.write(1, 1);
                writer.write(EFFECT_MAP.indexOf(eff), 4);

                if (eff === 'Learning Algorithm' || eff === 'Degrading') {
                    writer.write(1, 1);
                    writer.write(item.effectValues[idx] + 2048, 12);
                } else {
                    writer.write(0, 1);
                }
            }
        });
    });

    return writer.toBase85();
};

export function initializeBoard(currentTier: GridTier, initialIds?: (string | 'Locked' | null)[][], inventory?: InventoryItem[]) {
    const grid = Array.from({ length: 5 }, () => Array.from({ length: 7 }, () => null as any));
    if (currentTier === 1 || currentTier === 2) {
        grid[0][0] = grid[0][6] = grid[4][0] = grid[4][6] = 'Locked';
    }
    if (currentTier === 1) {
        grid[1][3] = grid[2][2] = grid[2][3] = grid[2][4] = grid[3][3] = 'Locked';
    }

    if (initialIds && inventory) {
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 7; x++) {
                if (grid[y][x] === 'Locked') continue;
                const cellId = initialIds[y][x];
                if (cellId && cellId !== 'Locked') {
                    const item = inventory.find(i => i.id === cellId);
                    if (item) grid[y][x] = item;
                }
            }
        }
    }
    return grid;
}

const NEIGHBOR_DX = [0, 0, -1, 1];
const NEIGHBOR_DY = [-1, 1, 0, 0];

interface PlacedPiece {
    item: InventoryItem;
    minX: number;
    minY: number;
    cells: number[];
    adjNodes: number;
}

export const indexInventoryById = (inventory: InventoryItem[]) => {
    const byId = new Map<string, InventoryItem>();
    for (const item of inventory) byId.set(item.id, item);
    return byId;
};

// `inventoryById` is only an optimisation:
// building it costs one pass over the whole inventory,
// which the solver would otherwise repeat on every iteration even though a board never holds more than 35 cells
// Callers that already have it should pass it
export const calculateBoardStats = (
    currentBoard: (InventoryItem | 'Locked' | null)[][],
    currentInventory: InventoryItem[],
    inventoryById?: Map<string, InventoryItem>,
    // Each item's own stats after its effects, when the caller already has them (the solver does, for every item)
    precomputed?: Map<string, Stats>
) => {
    const totals: Stats = { Performance: 0, Quality: 0, Efficiency: 0 };
    const pieceStats = new Map<string, Stats>();
    let coveredNodeSides = 0;
    let negativeContactCount = 0;
    let placedPiecesCount = 0;
    let placedAlarmsCount = 0;
    let placedJunkCount = 0;
    let placedBlastCount = 0;

    const invById = inventoryById ?? indexInventoryById(currentInventory);

    // applyInternalEffects is pure per item but was recomputed for every adjacency test; memoise it for the duration of the call
    const internalCache = new Map<string, Stats>();
    const internalOf = (item: InventoryItem): Stats => {
        let cached = precomputed?.get(item.id) ?? internalCache.get(item.id);
        if (cached === undefined) {
            cached = applyInternalEffects(item);
            internalCache.set(item.id, cached);
        }
        return cached;
    };

    const placedPieces = new Map<string, PlacedPiece>();
    const nodeAdjacencies = new Map<string, Set<string>>();
    const gridItems: (InventoryItem | null)[] = new Array(35).fill(null);

    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) {
            const boardCell = currentBoard[y][x];
            if (boardCell && boardCell !== 'Locked') {
                const cell = invById.get(boardCell.id) || boardCell;
                const idx = y * 7 + x;
                gridItems[idx] = cell;

                const existing = placedPieces.get(cell.id);
                if (existing === undefined) {
                    placedPieces.set(cell.id, { item: cell, minX: x, minY: y, cells: [idx], adjNodes: 0 });
                    placedPiecesCount++;
                } else {
                    if (x < existing.minX) existing.minX = x;
                    if (y < existing.minY) existing.minY = y;
                    existing.cells.push(idx);
                }
            }
        }
    }

    for (const { item, cells } of placedPieces.values()) {
        if (item.color !== 'White') continue;

        let adjSet = nodeAdjacencies.get(item.id);
        if (adjSet === undefined) {
            adjSet = new Set<string>();
            nodeAdjacencies.set(item.id, adjSet);
        }

        for (const idx of cells) {
            const x = idx % 7;
            const y = (idx - x) / 7;
            for (let d = 0; d < 4; d++) {
                const nx = x + NEIGHBOR_DX[d];
                const ny = y + NEIGHBOR_DY[d];
                if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) continue;

                const adj = gridItems[ny * 7 + nx];
                if (adj === null || adj.color === 'White') continue;

                if (!adjSet.has(adj.id)) {
                    adjSet.add(adj.id);
                    const adjPiece = placedPieces.get(adj.id);
                    if (adjPiece !== undefined) adjPiece.adjNodes++;
                }
                coveredNodeSides++;

                const adjModified = internalOf(adj);
                const ap = roundStat(adjModified.Performance);
                const aq = roundStat(adjModified.Quality);
                const ae = roundStat(adjModified.Efficiency);
                if (ap <= 0 && aq <= 0 && ae <= 0 && (ap < 0 || aq < 0 || ae < 0)) {
                    negativeContactCount++;
                }
            }
        }
    }

    const internalStats = new Map<string, Stats>();
    const absorptionStats = new Map<string, Stats>();
    for (const { item, cells } of placedPieces.values()) {
        if (isAlarmModule(item)) placedAlarmsCount++;
        if (isJunkModule(item)) placedJunkCount++;
        if (isBlastModule(item)) placedBlastCount++;

        if (item.color === 'White') continue;

        const base = internalOf(item);
        let p = base.Performance, q = base.Quality, e = base.Efficiency;
        let absorbP = 0, absorbQ = 0, absorbE = 0;

        const nfCount = countEffect(item, 'Negative Feedback');
        if (nfCount > 0) {
            let nfPerf = 0, nfQual = 0, nfEff = 0;
            const counted = new Set<string>();

            for (const idx of cells) {
                const x = idx % 7;
                const y = (idx - x) / 7;
                for (let d = 0; d < 4; d++) {
                    const nx = x + NEIGHBOR_DX[d];
                    const ny = y + NEIGHBOR_DY[d];
                    if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) continue;

                    const neighbor = gridItems[ny * 7 + nx];
                    if (neighbor === null || neighbor.id === item.id || neighbor.color === 'White') continue;
                    if (counted.has(neighbor.id)) continue;
                    counted.add(neighbor.id);

                    const neighborBase = internalOf(neighbor);
                    if (neighborBase.Performance < 0) nfPerf += neighborBase.Performance;
                    if (neighborBase.Quality < 0) nfQual += neighborBase.Quality;
                    if (neighborBase.Efficiency < 0) nfEff += neighborBase.Efficiency;
                }
            }

            absorbP = nfCount * 0.25 * nfPerf;
            absorbQ = nfCount * 0.25 * nfQual;
            absorbE = nfCount * 0.25 * nfEff;
        }

        internalStats.set(item.id, {
            Performance: p,
            Quality: q,
            Efficiency: e
        });

        absorptionStats.set(item.id, {
            Performance: absorbP,
            Quality: absorbQ,
            Efficiency: absorbE
        });
    }

    for (const { item, minX, minY, adjNodes } of placedPieces.values()) {
        if (item.color === 'White') continue;

        let { Performance: p, Quality: q, Efficiency: e } = internalStats.get(item.id)!;

        let pBonus = 0, qBonus = 0, eBonus = 0;
        if (minX === 0 && item.effects.includes('Side Mount')) {
            pBonus += roundStat(p * 0.20);
            qBonus += roundStat(q * 0.20);
            eBonus += roundStat(e * 0.20);
        }
        if (minY === 0 && item.effects.includes('Top Mount')) {
            pBonus += roundStat(p * 0.20);
            qBonus += roundStat(q * 0.20);
            eBonus += roundStat(e * 0.20);
        }
        if (item.effects.includes('Receiver')) {
            pBonus += roundStat(p * 0.10 * adjNodes);
            qBonus += roundStat(q * 0.10 * adjNodes);
            eBonus += roundStat(e * 0.10 * adjNodes);
        }

        p += pBonus;
        q += qBonus;
        e += eBonus;

        const absorb = absorptionStats.get(item.id)!;
        p += absorb.Performance;
        q += absorb.Quality;
        e += absorb.Efficiency;

        const finalStats = { Performance: roundStat(p), Quality: roundStat(q), Efficiency: roundStat(e) };

        pieceStats.set(item.id, finalStats);
        totals.Performance += finalStats.Performance;
        totals.Quality += finalStats.Quality;
        totals.Efficiency += finalStats.Efficiency;
    }

    nodeAdjacencies.forEach((adjIds, nodeId) => {
        let nodeP = 0, nodeQ = 0, nodeE = 0;

        adjIds.forEach(adjId => {
            const adjacentItemData = placedPieces.get(adjId);
            if (adjacentItemData) {
                const baseAdj = internalOf(adjacentItemData.item);
                nodeP += baseAdj.Performance;
                nodeQ += baseAdj.Quality;
                nodeE += baseAdj.Efficiency;
            }
        });

        const nodeStat = {
            Performance: roundStat(nodeP * 0.20),
            Quality: roundStat(nodeQ * 0.20),
            Efficiency: roundStat(nodeE * 0.20)
        };

        pieceStats.set(nodeId, nodeStat);
        totals.Performance += nodeStat.Performance;
        totals.Quality += nodeStat.Quality;
        totals.Efficiency += nodeStat.Efficiency;
    });

    return { totals, pieceStats, coveredNodeSides, negativeContactCount, placedPiecesCount, placedAlarmsCount, placedJunkCount, placedBlastCount };
};

// Per-piece values that do not change as the piece is slid across the board
// Hoisting them out of the placement scan keeps the inner loop free of Map lookups and of the temporary arrays that includes()/filter() would allocate for every candidate cell
export interface PlacementContext {
    piece: InventoryItem;
    internal: Stats;
    isWhite: boolean;
    hasSideMount: boolean;
    hasTopMount: boolean;
    hasReceiver: boolean;
    nfCount: number;
    isPureNegative: boolean;
    size: number;
}

export const buildPlacementContext = (piece: InventoryItem, precomputedInternal: Map<string, Stats>): PlacementContext => {
    const internal = precomputedInternal.get(piece.id)!;
    const { Performance: p, Quality: q, Efficiency: e } = internal;
    const orientations = PRECOMPUTED_ORIENTATIONS.get(piece.shape);

    return {
        piece,
        internal,
        isWhite: piece.color === 'White',
        hasSideMount: piece.effects.includes('Side Mount'),
        hasTopMount: piece.effects.includes('Top Mount'),
        hasReceiver: piece.effects.includes('Receiver'),
        nfCount: countEffect(piece, 'Negative Feedback'),
        isPureNegative: p <= 0 && q <= 0 && e <= 0 && (p < 0 || q < 0 || e < 0),
        size: orientations ? orientations[0].count : 0
    };
};

// Scratch buffer for the distinct neighbours of a candidate placement
// A piece covers at most 5 cells, so the neighbour count is small and bounded
// reusing one array keeps this function allocation-free, which matters because it is the solver's innermost loop
const NEIGHBOR_SCRATCH: InventoryItem[] = [];

// The stat change of the last placement evaluatePlacementDelta scored
// Only read right after the call that wrote it
const PLACEMENT_DELTA = { p: 0, q: 0, e: 0 };

export const evaluatePlacementDelta = (
    ctx: PlacementContext,
    x: number, y: number,
    orientation: Orientation,
    testBoard: (InventoryItem | 'Locked' | null)[][],
    isBoardEmpty: boolean,
    precomputedInternal: Map<string, Stats>,
    dynWp: number, dynWq: number, dynWe: number,
    currentP: number, currentQ: number, currentE: number,
    config: MachineConfig,
    // A placement that earns nothing is normally refused outright; this lets it through at zero instead (see OVERCLOCK_PLACEMENT_NUDGE)
    zeroScoreOk = false
) => {
    if (x + orientation.minX < 0 || x + orientation.maxX > 6 ||
        y + orientation.minY < 0 || y + orientation.maxY > 4) {
        return -Infinity;
    }

    const { xs, ys, count } = orientation;
    const { internal, isWhite, nfCount, isPureNegative } = ctx;

    let isConnected = false;
    let adjNodes = 0;
    let negativeContactCount = 0;
    let neighborCount = 0;

    for (let i = 0; i < count; i++) {
        const px = x + xs[i];
        const py = y + ys[i];

        if (testBoard[py][px] !== null) return -Infinity;
        if (px === 0 || px === 6 || py === 0 || py === 4) isConnected = true;

        for (let d = 0; d < 4; d++) {
            const nx = px + NEIGHBOR_DX[d];
            const ny = py + NEIGHBOR_DY[d];
            if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) continue;

            const adjCell = testBoard[ny][nx];
            if (!adjCell || adjCell === 'Locked') continue;

            isConnected = true;

            const adjIsWhite = adjCell.color === 'White';
            if (isWhite) {
                if (!adjIsWhite) {
                    const adjInt = precomputedInternal.get(adjCell.id);
                    if (adjInt !== undefined &&
                        adjInt.Performance <= 0 && adjInt.Quality <= 0 && adjInt.Efficiency <= 0 &&
                        (adjInt.Performance < 0 || adjInt.Quality < 0 || adjInt.Efficiency < 0)) {
                        negativeContactCount++;
                    }
                }
            } else if (isPureNegative && adjIsWhite) {
                negativeContactCount++;
            }

            let seen = false;
            for (let k = 0; k < neighborCount; k++) {
                if (NEIGHBOR_SCRATCH[k].id === adjCell.id) { seen = true; break; }
            }
            if (!seen) NEIGHBOR_SCRATCH[neighborCount++] = adjCell;
        }
    }

    if (!isConnected && !isBoardEmpty) return -10000;

    let pDelta = 0, qDelta = 0, eDelta = 0;
    let nfPerf = 0, nfQual = 0, nfEff = 0;

    for (let k = 0; k < neighborCount; k++) {
        const adjPiece = NEIGHBOR_SCRATCH[k];
        const adjInternal = precomputedInternal.get(adjPiece.id);
        if (adjInternal === undefined) continue;

        const adjIsWhite = adjPiece.color === 'White';
        if (!isWhite && adjIsWhite) {
            adjNodes++;
            pDelta += roundStat(internal.Performance * 0.20);
            qDelta += roundStat(internal.Quality * 0.20);
            eDelta += roundStat(internal.Efficiency * 0.20);
        } else if (isWhite && !adjIsWhite) {
            pDelta += roundStat(adjInternal.Performance * 0.20);
            qDelta += roundStat(adjInternal.Quality * 0.20);
            eDelta += roundStat(adjInternal.Efficiency * 0.20);
        }

        if (nfCount > 0 && !adjIsWhite) {
            if (adjInternal.Performance < 0) nfPerf += adjInternal.Performance;
            if (adjInternal.Quality < 0) nfQual += adjInternal.Quality;
            if (adjInternal.Efficiency < 0) nfEff += adjInternal.Efficiency;
        }
    }

    let myP = internal.Performance;
    let myQ = internal.Quality;
    let myE = internal.Efficiency;

    let pBonus = 0, qBonus = 0, eBonus = 0;
    if (ctx.hasSideMount && x + orientation.minX === 0) {
        pBonus += roundStat(myP * 0.20);
        qBonus += roundStat(myQ * 0.20);
        eBonus += roundStat(myE * 0.20);
    }
    if (ctx.hasTopMount && y + orientation.minY === 0) {
        pBonus += roundStat(myP * 0.20);
        qBonus += roundStat(myQ * 0.20);
        eBonus += roundStat(myE * 0.20);
    }
    if (ctx.hasReceiver) {
        pBonus += roundStat(myP * 0.10 * adjNodes);
        qBonus += roundStat(myQ * 0.10 * adjNodes);
        eBonus += roundStat(myE * 0.10 * adjNodes);
    }

    myP += pBonus;
    myQ += qBonus;
    myE += eBonus;

    if (nfCount > 0) {
        myP += nfCount * 0.25 * nfPerf;
        myQ += nfCount * 0.25 * nfQual;
        myE += nfCount * 0.25 * nfEff;
    }

    pDelta += roundStat(myP);
    qDelta += roundStat(myQ);
    eDelta += roundStat(myE);
    PLACEMENT_DELTA.p = pDelta; PLACEMENT_DELTA.q = qDelta; PLACEMENT_DELTA.e = eDelta;

    let statScore = 0;
    const scoreStat = (key: keyof Stats, delta: number, current: number, dynW: number) => {
        if (statIsIgnored(config, key)) return 0;
        if (delta === 0) return 0;

        const target = config.targetStats[key];
        const maximize = config.maximizeStats[key];

        if (target !== null && !maximize) {
            const before = current;
            const after = current + delta;

            if (before >= target && after >= target) return 0;
            if (before >= target && after < target) return delta * dynW * 100;
            if (before < target) {
                if (after <= target) return delta * dynW;
                else return (target - before) * dynW;
            }
        } else if (target !== null && maximize) {
            const before = current;
            const after = current + delta;
            if (before >= target) {
                return delta * dynW;
            } else {
                if (after <= target) return delta * dynW * 10;
                else return ((target - before) * dynW * 10) + ((after - target) * dynW);
            }
        } else if (maximize) {
            return delta * dynW;
        }
        return 0;
    };

    statScore += scoreStat('Performance', pDelta, currentP, dynWp);
    statScore += scoreStat('Quality', qDelta, currentQ, dynWq);
    statScore += scoreStat('Efficiency', eDelta, currentE, dynWe);

    const tiebreakers = (adjNodes * 0.05) - (negativeContactCount * 1000);
    if (statScore < 0 || (statScore === 0 && !zeroScoreOk)) return -10000 + tiebreakers;
    return statScore + tiebreakers;
};

export type MachineConfig = {
    id: string;
    tier: GridTier;
    targetStats: TargetStats;
    maximizeStats: any;
    ignoreStats?: Partial<Record<keyof Stats, boolean>>;
    // Rank per stat, 1 being the most important
    // Stats sharing a rank are traded off against each other exactly as they always were
    // A lower rank is only ever consulted once every higher one is tied, so a met high-priority target can never be dropped to meet a lower-priority one
    // Absent or all-equal means the single combined objective as before
    statPriority?: Partial<Record<keyof Stats, number>>;
    // The values where a stat actually changes something (water grades, ingot purity steps...), ascending
    // A target on such a stat is either reached or worth nothing, and can be relaxed one step when the set cannot reach it
    targetSteps?: Partial<Record<keyof Stats, number[]>>;
};

const STAT_KEYS: (keyof Stats)[] = ['Performance', 'Quality', 'Efficiency'];

// Alarm / Junk Processing / Blast modules exist for reasons the grid does not model
// On stats alone they are neutral at best and negative at worst, so a stat optimizer left to its own devices either ignores them or, worse, treats them as free filler
// Deciding how many of them a build should carry is a separate question from maximising stats, so the solver neither adds one nor takes one off a board
// Where they sit is still the solver's problem. A Blast module against a Node costs real stats, so a special already on a board is free to move around it
// The in-game names are "Alarm Transmitter Module", "Furnace Module (Junk Processing)" and "Furnace Module (Blast)".
// (Matching on "Alarm Module" / "Blast Module" never hit the real names, so the solver stripped those two out of
// their machines for their Efficiency cost.)
// What kind of module an item is never changes, but the checks are string searches and the solver asks millions of times
// So each item object is classified once
const KIND_ALARM = 1, KIND_JUNK = 2, KIND_BLAST = 4, KIND_OVERCLOCK = 8;
const kindCache = new WeakMap<InventoryItem, number>();
const kindOf = (item: InventoryItem) => {
    let kind = kindCache.get(item);
    if (kind === undefined) {
        const name = item.displayName;
        kind = (name.includes('Alarm Transmitter') ? KIND_ALARM : 0)
            | (name.includes('Junk Processing') ? KIND_JUNK : 0)
            | (name.includes('(Blast)') ? KIND_BLAST : 0)
            | (name.includes('Overclock') ? KIND_OVERCLOCK : 0);
        kindCache.set(item, kind);
    }
    return kind;
};
const isAlarmModule = (item: InventoryItem) => (kindOf(item) & KIND_ALARM) !== 0;
const isJunkModule = (item: InventoryItem) => (kindOf(item) & KIND_JUNK) !== 0;
const isBlastModule = (item: InventoryItem) => (kindOf(item) & KIND_BLAST) !== 0;

export const isSpecialModule = (item: InventoryItem) =>
    isAlarmModule(item) || isJunkModule(item) || isBlastModule(item);

// Overclocks are worth placing even where their Performance is not needed (a Learning Algorithm one only grows while it
// sits in a machine), so each placed one earns a little more in the tiebreak than the "fewer pieces" nudge costs
const isOverclock = (item: InventoryItem) => (kindOf(item) & KIND_OVERCLOCK) !== 0;

// An ignored stat is worth nothing to this machine in either direction
const statIsIgnored = (m: MachineConfig, key: keyof Stats) => Boolean(m.ignoreStats?.[key]);

// The solver's constants and the search itself are in solver/engine.ts; what stays here is shared with the UI and the pool builder

const statIsScored = (m: MachineConfig, key: keyof Stats) =>
    !statIsIgnored(m, key) && (Boolean(m.maximizeStats?.[key]) || m.targetStats[key] !== null);

// Effects whose value depends on where the module ends up (edge contact, adjacent nodes, adjacent negatives)
// Modules carrying different ones cannot be compared on their stats alone, so they are only ever compared against modules carrying the same ones
const PLACEMENT_DEPENDENT_EFFECTS: ItemEffect[] = ['Side Mount', 'Top Mount', 'Receiver', 'Negative Feedback'];

// A 35-cell board cannot hold more than 17 pieces (the 2-cell Node is the smallest),
// so this many candidates per group is always enough to build any layout.
const MAX_PIECES_PER_BOARD = 18;

const dominates = (a: number[], b: number[]) => {
    let strictlyBetter = false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) return false;
        if (a[i] > b[i]) strictlyBetter = true;
    }
    return strictlyBetter;
};

/* Drops modules the search can never benefit from trying.
 *
 * A module is only worth considering if no other module of the same shape is at least as good on every stat that actually scores
 * Swapping a dominated module for the one that dominates it occupies the same cells and scores at least as well,
 * so any layout using the dominated one is matched by a layout without it, and trying it only costs time
 *
 * Three things keep this from throwing away real options: modules are only compared within the same shape and the same placement-dependent effects,
 * stats no machine scores on are left out of the comparison entirely, and enough candidates are kept per group to fill every board,
 * so pruning can never make a layout unreachable for lack of copies
 * Nodes and Overclocks are never dropped, and the special modules are left out of the pool entirely
 * The pool is what the fill draws NEW modules from, and those are never the solver's to add
 */
export const buildSearchPool = (
    inventory: InventoryItem[],
    precomputedInternal: Map<string, Stats>,
    machines: MachineConfig[]
): InventoryItem[] => {
    const scoredKeys = STAT_KEYS.filter(key => machines.some(m => statIsScored(m, key)));

    if (scoredKeys.length === 0) return inventory.filter(item => !isSpecialModule(item) && !item.isLocked);

    const keepCap = machines.length * MAX_PIECES_PER_BOARD;
    const kept: InventoryItem[] = [];
    const groups = new Map<string, Map<string, InventoryItem[]>>();

    for (const item of inventory) {
        if (isSpecialModule(item)) continue;
        if (item.isLocked) continue;

        // Overclocks earn a tiebreak bonus of their own, so a stronger module of the same shape does not make them redundant
        if (item.color === 'White' || isOverclock(item)) {
            kept.push(item);
            continue;
        }

        const signature = PLACEMENT_DEPENDENT_EFFECTS.filter(eff => item.effects.includes(eff)).join('+');
        const groupKey = `${item.shape}|${signature}`;

        const stats = precomputedInternal.get(item.id)!;
        const tupleKey = scoredKeys.map(key => stats[key]).join(',');

        let group = groups.get(groupKey);
        if (group === undefined) {
            group = new Map<string, InventoryItem[]>();
            groups.set(groupKey, group);
        }
        const bucket = group.get(tupleKey);
        if (bucket === undefined) group.set(tupleKey, [item]);
        else bucket.push(item);
    }

    for (const group of groups.values()) {
        const tuples = [...group.keys()];
        const parsed = tuples.map(t => t.split(',').map(Number));

        const frontier: InventoryItem[] = [];
        const rest: InventoryItem[] = [];
        for (let i = 0; i < tuples.length; i++) {
            let isDominated = false;
            for (let j = 0; j < tuples.length && !isDominated; j++) {
                if (i !== j && dominates(parsed[j], parsed[i])) isDominated = true;
            }
            const items = group.get(tuples[i])!;
            if (isDominated) rest.push(...items);
            else frontier.push(...items);
        }

        // Keep the undominated candidates first; top up from the rest so a group never ends up with fewer modules than a board could actually use
        for (const item of frontier) kept.push(item);
        for (let i = 0; i < rest.length && frontier.length + i < keepCap; i++) kept.push(rest[i]);
    }

    return kept;
};

// The search itself lives in solver/engine.ts (typed boards); re-exported here for existing importers
export { runOptimizationEngine } from '../solver/engine';

export function useOptimizer(
    inventory: InventoryItem[],
    setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>,
    machineId: string,
    getUsedItems: (excludeId: string) => Set<string>,
    defaultTier: GridTier = 3,
    isExternallySolving: boolean = false
) {
    const getSavedState = () => {
        const saved = localStorage.getItem(`optimizer_machine_${machineId}`);
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { return null; }
        }
        return null;
    };

    const savedState = getSavedState();

    const [tier, setTier] = useState<GridTier>(() => {
        const saved = localStorage.getItem(`optimizer_machine_${machineId}`);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.tier && [1, 2, 3].includes(parsed.tier)) {
                    return parsed.tier as GridTier;
                }
            } catch (e) {
                console.error(e);
            }
        }
        return defaultTier;
    });

    const [targetStats, setTargetStats] = useState<TargetStats>(savedState?.targetStats ?? { Performance: null, Quality: null, Efficiency: null });
    // New machines start with Efficiency off (it only changes energy use); Import Save and picking a machine type
    // set per-type defaults on top of this (see machineDefaults.ts)
    const [maximizeStats, setMaximizeStats] = useState(savedState?.maximizeStats ?? { Performance: true, Quality: true, Efficiency: false });
    const [ignoreStats, setIgnoreStats] = useState(savedState?.ignoreStats ?? { Performance: false, Quality: false, Efficiency: true });
    const [statPriority, setStatPriority] = useState(savedState?.statPriority ?? { Performance: 1, Quality: 1, Efficiency: 1 });

    const [board, setBoard] = useState<(InventoryItem | 'Locked' | null)[][]>(() => initializeBoard(savedState?.tier ?? defaultTier, savedState?.boardIds, inventory));
    const boardRef = useRef(board);
    const setBoardSync = (newBoard: any) => {
        boardRef.current = newBoard;
        setBoard(newBoard);
    };

    const [isInitializedFromSave, setIsInitializedFromSave] = useState(false);

    useEffect(() => {
        if (!isInitializedFromSave && inventory.length > 0 && savedState?.boardIds) {
            const initialized = initializeBoard(tier, savedState.boardIds, inventory);
            setBoardSync(initialized);
            setIsInitializedFromSave(true);
        }
    }, [inventory, tier, savedState, isInitializedFromSave]);

    const [bestTotals, setBestTotals] = useState<Stats>({ Performance: 0, Quality: 0, Efficiency: 0 });
    const [bestPieceStats, setBestPieceStats] = useState<Map<string, Stats>>(new Map());

    const [isSolving, setIsSolving] = useState(false);
    const [warningMsg, setWarningMsg] = useState<string | null>(null);
    const [solutionCode, setSolutionCode] = useState<string>('');
    const isSolvingRef = useRef(false);

    const getAvailableInventory = () => {
        if (!getUsedItems || !machineId) return inventory.filter(i => !i.isLocked);
        const used = getUsedItems(machineId);
        return inventory.filter(item => !used.has(item.id) && !item.isLocked);
    };

    const getInventoryForCode = () => {
        return inventory;
    };

    const handleTierChange = (newTier: GridTier) => {
        setTier(newTier);
        setBoardSync(initializeBoard(newTier));
        setBestTotals({ Performance: 0, Quality: 0, Efficiency: 0 });
        setBestPieceStats(new Map());
        setWarningMsg(null);
        setSolutionCode('');
    };

    const resetBoard = () => {
        if (isSolving) {
            isSolvingRef.current = false;
            setIsSolving(false);
        }
        // Special modules (Alarm Transmitter, Blast, Junk Processing) belong to their machine, so clearing the board
        // leaves them where they are - the solver only ever moves them around within this board.
        const cleared = initializeBoard(tier);
        boardRef.current.forEach((row, y) => row.forEach((cell, x) => {
            if (cell && cell !== 'Locked' && isSpecialModule(cell) && cleared[y][x] !== 'Locked') cleared[y][x] = cell;
        }));
        setBoardSync(cleared);
        setBestTotals({ Performance: 0, Quality: 0, Efficiency: 0 });
        setBestPieceStats(new Map());
        setWarningMsg(null);
        // Clear maximize settings
        //setTargetStats({ Performance: null, Quality: null, Efficiency: null });
        //setMaximizeStats({ Performance: false, Quality: false, Efficiency: false });
        //setIgnoreStats({ Performance: false, Quality: false, Efficiency: false });
        //setStatPriority({ Performance: 1, Quality: 1, Efficiency: 1 });
        setSolutionCode('');
    };

    const stopOptimization = () => {
        isSolvingRef.current = false;
        setIsSolving(false);
    };

    const manuallyPlaceItem = (item: InventoryItem, rootX: number, rootY: number, offsets: Point[]) => {
        const next = boardRef.current.map(row => [...row]);
        let swapItemIds = new Set<string>();

        for (const pt of offsets) {
            const px = rootX + pt.x;
            const py = rootY + pt.y;
            if (px >= 0 && px < 7 && py >= 0 && py < 5) {
                const cell = next[py][px];
                if (cell && cell !== 'Locked' && cell.id !== item.id) {
                    if (cell.shape === item.shape) swapItemIds.add(cell.id);
                }
            }
        }

        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 7; x++) {
                const cell = next[y][x];
                if (cell && cell !== 'Locked') {
                    if (cell.id === item.id || swapItemIds.has(cell.id)) {
                        next[y][x] = null;
                    }
                }
            }
        }

        for (const pt of offsets) {
            const px = rootX + pt.x;
            const py = rootY + pt.y;
            if (px >= 0 && px < 7 && py >= 0 && py < 5) {
                next[py][px] = item;
            }
        }
        setBoardSync(next);
    };

    const manuallyRemoveItem = (itemId: string) => {
        const next = boardRef.current.map(row => [...row]);
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 7; x++) {
                const cell = next[y][x];
                if (cell && cell !== 'Locked' && cell.id === itemId) {
                    next[y][x] = null;
                }
            }
        }
        setBoardSync(next);
    };

    const isValidPlacement = (item: InventoryItem, rootX: number, rootY: number, offsets: Point[]) => {
        for (const pt of offsets) {
            const px = rootX + pt.x;
            const py = rootY + pt.y;
            if (px < 0 || px >= 7 || py < 0 || py >= 5) return false;
            const cell = boardRef.current[py][px];
            if (cell === 'Locked') return false;
            if (cell && cell.id !== item.id) return false;
        }
        return true;
    };

    const importSolution = (code: string) => {
        try {
            const reader = new BitReader(code);
            const decodedTier = reader.read(2) as GridTier;
            setTier(decodedTier);

            const maxP = reader.read(1) === 1;
            const maxQ = reader.read(1) === 1;
            const maxE = reader.read(1) === 1;
            setMaximizeStats({ Performance: maxP, Quality: maxQ, Efficiency: maxE });

            const readTarget = () => {
                const hasTarget = reader.read(1) === 1;
                return hasTarget ? reader.read(12) - 2048 : null;
            };

            setTargetStats({ Performance: readTarget(), Quality: readTarget(), Efficiency: readTarget() });

            const newInventory: InventoryItem[] = [];
            const newBoard: (InventoryItem | 'Locked' | null)[][] = initializeBoard(decodedTier);
            const numModules = reader.read(8);

            for (let i = 0; i < numModules; i++) {
                const shapeIdx = reader.read(4);
                const colorIdx = reader.read(3);
                const shape = SHAPE_MAP[shapeIdx];
                const color = COLOR_MAP_KEYS[colorIdx];

                const posCount = reader.read(3);
                const positions: number[] = [];
                for (let p = 0; p < posCount; p++) positions.push(reader.read(6));

                const template = shape === 'Node1x2' ? { displayName: 'Node' } : MODULE_TEMPLATES.find(m => m.shape === shape && m.color === color) || { displayName: 'Unknown Module' };
                const reconstructedEffects: [ItemEffect, ItemEffect] = ['None', 'None'];
                const base = getBaseStats({ shape, color, displayName: template.displayName } as any);
                const maxBaseValue = Math.max(Math.abs(base.Performance), Math.abs(base.Quality), Math.abs(base.Efficiency));
                const reconstructedValues: [number, number] = [maxBaseValue * 2, maxBaseValue * 2];

                for (let eIdx = 0; eIdx < 2; eIdx++) {
                    const hasEffect = reader.read(1) === 1;
                    if (hasEffect) {
                        const effIdx = reader.read(4);
                        const eff = EFFECT_MAP[effIdx];
                        reconstructedEffects[eIdx] = eff;

                        const hasValue = reader.read(1) === 1;
                        if ((eff === 'Learning Algorithm' || eff === 'Degrading') && hasValue) {
                            reconstructedValues[eIdx] = reader.read(12) - 2048;
                        }
                    }
                }

                const newItem: InventoryItem = { id: `${shape}_${color}_${Math.random().toString(36).substring(2, 8)}`, shape, color, displayName: template.displayName, effects: reconstructedEffects, effectValues: reconstructedValues };
                newInventory.push(newItem);
                positions.forEach((pos: number) => newBoard[Math.floor(pos / 7)][pos % 7] = newItem);
            }

            setInventory(newInventory);
            setBoardSync(newBoard);
            setSolutionCode(code);
            setWarningMsg(null);

            const { totals, pieceStats } = calculateBoardStats(newBoard, newInventory);
            setBestTotals(totals);
            setBestPieceStats(new Map(pieceStats));
        } catch (e) {
            setWarningMsg("Failed to import solution code. The code might be broken or from an incompatible version.");
        }
    };

    useEffect(() => {
        if (!isSolving && !isExternallySolving) {
            const invById = indexInventoryById(inventory);
            let boardChanged = false;
            const newBoard = boardRef.current.map(row => row.map(cell => {
                if (cell && cell !== 'Locked') {
                    const invMatch = invById.get(cell.id);
                    if (invMatch && invMatch !== cell) {
                        boardChanged = true;
                        return invMatch;
                    }
                }
                return cell;
            }));

            const boardToCalculate = boardChanged ? newBoard : boardRef.current;
            const availableInventory = getAvailableInventory();
            const { totals, pieceStats } = calculateBoardStats(boardToCalculate, availableInventory, indexInventoryById(availableInventory));

            setBestTotals(totals);
            setBestPieceStats(new Map(pieceStats));
            if (boardChanged) setBoardSync(newBoard);

            const boardIds = boardToCalculate.map(row => row.map(c => c && c !== 'Locked' ? c.id : c));
            localStorage.setItem(`optimizer_machine_${machineId}`, JSON.stringify({
                tier, maximizeStats, targetStats, ignoreStats, statPriority, boardIds
            }));

            if (inventory.length > 0) {
                // Remove unused infinite clones to avoid super long solution code
                const usedCloneIds = new Set<string>();
                boardToCalculate.forEach(row => row.forEach(cell => {
                    if (cell && cell !== 'Locked' && cell.id.includes('_clone_')) {
                        usedCloneIds.add(cell.id);
                    }
                }));

                const fullInventoryForMachine = getInventoryForCode();
                const availableForCode = fullInventoryForMachine.filter(item => !item.id.includes('_clone_') || usedCloneIds.has(item.id));
                const newCode = generateCodeFromState(tier, maximizeStats, targetStats, availableForCode, boardToCalculate);
                setSolutionCode(newCode);

                // This fork does not submit results to the original site's leaderboard.
            } else {
                setSolutionCode('');
            }
        }
    }, [inventory, tier, maximizeStats, targetStats, ignoreStats, statPriority, machineId, getUsedItems, board, isSolving, isExternallySolving]);

    const runOptimization = async (targetSteps?: MachineConfig['targetSteps']) => {
        if (isSolving) {
            isSolvingRef.current = false;
            return;
        }

        const fullInventoryForMachine = getInventoryForCode();
        const usedByOthers = getUsedItems(machineId);

        const solverPool = inventory.filter(i => !i.isLocked && !usedByOthers.has(i.id));

        let boardHasMovablePieces = false;
        boardRef.current.forEach(row => row.forEach(cell => {
            if (cell && cell !== 'Locked') boardHasMovablePieces = true;
        }));

        if (solverPool.length === 0 && !boardHasMovablePieces) {
            setWarningMsg(`Cannot optimize: No unused modules available.`);
            return;
        }

        const engineInventory = inventory.map(item =>
            usedByOthers.has(item.id) ? { ...item, isLocked: true } : item
        );

        setSolutionCode('');
        setWarningMsg(null);
        setIsSolving(true);
        isSolvingRef.current = true;

        const config = { id: machineId, tier, targetStats, maximizeStats, ignoreStats, targetSteps };

        await runParallelEngine([config], [boardRef.current], engineInventory, fullInventoryForMachine, isSolvingRef, (updates) => {
            const myUpdate = updates.get(machineId);
            if (myUpdate) {
                setBoardSync(myUpdate.board);
                setBestTotals(myUpdate.totals);
                setBestPieceStats(myUpdate.pieceStats);
                setSolutionCode(myUpdate.code);
            }
        });

        setIsSolving(false);
    };

    const applyUpdate = (updatedBoard: any[][], updatedTotals: Stats, updatedPieceStats: Map<string, Stats>, updatedCode: string) => {
        setBoardSync(updatedBoard);
        setBestTotals(updatedTotals);
        setBestPieceStats(updatedPieceStats);
        if (updatedCode) setSolutionCode(updatedCode);
    };

    return {
        tier, setTier, handleTierChange, targetStats, setTargetStats,
        maximizeStats, setMaximizeStats, ignoreStats, setIgnoreStats,
        statPriority, setStatPriority, board, bestTotals, bestPieceStats,
        isSolving, stopOptimization, warningMsg, setWarningMsg,
        solutionCode, setSolutionCode, importSolution, runOptimization, resetBoard,
        manuallyPlaceItem, manuallyRemoveItem, isValidPlacement, boardRef, applyUpdate
    };
}