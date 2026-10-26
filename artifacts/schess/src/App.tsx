import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  createInitialState,
  getLegalMoves,
  makeMove,
  type GameState,
  type Piece,
  type PieceType,
  type PlayerColor,
  type Square,
} from './game/engine';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const pieceNames: Record<PieceType, string> = {
  tank: 'Tank',
  aircraft: 'Flugzeug',
  artillery: 'Artillerie',
  general: 'General',
  king: 'König',
  soldier: 'Soldat',
};
const pieceShort: Record<PieceType, string> = {
  tank: 'PZ',
  aircraft: 'FL',
  artillery: 'AT',
  general: 'GE',
  king: 'KÖ',
  soldier: 'SO',
};

function squareKey(square: Square) {
  return `${square.file},${square.rank}`;
}

function squareName(square: Square) {
  return `${files[square.file]}${square.rank + 1}`;
}

function PieceGlyph({ type }: { type: PieceType }) {
  if (type === 'tank') {
    return <svg className="piece-glyph" viewBox="0 0 40 40" aria-hidden="true"><rect className="solid" x="8" y="8" width="24" height="24" rx="1" /></svg>;
  }
  if (type === 'aircraft') {
    return <svg className="piece-glyph" viewBox="0 0 40 40" aria-hidden="true"><path className="solid" d="M4 6h32v9H23v20h-6V15H4V6Z" /></svg>;
  }
  if (type === 'artillery') {
    return <svg className="piece-glyph" viewBox="0 0 40 40" aria-hidden="true"><path className="solid" d="M17 5h6v30h-6z" /></svg>;
  }
  if (type === 'general') {
    return <svg className="piece-glyph" viewBox="0 0 40 40" aria-hidden="true"><path className="solid" d="M20 3 23 7l5-1 1 5 4 3-3 5 1 5-5 1-3 4-5-3-5 1-1-5-4-3 3-5-1-5 5-1 3-4 4 1Z" /><circle cx="20" cy="17" r="5" /><circle cx="20" cy="17" r="2" className="solid" /><path d="m13 25 5 2 2 9 5-6 5 3-2-9" /></svg>;
  }
  if (type === 'king') {
    return <svg className="piece-glyph" viewBox="0 0 40 40" aria-hidden="true"><path className="solid" d="M9 7h22L20 16 9 25V7Z" /><path d="M10 6v29" /></svg>;
  }
  return <svg className="piece-glyph" viewBox="0 0 40 40" aria-hidden="true"><path className="solid" d="M20 4 31 35H9L20 4Z" /></svg>;
}

function statusCopy(state: GameState) {
  if (state.status === 'checkmate') return `Sieg für ${state.winner === 'blue' ? 'Blau' : 'Rot'} durch Schessmatt`;
  if (state.status === 'king-captured') return `${state.winner === 'blue' ? 'Blau' : 'Rot'} hat den König geschlagen`;
  if (state.status === 'stalemate') return 'Patt — unentschieden';
  return state.checkedPlayer ? `${state.checkedPlayer === 'blue' ? 'Blau' : 'Rot'} steht unter Schess` : 'Partie läuft';
}

function App() {
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalDestinations, setLegalDestinations] = useState<Square[]>([]);
  const [dragFrom, setDragFrom] = useState<Square | null>(null);

  const legalKeys = useMemo(() => new Set(legalDestinations.map(squareKey)), [legalDestinations]);
  const history = game.history;
  const capturedPieces = useMemo(() => {
    const captured = { blue: [] as Piece[], red: [] as Piece[] };
    for (const move of history) {
      if (move.captured) captured[move.piece.color].push(move.captured);
    }
    return captured;
  }, [history]);
  const currentNumber = Math.floor(history.length / 2) + 1;
  const lastMove = game.lastMove;
  const finished = game.status !== 'playing';

  const commitMove = useCallback((from: Square, to: Square) => {
    if (!getLegalMoves(game, from).some((destination) => squareKey(destination) === squareKey(to))) return;
    setUndoStack((previous) => [...previous, game]);
    setGame(makeMove(game, from, to));
    setSelected(null);
    setLegalDestinations([]);
  }, [game]);

  const chooseSquare = (square: Square) => {
    if (finished) return;
    if (selected && legalKeys.has(squareKey(square))) {
      commitMove(selected, square);
      return;
    }
    const piece = game.board[square.rank]?.[square.file];
    if (piece?.color === game.turn) {
      if (selected && squareKey(selected) === squareKey(square)) {
        setSelected(null);
        setLegalDestinations([]);
      } else {
        setSelected(square);
        setLegalDestinations(getLegalMoves(game, square));
      }
      return;
    }
    if (!piece) {
      setSelected(null);
      setLegalDestinations([]);
    }
  };

  const restart = () => {
    setGame(createInitialState());
    setUndoStack([]);
    setSelected(null);
    setLegalDestinations([]);
  };

  const undo = () => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setGame(previous);
    setUndoStack((stack) => stack.slice(0, -1));
    setSelected(null);
    setLegalDestinations([]);
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, square: Square) => {
    const piece = game.board[square.rank][square.file];
    if (!piece || piece.color !== game.turn || finished) {
      event.preventDefault();
      return;
    }
    setDragFrom(square);
    setSelected(square);
    setLegalDestinations(getLegalMoves(game, square));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', squareKey(square));
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>, square: Square) => {
    event.preventDefault();
    const origin = dragFrom ?? selected;
    if (origin) commitMove(origin, square);
    setDragFrom(null);
  };

  const getTurnText = () => finished ? statusCopy(game) : `${game.turn === 'blue' ? 'Blau' : 'Rot'} ist am Zug`;

  return (
    <main className="app-shell">
      <div className="game-wrap">
        <header className="topbar">
          <div className="brand" aria-label="Schess">
            <div className="brand-mark" aria-hidden="true">S</div>
            <div>
              <div className="brand-name">Schess</div>
              <div className="brand-sub">Ein Spiel um Stellung</div>
            </div>
          </div>
          <div className="top-actions">
            <button className="quiet-button" onClick={undo} disabled={!undoStack.length} data-testid="button-undo" aria-label="Letzten Zug zurücknehmen">
              <Undo2 size={15} strokeWidth={1.8} /><span>Zurück</span>
            </button>
            <button className="quiet-button" onClick={restart} data-testid="button-restart" aria-label="Neue Partie starten">
              <RotateCcw size={14} strokeWidth={1.8} /><span>Neue Partie</span>
            </button>
          </div>
        </header>

        <section className="intro-row" aria-label="Partie">
          <div>
            <div className="eyebrow">Zu zweit am selben Brett</div>
            <h1 className="title">Das Brett ist bereit.</h1>
          </div>
          <div className="match-meta">PARTIE OHNE ZEITLIMIT<strong>Partie 01&nbsp; · &nbsp;Ohne Uhr</strong></div>
        </section>

        <div className="game-layout">
          <section className="board-column" aria-label="Spielbrett">
            <div className="turn-banner" role="status" aria-live="polite" data-testid="status-turn">
              <div className="turn-info">
                <span className={`turn-dot ${game.turn}`} aria-hidden="true" />
                <div>
                  <div className="turn-label">{getTurnText()}</div>
                  <div className="turn-caption">{finished ? 'Partie beendet' : game.checkedPlayer ? 'Der König ist bedroht' : 'Figur wählen, um zu ziehen'}</div>
                </div>
              </div>
              <span className={`turn-chip ${game.checkedPlayer || finished ? 'alert' : ''}`}>{game.checkedPlayer ? 'Schess' : finished ? 'Ende' : `Zug ${currentNumber}`}</span>
            </div>

            <div className="board-frame">
              <div className="board-grid" role="grid" aria-label="Schess-Spielbrett, Reihe 8 oben und Linie a links">
                {Array.from({ length: 8 }, (_, rowIndex) => {
                  const rank = 7 - rowIndex;
                  return Array.from({ length: 8 }, (_, file) => {
                    const square = { file, rank };
                    const piece = game.board[rank]?.[file] ?? null;
                    const isLight = (rank + file) % 2 !== 0;
                    const isSelected = selected && squareKey(selected) === squareKey(square);
                    const isLegal = legalKeys.has(squareKey(square));
                    const isLastFrom = !!lastMove && squareKey(lastMove.from) === squareKey(square);
                    const isLastTo = !!lastMove && squareKey(lastMove.to) === squareKey(square);
                    const isCheck = game.checkedPlayer === piece?.color && piece?.type === 'king';
                    const label = `${squareName(square)}${piece ? `, ${piece.color} ${pieceNames[piece.type]}` : ', empty'}${isLegal ? ', legal destination' : ''}`;
                    return (
                      <button
                        key={squareKey(square)}
                        type="button"
                        role="gridcell"
                        className={`square ${isLight ? 'light' : 'dark'}${isSelected ? ' selected' : ''}${isLastFrom ? ' last-from' : ''}${isLastTo ? ' last-to' : ''}${isCheck ? ' in-check' : ''}`}
                        aria-label={label}
                        aria-selected={!!isSelected}
                        data-testid={`square-${squareName(square)}`}
                        draggable={!!piece && piece.color === game.turn && !finished}
                        onClick={() => chooseSquare(square)}
                        onDragStart={(event) => onDragStart(event, square)}
                        onDragOver={(event) => { if (dragFrom || selected) event.preventDefault(); }}
                        onDrop={(event) => onDrop(event, square)}
                        onDragEnd={() => setDragFrom(null)}
                      >
                        {file === 0 && <span className="coord rank">{rank + 1}</span>}
                        {rank === 0 && <span className="coord file">{files[file]}</span>}
                        {isLegal && <span className={`move-dot ${piece ? 'capture-dot' : ''}`} aria-hidden="true" />}
                        {piece && (
                          <span className={`piece-token ${piece.color}`} aria-hidden="true">
                            <PieceGlyph type={piece.type} />
                          </span>
                        )}
                      </button>
                    );
                  });
                })}
              </div>
              <div className="file-labels" aria-hidden="true">{files.map((file) => <span key={file}>{file}</span>)}</div>
            </div>
            <div className="board-caption">
              <span>Blau zieht nach oben ↑</span>
              <span>Figur wählen, dann Zielfeld antippen</span>
            </div>
          </section>

          <aside className="side-panel" aria-label="Partiedetails">
            <section className="panel" aria-label="Geschlagene Figuren">
              <div className="panel-head">
              <div className="panel-title">Geschlagene Figuren</div>
              <div className="panel-kicker">Nach Spieler</div>
              </div>
              {(['blue', 'red'] as PlayerColor[]).map((color) => (
                <div className="player-card" key={color}>
                  <div className="player-head">
                    <div className="player-name-wrap">
                      <span className={`player-disc ${color === 'red' ? 'red' : ''}`} aria-hidden="true">{color === 'blue' ? 'B' : 'R'}</span>
                      <span className="player-name">{color === 'blue' ? 'Blau' : 'Rot'}</span>
                    </div>
                    {game.turn === color && !finished && <span className={`player-turn ${color}`}>Am Zug</span>}
                    {finished && game.winner === color && <span className="status-pill won">Sieger</span>}
                  </div>
                  <div className="captured-row" aria-label={`Von ${color === 'blue' ? 'Blau' : 'Rot'} geschlagene Figuren`}>
                    {capturedPieces[color].length ? capturedPieces[color].map((captured, index) => (
                      <span className={`captured-piece ${captured.color}`} key={`${captured.id}-${index}`} title={`${captured.color} ${pieceNames[captured.type]}`}>
                        {pieceShort[captured.type]}
                      </span>
                    )) : <span className="empty-captured">Noch keine Schläge</span>}
                  </div>
                </div>
              ))}
              {game.checkedPlayer && !finished && <div className="rules-strip"><strong>Schess.</strong> Der nächste Zug muss den König schützen.</div>}
              {finished && <div className="rules-strip"><strong>{statusCopy(game)}.</strong> Starte eine neue Partie, um weiterzuspielen.</div>}
            </section>

            <section className="panel history-panel" aria-label="Zugverlauf">
              <div className="panel-head">
                <div className="panel-title">Zugverlauf</div>
                <div className="panel-kicker">{history.length} {history.length === 1 ? 'Zug' : 'Züge'}</div>
              </div>
              {history.length ? (
                <div className="move-list" role="list" data-testid="list-move-history">
                  {Array.from({ length: Math.ceil(history.length / 2) }, (_, pairIndex) => {
                    const blueMove = history[pairIndex * 2];
                    const redMove = history[pairIndex * 2 + 1];
                    return (
                      <div className="move-row" role="listitem" key={pairIndex}>
                        <span className="move-number">{String(pairIndex + 1).padStart(2, '0')}</span>
                        {[blueMove, redMove].map((move, slot) => move ? (
                          <span className={`move-entry ${pairIndex === Math.floor((history.length - 1) / 2) && ((history.length - 1) % 2) === slot ? 'current' : ''}`} key={`${move.piece.id}-${slot}`}>
                            <i className={`move-color ${move.piece.color}`} aria-hidden="true" />
                            <span>{pieceShort[move.piece.type]} {squareName(move.from)}–{squareName(move.to)}{move.captured ? ' ×' : ''}</span>
                          </span>
                        ) : <span key="waiting" />)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-history" data-testid="empty-move-history">
                  <strong>Der erste Zug steht noch aus.</strong>
                  Wähle eine Figur und ziehe sie auf ein markiertes Feld.
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">Spielregeln</div>
                <div className="panel-kicker">Kurz erklärt</div>
              </div>
              <div className="rules-strip"><strong>Panzer</strong> zieht waagerecht und senkrecht, <strong>Artillerie</strong> diagonal. Der <strong>General</strong> kombiniert beide. Das <strong>Flugzeug</strong> springt im L. Der <strong>König</strong> zieht ein Feld; der <strong>Soldat</strong> geht vorwärts und schlägt diagonal. Bei Schess muss der König geschützt werden. Eine Figur antippen, um erlaubte Züge zu sehen.</div>
            </section>
          </aside>
        </div>
        <footer className="footer-note">Ein Brett · Zwei Spieler · Ohne Zeitdruck</footer>
      </div>
    </main>
  );
}

export default App;
