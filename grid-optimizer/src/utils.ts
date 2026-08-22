import type {ModuleShape, ModuleColor, Stats, Point, InventoryItem} from './types';
import { SHAPE_DEFINITIONS } from './constants';

export const getBaseStats = (template: { shape: ModuleShape, color: ModuleColor, displayName: string }): Stats => {
    const stats = { Performance: 0, Quality: 0, Efficiency: 0 };
    if (template.shape === 'Node1x2') return stats;

    const { shape, color, displayName } = template;

    if (displayName.includes('Neural Core (Uncapped)')) return { Performance: 200, Quality: 100, Efficiency: -200 };
    if (displayName.includes('Neural Core (Capped)')) return { Performance: 100, Quality: 50, Efficiency: -100 };
    if (displayName.includes('Alarm Module')) return { Performance: 0, Quality: 0, Efficiency: -50 };
    if (displayName.includes('Junk Processing')) return { Performance: 0, Quality: 0, Efficiency: 0 };
    if (displayName.includes('Blast Module')) return { Performance: 0, Quality: 0, Efficiency: -100 };

    const isL3 = shape === 'L3';
    const isBase4 = shape.includes('_Base');
    const isHigh4 = shape.includes('_High');
    const isSize5 = shape === 'P5' || shape === 'C5';

    if (color === 'Red') {
        if (isL3) stats.Performance = 12;
        if (isBase4) stats.Performance = 16;
        if (isHigh4) { stats.Performance = 36; stats.Efficiency = -44; }
        if (isSize5) { stats.Performance = 45; stats.Efficiency = -55; }
    } else if (color === 'Yellow') {
        if (isL3) stats.Quality = 6;
        if (isBase4) stats.Quality = 8;
        if (isHigh4) { stats.Performance = -8; stats.Quality = 25; stats.Efficiency = -15; }
        if (isSize5) { stats.Performance = -10; stats.Quality = 31; stats.Efficiency = -18; }
    } else if (color === 'Green') {
        if (isL3) stats.Efficiency = 12;
        if (isBase4) stats.Efficiency = 16;
        if (isHigh4) { stats.Performance = -16; stats.Efficiency = 32; }
        if (isSize5) { stats.Performance = -20; stats.Efficiency = 40; }
    }
    return stats;
};

export const getEffectiveBaseStats = (item: InventoryItem): Stats => {
    let { Performance: p, Quality: q, Efficiency: e } = getBaseStats(item);

    item.effects.forEach((effect, idx) => {
        const customVal = item.effectValues[idx];

        if (effect === 'Degrading') {
            if (customVal !== undefined && !isNaN(customVal)) {
                const truncVal = Math.trunc(customVal);
                if (p > 0) p = truncVal;
                if (q > 0) q = truncVal;
                if (e > 0) e = truncVal;
            }
        }
        else if (effect === 'Learning Algorithm') {
            if (customVal !== undefined && !isNaN(customVal)) {
                const truncVal = Math.trunc(customVal);
                if (p > 0) p = truncVal;
                else if (p < 0) p = Math.min(0, p + truncVal);

                if (q > 0) q = truncVal;
                else if (q < 0) q = Math.min(0, q + truncVal);

                if (e > 0) e = truncVal;
                else if (e < 0) e = Math.min(0, e + truncVal);
            }
        }
    });

    return { Performance: p, Quality: q, Efficiency: e };
};

export const applyInternalEffects = (item: InventoryItem): Stats => {
    let { Performance: p, Quality: q, Efficiency: e } = getEffectiveBaseStats(item);

    item.effects.forEach((effect) => {
        if (effect === 'Premium') {
            p *= 1.2;
            q *= 1.2;
            e *= 1.2;
        }
        else if (effect === 'Inferior') {
            p *= 0.8;
            q *= 0.8;
            e *= 0.8;
        }
        else if (effect === 'Overcharged') {
            p *= 2.0;
            q *= 2.0;
            e *= 2.0;
        }
        else if (effect === 'Negative Feedback') {
            p *= 1.25;
            q *= 1.25;
            e *= 1.25;
        }
    });

    return { Performance: p, Quality: q, Efficiency: e };
};

export const formatStatValue = (val: number) => {
    const rounded = Math.trunc(val);
    return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
};

export const getStatColor = (val: number) => {
    return val > 0 ? '#4caf50' : (val < 0 ? '#ff4d4d' : '#888');
};

// Geometry Pre-Processor
const rotateMatrix = (m: number[][]) => m[0].map((_, idx) => m.map(row => row[idx]).reverse());
const flipMatrix = (m: number[][]) => m.map(row => [...row].reverse());

const matrixToOffsets = (matrix: number[][]): Point[] => {
    const points: Point[] = [];
    for (let y = 0; y < matrix.length; y++) {
        for (let x = 0; x < matrix[y].length; x++) {
            if (matrix[y][x]) points.push({ x, y });
        }
    }
    const minY = Math.min(...points.map(p => p.y));
    const topRow = points.filter(p => p.y === minY);
    const minX = Math.min(...topRow.map(p => p.x));
    return points.map(p => ({ x: p.x - minX, y: p.y - minY })).sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
};

const generateAllOffsets = (baseMatrix: number[][]): Point[][] => {
    const offsetsMap = new Set<string>();
    const result: Point[][] = [];
    let current = baseMatrix;

    for (let i = 0; i < 4; i++) {
        const normalPts = matrixToOffsets(current);
        const normalHash = JSON.stringify(normalPts);
        if (!offsetsMap.has(normalHash)) { offsetsMap.add(normalHash); result.push(normalPts); }

        const flippedPts = matrixToOffsets(flipMatrix(current));
        const flippedHash = JSON.stringify(flippedPts);
        if (!offsetsMap.has(flippedHash)) { offsetsMap.add(flippedHash); result.push(flippedPts); }

        current = rotateMatrix(current);
    }
    return result;
};

export const PRECOMPUTED_OFFSETS = new Map<ModuleShape, Point[][]>();
(Object.keys(SHAPE_DEFINITIONS) as ModuleShape[]).forEach(shape => {
    PRECOMPUTED_OFFSETS.set(shape, generateAllOffsets(SHAPE_DEFINITIONS[shape]));
});

// Solver-facing view of the same geometry:
// flat coordinate arrays plus the bounding box of each orientation, so the placement loop can skip out-of-bounds anchors up front instead of re-checking extents for every candidate cell
export interface Orientation {
    offsets: Point[];
    xs: Int8Array;
    ys: Int8Array;
    count: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export const PRECOMPUTED_ORIENTATIONS = new Map<ModuleShape, Orientation[]>();
PRECOMPUTED_OFFSETS.forEach((orientations, shape) => {
    PRECOMPUTED_ORIENTATIONS.set(shape, orientations.map(offsets => {
        const count = offsets.length;
        const xs = new Int8Array(count);
        const ys = new Int8Array(count);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < count; i++) {
            const { x, y } = offsets[i];
            xs[i] = x; ys[i] = y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return { offsets, xs, ys, count, minX, maxX, minY, maxY };
    }));
});

// matrixToOffsets normalises so the first cell is always the anchor (0,0)
// The solver relies on that to enumerate candidate anchors from empty cells only
PRECOMPUTED_ORIENTATIONS.forEach((orientations, shape) => {
    for (const o of orientations) {
        if (o.xs[0] !== 0 || o.ys[0] !== 0) {
            throw new Error(`Orientation for ${shape} is not anchor-normalised`);
        }
    }
});