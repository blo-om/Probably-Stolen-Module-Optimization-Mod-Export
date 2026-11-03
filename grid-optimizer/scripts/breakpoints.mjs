// Writes BREAKPOINTS.md (repo root) from the site's own machine rules (src/machineDefaults.ts), so the chart always matches what the
// optimizer uses. Run after changing a machine formula:  npm run breakpoints
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
    const m = await server.ssrLoadModule('/src/machineDefaults.ts');
    const out = [];
    const line = (s = '') => out.push(s);
    const table = (head, rows) => {
        line(`| ${head.join(' | ')} |`);
        line(`|${head.map(() => '---').join('|')}|`);
        for (const r of rows) line(`| ${r.join(' | ')} |`);
        line();
    };
    const details = (summary, body) => { line(`<details><summary>${summary}</summary>`); line(); body(); line('</details>'); line(); };
    const steps = (list, fmt = s => `**${s.value}** ${s.short ?? s.label}`) => (list && list.length ? list.map(fmt).join(' · ') : '—');
    const effect = (machine, stat) => m.statEffect(machine, stat) ?? '—';
    // Where a stat's reading changes, scanning its total from `from` to `to`: the steps of a stat read in steps (energy, purity cap)
    const changes = (machine, stat, from, to, totals = () => ({ Performance: 0, Quality: 0, Efficiency: 0 })) => {
        const unit = m.statUnit(machine, stat);
        if (!unit) return [];
        const read = p => unit.fromPercent(p, { ...totals(p), [stat]: p });
        const found = [];
        let prev = read(from);
        for (let p = from + 1; p <= to; p++) {
            const v = read(p);
            if (v !== prev) { found.push([p, v]); prev = v; }
        }
        return { start: read(from), found, unit: unit.unit };
    };

    line('# Machine breakpoints');
    line();
    line('Every value is a machine\'s **total %** from the modules in it (what its stat cards show). A breakpoint is the total where the machine');
    line('does something better; anything between two breakpoints does nothing more. Generated from the optimizer\'s own rules');
    line('(`grid-optimizer/src/machineDefaults.ts`, checked against the full release\'s code) by `npm run breakpoints` - do not edit by hand.');
    line();

    // ---- quick reference
    line('## Quick reference');
    line();
    const quick = [
        ['Moisture Farm', 'output +1% per 1%', 'water grade: **50** Base · **100** High-quality · **150** Pure'],
        ['Water Purifier', 'cleans +1% per 1%', 'purity cap: **100** 99.9% (Pure) · **200** 100%'],
        ['Furnace', 'no effect', 'ingot purity +1 stage per full **100** (Blast: from 200)'],
        ['AgeWell', 'lowers energy, like Efficiency', '+1 day of aging per full **125**'],
        ['Mirage Projector', '+1 point per 4%', '+1 point per 2%'],
        ['Cryptographic Desequencer', 'keycard days, see below', 'no effect'],
        ['Alarm System', '**49** = every theft stopped', 'no effect'],
        ['Hydroponic System', 'growth days per plant, see below', 'harvest +1 item steps per plant, see below'],
        ['DNA Manipulator', 'operation days per complexity', '100% success at **10 + 10 × complexity**'],
        ['3D Printer', 'print days per chip, see below', 'melee condition: **20** Fair+ · **160** Good+ · **280** Excellent'],
        ['Deal Maker', 'lowers energy, like Efficiency', '+1% accept chance per 10% (base 10%)'],
        ['Evaporator', '300 ml/day, +1% per 1%', 'recovery = Quality %, up to **100**'],
    ];
    table(['Machine', 'Performance', 'Quality'], quick);
    line('Efficiency lowers every machine\'s energy use; its steps are in [Energy](#energy).');
    line();

    // ---- machines without a job
    const simple = [
        ['Moisture Farm', 'Moisture Farm 1'], ['Water Purifier', 'Water Purifier 1'], ['Furnace', 'Furnace 1'], ['AgeWell', 'AgeWell 1'],
        ['Mirage Projector', 'Mirage Projector 1'], ['Alarm System', 'Alarm System 1'], ['Deal Maker', 'Deal Maker 1'], ['Evaporator', 'Evaporator 1'],
    ];
    for (const [title, machine] of simple) {
        line(`## ${title}`);
        line();
        const rows = [];
        // The two steps that are not in statBreakpoints: the Alarm's sure stop and the Evaporator's full recovery (the optimizer's targets)
        const extra = {
            'Alarm System:Performance': `**${m.ALARM_SURE_STOP}** every theft stopped`,
            'Evaporator:Quality': `**${m.EVAPORATOR_QUALITY_CAP}** all of it kept (more does nothing)`,
        };
        for (const stat of ['Performance', 'Quality']) {
            const bp = m.statBreakpoints(machine, stat, false);
            rows.push([stat, effect(machine, stat), extra[`${title}:${stat}`] ?? steps(bp)]);
            if (title === 'Furnace' && stat === 'Quality') rows.push(['Quality, with Blast', 'one stage less', steps(m.statBreakpoints(machine, stat, true))]);
        }
        table(['Stat', 'What it does', 'Breakpoints'], rows);
        if (title === 'Furnace') {
            const hints = m.statBreakpoints(machine, 'Quality', false).map(b => [`**${b.value}**`, b.hint]);
            details('Ingot purity per recipe', () => table(['Quality', 'Result'], hints));
            details('Ingot purity per recipe, with Blast', () => table(['Quality', 'Result'], m.statBreakpoints(machine, 'Quality', true).map(b => [`**${b.value}**`, b.hint])));
        }
        if (title === 'Water Purifier') {
            const c = changes(machine, 'Quality', 0, 250);
            if (c.found?.length) {
                const unit = m.statUnit(machine, 'Quality');
                const show = v => (unit.readout ? unit.readout(v) : `${v}${unit.unit}`);
                table(['Quality', 'Purity cap'], [['below ' + c.found[0][0], show(c.start)], ...c.found.map(([p, v]) => [`**${p}**`, show(v)])]);
            }
        }
    }

    // ---- Desequencer
    line('## Cryptographic Desequencer');
    line();
    line(`Performance: ${effect('Cryptographic Desequencer 1', 'Performance')}. Keycard work: ${m.DESEQUENCER_CHIPSETS.map(c => `${c.name} ${c.work}`).join(' · ')}.`);
    line();
    table(['Performance', 'Keycards it gets one day faster'], m.statBreakpoints('Cryptographic Desequencer 1', 'Performance', false).map(b => [`**${b.value}**`, b.hint]));

    // ---- jobs
    const jobsSection = (title, machine, intro, perfLabel, qualLabel, collapse) => {
        line(`## ${title}`);
        line();
        line(intro);
        line();
        const { jobs } = m.machineJobs(machine);
        const rows = jobs.map(j => [title === 'DNA Manipulator' ? j.key : j.name, steps(j.steps.Performance, s => `**${s.value}** ${s.short}`), steps(j.steps.Quality)]);
        const body = () => table([m.machineJobs(machine).label, perfLabel, qualLabel], rows);
        if (collapse) details(collapse, body); else body();
    };
    jobsSection('Hydroponic System', 'Hydroponic System 1',
        'Plain seeds, their innate traits included (a seed changed in the DNA Manipulator differs; the optimizer reads yours from the save). Growth: 8 work a day, +1 per full 25% Performance.',
        'Performance → days to grow', 'Quality → extra items a harvest', null);
    jobsSection('DNA Manipulator', 'DNA Manipulator 1',
        'An operation at complexity c takes 20 + 4c work at 10 + P/20 a day, and succeeds at 95 − 5c + Q/2 % (at least 5%).',
        'Performance → days', 'Quality', 'Days and success per complexity (0-15)');
    jobsSection('3D Printer', '3D Printer 1',
        'Prints at 24 work a day, +24 per 100% Performance. Chips of 24 work or less (scopes, lasers, suppressor, .22 mags, small parts) take one day already. Melee weapon condition rolls 20-30 + Q/4 (+ the ingot\'s quality bonus).',
        'Performance → days', 'Quality → melee condition', null);

    // ---- energy
    line('## Energy');
    line();
    line('Efficiency lowers energy use a day (a use, for the Deal Maker), never below 1. On the AgeWell and the Deal Maker, Performance counts toward it too.');
    line();
    const energy = [
        ['Moisture Farm', 'Moisture Farm 1'], ['Water Purifier', 'Water Purifier 1'], ['Furnace', 'Furnace 1'], ['AgeWell', 'AgeWell 1'],
        ['Mirage Projector', 'Mirage Projector 1'], ['Cryptographic Desequencer', 'Cryptographic Desequencer 1'], ['Alarm System', 'Alarm System 1'],
        ['Hydroponic System', 'Hydroponic System 1'], ['DNA Manipulator', 'DNA Manipulator 1'], ['3D Printer', '3D Printer 1'], ['Deal Maker', 'Deal Maker 1'],
        ['Evaporator', 'Evaporator 1'],
    ];
    table(['Machine', 'Rule', 'First steps (Efficiency → energy)'], energy.map(([title, machine]) => {
        const c = changes(machine, 'Efficiency', 0, 100);
        return [title, effect(machine, 'Efficiency').replace(/^Energy use: /, ''), c.found.slice(0, 4).map(([p, v]) => `**${p}** ${v}`).join(' · ')];
    }));

    const target = fileURLToPath(new URL('../../BREAKPOINTS.md', import.meta.url));
    writeFileSync(target, out.join('\n'));
    console.log(`wrote ${target} (${out.length} lines)`);
} finally {
    await server.close();
}
