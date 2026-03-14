package catalog

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed builtin/*.yaml
var builtinTemplates embed.FS

// SeedCatalog copies built-in persona templates into the town's catalog directory.
// Only writes files that don't already exist (won't overwrite customizations).
func SeedCatalog(catalogDir string) (int, error) {
	if err := os.MkdirAll(catalogDir, 0755); err != nil {
		return 0, err
	}

	entries, err := fs.ReadDir(builtinTemplates, "builtin")
	if err != nil {
		return 0, fmt.Errorf("reading builtin templates: %w", err)
	}

	seeded := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}

		dest := filepath.Join(catalogDir, e.Name())

		// Don't overwrite existing customizations
		if _, err := os.Stat(dest); err == nil {
			continue
		}

		data, err := builtinTemplates.ReadFile("builtin/" + e.Name())
		if err != nil {
			return seeded, fmt.Errorf("reading template %s: %w", e.Name(), err)
		}

		if err := os.WriteFile(dest, data, 0644); err != nil {
			return seeded, fmt.Errorf("writing %s: %w", dest, err)
		}
		seeded++
	}

	return seeded, nil
}
