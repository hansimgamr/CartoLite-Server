package engine

import (
	"testing"
	"time"
)

func TestSignalCoverageSummaries(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli()
	tx := EndpointV2{ID: "n-tx", Label: "TX", Role: "repeater", Lat: 44, Lng: -77}
	rx := EndpointV2{ID: "n-rx", Label: "RX", Role: "repeater", Lat: 44.1, Lng: -77}
	add := func(at int64, value float64, receiver EndpointV2, locationAt int64) {
		snr := 5.0
		e.packets.add(PacketViewV2{PacketEventV2: PacketEventV2{ID: "p-event", At: at, PayloadType: "Text", RSSI: &value, SNR: &snr, Measurement: &SignalMeasurementV2{Receiver: receiver, Transmitter: &tx, ReceiverLocationAt: locationAt, TransmitterLocationAt: locationAt, LocationQuality: "last-known"}}})
	}
	add(now-1000, -90, rx, now-2000)
	add(now-500, -70, rx, now-2000)
	add(now-500, -70, rx, now-2000) // repeated reception
	other := rx
	other.ID = "n-other"
	add(now-500, -70, other, now-2000)
	moved := rx
	moved.Lat = 45
	add(now-250, -60, moved, now-2000)
	add(now-100, -80, rx, 0)
	add(now-80, -85, rx, now-(25*time.Hour).Milliseconds())
	add(now-50, -30, rx, now) // future location must be excluded
	add(now-(2*time.Hour).Milliseconds(), -100, rx, now-(3*time.Hour).Milliseconds())
	e.packets.add(PacketViewV2{PacketEventV2: PacketEventV2{At: now}})
	out := e.SignalCoverage(tx.ID, "outgoing", "1h", now)
	if len(out.Summaries) != 5 || out.Excluded["duplicate-reception"] != 1 || out.Excluded["location-newer-than-packet"] != 1 || out.Unassigned != 1 {
		t.Fatalf("unexpected summary: %+v", out)
	}
	found := false
	for _, s := range out.Summaries {
		if s.Receiver.ID == rx.ID && s.Receiver.Lat == rx.Lat && s.LocationQuality == "last-known" {
			found = true
			if s.Samples != 2 || s.RSSI.Median != -80 || s.RSSI.Min != -90 || s.RSSI.Max != -70 || s.SNR.Count != 2 || s.AgeMS != 500 || s.FirstAt != now-1000 {
				t.Fatalf("wrong statistics: %+v", s)
			}
		}
	}
	if !found {
		t.Fatal("missing group")
	}
	incoming := e.SignalCoverage(rx.ID, "incoming", "1h", now)
	if len(incoming.Summaries) != 4 {
		t.Fatal("incoming included another receiver")
	}
	if len(e.SignalCoverage(tx.ID, "incoming", "1h", now).Summaries) != 0 {
		t.Fatal("invented reverse reception")
	}
	day := e.SignalCoverage(tx.ID, "outgoing", "24h", now)
	for _, s := range day.Summaries {
		if s.Receiver.ID == rx.ID && s.Receiver.Lat == rx.Lat && s.LocationQuality == "last-known" && (s.Samples != 3 || s.RSSI.Median != -90) {
			t.Fatal("wrong wider window")
		}
	}
	if len(e.SignalCoverage(tx.ID, "outgoing", "7d", now).Summaries) != len(day.Summaries) {
		t.Fatal("wrong week window")
	}
}
