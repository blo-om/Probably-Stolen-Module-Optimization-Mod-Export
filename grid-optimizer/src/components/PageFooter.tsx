import { useState } from 'react';
import { CPU_USAGE_KEY, readCpuUsage } from '../solver/parallel';
import type { CpuUsage } from '../solver/parallel';

// The faint line at the very bottom of the page: how many cores a solve may use, and where the mod and this site live
const OPTIONS: { value: CpuUsage; label: string; hint: string }[] = [
    { value: 'low', label: 'Low', hint: 'A quarter of your cores: lightest on the PC, about 2-3x slower to reach the same result' },
    { value: 'balanced', label: 'Balanced', hint: 'Half your cores: about 1.5x slower than Max for the same result' },
    { value: 'max', label: 'Max', hint: 'Every core but one: fastest, but the PC can feel sluggish while it runs' },
];

const faint = '#555';

export const PageFooter = () => {
    const [usage, setUsage] = useState<CpuUsage>(readCpuUsage);
    const choose = (value: CpuUsage) => {
        setUsage(value);
        try { localStorage.setItem(CPU_USAGE_KEY, value); } catch { /* storage unavailable: applies to this visit only */ }
    };
    const link = { color: faint, textDecoration: 'none' };
    return (
        <footer style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '8px 18px', padding: '28px 16px 20px', color: faint, fontSize: '0.75em' }}>
            <span title="How many CPU cores the optimizer may use. Applies from the next run">
                CPU usage:{' '}
                {OPTIONS.map((o, i) => (
                    <span key={o.value}>
                        {i > 0 && ' · '}
                        <button
                            onClick={() => choose(o.value)}
                            title={o.hint}
                            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: usage === o.value ? '#888' : faint, textDecoration: usage === o.value ? 'underline' : 'none' }}
                        >
                            {o.label}
                        </button>
                    </span>
                ))}
            </span>
            <a href="https://www.nexusmods.com/probablystolen/mods/274" target="_blank" rel="noopener noreferrer" style={link}>Mod on Nexus</a>
            <a href="https://github.com/blo-om/Probably-Stolen-Module-Optimization-Mod-Export" target="_blank" rel="noopener noreferrer" style={link}>GitHub</a>
        </footer>
    );
};
