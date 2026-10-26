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
}

export type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'king-captured'
  | 'stalemate';

export interface GameState {
  board: Board;
  turn: PlayerColor;
  status: GameStatus;
  winner: PlayerColor | null;
  checkedPlayer: PlayerColor | null;
  lastMove: MoveRecord | null;
  history: MoveRecord[];
}

const BOARD_SIZE = 8;

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

  return {
    board,
    turn: 'blue',
    status: 'playing',
    winner: null,
    checkedPlayer: null,
    lastMove: null,
    history: [],
  };
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
      return moves;
    }
    case 'soldier': {
      const moves: Square[] = [];
      const direction = piece.color === 'blue' ? 1 : -1;
      const forward = { file: from.file, rank: from.rank + direction };
      if (INSIDE_BOARD(forward) && !board[forward.rank]![forward.file]) {
        moves.push(forward);
      }
      for (const fileOffset of [-1, 1]) {
        const target = {
          file: from.file + fileOffset,
          rank: from.rank + direction,
        };
        if (!INSIDE_BOARD(target)) continue;
        const occupant = board[target.rank]![target.file];
        if (occupant && occupant.color !== piece.color) moves.push(target);
      }
      return moves;
    }
  }
}

function boardAfterMove(
  board: Board,
  from: Square,
  to: Square,
): Board {
  const nextBoard = cloneBoard(board);
  nextBoard[to.rank]![to.file] = nextBoard[from.rank]![from.file]!;
  nextBoard[from.rank]![from.file] = null;
  return nextBoard;
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

  return pseudoMoves(state.board, piece, from).filter((to) => {
    // With two or more simultaneous attackers, only the king may move.
    if (checkers.length > 1 && piece.type !== 'king') return false;

    const nextBoard = boardAfterMove(state.board, from, to);
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
      if (!capturesChecker && !blocksSlider) return false;
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

export function makeMove(
  state: GameState,
  from: Square,
  to: Square,
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

  const captured = state.board[to.rank]![to.file];
  const record: MoveRecord = {
    piece,
    from: { ...from },
    to: { ...to },
    captured,
  };
  const board = boardAfterMove(state.board, from, to);

  if (captured?.type === 'king') {
    return {
      ...state,
      board,
      status: 'king-captured',
      winner: piece.color,
      checkedPlayer: null,
      lastMove: record,
      history: [...state.history, record],
    };
  }

  const nextTurn = otherColor(state.turn);
  const checkedPlayer = isInCheck(board, nextTurn) ? nextTurn : null;
  const nextState: GameState = {
    ...state,
    board,
    turn: nextTurn,
    status: 'playing',
    winner: null,
    checkedPlayer,
    lastMove: record,
    history: [...state.history, record],
  };
  const hasMoves = allLegalMoves(nextState, nextTurn).length > 0;

  if (!hasMoves && checkedPlayer) {
    return {
      ...nextState,
      status: 'checkmate',
      winner: piece.color,
    };
  }
  if (!hasMoves) {
    return { ...nextState, status: 'stalemate' };
  }
  return nextState;
}
