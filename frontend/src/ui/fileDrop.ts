/**
 * Dropping a file on the window opens it (Avogadro's MainWindow::dragEnterEvent/dropEvent,
 * mainwindow.cpp:699-717).
 *
 * Avogadro loaded every dropped file, each into a window of its own. Atomscope has one document
 * open at a time, so a drop of several files opens the first and says what happened to the rest
 * rather than opening whichever happened to be last.
 */

/** True when a drag carries files, which is the only kind of drag this window accepts. */
export function hasFiles(transfer: Pick<DataTransfer, 'types'> | null): boolean {
  return transfer != null && [...transfer.types].includes('Files');
}

/** The file a drop opens, and what to tell the user about the ones it does not. */
export function droppedFile(files: readonly File[]): { file: File | null; message: string | null } {
  const [file] = files;
  if (!file) return { file: null, message: 'That drop carried no file' };
  if (files.length === 1) return { file, message: null };
  return {
    file,
    message: `Opened ${file.name}; Atomscope has one document open at a time, so the other ${
      files.length - 1
    } file${files.length > 2 ? 's were' : ' was'} left alone`,
  };
}
