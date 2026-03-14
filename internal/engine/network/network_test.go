package network

import (
	"testing"
)

func TestHubPeerManagement(t *testing.T) {
	hub := NewHub("local-town", "localhost:8420")

	// Add peers
	hub.AddPeer("remote-1", "192.168.1.10:8420")
	hub.AddPeer("remote-2", "192.168.1.11:8420")

	peers := hub.Peers()
	if len(peers) != 2 {
		t.Errorf("got %d peers, want 2", len(peers))
	}

	// Remove peer
	hub.RemovePeer("remote-1")
	peers = hub.Peers()
	if len(peers) != 1 {
		t.Errorf("got %d peers after remove, want 1", len(peers))
	}

	// Remaining peer should be remote-2
	if peers[0].Name != "remote-2" {
		t.Errorf("remaining peer = %q, want %q", peers[0].Name, "remote-2")
	}
}

func TestHubNoPeers(t *testing.T) {
	hub := NewHub("empty", "localhost:8420")
	peers := hub.Peers()
	if len(peers) != 0 {
		t.Errorf("got %d peers, want 0", len(peers))
	}
}

func TestPeerInitialStatus(t *testing.T) {
	hub := NewHub("local", "localhost:8420")
	hub.AddPeer("remote", "192.168.1.10:8420")

	peers := hub.Peers()
	if peers[0].Status != "unknown" {
		t.Errorf("initial status = %q, want %q", peers[0].Status, "unknown")
	}
}
