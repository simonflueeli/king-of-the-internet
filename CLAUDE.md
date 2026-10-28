# The Throne (King of the Internet)

Production web app where people pay to put their name on a public throne. Read before working:

- `docs/PRD.md` — product requirements (source of truth).
- `docs/prototype.html` — visual/copy reference (open in a browser).
- `docs/ARCHITECTURE.md` — stack, file ownership per workstream, shared contracts and API. Respect the
  ownership table: never edit another workstream's files; put contract change requests in
  `docs/changes/<workstream>.md`.

Conventions: TypeScript strict, npm, Windows dev machine (cross-platform scripts), money in integer cents,
all times UTC, server is the source of truth for prices.
