package engine

import (
	"encoding/json"
	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
	"strings"
	"testing"
	"time"
)

func TestPartialPathKeepsBothSidesWithoutBridgingUnknownHop(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli()
	nodes := []struct{ key, label string }{{"AA112233", "Alpha"}, {"BB112233", "Bravo"}, {"DD112233", "Delta"}, {"EE112233", "Echo"}, {"FF112233", "Receiver"}}
	for i, n := range nodes {
		e.upsertNode("YKF", n.key, n.label, "repeater", i == 4, 43.4+float64(i)*0.01, -80.4, true, now)
	}
	rssi := -80.0
	message := mqtt.Message{Topic: mqtt.Topic{Region: "YKF", PublisherKey: "FF112233", Kind: "packets"}, ObserverKey: "FF112233", RSSI: &rssi, HeardAt: now, RawHex: packetHex(meshcore.PayloadControl, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee)}
	e.process(message)
	if len(e.routes) != 3 {
		t.Fatalf("wanted three safe links, got %d", len(e.routes))
	}
	bravo := e.nodes[nodeMapKey("YKF", "BB112233")]
	delta := e.nodes[nodeMapKey("YKF", "DD112233")]
	if e.routes[routePublicID(nodePublicID(bravo), nodePublicID(delta))] != nil {
		t.Fatal("invented a link across the gap")
	}
	saved := e.PacketHistory()
	if len(saved) != 1 || !saved[0].Partial || len(saved[0].Path) != 7 {
		t.Fatalf("missing partial path: %+v", saved)
	}
	if saved[0].Path[3].Node != nil || saved[0].Path[3].Label != "Unknown hop" {
		t.Fatal("unknown hop not explicit")
	}
	body, _ := json.Marshal(saved)
	if strings.Contains(string(body), "112233") || strings.Contains(string(body), "raw") {
		t.Fatal("private packet data leaked")
	}
	if _, ok := e.flushCheckpoint(time.Now()); !ok {
		t.Fatal("checkpoint failed")
	}
	restored, err := New(Options{Checkpoint: e.checkpoint})
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.PacketHistory()[0].Path) != 7 {
		t.Fatal("restart lost partial path")
	}
}

func TestPartialPathRetainsNamedUnmappedNodesAndRejectsRFlessLinks(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli()
	e.upsertNode("YKF", "AA112233", "No position", "repeater", false, 0, 0, false, now)
	e.upsertNode("YKF", "BB112233", "Bravo", "repeater", false, 43.4, -80.4, true, now)
	e.upsertNode("YKF", "FF112233", "Receiver", "unknown", true, 43.5, -80.5, true, now)
	e.process(mqtt.Message{Topic: mqtt.Topic{Region: "YKF", PublisherKey: "FF112233", Kind: "packets"}, ObserverKey: "FF112233", HeardAt: now, RawHex: packetHex(meshcore.PayloadControl, 1, 0xaa, 0xbb)})
	if len(e.routes) != 0 {
		t.Fatal("missing RF produced a link")
	}
	rows := e.PacketHistory()
	if len(rows) != 1 || rows[0].Mode != "observer" || !rows[0].Partial {
		t.Fatal("known receiver missing")
	}
	if rows[0].Path[1].Label != "No position (location unavailable)" || rows[0].Path[2].Node == nil {
		t.Fatal("known names or isolated nodes were discarded")
	}
	if !validHistoryPacket(rows[0]) {
		t.Fatal("valid partial checkpoint rejected")
	}
}
