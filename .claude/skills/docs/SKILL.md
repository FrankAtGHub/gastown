---
name: docs
description: >
  Browse Gas Town documentation. Quick access to concepts, design docs,
  reference material, and glossary.
allowed-tools: "Read,Glob,Grep"
version: "1.0.0"
author: "Gas Town"
---

# Docs - Gas Town Documentation Browser

Quick access to Gas Town system documentation.

## Usage

```
/docs              # List available topics
/docs <topic>      # Read a specific doc
/docs search <term> # Search across all docs
```

## Available Documentation

When invoked, check what the user wants:

### No arguments → List topics

Show this index:

**Core Docs:**
- `overview` - Gas Town system overview
- `reference` - Complete command reference
- `glossary` - Terms and definitions
- `installing` - Installation guide

**Concepts:**
- `convoy` - Work batching and tracking
- `identity` - Agent identity system
- `molecules` - Workflow templates
- `polecat-lifecycle` - Worker agent lifecycle
- `propulsion` - The propulsion principle (autonomous execution)

**Design:**
- `architecture` - System architecture
- `escalation` - Escalation handling
- `federation` - Multi-town federation
- `mail-protocol` - Inter-agent messaging
- `plugin-system` - Plugin architecture
- `watchdog-chain` - Monitoring chain

**Examples:**
- `hanoi-demo` - Tower of Hanoi demo

### With topic → Read that doc

Map topic to file path:

| Topic | File |
|-------|------|
| overview | docs/overview.md |
| reference | docs/reference.md |
| glossary | docs/glossary.md |
| installing | docs/INSTALLING.md |
| convoy | docs/concepts/convoy.md |
| identity | docs/concepts/identity.md |
| molecules | docs/concepts/molecules.md |
| polecat-lifecycle | docs/concepts/polecat-lifecycle.md |
| propulsion | docs/concepts/propulsion-principle.md |
| architecture | docs/design/architecture.md |
| escalation | docs/design/escalation.md |
| escalation-system | docs/design/escalation-system.md |
| federation | docs/design/federation.md |
| mail-protocol | docs/design/mail-protocol.md |
| operational-state | docs/design/operational-state.md |
| plugin-system | docs/design/plugin-system.md |
| property-layers | docs/design/property-layers.md |
| watchdog-chain | docs/design/watchdog-chain.md |
| hanoi-demo | docs/examples/hanoi-demo.md |
| why-features | docs/why-these-features.md |

Use Read tool to display the doc content.

### With "search <term>" → Search docs

Use Grep to search across all docs:
```
Grep pattern="<term>" path="docs/" output_mode="content"
```

Show matching lines with file context.

## Implementation

When this skill is invoked:

1. Parse arguments to determine mode (list/read/search)
2. For list: Output the topic index above
3. For read: Use Read tool on the mapped file path
4. For search: Use Grep tool across docs/ directory

The docs directory is at the town root: `/home/kaos/gt/docs/`
