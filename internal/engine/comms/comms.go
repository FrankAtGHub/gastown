// Package comms implements Layer 3 of the Town Engine:
// MCP-based message bus for agent-to-agent communication.
//
// Replaces Dolt/beads mail and gt nudge with structured messaging
// over MCP transport (stdio for local, SSE for remote/dashboard).
//
// Transport provided by mark3labs/mcp-go.
package comms

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Message represents an inter-agent message on the bus.
type Message struct {
	ID        string    `json:"id"`
	From      string    `json:"from"`
	To        string    `json:"to"`
	Channel   string    `json:"channel"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
	Priority  string    `json:"priority"`
	Timestamp time.Time `json:"timestamp"`
}

// Channel represents a named communication channel.
type Channel struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Members     []string `json:"members"`
}

// Bus is the MCP-powered message bus.
type Bus struct {
	root      string         // ~/.town/comms/
	mcpServer *server.MCPServer
}

// NewBus creates a message bus backed by files and exposed via MCP tools.
func NewBus(root string) (*Bus, error) {
	dirs := []string{
		filepath.Join(root, "channels"),
		filepath.Join(root, "inbox"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return nil, err
		}
	}

	b := &Bus{root: root}

	// Create MCP server with messaging tools
	s := server.NewMCPServer(
		"night-city-comms",
		"1.0.0",
		server.WithToolCapabilities(true),
	)

	// Register send tool
	s.AddTool(
		mcp.NewTool("send_message",
			mcp.WithDescription("Send a message to an agent or channel"),
			mcp.WithString("to", mcp.Required(), mcp.Description("Recipient agent name or channel")),
			mcp.WithString("subject", mcp.Required(), mcp.Description("Message subject")),
			mcp.WithString("body", mcp.Required(), mcp.Description("Message body")),
			mcp.WithString("priority", mcp.Description("Priority: low, medium, high, critical")),
		),
		b.handleSend,
	)

	// Register receive tool
	s.AddTool(
		mcp.NewTool("check_inbox",
			mcp.WithDescription("Check inbox for new messages"),
			mcp.WithString("agent", mcp.Required(), mcp.Description("Agent name to check inbox for")),
		),
		b.handleCheckInbox,
	)

	b.mcpServer = s
	return b, nil
}

// MCPServer returns the underlying MCP server for transport wiring.
func (b *Bus) MCPServer() *server.MCPServer {
	return b.mcpServer
}

// Send writes a message to the recipient's inbox.
func (b *Bus) Send(msg Message) error {
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}
	if msg.ID == "" {
		msg.ID = fmt.Sprintf("%d-%s", msg.Timestamp.UnixNano(), msg.From)
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	inboxDir := filepath.Join(b.root, "inbox", msg.To)
	if err := os.MkdirAll(inboxDir, 0755); err != nil {
		return err
	}

	path := filepath.Join(inboxDir, msg.ID+".json")
	return os.WriteFile(path, data, 0644)
}

// CheckInbox returns all messages for an agent.
func (b *Bus) CheckInbox(agent string) ([]Message, error) {
	inboxDir := filepath.Join(b.root, "inbox", agent)
	entries, err := os.ReadDir(inboxDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var messages []Message
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(inboxDir, e.Name()))
		if err != nil {
			continue
		}
		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		messages = append(messages, msg)
	}
	return messages, nil
}

// MCP tool handlers

func (b *Bus) handleSend(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	to := mcp.ParseString(req, "to", "")
	subject := mcp.ParseString(req, "subject", "")
	body := mcp.ParseString(req, "body", "")
	priority := mcp.ParseString(req, "priority", "medium")

	if to == "" || subject == "" {
		return mcp.NewToolResultError("to and subject are required"), nil
	}

	msg := Message{
		To:       to,
		From:     "mcp-client",
		Subject:  subject,
		Body:     body,
		Priority: priority,
	}
	if err := b.Send(msg); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("send failed: %v", err)), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Message sent to %s: %s", to, subject)), nil
}

func (b *Bus) handleCheckInbox(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agent := mcp.ParseString(req, "agent", "")
	if agent == "" {
		return mcp.NewToolResultError("agent is required"), nil
	}

	messages, err := b.CheckInbox(agent)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("inbox check failed: %v", err)), nil
	}

	if len(messages) == 0 {
		return mcp.NewToolResultText("No new messages"), nil
	}

	data, _ := json.MarshalIndent(messages, "", "  ")
	return mcp.NewToolResultText(string(data)), nil
}
