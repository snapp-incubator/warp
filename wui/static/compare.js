/*
 * Warp comparison view.
 * Fetches /api/compare and renders before/after tables and bar charts.
 */

// --- Theme (mirrors app.js) ---
function getTheme() { return localStorage.getItem('warp-theme') || 'dark'; }

function setTheme(theme) {
    localStorage.setItem('warp-theme', theme);
    document.body.classList.toggle('light', theme === 'light');
    updateThemeButton(theme);
    if (window._charts) restyleCharts();
}

function updateThemeButton(theme) {
    const dark = document.getElementById('theme-icon-dark');
    const light = document.getElementById('theme-icon-light');
    if (!dark || !light) return;
    dark.style.display = theme === 'dark' ? '' : 'none';
    light.style.display = theme === 'dark' ? 'none' : '';
}

document.getElementById('theme-toggle').addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
});

document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 't' || e.key === 'T') {
        setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }
});

setTheme(getTheme());

// --- Colors ---
const C_BEFORE = '#9aa0aa';
const C_AFTER = '#e84a6b';
function gridColor() { return getTheme() === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'; }
function tickColor() { return getTheme() === 'light' ? '#52525b' : '#a1a1aa'; }

// --- Helpers ---
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// Run labels derived from the input filenames, set in load().
const LBL = { before: 'Before', after: 'After' };

// shortName turns a path into a readable run label: basename without the
// .csv.zst / .json.zst / .zst suffix.
function shortName(path) {
    let n = String(path ?? '').split(/[\\/]/).pop();
    n = n.replace(/\.(csv|json)?\.?zst$/i, '');
    return n || path || '?';
}

function changeCell(row) {
    if (!row.change) return '<span class="cmp-change neutral">—</span>';
    let cls = 'neutral';
    if (row.improved === true) cls = 'good';
    else if (row.improved === false) cls = 'bad';
    return `<span class="cmp-change ${cls}">${escapeHtml(row.change)}</span>`;
}

function renderTable(title, rows) {
    if (!rows || rows.length === 0) return '';
    const body = rows.map((r) => `
        <tr>
            <td class="cmp-metric">${escapeHtml(r.name)}</td>
            <td class="cmp-num">${escapeHtml(r.before)}</td>
            <td class="cmp-num">${escapeHtml(r.after)}</td>
            <td class="cmp-num">${changeCell(r)}</td>
        </tr>`).join('');
    return `
        <div class="cmp-table-block">
            <h4 class="cmp-table-title">${escapeHtml(title)}</h4>
            <div class="table-wrap">
                <table class="cmp-table">
                    <thead>
                        <tr><th>Metric</th><th class="cmp-run-col">${escapeHtml(LBL.before)}</th><th class="cmp-run-col">${escapeHtml(LBL.after)}</th><th>Change</th></tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </div>`;
}

// chartSpecs collects charts to instantiate after the DOM is in place.
let chartSpecs = [];

// metricSection renders a titled group with one small Before/After chart PER
// metric, so a large metric (e.g. Worst) never squashes the others. Each bar is
// labelled with its exact value for reports/presentations.
function metricSection(prefix, title, unit, rows, labelFn) {
    if (!rows || rows.length === 0) return '';
    const cards = rows.map((r, j) => {
        const id = `${prefix}-${j}`;
        const metric = labelFn ? labelFn(r.name) : r.name;
        chartSpecs.push({
            id,
            unit,
            beforeVal: r.before_num,
            afterVal: r.after_num,
            beforeStr: r.before,
            afterStr: r.after,
            change: r.change || '',
            improved: r.improved,
        });
        return `
            <div class="cmp-metric-card">
                <div class="cmp-metric-title">${escapeHtml(metric)}</div>
                <div class="cmp-mini-wrap"><canvas id="${id}"></canvas></div>
            </div>`;
    }).join('');
    return `
        <div class="cmp-section">
            <div class="cmp-section-head">
                <h4 class="cmp-table-title">${escapeHtml(title)}${unit ? ` <span class="cmp-unit">(${escapeHtml(unit)})</span>` : ''}</h4>
                <div class="cmp-legend">
                    <span class="cmp-leg"><span class="cmp-swatch before"></span>${escapeHtml(LBL.before)}</span>
                    <span class="cmp-leg"><span class="cmp-swatch after"></span>${escapeHtml(LBL.after)}</span>
                </div>
            </div>
            <div class="cmp-metric-grid">${cards}</div>
        </div>`;
}

function renderOp(op, i) {
    if (op.error) {
        return `
        <section class="card">
            <header class="card-header">
                <div><h2 class="card-title">${escapeHtml(op.op)}</h2></div>
                <span class="op-pill">${escapeHtml(op.op)}</span>
            </header>
            <div class="card-content"><div class="empty">Cannot compare: ${escapeHtml(op.error)}</div></div>
        </section>`;
    }

    const tputRows = (op.throughput || []).filter((r) => r.unit === 'MiB/s');
    const reqRows = (op.requests || []).filter((r) => r.unit === 'ms');
    const ttfbRows = (op.ttfb || []).filter((r) => r.unit === 'ms');

    const charts = `
        ${metricSection(`chart-${i}-tput`, 'Throughput', 'MiB/s', tputRows, (n) => n.replace(' throughput', ''))}
        ${metricSection(`chart-${i}-req`, 'Request duration', 'ms', reqRows)}
        ${metricSection(`chart-${i}-ttfb`, 'Time to first byte', 'ms', ttfbRows)}`;

    return `
    <section class="card">
        <header class="card-header">
            <div>
                <h2 class="card-title">${escapeHtml(op.op)}</h2>
                <p class="card-description">Before vs after for ${escapeHtml(op.op)} operations</p>
            </div>
            <span class="op-pill">${escapeHtml(op.op)}</span>
        </header>
        <div class="card-content">
            ${charts}
            ${renderTable('Overview', op.info)}
            ${renderTable('Throughput', op.throughput)}
            ${renderTable('Request duration', op.requests)}
            ${renderTable('Time to first byte', op.ttfb)}
        </div>
    </section>`;
}

// valueLabelPlugin prints each bar's exact value above it (for reports/slides).
// The label text comes from dataset._labels (already unit-formatted strings).
const valueLabelPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
        const ds = chart.data.datasets[0];
        if (!ds || !ds._labels) return;
        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;
        ctx.save();
        ctx.font = "600 11px 'General Sans', sans-serif";
        ctx.fillStyle = tickColor();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        meta.data.forEach((bar, i) => {
            const label = ds._labels[i];
            if (label != null) ctx.fillText(label, bar.x, bar.y - 4);
        });
        ctx.restore();
    },
};

function buildCharts() {
    window._charts = [];
    for (const spec of chartSpecs) {
        const el = document.getElementById(spec.id);
        if (!el) continue;
        // One small chart per metric: two same-metric bars (before/after), so
        // each chart auto-scales to its own values and stays readable.
        const chart = new Chart(el, {
            type: 'bar',
            data: {
                labels: [LBL.before, LBL.after],
                datasets: [{
                    data: [spec.beforeVal, spec.afterVal],
                    backgroundColor: [C_BEFORE, C_AFTER],
                    borderRadius: 4,
                    _labels: [spec.beforeStr, spec.afterStr],
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 18 } }, // room for the value labels
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c) => c.dataset._labels[c.dataIndex] } },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { display: false } },
                    y: { beginAtZero: true, grace: '15%', grid: { color: gridColor() }, ticks: { color: tickColor(), maxTicksLimit: 4 } },
                },
            },
            plugins: [valueLabelPlugin],
        });
        window._charts.push(chart);
    }
}

function restyleCharts() {
    for (const chart of window._charts) {
        const s = chart.options.scales;
        if (s.y?.ticks) s.y.ticks.color = tickColor();
        if (s.y?.grid) s.y.grid.color = gridColor();
        chart.update('none');
    }
}

function renderFiles(data) {
    const el = document.getElementById('cmp-files');
    el.innerHTML = `
        <div class="cmp-file"><span class="cmp-swatch before"></span><span class="cmp-file-name">${escapeHtml(LBL.before)}</span><code>${escapeHtml(data.before_file)}</code></div>
        <div class="cmp-file"><span class="cmp-swatch after"></span><span class="cmp-file-name">${escapeHtml(LBL.after)}</span><code>${escapeHtml(data.after_file)}</code></div>`;
}

async function load() {
    const opsEl = document.getElementById('cmp-ops');
    try {
        // Relative path + query so this works both standalone and mounted
        // under a run-scoped prefix (e.g. /dash/compare.html?before=A&after=B).
        const resp = await fetch('api/compare' + location.search);
        if (!resp.ok) throw new Error(`server returned ${resp.status}`);
        const data = await resp.json();
        LBL.before = shortName(data.before_file);
        LBL.after = shortName(data.after_file);
        renderFiles(data);
        if (!data.ops || data.ops.length === 0) {
            opsEl.innerHTML = '<section class="card"><div class="card-content"><div class="empty">No comparable operations found.</div></div></section>';
            return;
        }
        chartSpecs = [];
        opsEl.innerHTML = data.ops.map(renderOp).join('');
        buildCharts();
    } catch (err) {
        opsEl.innerHTML = `<section class="card"><div class="card-content"><div class="empty">Failed to load comparison: ${escapeHtml(err.message)}</div></div></section>`;
    }
}

load();
