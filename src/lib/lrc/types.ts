export type FanchantType = 'repeat' | 'diff' | 'cheer';

export interface WordTag {
  charIndex: number; // grapheme index in text
  offset: number; // ms offset from line start
}

export interface FanchantTag {
  content: string;
  duration: number;
  type: FanchantType;
  startTime: number;
  endTime: number; // startTime + duration
  fullLine?: boolean;
  autoDuration?: boolean;
}

export interface LyricLine {
  id: string;
  startTime: number; // ms
  text: string;
  words: WordTag[];
  fanchant?: FanchantTag;
}
