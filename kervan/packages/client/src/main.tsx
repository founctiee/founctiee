import { render } from 'preact';

function App() {
  return <div style={{ color: '#fff', fontFamily: 'system-ui', padding: 24 }}>Kervan yükleniyor…</div>;
}

render(<App />, document.getElementById('app')!);
