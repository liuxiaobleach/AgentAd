// Standalone module — intentionally NOT part of the main backend module.
// This keeps zk-settlement compilable without the rest of the repo, and keeps
// the live backend from accidentally importing anything that isn't production-ready.
module github.com/celer-network/zkdsp-audit/zk-settlement/host

go 1.22

require github.com/celer-network/zkdsp-audit/zk-settlement/types v0.0.0

replace github.com/celer-network/zkdsp-audit/zk-settlement/types => ../types
