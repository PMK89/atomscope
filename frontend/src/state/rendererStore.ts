/**
 * The renderer of the mounted viewport, for the few things outside the viewport that need it --
 * exporting an image, for one. The Viewport owns its lifetime; this only remembers which one is
 * live.
 */
import { create } from 'zustand';
import type { Renderer } from '../renderer/Renderer';

interface RendererState {
  renderer: Renderer | null;
  setRenderer: (renderer: Renderer | null) => void;
}

export const useRendererStore = create<RendererState>((set) => ({
  renderer: null,
  setRenderer: (renderer) => set({ renderer }),
}));
