// Package web provides the Night City dashboard web server.
// HTMX + SSE dashboard reading from the file-based accountability store.
package web

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"path/filepath"
	"time"

	"github.com/FrankAtGHub/night-city/internal/engine"
	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
	"github.com/FrankAtGHub/night-city/internal/engine/launcher"
	"gopkg.in/yaml.v3"
	"os"
)

// Server is the dashboard web server.
type Server struct {
	townDir string
	cfg     *engine.Config
	store   *accountability.Store
	addr    string
}

// NewServer creates a dashboard server for the given town directory.
func NewServer(townDir string, addr string) (*Server, error) {
	cfgData, err := os.ReadFile(filepath.Join(townDir, "engine.yaml"))
	if err != nil {
		return nil, fmt.Errorf("reading engine.yaml: %w", err)
	}
	var cfg engine.Config
	if err := yaml.Unmarshal(cfgData, &cfg); err != nil {
		return nil, err
	}
	cfg.DataDir = townDir

	store, err := accountability.NewStore(filepath.Join(townDir, "accountability"))
	if err != nil {
		return nil, err
	}

	return &Server{
		townDir: townDir,
		cfg:     &cfg,
		store:   store,
		addr:    addr,
	}, nil
}

// Start runs the dashboard server.
func (s *Server) Start(ctx context.Context) error {
	mux := http.NewServeMux()

	mux.HandleFunc("/", s.handleDashboard)
	mux.HandleFunc("/api/status", s.handleAPIStatus)
	mux.HandleFunc("/sse/status", s.handleSSEStatus)

	srv := &http.Server{
		Addr:    s.addr,
		Handler: mux,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	fmt.Printf("Dashboard: http://%s\n", s.addr)
	return srv.ListenAndServe()
}

// handleDashboard serves the main dashboard page.
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	tmpl := template.Must(template.New("dashboard").Parse(dashboardHTML))
	data := struct {
		Town string
		Host string
	}{
		Town: s.cfg.Name,
		Host: s.cfg.HostID,
	}
	w.Header().Set("Content-Type", "text/html")
	tmpl.Execute(w, data)
}

// handleAPIStatus returns JSON status of all agents.
func (s *Server) handleAPIStatus(w http.ResponseWriter, r *http.Request) {
	status := s.collectStatus()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// handleSSEStatus streams status updates via Server-Sent Events.
func (s *Server) handleSSEStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			status := s.collectStatus()
			data, _ := json.Marshal(status)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

type agentStatus struct {
	Name      string  `json:"name"`
	Role      string  `json:"role"`
	State     string  `json:"state"`
	Task      string  `json:"task"`
	Progress  int     `json:"progress"`
	LastSeen  string  `json:"last_seen"`
	Stale     bool    `json:"stale"`
	AutoStart bool    `json:"auto_start"`
}

type townStatus struct {
	Town    string        `json:"town"`
	Host    string        `json:"host"`
	Agents  []agentStatus `json:"agents"`
	Updated string        `json:"updated"`
}

func (s *Server) collectStatus() townStatus {
	personasDir := filepath.Join(s.townDir, "personas")
	personas, _ := launcher.LoadAllPersonas(personasDir)

	var agents []agentStatus
	for _, p := range personas {
		as := agentStatus{
			Name:      p.Name,
			Role:      p.Role,
			State:     "unknown",
			AutoStart: p.AutoStart,
		}

		hb, err := s.store.ReadHeartbeat(p.Name)
		if err == nil {
			as.State = hb.State
			as.Task = hb.Task
			as.Progress = hb.Progress
			as.LastSeen = time.Since(hb.Timestamp).Round(time.Second).String()
			as.Stale = time.Since(hb.Timestamp) > 5*time.Minute
		}

		agents = append(agents, as)
	}

	return townStatus{
		Town:    s.cfg.Name,
		Host:    s.cfg.HostID,
		Agents:  agents,
		Updated: time.Now().Format(time.RFC3339),
	}
}

// dashboardHTML is the embedded HTMX dashboard template.
const dashboardHTML = `<!DOCTYPE html>
<html>
<head>
  <title>{{.Town}} — Night City Dashboard</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.4em; }
    .subtitle { color: #8b949e; margin-bottom: 24px; font-size: 0.9em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .agent-name { font-weight: bold; color: #f0f6fc; font-size: 1.1em; }
    .state { padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; }
    .state-working { background: #238636; color: #fff; }
    .state-idle { background: #1f6feb; color: #fff; }
    .state-stuck { background: #da3633; color: #fff; }
    .state-unknown { background: #30363d; color: #8b949e; }
    .state-stale { background: #9e6a03; color: #fff; }
    .detail { color: #8b949e; font-size: 0.85em; margin-top: 4px; }
    .progress-bar { height: 4px; background: #30363d; border-radius: 2px; margin-top: 8px; }
    .progress-fill { height: 100%; background: #58a6ff; border-radius: 2px; transition: width 0.3s; }
    .updated { color: #484f58; font-size: 0.75em; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <h1>{{.Town}}</h1>
  <div class="subtitle">{{.Host}} — Night City Dashboard</div>
  <div id="agents" class="grid"
       hx-ext="sse"
       sse-connect="/sse/status"
       sse-swap="message"
       hx-swap="innerHTML">
    <div class="card"><div class="detail">Connecting...</div></div>
  </div>
  <div class="updated" id="updated"></div>
  <script>
    document.body.addEventListener('htmx:sseMessage', function(e) {
      const data = JSON.parse(e.detail.data);
      let html = '';
      for (const agent of data.agents) {
        let stateClass = 'state-' + agent.state;
        if (agent.stale) stateClass = 'state-stale';
        html += '<div class="card">';
        html += '<div class="card-header">';
        html += '<span class="agent-name">' + agent.name + '</span>';
        html += '<span class="state ' + stateClass + '">' + (agent.stale ? 'STALE' : agent.state) + '</span>';
        html += '</div>';
        if (agent.role) html += '<div class="detail">' + agent.role + '</div>';
        if (agent.task) html += '<div class="detail">Task: ' + agent.task + '</div>';
        if (agent.last_seen) html += '<div class="detail">Last seen: ' + agent.last_seen + ' ago</div>';
        if (agent.progress > 0) {
          html += '<div class="progress-bar"><div class="progress-fill" style="width:' + agent.progress + '%"></div></div>';
        }
        html += '</div>';
      }
      document.getElementById('agents').innerHTML = html;
      document.getElementById('updated').textContent = 'Updated: ' + new Date(data.updated).toLocaleTimeString();
      e.preventDefault();
    });
  </script>
</body>
</html>`
