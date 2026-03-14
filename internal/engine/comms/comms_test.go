package comms

import (
	"testing"
)

func TestSendAndCheckInbox(t *testing.T) {
	root := t.TempDir()
	bus, err := NewBus(root)
	if err != nil {
		t.Fatalf("NewBus: %v", err)
	}

	// Send messages
	msgs := []Message{
		{From: "mayor", To: "architect", Subject: "Review needed", Body: "Check PR #42", Priority: "high"},
		{From: "mayor", To: "architect", Subject: "Also this", Body: "And PR #43", Priority: "medium"},
		{From: "architect", To: "mayor", Subject: "Done", Body: "Both reviewed", Priority: "low"},
	}

	for _, m := range msgs {
		if err := bus.Send(m); err != nil {
			t.Fatalf("Send: %v", err)
		}
	}

	// Check architect's inbox
	architectMsgs, err := bus.CheckInbox("architect")
	if err != nil {
		t.Fatalf("CheckInbox(architect): %v", err)
	}
	if len(architectMsgs) != 2 {
		t.Errorf("architect inbox has %d messages, want 2", len(architectMsgs))
	}

	// Check mayor's inbox
	mayorMsgs, err := bus.CheckInbox("mayor")
	if err != nil {
		t.Fatalf("CheckInbox(mayor): %v", err)
	}
	if len(mayorMsgs) != 1 {
		t.Errorf("mayor inbox has %d messages, want 1", len(mayorMsgs))
	}

	// Check empty inbox
	emptyMsgs, err := bus.CheckInbox("nobody")
	if err != nil {
		t.Fatalf("CheckInbox(nobody): %v", err)
	}
	if len(emptyMsgs) != 0 {
		t.Errorf("nobody inbox has %d messages, want 0", len(emptyMsgs))
	}

	// Verify MCP server exists
	if bus.MCPServer() == nil {
		t.Error("MCPServer() should not be nil")
	}
}

func TestMessageTimestampAndID(t *testing.T) {
	root := t.TempDir()
	bus, _ := NewBus(root)

	msg := Message{From: "a", To: "b", Subject: "test"}
	bus.Send(msg)

	inbox, _ := bus.CheckInbox("b")
	if len(inbox) != 1 {
		t.Fatal("expected 1 message")
	}

	if inbox[0].Timestamp.IsZero() {
		t.Error("Timestamp should be set automatically")
	}
	if inbox[0].ID == "" {
		t.Error("ID should be set automatically")
	}
}
