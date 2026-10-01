import { useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryItem, ItemEffect, ModuleColor, ModuleTemplate, Stats } from '../types';
import { COLOR_MAP, MODULE_TEMPLATES, NODE_TEMPLATE } from '../constants';
import { applyInternalEffects, getBaseStats, PRECOMPUTED_OFFSETS } from '../utils';
import MiniShape from './MiniShape';

type StatKey = keyof Stats;
const STATS: { key: StatKey; label: string; color: ModuleColor }[] = [
    { key: 'Performance', label: 'Performance', color: 'Red' },
    { key: 'Quality', label: 'Quality', color: 'Yellow' },
    { key: 'Efficiency', label: 'Efficiency', color: 'Green' },
];

// Every effect a module can roll, one per entry. Learning Algorithm is taken fully learned and Degrading as new: both at the most
// they can be (twice the module's best stat, as the game caps them). Receiver, Side and Top Mount only pay off where the module sits
const EFFECTS: ItemEffect[] = ['None', 'Premium', 'Inferior', 'Overcharged', 'Negative Feedback', 'Learning Algorithm', 'Degrading', 'Receiver', 'Side Mount', 'Top Mount'];
const EFFECT_NOTE: Partial<Record<ItemEffect, string>> = { 'Learning Algorithm': 'fully learned', Degrading: 'new' };

const maxValue = (template: ModuleTemplate) => {
    const base = getBaseStats(template);
    return Math.floor(Math.max(0, base.Performance, base.Quality, base.Efficiency) * 2);
};

type Entry = { template: ModuleTemplate; effect: ItemEffect; value: number; stats: Stats; size: number };

// The modules of one kind: that stat's modules with every effect (and the Neural Cores, for Performance and Quality), best per cell first
const entriesFor = (stat: StatKey): Entry[] => {
    const templates = MODULE_TEMPLATES.filter(t => t.group === stat || (t.color === 'Purple' && stat !== 'Efficiency'));
    const entries: Entry[] = [];
    for (const template of templates) {
        // Neural Cores come as they are
        for (const effect of template.color === 'Purple' ? ['None' as ItemEffect] : EFFECTS) {
            const value = effect === 'Learning Algorithm' || effect === 'Degrading' ? maxValue(template) : 0;
            const probe = { id: '', shape: template.shape, color: template.color, displayName: template.displayName, effects: [effect, 'None'], effectValues: [value, 0] } as InventoryItem;
            entries.push({ template, effect, value, stats: applyInternalEffects(probe), size: PRECOMPUTED_OFFSETS.get(template.shape)?.[0]?.length ?? template.size });
        }
    }
    // Per cell of that stat; ties go to the one that costs the other stats less
    const others = (e: Entry) => STATS.reduce((sum, s) => sum + (s.key === stat ? 0 : e.stats[s.key]), 0) / e.size;
    return entries.sort((a, b) => b.stats[stat] / b.size - a.stats[stat] / a.size || others(b) - others(a));
};

const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export default function AddModuleMenu({ onAdd, disabled }: { onAdd: (item: InventoryItem) => void; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [stat, setStat] = useState<StatKey>('Performance');
    const [added, setAdded] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const entries = useMemo(() => entriesFor(stat), [stat]);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', esc);
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
    }, [open]);

    const add = (template: ModuleTemplate, effect: ItemEffect, value: number) => {
        // No uid: a module that is not in the save, so the mod export leaves it out
        onAdd({
            id: `${template.shape}_${template.color}_added_${Math.random().toString(36).substring(2, 8)}`,
            shape: template.shape, color: template.color, displayName: template.displayName,
            effects: [effect, 'None'], effectValues: [value, 0], isInfinite: false, isLocked: false,
        });
        setAdded(`${template.displayName}${effect !== 'None' ? ` · ${effect}` : ''}`);
    };

    const row = (key: string, template: ModuleTemplate, effect: ItemEffect, value: number, stats: Stats | null, size: number) => (
        <button
            key={key}
            onClick={() => add(template, effect, value)}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '6px 10px', background: 'none', border: 'none', borderBottom: '1px solid #2a2a2a', color: '#ddd', cursor: 'pointer', textAlign: 'left', fontSize: '0.8em' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#2c2c2e'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
        >
            <span style={{ width: '34px', display: 'flex', justifyContent: 'center', flex: 'none', transform: 'scale(0.6)' }}>
                <MiniShape shape={template.shape} colorHex={COLOR_MAP[template.color]} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: COLOR_MAP[template.color], fontWeight: 'bold' }}>{template.displayName}</span>
                <span style={{ color: '#777' }}> · {size} cells</span>
                {effect !== 'None' && <span style={{ color: '#9ab' }}> · {effect}{EFFECT_NOTE[effect] ? ` (${EFFECT_NOTE[effect]})` : ''}</span>}
            </span>
            {stats && (
                <span style={{ flex: 'none', color: '#aaa', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {STATS.filter(s => stats[s.key] !== 0).map(s => (
                        <span key={s.key} style={{ marginLeft: '8px', color: s.key === stat ? COLOR_MAP[s.color] : '#888', fontWeight: s.key === stat ? 'bold' : 'normal' }}>
                            {s.label[0]} {fmt(stats[s.key])}
                        </span>
                    ))}
                    <span style={{ marginLeft: '8px', color: '#666' }}>{fmt(Math.round((stats[stat] / size) * 10) / 10)}/cell</span>
                </span>
            )}
        </button>
    );

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => { setOpen(o => !o); setAdded(null); }}
                disabled={disabled}
                title="Add a module that is not in your save"
                style={{
                    background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#eee',
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontSize: '0.9em', padding: '6px 14px'
                }}
            >
                + Add Module
            </button>
            {open && (
                <div style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200, width: 'min(560px, calc(100vw - 32px))',
                    backgroundColor: '#1c1c1e', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', overflow: 'hidden'
                }}>
                    <div style={{ display: 'flex', gap: '6px', padding: '10px', borderBottom: '1px solid #333' }}>
                        {STATS.map(s => (
                            <button
                                key={s.key}
                                onClick={() => setStat(s.key)}
                                style={{
                                    flex: 1, padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em', fontWeight: 'bold',
                                    background: stat === s.key ? COLOR_MAP[s.color] : '#2a2a2a', color: stat === s.key ? '#111' : COLOR_MAP[s.color],
                                    border: `1px solid ${COLOR_MAP[s.color]}`
                                }}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ padding: '6px 10px', fontSize: '0.72em', color: '#888', borderBottom: '1px solid #333' }}>
                        {added ? <span style={{ color: '#4caf50' }}>Added {added} to storage</span> : `Best ${stat} per cell first. Click one to add it to storage`}
                    </div>
                    <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                        {entries.map((e, i) => row(`${i}`, e.template, e.effect, e.value, e.stats, e.size))}
                        {row('node', NODE_TEMPLATE, 'None', 0, null, 2)}
                    </div>
                </div>
            )}
        </div>
    );
}
