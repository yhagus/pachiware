# Design It Twice

When the person wants to explore alternative interfaces for a chosen deepening candidate, design it several ways before you pick one. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best.

Uses the vocabulary of the `codebase-design` playbook: **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before you design anything, explain the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see `codebase-design/DEEPENING.md`)
- A rough code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Look up the code you need with `repoReadFile` and `repoSearchCode` first; the facts are your job, not the person's.

### 2. Design three or four times

Write three or four **radically different** interfaces for the deepened module, one after another, each under a different design constraint:

- Design 1: "Minimise the interface: aim for 1–3 entry points at most. Maximise leverage per entry point."
- Design 2: "Maximise flexibility: support many use cases and extension."
- Design 3: "Optimise for the most common caller: make the default case trivial."
- Design 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Hold each design to its own constraint; do not let a later design borrow from an earlier one. Name things with this vocabulary and with the project's own glossary when it has one.

For each design, give:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. A usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see `codebase-design/DEEPENING.md`)
5. Trade-offs: where leverage is high, where it is thin

### 3. Present and compare

Discord shows at most 2,000 characters per message, so post one design per reply, shortest sketch that shows the interface, and wait for the person to say "next" before the following one. Then compare them in prose by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the person wants a strong read, not a menu.
