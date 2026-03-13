package daemon

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/FrankAtGHub/night-city/internal/constants"
	"github.com/FrankAtGHub/night-city/internal/util"
)

// Config holds daemon configuration.
type Config struct {
	HeartbeatInterval time.Duration `json:"heartbeat_interval"`
	TownRoot          string        `json:"town_root"`
	LogFile           string        `json:"log_file"`
	PidFile           string        `json:"pid_file"`
}

// DefaultConfig returns the default daemon configuration.
func DefaultConfig(townRoot string) *Config {
	daemonDir := filepath.Join(townRoot, "daemon")
	return &Config{
		HeartbeatInterval: 5 * time.Minute,
		TownRoot:          townRoot,
		LogFile:           filepath.Join(daemonDir, "daemon.log"),
		PidFile:           filepath.Join(daemonDir, "daemon.pid"),
	}
}

// State represents the daemon's runtime state.
type State struct {
	Running        bool      `json:"running"`
	PID            int       `json:"pid"`
	StartedAt      time.Time `json:"started_at"`
	LastHeartbeat  time.Time `json:"last_heartbeat"`
	HeartbeatCount int64     `json:"heartbeat_count"`
}

// StateFile returns the path to the state file.
func StateFile(townRoot string) string {
	return filepath.Join(townRoot, "daemon", "state.json")
}

// LoadState loads daemon state from disk.
func LoadState(townRoot string) (*State, error) {
	data, err := os.ReadFile(StateFile(townRoot))
	if err != nil {
		if os.IsNotExist(err) {
			return &State{}, nil
		}
		return nil, err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

// SaveState saves daemon state to disk using atomic write.
func SaveState(townRoot string, state *State) error {
	stateFile := StateFile(townRoot)
	if err := os.MkdirAll(filepath.Dir(stateFile), 0755); err != nil {
		return err
	}
	return util.AtomicWriteJSON(stateFile, state)
}

// DaemonPatrolConfig is the structure of mayor/daemon.json.
type DaemonPatrolConfig struct {
	Type      string         `json:"type"`
	Version   int            `json:"version"`
	Heartbeat *PatrolConfig  `json:"heartbeat,omitempty"`
	Patrols   *PatrolsConfig `json:"patrols,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
}

// PatrolConfig holds configuration for a single patrol.
type PatrolConfig struct {
	Enabled  bool     `json:"enabled"`
	Interval string   `json:"interval,omitempty"`
	Agent    string   `json:"agent,omitempty"`
	Rigs     []string `json:"rigs,omitempty"`
}

// PatrolsConfig holds configuration for all patrols.
type PatrolsConfig struct {
	// Kept minimal — add new patrol types as needed.
}

// PatrolConfigFile returns the path to the patrol config file.
func PatrolConfigFile(townRoot string) string {
	return filepath.Join(townRoot, constants.RoleMayor, "daemon.json")
}

// LoadPatrolConfig loads patrol configuration from mayor/daemon.json.
func LoadPatrolConfig(townRoot string) *DaemonPatrolConfig {
	data, err := os.ReadFile(PatrolConfigFile(townRoot))
	if err != nil {
		return nil
	}
	var config DaemonPatrolConfig
	if err := json.Unmarshal(data, &config); err != nil {
		fmt.Fprintf(os.Stderr, "daemon: failed to parse %s: %v\n", PatrolConfigFile(townRoot), err)
		return nil
	}
	return &config
}

// IsPatrolEnabled checks if a patrol is enabled in the config.
func IsPatrolEnabled(config *DaemonPatrolConfig, patrol string) bool {
	if config == nil || config.Patrols == nil {
		return true
	}
	return true
}

// LifecycleAction represents a lifecycle request action.
type LifecycleAction string

const (
	ActionCycle    LifecycleAction = "cycle"
	ActionRestart  LifecycleAction = "restart"
	ActionShutdown LifecycleAction = "shutdown"
)

// LifecycleRequest represents a request from an agent to the daemon.
type LifecycleRequest struct {
	From      string          `json:"from"`
	Action    LifecycleAction `json:"action"`
	Timestamp time.Time       `json:"timestamp"`
}
