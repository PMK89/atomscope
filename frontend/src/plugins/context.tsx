/**
 * How a component reaches the registry. There is no default: the application provides its own
 * registry at the top of the tree (App.tsx) and a test provides one of its own, which is what
 * keeps a test plugin out of the application's. Nothing here imports the built-ins, so the
 * registry can never become a cycle between `plugins/` and the panels it registers.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { PluginRegistry } from './registry';

const PluginContext = createContext<PluginRegistry | null>(null);

export function PluginProvider({
  registry,
  children,
}: {
  registry: PluginRegistry;
  children: ReactNode;
}): JSX.Element {
  return <PluginContext.Provider value={registry}>{children}</PluginContext.Provider>;
}

export function usePlugins(): PluginRegistry {
  const registry = useContext(PluginContext);
  if (!registry) throw new Error('no PluginProvider above this component');
  return registry;
}
