import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { Flag, RotateCcw, Undo2, Check, X } from 'lucide-react';
import {
  createInitialState,
  getLegalMoves,
  makeMove,
  acceptDraw,
  resignGame,
  PROMOTION_TYPES,
  type GameState,
  type Piece,
  type PieceType,
  type PlayerColor,
  type Square,
} from './game/engine';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const pieceNames: Record<PieceType, string> = {
  tank: 'Panzer', aircraft: 'Flugzeug', artillery: 'Artillerie',
  general: 'General', king: 'König', soldier: 'Soldat',
};
const pieceShort: Record<PieceType, string> = {
  tank: 'PZ', aircraft: 'FL', artillery: 'AT', general: 'GE', king: 'KÖ', soldier: 'SO',
};
const labelColor = (color: PlayerColor) => color === 'blue' ? 'Weiß' : 'Schwarz';
const opposite = (color: PlayerColor): PlayerColor => color === 'blue' ? 'red' : 'blue';
const squareKey = (square: Square) => `${square.file},${square.rank}`;
const squareName = (square: Square) => `${files[square.file]}${square.rank + 1}`;

function statusCopy(state: GameState) {
  if (state.status === 'checkmate') return `Schessmatt — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'king-captured') return `König geschlagen — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'resignation') return `Aufgabe — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'draw') return state.drawReason === 'stalemate' ? 'Patt — Remis' : 'Remis';
  return state.checkedPlayer ? `${labelColor(state.checkedPlayer)} steht unter Schess` : 'Partie läuft';
}

function specialMoveLabel(special: 'double-step' | 'en-passant' | 'bunker' | undefined) {
  if (special === 'bunker') return 'Bunker';
  if (special === 'en-passant') return 'en passant';
  if (special === 'double-step') return 'Doppelschritt';
  return null;
}

function App() {
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalDestinations, setLegalDestinations] = useState<Square[]>([]);
  const [dragFrom, setDragFrom] = useState<Square | null>(null);
  const [started, setStarted] = useState(false);
  const [drawOffer, setDrawOffer] = useState<PlayerColor | null>(null);
  const [resigning, setResigning] = useState<PlayerColor | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square; color: PlayerColor } | null>(null);

  const legalKeys = useMemo(() => new Set(legalDestinations.map(squareKey)), [legalDestinations]);
  const history = game.history;
  const capturedPieces = useMemo(() => {
    const captured = { blue: [] as Piece[], red: [] as Piece[] };
    for (const move of history) if (move.captured) captured[move.piece.color].push(move.captured);
    return captured;
  }, [history]);
  const currentNumber = Math.floor(history.length / 2) + 1;
  const lastMove = game.lastMove;
  const finished = game.status !== 'playing';
  const locked = !started || finished || !!drawOffer || !!promotion;

  const finishMove = useCallback((from: Square, to: Square, chosen?: Exclude<PieceType, 'king' | 'soldier'>) => {
    setUndoStack((previous) => [...previous, game]);
    setGame(makeMove(game, from, to, chosen));
    setSelected(null);
    setLegalDestinations([]);
    setPromotion(null);
  }, [game]);

  const commitMove = useCallback((from: Square, to: Square) => {
    if (locked || !getLegalMoves(game, from).some((destination) => squareKey(destination) === squareKey(to))) return;
    const piece = game.board[from.rank]?.[from.file];
    const promotes = piece?.type === 'soldier' &&
      ((piece.color === 'blue' && to.rank === 7) || (piece.color === 'red' && to.rank === 0)) &&
      game.board[to.rank]?.[to.file]?.type !== 'king';
    if (promotes && piece) {
      setPromotion({ from, to, color: piece.color });
      setSelected(null);
      setLegalDestinations([]);
      return;
    }
    finishMove(from, to);
  }, [finishMove, game, locked]);

  const chooseSquare = (square: Square) => {
    if (locked) return;
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
    setDrawOffer(null);
    setPromotion(null);
    setResigning(null);
    setStarted(true);
  };

  const undo = () => {
    if (!undoStack.length || drawOffer || promotion) return;
    setGame(undoStack[undoStack.length - 1]!);
    setUndoStack((stack) => stack.slice(0, -1));
    setSelected(null);
    setLegalDestinations([]);
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, square: Square) => {
    const piece = game.board[square.rank][square.file];
    if (!piece || piece.color !== game.turn || locked) {
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

  const actOnResignation = () => {
    if (!resigning) return;
    setGame(resignGame(game, resigning));
    setResigning(null);
    setSelected(null);
    setLegalDestinations([]);
  };

  const actionBar = (color: PlayerColor, position: 'upper' | 'lower') => {
    const active = started && !finished && game.turn === color && !drawOffer && !promotion;
    return (
      <div className={`player-actions ${position} ${color}`} data-testid={`actions-${labelColor(color).toLowerCase()}`}>
        <div className="action-player">
          <span className={`side-mark ${color}`} aria-hidden="true" />
          <div><strong>{labelColor(color)}</strong><small>{active ? 'Am Zug' : position === 'upper' ? 'Gegenüber' : 'Deine Seite'}</small></div>
        </div>
        <div className="action-buttons">
          <button type="button" className="action-button draw-button" onClick={() => setDrawOffer(color)} disabled={!active} data-testid={`button-draw-${labelColor(color).toLowerCase()}`} aria-label={`${labelColor(color)} bietet Remis an`}>
            <span className="half-symbol" aria-hidden="true">½</span><span>Remis</span>
          </button>
          <button type="button" className="action-button resign-button" onClick={() => setResigning(color)} disabled={!active} data-testid={`button-resign-${labelColor(color).toLowerCase()}`}>
            <Flag size={15} aria-hidden="true" /><span>Aufgeben</span>
          </button>
        </div>
      </div>
    );
  };

  const previewMode = !started || game.status === 'draw';
  const winnerMode = finished && game.status !== 'draw';
  const isFinalBoard = previewMode || winnerMode;

  return (
    <main className="app-shell">
      <div className="game-wrap">
        <header className="topbar">
          <div className="brand" aria-label="Schess">
            <div className="brand-mark" aria-hidden="true">S</div>
            <div><div className="brand-name">Schess</div><div className="brand-sub">Ein Spiel um Stellung</div></div>
          </div>
          <div className="top-actions">
            <button className="quiet-button" onClick={undo} disabled={!undoStack.length || !!drawOffer || !!promotion} data-testid="button-undo" aria-label="Letzten Zug zurücknehmen"><Undo2 size={15} /><span>Zurück</span></button>
            <button className="quiet-button" onClick={restart} data-testid="button-restart" aria-label="Neue Partie starten"><RotateCcw size={14} /><span>Neue Partie</span></button>
          </div>
        </header>

        <section className="intro-row" aria-label="Partie">
          <div><div className="eyebrow">Zu zweit am selben Brett</div><h1 className="title">{!started ? 'Ein Brett. Zwei Perspektiven.' : finished ? statusCopy(game) : 'Das Brett ist bereit.'}</h1></div>
          <div className="match-meta">PARTIE OHNE ZEITLIMIT<strong>Partie 01&nbsp; · &nbsp;Ohne Uhr</strong></div>
        </section>

        <div className="game-layout">
          <section className="board-column" aria-label="Spielbrett">
            <div className="turn-banner" role="status" aria-live="polite" data-testid="status-turn">
              <div className="turn-info"><span className={`turn-dot ${game.turn}`} aria-hidden="true" /><div><div className="turn-label">{finished ? statusCopy(game) : !started ? 'Bereit für den ersten Zug' : `${labelColor(game.turn)} ist am Zug`}</div><div className="turn-caption">{finished ? 'Partie beendet' : game.checkedPlayer ? 'Der König ist bedroht' : !started ? 'Startet die Partie gemeinsam' : 'Figur wählen, um zu ziehen'}</div></div></div>
              <span className={`turn-chip ${game.checkedPlayer || finished ? 'alert' : ''}`}>{game.checkedPlayer ? 'Schess' : finished ? 'Ende' : `Zug ${currentNumber}`}</span>
            </div>

            {actionBar('red', 'upper')}
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
                    const label = `${squareName(square)}${piece ? `, ${labelColor(piece.color)} ${pieceNames[piece.type]}` : ', leer'}${isLegal ? ', erlaubtes Zielfeld' : ''}`;
                    return (
                      <button key={squareKey(square)} type="button" role="gridcell" className={`square ${isLight ? 'light' : 'dark'}${isSelected ? ' selected' : ''}${isLastFrom ? ' last-from' : ''}${isLastTo ? ' last-to' : ''}${isCheck ? ' in-check' : ''}`}
                        aria-label={label} aria-selected={!!isSelected} data-testid={`square-${squareName(square)}`}
                        draggable={!!piece && piece.color === game.turn && !locked}
                        onClick={() => chooseSquare(square)} onDragStart={(event) => onDragStart(event, square)}
                        onDragOver={(event) => { if (!locked && (dragFrom || selected)) event.preventDefault(); }}
                        onDrop={(event) => onDrop(event, square)} onDragEnd={() => setDragFrom(null)}>
                        {file === 0 && <span className="coord rank">{rank + 1}</span>}
                        {rank === 0 && <span className="coord file">{files[file]}</span>}
                        {isLegal && <span className={`move-dot ${piece ? 'capture-dot' : ''}`} aria-hidden="true" />}
                        {piece && <span className={`piece-token ${piece.color}`} aria-hidden="true"><img src={`/images/pieces/${piece.type}-${piece.color === 'blue' ? 'white' : 'black'}.png`} alt="" /></span>}
                      </button>
                    );
                  });
                })}
              </div>
              {isFinalBoard && (
                <div className={`board-halves ${winnerMode ? 'winner-halves' : 'preview-halves'}`} aria-label={winnerMode ? 'Ergebnis der Partie' : 'Brettvorschau'}>
                  {(['red', 'blue'] as PlayerColor[]).map((color) => {
                    const isTop = color === 'red';
                    const won = game.winner === color;
                    const lost = winnerMode && game.winner !== color;
                    const image = winnerMode ? (won ? '/images/winner-portrait.jpg' : '/images/defeated-wasted.png') : '/images/board-preview.jpg';
                    return <div className={`half-image ${isTop ? 'half-top' : 'half-bottom'} ${color}`} key={color} style={{ backgroundImage: `url("${image}")` }} aria-label={`${labelColor(color)}: ${winnerMode ? (won ? 'Sieger' : 'Verlierer') : 'Brettvorschau'}`}>
                      <span className="half-image-title">{winnerMode ? (won ? `${labelColor(color)} gewinnt` : `${labelColor(color)}` ) : labelColor(color)}</span>
                      {lost && <span className="sr-only">Verlierer</span>}
                    </div>;
                  })}
                </div>
              )}
              {drawOffer && (
                <div className={`draw-overlay ${drawOffer === 'blue' ? 'to-red' : 'to-blue'}`} role="dialog" aria-modal="true" aria-labelledby="draw-title" data-testid="dialog-draw-offer">
                  <div className="draw-message">
                    <span className="draw-emblem">½</span>
                    <p className="draw-overline">{labelColor(opposite(drawOffer))}, dein Gegenüber fragt</p>
                    <h2 id="draw-title">Remis?</h2>
                    <p>{labelColor(drawOffer)} bietet ein Unentschieden an.</p>
                    <div className="draw-actions">
                      <button type="button" className="confirm-button" onClick={() => { setGame(acceptDraw(game)); setDrawOffer(null); setSelected(null); setLegalDestinations([]); }} data-testid="button-draw-accept"><Check size={16} /> Annehmen</button>
                      <button type="button" className="decline-button" onClick={() => setDrawOffer(null)} data-testid="button-draw-decline"><X size={16} /> Ablehnen</button>
                    </div>
                  </div>
                </div>
              )}
              {!started && <div className="start-overlay"><span className="start-kicker">Eine Partie unter Freunden</span><h2>Wer setzt den ersten Zug?</h2><p>Weiß beginnt. Schwarz spielt von der gegenüberliegenden Seite.</p><button className="start-button" onClick={() => setStarted(true)} data-testid="button-start-game">Partie beginnen <span aria-hidden="true">→</span></button></div>}
              {game.status === 'draw' && started && <div className="result-overlay" data-testid="status-draw"><span className="result-symbol">½</span><strong>{game.drawReason === 'stalemate' ? 'Patt' : 'Remis'}</strong><span>{game.drawReason === 'agreement' ? 'Einvernehmlich beendet' : game.drawReason === 'repetition' ? 'Dreifache Stellungswiederholung' : game.drawReason === 'fifty-move' ? '50-Züge-Regel' : game.drawReason === 'insufficient-material' ? 'Nicht genügend Material' : 'Keine legalen Züge'}</span><button className="result-restart" onClick={restart} data-testid="button-new-game-draw">Neue Partie</button></div>}
            </div>
            {actionBar('blue', 'lower')}
            <div className="board-caption"><span>Weiß zieht nach oben ↑</span><span>Figur wählen, dann Zielfeld antippen</span></div>
          </section>

          <aside className="side-panel" aria-label="Partiedetails">
            <section className="panel" aria-label="Geschlagene Figuren">
              <div className="panel-head"><div className="panel-title">Geschlagene Figuren</div><div className="panel-kicker">Nach Spieler</div></div>
              {(['blue', 'red'] as PlayerColor[]).map((color) => <div className="player-card" key={color}>
                <div className="player-head"><div className="player-name-wrap"><span className={`player-disc ${color}`} aria-hidden="true">{color === 'blue' ? 'W' : 'S'}</span><span className="player-name">{labelColor(color)}</span></div>
                  {started && game.turn === color && !finished && <span className={`player-turn ${color}`}>Am Zug</span>}
                  {finished && game.winner === color && <span className="status-pill won">Sieger</span>}
                </div>
                <div className="captured-row" aria-label={`Von ${labelColor(color)} geschlagene Figuren`} data-testid={`captured-${labelColor(color).toLowerCase()}`}>
                  {capturedPieces[color].length ? capturedPieces[color].map((captured, index) => <span className={`captured-piece ${captured.color}`} key={`${captured.id}-${index}`} title={`${labelColor(captured.color)} ${pieceNames[captured.type]}`}>{pieceShort[captured.type]}</span>) : <span className="empty-captured">Noch keine Schläge</span>}
                </div>
              </div>)}
              {game.checkedPlayer && !finished && <div className="rules-strip"><strong>Schess.</strong> Der nächste Zug muss den König schützen.</div>}
              {finished && game.status !== 'draw' && <div className="rules-strip"><strong>{statusCopy(game)}.</strong> Starte eine neue Partie, um weiterzuspielen.</div>}
            </section>
            <section className="panel history-panel" aria-label="Zugverlauf">
              <div className="panel-head"><div className="panel-title">Zugverlauf</div><div className="panel-kicker">{history.length} {history.length === 1 ? 'Zug' : 'Züge'}</div></div>
              {history.length ? <div className="move-list" role="list" data-testid="list-move-history">
                {Array.from({ length: Math.ceil(history.length / 2) }, (_, pairIndex) => {
                  const whiteMove = history[pairIndex * 2];
                  const blackMove = history[pairIndex * 2 + 1];
                  return <div className="move-row" role="listitem" key={pairIndex}><span className="move-number">{String(pairIndex + 1).padStart(2, '0')}</span>
                    {[whiteMove, blackMove].map((move, slot) => move ? <span className={`move-entry ${pairIndex === Math.floor((history.length - 1) / 2) && ((history.length - 1) % 2) === slot ? 'current' : ''}`} key={`${move.piece.id}-${slot}`}>
                      <i className={`move-color ${move.piece.color}`} aria-hidden="true" /><span>{pieceShort[move.piece.type]} {squareName(move.from)}–{squareName(move.to)}{move.promotion ? `=${pieceShort[move.promotion]}` : ''}{move.captured ? ' ×' : ''}{move.special && <small className="move-special">{specialMoveLabel(move.special)}</small>}</span>
                    </span> : <span key="waiting" />)}
                  </div>;
                })}
              </div> : <div className="empty-history" data-testid="empty-move-history"><strong>Der erste Zug steht noch aus.</strong>Wähle eine Figur und ziehe sie auf ein markiertes Feld.</div>}
            </section>
            <section className="panel"><div className="panel-head"><div className="panel-title">Spielregeln</div><div className="panel-kicker">Kurz erklärt</div></div>
              <div className="rules-strip"><strong>Panzer</strong> zieht waagerecht und senkrecht, <strong>Artillerie</strong> diagonal. Der <strong>General</strong> kombiniert beide. Das <strong>Flugzeug</strong> springt im L. Der <strong>König</strong> zieht ein Feld; der <strong>Soldat</strong> geht vorwärts und schlägt diagonal. Vom Startfeld darf ein Soldat zwei Felder ziehen. Direkt danach kann ein benachbarter Soldat ihn <strong>en passant</strong> schlagen.<br /><br /><strong>Bunker:</strong> Der König zieht zwei Felder zu einem ungezogenen Panzer, der auf das übersprungene Feld rückt. Der Weg muss frei sein; der König darf weder im Schess stehen noch über ein angegriffenes Feld ziehen oder auf einem angegriffenen Feld landen. Bei Schess muss der König geschützt werden.</div>
            </section>
          </aside>
        </div>
        <footer className="footer-note">Ein Brett · Zwei Spieler · Ohne Zeitdruck</footer>
      </div>

      {promotion && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="promotion-title" data-testid="dialog-promotion">
        <div className="promotion-dialog"><span className="eyebrow">Soldat auf der letzten Reihe</span><h2 id="promotion-title">Wähle eine Beförderung</h2><p>Deine Figur wird erst nach der Auswahl aufgewertet.</p>
          <div className="promotion-options">{PROMOTION_TYPES.map((type) => <button type="button" className="promotion-option" key={type} onClick={() => finishMove(promotion.from, promotion.to, type)} data-testid={`button-promote-${type}`}>
            <img src={`/images/pieces/${type}-${promotion.color === 'blue' ? 'white' : 'black'}.png`} alt="" /><span>{pieceNames[type]}</span>
          </button>)}</div>
        </div>
      </div>}

      {resigning && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="resign-title" data-testid="dialog-resign">
        <div className="confirm-dialog"><div className="confirm-icon"><Flag size={20} /></div><span className="eyebrow">{labelColor(resigning)} gibt auf</span><h2 id="resign-title">Willst du wirklich aufgeben?</h2><p>Die Partie endet sofort. {labelColor(opposite(resigning))} gewinnt.</p>
          <div className="confirm-actions"><button type="button" className="decline-button" onClick={() => setResigning(null)} data-testid="button-resign-cancel">Abbrechen</button><button type="button" className="danger-button" onClick={actOnResignation} data-testid="button-resign-confirm">Aufgeben</button></div>
        </div>
      </div>}
    </main>
  );
}

export default App;
