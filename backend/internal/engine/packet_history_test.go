package engine

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestPacketHistorySurvivesCheckpointWithRadio(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	e, err := New(Options{Checkpoint: path})
	if err != nil {
		t.Fatal(err)
	}
	a := EndpointV2{ID: opaqueID("n", "a"), Label: "North", Role: "repeater", Lat: 44, Lng: -77}
	b := EndpointV2{ID: opaqueID("n", "b"), Label: "South", Role: "companion", Lat: 44.1, Lng: -77}
	rssi, snr := -82.0, 6.25
	e.emitPacket(time.Now().UnixMilli(), "Text", nil, &b, nil, &rssi, &snr)
	route := PacketViewV2{PacketEventV2: PacketEventV2{ID: opaqueID("p", "route"), At: time.Now().UnixMilli(), PayloadType: "Trace", Mode: "route"}, Segments: []HistorySegmentV2{{RouteID: routePublicID(a.ID, b.ID), From: a, To: b}}}
	e.packets.add(route)
	if _, ok := e.flushCheckpoint(time.Now()); !ok {
		t.Fatal("save failed")
	}
	restored, err := New(Options{Checkpoint: path})
	if err != nil {
		t.Fatal(err)
	}
	rows := restored.PacketHistory()
	if len(rows) != 2 || rows[0].RSSI == nil || *rows[0].RSSI != rssi || rows[1].Segments[0].From.Label != "North" {
		t.Fatalf("history not restored: %+v", rows)
	}
	body, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var public []map[string]json.RawMessage
	if err = json.Unmarshal(body, &public); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"seq": true, "id": true, "at": true, "payloadType": true, "mode": true, "observer": true, "segments": true, "rssi": true, "snr": true, "path": true, "partial": true}
	for _, row := range public {
		for key := range row {
			if !allowed[key] {
				t.Fatalf("unexpected public field %s", key)
			}
		}
	}
	unsafe := route
	unsafe.Segments = append([]HistorySegmentV2(nil), route.Segments...)
	unsafe.Segments[0].From.Label = "AA11BB22CC33"
	if validHistoryPacket(unsafe) {
		t.Fatal("unsafe label accepted")
	}
}

func TestPacketHistoryBoundsAndRadioValidation(t *testing.T) {
	now := time.Now().UnixMilli()
	h := packetHistory{}
	h.rows = append(h.rows, PacketViewV2{PacketEventV2: PacketEventV2{At: now - int64(8*24*time.Hour/time.Millisecond)}})
	for i := 0; i < PacketHistoryLimit+2; i++ {
		h.rows = append(h.rows, PacketViewV2{PacketEventV2: PacketEventV2{At: now, Seq: uint64(i)}})
	}
	h.prune(now)
	if len(h.rows) != PacketHistoryLimit || h.rows[0].Seq != 2 {
		t.Fatal("retention bounds failed")
	}
	invalid := 999.0
	if safeRadio(&invalid, -200, 0) != nil {
		t.Fatal("invalid RSSI accepted")
	}
}
