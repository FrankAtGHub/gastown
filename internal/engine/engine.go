// Package engine is the Town Engine — the core runtime for Night City.
// It replaces Gas Town's Dolt/beads/witness/refinery/convoy stack with
// five composable layers: accountability, launcher, comms, catalog, dashboard.
package engine

// Config holds the town engine configuration, loaded from engine.yaml.
type Config struct {
	Name       string            `yaml:"name"`        // Town name (e.g., "DevTown")
	HostID     string            `yaml:"host_id"`     // Unique host identifier
	ProjectDir string            `yaml:"project_dir"` // Root project directory
	DataDir    string            `yaml:"data_dir"`    // Engine data directory (~/.town/)
	Personas   map[string]string `yaml:"personas"`    // persona name → yaml path
}
