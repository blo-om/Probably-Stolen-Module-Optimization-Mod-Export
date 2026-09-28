import React, { useEffect, useRef, useState } from 'react';
import type { Stats } from '../types';
import {
    statBreakpoints, statUnit, statName, statHasNoEffect,
    isDesequencer, DESEQUENCER_CHIPSETS, desequencerDayOptions, desequencerDaysAt,
} from '../machineDefaults';
import type { StatUnit } from '../machineDefaults';

type StatKey = 'Performance' | 'Quality' | 'Efficiency';

const STATS: StatKey[] = ['Performance', 'Quality', 'Efficiency'];

const C = {
    text: '#ddd',
    sub: '#8a8a8a',
    muted: '#5f5f5f',
    goalBg: '#1d3323',
    goalBorder: '#3f7a4c',
    goalText: '#9fd8a9',
    ok: '#4caf50',
    short: '#e0a13a',
    field: '#111',
    fieldBorder: '#444',
};

const fmtPct = (v: number) => `${Math.trunc(v)}%`;
const round2 = (v: number) => Math.round(v * 100) / 100;

// Target typed in a machine's own unit (e.g. ml/day), stored as the % target the solver works with
// Keeps its own draft while typing, since converting every keystroke would rewrite a half-typed number
const TargetInput = ({ unit, target, onChange, disabled }: { unit: StatUnit | null; target: number | null; onChange: (pct: number) => void; disabled: boolean }) => {
    const shown = target === null ? '' : String(unit ? unit.fromPercent(target) : target);
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (text: string) => {
        if (text.trim() === '' || isNaN(Number(text))) return;
        onChange(unit ? unit.toPercent(Number(text)) : Math.round(Number(text)));
    };
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <input
                type="number"
                step={unit ? unit.step : 1}
                value={draft ?? shown}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => { commit(e.target.value); setDraft(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                disabled={disabled}
                title={unit?.hint}
                style={{ width: '64px', padding: '2px 4px', fontSize: '0.8em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px', textAlign: 'center' }}
            />
            <span style={{ fontSize: '0.75em', color: C.sub }}>{unit ? unit.unit : '%'}</span>
        </span>
    );
};

const Option = ({ label, selected, title, onClick, disabled, dim }: { label: string; selected: boolean; title?: string; onClick: () => void; disabled: boolean; dim?: boolean }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        style={{
            padding: '2px 9px', fontSize: '0.75em', borderRadius: '4px', cursor: disabled ? 'not-allowed' : 'pointer',
            backgroundColor: selected ? C.goalBg : 'transparent',
            color: selected ? C.goalText : dim ? C.muted : C.sub,
            border: `1px solid ${selected ? C.goalBorder : '#3a3a3a'}`,
        }}
    >
        {label}
    </button>
);

const selectStyle: React.CSSProperties = { padding: '2px', fontSize: '0.75em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px' };

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
};

// One line per stat: name, where it is now, and a pill with its goal. Clicking the pill opens that stat's options
export const StatGoals = ({ machineType, machineId, totals, ignoreStats, targetStats, setIgnoreStats, setTargetStats, disabled, hasBlast }: Props) => {
    const [open, setOpen] = useState<StatKey | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // Clicking anywhere else closes the open row
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

    return (
        <div ref={rootRef} style={{ width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {STATS.map((stat) => {
                const off = Boolean(ignoreStats[stat]);
                const target = targetStats[stat];
                const total = totals[stat];

                // A stat that does nothing here is not shown while it is off
                if (off && statHasNoEffect(machineType, stat)) return null;

                const name = statName(machineType, stat);
                const unit = statUnit(machineType, stat);
                const deseq = stat === 'Performance' && isDesequencer(machineType);
                const breakpoints = deseq ? null : statBreakpoints(machineType, stat, hasBlast);
                const isOpen = open === stat;

                // Chipset in use: the saved pick (Command until one is made) if the goal is one of its steps, else the first chipset the goal belongs to
                const work = (() => {
                    const preferred = chipset ?? 150;
                    if (!deseq || target === null) return preferred;
                    const fits = (w: number) => desequencerDayOptions(w).some(o => o.value === target);
                    if (fits(preferred)) return preferred;
                    return DESEQUENCER_CHIPSETS.find(c => fits(c.work))?.work ?? preferred;
                })();
                const chip = DESEQUENCER_CHIPSETS.find(c => c.work === work)!;
                const daysFor = (value: number) => desequencerDayOptions(work).find(o => o.value === value)?.days;

                // Where the machine is now, in the stat's own terms
                const reached = breakpoints ? [...breakpoints].reverse().find(b => total >= b.value) : undefined;
                const now = unit
                    ? (unit.readout ? unit.readout(unit.fromPercent(total)) : `${unit.fromPercent(total)} ${unit.unit}`)
                    : deseq ? `${chip.short} ${desequencerDaysAt(work, total)}d`
                    : breakpoints ? `${reached ? (reached.short ?? reached.label) : '–'} · ${fmtPct(total)}`
                    : fmtPct(total);

                // The goal pill
                const pick = breakpoints?.find(b => b.value === target);
                const pill = off ? 'Off'
                    : target === null ? 'Max'
                    : deseq && daysFor(target) !== undefined ? `${chip.short} ${daysFor(target)}d`
                    : pick ? (pick.short ?? pick.label)
                    : unit ? `${unit.fromPercent(target)} ${unit.unit}`
                    : `${target}%`;

                // Met, or how far off. In Max, a stepped stat shows its next step
                let status: React.ReactNode = null;
                const isShort = !off && target !== null && total < target;
                if (!off && target !== null) {
                    status = isShort
                        ? <span style={{ color: C.short }}>{unit ? round2(unit.fromPercent(target) - unit.fromPercent(total)) : `${Math.ceil(target - total)}%`} short</span>
                        : <span style={{ color: C.ok }}>✓</span>;
                } else if (!off && breakpoints) {
                    const next = breakpoints.find(b => b.value > total);
                    if (next) status = <span style={{ color: C.muted }}>{next.short ?? next.label} at {next.value}%</span>;
                }

                const nextStepAbove = (steps: { value: number }[]) => (steps.find(s => s.value > total) ?? steps[steps.length - 1]).value;
                const chooseMax = () => { setOff(stat, false); setTarget(stat, null); };
                const chooseGoal = (value: number) => { setOff(stat, false); setTarget(stat, value); };

                let goalOptions: React.ReactNode;
                if (deseq) {
                    const options = desequencerDayOptions(work);
                    goalOptions = (
                        <>
                            <select value={work} disabled={disabled} style={selectStyle}
                                onChange={(e) => { const w = Number(e.target.value); setChipset(w); chooseGoal(nextStepAbove(desequencerDayOptions(w))); }}>
                                {DESEQUENCER_CHIPSETS.map(c => <option key={c.work} value={c.work}>{c.name}</option>)}
                            </select>
                            <select value={!off && target !== null ? target : ''} disabled={disabled} style={selectStyle}
                                onChange={(e) => chooseGoal(Number(e.target.value))}>
                                {(off || target === null) && <option value="">days</option>}
                                {options.map(o => <option key={o.value} value={o.value}>{o.days}d</option>)}
                                {!off && target !== null && !options.some(o => o.value === target) && <option value={target}>{target}%</option>}
                            </select>
                        </>
                    );
                } else if (breakpoints) {
                    goalOptions = breakpoints.map(b => (
                        <Option key={b.value} label={b.short ?? b.label} selected={!off && target === b.value}
                            title={`${b.label}: ${b.hint} (${b.value}%)`} onClick={() => chooseGoal(b.value)} disabled={disabled} />
                    ));
                } else {
                    goalOptions = <TargetInput unit={unit} target={off ? null : target} onChange={(pct) => chooseGoal(pct)} disabled={disabled} />;
                }

                return (
                    <div key={stat} style={{ padding: '4px 2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '24px' }}>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '6px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                <span style={{ fontSize: '0.82em', color: off ? C.muted : C.text }}>{name}</span>
                                {!off && <span style={{ fontSize: '0.75em', color: C.sub }}>{now}</span>}
                            </div>
                            {status && <span style={{ fontSize: '0.72em', whiteSpace: 'nowrap' }}>{status}</span>}
                            <button
                                type="button"
                                onClick={() => setOpen(isOpen ? null : stat)}
                                disabled={disabled}
                                style={{
                                    padding: '1px 10px', fontSize: '0.75em', borderRadius: '999px', whiteSpace: 'nowrap',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    backgroundColor: !off && target !== null ? C.goalBg : 'transparent',
                                    color: off ? C.muted : target !== null ? C.goalText : C.text,
                                    border: `1px ${off ? 'dashed' : 'solid'} ${off ? '#444' : target !== null ? C.goalBorder : '#555'}`,
                                    outline: isOpen ? `1px solid ${C.goalBorder}` : 'none', outlineOffset: '1px',
                                }}
                            >
                                {pill}
                            </button>
                        </div>
                        {isShort && target! > 0 && (
                            <div style={{ height: '2px', background: '#262626', borderRadius: '1px', overflow: 'hidden', marginTop: '3px' }}>
                                <div style={{ width: `${Math.max(0, Math.min(1, total / target!)) * 100}%`, height: '100%', background: C.short }} />
                            </div>
                        )}
                        {isOpen && (
                            <div onKeyDown={(e) => e.stopPropagation()} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', padding: '6px 0 2px' }}>
                                <Option label="Off" dim selected={off} onClick={() => setOff(stat, true)} disabled={disabled} />
                                <Option label="Max" selected={!off && target === null} onClick={chooseMax} disabled={disabled} />
                                <span style={{ width: '1px', alignSelf: 'stretch', background: '#3a3a3a', margin: '0 2px' }} />
                                {goalOptions}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
