package polecat

import (
	"os"
	"testing"

	"github.com/FrankAtGHub/night-city/internal/testutil"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testutil.TerminateDoltContainer()
	os.Exit(code)
}
