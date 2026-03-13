// Package daemon provides the town-level background service for Night City.
//
// The daemon is a simple Go process (not a Claude agent) that:
// 1. Manages agent tmux sessions (start/stop/restart)
// 2. Processes lifecycle requests (cycle, restart, shutdown)
// 3. Runs a periodic heartbeat to detect dead sessions
package daemon

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gofrs/flock"
	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/FrankAtGHub/night-city/internal/config"
	"github.com/FrankAtGHub/night-city/internal/session"
	"github.com/FrankAtGHub/night-city/internal/tmux"
)

// Daemon is the town-level background service.
type Daemon struct {
	config *Config
	tmux   *tmux.Tmux
	logger *log.Logger
	ctx    context.Context
	cancel context.CancelFunc
}

// New creates a new daemon instance.
func New(cfg *Config) *Daemon {
	ctx, cancel := context.WithCancel(context.Background())
	return &Daemon{
		config: cfg,
		tmux:   tmux.NewTmux(),
		ctx:    ctx,
		cancel: cancel,
	}
}

// Run starts the daemon main loop.
func (d *Daemon) Run() error {
	// Set up logging
	d.logger = log.New(&lumberjack.Logger{
		Filename:   d.config.LogFile,
		MaxSize:    10, // MB
		MaxBackups: 3,
		MaxAge:     7,
	}, "", log.LstdFlags)

	d.logger.Printf("Night City daemon starting (town: %s)", d.config.TownRoot)

	// Write PID file
	if _, err := writePIDFile(d.config.PidFile, os.Getpid()); err != nil {
		return fmt.Errorf("failed to write pid file: %w", err)
	}
	defer os.Remove(d.config.PidFile)

	// Acquire daemon lock
	lockPath := filepath.Join(d.config.TownRoot, "daemon", "daemon.lock")
	os.MkdirAll(filepath.Dir(lockPath), 0755)
	lock := flock.New(lockPath)
	locked, err := lock.TryLock()
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	if !locked {
		return fmt.Errorf("another daemon is already running")
	}
	defer lock.Unlock()

	// Initialize session registry
	if err := session.InitRegistry(d.config.TownRoot); err != nil {
		d.logger.Printf("WARNING: failed to init registry: %v", err)
	}

	// Set up signal handling
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)

	// Main heartbeat loop
	ticker := time.NewTicker(d.config.HeartbeatInterval)
	defer ticker.Stop()

	d.logger.Printf("Daemon running (heartbeat every %v)", d.config.HeartbeatInterval)

	// Save initial state
	SaveState(d.config.TownRoot, &State{
		Running:   true,
		PID:       os.Getpid(),
		StartedAt: time.Now(),
	})

	heartbeatCount := int64(0)
	for {
		select {
		case <-ticker.C:
			heartbeatCount++
			d.heartbeat()
			SaveState(d.config.TownRoot, &State{
				Running:        true,
				PID:            os.Getpid(),
				StartedAt:      time.Now(),
				LastHeartbeat:  time.Now(),
				HeartbeatCount: heartbeatCount,
			})

		case sig := <-sigCh:
			d.logger.Printf("Received signal %v, shutting down", sig)
			d.cancel()
			SaveState(d.config.TownRoot, &State{Running: false})
			return nil

		case <-d.ctx.Done():
			d.logger.Printf("Context cancelled, shutting down")
			SaveState(d.config.TownRoot, &State{Running: false})
			return nil
		}
	}
}

// heartbeat runs one heartbeat cycle.
func (d *Daemon) heartbeat() {
	d.processLifecycleRequests()
	d.checkSessions()
}

// processLifecycleRequests processes pending lifecycle requests from agents.
func (d *Daemon) processLifecycleRequests() {
	requests := ReadLifecycleRequests(d.config.TownRoot)
	for _, req := range requests {
		d.logger.Printf("Processing lifecycle request: %s from %s", req.Action, req.From)
		switch req.Action {
		case ActionCycle, ActionRestart:
			d.logger.Printf("Restarting session for %s", req.From)
			// TODO: implement session restart
		case ActionShutdown:
			d.logger.Printf("Shutting down session for %s", req.From)
			// TODO: implement session shutdown
		}
	}
	ClearLifecycleRequests(d.config.TownRoot)
}

// checkSessions verifies that expected agent sessions are running.
func (d *Daemon) checkSessions() {
	rigsPath := filepath.Join(d.config.TownRoot, "mayor", "rigs.json")
	rigsConfig, err := config.LoadRigsConfig(rigsPath)
	if err != nil {
		d.logger.Printf("Heartbeat: failed to load rigs config: %v", err)
		return
	}
	if rigsConfig == nil {
		return
	}

	for name := range rigsConfig.Rigs {
		d.logger.Printf("Heartbeat: rig %s registered", name)
		// TODO: verify expected sessions are alive, restart if dead
	}
}

// ReadLifecycleRequests reads pending lifecycle requests.
func ReadLifecycleRequests(townRoot string) []LifecycleRequest {
	requestsDir := filepath.Join(townRoot, "daemon", "requests")
	entries, err := os.ReadDir(requestsDir)
	if err != nil {
		return nil
	}
	var requests []LifecycleRequest
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(requestsDir, entry.Name()))
		if err != nil {
			continue
		}
		var req LifecycleRequest
		if err := parseJSON(data, &req); err != nil {
			continue
		}
		requests = append(requests, req)
	}
	return requests
}

// ClearLifecycleRequests removes all processed lifecycle requests.
func ClearLifecycleRequests(townRoot string) {
	requestsDir := filepath.Join(townRoot, "daemon", "requests")
	os.RemoveAll(requestsDir)
	os.MkdirAll(requestsDir, 0755)
}

func parseJSON(data []byte, v interface{}) error {
	return fmt.Errorf("TODO: implement JSON parsing")
}

// IsRunning checks if the daemon is running.
func IsRunning(townRoot string) (bool, int, error) {
	state, err := LoadState(townRoot)
	if err != nil {
		return false, 0, err
	}
	return state.Running, state.PID, nil
}

// StopDaemon stops the daemon process.
func StopDaemon(townRoot string) error {
	running, pid, err := IsRunning(townRoot)
	if err != nil {
		return err
	}
	if !running {
		return nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(syscall.SIGTERM)
}

// ForceRotateLogs forces log rotation.
func ForceRotateLogs(townRoot string) (*RotateLogsResult, error) {
	return &RotateLogsResult{}, nil
}

// RotateLogsResult holds results from log rotation.
type RotateLogsResult struct {
	RotatedFiles int
}

// DefaultLifecycleConfig returns default lifecycle config.
func DefaultLifecycleConfig() *DaemonPatrolConfig {
	return &DaemonPatrolConfig{
		Type:    "daemon-patrol-config",
		Version: 1,
	}
}

// ClearAgentBackoff resets the backoff timer for an agent.
func ClearAgentBackoff(townRoot, agent string) error {
	return nil // stub
}
