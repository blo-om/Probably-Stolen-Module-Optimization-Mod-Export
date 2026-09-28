import React, { useState } from 'react';
import type { Stats } from '../types';
import {
    statBreakpoints, statUnit, statName, statHasNoEffect,
    isDesequencer, DESEQUENCER_CHIPSETS, desequencerDayOptions, desequencerDaysAt,
} from '../machineDefaults';
import type { StatBreakpoint, StatUnit } from '../machineDefaults';

type StatKey = 'Performance' | 'Quality' | 'Efficiency';
type Mode = 'off' | 'max' | 'goal';

const STATS: StatKey[] = ['Performance', 'Quality', 'Efficiency'];

const C = {
    rowBorder: '#2c2c2c',
    text: '#ddd',
    sub: '#8a8a8a',
    muted: '#5f5f5f',
    onBg: '#1d3323',
    onBorder: '#3f7a4c',
    onText: '#9fd8a9',
    ok: '#4caf50',
    short: '#e0a13a',
    field: '#111',
    fieldBorder: '#444',
};

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${Math.trunc(v)}%`;

// Target typed in a machine's own unit (e.g. ml/day), stored as the % target the solver works with
// Keeps its own draft while typing, since converting every keystroke would rewrite a half-typed number
const UnitTargetInput = ({ unit, target, onChange, disabled }: { unit: StatUnit | null; target: number | null; onChange: (pct: number | null) => void; disabled: boolean }) => {
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
                style={{ width: '64px', padding: '3px 4px', fontSize: '0.8em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px', textAlign: 'center' }}
            />
            <span style={{ fontSize: '0.75em', color: C.sub }}>{unit ? unit.unit : '%'}</span>
        </span>
    );
};

const Chip = ({ label, selected, reached, title, onClick, disabled }: { label: string; selected: boolean; reached: boolean; title?: string; onClick: () => void; disabled: boolean }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        style={{
            padding: '2px 8px', fontSize: '0.75em', borderRadius: '4px', cursor: disabled ? 'not-allowed' : 'pointer',
            backgroundColor: selected ? C.onBg : 'transparent',
            color: selected ? C.onText : reached ? C.text : C.sub,
            border: `1px ${reached && !selected ? 'dashed' : 'solid'} ${selected ? C.onBorder : reached ? '#666' : '#3a3a3a'}`,
        }}
    >
        {label}
    </button>
);

const ModeSwitch = ({ mode, onChange, disabled }: { mode: Mode; onChange: (m: Mode) => void; disabled: boolean }) => (
    <div role="radiogroup" style={{ display: 'inline-flex', border: `1px solid ${C.fieldBorder}`, borderRadius: '5px', overflow: 'hidden', flexShrink: 0 }}>
        {(['off', 'max', 'goal'] as Mode[]).map((m) => (
            <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => onChange(m)}
                disabled={disabled}
                style={{
                    padding: '2px 8px', fontSize: '0.72em', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                    backgroundColor: mode === m ? (m === 'off' ? '#333' : C.onBg) : 'transparent',
                    color: mode === m ? (m === 'off' ? C.text : C.onText) : C.sub,
                    borderLeft: m === 'off' ? 'none' : `1px solid ${C.fieldBorder}`,
                }}
            >
                {m === 'off' ? 'Off' : m === 'max' ? 'Max' : 'Goal'}
            </button>
        ))}
    </div>
);

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

// One row per stat: what it does on this machine, what it is now, and Off / Max / a goal in the machine's own terms
export const StatGoals = ({ machineType, machineId, totals, ignoreStats, targetStats, setIgnoreStats, setTargetStats, disabled, hasBlast }: Props) => {
    const chipsetKey = `optimizer_chipset_${machineId}`;
    const [chipset, setChipsetState] = useState<number | null>(() => {
        try { const v = Number(localStorage.getItem(chipsetKey)); return v ? v : null; } catch { return null; }
    });
    const setChipset = (work: number) => {
        setChipsetState(work);
        try { localStorage.setItem(chipsetKey, String(work)); } catch { /* per-viewer convenience only */ }
    };

    const setTarget = (stat: StatKey, value: number | null) => setTargetStats((prev: any) => ({ ...prev, [stat]: value }));

    return (
        <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
            {STATS.map((stat) => {
                const off = Boolean(ignoreStats[stat]);
                const target = targetStats[stat];
                const mode: Mode = off ? 'off' : target === null ? 'max' : 'goal';
                const total = totals[stat];
                const name = statName(machineType, stat);
                const noEffect = statHasNoEffect(machineType, stat);
                const unit = statUnit(machineType, stat);
                const breakpoints = statBreakpoints(machineType, stat, hasBlast);
                const deseq = stat === 'Performance' && isDesequencer(machineType);

                // Chipset in use: the saved pick (Command until one is made) if the current goal is one of its steps,
                // else the first chipset the goal belongs to
                const work = (() => {
                    const preferred = chipset ?? 150;
                    if (!deseq || target === null) return preferred;
                    const fits = (w: number) => desequencerDayOptions(w).some(o => o.value === target);
                    if (fits(preferred)) return preferred;
                    return DESEQUENCER_CHIPSETS.find(c => fits(c.work))?.work ?? preferred;
                })();

                // A stat that does nothing here is one quiet line while it is off
                if (off && noEffect) {
                    return (
                        <div key={stat} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 2px', borderTop: `1px solid ${C.rowBorder}`, fontSize: '0.75em', color: C.muted }}>
                            <span>{stat}</span><span>No effect here</span>
                        </div>
                    );
                }

                const valueText = unit
                    ? (unit.readout ? unit.readout(unit.fromPercent(total)) : `${unit.fromPercent(total)} ${unit.unit}`)
                    : deseq ? `${DESEQUENCER_CHIPSETS.find(c => c.work === work)!.name} in ${desequencerDaysAt(work, total)}d`
                    : breakpoints ? (() => {
                        const reached = [...breakpoints].reverse().find(b => total >= b.value);
                        return reached ? reached.label : `below ${breakpoints[0].label}`;
                    })()
                    : null;

                // First step above where the machine is now, the natural thing to aim for when switching to Goal
                const nextStepAbove = (steps: { value: number }[]) => (steps.find(s => s.value > total) ?? steps[steps.length - 1]).value;

                const changeMode = (m: Mode) => {
                    if (m === mode) return;
                    if (m === 'off') { setIgnoreStats((prev: any) => ({ ...prev, [stat]: true })); return; }
                    if (off) setIgnoreStats((prev: any) => ({ ...prev, [stat]: false }));
                    if (m === 'max') { setTarget(stat, null); return; }
                    if (deseq) setTarget(stat, nextStepAbove(desequencerDayOptions(work)));
                    else if (breakpoints) setTarget(stat, nextStepAbove(breakpoints));
                    else if (unit) setTarget(stat, Math.max(0, Math.ceil(total)));
                    else setTarget(stat, Math.max(0, Math.ceil(total)));
                };

                // Status: met, or how far off in the goal's own terms. In Max, stepped stats show the next step up
                let status: React.ReactNode = null;
                if (mode === 'goal' && target !== null) {
                    if (total >= target) {
                        status = <span style={{ color: C.ok }}>✓ met</span>;
                    } else {
                        const gap = unit
                            ? `${Math.round((unit.fromPercent(target) - unit.fromPercent(total)) * 100) / 100} ${unit.unit}`
                            : `${Math.ceil(target - total)}%`;
                        status = <span style={{ color: C.short }}>{gap} short</span>;
                    }
                } else if (mode === 'max' && breakpoints && !deseq) {
                    const next = breakpoints.find(b => b.value > total);
                    if (next) status = <span style={{ color: C.sub }}>next: {next.short ?? next.label} at {next.value}% (+{Math.ceil(next.value - total)}%)</span>;
                }
                const progress = mode === 'goal' && target !== null && target > 0 ? Math.max(0, Math.min(1, total / target)) : null;

                let goalControl: React.ReactNode = null;
                if (mode === 'goal') {
                    if (deseq) {
                        const options = desequencerDayOptions(work);
                        goalControl = (
                            <>
                                <select
                                    value={work}
                                    disabled={disabled}
                                    onChange={(e) => {
                                        const w = Number(e.target.value);
                                        setChipset(w);
                                        // Its first speed-up above where the machine is now, as when switching to Goal
                                        setTarget(stat, nextStepAbove(desequencerDayOptions(w)));
                                    }}
                                    style={{ padding: '2px', fontSize: '0.75em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px' }}
                                >
                                    {DESEQUENCER_CHIPSETS.map(c => <option key={c.work} value={c.work}>{c.name} ({c.work})</option>)}
                                </select>
                                <select
                                    value={target ?? ''}
                                    disabled={disabled}
                                    onChange={(e) => setTarget(stat, Number(e.target.value))}
                                    style={{ padding: '2px', fontSize: '0.75em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px' }}
                                >
                                    {options.map(o => <option key={o.value} value={o.value}>in {o.days} day{o.days > 1 ? 's' : ''}{o.value === 0 ? ' (base)' : ` (${o.value}%)`}</option>)}
                                    {target !== null && !options.some(o => o.value === target) && <option value={target}>{target}%</option>}
                                </select>
                            </>
                        );
                    } else if (breakpoints) {
                        const custom = target !== null && !breakpoints.some(b => b.value === target);
                        goalControl = (
                            <>
                                {breakpoints.map((b: StatBreakpoint) => (
                                    <Chip
                                        key={b.value}
                                        label={b.short ?? b.label}
                                        selected={target === b.value}
                                        reached={total >= b.value}
                                        title={`${b.label} — ${b.hint} (needs ${b.value}%)`}
                                        onClick={() => setTarget(stat, b.value)}
                                        disabled={disabled}
                                    />
                                ))}
                                {custom && <Chip label={`${target}%`} selected reached={total >= target!} onClick={() => {}} disabled={disabled} />}
                            </>
                        );
                    } else {
                        goalControl = <UnitTargetInput unit={unit} target={target} onChange={(pct) => setTarget(stat, pct)} disabled={disabled} />;
                    }
                }

                // The Desequencer's pickers already say it all; its breakpoint hints mix chipsets
                const pickedHint = deseq ? undefined : breakpoints?.find(b => b.value === target)?.hint;

                return (
                    <div key={stat} style={{ padding: '6px 2px', borderTop: `1px solid ${C.rowBorder}`, display: 'flex', flexDirection: 'column', gap: '5px', opacity: off ? 0.6 : 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                                <span title={name !== stat ? stat : undefined} style={{ fontSize: '0.8em', fontWeight: 'bold', color: C.text }}>{name}</span>
                                <span style={{ fontSize: '0.75em', color: total > 0 ? C.ok : total < 0 ? '#ff4d4d' : C.sub }}>{fmtPct(total)}</span>
                                {valueText && <span style={{ fontSize: '0.72em', color: C.sub }}>{valueText}</span>}
                            </div>
                            <ModeSwitch mode={mode} onChange={changeMode} disabled={disabled} />
                        </div>
                        {(goalControl || status) && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', fontSize: '0.8em' }}>
                                {goalControl}
                                {status && <span style={{ fontSize: '0.9em', marginLeft: 'auto' }}>{status}</span>}
                            </div>
                        )}
                        {mode === 'goal' && pickedHint && <div style={{ fontSize: '0.7em', color: C.sub }}>{pickedHint}</div>}
                        {progress !== null && (
                            <div style={{ height: '3px', background: '#262626', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ width: `${progress * 100}%`, height: '100%', background: progress >= 1 ? C.ok : C.short }} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
