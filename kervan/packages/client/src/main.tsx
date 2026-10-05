import { render } from 'preact';
import './ui/styles.css';
import { App } from './ui/App';
import { Game } from './game/game';
import { ui } from './ui/store';

const root = document.getElementById('app')!;
const gameRoot = document.createElement('div');
gameRoot.id = 'game-root';
document.body.prepend(gameRoot);

// WebGL2 kontrolü
const test = document.createElement('canvas').getContext('webgl2');
if (!test) {
  root.innerHTML = '<div class="center-screen"><div class="err-text">Tarayıcın WebGL2 desteklemiyor. Güncel Chrome, Edge veya Firefox kullan.</div></div>';
} else {
  const loading = document.createElement('div');
  loading.className = 'center-screen boot';
  loading.innerHTML = '<div class="spinner"></div>Harita ve dokular hazırlanıyor…';
  root.appendChild(loading);
  // dokuların üretilmesi birkaç yüz ms sürer; önce yükleme ekranını çiz
  setTimeout(() => {
    {
      const game = new Game(gameRoot);
      (window as unknown as { kervan: Game }).kervan = game;
      loading.remove();
      game.start();
      render(<App game={game} />, root);
      const params = new URLSearchParams(location.search);
      if (params.get('oda')) ui.screen.value = 'menu';
    }
  }, 50);
}
