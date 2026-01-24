import { describe, expect, it } from 'vitest';
import { parseLrc } from './parseLrc';

const sample = `[ar:Test Artist]
[offset:500]
[00:14.50] One look give'em whiplash
[00:14.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:14.50] [fc] <repeat, yeah!, 1500>`;
const cheerSample = `[00:20.00] Are you ready
[00:20.00] [fc] <cheer, wooo!, 800>`;
const cheerFullLine = `[00:25.00] Get loud
[00:25.00] [fc] <cheer, wooo!>`;

describe('parseLrc', () => {
  it('parses lyric lines with word tags and fanchant tags', () => {
    const result = parseLrc(sample);

    expect(result).toHaveLength(1);
    const line = result[0];

    expect(line.startTime).toBe(15_000);
    expect(line.text).toBe('One look give\'em whiplash');
    expect(line.words).toEqual([
      { offset: 0, charIndex: 0 },
      { offset: 300, charIndex: 2 },
      { offset: 600, charIndex: 4 },
      { offset: 900, charIndex: 6 },
      { offset: 1200, charIndex: 8 },
    ]);
    expect(line.fanchant).toEqual({
      content: 'yeah!',
      duration: 1500,
      type: 'repeat',
      startTime: 15_000,
      endTime: 16_500,
    });
    expect(line.id.length).toBeGreaterThan(0);
  });

  it('parses cheer fanchant types', () => {
    const result = parseLrc(cheerSample);

    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.fanchant?.type).toBe('cheer');
    expect(line.fanchant?.duration).toBe(800);
  });

  it('parses full-line cheer shorthand', () => {
    const result = parseLrc(cheerFullLine);

    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.fanchant?.type).toBe('cheer');
    expect(line.fanchant?.endTime).toBeGreaterThan(line.startTime);
  });
});
