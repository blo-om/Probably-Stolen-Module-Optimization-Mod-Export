// Machine settings remembered per save (localStorage), so importing the same save again (after playing on, or in a later visit)
// brings back each card's Auto / target / off choices, its Limit and Desequencer choices, its lock, the modules locked to it (by
// the game's module uid, and only while the module is still in that machine) and the card order (priority).
// A save is known by its file name (save_14); a machine by its name in the save ("Inv. > Machine Bay 1 > Furnace 2"), plus
// how many cards before it have the same name
import { SAVE_NAME_KEY } from './modExport';
import { desequencerAutoDaysKey, desequencerChipsetKey } from './machineDefaults';

const settingsKey = (save: string) => `optimizer_save_settings_${save}`;

type MachineSettings = {
    // tier, maximizeStats, targetStats, ignoreStats, statPriority, as useOptimizer keeps them (without the board)
    state: Record<string, unknown> | null;
    limit: string | null;
    chipset: string | null;
    autoDays: string | null;
    locked: string | null;
    lockedUids?: number[];
};
type SaveSettings = { order: string[]; machines: Record<string, MachineSettings> };

const get = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const set = (key: string, value: string | null) => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

// "name#n": the n-th machine (from 0) with that name in the save file, so two machines with the same name keep their own settings.
// Given at import and kept per card (cardKey), so reordering the cards does not swap them
const cardKey = (id: string) => `optimizer_machine_savekey_${id}`;
const keyed = (names: string[]) => {
    const seen = new Map<string, number>();
    return names.map(name => { const n = seen.get(name) ?? 0; seen.set(name, n + 1); return `${name}#${n}`; });
};

const snapshot = () => {
    const save = get(SAVE_NAME_KEY);
    if (!save) return;
    let ids: string[];
    try { ids = (JSON.parse(get('optimizer_machine_list') || '[]') as { id: string }[]).map(m => m.id); } catch { return; }
    // Cards with no machine picked yet have nothing to remember
    ids = ids.filter(id => get(`optimizer_machine_type_${id}`));
    if (ids.length === 0) return;
    const fallback = keyed(ids.map(id => get(`optimizer_machine_type_${id}`)!));
    const keys = ids.map((id, i) => get(cardKey(id)) ?? fallback[i]);
    const settings: SaveSettings = { order: keys, machines: {} };
    // Modules locked to a machine (right-click), by uid
    const lockedUid = new Map<string, number>();
    try {
        for (const item of JSON.parse(get('optimizer_inventory') || '[]')) if (item.isLocked && typeof item.uid === 'number') lockedUid.set(item.id, item.uid);
    } catch { /* none */ }
    ids.forEach((id, i) => {
        let state: Record<string, unknown> | null = null;
        let lockedUids: number[] = [];
        try {
            const { boardIds, ...rest } = JSON.parse(get(`optimizer_machine_${id}`) || 'null') ?? {};
            state = rest;
            const onBoard = new Set<string>((boardIds ?? []).flat());
            lockedUids = [...onBoard].filter(c => lockedUid.has(c)).map(c => lockedUid.get(c)!);
        } catch { /* keep null */ }
        settings.machines[keys[i]] = {
            state,
            limit: get(`optimizer_limit_${id}`),
            chipset: get(desequencerChipsetKey(id)),
            autoDays: get(desequencerAutoDaysKey(id)),
            locked: get(`optimizer_machine_locked_${id}`),
            lockedUids,
        };
    });
    set(settingsKey(save), JSON.stringify(settings));
};

let timer: ReturnType<typeof setTimeout> | null = null;
// Called wherever a card's settings are written; the snapshot is taken once things settle
export const rememberSaveSettings = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; snapshot(); }, 300);
};
// Before another save is imported: what is pending belongs to the save still loaded
export const flushSaveSettings = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    snapshot();
};

type Imported = { id: string; machineType: string; tier: unknown; boardIds: (string | null)[][] };

/* For a save being imported: puts back what was remembered for its machines (under their new card ids) and returns them in the
 * remembered card order, machines new to the save last. `defaults` is each machine's fresh state, used for anything not remembered
 * (and always for the tier and board, which come from the save). `lock` gets the ids of the save's modules (`items`) to lock again
 */
export const restoreSaveSettings = <M extends Imported>(save: string, machines: M[], defaults: (m: M) => Record<string, unknown>,
    items: { id: string; uid?: number }[], lock: (moduleIds: string[]) => void): M[] => {
    const uids = new Map(items.map(it => [it.id, it.uid]));
    const uidOf = (id: string) => uids.get(id);
    let settings: SaveSettings | null = null;
    try { settings = JSON.parse(get(settingsKey(save)) || 'null'); } catch { /* nothing remembered */ }
    const keys = keyed(machines.map(m => m.machineType));
    const lockOnBoard: string[] = [];
    machines.forEach((m, i) => {
        const fresh = defaults(m);
        const s = settings?.machines[keys[i]];
        set(`optimizer_machine_${m.id}`, JSON.stringify(s?.state ? { ...fresh, ...s.state, tier: fresh.tier, boardIds: fresh.boardIds } : fresh));
        set(`optimizer_limit_${m.id}`, s?.limit ?? null);
        set(desequencerChipsetKey(m.id), s?.chipset ?? null);
        set(desequencerAutoDaysKey(m.id), s?.autoDays ?? null);
        set(`optimizer_machine_locked_${m.id}`, s?.locked ?? null);
        set(cardKey(m.id), keys[i]);
        if (s?.lockedUids?.length) lockOnBoard.push(...m.boardIds.flat().filter((c): c is string => !!c && s.lockedUids!.includes(uidOf(c) ?? -1)));
    });
    lock(lockOnBoard);
    if (!settings) return machines;
    const rank = new Map(settings.order.map((k, i) => [k, i]));
    return machines
        .map((m, i) => ({ m, r: rank.get(keys[i]) ?? settings!.order.length + i }))
        .sort((a, b) => a.r - b.r)
        .map(x => x.m);
};
