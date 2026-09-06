package engine

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestSignalArchiveSurvivesRawPruningAndRestart(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli() - 1000
	tx := EndpointV2{ID: "n-tx", Label: "North", Role: "repeater", Lat: 44, Lng: -77}
	rx := EndpointV2{ID: "n-rx", Label: "South", Role: "repeater", Lat: 44.1, Lng: -77}
	rssi, snr := -80.4, 5.1
	row := PacketViewV2{PacketEventV2: PacketEventV2{ID: "p-signal", At: now, PayloadType: "Text", Mode: "route", RSSI: &rssi, SNR: &snr, Measurement: &SignalMeasurementV2{Transmitter: &tx, Receiver: rx, LocationQuality: "last-known", TransmitterLocationAt: now, ReceiverLocationAt: now}}, Segments: []HistorySegmentV2{{From: tx, To: rx, RouteID: routePublicID(tx.ID, rx.ID)}}}
	// Old checkpoints seed eligible history exactly once.
	if err := writeCheckpoint(e.checkpoint, e.nodes, e.routes, row, row); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Options{Checkpoint: e.checkpoint})
	if err != nil {
		t.Fatal(err)
	}
	before := restored.SignalCoverage(tx.ID, "outgoing", "7d", now+1000)
	if len(before.Summaries) != 1 || before.Summaries[0].Samples != 1 || before.Summaries[0].RSSI.Median != -80 || before.Summaries[0].RSSI.Min != rssi || before.Summaries[0].SNR.Median != 5 {
		t.Fatalf("bad migration: %+v", before)
	}
	restored.packets.rows = nil // raw retention must not control coverage
	if _, ok := restored.flushCheckpoint(time.Now()); !ok {
		t.Fatal("save failed")
	}
	again, err := New(Options{Checkpoint: e.checkpoint})
	if err != nil {
		t.Fatal(err)
	}
	again.packets.add(row) // duplicate after restart remains excluded
	after := again.SignalCoverage(tx.ID, "outgoing", "7d", now+1000)
	if len(after.Summaries) != 1 || after.Summaries[0].Samples != 1 {
		t.Fatal("archive lost or double-counted")
	}
	snapshot := again.packets.coverage.snapshot(now)
	snapshot.Buckets[0].RSSI.Bins[-80] = 999
	var invalid signalArchive
	if invalid.restore(snapshot) == nil {
		t.Fatal("invalid histogram accepted")
	}
	if again.SignalCoverage(tx.ID, "outgoing", "7d", now+1000).Summaries[0].Samples != 1 {
		t.Fatal("snapshot aliases live histogram")
	}
	again.packets.coverage.prune(now + int64(8*24*time.Hour/time.Millisecond))
	if len(again.packets.coverage.buckets) != 0 {
		t.Fatal("expired buckets retained")
	}
}
func TestSignalArchiveCapacityAndCost(t *testing.T) {
	var a signalArchive
	now := time.Now().UnixMilli() - 1000
	start := time.Now()
	for i := 0; i < signalBucketLimit+1; i++ {
		tx := EndpointV2{ID: fmt.Sprintf("n-%d", i), Label: "North", Role: "repeater", Lat: 44, Lng: -77}
		rx := tx
		rx.ID = "n-receiver"
		rssi := -80.0
		a.add(PacketViewV2{PacketEventV2: PacketEventV2{At: now, PayloadType: "Text", RSSI: &rssi, Measurement: &SignalMeasurementV2{Transmitter: &tx, Receiver: rx}}})
	}
	if len(a.buckets) > signalBucketLimit || len(a.seen) > signalSeenLimit {
		t.Fatal("capacity exceeded")
	}
	body, err := json.Marshal(a.snapshot(now))
	if err != nil {
		t.Fatal(err)
	}
	query := time.Now()
	a.summaries("n-100", "outgoing", now-signalBucketMS, now)
	t.Logf("stress buckets=%d bins=%d checkpoint=%d bytes ingest=%s query=%s", len(a.buckets), a.binCount, len(body), time.Since(start), time.Since(query))
}
