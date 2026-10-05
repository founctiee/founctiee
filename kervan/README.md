# KERVAN — tarayıcıda CS2 tarzı taktiksel nişancı

Arkadaşlarınla tarayıcıdan oynayabileceğin, **CS2'nin hareket fiziğini, silah değerlerini ve
Wingman (2v2) kurallarını** birebir taklit eden çok oyunculu bir FPS. Kurulum gerektiren bir
`.exe` yok: bir kişi sunucuyu çalıştırır, diğerleri linke tıklayıp oyuna girer.

- **Mod:** Wingman 2v2 (tek bomba bölgesi, 16 round, 9'u alan kazanır, 8-8'de uzatma)
- **Harita:** `de_kervan` — orijinal çöl kasabası haritası (uzun koridor, tünel, avlu, orta, A bölgesi)
- **Tick:** 64, yetkili (authoritative) Node.js sunucusu
- **Arayüz:** Türkçe

## Neler CS2 ile aynı?

| Sistem | Nasıl |
| --- | --- |
| Hareket | Source `CGameMovement` portu: `sv_accelerate 5.5`, `sv_friction 5.2`, `sv_airaccelerate 12`, hava hız sınırı 30 u/s, `sv_gravity 800`, zıplama 301.99 u/s (≈57 birim), 18 birim basamak, crouch-jump, stamina, silaha göre azami hız, vurulunca yavaşlama (tagging) |
| Silah değerleri | CS2'nin kendi `weapons.vdata` dosyasından otomatik çıkarılır: hasar, zırh delme, atış hızı, şarjör, mesafe düşüşü, isabetsizlik, toparlanma, recoil seed'i, fiyat, öldürme ödülü |
| Sprey | Valve'ın `CUniformRandomStream` üretecinin portu + recoil tablosu, aim punch / view punch ayrımı (`weapon_recoil_scale 2`, `view_recoil_tracking 0.45`) |
| İsabet | Durma/çömelme/yürüme/zıplama/iniş isabetsizliği, ilk mermi doğruluğu, seed'li spread |
| Hasar | Kafa ×4, mide ×1.25, bacak ×0.75; CS zırh formülü (AK kasklı kafa 111, M4A4 92, AWP 460) |
| Wallbang | `HandleBulletPenetration` formülü, materyale göre (ahşap kasalar delinir, kalın beton delinmez) |
| Bombalar | HE, flaş (açı/mesafe), **hacimsel sis** (duvarlardan taşmaz, mermi/HE ile delinir), molotof/yangın (zemine yayılır, sisle söner), tuzak |
| Ekonomi | $800 başlangıç, CS2 kayıp bonusu serisi, kurma/imha ödülleri, silaha göre öldürme ödülü |
| Ağ | Client prediction + reconciliation, interpolasyon, **lag compensation** (200 ms), subtick ateş zamanı |
| Fare | Ham girdi ve CS2 hassasiyet formülü (`sens × 0.022°`): CS2'deki sens değerini aynen yaz |
| Nişangah | CS2'nin tüm ayarları + **CS2 nişangah kodunu içe aktarma** (`CSGO-xxxxx-…`) |

Görseller, modeller ve sesler bize ait ve kodla üretiliyor. Valve'ın modelleri, dokuları ve
sesleri kullanılmadı, çünkü bunları dağıtmak yasal değil. Sentez sesler CS2'nin kayıtlı
seslerinin birebir aynısı değildir.

## Hızlı başlangıç (kendi bilgisayarında)

Gerekenler: **Node.js 20+** (https://nodejs.org)

```bash
cd kervan
npm install
npm run build
npm start
```

Tarayıcıda **http://localhost:3000** adresini aç (Chrome veya Edge önerilir: ham fare girişi
`unadjustedMovement` en iyi orada çalışır). Takma adını yaz ve **Oda Oluştur**'a bas.
ESC menüsündeki **Davet linkini kopyala** ile linki arkadaşlarına gönder.

Geliştirme modu (değişiklikler anında yansır): `npm run dev` → http://localhost:5173

## Arkadaşlarınla oynamak

Arkadaşlarının sunucuna internetten erişebilmesi gerekiyor. İki yol var:

### A) Kendi bilgisayarından (en kolay, ücretsiz)

1. Oyunu yukarıdaki gibi `npm start` ile başlat.
2. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`cloudflared`) kur ve çalıştır:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Terminalde çıkan `https://….trycloudflare.com` adresini arkadaşlarına gönder.

Not: Bu yolda gecikme senin internet bağlantına bağlıdır. Sen "host" olduğun için ping'in en
düşük olan sensin.

### B) Sunucuya kurmak (en düşük ping, önerilen)

Frankfurt veya İstanbul'da ucuz bir VPS (1 vCPU / 1 GB yeter) kirala ve Docker ile kur:

```bash
git clone <bu repo> && cd <repo>/kervan
docker build -t kervan .
docker run -d --name kervan -p 3000:3000 --restart unless-stopped kervan
```

Ardından `http://SUNUCU_IP:3000` adresine gir. HTTPS için önüne Caddy veya Nginx koyabilirsin
(WebSocket `/ws` yolunu da yönlendirmeyi unutma).

## Oyun akışı

1. Odaya girenler **ısınmada** (warmup) doğar: para $16000, ölünce 2 saniyede yeniden doğarsın.
2. Takımını **M** ile seçebilirsin. Oda kurucusu (host ★) iki takımda da oyuncu olunca
   **ESC → Maçı Başlat**'a basar.
3. Her round: 15 sn hazırlık (satın alma), 1:55 round süresi, C4 40 sn.
4. 8. round sonunda taraf değişir. 9 round alan kazanır, 8-8'de MR2 uzatma oynanır.
5. Host, maç ayarlarını ESC → **Maç Ayarları**'ndan değiştirebilir (round sayısı, süreler,
   para, takım hasarı, uzatma).

**Antrenman** odası: sınırsız para ve mermi, isabet kutuları, bomba yörüngesi çizgisi, ESC
menüsünde noclip/ölümsüzlük. Spreyini ve bomba atışlarını burada çalışabilirsin.

## Kontroller (CS2 varsayılanları)

| Tuş | Eylem | Tuş | Eylem |
| --- | --- | --- | --- |
| W A S D | Hareket | Sol tık / Sağ tık | Ateş / ikincil (dürbün, susturucu, seri atış, ağır bıçak) |
| Boşluk | Zıpla | Ctrl | Çömel |
| Shift | Sessiz yürü | R | Şarjör değiştir |
| E | Kullan / bomba imha / yerdeki silahı al | G | Silahı at |
| F | Silaha bak | B | Satın alma menüsü (1-6 kategori, sonra ürün) |
| 1 / 2 / 3 / 4 / 5 | Ana silah / tabanca / bıçak / bombalar / C4 | Q | Son silah |
| Fare tekerleği | Silah değiştir | Tab | Skor tablosu |
| Y / U | Sohbet (herkes / takım) | M | Takım seçimi |
| " (TR klavyede 1'in solu) | Konsol | ESC | Menü |

Bombalarda sol tık güçlü atış, sağ tık yumuşak (alttan) atış, ikisi birlikte orta güçte atış
yapar. Koşarken atarsan hızın bombaya eklenir (jumpthrow da çalışır).

Bütün tuşlar **Ayarlar → Kontroller**'den değiştirilebilir.

## Konsol komutları

`help` yazınca komut listesi çıkar. Sık kullanılanlar:

```
sensitivity 1.25
cl_crosshairsize 2; cl_crosshairgap -1; cl_crosshairthickness 1
cl_crosshairstyle 4        (4 sabit, 2 dinamik)
viewmodel_fov 68; viewmodel_offset_x 2.5; viewmodel_offset_y 0; viewmodel_offset_z -1.5
net_graph 1; cl_showfps 1
noclip | god | restart | setpos x y z | getpos     (antrenman)
```

## Proje yapısı

```
kervan/
  packages/shared/   istemci ve sunucunun ORTAK simülasyonu (hareket, silah, hasar, bombalar, harita, protokol)
  packages/server/   Node.js + ws: 64 tick yetkili sunucu, lag compensation, Wingman kuralları
  packages/client/   Vite + Three.js + Preact: render, tahmin/interpolasyon, ses, HUD, menüler
  tools/             CS2 weapons.vdata çıkarıcı
```

Komutlar:

```bash
npm test              # hareket, silah, hasar, harita ve maç akışı testleri (vitest)
npm run typecheck     # TypeScript kontrolü
npm run extract-weapons   # CS2 silah değerlerini yeniden çıkar (oyun güncellenince)
```

## Bilinen sınırlar

- FPS ekran yenileme hızıyla sınırlıdır (tarayıcı kuralı). Takılma olursa **Ayarlar → Görüntü**'den
  kaliteyi "Orta" ya da "Düşük" yap veya çözünürlük ölçeğini düşür.

- Grafikler prosedürel low-poly. CS2'nin model ve dokuları kullanılmadığı için birebir aynı
  görünmez.
- Sunucu, duvar arkasındaki rakibin konumunu da gönderiyor (wallhack koruması henüz yok).
  Arkadaş arası oyun için tasarlandı.
- Zeus, R8 ve Dual Berettas henüz eklenmedi.
- İletim WebSocket (TCP) üzerinden. Paket kaybı yüksek bağlantılarda UDP kadar akıcı olmayabilir.

## Kaynaklar ve teşekkür

- Silah değerleri: [SteamDatabase/GameTracking-CS2](https://github.com/SteamDatabase/GameTracking-CS2)
  (`weapons.vdata`, CS2'nin kendi script dosyası).
- Source hareket formülleri için referans: [WebStrafe](https://github.com/yassinsolim/WebStrafe) (MIT).
- Kütüphaneler: three.js, postprocessing, N8AO, Preact, ws, csgo-sharecode.

Counter-Strike ve CS2, Valve Corporation'ın ticari markalarıdır. Bu proje Valve ile bağlantılı
değildir. Hayran yapımı, ticari olmayan bir projedir.
