import { describe, expect, it } from 'vitest';
import { queueNeighbours } from './queue';

const stops = [
  { id: 'r1', documentId: 'd1' },
  { id: 'r2', documentId: null }, // nothing readable yet: not a stop
  { id: 'r3', documentId: 'd3' },
  { id: 'r4', documentId: 'd4' },
];

describe('moving through the review queue', () => {
  it('steps either side of the line on screen, skipping lines with no file', () => {
    expect(queueNeighbours(stops, 'r3')).toMatchObject({ prev: { id: 'r1' }, next: { id: 'r4' }, position: 2, total: 3 });
    expect(queueNeighbours(stops, 'r1')).toMatchObject({ prev: null, next: { id: 'r3' }, position: 1 });
    expect(queueNeighbours(stops, 'r4')).toMatchObject({ prev: { id: 'r3' }, next: null, position: 3 });
  });

  it('goes to the oldest waiting line once the one on screen has been decided', () => {
    expect(queueNeighbours(stops, 'gone')).toMatchObject({ prev: null, next: { id: 'r1' }, position: null, total: 3 });
    expect(queueNeighbours([], 'gone')).toMatchObject({ prev: null, next: null, total: 0 });
  });
});
