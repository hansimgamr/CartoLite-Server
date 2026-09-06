package engine

import (
	"encoding/json"
	"sort"
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
	SchemaVersion int               `json:"schemaVersion"`
	NodeID        string            `json:"nodeId"`
	Direction     string            `json:"direction"`
	Window        string            `json:"window"`
	From          int64             `json:"from"`
	To            int64             `json:"to"`
	Partial       bool              `json:"partial"`
	Unassigned    int               `json:"unassigned"`
	Excluded      map[string]int    `json:"excluded"`
	Summaries     []SignalSummaryV2 `json:"summaries"`
}

// SignalCoverage scans at most PacketHistoryLimit retained records.
func (e *Engine) SignalCoverage(nodeID, direction, window string, now int64) SignalCoverageV2 {
	hours := map[string]int64{"1h": 1, "24h": 24, "7d": 168}[window]
	result := SignalCoverageV2{SchemaVersion: 2, NodeID: nodeID, Direction: direction, Window: window, From: now - hours*time.Hour.Milliseconds(), To: now, Partial: true, Excluded: map[string]int{}, Summaries: []SignalSummaryV2{}}
	type groupKey struct {
		TX, RX                     string
		TXLat, TXLng, RXLat, RXLng float64
		Quality                    string
	}
	type bucket struct {
		summary   SignalSummaryV2
		rssi, snr []float64
	}
	groups := map[groupKey]*bucket{}
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
		identity, _ := json.Marshal(struct {
			At           int64
			Kind, TX, RX string
			RSSI, SNR    *float64
		}{row.At, row.PayloadType, m.Transmitter.ID, m.Receiver.ID, rssi, snr})
		if seen[string(identity)] {
			result.Excluded["duplicate-reception"]++
			continue
		}
		seen[string(identity)] = true
		quality := "last-known"
		if m.ReceiverLocationAt == 0 || m.TransmitterLocationAt == 0 {
			quality = "unknown-age"
		} else if row.At-m.ReceiverLocationAt > (24*time.Hour).Milliseconds() || row.At-m.TransmitterLocationAt > (24*time.Hour).Milliseconds() {
			quality = "stale"
		}
		key := groupKey{m.Transmitter.ID, m.Receiver.ID, m.Transmitter.Lat, m.Transmitter.Lng, m.Receiver.Lat, m.Receiver.Lng, quality}
		b := groups[key]
		if b == nil {
			b = &bucket{summary: SignalSummaryV2{Transmitter: *m.Transmitter, Receiver: m.Receiver, LocationQuality: quality, FirstAt: row.At, LastAt: row.At}}
			groups[key] = b
		}
		b.summary.Samples++
		if row.At < b.summary.FirstAt {
			b.summary.FirstAt = row.At
		}
		if row.At >= b.summary.LastAt {
			b.summary.LastAt = row.At
			b.summary.Transmitter = *m.Transmitter
			b.summary.Receiver = m.Receiver
		}
		if rssi != nil {
			b.rssi = append(b.rssi, *rssi)
		}
		if snr != nil {
			b.snr = append(b.snr, *snr)
		}
	}
	for _, b := range groups {
		b.summary.RSSI = signalStats(b.rssi)
		b.summary.SNR = signalStats(b.snr)
		b.summary.AgeMS = now - b.summary.LastAt
		result.Summaries = append(result.Summaries, b.summary)
	}
	sort.Slice(result.Summaries, func(i, j int) bool {
		a, b := result.Summaries[i], result.Summaries[j]
		if a.LastAt != b.LastAt {
			return a.LastAt > b.LastAt
		}
		ak, _ := json.Marshal(a)
		bk, _ := json.Marshal(b)
		return string(ak) < string(bk)
	})
	return result
}

func signalStats(values []float64) *SignalStatsV2 {
	if len(values) == 0 {
		return nil
	}
	sort.Float64s(values)
	n := len(values)
	median := values[n/2]
	if n%2 == 0 {
		median = (values[n/2-1] + median) / 2
	}
	return &SignalStatsV2{Count: n, Median: median, Min: values[0], Max: values[n-1]}
}
