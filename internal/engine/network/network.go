// Package network implements multi-host networking for Night City.
//
// Allows towns on different machines to discover each other, share agent
// status, and route messages across hosts via MCP-over-SSE transport.
//
// Architecture:
//
//	Host 1 (DevTown)          Host 2 (MarketingTown)
//	├── mayor                 ├── marketing-lead
//	├── architect      ◄─────► ├── seo-specialist
//	├── worker x2      MCP    ├── researcher
//	└── dashboard :8420 SSE   └── dashboard :8421
//	         │                         │
//	         └──── Hub Dashboard ──────┘
//	               (aggregates both)
package network

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Peer represents a remote town instance.
type Peer struct {
	Name     string `json:"name" yaml:"name"`
	Host     string `json:"host" yaml:"host"`
	Addr     string `json:"addr" yaml:"addr"` // e.g., "192.168.1.10:8420"
	LastSeen time.Time `json:"last_seen"`
	Status   string `json:"status"` // online, offline, unknown
}

// Hub manages connections to peer towns.
type Hub struct {
	mu       sync.RWMutex
	peers    map[string]*Peer // name → peer
	localName string
	localAddr string
}

// NewHub creates a network hub for inter-town communication.
func NewHub(localName, localAddr string) *Hub {
	return &Hub{
		peers:     make(map[string]*Peer),
		localName: localName,
		localAddr: localAddr,
	}
}

// AddPeer registers a remote town.
func (h *Hub) AddPeer(name, addr string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.peers[name] = &Peer{
		Name:   name,
		Addr:   addr,
		Status: "unknown",
	}
}

// RemovePeer unregisters a remote town.
func (h *Hub) RemovePeer(name string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.peers, name)
}

// Peers returns all registered peers.
func (h *Hub) Peers() []*Peer {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make([]*Peer, 0, len(h.peers))
	for _, p := range h.peers {
		result = append(result, p)
	}
	return result
}

// HealthCheck pings all peers and updates their status.
func (h *Hub) HealthCheck(ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, peer := range h.peers {
		client := &http.Client{Timeout: 5 * time.Second}
		url := fmt.Sprintf("http://%s/api/status", peer.Addr)
		resp, err := client.Get(url)
		if err != nil {
			peer.Status = "offline"
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			peer.Status = "online"
			peer.LastSeen = time.Now()

			// Parse host info from response
			var status struct {
				Host string `json:"host"`
			}
			json.NewDecoder(resp.Body).Decode(&status)
			if status.Host != "" {
				peer.Host = status.Host
			}
		} else {
			peer.Status = "offline"
		}
	}
}

// StartHealthLoop runs periodic health checks on all peers.
func (h *Hub) StartHealthLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.HealthCheck(ctx)
		}
	}
}

// AggregateStatus fetches status from all online peers and combines with local status.
func (h *Hub) AggregateStatus() []PeerStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var result []PeerStatus
	for _, peer := range h.peers {
		ps := PeerStatus{
			Peer: *peer,
		}

		if peer.Status == "online" {
			client := &http.Client{Timeout: 5 * time.Second}
			url := fmt.Sprintf("http://%s/api/status", peer.Addr)
			resp, err := client.Get(url)
			if err == nil {
				defer resp.Body.Close()
				json.NewDecoder(resp.Body).Decode(&ps.RemoteStatus)
			}
		}

		result = append(result, ps)
	}
	return result
}

// PeerStatus is a peer with its fetched remote status.
type PeerStatus struct {
	Peer         Peer           `json:"peer"`
	RemoteStatus map[string]any `json:"remote_status,omitempty"`
}
