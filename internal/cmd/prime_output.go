package cmd

import (
	"fmt"

)

// outputPrimeContext outputs the role-specific context using templates or fallback.
// Returns the rendered template content (empty string when using fallback path).

// Night City stubs — TODO: reimplement prime output without beads

func outputPrimeContext(ctx RoleContext) (string, error) {
	outputContextFile(ctx)
	outputStartupDirective(ctx)
	return "", nil
}

func outputPrimeContextFallback(ctx RoleContext) {
	fmt.Println("Night City agent context (fallback)")
}

func outputMayorContext(ctx RoleContext) { fmt.Println("## Mayor Context") }
func outputWitnessContext(ctx RoleContext) { fmt.Println("## Witness Context") }
func outputRefineryContext(ctx RoleContext) { fmt.Println("## Refinery Context") }
func outputPolecatContext(ctx RoleContext) { fmt.Println("## Polecat Context") }
func outputCrewContext(ctx RoleContext) { fmt.Println("## Crew Context") }
func outputBootContext(ctx RoleContext) { fmt.Println("## Boot Context") }
func outputUnknownContext(ctx RoleContext) { fmt.Println("## Unknown Context") }
func outputCommandQuickReference(ctx RoleContext) {}
func outputContextFile(ctx RoleContext) {}
func outputHandoffContent(ctx RoleContext) {}
func outputStartupDirective(ctx RoleContext) {}
func outputAttachmentStatus(ctx RoleContext) {}
func outputContinuationDirective(hookedBead *WorkItem, hasMolecule bool) {}
func outputHandoffWarning(prevSession string) {}
func outputState(ctx RoleContext, jsonOutput bool) {}
func outputCheckpointContext(ctx RoleContext) {}
func outputDeaconPausedMessage(state interface{}) {}
func outputMoleculeContext(ctx RoleContext) {}
func outputPinnedBeads(ctx RoleContext) {}
func outputMayorIdentity(ctx RoleContext) {}
func showFormulaStepsFull() {}
func showMoleculeExecutionPrompt() {}

func explain(condition bool, reason string) {
	if condition {
		fmt.Printf("  ✓ %s\n", reason)
	} else {
		fmt.Printf("  · %s\n", reason)
	}
}
