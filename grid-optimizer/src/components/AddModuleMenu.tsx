import { useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryItem, ItemEffect, ModuleColor, ModuleTemplate, Stats } from '../types';
import { COLOR_MAP, MODULE_TEMPLATES, NODE_TEMPLATE } from '../constants';
import { applyInternalEffects, getBaseStats } from '../utils';
import MiniShape from './MiniShape';
import { t, useLang, moduleName } from '../i18n';

type StatKey = keyof Stats;
const STATS: { key: StatKey; label: string; color: ModuleColor }[] = [
    { key: 'Performance', label: 'Performance', color: 'Red' },
    { key: 'Quality', label: 'Quality', color: 'Yellow' },
    { key: 'Efficiency', label: 'Efficiency', color: 'Green' },
];

// Every effect a module can roll. Receiver, Side and Top Mount only pay off where the module sits
const EFFECTS: ItemEffect[] = ['Premium', 'Inferior', 'Overcharged', 'Negative Feedback', 'Learning Algorithm', 'Degrading', 'Receiver', 'Side Mount', 'Top Mount'];

/* Effects that never come together on one module (ModuleEffectHelper: incompatibleWithEffects; a module rolls at most two different
 * effects), so the builder only offers pairs the game can make
 */
const INCOMPATIBLE: Partial<Record<ItemEffect, ItemEffect[]>> = {
    Premium: ['Inferior', 'Learning Algorithm'],
    Inferior: ['Premium', 'Learning Algorithm'],
    Overcharged: ['Learning Algorithm'],
    Degrading: ['Learning Algorithm'],
    'Negative Feedback': ['Learning Algorithm'],
    'Learning Algorithm': ['Degrading', 'Overcharged', 'Premium', 'Inferior', 'Negative Feedback'],
};
const canPair = (a: ItemEffect, b: ItemEffect) => a !== b && !(INCOMPATIBLE[a] ?? []).includes(b);

// Degrading starts at twice the module's best stat and loses 1% a use; Learning Algorithm starts at 0 and gains 1% a use up to twice it
const hasProgress = (e: ItemEffect) => e === 'Degrading' || e === 'Learning Algorithm';
const maxValue = (template: ModuleTemplate) => {
    const base = getBaseStats(template);
    return Math.floor(Math.max(0, base.Performance, base.Quality, base.Efficiency) * 2);
};

/* The module types to build from, in the order players know them: the basic and high-tier module of each stat, the two Neural Cores
 * and the node. Each type has its shapes (MODULE_TEMPLATES); Neural Cores and nodes come without effects.
 * The game's shapes, from its sprites (items_module) and PreBuiltItemHelper: a basic module is a square, an L or a T of 4 cells, or
 * a 3-cell L at 75% of the stats (SetBasicModuleShape); a high-tier one a square, or a P or C of 5 cells at 125% (SetAdvancedModuleShape),
 * the same for all three colours. The 4-cell L and T high-tier shapes stay known to the site (old codes and saves) but are not offered
 */
const NOT_IN_GAME = new Set(['L4_High', 'T4_High']);
/* Machine-specific modules: they only fit one machine and are there for what they do, not their stats (no effects roll on them).
 * Grouped by machine, each with the game's own effect text (Localization: module_effect_*, item_dna_module_*_effect)
 */
// [name, effect, short label on its chip]
const MACHINE_SPECIFIC: { machine: string; icon: string; note?: string; modules: [string, string, string][] }[] = [
    { machine: 'Alarm System', icon: 'alarm_system', note: 'also fits the Cryptographic Desequencer', modules: [['Alarm Transmitter Module', 'Gain +1 reputation per night', 'Transmitter']] },
    { machine: 'Furnace', icon: 'furnace', modules: [
        ['Furnace Module (Blast)', '3 materials make 2 ingots a night, one purity stage lower', 'Blast'],
        ['Furnace Module (Junk Processing)', 'Convert 6 Junk into 4 Scrap Metal', 'Junk Processing'],
    ] },
    { machine: 'Hydroponic System', icon: 'hydroponic', modules: [
        ['Nutrifruit Hydroponic Module', 'Nutrifruit yield +1', 'Nutrifruit'],
        ['Dream Cap Neutralizer Hydroponic Module', 'Removes Dream Cap contraband status, makes it food, Dream Cap yield +2', 'Dream Cap Neutralizer'],
        ['Dream Cap Nightmare Hydroponic Module', 'Farmed Dream Cap will be Nightmare Cap', 'Dream Cap Nightmare'],
        ['Kotton Auto Loom Hydroponic Module', 'Produce Kotton Fabric instead of Kotton Fiber', 'Kotton Auto Loom'],
        ['Fillerweed Production Hydroponic Module', 'Fillerweed yield +4, but no seeds', 'Fillerweed Production'],
        ['Hydroreed Filter Hydroponic Module', 'Hydroreed Filter yield +1', 'Hydroreed Filter'],
        ['Hydroponic Smuggler Module', 'Removes the contraband status of growing seeds', 'Smuggler'],
    ] },
    { machine: 'DNA Manipulator', icon: 'dna_manipulator', modules: [
        ['Genetic Stabilizer Module', 'The target survives extraction', 'Stabilizer'],
        ['Positive Trait Filter Module', 'Extracts positive traits only', 'Positive Filter'],
        ['Negative Trait Filter Module', 'Extracts negative traits only', 'Negative Filter'],
        ['Precision Extraction Module', 'Extracts the scanned trait only', 'Precision Extraction'],
    ] },
    { machine: '3D Printer', icon: 'printer', modules: [
        ['Metal Printer Module', 'Metal printing (chips that print from ingots)', 'Metal Printing'],
        ['Computer Numerical Control Module', 'CNC (gun frame and gun part chips)', 'CNC'],
        ['Melee Batch Module', 'Printed melee weapon output +1', 'Melee Batch'],
    ] },
    { machine: 'Evaporator', icon: 'evaporator', modules: [['Evaporator Solvent Recovery Module', 'Only alcohol is recovered', 'Solvent Recovery']] },
];
// Text colour for the special colours too dark to read on the menu
const SPECIAL_TEXT: Partial<Record<ModuleColor, string>> = { DarkRed: '#e57373', Grey: '#b0b0b0' };
const MACHINE_OF = new Map(MACHINE_SPECIFIC.flatMap(g => g.modules.map(([name, effect]) => [name, { machine: g.machine, effect }] as const)));

type ModuleType = { name: string; color: ModuleColor; shapes: ModuleTemplate[]; effects: boolean; machine?: string; effect?: string };
const TYPES: ModuleType[] = (() => {
    const types: ModuleType[] = [];
    for (const template of MODULE_TEMPLATES) {
        const special = MACHINE_OF.get(template.displayName);
        if (special) {
            types.push({ name: template.displayName, color: template.color, shapes: [template], effects: false, ...special });
            continue;
        }
        if (template.group === 'Special' && template.color !== 'Purple') continue;
        if (NOT_IN_GAME.has(template.shape)) continue;
        let type = types.find(ty => ty.name === template.displayName);
        if (!type) {
            type = { name: template.displayName, color: template.color, shapes: [], effects: template.color !== 'Purple' };
            types.push(type);
        }
        type.shapes.push(template);
    }
    types.push({ name: NODE_TEMPLATE.displayName, color: NODE_TEMPLATE.color, shapes: [NODE_TEMPLATE], effects: false });
    return types;
})();

const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const chip = (on: boolean, color = '#8fd19e', off = false) => ({
    padding: '5px 9px', borderRadius: '5px', cursor: off ? 'not-allowed' : 'pointer', fontSize: '0.85em', opacity: off ? 0.35 : 1,
    border: `1px solid ${on ? color : '#3a3a3c'}`, background: on ? 'rgba(255,255,255,0.08)' : '#232325', color: on ? color : '#ccc',
});
const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid #2c2c2e' }}>
        <div style={{ fontSize: '0.72em', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '7px' }}>
            <span style={{ color: '#8fd19e', fontWeight: 'bold', marginRight: '6px' }}>{n}</span>{title}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{children}</div>
    </div>
);

export default function AddModuleMenu({ onAdd, disabled }: { onAdd: (item: InventoryItem) => void; disabled?: boolean }) {
    useLang();
    const [open, setOpen] = useState(false);
    const [typeIdx, setTypeIdx] = useState(0);
    const [shapeIdx, setShapeIdx] = useState(0);
    const [effects, setEffects] = useState<ItemEffect[]>([]);
    const [progress, setProgress] = useState<number | null>(null);
    const [added, setAdded] = useState<string | null>(null);
    // The machine-specific modules fold away; open when one of them is the picked type
    const [specialsOpen, setSpecialsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', esc);
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
    }, [open]);

    const type = TYPES[typeIdx];
    const template = type.shapes[Math.min(shapeIdx, type.shapes.length - 1)];
    const max = maxValue(template);
    const progressEffect = effects.find(hasProgress);
    // Learning starts empty and Degrading full, until the slider is moved
    const value = progressEffect ? Math.min(max, progress ?? (progressEffect === 'Degrading' ? max : 0)) : 0;

    const item = useMemo((): InventoryItem => {
        const effs: [ItemEffect, ItemEffect] = [effects[0] ?? 'None', effects[1] ?? 'None'];
        return {
            // No uid: a module that is not in the save, so the mod export leaves it out
            id: '',
            shape: template.shape, color: template.color, displayName: template.displayName,
            effects: effs, effectValues: [hasProgress(effs[0]) ? value : 0, hasProgress(effs[1]) ? value : 0], isInfinite: false, isLocked: false,
        };
    }, [template, effects, value]);
    const stats = applyInternalEffects(item);

    const pickType = (i: number) => { setTypeIdx(i); if (TYPES[i].machine) setSpecialsOpen(true); setShapeIdx(0); if (!TYPES[i].effects) setEffects([]); setProgress(null); };
    // Clicking an effect adds it (up to two, in the order picked, as the game lists them) or takes it off again
    const toggleEffect = (e: ItemEffect) => {
        setEffects(prev => (prev.includes(e) ? prev.filter(x => x !== e) : prev.length < 2 ? [...prev, e] : prev));
        if (hasProgress(e)) setProgress(null);
    };
    const add = () => {
        onAdd({ ...item, id: `${template.shape}_${template.color}_added_${Math.random().toString(36).substring(2, 8)}` });
        setAdded([moduleName(template.displayName), ...effects.map(e => (hasProgress(e) ? `${t(e)} ${value}%` : t(e)))].join(' · '));
    };

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => { setOpen(o => !o); setAdded(null); setSpecialsOpen(Boolean(type.machine)); }}
                disabled={disabled}
                title={t('Add a module that is not in your save')}
                style={{
                    background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#eee',
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontSize: '0.9em', padding: '6px 14px'
                }}
            >
                {t('+ Add Module')}
            </button>
            {open && (
                <div style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200, width: 'min(560px, calc(100vw - 32px))', maxHeight: '75vh', overflowY: 'auto',
                    backgroundColor: '#1c1c1e', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                }}>
                    <Step n={1} title={t('Type')}>
                        {TYPES.map((ty, i) => ty.machine ? null : (
                            <button key={ty.name} onClick={() => pickType(i)} style={chip(i === typeIdx, COLOR_MAP[ty.color])}>
                                <span style={{ color: COLOR_MAP[ty.color] }}>{moduleName(ty.name)}</span>
                            </button>
                        ))}
                        {/* Machine-specific modules: folded away behind their header, a small card per machine with its icon */}
                        <div style={{ width: '100%', marginTop: '6px', borderTop: '1px solid #2c2c2e', paddingTop: '8px' }}>
                            <button onClick={() => setSpecialsOpen(o => !o)} aria-expanded={specialsOpen}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
                                    color: '#aaa', fontSize: '0.78em', textAlign: 'left' }}>
                                <span style={{ display: 'inline-block', width: '10px', transform: specialsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                                <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('Machine-specific')}</span>
                                <span style={{ color: '#666' }}>{t('{n} modules for {m} machines', { n: MACHINE_OF.size, m: MACHINE_SPECIFIC.length })}</span>
                                {type.machine && !specialsOpen && <span style={{ marginLeft: 'auto', color: '#9ab' }}>{moduleName(type.name)}</span>}
                            </button>
                            {specialsOpen && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px', marginTop: '8px' }}>
                                    {MACHINE_SPECIFIC.map(g => (
                                        <div key={g.machine} style={{ background: '#202022', border: '1px solid #2c2c2e', borderRadius: '6px', padding: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                <img src={`${import.meta.env.BASE_URL}machines/${g.icon}.png`} alt="" width={24} height={24} style={{ imageRendering: 'pixelated', flex: 'none' }} />
                                                <span style={{ fontSize: '0.8em', color: '#ddd', fontWeight: 'bold' }}>{t(g.machine)}</span>
                                                {g.note && <span title={t(g.note)} style={{ fontSize: '0.7em', color: '#777' }}>{t('+ Desequencer')}</span>}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                                {g.modules.map(([name, , short]) => {
                                                    const i = TYPES.findIndex(ty => ty.name === name);
                                                    const ty = TYPES[i];
                                                    const color = SPECIAL_TEXT[ty.color] ?? COLOR_MAP[ty.color];
                                                    return (
                                                        <button key={name} onClick={() => pickType(i)} title={`${moduleName(name)}: ${t(ty.effect!)}`} style={chip(i === typeIdx, color)}>
                                                            <span style={{ color }}>{t(short)}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Step>

                    <Step n={2} title={t('Shape')}>
                        {type.shapes.map((sh, i) => {
                            const base = getBaseStats(sh);
                            return (
                                <button key={sh.shape} onClick={() => { setShapeIdx(i); setProgress(null); }}
                                    title={STATS.filter(s => base[s.key] !== 0).map(s => `${t(s.label)} ${fmt(base[s.key])}%`).join(', ')}
                                    style={{ ...chip(sh === template, COLOR_MAP[type.color]), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: '62px' }}>
                                    <span style={{ height: '34px', display: 'flex', alignItems: 'center', transform: 'scale(0.6)' }}>
                                        <MiniShape shape={sh.shape} colorHex={COLOR_MAP[sh.color]} />
                                    </span>
                                    <span style={{ fontSize: '0.85em' }}>{t('{n} cells', { n: sh.size })}</span>
                                </button>
                            );
                        })}
                    </Step>

                    {type.effects && (
                        <Step n={3} title={t('Effects (up to two)')}>
                            {EFFECTS.map(e => {
                                const on = effects.includes(e);
                                const blocked = !on && (effects.length >= 2 || effects.some(x => !canPair(x, e)));
                                return (
                                    <button key={e} onClick={() => !blocked && toggleEffect(e)} disabled={blocked} style={chip(on, '#9ab', blocked)}
                                        title={blocked && effects.length < 2 ? t('The game never puts this with {other}', { other: effects.filter(x => !canPair(x, e)).map(x => t(x)).join(', ') }) : undefined}>
                                        {on && effects.length === 2 ? `${effects.indexOf(e) + 1}. ` : ''}{t(e)}
                                    </button>
                                );
                            })}
                        </Step>
                    )}

                    {progressEffect && (
                        <Step n={4} title={progressEffect === 'Learning Algorithm' ? t('Learning progress') : t('Degrading: what is left')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                                <input type="range" min={0} max={max} step={1} value={value} onChange={e => setProgress(Number(e.target.value))}
                                    style={{ flex: 1, accentColor: '#8fd19e' }} />
                                <span style={{ minWidth: '92px', textAlign: 'right', color: '#ddd', fontVariantNumeric: 'tabular-nums', fontSize: '0.85em' }}>
                                    {value}% / {max}%
                                </span>
                            </div>
                            <div style={{ width: '100%', fontSize: '0.75em', color: '#777' }}>
                                {progressEffect === 'Learning Algorithm'
                                    ? t('Starts at 0% and gains 1% a use, up to {max}%. Set it to what the module shows in the game', { max })
                                    : t('Starts at {max}% and loses 1% a use. Set it to what the module shows in the game', { max })}
                            </div>
                        </Step>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#202022' }}>
                        <span style={{ transform: 'scale(0.6)', display: 'flex' }}>
                            <MiniShape shape={template.shape} colorHex={COLOR_MAP[template.color]} />
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.85em' }}>
                            <span style={{ color: SPECIAL_TEXT[template.color] ?? COLOR_MAP[template.color], fontWeight: 'bold' }}>{moduleName(template.displayName)}</span>
                            {effects.length > 0 && <span style={{ color: '#9ab' }}> · {effects.map(e => t(e)).join(' · ')}</span>}
                            {type.machine && <div style={{ color: '#9ab', marginTop: '2px' }}>{t('{machine} only', { machine: t(type.machine) })}: {t(type.effect!)}</div>}
                            <div style={{ fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>
                                {STATS.filter(s => stats[s.key] !== 0).length === 0 && <span style={{ color: '#777' }}>{t('No stats of its own')}</span>}
                                {STATS.filter(s => stats[s.key] !== 0).map(s => (
                                    <span key={s.key} style={{ marginRight: '10px', color: COLOR_MAP[s.color] }}>{t(s.label)} {fmt(stats[s.key])}%</span>
                                ))}
                            </div>
                            {added && <div style={{ color: '#4caf50', fontSize: '0.85em', marginTop: '2px' }}>{t('Added {item} to storage', { item: added })}</div>}
                        </span>
                        <button onClick={add}
                            style={{ padding: '7px 16px', borderRadius: '6px', border: '1px solid #2e4a35', background: 'rgba(76, 175, 80, 0.15)', color: '#8fd19e', cursor: 'pointer', fontWeight: 'bold' }}>
                            {t('Add to storage')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
