// Package rig provides rig management functionality.
// This file implements the property layer lookup API for unified config access.
package rig

import (
	"strconv"
)

// ConfigSource identifies which layer a config value came from.
type ConfigSource string

const (
	SourceSystem  ConfigSource = "system"  // Compiled-in system defaults
	SourceNone    ConfigSource = "none"    // No value found
)

// ConfigResult holds a config lookup result with its source.
type ConfigResult struct {
	Value  interface{}
	Source ConfigSource
}

// SystemDefaults contains compiled-in default values.
var SystemDefaults = map[string]interface{}{
	"status":                  "operational",
	"auto_restart":            true,
	"auto_start_on_up":        false,
	"max_polecats":            10,
	"priority_adjustment":     0,
	"dnd":                     false,
	"polecat_branch_template": "",
}

// StackingKeys defines which keys use stacking semantics (values add up).
var StackingKeys = map[string]bool{
	"priority_adjustment": true,
}

// GetConfig looks up a config value. Simplified: system defaults only.
func (r *Rig) GetConfig(key string) interface{} {
	if val, ok := SystemDefaults[key]; ok {
		return val
	}
	return nil
}

// GetConfigWithSource looks up a config value and returns which layer it came from.
func (r *Rig) GetConfigWithSource(key string) ConfigResult {
	if val, ok := SystemDefaults[key]; ok {
		return ConfigResult{Value: val, Source: SourceSystem}
	}
	return ConfigResult{Value: nil, Source: SourceNone}
}

// GetBoolConfig looks up a boolean config value.
func (r *Rig) GetBoolConfig(key string) bool {
	result := r.GetConfig(key)
	if result == nil {
		return false
	}
	switch v := result.(type) {
	case bool:
		return v
	case string:
		return v == "true" || v == "1" || v == "yes"
	default:
		return false
	}
}

// GetIntConfig looks up an integer config value.
func (r *Rig) GetIntConfig(key string) int {
	result := r.GetConfig(key)
	return toInt(result)
}

func toInt(v interface{}) int {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int:
		return val
	case float64:
		return int(val)
	case string:
		n, _ := strconv.Atoi(val)
		return n
	default:
		return 0
	}
}
