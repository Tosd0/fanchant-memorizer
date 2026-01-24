import type { FanchantTag, FanchantType, LyricLine, WordTag } from './types';

const timeTagRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

const metaTagRegex = /^\[[a-zA-Z]+:.*\]$/;

const createId = (startTime: number, order: number) => `line_${startTime}_${order}`;

const fractionToMs = (fraction: string | undefined) => {
  if (!fraction) return 0;
  const value = Number(fraction);
  if (Number.isNaN(value)) return 0;
  if (fraction.length === 1) return value * 100;
  if (fraction.length === 2) return value * 10;
  return value;
};

const parseTimestampToMs = (minute: string, second: string, fraction?: string) => {
  const minutes = Number(minute);
  const seconds = Number(second);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return minutes * 60_000 + seconds * 1_000 + fractionToMs(fraction);
};

const parseTimeTags = (line: string) => {
  const times: number[] = [];
  for (const match of line.matchAll(timeTagRegex)) {
    const [, min, sec, frac] = match;
    const time = parseTimestampToMs(min, sec, frac);
    if (time !== null) {
      times.push(time);
    }
  }
  return times;
};

const parseWordTags = (payload: string): WordTag[] => {
  const tags: WordTag[] = [];
  const regex = /<\s*(\d+)\s*,\s*(\d+)\s*>/g;
  for (const match of payload.matchAll(regex)) {
    const [, offset, charIndex] = match;
    tags.push({
      offset: Number(offset),
      charIndex: Number(charIndex),
    });
  }
  return tags;
};

const parseFanchantTag = (payload: string): Omit<FanchantTag, 'endTime'> | null => {
  const regex = /<\s*([^,]+?)\s*,\s*(\d+)\s*,\s*(repeat|diff)\s*>/i;
  const match = payload.match(regex);
  if (!match) return null;
  const [, content, duration, type] = match;
  return {
    content: content.trim(),
    duration: Number(duration),
    type: type.trim().toLowerCase() as FanchantType,
  };
};

export const parseLrc = (input: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  const lineByTime = new Map<number, LyricLine>();
  const lineOrder = new Map<string, number>();
  let lineIndex = 0;
  let lastLyricLine: LyricLine | null = null;

  const rows = input.split(/\r?\n/);
  for (const raw of rows) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (metaTagRegex.test(trimmed)) continue;

    const timeTags = parseTimeTags(trimmed);
    if (timeTags.length === 0) continue;

    const content = trimmed.replace(timeTagRegex, '').trim();
    if (!content) continue;

    if (content.startsWith('[tt]')) {
      const payload = content.replace(/^\[tt\]\s*/, '');
      const wordTags = parseWordTags(payload);
      if (wordTags.length === 0) continue;

      for (const startTime of timeTags) {
        const target = lineByTime.get(startTime) ?? lastLyricLine;
        if (!target) continue;
        target.words = wordTags;
      }
      continue;
    }

    if (content.startsWith('[fc]')) {
      const payload = content.replace(/^\[fc\]\s*/, '');
      const fanchant = parseFanchantTag(payload);
      if (!fanchant) continue;

      for (const startTime of timeTags) {
        const target = lineByTime.get(startTime) ?? lastLyricLine;
        if (!target) continue;
        target.fanchant = {
          ...fanchant,
          endTime: target.startTime + fanchant.duration,
        };
      }
      continue;
    }

    for (const startTime of timeTags) {
      const order = lineIndex++;
      const id = createId(startTime, order);
      const line: LyricLine = {
        id,
        startTime,
        text: content,
        words: [],
      };
      lines.push(line);
      lineByTime.set(startTime, line);
      lineOrder.set(id, order);
      lastLyricLine = line;
    }
  }

  return lines.sort((a, b) => {
    const timeDiff = a.startTime - b.startTime;
    if (timeDiff !== 0) return timeDiff;
    return (lineOrder.get(a.id) ?? 0) - (lineOrder.get(b.id) ?? 0);
  });
};
