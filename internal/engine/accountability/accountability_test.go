package accountability

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewStore(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if store == nil {
		t.Fatal("store is nil")
	}

	// Verify directories were created
	for _, dir := range []string{"heartbeats", "work-log", "tasks"} {
		path := filepath.Join(root, dir)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("directory %s was not created", dir)
		}
	}
}

func TestWriteReadHeartbeat(t *testing.T) {
	store, _ := NewStore(t.TempDir())

	hb := Heartbeat{
		Agent:    "mayor",
		State:    "working",
		Task:     "building night city",
		Progress: 42,
	}

	if err := store.WriteHeartbeat(hb); err != nil {
		t.Fatalf("WriteHeartbeat: %v", err)
	}

	got, err := store.ReadHeartbeat("mayor")
	if err != nil {
		t.Fatalf("ReadHeartbeat: %v", err)
	}

	if got.Agent != "mayor" {
		t.Errorf("Agent = %q, want %q", got.Agent, "mayor")
	}
	if got.State != "working" {
		t.Errorf("State = %q, want %q", got.State, "working")
	}
	if got.Task != "building night city" {
		t.Errorf("Task = %q, want %q", got.Task, "building night city")
	}
	if got.Progress != 42 {
		t.Errorf("Progress = %d, want %d", got.Progress, 42)
	}
	if got.Timestamp.IsZero() {
		t.Error("Timestamp should not be zero")
	}
}

func TestReadHeartbeatNotFound(t *testing.T) {
	store, _ := NewStore(t.TempDir())

	_, err := store.ReadHeartbeat("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent agent")
	}
}

func TestHeartbeatOverwrite(t *testing.T) {
	store, _ := NewStore(t.TempDir())

	store.WriteHeartbeat(Heartbeat{Agent: "worker", State: "working", Task: "task 1"})
	store.WriteHeartbeat(Heartbeat{Agent: "worker", State: "idle", Task: ""})

	got, _ := store.ReadHeartbeat("worker")
	if got.State != "idle" {
		t.Errorf("State = %q, want %q after overwrite", got.State, "idle")
	}
}

func TestAppendWorkLog(t *testing.T) {
	store, _ := NewStore(t.TempDir())

	entries := []WorkLogEntry{
		{Agent: "mayor", Action: "commit", Detail: "phase 1"},
		{Agent: "mayor", Action: "review", Detail: "phase 2"},
		{Agent: "architect", Action: "deploy", Detail: "staging"},
	}

	for _, e := range entries {
		if err := store.AppendWorkLog(e); err != nil {
			t.Fatalf("AppendWorkLog: %v", err)
		}
	}

	// Verify files exist
	date := time.Now().Format("2006-01-02")
	mayorLog := filepath.Join(store.root, "work-log", "mayor-"+date+".jsonl")
	architectLog := filepath.Join(store.root, "work-log", "architect-"+date+".jsonl")

	if _, err := os.Stat(mayorLog); os.IsNotExist(err) {
		t.Error("mayor work log not created")
	}
	if _, err := os.Stat(architectLog); os.IsNotExist(err) {
		t.Error("architect work log not created")
	}

	// Check mayor log has 2 lines
	data, _ := os.ReadFile(mayorLog)
	lines := 0
	for _, b := range data {
		if b == '\n' {
			lines++
		}
	}
	if lines != 2 {
		t.Errorf("mayor log has %d lines, want 2", lines)
	}
}
