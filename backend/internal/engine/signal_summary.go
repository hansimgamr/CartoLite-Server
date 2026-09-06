package engine

import (
	"time"
)

type SignalStatsV2 struct {
	Count  int     `json:"count"`
	Median float64 `json:"median"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
}
type SignalSummaryV2 struct {
	Transmitter     EndpointV2     `json:"transmitter"`
	Receiver        EndpointV2     `json:"receiver"`
	LocationQuality string         `json:"locationQuality"`
	Samples         int            `json:"samples"`
	FirstAt         int64          `json:"firstAt"`
	LastAt          int64          `json:"lastAt"`
	AgeMS           int64          `json:"ageMs"`
	RSSI            *SignalStatsV2 `json:"rssi,omitempty"`
	SNR             *SignalStatsV2 `json:"snr,omitempty"`
}
type SignalCoverageV2 struct {
	BucketMinutes     int               `json:"bucketMinutes"`
	ApproximateMedian bool              `json:"approximateMedian"`
	ExclusionScope    string            `json:"exclusionScope"`
	SchemaVersion     int               `json:"schemaVersion"`
	NodeID            string            `json:"nodeId"`
	Direction         string            `json:"direction"`
	Window            string            `json:"window"`
	From              int64             `json:"from"`
	To                int64             `json:"to"`
	Partial           bool              `json:"partial"`
	Unassigned        int               `json:"unassigned"`
	Excluded          map[string]int    `json:"excluded"`
	Summaries         []SignalSummaryV2 `json:"summaries"`
}

// Coverage uses persistent buckets; exclusion diagnostics describe retained raw history only.
func (e *Engine) SignalCoverage(nodeID, direction, window string, now int64) SignalCoverageV2 {
	hours := map[string]int64{"1h": 1, "24h": 24, "7d": 168}[window]
	result := SignalCoverageV2{SchemaVersion: 2, NodeID: nodeID, Direction: direction, Window: window, From: now - hours*time.Hour.Milliseconds(), To: now, Partial: true, Excluded: map[string]int{}, Summaries: []SignalSummaryV2{}}
	seen := map[string]bool{}
	for _, row := range e.PacketHistory() {
		if row.At < result.From || row.At > now {
			continue
		}
		m := row.Measurement
		if m == nil {
			result.Unassigned++
			continue
		}
		selected := m.Receiver.ID
		if direction == "outgoing" {
			if m.Transmitter == nil {
				result.Unassigned++
				continue
			}
			selected = m.Transmitter.ID
		}
		if selected != nodeID {
			continue
		}
		if m.Transmitter == nil {
			result.Excluded["unattributed-transmitter"]++
			continue
		}
		if m.ReceiverLocationAt > row.At || m.TransmitterLocationAt > row.At {
			result.Excluded["location-newer-than-packet"]++
			continue
		}
		rssi, snr := safeRadio(row.RSSI, -200, 0), safeRadio(row.SNR, -100, 100)
		if rssi == nil && snr == nil {
			result.Excluded["missing-radio"]++
			continue
		}
		// No payload hashes: only collapse identical sanitized receptions at the same millisecond.
		// ponytail: identical receptions can collide within 1ms; use receiver event IDs if the feed supplies them.
		identity := receptionIdentity(row)
		if seen[identity] {
			result.Excluded["duplicate-reception"]++
			continue
		}
		seen[identity] = true

	}
	e.packets.mu.Lock()
	result.From = result.From / signalBucketMS * signalBucketMS
	result.Summaries = e.packets.coverage.summaries(nodeID, direction, result.From, now)
	e.packets.mu.Unlock()
	result.BucketMinutes = 5
	result.ApproximateMedian = true
	result.ExclusionScope = "retained-raw-history"

	return result
}
