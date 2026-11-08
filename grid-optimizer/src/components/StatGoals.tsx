import React, { useEffect, useRef, useState } from 'react';
import type { Stats } from '../types';
import { rememberSaveSettings } from '../saveSettings';
import {
    statBreakpoints, statUnit, statName, statHasNoEffect, hiddenStat, sumsPE,
    machineJobs, machineJobKey, isDesequencer, isMirage, MIRAGE_QUALITY_WEIGHT, miragePoints, miragePointsFor, mirageSumFor, DESEQUENCER_CHIPSETS, desequencerDayOptions, desequencerSpeed,
    desequencerChipsetKey, desequencerAutoDaysKey, STORE_BASE_ATTRACTIVENESS_KEY,
} from '../machineDefaults';
import type { StatBreakpoint, StatUnit } from '../machineDefaults';
import { t, useLang } from '../i18n';

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

// A card's reading with its unit in smaller type ("5510 ml/d", "28/day", "120 pts"), so the number keeps the room: units in Chinese
// (毫升/天) are wider than the English ones. A reading that is not a number and a unit (a water grade, "+1d") stays as it is
const splitUnit = (result: string): React.ReactNode => {
    const m = /^(-?[\d.,]+)( ?)(\D.*)$/.exec(result);
    if (!m || m[3] === '%') return result;
    return <>{m[1]}<span style={{ fontSize: '0.72em', fontWeight: 'normal', marginLeft: m[2] ? '3px' : '1px' }}>{m[3]}</span></>;
};

// Mirage attractiveness, as points, from Performance + 2 x Quality (what the solver works on): 4 of it make a point
const POINTS: StatUnit = {
    get unit() { return t('pts'); },
    fromPercent: (sum) => miragePointsFor(sum),
    toPercent: (pts) => mirageSumFor(pts),
    step: 1,
};

// Target typed in a machine's own unit (e.g. ml/day), stored as the % the solver works with
// Saved on every keystroke (leaving the box is not needed: a click on the grid or a Run can skip the blur), while the box keeps
// showing the text as typed, since converting every keystroke back for display would rewrite a half-typed number
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
                onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
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

/* The steps of a target as one segmented bar: an optional job picker as its first cell (plant, complexity, chip, chipset), then a
 * cell per step, all the same width so long names never wrap the row. Steps already reached are tinted, the target is highlighted
 */
type SegStep = { value: number | null; label: string; title?: string };
const SegBar = ({ picker, steps, target, total, onPick, disabled, children }: {
    picker?: { value: string; options: { value: string; label: string }[]; title?: string; onChange: (v: string) => void };
    steps?: SegStep[]; target?: number | null; total?: number; onPick?: (v: number | null) => void; disabled: boolean; children?: React.ReactNode;
}) => (
    <div style={{ display: 'flex', width: '100%', height: '26px', border: '1px solid #3a3a3a', borderRadius: '5px', overflow: 'hidden', boxSizing: 'border-box' }}>
        {picker && (
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '0 1 auto', minWidth: 0, maxWidth: '45%', backgroundColor: '#232323', borderRight: '1px solid #3a3a3a' }}>
                <span aria-hidden style={{ visibility: 'hidden', whiteSpace: 'nowrap', overflow: 'hidden', padding: '0 20px 0 9px', fontSize: '0.78em' }}>
                    {picker.options.find(o => o.value === picker.value)?.label}
                </span>
                <select value={picker.value} disabled={disabled} title={picker.title} onChange={(e) => picker.onChange(e.target.value)}
                    style={{ position: 'absolute', inset: 0, appearance: 'none', WebkitAppearance: 'none', width: '100%', height: '100%', padding: '0 20px 0 9px', fontSize: '0.78em',
                        backgroundColor: '#232323', color: '#eee', border: 'none', outline: 'none', textOverflow: 'ellipsis', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    {picker.options.map(o => <option key={o.value} value={o.value} style={{ backgroundColor: '#1a1a1a' }}>{o.label}</option>)}
                </select>
                <span aria-hidden style={{ position: 'absolute', right: '7px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.6em', color: C.sub, pointerEvents: 'none' }}>▾</span>
            </span>
        )}
        {steps?.map((s, i) => {
            const selected = target === s.value;
            const reached = s.value !== null && total !== undefined && total >= s.value;
            return (
                <button key={s.value ?? 'auto'} type="button" disabled={disabled} title={s.title} onClick={() => onPick?.(s.value)}
                    style={{
                        flex: '1 1 0', minWidth: 0, padding: '0 2px', fontSize: '0.78em', border: 'none', borderRadius: 0,
                        borderLeft: i > 0 ? `1px solid ${C.divider}` : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        backgroundColor: selected ? C.accentBg : 'transparent',
                        color: selected ? C.accentText : reached ? C.met : '#bbb', fontWeight: selected ? 'bold' : 'normal',
                    }}>
                    {s.label}
                </button>
            );
        })}
        {children && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>{children}</div>}
    </div>
);

// A step's cell title: what it gives, the % it needs, and how far off that is
const reachText = (value: number, total: number) => `${value}%${total >= value ? ' ✓' : ` (${t('{v} short', { v: `${Math.ceil(value - total)}%` })})`}`;
const stepTitle = (b: StatBreakpoint, total: number) => `${b.label}${b.hint ? ` · ${b.hint}` : ''} · ${reachText(b.value, total)}`;
// Cells use the short names as soon as one step's full name would not fit, and always after a job picker (which already names the job).
// Past 5 steps the cells get too narrow for even short full names ("+1 day" cut to "+1 …" over the AgeWell's 8), so those go short too
const stepCells = (steps: StatBreakpoint[], total: number, afterPicker = false): SegStep[] => {
    const useShort = afterPicker || steps.length > 5 || steps.some(b => b.label.length > 9);
    return steps.map(b => ({ value: b.value, label: useShort ? (b.short ?? b.label) : b.label, title: stepTitle(b, total) }));
};

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
    // What Auto reads as: 'Max' while Razboy's or hoydoy's solver is picked (solvers/index.ts), whose pages call it that
    autoLabel?: string;
    /* Max and Target as two toggles rather than a choice, as Razboy's and hoydoy's pages have them (solvers/index.ts): both on is a target
     * that is reached first and then gone past (limitStats: the target stays, the stat is still maximized). Both off is Off
     */
    toggles?: boolean;
    // Told the job when one is picked (the Hydroponic card shows what the picked plant harvests)
    onJobChange?: (key: string) => void;
};

type Card = {
    key: string;
    name: string;
    result: string;
    color: string;
    progress: number | null;
    // The progress bar's colour when it differs from the result's (Auto: plain result, bar coloured by closeness)
    barColor?: string;
    tooltip?: string;
    noEffect: boolean;
    modes: Mode[];
    mode: Mode;
    choose: (m: Mode) => void;
    // Toggles (Razboy's and hoydoy's solvers, see Props.toggles): whether Max / Target / Off is on, and flipping one
    isOn: (m: Mode) => boolean;
    toggle: (m: Mode) => void;
    // Opens the target's panel again (toggles only: there, the Target button switches the target off)
    edit: () => void;
    // What opens under the cards for the mode that takes a value (target or limit); null when this card has nothing open
    panel: React.ReactNode;
    gap: string | null;
};

const MODE_LABEL: Record<Mode, string> = { auto: 'Auto', target: 'Target', off: 'Off' };

// One card per stat (the Mirage Projector's Performance and Quality share one): the stat's name, the result it gives this machine,
// and its modes in a strip along the bottom. A mode that takes a value opens its choices under the cards
export const StatGoals = ({ machineType, machineId, totals, ignoreStats, targetStats, setIgnoreStats, setTargetStats, limitStats, setLimitStats, disabled, hasBlast, width, autoLabel = 'Auto', toggles = false, onJobChange }: Props) => {
    useLang();
    const [open, setOpen] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(null); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const chipsetKey = desequencerChipsetKey(machineId);
    const [chipset, setChipsetState] = useState<number | null>(() => {
        try { const v = Number(localStorage.getItem(chipsetKey)); return v ? v : null; } catch { return null; }
    });
    const setChipset = (work: number) => {
        setChipsetState(work);
        try { localStorage.setItem(chipsetKey, String(work)); } catch { /* per-viewer convenience only */ }
        rememberSaveSettings();
    };
    // Desequencer days on Auto: maximized, eased to the picked chipset's day breakpoints (read by the solve, see targetSteps)
    const autoDaysKey = desequencerAutoDaysKey(machineId);
    const [autoDays, setAutoDaysState] = useState<boolean>(() => {
        try { return localStorage.getItem(autoDaysKey) === '1'; } catch { return false; }
    });
    const setAutoDays = (on: boolean) => {
        setAutoDaysState(on);
        try { if (on) localStorage.setItem(autoDaysKey, '1'); else localStorage.removeItem(autoDaysKey); } catch { /* per-viewer convenience only */ }
        rememberSaveSettings();
    };

    // The job a Hydroponic / DNA Manipulator / 3D Printer works on (machineJobs): a plant, a complexity, a chip. Shared by the machine's
    // cards; its steps are what the targets pick from and what the solve eases to on Auto
    const jobKey = machineJobKey(machineId);
    const [jobPick, setJobPick] = useState<string | null>(() => {
        try { return localStorage.getItem(jobKey); } catch { return null; }
    });
    // The seed or chip the save had in the machine stays on the list after something else is picked
    const [savedPick] = useState(jobPick);
    const jobs = machineJobs(machineType, jobPick?.includes(':') ? jobPick : savedPick);
    const job = jobs ? jobs.jobs.find(j => j.key === jobPick) ?? jobs.jobs[0] : null;

    const setTarget = (stat: StatKey, value: number | null) => setTargetStats((prev: any) => ({ ...prev, [stat]: value }));
    // A new job moves the targets set on its steps to the new job's next step up
    const pickJob = (key: string) => {
        setJobPick(key);
        try { localStorage.setItem(jobKey, key); } catch { /* per-viewer convenience only */ }
        onJobChange?.(key);
        rememberSaveSettings();
        const next = jobs?.jobs.find(j => j.key === key);
        if (!next) return;
        setTargetStats((prev: any) => {
            const out = { ...prev };
            for (const stat of ['Performance', 'Quality'] as StatKey[]) {
                const steps = next.steps[stat];
                // A job with no steps for the stat (Hydroreed's Harvest) leaves its target as it is
                if (!steps || steps.length === 0 || out[stat] === null || out[stat] === undefined) continue;
                out[stat] = (steps.find(s => s.value >= out[stat]) ?? steps[steps.length - 1]).value;
            }
            return out;
        });
    };
    const setOff = (stat: StatKey, off: boolean) => setIgnoreStats((prev: any) => ({ ...prev, [stat]: off }));
    const setLimit = (stat: StatKey, on: boolean) => setLimitStats(prev => ({ ...prev, [stat]: on }));

    // How close an unmet goal is (0..1), and the colour that goes with it
    const closeness = (value: number, goal: number) =>
        Math.max(0, Math.min(0.99, goal > 0 ? value / goal : 1 + (value - goal) / 100));
    const colorFor = (progress: number) => (progress >= 0.75 ? C.short : C.far);

    const statCard = (stat: StatKey): Card => {
        const off = Boolean(ignoreStats[stat]);
        const target = targetStats[stat];
        // AgeWell: Performance lowers energy like Efficiency, so this card covers both (MachineConfig.sumPE)
        const total = stat === 'Efficiency' && sumsPE(machineType) ? totals.Efficiency + totals.Performance : totals[stat];
        const unit = statUnit(machineType, stat);
        const energy = Boolean(unit?.lowerIsBetter);
        const deseq = stat === 'Performance' && isDesequencer(machineType);
        // A job with no steps for this stat (Hydroreed harvests nothing, so its Harvest has none) takes a plain number instead
        const jobStepList = job?.steps[stat]?.length ? job.steps[stat]! : null;
        const breakpoints = deseq ? null : jobStepList ?? statBreakpoints(machineType, stat, hasBlast);
        const mode: Mode = off ? 'off' : target === null && !(deseq && autoDays) ? 'auto' : 'target';
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
            : deseq ? `${desequencerSpeed(total)}${t('/day')}`
            : breakpoints ? (reached ? stepName(reached) : belowFirst(breakpoints[0]))
            : fmtPct(total);

        const goal = deseq && autoDays && target === null ? t('{chip}, days on Auto', { chip: t(chip.short) })
            : target === null ? null
            : deseq ? (() => { const d = desequencerDayOptions(work).find(o => o.value === target)?.days; return d !== undefined ? t('{chip} {d}d', { chip: t(chip.short), d }) : `${target}%`; })()
            : breakpoints?.find(b => b.value === target) ? stepName(breakpoints.find(b => b.value === target)!)
            : unit ? withUnit(unit.fromPercent(target, totals), unit.unit)
            : `${target}%`;
        const met = target !== null && total >= target;
        const progress = target === null || met ? null : closeness(total, target);
        const gap = target === null || met ? null
            : unit?.lowerIsBetter ? t('{v} over', { v: withUnit(round2(unit.fromPercent(total, totals) - unit.fromPercent(target, totals)), unit.unit) })
            : unit ? t('{v} short', { v: withUnit(round2(unit.fromPercent(target, totals) - unit.fromPercent(total, totals)), unit.unit) })
            : t('{v} short', { v: `${Math.ceil(target - total)}%` });
        const color = off ? C.muted : progress !== null ? colorFor(progress) : (mode === 'target' && !limited ? C.met : C.text);

        // Auto on a stat with breakpoints (and the Desequencer's days on Auto): how far from the last step reached to the next one
        const autoSteps = off || target !== null ? null
            : deseq ? desequencerDayOptions(work).map(o => ({ value: o.value, name: t('{chip} {d}d', { chip: t(chip.short), d: o.days }) }))
            : mode === 'auto' && breakpoints ? breakpoints.map(b => ({ value: b.value, name: stepName(b) }))
            : null;
        const nextStep = autoSteps ? [...autoSteps].sort((a, b) => a.value - b.value).find(s => s.value > total) : undefined;
        const lastStep = autoSteps ? [...autoSteps].sort((a, b) => a.value - b.value).filter(s => s.value <= total).pop() : undefined;
        const autoProgress = !nextStep ? null
            : lastStep ? Math.max(0, Math.min(0.99, (total - lastStep.value) / (nextStep.value - lastStep.value)))
            : closeness(total, nextStep.value);

        const nextStepAbove = (steps: { value: number }[]) => (steps.find(s => s.value > total) ?? steps[steps.length - 1]).value;
        const defaultTarget = deseq ? nextStepAbove(desequencerDayOptions(work))
            : breakpoints ? nextStepAbove(breakpoints)
            : Math.max(0, Math.ceil(total));

        const choose = (m: Mode) => {
            if (m === 'off') { setOff(stat, true); setOpen(null); return; }
            setOff(stat, false);
            if (m === 'auto') { setTarget(stat, null); if (energy) setLimit(stat, false); if (deseq) setAutoDays(false); setOpen(null); return; }
            if (target === null && !(deseq && autoDays)) setTarget(stat, defaultTarget);
            setOpen(open === stat && mode === 'target' ? null : stat);
        };

        let panel: React.ReactNode = null;
        let segmented = deseq;
        if (mode === 'target') {
            if (energy && !toggles) {
                panel = (
                    <>
                        <Choice label={t('Exactly')} selected={!limited} title={t('Reach this and stop spending modules on it')} onClick={() => setLimit(stat, false)} disabled={disabled} />
                        <Choice label={t('At most')} selected={limited} title={t('Never use more than this a day, and less if the layout allows')} onClick={() => setLimit(stat, true)} disabled={disabled} />
                        <TargetInput unit={unit} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget(stat, pct)} disabled={disabled} />
                    </>
                );
            } else if (deseq) {
                // Chipset picker, then Auto and the chipset's days
                panel = (
                    <SegBar disabled={disabled} total={total} target={autoDays && target === null ? null : target}
                        picker={{ value: String(work), options: DESEQUENCER_CHIPSETS.map(c => ({ value: String(c.work), label: `${t(c.name)} (${c.work})` })),
                            onChange: (v) => { const wk = Number(v); setChipset(wk); if (!autoDays) setTarget(stat, nextStepAbove(desequencerDayOptions(wk))); } }}
                        steps={[{ value: null, label: t('Auto'), title: t("As fast as the modules allow, counted in this chipset's whole days") },
                            ...desequencerDayOptions(work).map(o => ({ value: o.value, label: t('{d}d', { d: o.days }), title: reachText(o.value, total) }))]}
                        onPick={(v) => { setAutoDays(v === null); setTarget(stat, v); }} />
                );
            } else if (jobs && (jobStepList || stat !== 'Efficiency')) {
                // The job picker; a job with no steps for this stat (the DNA Manipulator's "Any seed") takes a plain number instead
                const picker = { value: job!.key, title: jobs.label, options: jobs.jobs.map(j => ({ value: j.key, label: j.name })), onChange: pickJob };
                panel = jobStepList
                    ? <SegBar disabled={disabled} picker={picker} steps={stepCells(jobStepList, total, true)} target={target} total={total} onPick={(v) => v !== null && setTarget(stat, v)} />
                    : (
                        <SegBar disabled={disabled} picker={picker}>
                            <TargetInput unit={unit} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget(stat, pct)} disabled={disabled} />
                        </SegBar>
                    );
                segmented = true;
            } else if (breakpoints) {
                panel = <SegBar disabled={disabled} steps={stepCells(breakpoints, total)} target={target} total={total} onPick={(v) => v !== null && setTarget(stat, v)} />;
                segmented = true;
            } else {
                panel = <TargetInput unit={unit} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget(stat, pct)} disabled={disabled} />;
            }
        }

        // Toggles: Max is on without a target, or with one that is still gone past (limitStats); Target is on with a target (or the days on Auto)
        const targetOn = mode === 'target';
        const maxOn = mode === 'auto' || (targetOn && Boolean(limitStats[stat]));
        const isOn = (m: Mode) => (m === 'off' ? off : m === 'auto' ? maxOn : targetOn);
        const toggle = (m: Mode) => {
            if (m === 'off') { choose('off'); return; }
            if (off) { setLimit(stat, false); choose(m); return; }
            if (m === 'auto') {
                if (!maxOn) { setLimit(stat, true); return; }
                if (targetOn) setLimit(stat, false);
                else choose('off');
                return;
            }
            if (targetOn) {
                if (maxOn) { setLimit(stat, false); choose('auto'); }
                else choose('off');
                return;
            }
            setLimit(stat, maxOn);
            choose('target');
        };
        const edit = () => { if (targetOn) setOpen(open === stat ? null : stat); };

        return {
            key: stat, name: statName(machineType, stat), result, color, gap: segmented ? null : gap, panel, mode, choose, isOn, toggle, edit,
            progress: progress ?? autoProgress,
            barColor: progress === null && autoProgress !== null ? colorFor(autoProgress) : undefined,
            tooltip: autoProgress !== null && nextStep
                ? `${goal ? `${goal} · ` : ''}${t('Next: {name}', { name: nextStep.name })} · ${Math.floor(autoProgress * 100)}%`
                : goal ? `${goal}${met ? ' ✓' : progress !== null ? ` · ${Math.floor(progress * 100)}%` : ''}` : undefined,
            noEffect: off && statHasNoEffect(machineType, stat),
            modes: ['auto', 'target', 'off'],
        };
    };

    // Mirage Projector: Performance and Quality as one card of attractiveness points (the solver takes Performance + 2 x Quality, see
    // MachineConfig.sumPQ)
    const attractivenessCard = (): Card => {
        const off = Boolean(ignoreStats.Performance);
        const target = targetStats.Performance;
        const total = totals.Performance + MIRAGE_QUALITY_WEIGHT * totals.Quality;
        const points = miragePoints(totals.Performance, totals.Quality);
        const targetPoints = target === null ? null : POINTS.fromPercent(target);
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
        const targetOn = mode === 'target';
        const maxOn = mode === 'auto' || (targetOn && Boolean(limitStats.Performance));
        const isOn = (m: Mode) => (m === 'off' ? off : m === 'auto' ? maxOn : targetOn);
        const toggle = (m: Mode) => {
            if (m === 'off') { choose('off'); return; }
            if (off) { setLimit('Performance', false); choose(m); return; }
            if (m === 'auto') {
                if (!maxOn) { setLimit('Performance', true); return; }
                if (targetOn) setLimit('Performance', false);
                else choose('off');
                return;
            }
            if (targetOn) {
                if (maxOn) { setLimit('Performance', false); choose('auto'); }
                else choose('off');
                return;
            }
            setLimit('Performance', maxOn);
            choose('target');
        };
        const edit = () => { if (targetOn) setOpen(open === 'attract' ? null : 'attract'); };
        return {
            key: 'attract', name: t('Attractiveness'), result: t('{n} pts', { n: points }), color, progress, mode, choose, isOn, toggle, edit,
            gap: targetPoints === null || met ? null : t('{v} short', { v: t('{n} pts', { n: Math.max(1, targetPoints - points) }) }),
            tooltip: targetPoints !== null ? `${t('{n} pts', { n: targetPoints })}${met ? ' ✓' : ` · ${Math.floor((progress ?? 0) * 100)}%`}` : undefined,
            noEffect: false,
            modes: ['auto', 'target', 'off'],
            // Last night's base store attractiveness (from the save) + the projector's target = the store's total
            panel: mode === 'target'
                ? (() => {
                    let base: number | null = null;
                    try { const v = localStorage.getItem(STORE_BASE_ATTRACTIVENESS_KEY); base = v === null ? null : Number(v); } catch { /* none */ }
                    return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            {base !== null && <span style={{ fontSize: '0.85em', color: C.sub }} title={t("Last night's base store attractiveness, without bonuses (from the save)")}>{base} +</span>}
                            <TargetInput unit={POINTS} target={target} totals={totals} onChange={(pct) => pct !== null && setTarget('Performance', pct)} disabled={disabled} />
                            {base !== null && targetPoints !== null && <span style={{ fontSize: '0.85em', color: C.sub }} title={t("The store's total attractiveness with the projector at its target")}>= {base + targetPoints}</span>}
                        </span>
                    );
                })()
                : null,
        };
    };

    // A stat that does nothing on this machine gets no card at all
    const cards: Card[] = isMirage(machineType)
        ? [attractivenessCard(), statCard('Efficiency')]
        : (['Performance', 'Quality', 'Efficiency'] as StatKey[]).filter(stat => !hiddenStat(machineType, stat)).map(statCard);
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
                                    <span style={{ fontSize: '0.75em', color: C.muted, padding: '8px 0' }}>{t('No effect')}</span>
                                ) : (
                                    <>
                                        <div title={card.tooltip} onClick={toggles && !disabled ? card.edit : undefined}
                                            style={{ fontSize: '1.05em', fontWeight: 'bold', color: card.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: toggles && card.isOn('target') && !disabled ? 'pointer' : undefined }}>
                                            {splitUnit(card.result)}
                                        </div>
                                        {card.progress !== null && (
                                            <div style={{ height: '3px', margin: '2px 4px 0', background: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ width: `${card.progress * 100}%`, height: '100%', background: card.barColor ?? card.color }} />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {!card.noEffect && (
                                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${card.modes.length}, minmax(0, 1fr))`, borderTop: `1px solid ${C.divider}` }}>
                                    {card.modes.map((m, i) => {
                                        const on = toggles ? card.isOn(m) : card.mode === m;
                                        return (
                                            <button
                                                key={m}
                                                type="button"
                                                onClick={() => (toggles ? card.toggle(m) : card.choose(m))}
                                                disabled={disabled}
                                                style={{
                                                    padding: '3px 0', fontSize: '0.64em', border: 'none', borderRadius: 0, minWidth: 0,
                                                    borderLeft: i > 0 ? `1px solid ${C.divider}` : 'none',
                                                    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden',
                                                    backgroundColor: on ? (m === 'off' ? '#262626' : C.accentBg) : 'transparent',
                                                    color: on ? (m === 'off' ? '#ccc' : C.accentText) : C.sub,
                                                }}
                                            >
                                                {t(m === 'auto' ? autoLabel : MODE_LABEL[m])}
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
