import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Flag, RotateCcw, Check, X, Clock } from 'lucide-react';
import {
  createInitialState,
  getLegalMoves,
  makeMove,
  acceptDraw,
  resignGame,
  timeoutGame,
  PROMOTION_TYPES,
  type GameState,
  type Piece,
  type PieceType,
  type PlayerColor,
  type Square,
} from './game/engine';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const pieceNames: Record<PieceType, string> = {
  tank: 'Turm', aircraft: 'Springer', artillery: 'Läufer',
  general: 'Dame', king: 'König', soldier: 'Bauer',
};
const pieceValues: Record<PieceType, number> = {
  soldier: 1, aircraft: 3, artillery: 3, tank: 5, general: 9, king: 0,
};
const materialOrder: PieceType[] = ['general', 'tank', 'aircraft', 'artillery', 'soldier', 'king'];
const labelColor = (color: PlayerColor) => color === 'blue' ? 'Weiß' : 'Schwarz';
const opposite = (color: PlayerColor): PlayerColor => color === 'blue' ? 'red' : 'blue';
const squareKey = (square: Square) => `${square.file},${square.rank}`;
const squareName = (square: Square) => `${files[square.file]}${square.rank + 1}`;
type TimeControl = { initialMinutes: number; incrementSeconds: number };
type ClockTimes = Record<PlayerColor, number>;
const timePresets = [
  { minutes: 1, symbol: '🔫', name: 'Kugel' },
  { minutes: 3, symbol: '⚡', name: 'Blitz' },
  { minutes: 5, symbol: '🐇', name: 'Hase' },
  { minutes: 10, symbol: '🏃', name: 'Läufer' },
  { minutes: 50, symbol: '🐢', name: 'Schildkröte' },
  { minutes: 100, symbol: '🥱', name: 'Gähnen' },
];

function formatClock(milliseconds: number) {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function TakebackArrow() {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true" focusable="false">
      <path d="M4 4h14a5 5 0 0 1 0 10H3" />
      <path d="m8 10-5 4 5 4" />
    </svg>
  );
}

function statusCopy(state: GameState) {
  if (state.status === 'checkmate') return `Schessmatt — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'king-captured') return `König geschlagen — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'resignation') return `Aufgabe — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'timeout') return `Zeit abgelaufen — ${labelColor(state.winner!)} gewinnt`;
  if (state.status === 'draw') return state.drawReason === 'stalemate' ? 'Patt — Remis' : 'Remis';
  return state.checkedPlayer ? `${labelColor(state.checkedPlayer)} steht unter Schess` : 'Partie läuft';
}

interface CapturedPanelProps {
  perspective: PlayerColor;
  net: Record<PlayerColor, Piece[]>;
  turn: PlayerColor;
  started: boolean;
  finished: boolean;
  winner: PlayerColor | null;
  materialDifference: number;
}

function CapturedPanel({
  perspective,
  net,
  turn,
  started,
  finished,
  winner,
  materialDifference,
}: CapturedPanelProps) {
  const view = perspective === 'red' ? 'black' : 'white';
  return (
    <section className="panel material-panel" aria-label={`Geschlagene Figuren aus Sicht von ${labelColor(perspective)}`} data-testid={`captured-panel-${view}`}>
      <div className="panel-head">
        <div className="panel-title">Geschlagene Figuren</div>
        <div className="panel-kicker">Wertvorteil</div>
      </div>
      {(['blue', 'red'] as PlayerColor[]).map((color) => {
        const advantage = color === 'blue' ? materialDifference : -materialDifference;
        return (
          <div className="captured-player" key={color}>
            <div className="captured-player-head">
              <div className="player-name-wrap">
                <span className={`player-disc ${color}`} aria-hidden="true">{color === 'blue' ? 'W' : 'S'}</span>
                <span className="player-name">{labelColor(color)}</span>
                {started && turn === color && !finished && <span className={`player-turn ${color}`}>Am Zug</span>}
                {finished && winner === color && <span className="status-pill won">Sieger</span>}
              </div>
              {advantage > 0 && <strong className="material-advantage" aria-label={`${labelColor(color)} führt mit ${advantage} Punkten`}>+{advantage}</strong>}
            </div>
            <div className="captured-row" aria-label={`Netto geschlagene Figuren von ${labelColor(color)}`} data-testid={`captured-${view}-${labelColor(color).toLowerCase()}`}>
              {net[color].length ? net[color].map((piece, index) => (
                <span className={`captured-piece ${piece.color}`} key={`${piece.id}-${index}`} title={`${labelColor(piece.color)} ${pieceNames[piece.type]}`} aria-label={`${labelColor(piece.color)} ${pieceNames[piece.type]}`}>
                  <img src={`/images/pieces/${piece.type}-${piece.color === 'blue' ? 'white' : 'black'}.png`} alt="" />
                </span>
              )) : <span className="empty-captured">–</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function App() {
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalDestinations, setLegalDestinations] = useState<Square[]>([]);
  const [dragFrom, setDragFrom] = useState<Square | null>(null);
  const [started, setStarted] = useState(false);
  const [drawOffer, setDrawOffer] = useState<PlayerColor | null>(null);
  const [takebackOffer, setTakebackOffer] = useState<PlayerColor | null>(null);
  const [resigning, setResigning] = useState<PlayerColor | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square; color: PlayerColor } | null>(null);
  const [timeControl, setTimeControl] = useState<TimeControl | null>(null);
  const [clockTimes, setClockTimes] = useState<ClockTimes>({ blue: 0, red: 0 });
  const clockTimesRef = useRef(clockTimes);
  const [clockSnapshots, setClockSnapshots] = useState<ClockTimes[]>([]);
  const [clockDialogOpen, setClockDialogOpen] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState(5);
  const [draftIncrement, setDraftIncrement] = useState(0);
  const updateClockTimes = useCallback((next: ClockTimes) => {
    clockTimesRef.current = next;
    setClockTimes(next);
  }, []);

  const legalKeys = useMemo(() => new Set(legalDestinations.map(squareKey)), [legalDestinations]);
  const history = game.history;
  const capturedPieces = useMemo(() => {
    const captured = { blue: [] as Piece[], red: [] as Piece[] };
    for (const move of history) if (move.captured) captured[move.piece.color].push(move.captured);
    return captured;
  }, [history]);
  const material = useMemo(() => {
    const totals: Record<PlayerColor, number> = {
      blue: capturedPieces.blue.reduce((sum, piece) => sum + pieceValues[piece.type], 0),
      red: capturedPieces.red.reduce((sum, piece) => sum + pieceValues[piece.type], 0),
    };
    const net: Record<PlayerColor, Piece[]> = { blue: [], red: [] };
    for (const color of ['blue', 'red'] as PlayerColor[]) {
      const other = opposite(color);
      for (const type of materialOrder) {
        const ownCount = capturedPieces[color].filter((piece) => piece.type === type).length;
        const otherCount = capturedPieces[other].filter((piece) => piece.type === type).length;
        if (ownCount > otherCount) {
          net[color].push(...capturedPieces[color].filter((piece) => piece.type === type).slice(0, ownCount - otherCount));
        }
      }
    }
    return { totals, net, difference: totals.blue - totals.red };
  }, [capturedPieces]);
  const currentNumber = Math.floor(history.length / 2) + 1;
  const lastMove = game.lastMove;
  const finished = game.status !== 'playing';
  const locked = !started || finished || !!drawOffer || !!takebackOffer || !!promotion;

  useEffect(() => {
    if (!timeControl || !started || finished || drawOffer || takebackOffer || resigning || clockDialogOpen) return;
    const activeColor = game.turn;
    let lastTick = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick;
      lastTick = now;
      const current = clockTimesRef.current;
      const nextTime = Math.max(0, current[activeColor] - elapsed);
      updateClockTimes({ ...current, [activeColor]: nextTime });
      if (nextTime === 0) {
        window.clearInterval(interval);
        setGame((state) => timeoutGame(state, activeColor));
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, [timeControl, started, finished, game.turn, drawOffer, takebackOffer, resigning, clockDialogOpen, updateClockTimes]);

  const finishMove = useCallback((from: Square, to: Square, chosen?: Exclude<PieceType, 'king' | 'soldier'>) => {
    if (timeControl) {
      const beforeMove = { ...clockTimesRef.current };
      setClockSnapshots((snapshots) => [...snapshots, beforeMove]);
      updateClockTimes({
        ...beforeMove,
        [game.turn]: beforeMove[game.turn] + timeControl.incrementSeconds * 1000,
      });
    }
    setUndoStack((previous) => [...previous, game]);
    setGame(makeMove(game, from, to, chosen));
    setSelected(null);
    setLegalDestinations([]);
    setPromotion(null);
  }, [game, timeControl, updateClockTimes]);

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
    setTakebackOffer(null);
    setPromotion(null);
    setResigning(null);
    setClockSnapshots([]);
    updateClockTimes(timeControl
      ? { blue: timeControl.initialMinutes * 60_000, red: timeControl.initialMinutes * 60_000 }
      : { blue: 0, red: 0 });
    setStarted(true);
  };

  const acceptTakeback = () => {
    if (!takebackOffer || !undoStack.length) return;
    setGame(undoStack[undoStack.length - 1]!);
    setUndoStack((stack) => stack.slice(0, -1));
    const clockBeforeLastMove = clockSnapshots[clockSnapshots.length - 1];
    if (clockBeforeLastMove && timeControl) updateClockTimes({ ...clockBeforeLastMove });
    setClockSnapshots((snapshots) => snapshots.slice(0, -1));
    setTakebackOffer(null);
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

  const openClockSettings = () => {
    setDraftMinutes(timeControl?.initialMinutes ?? 5);
    setDraftIncrement(timeControl?.incrementSeconds ?? 0);
    setClockDialogOpen(true);
  };

  const applyClockSettings = () => {
    const nextControl = { initialMinutes: draftMinutes, incrementSeconds: draftIncrement };
    setTimeControl(nextControl);
    updateClockTimes({
      blue: nextControl.initialMinutes * 60_000,
      red: nextControl.initialMinutes * 60_000,
    });
    setClockSnapshots([]);
    setClockDialogOpen(false);
  };

  const removeClock = () => {
    setTimeControl(null);
    updateClockTimes({ blue: 0, red: 0 });
    setClockSnapshots([]);
    setClockDialogOpen(false);
  };

  const actionBar = (color: PlayerColor, position: 'upper' | 'lower') => {
    const active = started && !finished && game.turn === color && !drawOffer && !takebackOffer && !promotion;
    const canRequestTakeback = started && !finished && game.turn !== color &&
      game.lastMove?.piece.color === color && undoStack.length > 0 &&
      !drawOffer && !takebackOffer && !promotion;
    return (
      <div className={`player-actions ${position} ${color}`} data-testid={`actions-${labelColor(color).toLowerCase()}`}>
        <div className="action-player">
          <span className={`side-mark ${color}`} aria-hidden="true" />
          <div><strong>{labelColor(color)}</strong><small>{active ? 'Am Zug' : position === 'upper' ? 'Gegenüber' : 'Deine Seite'}</small></div>
          {timeControl && <span className={`clock-readout ${game.turn === color ? 'clock-active' : ''}`} data-testid={`clock-${labelColor(color).toLowerCase()}`}>{formatClock(clockTimes[color])}</span>}
        </div>
        <div className="action-buttons">
          <button type="button" className="action-button draw-button" onClick={() => setDrawOffer(color)} disabled={!active} data-testid={`button-draw-${labelColor(color).toLowerCase()}`} aria-label={`${labelColor(color)} bietet Remis an`}>
            <span className="half-symbol" aria-hidden="true">½</span><span>Remis</span>
          </button>
          <button type="button" className="action-button resign-button" onClick={() => setResigning(color)} disabled={!active} data-testid={`button-resign-${labelColor(color).toLowerCase()}`}>
            <Flag size={15} aria-hidden="true" /><span>Aufgeben</span>
          </button>
          <button type="button" className="action-button takeback-button" onClick={() => setTakebackOffer(color)} disabled={!canRequestTakeback} data-testid={`button-takeback-${labelColor(color).toLowerCase()}`} aria-label={`${labelColor(color)} bittet um Zurücknahme des letzten Zugs`} title="Letzten Zug zurücknehmen lassen">
            <TakebackArrow /><span>Zurücknahme</span>
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
            <button className="quiet-button" onClick={restart} data-testid="button-restart" aria-label="Neue Partie starten"><RotateCcw size={14} /><span>Neue Partie</span></button>
          </div>
        </header>

        <section className="intro-row" aria-label="Partie">
          <div><div className="eyebrow">Zu zweit am selben Brett</div><h1 className="title">{!started ? 'Ein Brett. Zwei Perspektiven.' : finished ? statusCopy(game) : 'Das Brett ist bereit.'}</h1></div>
          <div className="match-meta">ZEITKONTROLLE<strong>{timeControl ? `${timeControl.initialMinutes} Min. + ${timeControl.incrementSeconds} Sek./Zug` : 'Ohne Zeitlimit'}</strong></div>
        </section>

        <div className="game-layout">
          <section className="board-column" aria-label="Spielbrett">
            <div className="turn-banner" role="status" aria-live="polite" data-testid="status-turn">
              <div className="turn-info"><span className={`turn-dot ${game.turn}`} aria-hidden="true" /><div><div className="turn-label">{finished ? statusCopy(game) : !started ? 'Bereit für den ersten Zug' : `${labelColor(game.turn)} ist am Zug`}</div><div className="turn-caption">{finished ? 'Partie beendet' : game.checkedPlayer ? 'Der König ist bedroht' : !started ? 'Startet die Partie gemeinsam' : 'Figur wählen, um zu ziehen'}</div></div></div>
              <div className="turn-tools">
                <button type="button" className="clock-settings-button" onClick={openClockSettings} disabled={finished} data-testid="button-clock-settings" aria-label="Zeitbeschränkung einstellen">
                  <Clock size={15} aria-hidden="true" /><span>{timeControl ? `${timeControl.initialMinutes}+${timeControl.incrementSeconds}` : 'Uhr'}</span>
                </button>
                <span className={`turn-chip ${game.checkedPlayer || finished ? 'alert' : ''}`}>{game.checkedPlayer ? 'Schess' : finished ? 'Ende' : `Zug ${currentNumber}`}</span>
              </div>
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
                      <span className="half-image-title">{winnerMode ? `${labelColor(game.winner!)} gewinnt` : labelColor(color)}</span>
                      {lost && <span className="sr-only">Verlierer</span>}
                    </div>;
                  })}
                </div>
              )}
              {drawOffer && (
                <div className={`draw-overlay ${drawOffer === 'blue' ? 'to-black' : 'to-white'}`} role="dialog" aria-modal="true" aria-labelledby="draw-title" data-testid="dialog-draw-offer">
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
              {takebackOffer && (
                <div className={`draw-overlay takeback-overlay ${takebackOffer === 'blue' ? 'to-black' : 'to-white'}`} role="dialog" aria-modal="true" aria-labelledby="takeback-title" data-testid="dialog-takeback">
                  <div className="draw-message">
                    <span className="takeback-emblem"><TakebackArrow /></span>
                    <p className="draw-overline">{labelColor(opposite(takebackOffer))}, dein Gegenüber fragt</p>
                    <h2 id="takeback-title">Zug zurücknehmen?</h2>
                    <p>{labelColor(takebackOffer)} möchte den letzten Zug rückgängig machen.</p>
                    <div className="draw-actions">
                      <button type="button" className="confirm-button" onClick={acceptTakeback} data-testid="button-takeback-accept"><Check size={16} /> Annehmen</button>
                      <button type="button" className="decline-button" onClick={() => setTakebackOffer(null)} data-testid="button-takeback-decline"><X size={16} /> Ablehnen</button>
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
            <div className="side-perspective black-perspective" aria-label="Anzeige für Schwarz">
              <CapturedPanel perspective="red" net={material.net} turn={game.turn} started={started} finished={finished} winner={game.winner} materialDifference={material.difference} />
            </div>
            <div className="side-perspective white-perspective" aria-label="Anzeige für Weiß">
              <CapturedPanel perspective="blue" net={material.net} turn={game.turn} started={started} finished={finished} winner={game.winner} materialDifference={material.difference} />
            </div>
          </aside>
        </div>
        <footer className="footer-note">Ein Brett · Zwei Spieler · {timeControl ? 'Zeit läuft' : 'Ohne Zeitdruck'}</footer>
      </div>

      {clockDialogOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="clock-title" data-testid="dialog-clock-settings">
        <section className="clock-dialog">
          <button type="button" className="clock-close" aria-label="Schließen" onClick={() => setClockDialogOpen(false)}><X size={18} /></button>
          <span className="clock-dialog-icon"><Clock size={20} /></span>
          <span className="eyebrow">Zeitkontrolle für beide Spieler</span>
          <h2 id="clock-title">Zeitbeschränkung</h2>
          <label className="clock-minutes-label" htmlFor="clock-minutes">Zeit von Beginn an</label>
          <div className="clock-minute-input"><input id="clock-minutes" type="number" min={1} max={100} value={draftMinutes} onChange={(event) => setDraftMinutes(Math.max(1, Math.min(100, Number(event.currentTarget.value) || 1)))} data-testid="input-clock-minutes" /><span>Minuten</span></div>
          <div className="clock-presets" aria-label="Häufig genutzte Zeiten">
            {timePresets.map((preset) => <button type="button" key={preset.minutes} className={`clock-preset ${draftMinutes === preset.minutes ? 'selected' : ''}`} onClick={() => setDraftMinutes(preset.minutes)} aria-label={`${preset.minutes} Minuten, ${preset.name}`} data-testid={`preset-clock-${preset.minutes}`}>
              <strong>{preset.minutes}</strong><span aria-hidden="true">{preset.symbol}</span>
            </button>)}
          </div>
          <label className="clock-increment-label" htmlFor="clock-increment">Extrazeit pro Zug <strong>{draftIncrement} Sek.</strong></label>
          <input id="clock-increment" className="clock-slider" type="range" min={0} max={10} step={1} value={draftIncrement} onChange={(event) => setDraftIncrement(Number(event.currentTarget.value))} data-testid="slider-clock-increment" />
          <div className="clock-range-labels"><span>0 Sek.</span><span>10 Sek.</span></div>
          <div className="clock-dialog-actions">
            <button type="button" className="no-clock-button" onClick={removeClock} data-testid="button-no-clock">Keine Zeitbeschränkung</button>
            <button type="button" className="confirm-clock-button" onClick={applyClockSettings} data-testid="button-set-clock">Zeitbeschränkung einstellen</button>
          </div>
        </section>
      </div>}

      {promotion && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="promotion-title" data-testid="dialog-promotion">
        <div className={`promotion-dialog ${promotion.color === 'red' ? 'black-facing' : ''}`}><span className="eyebrow">Bauer auf der letzten Reihe</span><h2 id="promotion-title">Wähle eine Beförderung</h2><p>Deine Figur wird erst nach der Auswahl aufgewertet.</p>
          <div className="promotion-options">{PROMOTION_TYPES.map((type) => <button type="button" className="promotion-option" key={type} onClick={() => finishMove(promotion.from, promotion.to, type)} data-testid={`button-promote-${type}`}>
            <img src={`/images/pieces/${type}-${promotion.color === 'blue' ? 'white' : 'black'}.png`} alt="" /><span>{pieceNames[type]}</span>
          </button>)}</div>
        </div>
      </div>}

      {resigning && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="resign-title" data-testid="dialog-resign">
        <div className={`confirm-dialog ${resigning === 'red' ? 'black-facing' : ''}`}><div className="confirm-icon"><Flag size={20} /></div><span className="eyebrow">{labelColor(resigning)} gibt auf</span><h2 id="resign-title">{labelColor(resigning)}, willst du wirklich aufgeben?</h2><p>Die Partie endet sofort. {labelColor(opposite(resigning))} gewinnt.</p>
          <div className="confirm-actions"><button type="button" className="decline-button" onClick={() => setResigning(null)} data-testid="button-resign-cancel">Abbrechen</button><button type="button" className="danger-button" onClick={actOnResignation} data-testid="button-resign-confirm">Aufgeben</button></div>
        </div>
      </div>}
    </main>
  );
}

export default App;
