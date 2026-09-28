/* The solver's view of modules and boards, as numbers
 *
 * Every module the solve can see gets an index, and everything the inner loops ask about it (its stats after its own effects, whether it is a Node,
 * which placement effects it carries...) sits in a typed array under that index. A board is 35 cells in an Int16Array holding module indices,
 * with EMPTY and LOCKED for the rest. Copying a board is one .set(), and no hot path hashes an id or allocates
 *
 * boardTotals and evalPlacement reproduce calculateBoardStats and evaluatePlacementDelta (hooks/useOptimizer.ts) exactly, down to the order the
 * rounded values are added in, so the typed solver scores every board the way the rest of the app does
 */
import type { InventoryItem, ModuleShape, Stats } from '../types';
import { roundStat, PRECOMPUTED_ORIENTATIONS } from '../utils';
import type { Orientation } from '../utils';

export const CELLS = 35;
export const EMPTY = -1;
export const LOCKED = -2;
export type Board = Int16Array;

export const NEIGHBOR_DX = [0, 0, -1, 1];
export const NEIGHBOR_DY = [-1, 1, 0, 0];

// What the objective needs to know about one machine, per stat (0 Performance, 1 Quality, 2 Efficiency)
export interface MachineParams {
    ignored: boolean[];
    // Performance and Quality count as one stat, their sum, scored under Performance (Mirage Projector attractiveness); Quality is then ignored
    sumPQ?: boolean;
    // null when the stat has no target
    target: (number | null)[];
    maximize: boolean[];
}

export interface Totals {
    p: number;
    q: number;
    e: number;
    pieces: number;
}

export const totalOf = (t: Totals, s: number) => (s === 0 ? t.p : s === 1 ? t.q : t.e);

const isPureNegative = (p: number, q: number, e: number) => p <= 0 && q <= 0 && e <= 0 && (p < 0 || q < 0 || e < 0);

export interface TypedCore {
    items: InventoryItem[];
    indexOf: Map<string, number>;
    count: number;
    // Each module's own stats after its effects
    IP: Float64Array; IQ: Float64Array; IE: Float64Array;
    white: Uint8Array;
    shape: ModuleShape[];
    orientations: (Orientation[] | undefined)[];
    size: Uint8Array;
    boardTotals: (board: Board) => Totals;
    // Scores placing module `it` with orientation `o` anchored at (x, y), and leaves the placement's stat change in `delta`
    evalPlacement: (it: number, x: number, y: number, o: Orientation, board: Board, boardIsEmpty: boolean,
        w0: number, w1: number, w2: number, c0: number, c1: number, c2: number, params: MachineParams, zeroScoreOk: boolean) => number;
    delta: Float64Array;
    toObjectBoard: (board: Board) => (InventoryItem | 'Locked' | null)[][];
}

export const createTypedCore = (items: InventoryItem[], internal: (item: InventoryItem) => Stats): TypedCore => {
    const count = items.length;
    const indexOf = new Map<string, number>();
    items.forEach((item, i) => indexOf.set(item.id, i));

    const IP = new Float64Array(count), IQ = new Float64Array(count), IE = new Float64Array(count);
    const white = new Uint8Array(count), side = new Uint8Array(count), top = new Uint8Array(count), recv = new Uint8Array(count);
    const nf = new Uint8Array(count), pureNeg = new Uint8Array(count), size = new Uint8Array(count);
    const shape: ModuleShape[] = [];
    const orientations: (Orientation[] | undefined)[] = [];
    items.forEach((item, i) => {
        const s = internal(item);
        IP[i] = s.Performance; IQ[i] = s.Quality; IE[i] = s.Efficiency;
        white[i] = item.color === 'White' ? 1 : 0;
        side[i] = item.effects.includes('Side Mount') ? 1 : 0;
        top[i] = item.effects.includes('Top Mount') ? 1 : 0;
        recv[i] = item.effects.includes('Receiver') ? 1 : 0;
        nf[i] = item.effects.filter(e => e === 'Negative Feedback').length;
        pureNeg[i] = isPureNegative(s.Performance, s.Quality, s.Efficiency) ? 1 : 0;
        shape.push(item.shape);
        const o = PRECOMPUTED_ORIENTATIONS.get(item.shape);
        orientations.push(o);
        size[i] = o ? o[0].count : 0;
    });

    // ---- boardTotals: calculateBoardStats' totals and piece count
    // Generation stamps stand in for the Sets and Maps, so nothing is cleared or allocated per call
    const pieceStamp = new Int32Array(count);
    const pairStamp = new Int32Array(count);
    const pieceOrder = new Int16Array(CELLS);
    const pieceSlot = new Int16Array(count);
    const pieceCells = new Int8Array(CELLS * 5);
    const pieceCellCount = new Int8Array(CELLS);
    const minX = new Int8Array(count), minY = new Int8Array(count);
    const adjNodes = new Int16Array(count);
    const nodeP = new Float64Array(CELLS), nodeQ = new Float64Array(CELLS), nodeE = new Float64Array(CELLS);
    let stamp = 0;

    const boardTotals = (board: Board): Totals => {
        const pieceGen = ++stamp;
        let n = 0;
        for (let c = 0; c < CELLS; c++) {
            const a = board[c];
            if (a < 0) continue;
            const x = c % 7, y = (c - x) / 7;
            if (pieceStamp[a] !== pieceGen) {
                pieceStamp[a] = pieceGen;
                pieceSlot[a] = n;
                pieceOrder[n] = a;
                pieceCellCount[n] = 0;
                minX[a] = x; minY[a] = y;
                adjNodes[a] = 0;
                n++;
            } else {
                if (x < minX[a]) minX[a] = x;
                if (y < minY[a]) minY[a] = y;
            }
            const slot = pieceSlot[a];
            if (pieceCellCount[slot] < 5) pieceCells[slot * 5 + pieceCellCount[slot]++] = c;
        }

        // Nodes: each adjacent module counts once per node, in the order its cells meet them
        let nodeCount = 0;
        for (let k = 0; k < n; k++) {
            const node = pieceOrder[k];
            if (!white[node]) continue;
            const pairGen = ++stamp;
            let sp = 0, sq = 0, se = 0;
            for (let i = 0; i < pieceCellCount[k]; i++) {
                const c = pieceCells[k * 5 + i];
                const x = c % 7, y = (c - x) / 7;
                for (let d = 0; d < 4; d++) {
                    const nx = x + NEIGHBOR_DX[d], ny = y + NEIGHBOR_DY[d];
                    if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) continue;
                    const adj = board[ny * 7 + nx];
                    if (adj < 0 || white[adj]) continue;
                    if (pairStamp[adj] !== pairGen) {
                        pairStamp[adj] = pairGen;
                        adjNodes[adj]++;
                        sp += IP[adj]; sq += IQ[adj]; se += IE[adj];
                    }
                }
            }
            nodeP[nodeCount] = roundStat(sp * 0.20);
            nodeQ[nodeCount] = roundStat(sq * 0.20);
            nodeE[nodeCount] = roundStat(se * 0.20);
            nodeCount++;
        }

        let tp = 0, tq = 0, te = 0;
        for (let k = 0; k < n; k++) {
            const a = pieceOrder[k];
            if (white[a]) continue;
            let p = IP[a], q = IQ[a], e = IE[a];

            let absorbP = 0, absorbQ = 0, absorbE = 0;
            if (nf[a] > 0) {
                const nbGen = ++stamp;
                let np = 0, nq = 0, ne = 0;
                for (let i = 0; i < pieceCellCount[k]; i++) {
                    const c = pieceCells[k * 5 + i];
                    const x = c % 7, y = (c - x) / 7;
                    for (let d = 0; d < 4; d++) {
                        const nx = x + NEIGHBOR_DX[d], ny = y + NEIGHBOR_DY[d];
                        if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) continue;
                        const nb = board[ny * 7 + nx];
                        if (nb < 0 || nb === a || white[nb]) continue;
                        if (pairStamp[nb] === nbGen) continue;
                        pairStamp[nb] = nbGen;
                        if (IP[nb] < 0) np += IP[nb];
                        if (IQ[nb] < 0) nq += IQ[nb];
                        if (IE[nb] < 0) ne += IE[nb];
                    }
                }
                absorbP = nf[a] * 0.25 * np;
                absorbQ = nf[a] * 0.25 * nq;
                absorbE = nf[a] * 0.25 * ne;
            }

            let bp = 0, bq = 0, be = 0;
            if (minX[a] === 0 && side[a]) { bp += roundStat(p * 0.20); bq += roundStat(q * 0.20); be += roundStat(e * 0.20); }
            if (minY[a] === 0 && top[a]) { bp += roundStat(p * 0.20); bq += roundStat(q * 0.20); be += roundStat(e * 0.20); }
            if (recv[a]) { bp += roundStat(p * 0.10 * adjNodes[a]); bq += roundStat(q * 0.10 * adjNodes[a]); be += roundStat(e * 0.10 * adjNodes[a]); }
            p += bp; q += bq; e += be;
            p += absorbP; q += absorbQ; e += absorbE;

            tp += roundStat(p); tq += roundStat(q); te += roundStat(e);
        }
        for (let k = 0; k < nodeCount; k++) { tp += nodeP[k]; tq += nodeQ[k]; te += nodeE[k]; }

        return { p: tp, q: tq, e: te, pieces: n };
    };

    // ---- evalPlacement: evaluatePlacementDelta
    const delta = new Float64Array(3);
    const neighbors = new Int16Array(32);

    const scoreStat = (s: number, d: number, current: number, w: number, params: MachineParams) => {
        if (params.ignored[s]) return 0;
        if (d === 0) return 0;
        const target = params.target[s];
        const maximize = params.maximize[s];
        if (target !== null && !maximize) {
            const after = current + d;
            if (current >= target && after >= target) return 0;
            if (current >= target && after < target) return d * w * 100;
            if (current < target) return after <= target ? d * w : (target - current) * w;
        } else if (target !== null && maximize) {
            const after = current + d;
            if (current >= target) return d * w;
            return after <= target ? d * w * 10 : ((target - current) * w * 10) + ((after - target) * w);
        } else if (maximize) {
            return d * w;
        }
        return 0;
    };

    const evalPlacement = (it: number, x: number, y: number, o: Orientation, board: Board, boardIsEmpty: boolean,
        w0: number, w1: number, w2: number, c0: number, c1: number, c2: number, params: MachineParams, zeroScoreOk: boolean) => {
        if (x + o.minX < 0 || x + o.maxX > 6 || y + o.minY < 0 || y + o.maxY > 4) return -Infinity;
        const xs = o.xs, ys = o.ys, cnt = o.count;
        const isW = white[it] === 1;
        const pn = pureNeg[it] === 1;
        const nfc = nf[it];

        let connected = false;
        let negativeContacts = 0;
        let nc = 0;
        for (let i = 0; i < cnt; i++) {
            const px = x + xs[i], py = y + ys[i];
            if (board[py * 7 + px] !== EMPTY) return -Infinity;
            if (px === 0 || px === 6 || py === 0 || py === 4) connected = true;
            for (let d = 0; d < 4; d++) {
                const nx = px + NEIGHBOR_DX[d], ny = py + NEIGHBOR_DY[d];
                if (nx < 0 || nx >= 7 || ny < 0 || ny >= 5) continue;
                const a = board[ny * 7 + nx];
                if (a < 0) continue;
                connected = true;
                const aW = white[a] === 1;
                if (isW) {
                    if (!aW && pureNeg[a]) negativeContacts++;
                } else if (pn && aW) {
                    negativeContacts++;
                }
                let seen = false;
                for (let k = 0; k < nc; k++) if (neighbors[k] === a) { seen = true; break; }
                if (!seen) neighbors[nc++] = a;
            }
        }
        if (!connected && !boardIsEmpty) return -10000;

        let dp = 0, dq = 0, de = 0;
        let np = 0, nq = 0, ne = 0;
        let adj = 0;
        for (let k = 0; k < nc; k++) {
            const a = neighbors[k];
            const aW = white[a] === 1;
            if (!isW && aW) {
                adj++;
                dp += roundStat(IP[it] * 0.20); dq += roundStat(IQ[it] * 0.20); de += roundStat(IE[it] * 0.20);
            } else if (isW && !aW) {
                dp += roundStat(IP[a] * 0.20); dq += roundStat(IQ[a] * 0.20); de += roundStat(IE[a] * 0.20);
            }
            if (nfc > 0 && !aW) {
                if (IP[a] < 0) np += IP[a];
                if (IQ[a] < 0) nq += IQ[a];
                if (IE[a] < 0) ne += IE[a];
            }
        }

        let myP = IP[it], myQ = IQ[it], myE = IE[it];
        let bp = 0, bq = 0, be = 0;
        if (side[it] && x + o.minX === 0) { bp += roundStat(myP * 0.20); bq += roundStat(myQ * 0.20); be += roundStat(myE * 0.20); }
        if (top[it] && y + o.minY === 0) { bp += roundStat(myP * 0.20); bq += roundStat(myQ * 0.20); be += roundStat(myE * 0.20); }
        if (recv[it]) { bp += roundStat(myP * 0.10 * adj); bq += roundStat(myQ * 0.10 * adj); be += roundStat(myE * 0.10 * adj); }
        myP += bp; myQ += bq; myE += be;
        if (nfc > 0) { myP += nfc * 0.25 * np; myQ += nfc * 0.25 * nq; myE += nfc * 0.25 * ne; }

        dp += roundStat(myP); dq += roundStat(myQ); de += roundStat(myE);
        delta[0] = dp; delta[1] = dq; delta[2] = de;

        const statScore = params.sumPQ
            ? scoreStat(0, dp + dq, c0 + c1, w0, params) + scoreStat(2, de, c2, w2, params)
            : scoreStat(0, dp, c0, w0, params) + scoreStat(1, dq, c1, w1, params) + scoreStat(2, de, c2, w2, params);
        const tiebreakers = (adj * 0.05) - (negativeContacts * 1000);
        if (statScore < 0 || (statScore === 0 && !zeroScoreOk)) return -10000 + tiebreakers;
        return statScore + tiebreakers;
    };

    const toObjectBoard = (board: Board) => {
        const rows: (InventoryItem | 'Locked' | null)[][] = [];
        for (let y = 0; y < 5; y++) {
            const row: (InventoryItem | 'Locked' | null)[] = [];
            for (let x = 0; x < 7; x++) {
                const a = board[y * 7 + x];
                row.push(a === EMPTY ? null : a === LOCKED ? 'Locked' : items[a]);
            }
            rows.push(row);
        }
        return rows;
    };

    return { items, indexOf, count, IP, IQ, IE, white, shape, orientations, size, boardTotals, evalPlacement, delta, toObjectBoard };
};
