import type { FanchantTag, FanchantType, LyricLine, WordTag } from './types';

const timeTagRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

const metaTagRegex = /^\[[a-zA-Z]+:.*\]$/;
const offsetTagRegex = /^\[offset:\s*(-?\d+)\s*\]$/i;
const inlineMetaTagRegex = /\[(?:ar|al|ti|tr|by|offset):[^\]]*\]/gi;
const metaLineContentRegex = /^\[(?:ar|al|ti|tr|by)\s*:[^\]]*\]/i;

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

type ParsedFanchant = Pick<FanchantTag, 'content' | 'duration' | 'type'> & {
  autoDuration: boolean;
};

const parseFanchantTag = (payload: string): ParsedFanchant | null => {
  const match = payload.match(/<\s*([^>]*)\s*>/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const [typeRaw, content, durationRaw = ''] = parts;
  const type = typeRaw.toLowerCase();
  if (!['repeat', 'diff', 'cheer'].includes(type)) return null;
  const durationText = durationRaw.trim();
  if (durationText.length > 0 && Number.isNaN(Number(durationText))) return null;
  return {
    content,
    duration: durationText.length > 0 ? Number(durationText) : 0,
    type: type as FanchantType,
    autoDuration: durationText.length === 0,
  };
};

export const parseLrc = (input: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  const lineByTime = new Map<number, LyricLine>();
  const lineOrder = new Map<string, number>();
  const autoDurationFanchants: Array<{ id: string; startTime: number }> = [];
  let lineIndex = 0;
  let lastLyricLine: LyricLine | null = null;
  let offsetMs = 0;

  const rows = input.split(/\r?\n/);
  for (const raw of rows) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const offsetMatch = trimmed.match(offsetTagRegex);
    if (offsetMatch) {
      offsetMs = Number(offsetMatch[1] ?? 0);
      if (Number.isNaN(offsetMs)) offsetMs = 0;
      continue;
    }
    if (metaTagRegex.test(trimmed)) continue;

    const timeTags = parseTimeTags(trimmed);
    if (timeTags.length === 0) continue;
    const adjustedTimes = timeTags.map((time) => time + offsetMs);

    const rawContent = trimmed.replace(timeTagRegex, '').trim();
    if (!rawContent) continue;
    if (metaLineContentRegex.test(rawContent)) continue;
    const content = rawContent.replace(inlineMetaTagRegex, '').trim();
    if (!content) continue;

    if (content.startsWith('[tt]')) {
      const payload = content.replace(/^\[tt\]\s*/, '');
      const wordTags = parseWordTags(payload);
      if (wordTags.length === 0) continue;

      for (const startTime of adjustedTimes) {
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

      for (const startTime of adjustedTimes) {
        const target = lineByTime.get(startTime) ?? lastLyricLine;
        if (!target) continue;
        target.fanchant = {
          content: fanchant.content,
          duration: fanchant.duration,
          type: fanchant.type,
          startTime,
          endTime: startTime + fanchant.duration,
          fullLine: false,
          ...(fanchant.autoDuration ? { autoDuration: true } : {}),
        };
        if (fanchant.autoDuration) {
          autoDurationFanchants.push({ id: target.id, startTime });
        }
      }
      continue;
    }

    for (const startTime of adjustedTimes) {
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

  const sorted = lines.sort((a, b) => {
    const timeDiff = a.startTime - b.startTime;
    if (timeDiff !== 0) return timeDiff;
    return (lineOrder.get(a.id) ?? 0) - (lineOrder.get(b.id) ?? 0);
  });
  if (autoDurationFanchants.length > 0) {
    const autoById = new Map<string, number>();
    autoDurationFanchants.forEach(({ id, startTime }) => {
      autoById.set(id, startTime);
    });
    sorted.forEach((line, index) => {
      const startTime = autoById.get(line.id);
      if (!line.fanchant || startTime === undefined) return;
      const nextStart = sorted[index + 1]?.startTime ?? line.startTime + 2000;
      const wordOffset = line.words.reduce((max, word) => Math.max(max, word.offset), -1);
      const roughLineEnd =
        wordOffset >= 0
          ? Math.max(line.startTime + wordOffset, line.startTime + 400)
          : Math.max(nextStart, line.startTime + 400);
      // When a fanchant starts at the final word boundary, extend to the sentence tail.
      const lineEnd =
        roughLineEnd <= startTime ? Math.max(nextStart, startTime + 400) : roughLineEnd;
      const duration = Math.max(lineEnd - startTime, 1);
      line.fanchant.duration = duration;
      line.fanchant.endTime = startTime + duration;
      line.fanchant.fullLine = startTime === line.startTime;
      line.fanchant.autoDuration = true;
    });
  }
  return sorted;
};
