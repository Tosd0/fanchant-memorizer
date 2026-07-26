import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLrc } from './parseLrc';
import { serializeLrc } from './serializeLrc';

const sample = `[ar:Test Artist]
[offset:500]
[00:14.50] One look give'em whiplash
[00:14.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:14.50] [fc] <repeat, yeah!, 1500>`;
const cheerSample = `[00:20.00] Are you ready
[00:20.00] [fc] <cheer, wooo!, 800>`;
const cheerFullLine = `[00:25.00] Get loud
[00:25.00] [fc] <cheer, wooo!>`;
const offsetAutoSample = `[00:30.00] Hello world
[00:30.00] [tt] <0,0> <500,5> <900,10>
[00:30.40] [fc] <repeat, hey>`;
const multiFanchantSample = `[00:10.00] Ready set go
[00:10.00] [tt] <0,0> <400,6> <800,10>
[00:10.40] [fc] <repeat, set!, 600>
[00:11.20] [fc] <repeat, go!, 600>`;
const translationSample = `[00:12.00] 사랑을 느껴
[00:12.00] [tt] <0,0> <391,4> <800,6> <800>
[00:12.00] [tr:zh-Hans] 感受到爱情`;

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
    expect(line.fanchants).toEqual([
      {
        content: 'yeah!',
        duration: 1500,
        type: 'repeat',
        startTime: 15_000,
        endTime: 16_500,
        fullLine: false,
      },
    ]);
    expect(line.id.length).toBeGreaterThan(0);
  });

  it('parses cheer fanchant types', () => {
    const result = parseLrc(cheerSample);

    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.fanchants[0]?.type).toBe('cheer');
    expect(line.fanchants[0]?.duration).toBe(800);
    expect(line.fanchants[0]?.fullLine).toBe(false);
  });

  it('parses full-line cheer shorthand', () => {
    const result = parseLrc(cheerFullLine);

    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.fanchants[0]?.type).toBe('cheer');
    expect(line.fanchants[0]?.endTime).toBeGreaterThan(line.startTime);
    expect(line.fanchants[0]?.fullLine).toBe(true);
  });

  it('extends auto-duration fanchant to end of line when timestamp differs', () => {
    const result = parseLrc(offsetAutoSample);

    expect(result).toHaveLength(1);
    const line = result[0];
    const fanchant = line.fanchants[0];
    expect(fanchant?.content).toBe('hey');
    expect(fanchant?.fullLine).toBe(false);
    expect(fanchant?.startTime).toBe(30_400);
    expect(fanchant?.endTime).toBeGreaterThan(fanchant!.startTime);
    expect(fanchant?.endTime).toBeGreaterThan(line.startTime);
  });

  it('keeps every fanchant when a line has multiple [fc] tags', () => {
    const result = parseLrc(multiFanchantSample);

    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.fanchants).toHaveLength(2);
    expect(line.fanchants.map((fc) => fc.content)).toEqual(['set!', 'go!']);
    expect(line.fanchants[0].startTime).toBeLessThan(line.fanchants[1].startTime);
  });

  it('parses [tr] translation rows and the [tt] end tag', () => {
    const result = parseLrc(translationSample);

    expect(result).toHaveLength(1);
    const line = result[0];
    expect(line.translation).toBe('感受到爱情');
    expect(line.translationLang).toBe('zh-Hans');
    expect(line.wordsEnd).toBe(800);
    expect(line.words).toHaveLength(3);
  });

  it('parses the original whatislove.lrc without losing fanchants or translations', () => {
    const raw = readFileSync(join(process.cwd(), 'whatislove.lrc'), 'utf8');
    const result = parseLrc(raw);

    expect(result).toHaveLength(84);
    // [offset:-300] shifts the first line from 00:03.030 to 2730ms.
    expect(result[0].startTime).toBe(2730);
    expect(result[0].text).toBe('TWICE!');

    const fanchantCount = result.reduce((total, line) => total + line.fanchants.length, 0);
    expect(fanchantCount).toBe(51);

    const doubleFanchantLine = result.find((line) => line.text.includes('됐지'));
    expect(doubleFanchantLine?.fanchants.map((fc) => fc.content)).toEqual(['됐지', 'Ready!']);

    const cheerLines = result.filter((line) =>
      line.fanchants.some((fc) => fc.type === 'cheer')
    );
    expect(cheerLines).toHaveLength(4);

    const translatedCount = result.filter((line) => line.translation).length;
    expect(translatedCount).toBe(49);

    const allDurationsPositive = result.every((line) =>
      line.fanchants.every((fc) => fc.duration > 0 && fc.endTime > fc.startTime)
    );
    expect(allDurationsPositive).toBe(true);
  });

  it('round-trips the original file through serializeLrc without data loss', () => {
    const raw = readFileSync(join(process.cwd(), 'whatislove.lrc'), 'utf8');
    const first = parseLrc(raw);
    const second = parseLrc(serializeLrc(first));

    expect(second).toHaveLength(first.length);
    second.forEach((line, index) => {
      const original = first[index];
      expect(line.startTime).toBe(original.startTime);
      expect(line.text).toBe(original.text);
      expect(line.words).toEqual(original.words);
      expect(line.wordsEnd).toBe(original.wordsEnd);
      expect(line.translation).toBe(original.translation);
      expect(line.translationLang).toBe(original.translationLang);
      expect(line.fanchants.map(({ content, type, startTime, duration }) => ({
        content,
        type,
        startTime,
        duration,
      }))).toEqual(
        original.fanchants.map(({ content, type, startTime, duration }) => ({
          content,
          type,
          startTime,
          duration,
        }))
      );
    });
  });
});
