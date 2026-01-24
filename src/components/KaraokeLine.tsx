'use client';

import {
  forwardRef,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LyricLine, WordTag } from '@/lib/lrc/types';
import type { GameMode, GameResult } from '@/stores/gameStore';

export interface KaraokeLineHandle {
  update: (timeMs: number) => void;
  reset: () => void;
}

export interface ReciteProgress {
  totalUnits: number;
  selectedUnits: number;
  requiredUnits: number;
  selectedRequired: number;
  selectedExtra: number;
  isComplete: boolean;
  hasSelection: boolean;
  completedAt: number | null;
}

interface KaraokeLineProps {
  line: LyricLine;
  lineIndex: number;
  mode: GameMode;
  isActive: boolean;
  endTime: number;
  onSeek: (timeMs: number) => void;
  canInteract?: boolean;
  onInteract?: (line: LyricLine) => void;
  onReciteProgress?: (line: LyricLine, progress: ReciteProgress) => void;
  timeRef?: MutableRefObject<number>;
  result?: GameResult | null;
  revealAnswer?: boolean;
  showFanchant?: boolean;
}

interface WordUnit {
  text: string;
  start: number;
  end: number;
}

const splitGraphemes = (text: string) => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
};

const splitWordUnits = (text: string, tags: WordTag[]) => {
  const graphemes = splitGraphemes(text);
  const total = graphemes.length;

  if (tags.length > 0) {
    const indices = Array.from(new Set(tags.map((tag) => Math.max(0, Math.min(tag.charIndex, total)))))
      .sort((a, b) => a - b);
    const boundaries = indices[0] === 0 ? indices : [0, ...indices];
    if (boundaries[boundaries.length - 1] !== total) boundaries.push(total);
    const units = boundaries
      .slice(0, -1)
      .map((start, index) => {
        const end = boundaries[index + 1];
        return { text: graphemes.slice(start, end).join(''), start, end };
      })
      .filter((unit) => unit.text.length > 0);
    return { graphemes, units };
  }

  const units: WordUnit[] = [];
  let buffer = '';
  let startIndex = 0;

  for (let i = 0; i < graphemes.length; i += 1) {
    const char = graphemes[i];
    if (/\s/.test(char)) {
      if (buffer) {
        units.push({ text: buffer, start: startIndex, end: i });
        buffer = '';
      }
      continue;
    }
    if (!buffer) {
      startIndex = i;
    }
    buffer += char;
  }

  if (buffer) {
    units.push({ text: buffer, start: startIndex, end: graphemes.length });
  }

  return { graphemes, units };
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

const findWordIndex = (units: WordUnit[], charIndex: number) => {
  for (let i = units.length - 1; i >= 0; i -= 1) {
    if (charIndex >= units[i].start) return i;
  }
  return -1;
};

const buildUnitOffsets = (
  units: WordUnit[],
  wordTags: WordTag[],
  relativeEndTime: number
) => {
  if (units.length === 0) return { startOffsets: [], endOffsets: [] };
  if (wordTags.length === 0) {
    const step = Math.max(relativeEndTime / units.length, 1);
    const startOffsets = units.map((_, index) => index * step);
    const endOffsets = units.map((_, index) => Math.min(relativeEndTime, (index + 1) * step));
    return { startOffsets, endOffsets };
  }

  const startOffsets = units.map((_, index) => {
    const safeIndex = Math.min(index, wordTags.length - 1);
    return wordTags[safeIndex]?.offset ?? 0;
  });
  const endOffsets = units.map((_, index) =>
    wordTags[index + 1]?.offset ?? relativeEndTime
  );
  return { startOffsets, endOffsets };
};

export const KaraokeLine = forwardRef<KaraokeLineHandle, KaraokeLineProps>(
  (
    {
      line,
      lineIndex,
      mode,
      isActive,
      endTime,
      onSeek,
      canInteract,
      onInteract,
      onReciteProgress,
      timeRef,
      result,
      revealAnswer,
      showFanchant,
    },
    ref
  ) => {
    const wordTags = useMemo(() => sortWordTags(line.words), [line.words]);
    const { graphemes, units } = useMemo(
      () => splitWordUnits(line.text, wordTags),
      [line.text, wordTags]
    );
    const isCheer = line.fanchant?.type === 'cheer';

    const [selectedUnits, setSelectedUnits] = useState<boolean[]>(() =>
      Array(units.length).fill(false)
    );
    const completedAtRef = useRef<number | null>(null);
    const selectingRef = useRef(false);

    const textRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const underlineRef = useRef<HTMLDivElement>(null);
    const fanchantRef = useRef<HTMLDivElement>(null);
    const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const metricsRef = useRef<{
      textLeft: number;
      textWidth: number;
      wordLefts: number[];
      wordRights: number[];
    }>({
      textLeft: 0,
      textWidth: 0,
      wordLefts: [],
      wordRights: [],
    });
    const lastWidthRef = useRef(0);

    const totalUnits = units.length;
    const relativeEndTime = Math.max(endTime - line.startTime, 1);
    const { startOffsets, endOffsets } = useMemo(
      () => buildUnitOffsets(units, wordTags, relativeEndTime),
      [relativeEndTime, units, wordTags]
    );

    const requiredMask = useMemo(() => {
      if (!line.fanchant) return Array(totalUnits).fill(false);
      const startOffset = line.fanchant.startTime - line.startTime;
      const endOffset = line.fanchant.endTime - line.startTime;
      return startOffsets.map((start, index) => {
        const end = endOffsets[index] ?? start;
        return end > startOffset && start < endOffset;
      });
    }, [endOffsets, line.fanchant, line.startTime, startOffsets, totalUnits]);

    const totalRequired = useMemo(
      () => requiredMask.reduce((total, value) => total + (value ? 1 : 0), 0),
      [requiredMask]
    );
    const selectedCount = useMemo(
      () => selectedUnits.reduce((total, value) => total + (value ? 1 : 0), 0),
      [selectedUnits]
    );
    const selectedRequired = useMemo(
      () =>
        selectedUnits.reduce(
          (total, value, index) => total + (value && requiredMask[index] ? 1 : 0),
          0
        ),
      [requiredMask, selectedUnits]
    );
    const selectedExtra = useMemo(
      () =>
        selectedUnits.reduce(
          (total, value, index) => total + (value && !requiredMask[index] ? 1 : 0),
          0
        ),
      [requiredMask, selectedUnits]
    );
    const hasSelection = selectedCount > 0;
    const isComplete = totalRequired > 0 && selectedRequired === totalRequired && selectedExtra === 0;

    useEffect(() => {
      setSelectedUnits(Array(units.length).fill(false));
      completedAtRef.current = null;
    }, [line.id, mode, units.length]);

    useEffect(() => {
      if (!isComplete) {
        completedAtRef.current = null;
        return;
      }
      if (completedAtRef.current !== null) return;
      completedAtRef.current = timeRef?.current ?? null;
    }, [isComplete, timeRef]);

    useEffect(() => {
      if (!onReciteProgress || mode !== 'recite') return;
      onReciteProgress(line, {
        totalUnits,
        selectedUnits: selectedCount,
        requiredUnits: totalRequired,
        selectedRequired,
        selectedExtra,
        isComplete,
        hasSelection,
        completedAt: completedAtRef.current,
      });
    }, [
      hasSelection,
      isComplete,
      line,
      mode,
      onReciteProgress,
      selectedCount,
      selectedExtra,
      selectedRequired,
      totalRequired,
      totalUnits,
    ]);

    const setWidth = useCallback((width: number, left: number) => {
      if (!underlineRef.current) return;
      if (width === lastWidthRef.current && underlineRef.current.style.left === `${left}px`) {
        return;
      }
      lastWidthRef.current = width;
      underlineRef.current.style.left = `${left}px`;
      underlineRef.current.style.width = `${width}px`;
    }, []);

    const computeWidthForOffset = useCallback(
      (offsetMs: number) => {
        const { textLeft, textWidth, wordLefts, wordRights } = metricsRef.current;
        if (wordTags.length > 0) {
          const tagIndex = findLastTagIndex(wordTags, offsetMs);
          if (tagIndex < 0) return { width: 0, left: textLeft };
          if (tagIndex >= wordTags.length - 1) return { width: textWidth, left: textLeft };
          const unitIndex = Math.min(tagIndex, units.length - 1);
          const nextOffset = wordTags[tagIndex + 1].offset;
          const currentOffset = wordTags[tagIndex].offset;
          const span = Math.max(nextOffset - currentOffset, 1);
          const progress = Math.min(Math.max((offsetMs - currentOffset) / span, 0), 1);
          const left = wordLefts[unitIndex] ?? textLeft;
          const right = wordRights[unitIndex] ?? left;
          const width = Math.max(0, left - textLeft + (right - left) * progress);
          return { width, left: textLeft };
        }

        const duration = Math.max(endTime - line.startTime, 1);
        const progress = Math.min(Math.max(offsetMs / duration, 0), 1);
        return { width: textWidth * progress, left: textLeft };
      },
      [endTime, line.startTime, units.length, wordTags]
    );

    const positionFanchant = useCallback(() => {
      if (!fanchantRef.current || !line.fanchant) return;
      const startOffset = line.fanchant.startTime - line.startTime;
      const endOffset = line.fanchant.endTime - line.startTime;
      if (isCheer) {
        const { textLeft, textWidth } = metricsRef.current;
        const baseX = textLeft + textWidth / 2;
        fanchantRef.current.style.transform = `translateX(${baseX}px) translateX(-50%)`;
        return;
      }
      const anchor = computeWidthForOffset(startOffset);
      const baseX = anchor.left + anchor.width;
      fanchantRef.current.style.transform = `translateX(${baseX}px)`;
    }, [computeWidthForOffset, isCheer, line.fanchant, line.startTime]);

    const measure = useCallback(() => {
      const lineEl = bodyRef.current;
      const textEl = textRef.current;
      if (!lineEl || !textEl) return;
      const lineRect = lineEl.getBoundingClientRect();
      const textRect = textEl.getBoundingClientRect();
      const wordLefts = wordRefs.current.map((node) =>
        node ? node.getBoundingClientRect().left - lineRect.left : 0
      );
      const wordRights = wordRefs.current.map((node) =>
        node ? node.getBoundingClientRect().right - lineRect.left : 0
      );
      metricsRef.current = {
        textLeft: textRect.left - lineRect.left,
        textWidth: textRect.width,
        wordLefts,
        wordRights,
      };
      positionFanchant();
    }, [positionFanchant]);

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
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null;
      if (observer && bodyRef.current) observer.observe(bodyRef.current);
      return () => {
        active = false;
        window.removeEventListener('resize', handleResize);
        observer?.disconnect();
      };
    }, [measure, units.length]);

    const update = useCallback(
      (timeMs: number) => {
        if (!underlineRef.current) return;
        if (metricsRef.current.wordRights.length === 0) {
          measure();
        }
        const elapsed = timeMs - line.startTime;
        const totalChars = graphemes.length;
        if (totalChars === 0 || units.length === 0) {
          setWidth(0, metricsRef.current.textLeft);
          return;
        }

        const { width, left } = computeWidthForOffset(elapsed);
        setWidth(width, left);

        if (line.fanchant?.type === 'cheer') {
          const hasStarted = timeMs >= line.fanchant.startTime;
          underlineRef.current.style.backgroundColor = hasStarted ? '#facc15' : '';
        } else {
          underlineRef.current.style.backgroundColor = '';
        }

        positionFanchant();
      },
      [computeWidthForOffset, endTime, graphemes.length, line.fanchant, line.startTime, measure, positionFanchant, setWidth, units.length]
    );

    useImperativeHandle(
      ref,
      () => ({
        update,
        reset: () => {
          setWidth(0, metricsRef.current.textLeft);
          if (underlineRef.current) underlineRef.current.style.backgroundColor = '';
        },
      }),
      [setWidth, update]
    );

    const wrapperClass = isActive
      ? 'bg-slate-50 text-slate-900'
      : 'text-slate-500 hover:bg-slate-50/80';
    const resultClass =
      result === 'hit'
        ? 'line-hit ring-1 ring-emerald-400/60'
        : result === 'miss'
          ? 'line-miss ring-1 ring-rose-400/60'
          : '';

    const handleInteract = useCallback(
      (event: ReactMouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        onInteract?.(line);
      },
      [line, onInteract]
    );

    const handleClick = useCallback(() => {
      if (mode === 'recite') return;
      if (canInteract) {
        onInteract?.(line);
        return;
      }
      onSeek(line.startTime);
    }, [canInteract, line, mode, onInteract, onSeek]);

    const canSelect = mode === 'recite' && !result;

    const selectUnit = useCallback((index: number) => {
      setSelectedUnits((prev) => {
        if (prev[index]) return prev;
        const next = [...prev];
        next[index] = true;
        return next;
      });
    }, []);

    const handleWordPointerDown = useCallback(
      (index: number) => (event: ReactPointerEvent<HTMLSpanElement>) => {
        if (!canSelect) return;
        event.preventDefault();
        event.stopPropagation();
        selectingRef.current = true;
        selectUnit(index);
      },
      [canSelect, selectUnit]
    );

    const handleWordPointerEnter = useCallback(
      (index: number) => (event: ReactPointerEvent<HTMLSpanElement>) => {
        if (!canSelect || !selectingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        selectUnit(index);
      },
      [canSelect, selectUnit]
    );

    const handlePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!canSelect || !selectingRef.current) return;
        const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const hit = target?.closest('[data-word-index]') as HTMLElement | null;
        if (!hit) return;
        const nextIndex = Number(hit.dataset.wordIndex);
        if (Number.isNaN(nextIndex) || nextIndex < 0 || nextIndex >= totalUnits) return;
        selectUnit(nextIndex);
      },
      [canSelect, selectUnit, totalUnits]
    );

    useEffect(() => {
      if (!canSelect) {
        selectingRef.current = false;
        return;
      }
      const handlePointerUp = () => {
        selectingRef.current = false;
      };
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
      return () => {
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      };
    }, [canSelect]);

    const showFanchantText =
      mode === 'recite'
        ? hasSelection || Boolean(result)
        : Boolean(showFanchant || revealAnswer);

    const fanchantClass = isCheer
      ? 'text-amber-500'
      : mode === 'recite'
        ? result === 'miss'
          ? 'text-rose-500'
          : 'text-emerald-600'
        : 'text-emerald-600';

    const fanchantText = isCheer ? '[CHEER/欢呼]' : line.fanchant?.content ?? '';

    return (
      <button
        type="button"
        aria-current={isActive}
        data-line-index={lineIndex}
        onClick={handleClick}
        className={`relative w-full rounded-2xl px-6 py-5 text-center transition ${wrapperClass} ${resultClass}`}
      >
        {canInteract ? (
          <span aria-hidden="true" className="absolute inset-0 cursor-pointer" onClick={handleInteract} />
        ) : null}
        <div ref={bodyRef} className="relative w-full">
          <div
            ref={textRef}
            onPointerMove={handlePointerMove}
            className="mx-auto inline-flex w-fit flex-wrap justify-center gap-3"
          >
            {units.map((unit, index) => (
              <span
                key={`${line.id}-unit-${index}`}
                ref={(node) => {
                  wordRefs.current[index] = node;
                }}
                data-word-index={index}
                onPointerDown={handleWordPointerDown(index)}
                onPointerEnter={handleWordPointerEnter(index)}
                className={`rounded-lg border px-3 py-1 text-lg tracking-wide text-slate-800 transition ${
                  canSelect ? 'cursor-pointer select-none' : ''
                } ${
                  selectedUnits[index]
                    ? 'border-slate-300 bg-slate-200 text-slate-900'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {unit.text}
              </span>
            ))}
          </div>
          <div className="relative mx-auto mt-3 h-2 w-full">
            <div ref={underlineRef} className="absolute top-1 h-0.5 bg-emerald-500" style={{ width: 0 }} />
          </div>
          <div className="relative mx-auto mt-4 h-6 w-full">
            <div
              ref={fanchantRef}
              className={`absolute left-0 text-lg font-semibold uppercase tracking-[0.3em] ${
                fanchantClass
              } ${showFanchantText ? 'opacity-100' : 'opacity-0'}`}
            >
              {fanchantText}
            </div>
          </div>
        </div>
        {result === 'hit' ? <span aria-hidden="true" className="line-spark" /> : null}
      </button>
    );
  }
);

KaraokeLine.displayName = 'KaraokeLine';
