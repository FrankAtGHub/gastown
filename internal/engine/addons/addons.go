// Package addons provides the add-on registry for Night City.
//
// Add-ons are optional integrations that extend the town engine
// with external communication channels and services.
//
// Currently supported:
//   - Telegram: bot bridge for mobile agent control
//   - Email: SMTP notifications and reports
//
// Planned:
//   - Slack: workspace integration
//   - Discord: server integration
//   - Webhook: generic HTTP callback
package addons

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/FrankAtGHub/night-city/internal/engine/addons/email"
	"github.com/FrankAtGHub/night-city/internal/engine/addons/telegram"
	"gopkg.in/yaml.v3"
)

// Registry holds all configured add-ons for a town.
type Registry struct {
	Telegram *telegram.Config `yaml:"telegram,omitempty"`
	Email    *email.Config    `yaml:"email,omitempty"`
}

// LoadRegistry reads add-on configuration from the town's addons directory.
func LoadRegistry(townDir string) (*Registry, error) {
	addonsDir := filepath.Join(townDir, "addons")
	reg := &Registry{}

	// Load telegram.yaml if present
	if data, err := os.ReadFile(filepath.Join(addonsDir, "telegram.yaml")); err == nil {
		var cfg telegram.Config
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("parsing telegram.yaml: %w", err)
		}
		reg.Telegram = &cfg
	}

	// Load email.yaml if present
	if data, err := os.ReadFile(filepath.Join(addonsDir, "email.yaml")); err == nil {
		var cfg email.Config
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("parsing email.yaml: %w", err)
		}
		reg.Email = &cfg
	}

	return reg, nil
}

// SaveAddonConfig writes an add-on config file.
func SaveAddonConfig(townDir, name string, cfg any) error {
	addonsDir := filepath.Join(townDir, "addons")
	if err := os.MkdirAll(addonsDir, 0755); err != nil {
		return err
	}

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(addonsDir, name+".yaml"), data, 0644)
}
