import React, { useEffect, useRef, useState } from 'react';
import type { Stats } from '../types';
import {
    statBreakpoints, statUnit, statName, statHasNoEffect,
    isDesequencer, isMirage, MIRAGE_BASE_POINTS, DESEQUENCER_CHIPSETS, desequencerDayOptions, desequencerDaysAt,
} from '../machineDefaults';
import type { StatBreakpoint, StatUnit } from '../machineDefaults';

type StatKey = 'Performance' | 'Quality' | 'Efficiency';
// auto: optimize; target: reach the value set (for energy, optionally as a ceiling that is still optimized under, see limitStats); off: ignore
type Mode = 'auto' | 'target' | 'off';

const C = {
    card: '#1a1a1a',
    cardBorder: '#2c2c2c',
    divider: '#2c2c2c',
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
// "/day" sits right against its number, "ml/d" after a space
const withUnit = (v: number, unit: string) => (unit.startsWith('/') ? `${v}${unit}` : `${v} ${unit}`);
// Long step names (e.g. "+1 purity, flux free") use their short form in the big readout
const stepName = (b: StatBreakpoint) => (b.label.length > 12 && b.short ? b.short : b.label);
// Below the first step: a counted step ("+1", "+1d") reads as zero of it; a named one (a water grade) as "below" it
const belowFirst = (first: StatBreakpoint) => (first.short && /^\+\d/.test(first.short) ? first.short.replace(/\d+/, '0') : `< ${stepName(first)}`);

// Mirage attractiveness, as points: the base plus Performance plus Quality
const POINTS: StatUnit = {
    unit: 'pts',
    fromPercent: (pct) => pct + MIRAGE_BASE_POINTS,
    toPercent: (pts) => Math.ceil(pts - MIRAGE_BASE_POINTS),
    step: 1,
};

// Target typed in a machine's own unit (e.g. ml/day), stored as the % the solver works with
// Keeps its own draft while typing, since converting every keystroke would rewrite a half-typed number
const TargetInput = ({ unit, target, onChange, disabled, totals, placeholder }: {
    unit: StatUnit | null; target: number | null; onChange: (pct: number | null) => void; disabled: boolean; totals: Stats; placeholder?: string;
}) => {
    const shown = target === null ? '' : String(unit ? unit.fromPercent(target, totals) : target);
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (text: string) => {
        if (text.trim() === '') { if (placeholder) onChange(null); return; }
        if (isNaN(Number(text))) return;
        onChange(unit ? unit.toPercent(Number(text), totals) : Math.round(Number(text)));
    };
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <input
                type="number"
                step={unit ? unit.step : 1}
                value={draft ?? shown}
                placeholder={placeholder}
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

const CHIPSET_PAD = Math.max(...DESEQUENCER_CHIPSETS.map(c => c.name.length)) + 2;
const selectStyle: React.CSSProperties = { padding: '3px', fontSize: '0.8em', backgroundColor: C.field, color: '#eee', border: `1px solid ${C.fieldBorder}`, borderRadius: '4px' };

type Props = {
    machineType: string;
    machineId: string;
    totals: Stats;
    ignoreStats: Record<StatKey, boolean>;
    targetStats: Record<StatKey, number | null>;
    setIgnoreStats: (fn: (prev: any) => any) => void;
    setTargetStats: (fn: (prev: any) => any) => void;
    // Stats in limit mode (see Mode): their target is a ceiling on energy and they are still optimized under it
    limitStats: Record<StatKey, boolean>;
    setLimitStats: (fn: (prev: Record<StatKey, boolean>) => Record<StatKey, boolean>) => void;
    disabled: boolean;
    hasBlast: boolean;
    // Row width in px; the module grid is meant to be 0.8 of it
    width?: number;
};

type Card = {
    key: string;
    name: string;
    result: string;
    color: string;
    progress: number | null;
    tooltip?: string;
    noEffect: boolean;
    modes: Mode[];
    mode: Mode;
    choose: (m: Mode) => void;
    // What opens under the cards for the mode that takes a value (target or limit); null when this card has nothing open
    panel: React.ReactNode;
    gap: string | null;
};

const MODE_LABEL: Record<Mode, string> = { auto: 'Auto', target: 'Target', off: 'Off' };

// One card per stat (the Mirage Projector's Performance and Quality share one): the stat's name, the result it gives this machine,
// and its modes in a strip along the bottom. A mode that takes a value opens its choices under the cards
export const StatGoals = ({ machineType, machineId, totals, ignoreStats, targetStats, setIgnoreStats, setTargetStats, limitStats, setLimitStats, disabled, hasBlast, width }: Props) => {
    const [open, setOpen] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

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
    const setLimit = (stat: StatKey, on: boolean) => setLimitStats(prev => ({ ...prev, [stat]: on }));

    // How close an unmet goal is (0..1), and the colour that goes with it
    const closeness = (value: number, goal: number) =>
        Math.max(0, Math.min(0.99, goal > 0 ? value / goal : 1 + (value - goal) / 100));
    const colorFor = (progress: number) => (progress >= 0.75 ? C.short : C.far);

    const statCard = (stat: StatKey): Card => {
        const off = Boolean(ignoreStats[stat]);
        const target = targetStats[stat];
        const total = totals[stat];
        const unit = statUnit(machineType, stat);
        const energy = Boolean(unit?.lowerIsBetter);
        const deseq = stat === 'Performance' && isDesequencer(machineType);
        const breakpoints = deseq ? null : statBreakpoints(machineType, stat, hasBlast);
        const mode: Mode = off ? 'off' : target === null ? 'auto' : 'target';
        // Energy only: the target is a ceiling (at most this much a day, and less if it can) rather than a value to reach and stop at
        const limited = energy && limitStats[stat];

        // Chipset in use: the saved pick (Command until one is made) if the goal is one of its steps, else the first chipset the goal belongs to
        const work = (() => {
            const preferred = chipset ?? 150;
            if (!deseq || target === null) return preferred;
            const fitsGoal = (wk: number) => desequencerDayOptions(wk).some(o => o.value === target);
            if (fitsGoal(preferred)) return preferred;
            return DESEQUENCER_CHIPSETS.find(c => fitsGoal(c.work))?.work ?? preferred;
        })();
        const chip = DESEQUENCER_CHIPSETS.find(c => c.work === work)!;

        const reached = breakpoints ? [...breakpoints].reverse().find(b => total >= b.value) : undefined;
        const result = unit
            ? (unit.readout ? unit.readout(unit.fromPercent(total, totals)) : withUnit(unit.fromPercent(total, totals), unit.unit))
            : deseq ? `${chip.short} ${desequencerDaysAt(work, total)}d`
            : breakpoints ? (reached ? stepName(reached) : belowFirst(breakpoints[0]))
            : fmtPct(total);

        const goal = target === null ? null
            : deseq ? (() => { const d = desequencerDayOptions(work).find(o => o.value === target)?.days; return d !== undefined ? `${chip.short} ${d}d` : `${target}%`; })()
            : breakpoints?.find(b => b.value === target) ? stepName(breakpoints.find(b => b.value === target)!)
            : unit ? withUnit(unit.fromPercent(target, totals), unit.unit)
            : `${target}%`;
        const met = target !== null && total >= target;
        const progress = target === null || met ? null : closeness(total, target);
        const gap = target === null || met ? null
            : unit?.lowerIsBetter ? `${withUnit(round2(unit.fromPercent(total, totals) - unit.fromPercent(target, totals)), unit.unit)} over`
            : unit ? `${withUnit(round2(unit.fromPercent(target, totals) - unit.fromPercent(total, totals)), unit.unit)} short`
            : `${Math.ceil(target - total)}% short`;
        const color = off ? C.muted : progress !== null ? colorFor(progress) : (mode === 'target' && !limited ? C.met : C.text);

        const nextStepAbove = (steps: { value: number }[]) => (steps.find(s => s.value > total) ?? steps[steps.length - 1]).value;
        const defaultTarget = deseq ? nextStepAbove(desequencerDayOptions(work))
            : breakpoints ? nextStepAbove(breakpoints)
            : Math.max(0, Math.ceil(total));

        const choose = (m: Mode) => {
            if (m === 'off') { setOff(stat, true); setOpen(null); return; }
            setOff(stat, false);
            if (m === 'auto') { setTarget(stat, null); if (energy) setLimit(stat, false); setOpen(null); return; }
            if (target === null) setTarget(stat, defaultTarget);
            setOpen(open === stat && mode === 'target' ? null : stat);
        };

        let panel: React.ReactNode = null;
        if (mode === 'target') {
            if (energy) {
                panel = (
                    <>
                        <Choice label="Exactly" selected={!limited} title="Reach this and stop spending modules on it" onClick={() => setLimit(stat, false)} disabled={disabled} />
                        <Choice label="At most" selected={limited} title="Never use more than this a day, and less if the layout allows" onClick={() => setLimit(stat, true)} disabled={disabled} />
                        <TargetInput unit={unit} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget(stat, pct)} disabled={disabled} />
                    </>
                );
            } else if (deseq) {
                panel = (
                    <>
                        <select value={work} disabled={disabled} style={{ ...selectStyle, fontFamily: 'ui-monospace, Consolas, monospace' }}
                            onChange={(e) => { const wk = Number(e.target.value); setChipset(wk); setTarget(stat, nextStepAbove(desequencerDayOptions(wk))); }}>
                            {/* The work each card type needs, lined up on the right; a monospace font is the only way to align inside a native select */}
                            {DESEQUENCER_CHIPSETS.map(c => <option key={c.work} value={c.work}>{c.name.padEnd(CHIPSET_PAD, ' ')}{String(c.work).padStart(4, ' ')}</option>)}
                        </select>
                        {desequencerDayOptions(work).map(o => (
                            <Choice key={o.value} label={`${o.days}d`} selected={target === o.value} title={`${o.value}%`} onClick={() => setTarget(stat, o.value)} disabled={disabled} />
                        ))}
                    </>
                );
            } else if (breakpoints) {
                panel = breakpoints.map(b => (
                    <Choice key={b.value} label={b.label} selected={target === b.value} title={`${b.hint} (${b.value}%)`} onClick={() => setTarget(stat, b.value)} disabled={disabled} />
                ));
            } else {
                panel = <TargetInput unit={unit} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget(stat, pct)} disabled={disabled} />;
            }
        }

        return {
            key: stat, name: statName(machineType, stat), result, color, progress, gap, panel, mode, choose,
            tooltip: goal ? `${goal}${met ? ' ✓' : progress !== null ? ` · ${Math.floor(progress * 100)}%` : ''}` : undefined,
            noEffect: off && statHasNoEffect(machineType, stat),
            modes: ['auto', 'target', 'off'],
        };
    };

    // Mirage Projector: Performance and Quality as one card of attractiveness points (the solver takes their sum, see MachineConfig.sumPQ)
    const attractivenessCard = (): Card => {
        const off = Boolean(ignoreStats.Performance);
        const target = targetStats.Performance;
        const total = totals.Performance + totals.Quality;
        const mode: Mode = off ? 'off' : target === null ? 'auto' : 'target';
        const met = target !== null && total >= target;
        const progress = target === null || met ? null : closeness(total, target);
        const color = off ? C.muted : progress !== null ? colorFor(progress) : (mode === 'target' ? C.met : C.text);
        const setBoth = (ignored: boolean) => setIgnoreStats((prev: any) => ({ ...prev, Performance: ignored, Quality: ignored }));
        const choose = (m: Mode) => {
            if (m === 'off') { setBoth(true); setOpen(null); return; }
            setBoth(false);
            setTargetStats((prev: any) => ({ ...prev, Quality: null, Performance: m === 'auto' ? null : (prev.Performance ?? Math.max(0, Math.ceil(total))) }));
            setOpen(m === 'target' && !(open === 'attract' && mode === 'target') ? 'attract' : null);
        };
        return {
            key: 'attract', name: 'Attractiveness', result: `${total + MIRAGE_BASE_POINTS} pts`, color, progress, mode, choose,
            gap: target === null || met ? null : `${Math.ceil(target - total)} pts short`,
            tooltip: target !== null ? `${target + MIRAGE_BASE_POINTS} pts${met ? ' ✓' : ` · ${Math.floor((progress ?? 0) * 100)}%`}` : undefined,
            noEffect: false,
            modes: ['auto', 'target', 'off'],
            panel: mode === 'target'
                ? <TargetInput unit={POINTS} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget('Performance', pct)} disabled={disabled} />
                : null,
        };
    };

    // A stat that does nothing on this machine gets no card at all
    const cards: Card[] = isMirage(machineType)
        ? [attractivenessCard(), statCard('Efficiency')]
        : (['Performance', 'Quality', 'Efficiency'] as StatKey[]).filter(stat => !statHasNoEffect(machineType, stat)).map(statCard);
    const openCard = cards.find(c => c.key === open && c.panel);

    return (
        <div ref={rootRef} style={{ width: width ? `${width}px` : '100%', maxWidth: '100%', alignSelf: 'center', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))`, gap: '4px' }}>
                {cards.map((card) => {
                    const isOpen = openCard?.key === card.key;
                    return (
                        <div key={card.key} style={{
                            display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
                            backgroundColor: C.card, borderRadius: '6px',
                            border: `1px solid ${isOpen ? C.accentBorder : C.cardBorder}`,
                        }}>
                            <div style={{ flex: 1, padding: '5px 4px 4px', display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'center' }}>
                                <span style={{ fontSize: '0.66em', color: C.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.name}</span>
                                {card.noEffect ? (
                                    <span style={{ fontSize: '0.75em', color: C.muted, padding: '8px 0' }}>No effect</span>
                                ) : (
                                    <>
                                        <div title={card.tooltip} style={{ fontSize: '1.05em', fontWeight: 'bold', color: card.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {card.result}
                                        </div>
                                        {card.progress !== null && (
                                            <div style={{ height: '3px', margin: '2px 4px 0', background: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ width: `${card.progress * 100}%`, height: '100%', background: card.color }} />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {!card.noEffect && (
                                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${card.modes.length}, minmax(0, 1fr))`, borderTop: `1px solid ${C.divider}` }}>
                                    {card.modes.map((m, i) => {
                                        const on = card.mode === m;
                                        return (
                                            <button
                                                key={m}
                                                type="button"
                                                onClick={() => card.choose(m)}
                                                disabled={disabled}
                                                style={{
                                                    padding: '3px 0', fontSize: '0.64em', border: 'none', borderRadius: 0, minWidth: 0,
                                                    borderLeft: i > 0 ? `1px solid ${C.divider}` : 'none',
                                                    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden',
                                                    backgroundColor: on ? (m === 'off' ? '#262626' : C.accentBg) : 'transparent',
                                                    color: on ? (m === 'off' ? '#ccc' : C.accentText) : C.sub,
                                                }}
                                            >
                                                {MODE_LABEL[m]}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {openCard && (
                <div onKeyDown={(e) => e.stopPropagation()} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    {openCard.panel}
                    {openCard.gap && <span style={{ fontSize: '0.75em', color: openCard.color }}>{openCard.gap}</span>}
                </div>
            )}
        </div>
    );
};
