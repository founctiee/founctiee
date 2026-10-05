/**
 * CS2 silah oynanış değerlerini Valve'ın weapons.vdata dosyasından çıkarır.
 * Kaynak: SteamDatabase/GameTracking-CS2 (oyunun kendi script dosyası).
 * Sadece sayısal/mantıksal oynanış alanları alınır; model, ses, parçacık yolları atılır.
 *
 *   npx tsx tools/extract-weapons.ts [yerel/weapons.vdata]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/weapons.vdata';

type KVValue = string | number | boolean | KVValue[] | KVObject;
interface KVObject {
  [key: string]: KVValue;
}

/** KV3 metin formatı için küçük bir ayrıştırıcı (bu dosyanın kullandığı alt küme). */
function parseKV3(text: string): KVObject {
  let i = text.indexOf('-->');
  i = i >= 0 ? i + 3 : 0;

  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text.startsWith('//', i)) {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? text.length : end + 2;
        continue;
      }
      break;
    }
  };

  const readString = (): string => {
    // """ çok satırlı dize
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const s = text.slice(i + 3, end);
      i = end + 3;
      return s;
    }
    i++; // "
    let out = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        out += text[i + 1];
        i += 2;
      } else {
        out += text[i++];
      }
    }
    i++;
    return out;
  };

  const readValue = (): KVValue => {
    skip();
    const c = text[i];
    if (c === '{') return readObject();
    if (c === '[') {
      i++;
      const arr: KVValue[] = [];
      for (;;) {
        skip();
        if (text[i] === ']') {
          i++;
          break;
        }
        arr.push(readValue());
        skip();
        if (text[i] === ',') i++;
      }
      return arr;
    }
    if (c === '"') return readString();
    // çıplak değer: sayı, true/false, null, ya da prefix:"..." (soundevent:, resource_name:)
    const start = i;
    while (i < text.length && !/[\s,\]\}]/.test(text[i]!) && text[i] !== '"') i++;
    let token = text.slice(start, i);
    if (text[i] === '"' && token.endsWith(':')) {
      token += readString();
      return token;
    }
    if (token === 'true') return true;
    if (token === 'false') return false;
    const n = Number(token);
    if (token !== '' && Number.isFinite(n)) return n;
    return token;
  };

  const readObject = (): KVObject => {
    i++; // {
    const obj: KVObject = {};
    for (;;) {
      skip();
      if (text[i] === '}') {
        i++;
        break;
      }
      let key: string;
      if (text[i] === '"') key = readString();
      else {
        const start = i;
        while (i < text.length && !/[\s=]/.test(text[i]!)) i++;
        key = text.slice(start, i);
      }
      skip();
      if (text[i] === '=') i++;
      obj[key] = readValue();
    }
    return obj;
  };

  skip();
  return readObject();
}

/** Oynanışla ilgisi olmayan (görsel/ses/dosya) alanlar. */
const DROP = /^(m_s|m_aShootSounds|m_vecMuzzlePos|m_szModel|m_szAnim|m_Muzzle|m_Eject|m_Tracer|m_.*Particle|m_.*Model|m_.*Sound|m_.*Effect|m_.*Icon|m_.*Hud|m_.*Attachment|m_.*Glow|m_.*Material|m_nRumble|m_iRumble|m_vec)/;

function numericFields(obj: KVObject): Record<string, number | boolean | string | number[]> {
  const out: Record<string, number | boolean | string | number[]> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('m_') || DROP.test(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) out[k] = v as number[];
    else if (typeof v === 'string' && /^(m_GearSlot|m_WeaponType|m_eSilencerType|m_nPrimaryAmmoType|m_WeaponCategory)$/.test(k))
      out[k] = v;
  }
  return out;
}

async function main() {
  const local = process.argv[2];
  const text = local ? readFileSync(local, 'utf8') : await (await fetch(SOURCE_URL)).text();
  const root = parseKV3(text);

  const base = root['statted_item_base'] as KVObject | undefined;
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(root)) {
    if (!name.startsWith('weapon_') || name.endsWith('_prefab') || name === 'weapon_base') continue;
    if (typeof value !== 'object' || Array.isArray(value)) continue;
    const merged: KVObject = { ...(base ?? {}) };
    const prefabName = value['_base'];
    if (typeof prefabName === 'string' && typeof root[prefabName] === 'object') {
      Object.assign(merged, root[prefabName] as KVObject);
    }
    Object.assign(merged, value);
    const fields = numericFields(merged);
    result[name] = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(/^m_/, ''), v]));
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '../packages/shared/src/weapons/weapons.generated.json');
  const payload = {
    _source: SOURCE_URL,
    _note: 'Otomatik üretildi: npm run extract-weapons. Elle düzenlemeyin.',
    weapons: result,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 1) + '\n');
  console.log(`${Object.keys(result).length} silah yazıldı → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
