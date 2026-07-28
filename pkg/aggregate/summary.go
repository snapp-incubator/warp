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

package aggregate

// OpSummary is a flat set of headline metrics for a single operation type
// within one benchmark run. Unlike Compare (before/after), it describes one run
// in isolation, so the multi-run comparison view can line several runs up for
// the same operation. All latency values are in milliseconds.
type OpSummary struct {
	Op          string `json:"op"`
	Requests    int    `json:"requests"`
	Objects     int    `json:"objects"`
	Errors      int    `json:"errors"`
	Concurrency int    `json:"concurrency"`

	// Throughput.
	AvgMiBps     float64 `json:"avg_mibps"`
	PeakMiBps    float64 `json:"peak_mibps"`
	AvgObjPerSec float64 `json:"avg_obj_per_sec"`
	AvgOpsPerSec float64 `json:"avg_ops_per_sec"`

	// Request latency (ms). Valid only when HasReqStats is true.
	HasReqStats bool    `json:"has_req_stats"`
	ReqAvgMs    float64 `json:"req_avg_ms"`
	ReqP50Ms    float64 `json:"req_p50_ms"`
	ReqP90Ms    float64 `json:"req_p90_ms"`
	ReqP99Ms    float64 `json:"req_p99_ms"`

	// Time to first byte (ms). Valid only when HasTTFB is true.
	HasTTFB   bool    `json:"has_ttfb"`
	TTFBP50Ms float64 `json:"ttfb_p50_ms"`
	TTFBP99Ms float64 `json:"ttfb_p99_ms"`
}

const bytesPerMiB = 1 << 20

// SummarizeOp extracts headline metrics for a single operation from a run's
// aggregate. It never errors: runs with recorded errors (e.g. an OOM-killed
// gateway) still summarize, so they remain visible in the comparison.
func SummarizeOp(l *LiveAggregate, op string) OpSummary {
	s := OpSummary{
		Op:          op,
		Requests:    l.TotalRequests,
		Objects:     l.TotalObjects,
		Errors:      l.TotalErrors,
		Concurrency: l.Concurrency,
	}

	tp := l.Throughput
	if tp.MeasureDurationMillis > 0 {
		s.AvgMiBps = float64(tp.BytesPS()) / bytesPerMiB
		s.AvgObjPerSec = tp.ObjectsPS()
		s.AvgOpsPerSec = tp.OpsPS()
	}
	s.PeakMiBps = s.AvgMiBps
	if tp.Segmented != nil && tp.Segmented.FastestBPS > 0 {
		s.PeakMiBps = tp.Segmented.FastestBPS / bytesPerMiB
	}

	if l.Requests != nil {
		req, _ := mergeRequests(l.Requests)
		if req.Requests > 0 && req.MergedEntries > 0 {
			inv := 1.0 / float64(req.MergedEntries)
			s.HasReqStats = true
			s.ReqAvgMs = req.DurAvgMillis * inv
			s.ReqP50Ms = req.DurMedianMillis * inv
			s.ReqP90Ms = req.Dur90Millis * inv
			s.ReqP99Ms = req.Dur99Millis * inv
			if req.FirstByte != nil {
				s.HasTTFB = true
				s.TTFBP50Ms = req.FirstByte.MedianMillis * inv
				s.TTFBP99Ms = req.FirstByte.P99Millis * inv
			}
		}
	}
	return s
}
