package catalog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogLoadAndFind(t *testing.T) {
	dir := t.TempDir()

	templates := map[string]string{
		"dev-lead": `name: dev-lead
description: Senior developer
category: dev
tags: [architecture]
persona:
  name: dev-lead
  role: Senior dev
  auto_start: true
`,
		"reviewer": `name: reviewer
description: Code reviewer
category: dev
tags: [review]
persona:
  name: reviewer
  role: Reviewer
`,
		"marketing-lead": `name: marketing-lead
description: Marketing strategist
category: marketing
tags: [strategy]
persona:
  name: marketing-lead
  role: Marketing lead
`,
	}

	for name, content := range templates {
		os.WriteFile(filepath.Join(dir, name+".yaml"), []byte(content), 0644)
	}

	cat := New(dir)
	if err := cat.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	// List all
	all := cat.List()
	if len(all) != 3 {
		t.Errorf("List() = %d templates, want 3", len(all))
	}

	// Find existing
	tmpl, err := cat.Find("dev-lead")
	if err != nil {
		t.Fatalf("Find(dev-lead): %v", err)
	}
	if tmpl.Description != "Senior developer" {
		t.Errorf("Description = %q, want %q", tmpl.Description, "Senior developer")
	}
	if tmpl.Category != "dev" {
		t.Errorf("Category = %q, want %q", tmpl.Category, "dev")
	}

	// Find nonexistent
	_, err = cat.Find("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent template")
	}

	// ByCategory
	devTemplates := cat.ByCategory("dev")
	if len(devTemplates) != 2 {
		t.Errorf("ByCategory(dev) = %d, want 2", len(devTemplates))
	}

	marketingTemplates := cat.ByCategory("marketing")
	if len(marketingTemplates) != 1 {
		t.Errorf("ByCategory(marketing) = %d, want 1", len(marketingTemplates))
	}
}

func TestSeedCatalog(t *testing.T) {
	dir := t.TempDir()
	catalogDir := filepath.Join(dir, "catalog")

	seeded, err := SeedCatalog(catalogDir)
	if err != nil {
		t.Fatalf("SeedCatalog: %v", err)
	}

	if seeded != 10 {
		t.Errorf("seeded %d templates, want 10", seeded)
	}

	// Verify files exist
	entries, _ := os.ReadDir(catalogDir)
	if len(entries) != 10 {
		t.Errorf("catalog has %d files, want 10", len(entries))
	}

	// Second seed should not overwrite (returns 0)
	seeded2, err := SeedCatalog(catalogDir)
	if err != nil {
		t.Fatalf("second SeedCatalog: %v", err)
	}
	if seeded2 != 0 {
		t.Errorf("second seed wrote %d files, want 0 (no overwrites)", seeded2)
	}
}

func TestEmptyCatalog(t *testing.T) {
	dir := t.TempDir()
	cat := New(dir)
	if err := cat.Load(); err != nil {
		t.Fatalf("Load empty: %v", err)
	}

	if len(cat.List()) != 0 {
		t.Error("empty catalog should have 0 templates")
	}
}
