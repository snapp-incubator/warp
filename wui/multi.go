/*
 * Warp (C) 2019-2026 MinIO, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

package wui

import (
	"fmt"
	"sort"

	"github.com/minio/warp/pkg/aggregate"
)

// MultiData is the payload served at /api/multi. It lines up several benchmark
// runs against each other, grouped by operation type, so all results for one
// operation (e.g. every GET run) can be compared on a single page.
type MultiData struct {
	Runs []string  `json:"runs"` // run labels, in the order they were selected
	Ops  []MultiOp `json:"ops"`  // one section per operation present in any run
	// ReportName is an optional PDF-friendly base name the frontend uses to name
	// the exported PDF. Empty when unknown.
	ReportName string `json:"report_name,omitempty"`
}

// MultiOp holds every comparable metric for one operation type. Each metric is
// a row of per-run values, aligned with MultiData.Runs.
type MultiOp struct {
	Op      string        `json:"op"`
	Metrics []MultiMetric `json:"metrics"`
}

// MultiMetric is one metric charted across all runs. Values/Display/Present are
// aligned with MultiData.Runs. Present is false for runs that lack this op.
type MultiMetric struct {
	Name           string    `json:"name"`
	Unit           string    `json:"unit"`
	HigherIsBetter bool      `json:"higher_is_better"`
	Values         []float64 `json:"values"`
	Display        []string  `json:"display"`
	Present        []bool    `json:"present"`
}

// MultiRun pairs a run's parsed result with its display label.
type MultiRun struct {
	Label string
	Data  *aggregate.Realtime
}

// BuildMultiData compares any number of runs. For every operation type present
// in at least one run it emits a set of metrics, dropping metrics that are zero
// (or absent) for every run so the view stays focused on what actually differs.
func BuildMultiData(runs []MultiRun) *MultiData {
	out := &MultiData{}
	for _, r := range runs {
		out.Runs = append(out.Runs, r.Label)
	}

	// Collect the union of operation types across all runs, in a stable order.
	opSet := map[string]bool{}
	for _, r := range runs {
		if r.Data == nil {
			continue
		}
		for typ := range r.Data.ByOpType {
			opSet[typ] = true
		}
	}
	ops := make([]string, 0, len(opSet))
	for typ := range opSet {
		ops = append(ops, typ)
	}
	sort.Strings(ops)

	for _, typ := range ops {
		// Summarize this op for each run (zero-valued when the run lacks it).
		sums := make([]aggregate.OpSummary, len(runs))
		present := make([]bool, len(runs))
		for i, r := range runs {
			if r.Data == nil {
				continue
			}
			if la := r.Data.ByOpType[typ]; la != nil {
				sums[i] = aggregate.SummarizeOp(la, typ)
				present[i] = true
			}
		}
		op := MultiOp{Op: typ}
		for _, m := range metricDefs {
			metric := buildMetric(m, sums, present)
			if metric != nil {
				op.Metrics = append(op.Metrics, *metric)
			}
		}
		if len(op.Metrics) > 0 {
			out.Ops = append(out.Ops, op)
		}
	}
	return out
}

// metricDef describes one comparable metric and how to pull it from a summary.
type metricDef struct {
	name           string
	unit           string
	higherIsBetter bool
	get            func(aggregate.OpSummary) (val float64, ok bool)
	format         func(float64) string
}

func fmtRate(v float64) string  { return fmt.Sprintf("%.1f", v) }
func fmtMs(v float64) string    { return fmt.Sprintf("%.1f ms", v) }
func fmtCount(v float64) string { return fmt.Sprintf("%.0f", v) }

var metricDefs = []metricDef{
	{"Avg throughput", "MiB/s", true, func(s aggregate.OpSummary) (float64, bool) { return s.AvgMiBps, s.AvgMiBps > 0 }, fmtRate},
	{"Peak throughput", "MiB/s", true, func(s aggregate.OpSummary) (float64, bool) { return s.PeakMiBps, s.PeakMiBps > 0 }, fmtRate},
	{"Throughput", "ops/s", true, func(s aggregate.OpSummary) (float64, bool) { return s.AvgOpsPerSec, s.AvgOpsPerSec > 0 }, fmtRate},
	{"Objects", "obj/s", true, func(s aggregate.OpSummary) (float64, bool) { return s.AvgObjPerSec, s.AvgObjPerSec > 0 }, fmtRate},
	{"Req P50", "ms", false, func(s aggregate.OpSummary) (float64, bool) { return s.ReqP50Ms, s.HasReqStats }, fmtMs},
	{"Req P99", "ms", false, func(s aggregate.OpSummary) (float64, bool) { return s.ReqP99Ms, s.HasReqStats }, fmtMs},
	{"TTFB P50", "ms", false, func(s aggregate.OpSummary) (float64, bool) { return s.TTFBP50Ms, s.HasTTFB }, fmtMs},
	{"TTFB P99", "ms", false, func(s aggregate.OpSummary) (float64, bool) { return s.TTFBP99Ms, s.HasTTFB }, fmtMs},
	{"Errors", "count", false, func(s aggregate.OpSummary) (float64, bool) { return float64(s.Errors), s.Errors > 0 }, fmtCount},
}

// buildMetric assembles a metric across runs, or returns nil if no run has a
// meaningful value for it.
func buildMetric(m metricDef, sums []aggregate.OpSummary, present []bool) *MultiMetric {
	metric := MultiMetric{
		Name:           m.name,
		Unit:           m.unit,
		HigherIsBetter: m.higherIsBetter,
		Values:         make([]float64, len(sums)),
		Display:        make([]string, len(sums)),
		Present:        make([]bool, len(sums)),
	}
	any := false
	for i, s := range sums {
		if !present[i] {
			metric.Display[i] = "—"
			continue
		}
		v, ok := m.get(s)
		metric.Values[i] = v
		metric.Present[i] = ok
		if ok {
			metric.Display[i] = m.format(v)
			any = true
		} else {
			metric.Display[i] = "—"
		}
	}
	if !any {
		return nil
	}
	return &metric
}
