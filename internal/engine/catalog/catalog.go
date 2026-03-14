// Package catalog implements Layer 4 of the Town Engine:
// persona template management, discovery, and installation.
//
// The catalog ships built-in persona templates (dev-lead, worker, reviewer, etc.)
// and supports custom templates. Templates include CLAUDE.md, memory seeds,
// tool configurations, and MCP server definitions.
package catalog

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/FrankAtGHub/night-city/internal/engine"
	"gopkg.in/yaml.v3"
)

// Template is a persona template in the catalog.
type Template struct {
	Name        string   `yaml:"name"`
	Description string   `yaml:"description"`
	Category    string   `yaml:"category"`    // dev, marketing, ops, support
	Tags        []string `yaml:"tags"`
	Persona     engine.Persona `yaml:"persona"`
}

// Catalog manages available persona templates.
type Catalog struct {
	root      string      // catalog directory
	templates []Template  // loaded templates
}

// New creates a catalog from the given directory.
func New(root string) *Catalog {
	return &Catalog{root: root}
}

// Load reads all templates from the catalog directory.
func (c *Catalog) Load() error {
	entries, err := os.ReadDir(c.root)
	if err != nil {
		return fmt.Errorf("reading catalog %s: %w", c.root, err)
	}
	c.templates = nil
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".yaml" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(c.root, e.Name()))
		if err != nil {
			return err
		}
		var t Template
		if err := yaml.Unmarshal(data, &t); err != nil {
			return fmt.Errorf("parsing template %s: %w", e.Name(), err)
		}
		c.templates = append(c.templates, t)
	}
	return nil
}

// List returns all available templates.
func (c *Catalog) List() []Template {
	return c.templates
}

// Find returns a template by name.
func (c *Catalog) Find(name string) (*Template, error) {
	for i := range c.templates {
		if c.templates[i].Name == name {
			return &c.templates[i], nil
		}
	}
	return nil, fmt.Errorf("template %q not found in catalog", name)
}

// ByCategory returns templates filtered by category.
func (c *Catalog) ByCategory(category string) []Template {
	var result []Template
	for _, t := range c.templates {
		if t.Category == category {
			result = append(result, t)
		}
	}
	return result
}
