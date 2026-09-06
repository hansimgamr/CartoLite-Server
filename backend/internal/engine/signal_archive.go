package engine

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"sort"
	"time"
)

const signalBucketMS = int64(5 * time.Minute / time.Millisecond)
const signalBucketLimit = 30000
const signalSeenLimit = 20000
const signalBinLimit = 500000

type signalHistogram struct {
	Bins map[int]int `json:"bins"`
	Min  float64     `json:"min"`
	Max  float64     `json:"max"`
}
type signalBucket struct {
	Summary SignalSummaryV2 `json:"summary"`
	At      int64           `json:"at"`
	RSSI    signalHistogram `json:"rssi"`
	SNR     signalHistogram `json:"snr"`
}
type signalArchiveState struct {
	Version int              `json:"version"`
	Buckets []signalBucket   `json:"buckets"`
	Seen    map[string]int64 `json:"seen"`
}

// Protected by packetHistory.mu; the engine writes checkpoints on its ingest goroutine.
type signalArchive struct {
	buckets  map[string]*signalBucket
	seen     map[string]int64
	prunedAt int64
	binCount int
}

func receptionIdentity(row PacketViewV2) string {
	m := row.Measurement
	b, _ := json.Marshal(struct {
		At           int64
		Kind, TX, RX string
		RSSI, SNR    *float64
	}{row.At, row.PayloadType, m.Transmitter.ID, m.Receiver.ID, safeRadio(row.RSSI, -200, 0), safeRadio(row.SNR, -100, 100)})
	return string(b)
}
func signalLocationQuality(row PacketViewV2) string {
	m := row.Measurement
	if m.ReceiverLocationAt == 0 || m.TransmitterLocationAt == 0 {
		return "unknown-age"
	}
	if row.At-m.ReceiverLocationAt > int64(24*time.Hour/time.Millisecond) || row.At-m.TransmitterLocationAt > int64(24*time.Hour/time.Millisecond) {
		return "stale"
	}
	return "last-known"
}
func signalGroupKey(s SignalSummaryV2) string {
	b, _ := json.Marshal([]any{s.Transmitter.ID, s.Receiver.ID, s.Transmitter.Lat, s.Transmitter.Lng, s.Receiver.Lat, s.Receiver.Lng, s.LocationQuality})
	return string(b)
}
func (h *signalHistogram) add(value, scale float64) {
	if h.Bins == nil {
		h.Bins = map[int]int{}
		h.Min = value
		h.Max = value
	}
	h.Bins[int(math.Round(value*scale))]++
	h.Min = math.Min(h.Min, value)
	h.Max = math.Max(h.Max, value)
}
func (h *signalHistogram) merge(other signalHistogram) {
	if len(other.Bins) == 0 {
		return
	}
	if h.Bins == nil {
		h.Bins = map[int]int{}
		h.Min = other.Min
		h.Max = other.Max
	}
	for bin, count := range other.Bins {
		h.Bins[bin] += count
	}
	h.Min = math.Min(h.Min, other.Min)
	h.Max = math.Max(h.Max, other.Max)
}
func (h signalHistogram) stats(scale float64) *SignalStatsV2 {
	if len(h.Bins) == 0 {
		return nil
	}
	keys := make([]int, 0, len(h.Bins))
	count := 0
	for bin, n := range h.Bins {
		keys = append(keys, bin)
		count += n
	}
	sort.Ints(keys)
	rank := func(target int) float64 {
		sum := 0
		for _, bin := range keys {
			sum += h.Bins[bin]
			if sum > target {
				return float64(bin) / scale
			}
		}
		return 0
	}
	return &SignalStatsV2{Count: count, Median: (rank((count-1)/2) + rank(count/2)) / 2, Min: h.Min, Max: h.Max}
}
func (a *signalArchive) add(row PacketViewV2) {
	m := row.Measurement
	if m == nil || m.Transmitter == nil || m.ReceiverLocationAt > row.At || m.TransmitterLocationAt > row.At {
		return
	}
	rssi, snr := safeRadio(row.RSSI, -200, 0), safeRadio(row.SNR, -100, 100)
	if rssi == nil && snr == nil {
		return
	}
	if a.buckets == nil {
		a.buckets = map[string]*signalBucket{}
		a.seen = map[string]int64{}
	}
	identity := receptionIdentity(row)
	if _, ok := a.seen[identity]; ok {
		return
	}
	a.seen[identity] = row.At
	summary := SignalSummaryV2{Transmitter: *m.Transmitter, Receiver: m.Receiver, LocationQuality: signalLocationQuality(row), FirstAt: row.At, LastAt: row.At}
	at := row.At / signalBucketMS * signalBucketMS
	key := fmt.Sprint(at) + signalGroupKey(summary)
	b := a.buckets[key]
	if b == nil {
		b = &signalBucket{Summary: summary, At: at}
		a.buckets[key] = b
	}
	b.Summary.Samples++
	if row.At < b.Summary.FirstAt {
		b.Summary.FirstAt = row.At
	}
	if row.At >= b.Summary.LastAt {
		b.Summary.LastAt = row.At
		b.Summary.Transmitter = *m.Transmitter
		b.Summary.Receiver = m.Receiver
	}
	beforeBins := len(b.RSSI.Bins) + len(b.SNR.Bins)
	if rssi != nil {
		b.RSSI.add(*rssi, 1)
	}
	if snr != nil {
		b.SNR.add(*snr, 4)
	}
	a.binCount += len(b.RSSI.Bins) + len(b.SNR.Bins) - beforeBins
	// ponytail: bounded maps, batch oldest eviction amortizes sorting under unusual location churn.
	if len(a.buckets) > signalBucketLimit || len(a.seen) > signalSeenLimit || a.binCount > signalBinLimit {
		a.prune(time.Now().UnixMilli())
	}
}
func (a *signalArchive) prune(now int64) {
	cutoff := now - int64(7*24*time.Hour/time.Millisecond) - signalBucketMS
	for key, b := range a.buckets {
		if b.At < cutoff {
			a.binCount -= len(b.RSSI.Bins) + len(b.SNR.Bins)
			delete(a.buckets, key)
		}
	}
	for key, at := range a.seen {
		if at < now-int64(10*time.Minute/time.Millisecond) {
			delete(a.seen, key)
		}
	}
	if len(a.buckets) > signalBucketLimit || a.binCount > signalBinLimit {
		keys := make([]string, 0, len(a.buckets))
		for key := range a.buckets {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return a.buckets[keys[i]].At < a.buckets[keys[j]].At })
		for _, key := range keys {
			if len(a.buckets) <= signalBucketLimit*9/10 && a.binCount <= signalBinLimit*9/10 {
				break
			}
			b := a.buckets[key]
			a.binCount -= len(b.RSSI.Bins) + len(b.SNR.Bins)
			delete(a.buckets, key)
		}
	}
	if len(a.seen) > signalSeenLimit {
		keys := make([]string, 0, len(a.seen))
		for key := range a.seen {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return a.seen[keys[i]] < a.seen[keys[j]] })
		for _, key := range keys[:len(keys)-signalSeenLimit*9/10] {
			delete(a.seen, key)
		}
	}
	a.prunedAt = now
}
func (a *signalArchive) snapshot(now int64) *signalArchiveState {
	a.prune(now)
	state := &signalArchiveState{Version: 1, Buckets: []signalBucket{}, Seen: maps.Clone(a.seen)}
	for _, b := range a.buckets {
		copy := *b
		copy.RSSI.Bins = maps.Clone(b.RSSI.Bins)
		copy.SNR.Bins = maps.Clone(b.SNR.Bins)
		state.Buckets = append(state.Buckets, copy)
	}
	return state
}
func (a *signalArchive) restore(state *signalArchiveState) error {
	if state == nil {
		return nil
	}
	if state.Version != 1 || len(state.Buckets) > signalBucketLimit || len(state.Seen) > signalSeenLimit {
		return fmt.Errorf("invalid signal archive bounds")
	}
	a.buckets = map[string]*signalBucket{}
	a.seen = map[string]int64{}
	for _, b := range state.Buckets {
		s := b.Summary
		packet := PacketViewV2{PacketEventV2: PacketEventV2{ID: "p-archive", At: s.FirstAt, Mode: "route", PayloadType: "Text"}, Segments: []HistorySegmentV2{{From: s.Transmitter, To: s.Receiver, RouteID: routePublicID(s.Transmitter.ID, s.Receiver.ID)}}}
		if !validHistoryPacket(packet) || s.Transmitter.ID == s.Receiver.ID || s.Samples < 1 || s.Samples > 1000000000 || b.At < 0 || b.At > time.Now().UnixMilli()+signalBucketMS || b.At%signalBucketMS != 0 || s.FirstAt < b.At || s.LastAt < s.FirstAt || s.LastAt >= b.At+signalBucketMS || (s.LocationQuality != "last-known" && s.LocationQuality != "stale" && s.LocationQuality != "unknown-age") || !validSignalHistogram(b.RSSI, -200, 0, 1, s.Samples) || !validSignalHistogram(b.SNR, -100, 100, 4, s.Samples) || len(b.RSSI.Bins)+len(b.SNR.Bins) == 0 {
			return fmt.Errorf("invalid signal archive bucket")
		}
		key := fmt.Sprint(b.At) + signalGroupKey(s)
		if a.buckets[key] != nil {
			return fmt.Errorf("duplicate signal archive bucket")
		}
		copy := b
		a.buckets[key] = &copy
		a.binCount += len(b.RSSI.Bins) + len(b.SNR.Bins)
		if a.binCount > signalBinLimit {
			return fmt.Errorf("signal archive histogram limit exceeded")
		}
	}
	for key, at := range state.Seen {
		if len(key) > 1024 || at < 0 {
			return fmt.Errorf("invalid reception dedup entry")
		}
		a.seen[key] = at
	}
	a.prune(time.Now().UnixMilli())
	return nil
}
func validSignalHistogram(h signalHistogram, min, max, scale float64, samples int) bool {
	if len(h.Bins) == 0 {
		return true
	}
	if len(h.Bins) > int((max-min)*scale)+1 || safeRadio(&h.Min, min, max) == nil || safeRadio(&h.Max, min, max) == nil || h.Min > h.Max {
		return false
	}
	count := 0
	for bin, n := range h.Bins {
		if bin < int(min*scale) || bin > int(max*scale) || n < 1 || n > samples {
			return false
		}
		count += n
	}
	return count <= samples
}
func (a *signalArchive) summaries(node, direction string, from, to int64) []SignalSummaryV2 {
	groups := map[string]*signalBucket{}
	for _, b := range a.buckets {
		s := b.Summary
		selected := s.Receiver.ID
		if direction == "outgoing" {
			selected = s.Transmitter.ID
		}
		if selected != node || b.At < from || s.LastAt > to {
			continue
		}
		key := signalGroupKey(s)
		g := groups[key]
		if g == nil {
			g = &signalBucket{Summary: s}
			g.Summary.Samples = 0
			groups[key] = g
		}
		g.Summary.Samples += s.Samples
		if s.FirstAt < g.Summary.FirstAt {
			g.Summary.FirstAt = s.FirstAt
		}
		if s.LastAt >= g.Summary.LastAt {
			g.Summary.LastAt = s.LastAt
			g.Summary.Transmitter = s.Transmitter
			g.Summary.Receiver = s.Receiver
		}
		g.RSSI.merge(b.RSSI)
		g.SNR.merge(b.SNR)
	}
	result := []SignalSummaryV2{}
	for _, g := range groups {
		g.Summary.RSSI = g.RSSI.stats(1)
		g.Summary.SNR = g.SNR.stats(4)
		g.Summary.AgeMS = to - g.Summary.LastAt
		result = append(result, g.Summary)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].LastAt != result[j].LastAt {
			return result[i].LastAt > result[j].LastAt
		}
		return signalGroupKey(result[i]) < signalGroupKey(result[j])
	})
	return result
}
