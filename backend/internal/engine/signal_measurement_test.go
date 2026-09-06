package engine

import (
	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
	"testing"
	"time"
)

func TestSignalMeasurementFinalHopAndPersistence(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli()
	for i, key := range []string{"AA112233", "BB112233", "FF112233"} {
		e.upsertNode("YKF", key, "Radio", "repeater", i == 2, 44+float64(i)*0.01, -77, true, now)
	}
	rssi := -80.0
	message := mqtt.Message{Topic: mqtt.Topic{Region: "YKF", PublisherKey: "FF112233", Kind: "packets"}, ObserverKey: "FF112233", HeardAt: now, RSSI: &rssi}
	// An earlier gap must not discard a known final hop.
	message.RawHex = packetHex(meshcore.PayloadControl, 1, 0xcc, 0xaa, 0xbb)
	e.process(message)
	rows := e.PacketHistory()
	m := rows[0].Measurement
	if m == nil || m.Transmitter == nil || m.Transmitter.ID != nodePublicID(e.nodes[nodeMapKey("YKF", "BB112233")]) || m.ReceiverLocationAt != now {
		t.Fatalf("missing final-hop measurement: %+v", m)
	}
	// A later topology move must not rewrite the saved coordinates.
	e.upsertNode("YKF", "BB112233", "Radio", "repeater", false, 45, -77, true, now+1000)
	if m.Transmitter.Lat != 44.01 {
		t.Fatal("snapshot changed")
	}
	if _, ok := e.flushCheckpoint(time.Now()); !ok {
		t.Fatal("checkpoint failed")
	}
	restored, err := New(Options{Checkpoint: e.checkpoint})
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.PacketHistory()) != 1 || restored.PacketHistory()[0].Measurement.Transmitter.Lat != 44.01 {
		t.Fatal("measurement lost on restart")
	}
	// A final unknown hop must not borrow the last earlier mapped segment.
	message.RawHex = packetHex(meshcore.PayloadControl, 1, 0xaa, 0xbb, 0xcc)
	e.process(message)
	rows = e.PacketHistory()
	if rows[len(rows)-1].Measurement.Transmitter != nil {
		t.Fatal("unknown final hop attributed")
	}
	// Even a companion with the same prefix makes identity ambiguous.
	e.upsertNode("YKF", "BB998877", "Collision", "companion", false, 44.02, -77, true, now)
	message.RawHex = packetHex(meshcore.PayloadControl, 1, 0xaa, 0xbb)
	e.process(message)
	rows = e.PacketHistory()
	if rows[len(rows)-1].Measurement.Transmitter != nil {
		t.Fatal("collision attributed")
	}
	message.RSSI = nil
	e.process(message)
	rows = e.PacketHistory()
	if rows[len(rows)-1].Measurement != nil {
		t.Fatal("missing RF accepted")
	}
	bad := rows[0]
	copy := *bad.Measurement
	bad.Measurement = &copy
	copy.Receiver.ID = opaqueID("n", "wrong")
	if validHistoryPacket(bad) {
		t.Fatal("wrong receiver accepted")
	}
}
