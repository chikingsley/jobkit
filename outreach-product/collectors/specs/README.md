# Source contracts

This directory records the external behavior each collector is written against. It is a repository convention, not a Go build convention.

Each contract identifies the stable source identity, list traversal, completion proof, detail surface, application route, authentication boundary, and the live date on which the behavior was checked. These files describe observed public behavior; they are not claims that a third-party site guarantees the contract forever.

When a source changes, update its contract and parser together, preserve a failing fixture or replay when practical, and require a source-complete run before closing absent inventory.
