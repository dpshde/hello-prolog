# Large Prolog Backend Discussion

_Status: draft for discussion, not a committed roadmap_

## Why this doc exists

HelloProlog currently works well as a browser-first Prolog playground:

- Arrow.js UI
- Tau Prolog running in-browser
- interactive graph view
- query intellisense
- `.pl` import

That architecture is a good fit for demos and modest fact worlds.

It is **not** the right fit for very large Prolog datasets, especially in the range of **~250MB source files**.

This doc captures the current constraint, the likely direction, and the open questions before we make the next architectural move.

---

## Current architecture

### Frontend

- editor / query UI
- intellisense / contextual suggestions
- graph visualization
- file import for `.pl`
- Tau Prolog runtime in the browser

### Runtime model

- program text is loaded into browser memory
- Tau Prolog consults the full source text in JavaScript
- graph data is derived client-side from parsed facts

This keeps the app simple and portable, but it means all parsing, storage, and execution happen inside the browser tab.

---

## Current limitation

### Large `.pl` files

For a dataset around **250MB**, the current browser/Tau setup becomes a poor fit because:

- the source must exist as a giant browser string
- consult/parsing cost is pushed onto the main client runtime
- memory pressure grows well beyond the raw file size
- local persistence is not realistic
- graph derivation becomes expensive
- browser responsiveness becomes fragile

### `.qlf` files

We also discussed `.qlf` support.

At the moment, **HelloProlog cannot load `.qlf` files** because:

- `.qlf` is a SWI-Prolog quick-load binary format
- this app currently runs Tau Prolog, not SWI-Prolog
- Tau can consult source text, not SWI compiled artifacts

So `.qlf` support is not a small import feature. It implies a different execution architecture.

---

## Why `selah-tools/labs/prolog` matters

The repo at:

`/Users/dps/Developer/selah-tools/labs/prolog`

already points toward the more realistic long-term direction.

That lab has:

- a real study Bible worldspace
- SWI-oriented workflows
- generated facts
- `.qlf`-adjacent scale assumptions
- richer Biblical domains than our current browser-only mock world

In other words, it is a better candidate for the **source of truth** than Tau Prolog in the browser if HelloProlog is meant to grow into a serious Bible-study graph / REPL tool.

---

## Proposed direction

## Option A — Stay browser-only

Keep Tau Prolog as the only runtime.

### Pros

- simplest deployment model
- fully static app
- no backend needed
- fast iteration for small examples

### Cons

- poor fit for large datasets
- no `.qlf` support
- limited runtime headroom
- less faithful to a real SWI-based workflow

### Best use case

- small demos
- educational sandbox
- local toy worlds

---

## Option B — Add a SWI-backed mode

Keep the current UI, but move Prolog execution to a backend process.

### Frontend stays responsible for

- editing
- query UX
- intellisense presentation
- graph interactions
- local exploration affordances

### Backend becomes responsible for

- loading `.pl` / `.qlf`
- keeping SWI warm across requests
- query execution
- pagination / streaming of large result sets
- graph neighborhood queries
- richer predicate / argument suggestion indexes

### Pros

- realistic support for very large datasets
- true `.qlf` compatibility
- much better long-running query behavior
- easier integration with the existing `selah-tools/labs/prolog` world

### Cons

- backend complexity
- deployment complexity increases
- no longer a pure static app

### Best use case

- serious Bible-study worldspace
- large fact sets
- real research workflows
- production-grade exploration

---

## Recommended direction

If HelloProlog is intended to grow past a demo, the most sensible path is:

**keep the UI, add a SWI-backed mode, and treat the browser runtime as the lightweight mode rather than the only mode.**

That gives us a clean split:

- **small/local mode** → Tau in browser
- **large/real mode** → SWI backend

This also preserves the current work instead of throwing it away.

---

## Suggested rollout

### Phase 1 — UI remains stable

Do not redesign the whole product again.

Keep:

- editor
- query bar
- results pane
- graph interactions
- intellisense shell

Only swap the execution backend behind a clear boundary.

### Phase 2 — Backend API

Introduce a small service boundary, for example:

- `POST /query`
- `POST /suggest`
- `GET /graph/neighborhood`
- `GET /entity/:id`
- `GET /predicate/:name`

### Phase 3 — SWI process model

Load the large world once at startup and keep it warm.

Avoid re-consulting per request.

### Phase 4 — Graph scaling

Stop building the full graph client-side for large worlds.

Instead return:

- local neighborhoods
- entity-centric slices
- predicate-centric slices
- paginated relationship sets

### Phase 5 — `.qlf`

Support `.qlf` only in backend mode.

---

## Open questions

1. Is HelloProlog meant to remain a teaching tool, or become a serious front-end for the Bible worldspace?
2. Should the browser-only mode stay first-class, or become a fallback/demo mode?
3. Should we integrate directly with `selah-tools/labs/prolog`, or create a thinner dedicated HelloProlog backend?
4. Do we want one unified app with two runtimes, or separate “demo” and “worldspace” deployments?
5. How much of the graph should be server-derived vs client-derived once datasets get large?

---

## Decision framing

### If we want

- fast demos
- zero backend
- educational examples

then stay with Tau/browser-first and keep data small.

### If we want

- real Bible-study data
- large files
- `.qlf`
- stronger query performance
- closer alignment with `selah-tools/labs/prolog`

then we should add a SWI-backed execution path.

---

## Near-term recommendation

Short term, keep improving the UI with the current Biblical demos.

Next substantial technical step:

**prototype a SWI-backed query endpoint using the `selah-tools/labs/prolog` worldspace.**

That will tell us very quickly whether HelloProlog should evolve into a serious front-end for the larger system.
