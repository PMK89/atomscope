/**
 * Handing a generated file to the browser: the download anchor and the file names built from the
 * document name. Shared by the image export (File ▸ Export image…) and the spectra exports.
 */

/** Hand the data URL to the browser as a download. */
export function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** A file name stem from the document name: no separators, no surprises. */
export function fileBase(docName: string): string {
  return docName.trim().replace(/[^A-Za-z0-9._-]+/g, '_') || 'atomscope';
}

/** A file name from the document name: no separators, no surprises. */
export function imageFileName(docName: string, type: string): string {
  return `${fileBase(docName)}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
}

/** A text file as a data URL, so it downloads through the same anchor an image does. */
export function textDataUrl(text: string, mime: string): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}
