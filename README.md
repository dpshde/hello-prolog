# HelloProlog

Beautiful Arrow.js boilerplate for a browser-based Prolog REPL with a secondary worldspace visualization.

## Stack

- `@arrow-js/core` for reactive UI
- `tau-prolog` for in-browser Prolog execution
- `vite` for local development and build
- raw CSS for layout, theming, and motion

## Run

```bash
pnpm install
pnpm dev
```

## What The Boilerplate Includes

- A seeded Prolog editor with two demo worlds
- A query surface that consults and runs goals in Tau Prolog
- A worldspace view that derives entities, predicates, and edges from parsed facts
- Predicate cards that stamp example queries into the REPL

## Notes

- The visualization is fact-oriented. It ignores rules and directives in the graph, but Tau Prolog still evaluates them in the REPL.
- Unary facts become tags on entities, binary facts become links, and larger facts become inner-ring relation nodes.
