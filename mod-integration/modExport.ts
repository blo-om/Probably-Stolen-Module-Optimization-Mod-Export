/* Export for the Module Optimizer Import mod (https://www.nexusmods.com/probablystolen/mods/274): the mod adds an import button to
 * every machine window in the game, reads this export from the clipboard and moves the player's own modules into place, all
 * listed machines in one go. Self-contained: it only needs the boards, so changes to this site's own code format can't break it.
 *
 *   'PSMOD1:' + base64url(UTF-8 JSON) of
 *   { v: 2,                     // lower is refused as outdated
 *     slot: 1,                  // the save's saveSlotId: the mod refuses an export made from another save
 *     save: 'save_1',           // the save's file name, for messages only
 *     machines: [{ name,        // the machine's path as the save importer names it ("Inv. > Machine Bay (Expanded) 1 > Furnace 2"),
 *                               // which the mod rebuilds in the game to find the machine
 *                  code,        // the board in hoydoy's original solution code format (below)
 *                  modules: [{ uid, cells }] }] }   // each save module on the board: its uniqueId and the cells it covers (y * 7 + x)
 *
 * `uid` is the item's `uniqueId` in the save, which the running game has too, so the mod moves exactly that item. Modules with no
 * uid (added by hand, copies of infinite ones) are matched by type from `code`.
 *
 * `code` is hoydoy's format exactly as the mod's decoder reads it (MSB-first bits, then a 0x01 sentinel byte in front, read as one
 * big-endian number and written in base 85):
 *   tier:2  maxPerf:1 maxQual:1 maxEff:1  3x(hasTarget:1 [target+2048:12])  count:8
 *   per module: shape:4 color:3 cellCount:3 cells:6*n  2x(hasEffect:1 [effect:4 hasValue:1 [value+2048:12]])
 * Only the modules on the board are listed (the mod places those and ignores the rest), and the Blast module is written as the
 * Grey Line4 it is: the mod knows colors 0-6 only.
 */
import type { Board } from './solver/board';
import type { InventoryItem } from './types';

export const MOD_EXPORT_PREFIX = 'PSMOD1:';
const SAVE_NAME_KEY = 'optimizer_save_name';
const SAVE_SLOT_KEY = 'optimizer_save_slot';

// Call with the save file's text and name when a save is imported: the export names the save it was made from
export const rememberSaveForMod = (saveText: string, fileName: string) => {
    try {
        localStorage.setItem(SAVE_NAME_KEY, fileName.replace(/\.es3$/i, ''));
        const slot = /"saveSlotId"\s*:\s*(\d+)/.exec(saveText);
        if (slot) localStorage.setItem(SAVE_SLOT_KEY, slot[1]);
        else localStorage.removeItem(SAVE_SLOT_KEY);
    } catch { /* storage unavailable: the export goes without a slot, which the mod accepts */ }
};

// ---- the code, in the mod's own tables
const SHAPES = ['Node1x2', 'L3', 'L4_Base', 'T4_Base', 'Square4_Base', 'L4_High', 'T4_High', 'Square4_High', 'P5', 'C5', 'Line4'];
const COLORS = ['White', 'Red', 'Yellow', 'Green', 'Purple', 'DarkRed', 'Grey'];
const EFFECTS = ['None', 'Premium', 'Inferior', 'Overcharged', 'Degrading', 'Negative Feedback', 'Receiver', 'Side Mount', 'Top Mount', 'Learning Algorithm'];
const BASE85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';

type Stats3 = { Performance: boolean; Quality: boolean; Efficiency: boolean };
type Targets3 = { Performance: number | null; Quality: number | null; Efficiency: number | null };

const indexOf = (table: string[], value: string, what: string) => {
    const i = table.indexOf(value);
    if (i === -1) throw new Error(`The mod does not know the ${what} "${value}"`);
    return i;
};

const boardCode = (tier: number, maximize: Stats3, targets: Targets3, board: Board) => {
    const bits: number[] = [];
    const write = (value: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); };
    write(tier, 2);
    write(maximize.Performance ? 1 : 0, 1);
    write(maximize.Quality ? 1 : 0, 1);
    write(maximize.Efficiency ? 1 : 0, 1);
    for (const t of [targets.Performance, targets.Quality, targets.Efficiency]) {
        if (t === null || t === undefined) write(0, 1);
        else { write(1, 1); write(Math.round(t) + 2048, 12); }
    }
    const pieces = new Map<string, { item: InventoryItem; cells: number[] }>();
    board.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell || cell === 'Locked') return;
        const piece = pieces.get(cell.id) ?? { item: cell, cells: [] };
        piece.cells.push(y * 7 + x);
        pieces.set(cell.id, piece);
    }));
    write(pieces.size, 8);
    for (const { item, cells } of pieces.values()) {
        write(indexOf(SHAPES, item.shape, 'shape'), 4);
        write(indexOf(COLORS, item.color, 'color'), 3);
        write(cells.length, 3);
        cells.forEach(c => write(c, 6));
        item.effects.forEach((effect, k) => {
            if (effect === 'None') { write(0, 1); return; }
            write(1, 1);
            write(indexOf(EFFECTS, effect, 'effect'), 4);
            if (effect === 'Learning Algorithm' || effect === 'Degrading') { write(1, 1); write(item.effectValues[k] + 2048, 12); }
            else write(0, 1);
        });
    }
    while (bits.length % 8 !== 0) bits.push(0);
    let num = 1n; // the 0x01 sentinel
    for (const bit of bits) num = (num << 1n) | BigInt(bit);
    let text = '';
    while (num > 0n) { text = BASE85[Number(num % 85n)] + text; num /= 85n; }
    return text;
};

// The save's modules on a board, with the cells each covers. Copies of infinite modules are not real items
const boardModules = (board: Board) => {
    const byId = new Map<string, { uid: number; cells: number[] }>();
    board.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell || cell === 'Locked' || typeof cell.uid !== 'number' || cell.id.includes('_clone_')) return;
        const entry = byId.get(cell.id) ?? { uid: cell.uid, cells: [] };
        entry.cells.push(y * 7 + x);
        byId.set(cell.id, entry);
    }));
    return [...byId.values()];
};

const toBase64Url = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export type MachineForMod = { name: string; board: Board; tier: number; maximizeStats: Stats3; targetStats: Targets3 };

const hasModules = (board: Board) => board.some(row => row.some(cell => cell && cell !== 'Locked'));

// The export string for these machines (empty boards are left out), or null when none has a layout
export const encodeModExport = (machines: MachineForMod[]): string | null => {
    const entries = machines.filter(m => hasModules(m.board)).map(m => ({
        name: m.name,
        code: boardCode(m.tier, m.maximizeStats, m.targetStats, m.board),
        modules: boardModules(m.board),
    }));
    if (entries.length === 0) return null;
    let slot: number | null = null, save: string | null = null;
    try {
        const s = localStorage.getItem(SAVE_SLOT_KEY);
        slot = s !== null && s !== '' && !isNaN(Number(s)) ? Number(s) : null;
        save = localStorage.getItem(SAVE_NAME_KEY);
    } catch { /* none */ }
    return MOD_EXPORT_PREFIX + toBase64Url(JSON.stringify({ v: 2, slot, save, machines: entries }));
};

// "Export All for Mod": every machine card in one string on the clipboard. Returns how many machines went in
export const copyAllForMod = async (
    machines: { id: string }[],
    handles: Record<string, { getBoard: () => Board; getState: () => { tier: number; maximizeStats: Stats3; targetStats: Targets3 } } | undefined>
): Promise<number> => {
    const list: MachineForMod[] = [];
    for (const { id } of machines) {
        const handle = handles[id];
        if (!handle) continue;
        // The card keeps its machine's name here (the save importer's path, or a machine type picked by hand)
        const name = localStorage.getItem(`optimizer_machine_type_${id}`) ?? 'Select Machine...';
        list.push({ name, board: handle.getBoard(), ...handle.getState() });
    }
    const text = encodeModExport(list);
    if (text === null) return 0;
    await navigator.clipboard.writeText(text);
    return list.filter(m => hasModules(m.board)).length;
};
