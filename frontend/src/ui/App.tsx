export function App(): JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-menubar">Atomscope</header>
      <main className="app-main">
        <aside className="app-dock app-dock-left">Project</aside>
        <section className="app-viewport" data-testid="viewport" />
        <aside className="app-dock app-dock-right">Properties</aside>
      </main>
      <footer className="app-console">Console</footer>
    </div>
  );
}
