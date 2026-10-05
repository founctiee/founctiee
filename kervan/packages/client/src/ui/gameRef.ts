/**
 * Oyun nesnesine UI'den erişim. Bilerek Preact prop'u olarak geçirilmez: prop'lar DOM düğümü
 * üzerinden (#app.__k…props) okunabildiği için bir script oyun nesnesini oradan bulabiliyordu.
 */
import type { Game } from '../game/game';

let current: Game | null = null;

export function setGame(g: Game) {
  current = g;
}

export function getGame(): Game {
  return current!;
}
