import type { LyricLine } from './types';

export const formatLrcTimestamp = (ms: number) => {
  const safeMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}]`;
};

export const serializeLrc = (lines: LyricLine[]) =>
  lines
    .flatMap((line) => {
      const lyricTime = formatLrcTimestamp(line.startTime);
      const rows = [`${lyricTime} ${line.text}`];
      if (line.translation) {
        const langPart = line.translationLang ? `:${line.translationLang}` : '';
        rows.push(`${lyricTime} [tr${langPart}] ${line.translation}`);
      }
      if (line.words.length > 0) {
        const wordPayload = [...line.words]
          .sort((a, b) => a.offset - b.offset)
          .map(
            (word) =>
              `<${Math.max(0, Math.round(word.offset))},${Math.max(0, Math.round(word.charIndex))}>`
          )
          .join(' ');
        const endPart =
          line.wordsEnd !== undefined ? ` <${Math.max(0, Math.round(line.wordsEnd))}>` : '';
        rows.push(`${lyricTime} [tt] ${wordPayload}${endPart}`);
      }
      for (const fanchant of line.fanchants) {
        const fcTime = formatLrcTimestamp(fanchant.startTime);
        const durationPart = fanchant.autoDuration
          ? ''
          : `, ${Math.max(1, Math.round(fanchant.duration))}`;
        rows.push(`${fcTime} [fc] <${fanchant.type}, ${fanchant.content}${durationPart}>`);
      }
      return rows;
    })
    .join('\n');
