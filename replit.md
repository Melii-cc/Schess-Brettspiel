# Schess

Ein lokales Zwei-Spieler-Brettspiel mit eigenen Figuren, Zugregeln und Schessmatt.

## Run & Operate

- `pnpm --filter @workspace/schess run dev` — start the Schess web app (managed workflow)
- `pnpm --filter @workspace/schess run typecheck` — typecheck the game app
- `pnpm run typecheck` — typecheck all workspace packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React, Vite, TypeScript
- Game state is local to the browser; this app has no backend or database.

## Where things live

- `artifacts/schess/src/game/engine.ts` — initial position, legal moves, check, captures, and game endings
- `artifacts/schess/src/App.tsx` — board interaction, history, capture display, undo, and restart
- `artifacts/schess/src/index.css` — board and interface styling

## Architecture decisions

- Game rules are implemented in a deterministic frontend engine; matches are local and are not saved.
- Coordinates use `file 0 = a`, `rank 0 = rank 1`; the UI displays rank 8 at the top and starts with a1 black.
- Blue's General is on d1 and Red's on d8 to honor the requested square colors, even though this breaks full rotational symmetry. The Kings face each other on e1/e8.
- A Soldier moves one square forward, or two squares from its starting rank when both squares are clear. An opposing Soldier may capture it en passant on the immediately following turn; no promotion rule is specified.
- Bunker is the game's castling-like move: an unmoved King moves two squares toward an unmoved Tank on its starting back rank, and that Tank moves to the skipped square. The path must be clear, and the King may not start in Schess, cross an attacked square, or finish in Schess. Either Tank may be used.
- A non-King may answer a single Schess by capturing the attacker or blocking a sliding attack; multiple attackers require a King move, and an Aircraft attack cannot be blocked.
- Red piece symbols are rotated 180 degrees so they read upright from Red's side of the physical-device board.

## Product

Two players take turns on an 8×8 board. Pieces move by drag-and-drop or tap-to-select, and the game enforces legal moves, Schess, Schessmatt, captures, and King capture.

## User preferences

The user requested a German-language game called “Schess” with Blue starting, distinct geometric/military piece symbols, and a two-player pass-and-play board.

## Gotchas

The GameState board is indexed as `board[rank][file]`; keep all movement and check rules in the game engine rather than duplicating them in the UI.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
