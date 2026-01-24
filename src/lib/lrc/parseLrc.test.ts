import { describe, expect, it } from 'vitest';
import { parseLrc } from './parseLrc';

const sample = `[00:14.50] 向着明天大声尖叫
[00:14.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:14.50] [fc] <TWICE!, 1500, repeat>`;

describe('parseLrc', () => {
  it('parses lyric lines with word tags and fanchant tags', () => {
    const result = parseLrc(sample);

    expect(result).toHaveLength(1);
    const line = result[0];

    expect(line.startTime).toBe(14_500);
    expect(line.text).toBe('向着明天大声尖叫');
    expect(line.words).toEqual([
      { offset: 0, charIndex: 0 },
      { offset: 300, charIndex: 2 },
      { offset: 600, charIndex: 4 },
      { offset: 900, charIndex: 6 },
      { offset: 1200, charIndex: 8 },
    ]);
    expect(line.fanchant).toEqual({
      content: 'TWICE!',
      duration: 1500,
      type: 'repeat',
      endTime: 16_000,
    });
    expect(line.id.length).toBeGreaterThan(0);
  });
});
