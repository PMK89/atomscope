/**
 * The fragment last cut or copied, kept as a document so that a paste inside Atomscope loses
 * nothing, plus the text written to the system clipboard so a paste can tell ours from another
 * program's.
 */
import { create } from 'zustand';
import type { StructureDoc } from '../model/structure';

interface ClipboardState {
  fragment: StructureDoc | null;
  text: string;
  set: (fragment: StructureDoc, text: string) => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  fragment: null,
  text: '',
  set: (fragment, text) => set({ fragment, text }),
}));
