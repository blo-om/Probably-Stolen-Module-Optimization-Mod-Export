import { useState, useSyncExternalStore } from 'react';
import { CPU_USAGE_KEY, readCpuUsage } from '../solver/parallel';
import type { CpuUsage } from '../solver/parallel';
import { t, useLang } from '../i18n';
import { isSolverLocked, readSolver, SOLVERS, subscribeSolver, writeSolver } from '../solvers';

// The faint line at the very bottom of the page: which solver runs, how many cores a solve may use, and where the mod and this site live
// label and hint are English, shown through t()
const OPTIONS: { value: CpuUsage; label: string; hint: string }[] = [
    { value: 'low', label: 'Low', hint: 'A quarter of your cores: lightest on the PC, about 2-3x slower to reach the same result' },
    { value: 'balanced', label: 'Balanced', hint: 'Half your cores: about 1.5x slower than Max for the same result' },
    { value: 'max', label: 'Max', hint: 'Every core but one: fastest, but the PC can feel sluggish while it runs' },
];

const faint = '#555';

export const PageFooter = () => {
    useLang();
    const [usage, setUsage] = useState<CpuUsage>(readCpuUsage);
    const choose = (value: CpuUsage) => {
        setUsage(value);
        try { localStorage.setItem(CPU_USAGE_KEY, value); } catch { /* storage unavailable: applies to this visit only */ }
    };
    const solver = useSyncExternalStore(subscribeSolver, readSolver);
    const solverLocked = useSyncExternalStore(subscribeSolver, isSolverLocked);
    const link = { color: faint, textDecoration: 'none' };
    const option = (on: boolean, locked = false) => ({
        background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: locked ? 'not-allowed' : 'pointer',
        color: on ? '#888' : faint, textDecoration: on ? 'underline' : 'none',
    });
    return (
        <footer style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '8px 18px', padding: '28px 16px 20px', color: faint, fontSize: '0.75em' }}>
            <span title={t('Which solver lays the modules out (when a solve starts)')}>
                {t('Solver:')}{' '}
                {SOLVERS.map((s, i) => (
                    <span key={s.value}>
                        {i > 0 && ' · '}
                        <button onClick={() => writeSolver(s.value)} disabled={solverLocked} title={t(s.title)} style={option(solver === s.value, solverLocked)}>
                            {s.label}
                        </button>
                    </span>
                ))}
            </span>
            <span title={t('How many CPU cores the optimizer may use. Applies from the next run')}>
                {t('CPU usage:')}{' '}
                {OPTIONS.map((o, i) => (
                    <span key={o.value}>
                        {i > 0 && ' · '}
                        <button
                            onClick={() => choose(o.value)}
                            title={t(o.hint)}
                            style={option(usage === o.value)}
                        >
                            {t(o.label)}
                        </button>
                    </span>
                ))}
            </span>
            <a href="https://www.nexusmods.com/probablystolen/mods/274" target="_blank" rel="noopener noreferrer" style={link}>{t('Mod on Nexus')}</a>
            <a href="https://github.com/blo-om/Probably-Stolen-Module-Optimization-Mod-Export" target="_blank" rel="noopener noreferrer" style={link}>GitHub</a>
            {/* Credits: the optimizers this site builds on, at their own sites */}
            <span style={{ flexBasis: '100%', textAlign: 'center' }}>
                {t('Huge thanks to hoydoy and Razboy20 for their insane contributions to the community. Their own optimizers:')}{' '}
                <a href="https://hoydoy.github.io/probably-stolen-module-optimization/" target="_blank" rel="noopener noreferrer" style={{ ...link, textDecoration: 'underline' }}>hoydoy</a>
                {' · '}
                <a href="https://grid-optimizer.razboy20.workers.dev/" target="_blank" rel="noopener noreferrer" style={{ ...link, textDecoration: 'underline' }}>Razboy20</a>
            </span>
        </footer>
    );
};
