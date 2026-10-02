// Per-stat priority (1 matters most), as Razboy's and hoydoy's own pages have it under each stat. Shown only while one of their solvers is
// picked (solvers/index.ts): this site's solver ranks machines by card order instead
import { hiddenStat, statName } from '../machineDefaults';

type StatKey = 'Performance' | 'Quality' | 'Efficiency';
const STATS: StatKey[] = ['Performance', 'Quality', 'Efficiency'];

export const StatPriorities = ({ machineType, statPriority, setStatPriority, ignoreStats, disabled, width }: {
    machineType: string;
    statPriority: Partial<Record<StatKey, number>>;
    setStatPriority: (update: (prev: any) => any) => void;
    ignoreStats: Partial<Record<StatKey, boolean>>;
    disabled: boolean;
    width: number;
}) => {
    const shown = STATS.filter(stat => !hiddenStat(machineType, stat));
    if (shown.length === 0) return null;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width, maxWidth: '100%', boxSizing: 'border-box', margin: '-4px 0 8px', padding: '4px 8px', border: '1px solid #333', borderRadius: '6px', backgroundColor: '#1a1a1a' }}
            title="Priority of each stat for this machine, 1 mattering most: a stat of a lower priority only counts once every higher one is settled">
            <span style={{ fontSize: '0.62em', letterSpacing: '0.06em', color: '#888', textTransform: 'uppercase' }}>Priority</span>
            <div style={{ display: 'flex', flex: 1, justifyContent: 'space-around', gap: '6px' }}>
                {shown.map(stat => {
                    const off = Boolean(ignoreStats[stat]);
                    return (
                        <label key={stat} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7em', color: off ? '#555' : '#bbb' }}>
                            {statName(machineType, stat)}
                            <select
                                value={statPriority[stat] ?? 1}
                                disabled={disabled || off}
                                title={`Priority for ${statName(machineType, stat)}: 1 matters most`}
                                onChange={e => setStatPriority((prev: any) => ({ ...prev, [stat]: Number(e.target.value) }))}
                                style={{ padding: '1px 2px', fontSize: '1em', backgroundColor: '#111', color: off ? '#555' : '#eee', border: '1px solid #444', borderRadius: '3px', cursor: disabled || off ? 'not-allowed' : 'pointer' }}
                            >
                                <option value={1}>1</option>
                                <option value={2}>2</option>
                                <option value={3}>3</option>
                            </select>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};
