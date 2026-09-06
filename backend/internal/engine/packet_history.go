package engine

import (
	"math"
	"strings"
	"sync"
	"time"
)

const PacketHistoryLimit = 10_000
const PacketHistoryDays = 7

type HistorySegmentV2 struct {
	BreakBefore bool       `json:"breakBefore,omitempty"`
	RouteID     string     `json:"routeId"`
	From        EndpointV2 `json:"from"`
	To          EndpointV2 `json:"to"`
}

// Endpoint snapshots keep old observations readable after topology changes.
type PacketViewV2 struct {
	PacketEventV2
	Segments []HistorySegmentV2 `json:"segments,omitempty"`
}

type packetHistory struct {
	mu   sync.Mutex
	rows []PacketViewV2
}

func (h *packetHistory) prune(now int64) {
	cutoff := now - int64(PacketHistoryDays*24*time.Hour/time.Millisecond)
	kept := h.rows[:0]
	for _, row := range h.rows {
		if row.At >= cutoff {
			kept = append(kept, row)
		}
	}
	clear(h.rows[len(kept):])
	h.rows = kept
	if len(h.rows) > PacketHistoryLimit {
		h.rows = append([]PacketViewV2(nil), h.rows[len(h.rows)-PacketHistoryLimit:]...)
	}
}

func (h *packetHistory) add(packet PacketViewV2) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.rows = append(h.rows, packet)
	h.prune(time.Now().UnixMilli())
}

func (e *Engine) PacketHistory() []PacketViewV2 {
	e.packets.mu.Lock()
	defer e.packets.mu.Unlock()
	e.packets.prune(time.Now().UnixMilli())
	return append([]PacketViewV2{}, e.packets.rows...)
}

func safeRadio(value *float64, min, max float64) *float64 {
	if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) || *value < min || *value > max {
		return nil
	}
	copy := *value
	return &copy
}

func validHistoryPacket(p PacketViewV2) bool {
	endpointOK := func(e EndpointV2) bool {
		return strings.HasPrefix(e.ID, "n-") && len(e.ID) <= 64 && validCoords(e.Lat, e.Lng) &&
			normalizeRole(e.Role) == e.Role && sanitizeLabel(e.Label, e.Role, false) == e.Label
	}
	if !strings.HasPrefix(p.ID, "p-") || len(p.ID) > 64 || p.At <= 0 || !validRouteKind(p.PayloadType) {
		return false
	}
	if p.RSSI != nil && safeRadio(p.RSSI, -200, 0) == nil {
		return false
	}
	if p.SNR != nil && safeRadio(p.SNR, -100, 100) == nil {
		return false
	}
	if m := p.Measurement; m != nil {
		if !endpointOK(m.Receiver) || m.LocationQuality != "last-known" || m.ReceiverLocationAt < 0 || m.TransmitterLocationAt < 0 || (p.RSSI == nil && p.SNR == nil) {
			return false
		}
		if m.Transmitter != nil {
			if !endpointOK(*m.Transmitter) || m.Transmitter.ID == m.Receiver.ID || len(p.Segments) == 0 {
				return false
			}
			last := p.Segments[len(p.Segments)-1]
			if last.From != *m.Transmitter || last.To != m.Receiver {
				return false
			}
		} else if m.TransmitterLocationAt != 0 {
			return false
		}
	}
	if len(p.Path) > 520 {
		return false
	}
	for _, step := range p.Path {
		if step.Node != nil {
			if !endpointOK(*step.Node) || step.Label != step.Node.Label {
				return false
			}
		} else {
			label := strings.TrimSuffix(step.Label, " (location unavailable)")
			if label == "" || sanitizeLabel(label, "unknown", false) != label {
				return false
			}
		}
	}
	if p.Mode == "observer" {
		return p.Observer != nil && endpointOK(*p.Observer) && len(p.Segments) == 0
	}
	if p.Mode != "route" || p.Observer != nil || len(p.Segments) == 0 || len(p.Segments) > 256 {
		return false
	}
	for _, s := range p.Segments {
		if !endpointOK(s.From) || !endpointOK(s.To) || s.RouteID != routePublicID(s.From.ID, s.To.ID) {
			return false
		}
	}
	return true
}
