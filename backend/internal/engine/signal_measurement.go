package engine

import (
	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

func (e *Engine) signalMeasurement(message mqtt.Message, packet meshcore.Packet, source, receiver *privateNode, segments []RouteSegmentV2) *SignalMeasurementV2 {
	if receiver == nil || !receiver.HasCoords || (safeRadio(message.RSSI, -200, 0) == nil && safeRadio(message.SNR, -100, 100) == nil) {
		return nil
	}
	m := &SignalMeasurementV2{Receiver: endpointFor(receiver), ReceiverLocationAt: receiver.CoordsAt, LocationQuality: "last-known"}
	if packet.InvalidForMap {
		return m
	}
	transmitter := source
	if len(packet.Path) > 0 {
		prefix := packet.Path[len(packet.Path)-1]
		// Count every identity, including non-forwarders: a colliding prefix is not proof.
		matches := e.prefixes[prefixMapKey(message.Topic.Region, packet.HashSize, prefix)]
		if len(matches) != 1 {
			return m
		}
		for key := range matches {
			transmitter = e.nodes[key]
		}
		if transmitter == nil || (transmitter.Role != "repeater" && transmitter.Role != "room_server") {
			return m
		}
	}
	if transmitter == nil || !transmitter.HasCoords || transmitter == receiver {
		return m
	}
	// Require the actual final radio link to have passed existing route gates.
	if len(segments) == 0 {
		return m
	}
	last := segments[len(segments)-1]
	if last.FromID != nodePublicID(transmitter) || last.ToID != nodePublicID(receiver) {
		return m
	}
	endpoint := endpointFor(transmitter)
	m.Transmitter = &endpoint
	m.TransmitterLocationAt = transmitter.CoordsAt
	return m
}
