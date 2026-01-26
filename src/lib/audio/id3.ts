export interface Id3Tags {
  title?: string;
  artist?: string;
  album?: string;
}

const readSyncSafeInt = (bytes: Uint8Array) =>
  (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];

const readInt32 = (bytes: Uint8Array) =>
  (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];

const trimText = (value: string) => value.replace(/\u0000/g, '').trim();

const decodeTextFrame = (data: Uint8Array, encodingByte: number) => {
  if (data.length === 0) return '';
  let encoding = 'utf-8';
  if (encodingByte === 0x00) encoding = 'latin1';
  if (encodingByte === 0x01) encoding = 'utf-16';
  if (encodingByte === 0x02) encoding = 'utf-16be';
  if (encodingByte === 0x03) encoding = 'utf-8';
  try {
    return trimText(new TextDecoder(encoding).decode(data));
  } catch {
    return trimText(new TextDecoder('utf-8').decode(data));
  }
};

export const parseId3Tags = (buffer: ArrayBuffer): Id3Tags => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10) return {};
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return {};

  const version = bytes[3];
  const tagSize = readSyncSafeInt(bytes.subarray(6, 10));
  const end = Math.min(bytes.length, 10 + tagSize);

  const tags: Id3Tags = {};
  let offset = 10;
  while (offset + 10 <= end) {
    const frameId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    if (frameId.trim() === '') break;

    const sizeBytes = bytes.subarray(offset + 4, offset + 8);
    const frameSize = version === 4 ? readSyncSafeInt(sizeBytes) : readInt32(sizeBytes);
    if (frameSize <= 0) break;

    const dataStart = offset + 10;
    const dataEnd = dataStart + frameSize;
    if (dataEnd > end) break;

    if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB') {
      const encodingByte = bytes[dataStart];
      const textData = bytes.subarray(dataStart + 1, dataEnd);
      const value = decodeTextFrame(textData, encodingByte);
      if (value) {
        if (frameId === 'TIT2') tags.title = value;
        if (frameId === 'TPE1') tags.artist = value;
        if (frameId === 'TALB') tags.album = value;
      }
    }

    offset = dataEnd;
  }

  return tags;
};
