package git_test

import (
	"github.com/FrankAtGHub/night-city/internal/git"
)

// Compile-time assertion: Git must satisfy BranchChecker.
var _ beads.BranchChecker = (*git.Git)(nil)
