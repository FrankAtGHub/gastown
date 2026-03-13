// Package comms implements Layer 3 of the Town Engine:
// MCP-based message bus for agent-to-agent communication.
//
// Replaces Dolt/beads mail and gt nudge with structured messaging
// over MCP transport (stdio for local, SSE for remote/dashboard).
//
// Transport provided by mark3labs/mcp-go.
package comms

import "time"

// Message represents an inter-agent message on the bus.
type Message struct {
	ID        string    `json:"id"`
	From      string    `json:"from"`      // sender agent name
	To        string    `json:"to"`        // recipient agent name or channel
	Channel   string    `json:"channel"`   // channel name (empty for direct)
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
	Priority  string    `json:"priority"`  // low, medium, high, critical
	Timestamp time.Time `json:"timestamp"`
}

// Channel represents a named communication channel.
type Channel struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Members     []string `json:"members"` // agent names subscribed to this channel
}

// Bus is the message bus interface. Implementations will use MCP transport.
type Bus interface {
	// Send sends a message to an agent or channel.
	Send(msg Message) error

	// Receive returns the next message for the given agent.
	Receive(agent string) (*Message, error)

	// Subscribe subscribes an agent to a channel.
	Subscribe(agent, channel string) error

	// CreateChannel creates a new communication channel.
	CreateChannel(ch Channel) error
}

// FileBus implements Bus using local files (channels/ directory).
// This is the initial implementation before MCP transport is wired up.
type FileBus struct {
	root string // ~/.town/comms/channels/
}

// NewFileBus creates a file-based message bus.
func NewFileBus(root string) *FileBus {
	return &FileBus{root: root}
}
