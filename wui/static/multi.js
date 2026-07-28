/*
 * Warp multi-run comparison view.
 * Fetches /api/multi?runs=id1,id2,... and renders, per operation type, one
 * grouped bar chart per metric (a bar for each run) plus a summary table.
 */

// --- Theme (mirrors compare.js) ---
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
    if (e.key === 't' || e.key === 'T') setTheme(getTheme() === 'dark' ? 'light' : 'dark');
});

// --- Colors ---
// A distinct, colorblind-friendly palette; runs cycle through it in order.
const RUN_COLORS = [
    '#e84a6b', '#4a9ee8', '#2fbf71', '#e8b24a', '#a072e8',
    '#e8724a', '#3fc9c0', '#d94aa8', '#8ea94a', '#6a7bd8',
];
function runColor(i) { return RUN_COLORS[i % RUN_COLORS.length]; }
function gridColor() { return getTheme() === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'; }
function tickColor() { return getTheme() === 'light' ? '#52525b' : '#a1a1aa'; }

// --- Helpers ---
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

let RUNS = [];       // run labels
let chartSpecs = []; // charts to instantiate after the DOM is in place

// bestIndex returns the index of the best run for a metric, or -1 if it can't
// be decided (fewer than two present values). "Best" = highest when
// higherIsBetter, else lowest; zero/absent values are ignored.
function bestIndex(metric) {
    let best = -1, bestVal = null;
    metric.values.forEach((v, i) => {
        if (!metric.present[i]) return;
        if (bestVal === null || (metric.higher_is_better ? v > bestVal : v < bestVal)) {
            bestVal = v; best = i;
        }
    });
    const nPresent = metric.present.filter(Boolean).length;
    return nPresent >= 2 ? best : -1;
}

function renderRunsLegend() {
    const el = document.getElementById('multi-runs');
    el.innerHTML = RUNS.map((label, i) => `
        <div class="multi-run">
            <span class="multi-swatch" style="background:${runColor(i)}"></span>
            <span class="multi-run-name">${escapeHtml(label)}</span>
        </div>`).join('');
}

// metricChart pushes a spec for one metric's grouped bar chart (a bar per run).
// Each card carries a download button that saves just that chart as a JPG.
function metricChart(prefix, j, metric, op) {
    const id = `${prefix}-${j}`;
    chartSpecs.push({ id, metric, op });
    return `
        <div class="cmp-metric-card">
            <div class="multi-card-head">
                <div class="cmp-metric-title">${escapeHtml(metric.name)}${metric.unit ? ` <span class="cmp-unit">(${escapeHtml(metric.unit)})</span>` : ''}</div>
                <button class="multi-dl" data-dl="${id}" title="Download chart as JPG" aria-label="Download chart as JPG">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
            </div>
            <div class="multi-mini-wrap"><canvas id="${id}"></canvas></div>
        </div>`;
}

function renderTable(op) {
    // Rows = metrics, columns = runs. The best cell per row is highlighted.
    const head = RUNS.map((label) => `<th class="cmp-run-col">${escapeHtml(label)}</th>`).join('');
    const body = op.metrics.map((m) => {
        const best = bestIndex(m);
        const cells = m.display.map((d, i) => {
            const cls = i === best ? ' class="multi-best"' : '';
            return `<td${cls}>${escapeHtml(d)}</td>`;
        }).join('');
        const unit = m.unit ? ` <span class="cmp-unit">(${escapeHtml(m.unit)})</span>` : '';
        return `<tr><td class="cmp-metric">${escapeHtml(m.name)}${unit}</td>${cells}</tr>`;
    }).join('');
    return `
        <div class="cmp-table-block">
            <h4 class="cmp-table-title">Summary</h4>
            <div class="table-wrap">
                <table class="cmp-table">
                    <thead><tr><th>Metric</th>${head}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </div>`;
}

function renderOp(op, i) {
    const cards = op.metrics.map((m, j) => metricChart(`chart-${i}`, j, m, op.op)).join('');
    return `
    <section class="card">
        <header class="card-header">
            <div>
                <h2 class="card-title">${escapeHtml(op.op)}</h2>
                <p class="card-description">All selected runs, compared for ${escapeHtml(op.op)} operations</p>
            </div>
            <span class="op-pill">${escapeHtml(op.op)}</span>
        </header>
        <div class="card-content">
            <div class="cmp-metric-grid">${cards}</div>
            ${renderTable(op)}
        </div>
    </section>`;
}

// valueLabelPlugin prints each bar's formatted value above it.
const valueLabelPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
        const ds = chart.data.datasets[0];
        if (!ds || !ds._labels) return;
        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;
        ctx.save();
        ctx.font = "600 10px 'General Sans', sans-serif";
        ctx.fillStyle = tickColor();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        meta.data.forEach((bar, i) => {
            const label = ds._labels[i];
            if (label != null && label !== '—') ctx.fillText(label, bar.x, bar.y - 4);
        });
        ctx.restore();
    },
};

function buildCharts() {
    window._charts = [];
    for (const spec of chartSpecs) {
        const el = document.getElementById(spec.id);
        if (!el) continue;
        const m = spec.metric;
        const colors = RUNS.map((_, i) => (m.present[i] ? runColor(i) : 'rgba(128,128,128,0.25)'));
        const chart = new Chart(el, {
            type: 'bar',
            data: {
                labels: RUNS.map((_, i) => `#${i + 1}`),
                datasets: [{
                    data: m.values.map((v, i) => (m.present[i] ? v : 0)),
                    backgroundColor: colors,
                    borderRadius: 4,
                    _labels: m.display,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 18 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => RUNS[items[0].dataIndex] || '',
                            label: (c) => c.dataset._labels[c.dataIndex],
                        },
                    },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: tickColor(), font: { size: 11 } } },
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
        if (s.x?.ticks) s.x.ticks.color = tickColor();
        if (s.y?.ticks) s.y.ticks.color = tickColor();
        if (s.y?.grid) s.y.grid.color = gridColor();
        chart.update('none');
    }
}

// --- Export (per-chart JPG + full PDF) ---
// Fixed print palette so exports read on white regardless of the UI theme.
const PDF = { slate: [35, 41, 51], muted: [110, 116, 128], accent: [232, 74, 107] };

// whiteBgPlugin fills the canvas white so JPEG export (no alpha) isn't black.
const whiteBgPlugin = {
    id: 'whiteBg',
    beforeDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
    },
};

// exportValueLabelPlugin draws each bar's value above it in dark ink for print.
const exportValueLabelPlugin = {
    id: 'exportValueLabels',
    afterDatasetsDraw(chart) {
        const ds = chart.data.datasets[0];
        if (!ds || !ds._labels) return;
        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;
        ctx.save();
        ctx.font = "600 14px 'General Sans', Arial, sans-serif";
        ctx.fillStyle = '#222';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        meta.data.forEach((bar, i) => {
            const l = ds._labels[i];
            if (l != null && l !== '—') ctx.fillText(l, bar.x, bar.y - 5);
        });
        ctx.restore();
    },
};

// renderMetricJpeg renders one metric's grouped bar chart offscreen at 2x DPI
// with print colors, and returns a JPEG data URL. `labels` are the x-axis
// labels (full run names for a standalone JPG, "#i" for the compact PDF grid).
function renderMetricJpeg(metric, labels, width, height, title) {
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;`;
    const canvas = document.createElement('canvas');
    holder.appendChild(canvas);
    document.body.appendChild(holder);
    const chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: metric.values.map((v, i) => (metric.present[i] ? v : 0)),
                backgroundColor: RUNS.map((_, i) => (metric.present[i] ? runColor(i) : '#d8dbe0')),
                borderRadius: 4,
                _labels: metric.display,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: 2,
            layout: { padding: { top: 24 } },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
                title: title ? { display: true, text: title, color: '#222', font: { size: 15, weight: '600' } } : { display: false },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#555', font: { size: 12 }, maxRotation: 40, minRotation: 0, autoSkip: false } },
                y: { beginAtZero: true, grace: '18%', grid: { color: '#e3e6ea' }, ticks: { color: '#555', font: { size: 13 }, maxTicksLimit: 4 } },
            },
        },
        plugins: [whiteBgPlugin, exportValueLabelPlugin],
    });
    const url = chart.toBase64Image('image/jpeg', 0.92);
    chart.destroy();
    holder.remove();
    return url;
}

function safeName(s) { return String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase(); }

// downloadChart saves a single metric chart as a JPG with the full run names.
function downloadChart(id) {
    const spec = chartSpecs.find((s) => s.id === id);
    if (!spec) return;
    const m = spec.metric;
    const title = `${spec.op} — ${m.name}${m.unit ? ` (${m.unit})` : ''}`;
    const url = renderMetricJpeg(m, RUNS, 720, 460, title);
    const base = (window._multiData && window._multiData.report_name) || 'warp';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-${safeName(spec.op)}-${safeName(m.name)}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// exportPdf renders the whole comparison to a report-grade PDF: a run legend,
// then per operation a grid of metric charts followed by the summary table.
async function exportPdf() {
    const btn = document.getElementById('export-pdf');
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('PDF library failed to load (no network access to the CDN?).');
        return;
    }
    const data = window._multiData;
    if (!data || !data.ops || !data.ops.length) { alert('Nothing to export yet.'); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    await new Promise((r) => setTimeout(r, 30));

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 12;
        const contentW = pageW - 2 * margin;
        let y = margin;
        const ensure = (h) => { if (y + h > pageH - margin) { doc.addPage(); y = margin; } };

        // Title band.
        doc.setFillColor(...PDF.accent); doc.rect(0, 0, pageW, 3, 'F');
        doc.setFontSize(18); doc.setTextColor(...PDF.slate);
        doc.text('Warp Multi-run Comparison', margin, y + 4);
        y += 10;
        doc.setFontSize(9); doc.setTextColor(...PDF.muted);
        doc.text(`Generated ${new Date().toLocaleString()}`, margin, y); y += 6;

        // Run legend: "#i  label".
        doc.setTextColor(...PDF.slate); doc.setFontSize(10);
        doc.text('Runs', margin, y); y += 4;
        doc.setFontSize(9);
        RUNS.forEach((label, i) => {
            ensure(6);
            const c = hexToRgb(runColor(i));
            doc.setFillColor(c[0], c[1], c[2]); doc.rect(margin, y - 2.6, 3, 3, 'F');
            doc.setTextColor(...PDF.slate);
            doc.text(`#${i + 1}  ${label}`, margin + 5, y);
            y += 5;
        });
        y += 3;
        doc.setTextColor(0);

        const idxLabels = RUNS.map((_, i) => `#${i + 1}`);

        for (const op of data.ops) {
            ensure(16);
            // Operation header bar.
            doc.setFillColor(...PDF.slate);
            doc.roundedRect(margin, y, contentW, 8, 1.5, 1.5, 'F');
            doc.setTextColor(255); doc.setFontSize(12);
            doc.text(op.op, margin + 3, y + 5.6);
            doc.setTextColor(0);
            y += 12;

            // Metric charts, 3 per row.
            const perRow = 3, gap = 5;
            const cw = (contentW - (perRow - 1) * gap) / perRow;
            const imgH = cw * 0.72;
            for (let k = 0; k < op.metrics.length; k++) {
                const col = k % perRow;
                if (col === 0) ensure(imgH + 4);
                const x = margin + col * (cw + gap);
                const m = op.metrics[k];
                const title = `${m.name}${m.unit ? ` (${m.unit})` : ''}`;
                try {
                    doc.addImage(renderMetricJpeg(m, idxLabels, 460, 320, title), 'JPEG', x, y, cw, imgH, undefined, 'FAST');
                } catch (e) { /* skip a chart that fails to render */ }
                if (col === perRow - 1 || k === op.metrics.length - 1) y += imgH + 4;
            }

            // Summary table: rows = metrics, columns = runs (#i).
            ensure(16);
            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin },
                head: [['Metric', ...idxLabels]],
                body: op.metrics.map((m) => [
                    m.name + (m.unit ? ` (${m.unit})` : ''),
                    ...m.display,
                ]),
                styles: { fontSize: 8, cellPadding: 1.6 },
                headStyles: { fillColor: PDF.slate },
                alternateRowStyles: { fillColor: [245, 247, 249] },
                columnStyles: { 0: { fontStyle: 'bold' } },
                didParseCell: (d) => {
                    if (d.section === 'body' && d.column.index >= 1) {
                        const m = op.metrics[d.row.index];
                        if (d.column.index - 1 === bestIndex(m)) {
                            d.cell.styles.textColor = PDF.accent;
                            d.cell.styles.fontStyle = 'bold';
                        }
                    }
                },
            });
            y = doc.lastAutoTable.finalY + 8;
        }

        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        doc.save(`${(data.report_name || `warp-multi-compare-${stamp}`)}.pdf`);
    } catch (err) {
        console.error('PDF export failed:', err);
        alert('PDF export failed: ' + (err && err.message ? err.message : err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Export PDF'; }
    }
}

function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

document.getElementById('export-pdf')?.addEventListener('click', exportPdf);

async function load() {
    const opsEl = document.getElementById('multi-ops');
    try {
        // Relative path + query so this works mounted under /dash/.
        const resp = await fetch('api/multi' + location.search);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `server returned ${resp.status}`);
        }
        const data = await resp.json();
        window._multiData = data; // used by the PDF export
        RUNS = data.runs || [];
        renderRunsLegend();
        if (!data.ops || data.ops.length === 0) {
            opsEl.innerHTML = '<section class="card"><div class="card-content"><div class="empty">No comparable operations found across the selected runs.</div></div></section>';
            document.getElementById('export-pdf')?.setAttribute('disabled', '');
            return;
        }
        chartSpecs = [];
        opsEl.innerHTML = data.ops.map(renderOp).join('');
        buildCharts();
        opsEl.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => downloadChart(b.dataset.dl)));
    } catch (err) {
        opsEl.innerHTML = `<section class="card"><div class="card-content"><div class="empty">Failed to load comparison: ${escapeHtml(err.message)}</div></div></section>`;
    }
}

setTheme(getTheme());
load();
