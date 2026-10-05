/** CS2 tarzı satın alma menüsü: kategoriler, fiyatlar, öldürme ödülleri, sayı kısayolları. */
import { useEffect, useState } from 'preact/hooks';
import { WEAPONS, WeaponDef, Team, EQUIPMENT_PRICES, GRENADE_KEYS, TICK_RATE, Phase } from '@kervan/shared';
import { ui, playerById } from './store';
import { tr } from '../i18n/tr';
import { weaponIcon } from '../render/icons';
import type { Game } from '../game/game';

interface Item {
  key: string;
  name: string;
  price: number;
  award?: number;
  owned?: boolean;
}

function columns(team: Team, game: Game): { title: string; items: Item[] }[] {
  const side = team === Team.T ? 'T' : 'CT';
  const allowed = (w: WeaponDef) => w.team === 'any' || w.team === side;
  const sim = game.sim;
  const owned = (w: WeaponDef) => sim?.inv.primary?.num === w.num || sim?.inv.secondary?.num === w.num;
  const toItem = (w: WeaponDef): Item => ({ key: w.key, name: w.name, price: w.price, award: w.killAward, owned: owned(w) });
  const by = (cats: string[]) => WEAPONS.filter((w) => cats.includes(w.category) && allowed(w)).map(toItem);
  const gi = (k: string) => sim?.inv.grenades[GRENADE_KEYS.indexOf(k as (typeof GRENADE_KEYS)[number])] ?? 0;
  const gear: Item[] = [
    { key: 'vest', name: tr.vest, price: EQUIPMENT_PRICES.vest, owned: (sim?.armor ?? 0) >= 100 },
    { key: 'vesthelm', name: tr.vesthelm, price: (sim?.armor ?? 0) >= 100 && !sim?.helmet ? EQUIPMENT_PRICES.helmetOnly : EQUIPMENT_PRICES.vesthelm, owned: (sim?.armor ?? 0) >= 100 && !!sim?.helmet },
  ];
  if (team === Team.CT) gear.push({ key: 'defuser', name: tr.defuser, price: EQUIPMENT_PRICES.defuser, owned: !!sim?.inv.defuser });
  const nades = WEAPONS.filter((w) => w.category === 'grenade' && allowed(w)).map((w) => ({ ...toItem(w), owned: gi(w.key) > 0 }));
  return [
    { title: tr.pistols, items: by(['pistol']) },
    { title: tr.smgs, items: by(['smg']) },
    { title: tr.heavy, items: by(['heavy']) },
    { title: tr.rifles, items: [...by(['rifle']), ...by(['sniper'])] },
    { title: tr.gear, items: gear },
    { title: tr.grenades, items: nades },
  ];
}

export function BuyMenu({ game }: { game: Game }) {
  const [col, setCol] = useState(-1);
  const open = ui.buyOpen.value;
  const st = ui.state.value;
  const me = playerById(ui.myId.value);
  const team = me?.team ?? Team.T;
  const money = me?.money ?? 0;
  const cols = columns(team, game);

  useEffect(() => {
    if (!open) {
      setCol(-1);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.code.startsWith('Digit')) return;
      const n = Number(e.code.slice(5)) - 1;
      if (n < 0) return;
      e.preventDefault();
      if (col < 0) {
        if (n < cols.length) setCol(n);
      } else {
        const it = cols[col]!.items[n];
        if (it) game.buy(it.key);
        setCol(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, col, team]);

  if (!open || !st) return null;
  const left = st.settings.practice || st.phase === Phase.Warmup ? -1 : Math.max(0, (st.buyEndTick - ui.hud.value.serverTick) / TICK_RATE);
  return (
    <div class="overlay buy-overlay" onClick={(e) => e.target === e.currentTarget && (ui.buyOpen.value = false, game.syncInputState())}>
      <div class="buy-menu">
        <div class="buy-head">
          <div class="title">{tr.buyMenu}</div>
          <div class="money">${money}</div>
          {left >= 0 && <div class="buytime">{`${tr.freeze}: ${Math.ceil(left)} sn`}</div>}
          <div class="hint">B: kapat · 1-6 kategori, sonra ürün numarası</div>
        </div>
        <div class="buy-cols">
          {cols.map((c, ci) => (
            <div key={c.title} class={`buy-col ${col === ci ? 'active' : ''}`}>
              <div class="col-title">
                <span class="num">{ci + 1}</span> {c.title}
              </div>
              {c.items.map((it, ii) => {
                const afford = st.settings.practice || money >= it.price;
                return (
                  <button
                    key={it.key}
                    class={`buy-item ${afford ? '' : 'poor'} ${it.owned ? 'owned' : ''}`}
                    onClick={() => game.buy(it.key)}
                    title={it.award ? `${tr.killAward}: $${it.award}` : ''}
                  >
                    <span class="num">{ii + 1}</span>
                    {it.key !== 'vest' && it.key !== 'vesthelm' && it.key !== 'defuser' ? (
                      <img src={weaponIcon(it.key)} />
                    ) : (
                      <span class="gear-icon">{it.key === 'defuser' ? '✂' : it.key === 'vest' ? '🛡' : '⛑'}</span>
                    )}
                    <span class="name">{it.name}</span>
                    <span class="price">${it.price}</span>
                    {it.award !== undefined && it.award !== 300 && <span class="award">+${it.award}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
