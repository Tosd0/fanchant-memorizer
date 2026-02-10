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
  applyPressInterval: (startAbs: number, endAbs: number, finalize?: boolean) => void;
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
  timingStatus?: 'pending' | 'ok' | 'miss' | null;
  timingWindow?: { start: number; end: number } | null;
}

export interface CreateSelection {
  line: LyricLine;
  lineIndex: number;
  selectedIndices: number[];
  selectedText: string;
  startOffset: number;
  endOffset: number;
  totalUnits: number;
}

interface KaraokeLineProps {
  line: LyricLine;
  lineIndex: number;
  mode: GameMode;
  isActive: boolean;
  endTime: number;
  onSeek: (timeMs: number) => void;
  onReciteProgress?: (line: LyricLine, progress: ReciteProgress) => void;
  onReciteCheerMark?: (line: LyricLine) => void;
  timeRef?: MutableRefObject<number>;
  result?: GameResult | null;
  revealAnswer?: boolean;
  showFanchant?: boolean;
  onCreateSelection?: (selection: CreateSelection) => void;
}

interface WordUnit {
  text: string;
  start: number;
  end: number;
}

const RECITE_TOLERANCE_MS = 140;
const PLACEHOLDER_CHAR = '□';
const PLACEHOLDER_DISPLAY = '\u3000';

const applyPlaceholderDisplay = (text: string) =>
  text.includes(PLACEHOLDER_CHAR)
    ? text.replaceAll(PLACEHOLDER_CHAR, PLACEHOLDER_DISPLAY)
    : text;

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
        const rawText = graphemes.slice(start, end).join('');
        return { text: applyPlaceholderDisplay(rawText), start, end };
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
        units.push({ text: applyPlaceholderDisplay(buffer), start: startIndex, end: i });
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
    units.push({
      text: applyPlaceholderDisplay(buffer),
      start: startIndex,
      end: graphemes.length,
    });
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
      onReciteProgress,
      onReciteCheerMark,
      onCreateSelection,
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
    const isEditMode = mode === 'edit';

    const [selectedUnits, setSelectedUnits] = useState<boolean[]>(() =>
      Array(units.length).fill(false)
    );
    const [selectionSource, setSelectionSource] = useState<'manual' | 'press' | null>(null);
    const [pressTimingStatus, setPressTimingStatus] = useState<'pending' | 'ok' | 'miss' | null>(
      null
    );
    const completedAtRef = useRef<number | null>(null);
    const pressCompletedAtRef = useRef<number | null>(null);
    const selectingRef = useRef(false);
    const pressSelectingRef = useRef(false);
    const pressBaseSelectionRef = useRef<boolean[]>([]);
    const selectedUnitsRef = useRef<boolean[]>([]);

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
      if (line.fanchant.fullLine) return Array(totalUnits).fill(true);
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
    const isPressSelection = selectionSource === 'press';
    const isComplete =
      totalRequired > 0 &&
      selectedRequired === totalRequired &&
      (isPressSelection ? true : selectedExtra === 0);

    const requiredWindow = useMemo(() => {
      if (totalRequired === 0) return null;
      let minStart = Number.POSITIVE_INFINITY;
      let maxEnd = Number.NEGATIVE_INFINITY;
      requiredMask.forEach((required, index) => {
        if (!required) return;
        const start = startOffsets[index] ?? 0;
        const end = endOffsets[index] ?? start;
        minStart = Math.min(minStart, start);
        maxEnd = Math.max(maxEnd, end);
      });
      if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null;
      return { start: minStart, end: maxEnd };
    }, [endOffsets, requiredMask, startOffsets, totalRequired]);

    useEffect(() => {
      setSelectedUnits(Array(units.length).fill(false));
      setSelectionSource(null);
      setPressTimingStatus(null);
      pressCompletedAtRef.current = null;
      pressSelectingRef.current = false;
      pressBaseSelectionRef.current = [];
      completedAtRef.current = null;
    }, [line.id, mode, units.length]);

    useEffect(() => {
      selectedUnitsRef.current = selectedUnits;
    }, [selectedUnits]);

    useEffect(() => {
      if (!isComplete || pressTimingStatus === 'pending' || pressTimingStatus === 'miss') {
        completedAtRef.current = null;
        return;
      }
      if (completedAtRef.current !== null) return;
      completedAtRef.current = isPressSelection
        ? pressCompletedAtRef.current ?? null
        : timeRef?.current ?? null;
    }, [isComplete, isPressSelection, pressTimingStatus, timeRef]);

    useEffect(() => {
      if (!onReciteProgress || mode !== 'recite') return;
      const timingStatus = isPressSelection ? pressTimingStatus : null;
      const timingWindow =
        isPressSelection && requiredWindow
          ? {
              start: line.startTime + requiredWindow.start - RECITE_TOLERANCE_MS,
              end: line.startTime + requiredWindow.end + RECITE_TOLERANCE_MS,
            }
          : null;
      onReciteProgress(line, {
        totalUnits,
        selectedUnits: selectedCount,
        requiredUnits: totalRequired,
        selectedRequired,
        selectedExtra,
        isComplete,
        hasSelection,
        completedAt: completedAtRef.current,
        timingStatus,
        timingWindow,
      });
    }, [
      hasSelection,
      isComplete,
      line,
      mode,
      onReciteProgress,
      pressTimingStatus,
      requiredWindow,
      selectedCount,
      selectedExtra,
      selectedRequired,
      isPressSelection,
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
      if (isCheer || line.fanchant.fullLine) {
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

    const hasWordTags = line.words.length > 0;
    const canSelect = (mode === 'recite' && !result) || (isEditMode && hasWordTags);
    const showReciteActions = mode === 'recite' && isActive;
    const showEditActions = isEditMode;
    const actionsLocked = Boolean(result);

    useImperativeHandle(
      ref,
      () => ({
        update,
        applyPressInterval: (startAbs: number, endAbs: number, finalize = true) => {
          if (!canSelect || totalUnits === 0) return;
          const relStartRaw = Math.min(startAbs, endAbs) - line.startTime;
          const relEndRaw = Math.max(startAbs, endAbs) - line.startTime;
          const relStart = Math.max(relStartRaw, 0);
          const relEnd = Math.min(relEndRaw, relativeEndTime);
          if (!finalize && !pressSelectingRef.current) {
            pressSelectingRef.current = true;
            pressBaseSelectionRef.current = selectedUnitsRef.current;
          }
          if (relEnd <= 0 || relStart >= relativeEndTime) {
            setSelectionSource('press');
            setSelectedUnits(pressBaseSelectionRef.current ?? selectedUnitsRef.current);
            setPressTimingStatus(finalize ? null : 'pending');
            pressCompletedAtRef.current = null;
            if (finalize) pressSelectingRef.current = false;
            return;
          }
          setSelectionSource('press');
          const nextSelected = startOffsets.map((start, index) => {
            const end = endOffsets[index] ?? start;
            return end > relStart && start < relEnd;
          });
          const baseSelection = pressBaseSelectionRef.current ?? selectedUnitsRef.current;
          const mergedSelection = nextSelected.map((value, index) => value || baseSelection[index]);
          setSelectedUnits(mergedSelection);
          if (!requiredWindow) {
            setPressTimingStatus(finalize ? null : 'pending');
            pressCompletedAtRef.current = null;
            if (finalize) pressSelectingRef.current = false;
            return;
          }
          if (!finalize) {
            setPressTimingStatus('pending');
            pressCompletedAtRef.current = null;
            return;
          }
          const allowedStart = requiredWindow.start - RECITE_TOLERANCE_MS;
          const allowedEnd = requiredWindow.end + RECITE_TOLERANCE_MS;
          const timingStatus =
            relStart < allowedStart || relEnd > allowedEnd ? 'miss' : 'ok';
          pressCompletedAtRef.current =
            timingStatus === 'ok' ? line.startTime + relEnd : null;
          setPressTimingStatus(timingStatus);
          pressSelectingRef.current = false;
        },
        reset: () => {
          setSelectedUnits(Array(units.length).fill(false));
          setSelectionSource(null);
          setPressTimingStatus(null);
          pressCompletedAtRef.current = null;
          pressSelectingRef.current = false;
          pressBaseSelectionRef.current = [];
          completedAtRef.current = null;
          selectingRef.current = false;
          setWidth(0, metricsRef.current.textLeft);
          if (underlineRef.current) underlineRef.current.style.backgroundColor = '';
        },
      }),
      [
        canSelect,
        endOffsets,
        line.startTime,
        relativeEndTime,
        requiredWindow,
        setWidth,
        startOffsets,
        totalUnits,
        update,
      ]
    );

    const wrapperClass = isActive
      ? 'bg-[color:var(--lyric-bg)] text-[color:var(--text-primary)]'
      : 'text-[color:var(--text-soft)] hover:text-[color:var(--text-primary)]';
    const resultClass =
      result === 'hit'
        ? 'line-hit ring-1 ring-emerald-400/60'
        : result === 'miss'
          ? 'line-miss ring-1 ring-rose-400/60'
          : '';

    const handleClick = useCallback(() => {
      if (mode === 'recite') return;
      onSeek(line.startTime);
    }, [line.startTime, mode, onSeek]);

    const clearSelection = useCallback(() => {
      setSelectedUnits(Array(units.length).fill(false));
      setSelectionSource(null);
      setPressTimingStatus(null);
      pressCompletedAtRef.current = null;
      pressSelectingRef.current = false;
      pressBaseSelectionRef.current = [];
      completedAtRef.current = null;
      selectingRef.current = false;
    }, [units.length]);

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
        setSelectionSource('manual');
        setPressTimingStatus(null);
        pressCompletedAtRef.current = null;
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
        setSelectionSource('manual');
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

    const handleSelectAll = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!canSelect || totalUnits === 0) return;
        setSelectionSource('manual');
        setPressTimingStatus(null);
        pressCompletedAtRef.current = null;
        setSelectedUnits((prev) => {
          if (prev.length === 0) return prev;
          if (prev.every(Boolean)) return prev;
          return Array(totalUnits).fill(true);
        });
      },
      [canSelect, totalUnits]
    );

    const handleClearSelection = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!showEditActions) return;
        clearSelection();
      },
      [clearSelection, showEditActions]
    );

    const handleCreateConfirm = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!onCreateSelection || !hasWordTags) return;
        const selectedIndices = selectedUnits
          .map((selected, index) => (selected ? index : -1))
          .filter((index) => index >= 0);
        if (selectedIndices.length === 0) return;
        const startOffset = Math.min(
          ...selectedIndices.map((index) => startOffsets[index] ?? 0)
        );
        const endOffset = Math.max(
          ...selectedIndices.map((index) => endOffsets[index] ?? startOffsets[index] ?? 0)
        );
        const selectedText = selectedIndices.map((index) => units[index]?.text ?? '').join('');
        onCreateSelection({
          line,
          lineIndex,
          selectedIndices,
          selectedText,
          startOffset,
          endOffset: Math.max(endOffset, startOffset + 1),
          totalUnits,
        });
      },
      [
        endOffsets,
        hasWordTags,
        line,
        lineIndex,
        onCreateSelection,
        selectedUnits,
        startOffsets,
        totalUnits,
        units,
      ]
    );

    const handleCheerMark = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!showReciteActions || actionsLocked) return;
        onReciteCheerMark?.(line);
      },
      [actionsLocked, line, onReciteCheerMark, showReciteActions]
    );

    const showInstantSuccess =
      mode === 'recite' &&
      isComplete &&
      (!isPressSelection || pressTimingStatus === 'ok');
    const showFanchantText =
      mode === 'recite'
        ? Boolean(result) || showInstantSuccess
        : Boolean(showFanchant || revealAnswer);

    const fanchantClass = isCheer
      ? 'text-amber-500'
      : mode === 'recite'
        ? result === 'miss'
          ? 'text-rose-500'
          : 'text-emerald-600'
        : 'text-emerald-600';

    const fanchantText = isCheer ? '[CHEER/欢呼]' : line.fanchant?.content ?? '';

    const paddingClass = showReciteActions ? 'px-12' : 'px-6';

    return (
      <div
        role="button"
        tabIndex={0}
        aria-current={isActive}
        data-line-index={lineIndex}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          handleClick();
        }}
        className={`relative isolate w-full overflow-visible rounded-2xl ${paddingClass} py-5 text-center transition ${wrapperClass} ${resultClass}`}
      >
        {showReciteActions ? (
          <>
            <button
              type="button"
              aria-label="Mark cheer on this line"
              onClick={handleCheerMark}
              disabled={actionsLocked}
              style={{ zIndex: 20 }}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              CHEER
            </button>
            <button
              type="button"
              aria-label="Select entire line"
              onClick={handleSelectAll}
              disabled={!canSelect || totalUnits === 0}
              style={{ zIndex: 20 }}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-[color:var(--lyric-action-border)] bg-[color:var(--lyric-action-bg)] px-3 py-1 text-xs font-semibold text-[color:var(--text-muted)] shadow-sm transition hover:bg-[color:var(--lyric-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              全选
            </button>
          </>
        ) : null}
        {showEditActions ? (
          <>
            <button
              type="button"
              aria-label="Clear selection"
              onClick={handleClearSelection}
              disabled={!hasSelection}
              style={{ zIndex: 20 }}
              className="absolute left-4 top-4 rounded-full border border-[color:var(--lyric-action-border)] bg-[color:var(--lyric-action-bg)] px-3 py-1 text-xs font-semibold text-[color:var(--text-muted)] shadow-sm transition hover:bg-[color:var(--lyric-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              重选
            </button>
            <button
              type="button"
              aria-label="Confirm fanchant selection"
              onClick={handleCreateConfirm}
              disabled={!hasSelection || !hasWordTags}
              style={{ zIndex: 20 }}
              className="absolute right-4 top-4 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              完成
            </button>
          </>
        ) : null}
        {showEditActions && !hasWordTags ? (
          <span className="absolute right-4 top-12 text-[11px] font-semibold text-amber-600">
            缺少 [tt] 逐词标签
          </span>
        ) : null}
        <div ref={bodyRef} className="relative z-0 w-full">
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
                className={`rounded-lg border px-3 py-1 text-lg tracking-wide text-[color:var(--lyric-word-text)] transition ${
                  canSelect ? 'cursor-pointer select-none' : ''
                } ${
                  selectedUnits[index]
                    ? 'border-[color:var(--lyric-word-selected-border)] bg-[color:var(--lyric-word-selected-bg)] text-[color:var(--lyric-word-selected-text)] shadow-[0_0_0_2px_var(--lyric-word-selected-ring)]'
                    : 'border-[color:var(--lyric-word-border)] bg-[color:var(--lyric-word-bg)]'
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
              style={isCheer ? { color: '#facc15' } : undefined}
              className={`absolute left-0 text-lg font-semibold uppercase tracking-[0.3em] ${
                fanchantClass
              } ${showFanchantText ? 'opacity-100' : 'opacity-0'}`}
            >
              {fanchantText}
            </div>
          </div>
        </div>
        {result === 'hit' ? <span aria-hidden="true" className="line-spark" /> : null}
      </div>
    );
  }
);

KaraokeLine.displayName = 'KaraokeLine';
