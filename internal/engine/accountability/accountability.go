// Package accountability implements Layer 1 of the Town Engine:
// heartbeat monitoring, work logging, task tracking, scorecard, and dead man's switch.
//
// All state is file-based (JSON/JSONL in ~/.town/accountability/).
// Inngest handles the scheduling and durable execution of monitoring workflows.
package accountability

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Heartbeat represents a single agent heartbeat.
type Heartbeat struct {
	Agent     string    `json:"agent"`
	State     string    `json:"state"`      // working, idle, stuck, exiting
	Task      string    `json:"task"`       // what the agent is doing
	Progress  int       `json:"progress"`   // 0-100
	Blockers  []string  `json:"blockers"`   // any blockers
	Timestamp time.Time `json:"timestamp"`
}

// WorkLogEntry is an append-only record of agent activity.
type WorkLogEntry struct {
	Agent     string    `json:"agent"`
	Action    string    `json:"action"`    // commit, review, decision, error, deploy
	Detail    string    `json:"detail"`
	Timestamp time.Time `json:"timestamp"`
}

// Task represents a committed piece of work with a deadline.
type Task struct {
	ID        string    `json:"id"`
	Agent     string    `json:"agent"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`    // accepted, in_progress, completed, failed
	Deadline  time.Time `json:"deadline"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Scorecard tracks per-agent performance metrics.
type Scorecard struct {
	Agent          string  `json:"agent"`
	CompletionRate float64 `json:"completion_rate"` // tasks completed / tasks accepted
	RejectionRate  float64 `json:"rejection_rate"`  // PRs rejected / PRs submitted
	ReworkCount    int     `json:"rework_count"`    // how many times work was sent back
	LastUpdated    time.Time `json:"last_updated"`
}

// Store manages accountability data on the filesystem.
type Store struct {
	root string // ~/.town/accountability/
}

// NewStore creates a new accountability store at the given root directory.
func NewStore(root string) (*Store, error) {
	dirs := []string{
		filepath.Join(root, "heartbeats"),
		filepath.Join(root, "work-log"),
		filepath.Join(root, "tasks"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return nil, err
		}
	}
	return &Store{root: root}, nil
}

// WriteHeartbeat writes a heartbeat for the given agent.
func (s *Store) WriteHeartbeat(hb Heartbeat) error {
	hb.Timestamp = time.Now()
	data, err := json.Marshal(hb)
	if err != nil {
		return err
	}
	path := filepath.Join(s.root, "heartbeats", hb.Agent+".json")
	return os.WriteFile(path, data, 0644)
}

// ReadHeartbeat reads the latest heartbeat for an agent.
func (s *Store) ReadHeartbeat(agent string) (*Heartbeat, error) {
	path := filepath.Join(s.root, "heartbeats", agent+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var hb Heartbeat
	if err := json.Unmarshal(data, &hb); err != nil {
		return nil, err
	}
	return &hb, nil
}

// AppendWorkLog appends an entry to the agent's daily work log.
func (s *Store) AppendWorkLog(entry WorkLogEntry) error {
	entry.Timestamp = time.Now()
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	date := entry.Timestamp.Format("2006-01-02")
	path := filepath.Join(s.root, "work-log", entry.Agent+"-"+date+".jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(data, '\n'))
	return err
}
