// Package web provides the Night City dashboard web server.
// TODO: Rewire to file-based data sources (Night City town engine).
package web

// Fetcher retrieves dashboard data from file-based sources.
type Fetcher struct {
	townRoot string
}

// NewFetcher creates a new data fetcher.
func NewFetcher(townRoot string) *Fetcher {
	return &Fetcher{townRoot: townRoot}
}
