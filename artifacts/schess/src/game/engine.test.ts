import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptDraw,
  createInitialState,
  getLegalMoves,
  makeMove,
  resignGame,
  timeoutGame,
  type GameState,
  type PieceType,
  type PlayerColor,
  type Square,
} from './engine.ts';

const square = (file: number, rank: number): Square => ({ file, rank });

function blankState(turn: PlayerColor = 'blue'): GameState {
  const state = createInitialState();
  state.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  state.turn = turn;
  state.positionHistory = [];
  return state;
}

function put(
  state: GameState,
  color: PlayerColor,
  type: PieceType,
  file: number,
  rank: number,
) {
  state.board[rank]![file] = {
    id: `${color}-${type}-${file}-${rank}`,
    color,
    type,
  };
}

function hasMove(state: GameState, from: Square, to: Square) {
  return getLegalMoves(state, from).some(
    (move) => move.file === to.file && move.rank === to.rank,
  );
}

test('soldiers can double-step only from their start and en passant expires after one reply', () => {
  const initial = createInitialState();
  assert.equal(initial.board.flat().filter(Boolean).length, 32);
  assert(hasMove(initial, square(4, 1), square(4, 3)));
  const afterDouble = makeMove(initial, square(4, 1), square(4, 3));
  assert.deepEqual(afterDouble.enPassant?.target, square(4, 2));
  assert.equal(afterDouble.enPassant?.eligibleColor, 'red');

  const state = blankState('red');
  put(state, 'blue', 'king', 4, 0);
  put(state, 'red', 'king', 4, 7);
  put(state, 'blue', 'soldier', 4, 4);
  put(state, 'red', 'soldier', 3, 6);
  const redDouble = makeMove(state, square(3, 6), square(3, 4));
  assert(hasMove(redDouble, square(4, 4), square(3, 5)));
  const captured = makeMove(redDouble, square(4, 4), square(3, 5));
  assert.equal(captured.board[4]![3], null);
  assert.equal(captured.history.at(-1)?.captured?.color, 'red');
  assert.equal(captured.history.at(-1)?.special, 'en-passant');

  const expired = makeMove(redDouble, square(4, 0), square(4, 1));
  assert.equal(expired.enPassant, null);
});

test('bunker remains available with either tank and respects movement, path, and attack restrictions', () => {
  const state = blankState();
  put(state, 'blue', 'king', 4, 0);
  put(state, 'blue', 'tank', 0, 0);
  put(state, 'blue', 'tank', 7, 0);
  put(state, 'red', 'king', 4, 7);
  assert(hasMove(state, square(4, 0), square(2, 0)));
  assert(hasMove(state, square(4, 0), square(6, 0)));

  const left = makeMove(state, square(4, 0), square(2, 0));
  assert.equal(left.board[0]![2]?.type, 'king');
  assert.equal(left.board[0]![3]?.type, 'tank');
  assert.equal(left.board[0]![0], null);
  assert.equal(left.history.at(-1)?.special, 'bunker');

  const blocked = blankState();
  put(blocked, 'blue', 'king', 4, 0);
  put(blocked, 'blue', 'tank', 0, 0);
  put(blocked, 'blue', 'tank', 7, 0);
  put(blocked, 'blue', 'aircraft', 1, 0);
  put(blocked, 'red', 'king', 4, 7);
  assert(!hasMove(blocked, square(4, 0), square(2, 0)));
  assert(hasMove(blocked, square(4, 0), square(6, 0)));

  const movedTank = blankState();
  put(movedTank, 'blue', 'king', 4, 0);
  put(movedTank, 'blue', 'tank', 0, 0);
  put(movedTank, 'blue', 'tank', 7, 0);
  put(movedTank, 'red', 'king', 4, 7);
  movedTank.movedPieceIds.push('blue-tank-7-0');
  assert(!hasMove(movedTank, square(4, 0), square(6, 0)));
  assert(hasMove(movedTank, square(4, 0), square(2, 0)));
});

test('bunker is forbidden when the king is checked or crosses/lands on an attacked square', () => {
  const inCheck = blankState();
  put(inCheck, 'blue', 'king', 4, 0);
  put(inCheck, 'blue', 'tank', 0, 0);
  put(inCheck, 'blue', 'tank', 7, 0);
  put(inCheck, 'red', 'king', 0, 7);
  put(inCheck, 'red', 'tank', 4, 6);
  assert(!hasMove(inCheck, square(4, 0), square(2, 0)));

  const attackedTransit = blankState();
  put(attackedTransit, 'blue', 'king', 4, 0);
  put(attackedTransit, 'blue', 'tank', 0, 0);
  put(attackedTransit, 'blue', 'tank', 7, 0);
  put(attackedTransit, 'red', 'king', 0, 7);
  put(attackedTransit, 'red', 'tank', 5, 7);
  assert(!hasMove(attackedTransit, square(4, 0), square(6, 0)));

  const attackedLanding = blankState();
  put(attackedLanding, 'blue', 'king', 4, 0);
  put(attackedLanding, 'blue', 'tank', 0, 0);
  put(attackedLanding, 'blue', 'tank', 7, 0);
  put(attackedLanding, 'red', 'king', 0, 7);
  put(attackedLanding, 'red', 'tank', 6, 7);
  assert(!hasMove(attackedLanding, square(4, 0), square(6, 0)));
});

test('no legal move without Schess is a draw', () => {
  const state = blankState();
  state.turn = 'blue';
  put(state, 'blue', 'king', 5, 6);
  put(state, 'blue', 'general', 6, 5);
  put(state, 'blue', 'tank', 0, 0);
  put(state, 'red', 'king', 7, 7);
  assert.equal(getLegalMoves({ ...state, turn: 'red' }, square(7, 7)).length, 0);
  const stalemate = makeMove(state, square(0, 0), square(0, 1));
  assert.equal(stalemate.status, 'draw');
  assert.equal(stalemate.drawReason, 'stalemate');
});

test('promotion replaces a soldier, records the choice, and resets the quiet-move clock', () => {
  const state = blankState();
  put(state, 'blue', 'king', 4, 0);
  put(state, 'red', 'king', 4, 7);
  put(state, 'blue', 'soldier', 0, 6);
  state.halfMoveClock = 99;

  const from = square(0, 6);
  const to = square(0, 7);
  assert(hasMove(state, from, to));
  assert.equal(makeMove(state, from, to), state, 'promotion choice is required');

  const promoted = makeMove(state, from, to, 'aircraft');
  assert.equal(promoted.board[7]![0]?.type, 'aircraft');
  assert.equal(promoted.history.at(-1)?.promotion, 'aircraft');
  assert.equal(promoted.halfMoveClock, 0);
});

test('50-move draw counts 100 individual moves, and a capture resets the count', () => {
  const state = blankState();
  put(state, 'blue', 'king', 4, 0);
  put(state, 'red', 'king', 4, 7);
  put(state, 'blue', 'tank', 0, 0);
  state.halfMoveClock = 99;
  const drawn = makeMove(state, square(0, 0), square(0, 1));
  assert.equal(drawn.status, 'draw');
  assert.equal(drawn.drawReason, 'fifty-move');

  const captureState = blankState();
  put(captureState, 'blue', 'king', 4, 0);
  put(captureState, 'red', 'king', 7, 7);
  put(captureState, 'blue', 'tank', 0, 0);
  put(captureState, 'red', 'soldier', 0, 1);
  captureState.halfMoveClock = 99;
  const afterCapture = makeMove(captureState, square(0, 0), square(0, 1));
  assert.equal(afterCapture.halfMoveClock, 0);
  assert.equal(afterCapture.status, 'playing');
});

test('only exactly two remaining aircraft trigger the specified insufficient-material draw', () => {
  const twoAircraft = blankState();
  put(twoAircraft, 'blue', 'king', 7, 0);
  put(twoAircraft, 'red', 'king', 0, 7);
  put(twoAircraft, 'blue', 'aircraft', 2, 1);
  put(twoAircraft, 'red', 'aircraft', 5, 5);
  const afterMove = makeMove(twoAircraft, square(2, 1), square(3, 3));
  assert.equal(afterMove.drawReason, 'insufficient-material');

  for (const material of [
    ['artillery', 'artillery'],
    ['aircraft', 'artillery'],
  ] as const) {
    const state = blankState();
    put(state, 'blue', 'king', 7, 0);
    put(state, 'red', 'king', 0, 7);
    put(state, 'blue', material[0], 2, 1);
    put(state, 'red', material[1], 5, 5);
    const type = material[0];
    const destination = type === 'aircraft' ? square(3, 3) : square(3, 2);
    const continued = makeMove(state, square(2, 1), destination);
    assert.equal(continued.status, 'playing');
  }
});

test('a position repeated three times at equal intervals is a draw', () => {
  let state = createInitialState();
  const cycle: [Square, Square][] = [
    [square(1, 0), square(2, 2)],
    [square(1, 7), square(2, 5)],
    [square(2, 2), square(1, 0)],
    [square(2, 5), square(1, 7)],
  ];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    for (const [from, to] of cycle) state = makeMove(state, from, to);
  }
  assert.equal(state.status, 'draw');
  assert.equal(state.drawReason, 'repetition');
});

test('draw acceptance and resignation set the correct result', () => {
  const state = createInitialState();
  assert.equal(acceptDraw(state).drawReason, 'agreement');
  assert.equal(resignGame(state, 'blue').winner, 'red');
  assert.equal(resignGame(state, 'blue').status, 'resignation');
  assert.equal(timeoutGame(state, 'blue').status, 'timeout');
  assert.equal(timeoutGame(state, 'blue').winner, 'red');
  assert.equal(timeoutGame({ ...state, turn: 'red' }, 'blue').status, 'playing');
});
