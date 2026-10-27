export type PlayerColor = 'blue' | 'red';

export type PieceType =
  | 'tank'
  | 'aircraft'
  | 'artillery'
  | 'general'
  | 'king'
  | 'soldier';

export interface Square {
  file: number;
  rank: number;
}

export interface Piece {
  id: string;
  color: PlayerColor;
  type: PieceType;
}

export type Board = (Piece | null)[][];

export interface MoveRecord {
  piece: Piece;
  from: Square;
  to: Square;
  captured: Piece | null;
  special?: 'double-step' | 'en-passant' | 'bunker';
  promotion?: Exclude<PieceType, 'king' | 'soldier'>;
}

export interface EnPassantOpportunity {
  target: Square;
  capturedSoldier: Square;
  eligibleColor: PlayerColor;
}

export type DrawReason =
  | 'stalemate'
  | 'agreement'
  | 'repetition'
  | 'fifty-move'
  | 'insufficient-material';

export type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'king-captured'
  | 'resignation'
  | 'timeout'
  | 'draw';

export interface GameState {
  board: Board;
  turn: PlayerColor;
  status: GameStatus;
  winner: PlayerColor | null;
  drawReason: DrawReason | null;
  checkedPlayer: PlayerColor | null;
  lastMove: MoveRecord | null;
  history: MoveRecord[];
  movedPieceIds: string[];
  enPassant: EnPassantOpportunity | null;
  halfMoveClock: number;
  positionHistory: string[];
}

const BOARD_SIZE = 8;

export const PROMOTION_TYPES: Exclude<PieceType, 'king' | 'soldier'>[] = [
  'general',
  'tank',
  'aircraft',
  'artillery',
];

const DIRECTIONS = {
  orthogonal: [
    { file: 1, rank: 0 },
    { file: -1, rank: 0 },
    { file: 0, rank: 1 },
    { file: 0, rank: -1 },
  ],
  diagonal: [
    { file: 1, rank: 1 },
    { file: 1, rank: -1 },
    { file: -1, rank: 1 },
    { file: -1, rank: -1 },
  ],
  all: [
    { file: 1, rank: 0 },
    { file: -1, rank: 0 },
    { file: 0, rank: 1 },
    { file: 0, rank: -1 },
    { file: 1, rank: 1 },
    { file: 1, rank: -1 },
    { file: -1, rank: 1 },
    { file: -1, rank: -1 },
  ],
} as const;

const INSIDE_BOARD = ({ file, rank }: Square) =>
  file >= 0 && file < BOARD_SIZE && rank >= 0 && rank < BOARD_SIZE;

const sameSquare = (first: Square, second: Square) =>
  first.file === second.file && first.rank === second.rank;

const otherColor = (color: PlayerColor): PlayerColor =>
  color === 'blue' ? 'red' : 'blue';

const cloneBoard = (board: Board): Board =>
  board.map((row) => row.slice());

function positionSignature(state: GameState): string {
  const pieces = state.board
    .flatMap((row, rank) =>
      row.map((piece, file) =>
        piece ? `${piece.color[0]}:${piece.type}:${file},${rank}` : '',
      ),
    )
    .filter(Boolean)
    .join(',');
  const originalKingAndTankIds = [
    'blue-king-4-0',
    'blue-tank-0-0',
    'blue-tank-7-0',
    'red-king-4-7',
    'red-tank-0-7',
    'red-tank-7-7',
  ];
  const bunkerRights = originalKingAndTankIds
    .map((id) => (state.movedPieceIds.includes(id) ? '1' : '0'))
    .join('');
  const enPassant = state.enPassant
    ? `${state.enPassant.eligibleColor}:${state.enPassant.target.file},${state.enPassant.target.rank}`
    : '-';
  return `${pieces}|${state.turn}|${bunkerRights}|${enPassant}`;
}

function place(
  board: Board,
  color: PlayerColor,
  type: PieceType,
  file: number,
  rank: number,
) {
  board[rank]![file] = { id: `${color}-${type}-${file}-${rank}`, color, type };
}

export function createInitialState(): GameState {
  const board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
  const backRank: PieceType[] = [
    'tank',
    'aircraft',
    'artillery',
    'general',
    'king',
    'artillery',
    'aircraft',
    'tank',
  ];

  for (let file = 0; file < BOARD_SIZE; file += 1) {
    place(board, 'blue', backRank[file]!, file, 0);
    place(board, 'red', backRank[file]!, file, 7);
    place(board, 'blue', 'soldier', file, 1);
    place(board, 'red', 'soldier', file, 6);
  }

  const state: GameState = {
    board,
    turn: 'blue',
    status: 'playing',
    winner: null,
    drawReason: null,
    checkedPlayer: null,
    lastMove: null,
    history: [],
    movedPieceIds: [],
    enPassant: null,
    halfMoveClock: 0,
    positionHistory: [],
  };
  state.positionHistory = [positionSignature(state)];
  return state;
}

function findKing(board: Board, color: PlayerColor): Square | null {
  for (let rank = 0; rank < BOARD_SIZE; rank += 1) {
    for (let file = 0; file < BOARD_SIZE; file += 1) {
      const piece = board[rank]![file];
      if (piece?.color === color && piece.type === 'king') {
        return { file, rank };
      }
    }
  }
  return null;
}

function addIfAvailable(
  board: Board,
  piece: Piece,
  moves: Square[],
  target: Square,
) {
  if (!INSIDE_BOARD(target)) return;
  const occupant = board[target.rank]![target.file];
  if (!occupant || occupant.color !== piece.color) moves.push(target);
}

function slidingMoves(
  board: Board,
  piece: Piece,
  from: Square,
  directions: readonly { file: number; rank: number }[],
  attacksOnly = false,
): Square[] {
  const moves: Square[] = [];
  for (const direction of directions) {
    let file = from.file + direction.file;
    let rank = from.rank + direction.rank;
    while (INSIDE_BOARD({ file, rank })) {
      const target = { file, rank };
      const occupant = board[rank]![file];
      if (attacksOnly) {
        // The first occupied square is defended too, even when it contains a
        // friendly piece. This matters when a king considers capturing it.
        moves.push(target);
      } else if (!occupant || occupant.color !== piece.color) {
        moves.push(target);
      }
      if (occupant) break;
      file += direction.file;
      rank += direction.rank;
    }
  }
  return moves;
}

function getPieceAttacks(
  board: Board,
  piece: Piece,
  from: Square,
): Square[] {
  switch (piece.type) {
    case 'tank':
      return slidingMoves(board, piece, from, DIRECTIONS.orthogonal, true);
    case 'artillery':
      return slidingMoves(board, piece, from, DIRECTIONS.diagonal, true);
    case 'general':
      return slidingMoves(board, piece, from, DIRECTIONS.all, true);
    case 'aircraft': {
      const jumps = [
        { file: 1, rank: 2 },
        { file: 2, rank: 1 },
        { file: 2, rank: -1 },
        { file: 1, rank: -2 },
        { file: -1, rank: -2 },
        { file: -2, rank: -1 },
        { file: -2, rank: 1 },
        { file: -1, rank: 2 },
      ];
      return jumps
        .map(({ file, rank }) => ({
          file: from.file + file,
          rank: from.rank + rank,
        }))
        .filter(INSIDE_BOARD);
    }
    case 'king':
      return DIRECTIONS.all
        .map(({ file, rank }) => ({
          file: from.file + file,
          rank: from.rank + rank,
        }))
        .filter(INSIDE_BOARD);
    case 'soldier': {
      const direction = piece.color === 'blue' ? 1 : -1;
      return [-1, 1]
        .map((fileOffset) => ({
          file: from.file + fileOffset,
          rank: from.rank + direction,
        }))
        .filter(INSIDE_BOARD);
    }
  }
}

function attackersOf(board: Board, target: Square, byColor: PlayerColor) {
  const attackers: { piece: Piece; square: Square }[] = [];
  for (let rank = 0; rank < BOARD_SIZE; rank += 1) {
    for (let file = 0; file < BOARD_SIZE; file += 1) {
      const piece = board[rank]![file];
      if (!piece || piece.color !== byColor) continue;
      const square = { file, rank };
      if (
        getPieceAttacks(board, piece, square).some((move) =>
          sameSquare(move, target),
        )
      ) {
        attackers.push({ piece, square });
      }
    }
  }
  return attackers;
}

export function isInCheck(board: Board, color: PlayerColor): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  return attackersOf(board, king, otherColor(color)).length > 0;
}

function pseudoMoves(
  state: GameState,
  board: Board,
  piece: Piece,
  from: Square,
): Square[] {
  switch (piece.type) {
    case 'tank':
      return slidingMoves(board, piece, from, DIRECTIONS.orthogonal);
    case 'artillery':
      return slidingMoves(board, piece, from, DIRECTIONS.diagonal);
    case 'general':
      return slidingMoves(board, piece, from, DIRECTIONS.all);
    case 'aircraft': {
      const jumps = [
        { file: 1, rank: 2 },
        { file: 2, rank: 1 },
        { file: 2, rank: -1 },
        { file: 1, rank: -2 },
        { file: -1, rank: -2 },
        { file: -2, rank: -1 },
        { file: -2, rank: 1 },
        { file: -1, rank: 2 },
      ];
      const moves: Square[] = [];
      for (const jump of jumps) {
        addIfAvailable(board, piece, moves, {
          file: from.file + jump.file,
          rank: from.rank + jump.rank,
        });
      }
      return moves;
    }
    case 'king': {
      const moves: Square[] = [];
      for (const direction of DIRECTIONS.all) {
        addIfAvailable(board, piece, moves, {
          file: from.file + direction.file,
          rank: from.rank + direction.rank,
        });
      }
      moves.push(...getBunkerMoves(state, piece, from));
      return moves;
    }
    case 'soldier': {
      const moves: Square[] = [];
      const direction = piece.color === 'blue' ? 1 : -1;
      const forward = { file: from.file, rank: from.rank + direction };
      if (INSIDE_BOARD(forward) && !board[forward.rank]![forward.file]) {
        moves.push(forward);
        const startingRank = piece.color === 'blue' ? 1 : 6;
        const twoForward = { file: from.file, rank: from.rank + 2 * direction };
        if (
          from.rank === startingRank &&
          INSIDE_BOARD(twoForward) &&
          !board[twoForward.rank]![twoForward.file]
        ) {
          moves.push(twoForward);
        }
      }
      for (const fileOffset of [-1, 1]) {
        const target = {
          file: from.file + fileOffset,
          rank: from.rank + direction,
        };
        if (!INSIDE_BOARD(target)) continue;
        const occupant = board[target.rank]![target.file];
        if (occupant && occupant.color !== piece.color) moves.push(target);
        else if (
          !occupant &&
          state.enPassant?.eligibleColor === piece.color &&
          sameSquare(state.enPassant.target, target)
        ) {
          const victim = board[state.enPassant.capturedSoldier.rank]?.[
            state.enPassant.capturedSoldier.file
          ];
          if (victim?.color !== piece.color && victim?.type === 'soldier') {
            moves.push(target);
          }
        }
      }
      return moves;
    }
  }
}

type SpecialMove =
  | { type: 'bunker'; tankFrom: Square }
  | { type: 'en-passant'; capturedSoldier: Square }
  | { type: 'double-step' };

function specialMoveFor(
  state: GameState,
  piece: Piece,
  from: Square,
  to: Square,
): SpecialMove | null {
  if (piece.type === 'king' && Math.abs(to.file - from.file) === 2) {
    return {
      type: 'bunker',
      tankFrom: { file: to.file < from.file ? 0 : BOARD_SIZE - 1, rank: from.rank },
    };
  }
  if (
    piece.type === 'soldier' &&
    from.file !== to.file &&
    !state.board[to.rank]![to.file] &&
    state.enPassant?.eligibleColor === piece.color &&
    sameSquare(state.enPassant.target, to)
  ) {
    return { type: 'en-passant', capturedSoldier: state.enPassant.capturedSoldier };
  }
  if (piece.type === 'soldier' && Math.abs(to.rank - from.rank) === 2) {
    return { type: 'double-step' };
  }
  return null;
}

function boardAfterMove(
  board: Board,
  from: Square,
  to: Square,
  special: SpecialMove | null = null,
): Board {
  const nextBoard = cloneBoard(board);
  nextBoard[to.rank]![to.file] = nextBoard[from.rank]![from.file]!;
  nextBoard[from.rank]![from.file] = null;
  if (special?.type === 'bunker') {
    const tank = nextBoard[special.tankFrom.rank]![special.tankFrom.file];
    nextBoard[special.tankFrom.rank]![special.tankFrom.file] = null;
    nextBoard[from.rank]![from.file + Math.sign(to.file - from.file)] = tank;
  } else if (special?.type === 'en-passant') {
    nextBoard[special.capturedSoldier.rank]![special.capturedSoldier.file] = null;
  }
  return nextBoard;
}

function getBunkerMoves(state: GameState, king: Piece, from: Square): Square[] {
  if (king.type !== 'king' || state.movedPieceIds.includes(king.id)) return [];
  const moves: Square[] = [];
  for (const tankFile of [0, BOARD_SIZE - 1]) {
    const tankSquare = { file: tankFile, rank: from.rank };
    const tank = state.board[tankSquare.rank]![tankSquare.file];
    if (
      tank?.color !== king.color ||
      tank.type !== 'tank' ||
      state.movedPieceIds.includes(tank.id)
    ) {
      continue;
    }
    const direction = Math.sign(tankFile - from.file);
    if (!direction) continue;
    let clear = true;
    for (let file = from.file + direction; file !== tankFile; file += direction) {
      if (state.board[from.rank]![file]) {
        clear = false;
        break;
      }
    }
    const target = { file: from.file + 2 * direction, rank: from.rank };
    if (clear && INSIDE_BOARD(target)) moves.push(target);
  }
  return moves;
}

function canBunkerSafely(
  state: GameState,
  from: Square,
  to: Square,
  special: SpecialMove | null,
): boolean {
  if (special?.type !== 'bunker') return true;
  const king = state.board[from.rank]![from.file];
  if (!king || isInCheck(state.board, king.color)) return false;
  const transit = { file: from.file + Math.sign(to.file - from.file), rank: from.rank };
  const transitBoard = boardAfterMove(state.board, from, transit);
  if (isInCheck(transitBoard, king.color)) return false;
  return !isInCheck(boardAfterMove(state.board, from, to, special), king.color);
}

function isBetween(
  point: Square,
  attacker: Square,
  king: Square,
): boolean {
  const fileDelta = king.file - attacker.file;
  const rankDelta = king.rank - attacker.rank;
  const isOrthogonal = fileDelta === 0 || rankDelta === 0;
  const isDiagonal = Math.abs(fileDelta) === Math.abs(rankDelta);
  if (!isOrthogonal && !isDiagonal) return false;
  const stepFile = Math.sign(fileDelta);
  const stepRank = Math.sign(rankDelta);
  let file = attacker.file + stepFile;
  let rank = attacker.rank + stepRank;
  while (file !== king.file || rank !== king.rank) {
    if (file === point.file && rank === point.rank) return true;
    file += stepFile;
    rank += stepRank;
  }
  return false;
}

export function getLegalMoves(state: GameState, from: Square): Square[] {
  if (state.status !== 'playing' || !INSIDE_BOARD(from)) return [];
  const piece = state.board[from.rank]![from.file];
  if (!piece || piece.color !== state.turn) return [];

  const king = findKing(state.board, piece.color);
  if (!king) return [];
  const checkers = attackersOf(
    state.board,
    king,
    otherColor(piece.color),
  );

  return pseudoMoves(state, state.board, piece, from).filter((to) => {
    // With two or more simultaneous attackers, only the king may move.
    if (checkers.length > 1 && piece.type !== 'king') return false;

    const special = specialMoveFor(state, piece, from, to);
    if (!canBunkerSafely(state, from, to, special)) return false;
    const nextBoard = boardAfterMove(state.board, from, to, special);
    const nextKing =
      piece.type === 'king' ? to : findKing(nextBoard, piece.color);
    if (!nextKing || isInCheck(nextBoard, piece.color)) return false;

    // When the king is checked by one piece, a non-king response must capture
    // that attacker or interpose on a sliding attack. Aircraft cannot be blocked.
    if (checkers.length === 1 && piece.type !== 'king') {
      const checker = checkers[0]!;
      const capturesChecker = sameSquare(to, checker.square);
      const isSlider =
        checker.piece.type === 'tank' ||
        checker.piece.type === 'artillery' ||
        checker.piece.type === 'general';
      const blocksSlider =
        isSlider && isBetween(to, checker.square, king);
      const capturesEnPassantChecker =
        special?.type === 'en-passant' &&
        sameSquare(special.capturedSoldier, checker.square);
      if (!capturesChecker && !capturesEnPassantChecker && !blocksSlider) return false;
    }

    return true;
  });
}

function allLegalMoves(state: GameState, color: PlayerColor) {
  const currentTurn = state.turn;
  const sideState =
    currentTurn === color ? state : { ...state, turn: color };
  const moves: { from: Square; to: Square }[] = [];
  for (let rank = 0; rank < BOARD_SIZE; rank += 1) {
    for (let file = 0; file < BOARD_SIZE; file += 1) {
      const piece = state.board[rank]![file];
      if (!piece || piece.color !== color) continue;
      for (const to of getLegalMoves(sideState, { file, rank })) {
        moves.push({ from: { file, rank }, to });
      }
    }
  }
  return moves;
}

function hasThreefoldRepetition(positionHistory: string[]): boolean {
  const latestIndex = positionHistory.length - 1;
  const current = positionHistory[latestIndex];
  if (!current) return false;
  const occurrences = positionHistory.flatMap((position, index) =>
    position === current ? [index] : [],
  );
  if (occurrences.length < 3) return false;
  const lastThree = occurrences.slice(-3);
  const firstGap = lastThree[1]! - lastThree[0]!;
  const secondGap = lastThree[2]! - lastThree[1]!;
  // Equal gaps of 2–10 half-moves mean one to five complete rounds.
  return firstGap === secondGap && firstGap >= 2 && firstGap <= 10;
}

function isInsufficientMaterial(board: Board): boolean {
  const remaining = board.flat().filter((piece): piece is Piece => !!piece);
  if (remaining.some((piece) =>
    piece.type === 'soldier' || piece.type === 'tank' || piece.type === 'general',
  )) {
    return false;
  }
  const nonKings = remaining.filter((piece) => piece.type !== 'king');
  return nonKings.length === 2 && nonKings.every((piece) => piece.type === 'aircraft');
}

function finishAsDraw(state: GameState, drawReason: DrawReason): GameState {
  return {
    ...state,
    status: 'draw',
    drawReason,
    winner: null,
    checkedPlayer: null,
  };
}

export function acceptDraw(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  return finishAsDraw(state, 'agreement');
}

export function resignGame(state: GameState, resigningPlayer: PlayerColor): GameState {
  if (state.status !== 'playing') return state;
  return {
    ...state,
    status: 'resignation',
    drawReason: null,
    winner: otherColor(resigningPlayer),
    checkedPlayer: null,
  };
}

export function timeoutGame(state: GameState, timedOutPlayer: PlayerColor): GameState {
  if (state.status !== 'playing' || state.turn !== timedOutPlayer) return state;
  return {
    ...state,
    status: 'timeout',
    drawReason: null,
    winner: otherColor(timedOutPlayer),
    checkedPlayer: null,
  };
}

export function makeMove(
  state: GameState,
  from: Square,
  to: Square,
  promotion?: Exclude<PieceType, 'king' | 'soldier'>,
): GameState {
  if (state.status !== 'playing') return state;
  const piece = INSIDE_BOARD(from)
    ? state.board[from.rank]![from.file]
    : null;
  if (
    !piece ||
    piece.color !== state.turn ||
    !getLegalMoves(state, from).some((move) => sameSquare(move, to))
  ) {
    return state;
  }

  const targetPiece = state.board[to.rank]![to.file];
  const reachesLastRank =
    piece.type === 'soldier' &&
    ((piece.color === 'blue' && to.rank === BOARD_SIZE - 1) ||
      (piece.color === 'red' && to.rank === 0));
  const capturesKing = targetPiece?.type === 'king';
  if (reachesLastRank && !capturesKing && !promotion) return state;
  if ((!reachesLastRank || capturesKing) && promotion) return state;
  if (promotion && !PROMOTION_TYPES.includes(promotion)) return state;

  const special = specialMoveFor(state, piece, from, to);
  const captured =
    special?.type === 'en-passant'
      ? state.board[special.capturedSoldier.rank]![special.capturedSoldier.file]
      : state.board[to.rank]![to.file];
  const record: MoveRecord = {
    piece,
    from: { ...from },
    to: { ...to },
    captured,
    ...(special ? { special: special.type } : {}),
    ...(promotion ? { promotion } : {}),
  };
  const board = boardAfterMove(state.board, from, to, special);
  if (promotion) {
    board[to.rank]![to.file] = {
      id: `${piece.id}-promotion-${promotion}`,
      color: piece.color,
      type: promotion,
    };
  }

  if (captured?.type === 'king') {
    return {
      ...state,
      board,
      status: 'king-captured',
      winner: piece.color,
      drawReason: null,
      checkedPlayer: null,
      lastMove: record,
      history: [...state.history, record],
      movedPieceIds: state.movedPieceIds.includes(piece.id)
        ? state.movedPieceIds
        : [...state.movedPieceIds, piece.id],
    };
  }

  const nextTurn = otherColor(state.turn);
  const checkedPlayer = isInCheck(board, nextTurn) ? nextTurn : null;
  const enPassant =
    special?.type === 'double-step'
      ? {
          target: { file: to.file, rank: (from.rank + to.rank) / 2 },
          capturedSoldier: { ...to },
          eligibleColor: nextTurn,
        }
      : null;
  const nextState: GameState = {
    ...state,
    board,
    turn: nextTurn,
    status: 'playing',
    winner: null,
    drawReason: null,
    checkedPlayer,
    lastMove: record,
    history: [...state.history, record],
    movedPieceIds: state.movedPieceIds.includes(piece.id)
      ? state.movedPieceIds
      : [...state.movedPieceIds, piece.id],
    enPassant,
    halfMoveClock: captured || promotion ? 0 : state.halfMoveClock + 1,
  };
  nextState.positionHistory = [
    ...state.positionHistory,
    positionSignature(nextState),
  ];
  const hasMoves = allLegalMoves(nextState, nextTurn).length > 0;

  if (!hasMoves && checkedPlayer) {
    return {
      ...nextState,
      status: 'checkmate',
      winner: piece.color,
    };
  }
  if (!hasMoves) {
    return finishAsDraw(nextState, 'stalemate');
  }
  if (isInsufficientMaterial(board)) {
    return finishAsDraw(nextState, 'insufficient-material');
  }
  if (hasThreefoldRepetition(nextState.positionHistory)) {
    return finishAsDraw(nextState, 'repetition');
  }
  if (nextState.halfMoveClock >= 100) {
    return finishAsDraw(nextState, 'fifty-move');
  }
  return nextState;
}
