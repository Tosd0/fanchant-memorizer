'use client';

import {
  forwardRef,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { LyricLine, WordTag } from '@/lib/lrc/types';
import type { GameResult } from '@/stores/gameStore';

export interface KaraokeLineHandle {
  update: (timeMs: number) => void;
  reset: () => void;
}

interface KaraokeLineProps {
  line: LyricLine;
  lineIndex: number;
  isActive: boolean;
  endTime: number;
  onSeek: (timeMs: number) => void;
  canInteract?: boolean;
  onInteract?: (line: LyricLine) => void;
  result?: GameResult | null;
  hintLabel?: string | null;
  revealAnswer?: boolean;
}

const splitGraphemes = (text: string) => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
};

const sortWordTags = (tags: WordTag[]) => [...tags].sort((a, b) => a.offset - b.offset);

const findLastTagIndex = (tags: WordTag[], elapsed: number) => {
  let left = 0;
  let right = tags.length - 1;
  let best = -1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (tags[mid].offset <= elapsed) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return best;
};

export const KaraokeLine = forwardRef<KaraokeLineHandle, KaraokeLineProps>(
  (
    { line, lineIndex, isActive, endTime, onSeek, canInteract, onInteract, result, hintLabel, revealAnswer },
    ref
  ) => {
    const graphemes = useMemo(() => splitGraphemes(line.text), [line.text]);
    const wordTags = useMemo(() => sortWordTags(line.words), [line.words]);

    const baseRef = useRef<HTMLSpanElement>(null);
    const highlightRef = useRef<HTMLSpanElement>(null);
    const charPositionsRef = useRef<number[]>([]);
    const lastWidthRef = useRef(0);

    const measure = useCallback(() => {
      const baseEl = baseRef.current;
      if (!baseEl) return;
      const baseRect = baseEl.getBoundingClientRect();
      const spans = Array.from(baseEl.querySelectorAll<HTMLSpanElement>('[data-char-index]'));
      charPositionsRef.current = spans.map((span) => {
        const rect = span.getBoundingClientRect();
        return rect.right - baseRect.left;
      });
      const maxWidth = charPositionsRef.current.length
        ? charPositionsRef.current[charPositionsRef.current.length - 1]
        : 0;
      if (lastWidthRef.current > maxWidth && highlightRef.current) {
        lastWidthRef.current = maxWidth;
        highlightRef.current.style.width = `${maxWidth}px`;
      }
    }, []);

    useLayoutEffect(() => {
      let active = true;
      const run = () => {
        if (!active) return;
        measure();
      };
      run();
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(run).catch(() => undefined);
      }
      const handleResize = () => run();
      window.addEventListener('resize', handleResize);
      const observer =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null;
      if (observer && baseRef.current) observer.observe(baseRef.current);
      return () => {
        active = false;
        window.removeEventListener('resize', handleResize);
        observer?.disconnect();
      };
    }, [measure, graphemes]);

    const setWidth = useCallback((width: number) => {
      if (!highlightRef.current) return;
      if (width === lastWidthRef.current) return;
      lastWidthRef.current = width;
      highlightRef.current.style.width = `${width}px`;
    }, []);

    const update = useCallback(
      (timeMs: number) => {
        if (!highlightRef.current) return;
        if (charPositionsRef.current.length === 0) {
          measure();
        }
        const elapsed = timeMs - line.startTime;
        const totalChars = graphemes.length;
        if (totalChars === 0) {
          setWidth(0);
          return;
        }

        let charCount = 0;
        if (wordTags.length > 0) {
          const index = findLastTagIndex(wordTags, elapsed);
          charCount = index >= 0 ? wordTags[index].charIndex : 0;
          if (elapsed >= wordTags[wordTags.length - 1].offset) {
            charCount = Math.max(charCount, totalChars);
          }
        } else {
          const duration = Math.max(endTime - line.startTime, 1);
          const progress = Math.min(Math.max(elapsed / duration, 0), 1);
          charCount = Math.floor(progress * totalChars);
        }

        const clampedCount = Math.max(0, Math.min(charCount, totalChars));
        const positions = charPositionsRef.current;
        const width =
          clampedCount === 0 ? 0 : positions[Math.min(clampedCount - 1, positions.length - 1)] ?? 0;
        setWidth(width);
      },
      [endTime, graphemes.length, line.startTime, measure, setWidth, wordTags]
    );

    useImperativeHandle(
      ref,
      () => ({
        update,
        reset: () => setWidth(0),
      }),
      [setWidth, update]
    );

    const baseTextClass = isActive ? 'text-zinc-200' : 'text-zinc-500';
    const wrapperClass = isActive
      ? 'bg-white/5 text-zinc-100'
      : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200';
    const resultClass =
      result === 'hit'
        ? 'line-hit ring-1 ring-emerald-400/70 shadow-[0_0_24px_rgba(16,185,129,0.35)]'
        : result === 'miss'
          ? 'line-miss ring-1 ring-rose-500/70 shadow-[0_0_24px_rgba(244,63,94,0.35)]'
          : '';
    const highlightOpacity = isActive ? 'opacity-100' : 'opacity-0';

    const handleInteract = useCallback(
      (event: ReactMouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        onInteract?.(line);
      },
      [line, onInteract]
    );

    const handleClick = useCallback(() => {
      if (canInteract) {
        onInteract?.(line);
        return;
      }
      onSeek(line.startTime);
    }, [canInteract, line, onInteract, onSeek]);

    return (
      <button
        type="button"
        aria-current={isActive}
        data-line-index={lineIndex}
        onClick={handleClick}
        className={`relative w-full rounded-xl px-4 py-3 text-left transition ${wrapperClass} ${resultClass}`}
      >
        {canInteract ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 cursor-pointer"
            onClick={handleInteract}
          />
        ) : null}
        <span className="relative inline-block whitespace-pre-wrap text-base leading-relaxed">
          <span ref={baseRef} className={`${baseTextClass} block`}>
            {graphemes.map((char, index) => (
              <span key={`${line.id}-base-${index}`} data-char-index={index}>
                {char}
              </span>
            ))}
          </span>
          <span
            ref={highlightRef}
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 top-0 block h-full overflow-hidden whitespace-pre-wrap bg-gradient-to-r from-emerald-200 via-emerald-400 to-emerald-500 bg-clip-text text-transparent transition-opacity ${highlightOpacity}`}
            style={{ width: 0 }}
          >
            {graphemes.map((char, index) => (
              <span key={`${line.id}-hl-${index}`} data-char-index={index}>
                {char}
              </span>
            ))}
          </span>
        </span>
        {hintLabel ? (
          <span className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200">
            {hintLabel}
          </span>
        ) : null}
        {revealAnswer && line.fanchant && result ? (
          <span className="mt-2 block text-xs text-emerald-200/80">{line.fanchant.content}</span>
        ) : null}
        {result === 'hit' ? <span aria-hidden="true" className="line-spark" /> : null}
      </button>
    );
  }
);

KaraokeLine.displayName = 'KaraokeLine';
