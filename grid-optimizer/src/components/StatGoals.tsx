import React, { useEffect, useRef, useState } from 'react';
import type { Stats } from '../types';
import {
    statBreakpoints, statUnit, statName, statHasNoEffect,
    isDesequencer, DESEQUENCER_CHIPSETS, desequencerDayOptions, desequencerDaysAt,
} from '../machineDefaults';
import type { StatBreakpoint, StatUnit } from '../machineDefaults';

type StatKey = 'Performance' | 'Quality' | 'Efficiency';
type Mode = 'auto' | 'target' | 'off';

const STATS: StatKey[] = ['Performance', 'Quality', 'Efficiency'];

const C = {
    card: '#1a1a1a',
    cardBorder: '#2c2c2c',
    text: '#eee',
    sub: '#8a8a8a',
    muted: '#555',
    accentBg: '#1d3323',
    accentBorder: '#3f7a4c',
    accentText: '#9fd8a9',
    met: '#4caf50',
    short: '#e0a13a',
    far: '#e2603f',
    field: '#111',
    fieldBorder: '#444',
};

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${Math.trunc(v)}%`;
const round2 = (v: number) => Math.round(v * 100) / 100;
// Long step names (e.g. "+1 purity, flux free") use their short form in the big readout
const stepName = (b: StatBreakpoint) => (b.label.length > 12 && b.short ? b.short : b.label);

// Target typed in a machine's own unit (e.g. ml/day), stored as the % target the solver works with
// Keeps its own draft while typing, since converting every keystroke would rewrite a half-typed number
const TargetInput = ({ unit, target, onChange, disabled, totals }: { unit: StatUnit | null; target: number | null; onChange: (pct: number) => void; disabled: boolean; totals: Stats }) => {
    const shown = target === null ? '' : String(unit ? unit.fromPercent(target, totals) : target);
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (text: string) => {
        if (text.trim() === '' || isNaN(Number(text))) return;
        onChange(unit ? unit.toPercent(Number(text), totals) : Math.round(Number(text)));
    };
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <input
                type="number"
                step={unit ? unit.step : 1}
                value={draft ?? shown}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => { commit(e.target.value); setDraft(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                disabled={disabled}
                title={unit?.hint}
                style={{ width: '80px', padding: '3px 6px', fontSize: '0.85em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px', textAlign: 'center' }}
            />
            <span style={{ fontSize: '0.8em', color: C.sub }}>{unit ? unit.unit : '%'}</span>
        </span>
    );
};

const Choice = ({ label, selected, title, onClick, disabled }: { label: string; selected: boolean; title?: string; onClick: () => void; disabled: boolean }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        style={{
            padding: '3px 10px', fontSize: '0.78em', borderRadius: '4px', cursor: disabled ? 'not-allowed' : 'pointer',
            backgroundColor: selected ? C.accentBg : 'transparent',
            color: selected ? C.accentText : '#bbb',
            border: `1px solid ${selected ? C.accentBorder : '#3a3a3a'}`,
        }}
    >
        {label}
    </button>
);

const selectStyle: React.CSSProperties = { padding: '3px', fontSize: '0.8em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px' };

type Props = {
    machineType: string;
    machineId: string;
    totals: Stats;
    ignoreStats: Record<StatKey, boolean>;
    targetStats: Record<StatKey, number | null>;
    setIgnoreStats: (fn: (prev: any) => any) => void;
    setTargetStats: (fn: (prev: any) => any) => void;
    disabled: boolean;
    hasBlast: boolean;
    // Row width in px; the module grid is meant to be 0.8 of it
    width?: number;
};

// Three cards side by side, one per stat: its name, the result it gives this machine, and Auto / Target / Off
// Target's options open in a panel under the cards
export const StatGoals = ({ machineType, machineId, totals, ignoreStats, targetStats, setIgnoreStats, setTargetStats, disabled, hasBlast, width }: Props) => {
    const [open, setOpen] = useState<StatKey | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // Clicking anywhere else closes the panel
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(null); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const chipsetKey = `optimizer_chipset_${machineId}`;
    const [chipset, setChipsetState] = useState<number | null>(() => {
        try { const v = Number(localStorage.getItem(chipsetKey)); return v ? v : null; } catch { return null; }
    });
    const setChipset = (work: number) => {
        setChipsetState(work);
        try { localStorage.setItem(chipsetKey, String(work)); } catch { /* per-viewer convenience only */ }
    };

    const setTarget = (stat: StatKey, value: number | null) => setTargetStats((prev: any) => ({ ...prev, [stat]: value }));
    const setOff = (stat: StatKey, off: boolean) => setIgnoreStats((prev: any) => ({ ...prev, [stat]: off }));

    // Everything each card and the panel need, per stat
    const info = STATS.map((stat) => {
        const off = Boolean(ignoreStats[stat]);
        const target = targetStats[stat];
        const total = totals[stat];
        const mode: Mode = off ? 'off' : target === null ? 'auto' : 'target';
        const unit = statUnit(machineType, stat);
        const deseq = stat === 'Performance' && isDesequencer(machineType);
        const breakpoints = deseq ? null : statBreakpoints(machineType, stat, hasBlast);

        // Chipset in use: the saved pick (Command until one is made) if the goal is one of its steps, else the first chipset the goal belongs to
        const work = (() => {
            const preferred = chipset ?? 150;
            if (!deseq || target === null) return preferred;
            const fits = (w: number) => desequencerDayOptions(w).some(o => o.value === target);
            if (fits(preferred)) return preferred;
            return DESEQUENCER_CHIPSETS.find(c => fits(c.work))?.work ?? preferred;
        })();
        const chip = DESEQUENCER_CHIPSETS.find(c => c.work === work)!;

        // The result, in the machine's terms
        const reached = breakpoints ? [...breakpoints].reverse().find(b => total >= b.value) : undefined;
        const result = unit
            ? (unit.readout ? unit.readout(unit.fromPercent(total, totals)) : `${unit.fromPercent(total, totals)} ${unit.unit}`)
            : deseq ? `${desequencerDaysAt(work, total)} days`
            : breakpoints ? (reached ? stepName(reached) : `< ${stepName(breakpoints[0])}`)
            : fmtPct(total);
        const detail = deseq ? `${chip.short} · ${fmtPct(total)}` : (unit || breakpoints) ? fmtPct(total) : '';

        // The goal, in the same terms
        const goal = target === null ? null
            : deseq ? (desequencerDayOptions(work).find(o => o.value === target)?.days ?? null) !== null ? `${chip.short} ${desequencerDayOptions(work).find(o => o.value === target)!.days}d` : `${target}%`
            : breakpoints?.find(b => b.value === target) ? stepName(breakpoints.find(b => b.value === target)!)
            : unit ? `${unit.fromPercent(target, totals)} ${unit.unit}`
            : `${target}%`;
        const met = target !== null && total >= target;
        const gap = target === null || met ? null
            : unit?.lowerIsBetter ? `${round2(unit.fromPercent(total, totals) - unit.fromPercent(target, totals))} ${unit.unit} over`
            : unit ? `${round2(unit.fromPercent(target, totals) - unit.fromPercent(total, totals))} ${unit.unit} short`
            : `${Math.ceil(target - total)}% short`;
        // How close an unmet target is, 0..1. A target at or below 0 counts from 100 points under it
        const progress = target === null || met ? null
            : Math.max(0, Math.min(0.99, target > 0 ? total / target : 1 + (total - target) / 100));
        const stateColor = off ? C.muted : target === null ? C.text : met ? C.met : progress! >= 0.75 ? C.short : C.far;

        const nextStepAbove = (steps: { value: number }[]) => (steps.find(s => s.value > total) ?? steps[steps.length - 1]).value;
        const defaultTarget = deseq ? nextStepAbove(desequencerDayOptions(work))
            : breakpoints ? nextStepAbove(breakpoints)
            : Math.max(0, Math.ceil(total));

        return { stat, off, target, total, mode, unit, deseq, breakpoints, work, result, detail, goal, met, gap, progress, stateColor, defaultTarget, nextStepAbove };
    });

    const choose = (stat: StatKey, mode: Mode, current: typeof info[number]) => {
        if (mode === 'off') { setOff(stat, true); if (open === stat) setOpen(null); return; }
        setOff(stat, false);
        if (mode === 'auto') { setTarget(stat, null); if (open === stat) setOpen(null); return; }
        if (current.target === null) setTarget(stat, current.defaultTarget);
        setOpen(open === stat && current.mode === 'target' ? null : stat);
    };

    const panel = open ? info.find(i => i.stat === open)! : null;

    return (
        <div ref={rootRef} style={{ width: width ? `${width}px` : '100%', maxWidth: '100%', alignSelf: 'center', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px' }}>
                {info.map((i) => {
                    const noEffect = statHasNoEffect(machineType, i.stat) && i.off;
                    const color = i.stateColor;
                    const isOpen = open === i.stat;
                    // Border follows the state too, faintly: green met, amber/red short, accent while its options are open
                    const border = isOpen ? C.accentBorder : i.mode !== 'target' ? C.cardBorder : i.met ? '#2f5e37' : i.progress! >= 0.75 ? '#6b5320' : '#6e3326';
                    return (
                        <div key={i.stat} style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '3px', minWidth: 0,
                            backgroundColor: C.card, borderRadius: '6px', padding: '5px 3px 3px',
                            border: `1px solid ${border}`,
                        }}>
                            <span style={{ fontSize: '0.66em', color: C.sub, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center' }}>
                                {statName(machineType, i.stat)}
                            </span>
                            {noEffect ? (
                                <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75em', color: C.muted, minHeight: '38px' }}>No effect</span>
                            ) : (
                                <>
                                    <div style={{ textAlign: 'center', minHeight: '38px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px' }}>
                                        <div style={{ fontSize: '1.05em', fontWeight: 'bold', color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={i.result}>
                                            {i.result}
                                        </div>
                                        <div style={{ fontSize: '0.65em', color: i.mode === 'target' ? color : C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                            title={i.gap ?? undefined}>
                                            {i.off ? 'off' : i.mode === 'target' ? (i.met ? `✓ ${i.goal}` : `→ ${i.goal} · ${Math.floor(i.progress! * 100)}%`) : i.detail}
                                        </div>
                                        {i.progress !== null && (
                                            <div style={{ height: '3px', margin: '2px 4px 0', background: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ width: `${i.progress * 100}%`, height: '100%', background: color }} />
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1px' }}>
                                        {(['auto', 'target', 'off'] as Mode[]).map((m) => {
                                            const on = i.mode === m;
                                            return (
                                                <button
                                                    key={m}
                                                    type="button"
                                                    onClick={() => choose(i.stat, m, i)}
                                                    disabled={disabled}
                                                    style={{
                                                        padding: '2px 0', fontSize: '0.62em', borderRadius: '3px', cursor: disabled ? 'not-allowed' : 'pointer', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap',
                                                        backgroundColor: on ? (m === 'off' ? '#2e2e2e' : C.accentBg) : 'transparent',
                                                        color: on ? (m === 'off' ? '#ccc' : C.accentText) : C.sub,
                                                        border: `1px solid ${on ? (m === 'off' ? '#444' : C.accentBorder) : '#333'}`,
                                                    }}
                                                >
                                                    {m === 'auto' ? 'Auto' : m === 'target' ? 'Target' : 'Off'}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {panel && (
                <div onKeyDown={(e) => e.stopPropagation()} style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
                    backgroundColor: C.card, border: `1px solid ${C.accentBorder}`, borderRadius: '6px', padding: '7px 8px',
                }}>
                    <span style={{ fontSize: '0.7em', color: C.sub, textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '2px' }}>
                        {statName(machineType, panel.stat)} target
                    </span>
                    {panel.deseq ? (
                        <>
                            <select value={panel.work} disabled={disabled} style={selectStyle}
                                onChange={(e) => { const w = Number(e.target.value); setChipset(w); setTarget(panel.stat, panel.nextStepAbove(desequencerDayOptions(w))); }}>
                                {DESEQUENCER_CHIPSETS.map(c => <option key={c.work} value={c.work}>{c.name}</option>)}
                            </select>
                            {desequencerDayOptions(panel.work).map(o => (
                                <Choice key={o.value} label={`${o.days}d`} selected={panel.target === o.value}
                                    title={`${o.value}%`} onClick={() => setTarget(panel.stat, o.value)} disabled={disabled} />
                            ))}
                        </>
                    ) : panel.breakpoints ? (
                        panel.breakpoints.map(b => (
                            <Choice key={b.value} label={b.label} selected={panel.target === b.value}
                                title={`${b.hint} (${b.value}%)`} onClick={() => setTarget(panel.stat, b.value)} disabled={disabled} />
                        ))
                    ) : (
                        <TargetInput unit={panel.unit} target={panel.target} totals={totals} onChange={(pct) => setTarget(panel.stat, pct)} disabled={disabled} />
                    )}
                    {panel.gap && <span style={{ marginLeft: 'auto', fontSize: '0.75em', color: C.short }}>{panel.gap}</span>}
                </div>
            )}
        </div>
    );
};
