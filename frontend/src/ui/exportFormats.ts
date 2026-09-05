/**
 * Which format a Save As writes, and what the file is called: the format and the extension follow
 * one another, as they do in a file dialog with format filters (Avogadro's Save As).
 *
 * A format that claims several extensions writes the first one, and an extension claimed by
 * several formats keeps the format already chosen if it is one of them.
 */
import type { FormatDescription } from '../api/client';

/** Formats a structure can be written in, in the order the backend lists them. */
export function writableFormats(formats: FormatDescription[]): FormatDescription[] {
  return formats.filter((f) => f.can_write);
}

/** The extension of `path`, lower case and without the dot; '' when it has none. */
export function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * The format `path` names by its extension, or null when nothing claims it. `current` wins when it
 * is one of the formats that claim the extension, so choosing `extxyz` and typing a name does not
 * silently fall back to `xyz`.
 */
export function formatForPath(
  formats: FormatDescription[],
  path: string,
  current = '',
): string | null {
  const extension = extensionOf(path);
  if (!extension) return null;
  const claiming = writableFormats(formats).filter((f) =>
    f.extensions.some((e) => e.toLowerCase() === extension),
  );
  if (claiming.length === 0) return null;
  if (claiming.some((f) => f.name === current)) return current;
  return claiming[0]!.name;
}

/** `path` with the extension the format writes; a path with no name of its own is left alone. */
export function pathForFormat(formats: FormatDescription[], path: string, format: string): string {
  const wanted = formats.find((f) => f.name === format)?.extensions[0];
  if (!wanted || path.trim() === '') return path;
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(cut + 1);
  const dot = name.lastIndexOf('.');
  // a leading dot is a hidden file, not an extension
  const stem = dot <= 0 ? name : name.slice(0, dot);
  if (stem === '') return path;
  return `${path.slice(0, cut + 1)}${stem}.${wanted}`;
}

/**
 * The format to offer for a document: the one it came from when that format can be written, else
 * CML the way Avogadro defaults to it, else the first writable format there is.
 */
export function defaultFormat(formats: FormatDescription[], sourceFormat?: string | null): string {
  const writable = writableFormats(formats);
  const named = (name: string): boolean => writable.some((f) => f.name === name);
  if (sourceFormat && named(sourceFormat)) return sourceFormat;
  if (named('cml')) return 'cml';
  return writable[0]?.name ?? '';
}
