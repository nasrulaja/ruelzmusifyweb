# RuelzMusify Web

Pemutar YouTube Music di browser lokal. UI mengikuti versi APK, tapi lebih rapi dan responsif di semua ukuran layar.

## Fitur

- **Cari** lagu/artis/album lewat YouTube Music InnerTube (cache 5 menit)
- **Home tidak pernah kosong** — diisi otomatis dari 4 rak kurasi (suasana hati, santai, semangat, klasik) yang di-cache 6 jam di `localStorage`
- **Stream** audio via proxy server (206 Range, seek jalan)
- **Mini player** + **full player** dengan background blur dari artwork
- **Lirik** dari [lyrics.ovh](https://lyrics.ovh) — baris aktif ikut posisi lagu dan disorot
- **Equalizer** 7 band + 6 preset (Datar/Pop/Rock/Jazz/Bass/Vokal), bass boost, dan volume — lewat Web Audio API, tersimpan di `localStorage`
- **Disukai** tersimpan di `localStorage`
- **Antrean**, **acak**, **ulang** (off / semua / satu)
- **Media Session** — kontrol dari lock screen / tombol headset
- **Glassmorphism** — dock, kartu, dan sheet pakai backdrop blur + aurora rose di latar
- Responsif: HP, tablet, desktop

## Prasyarat

- **Node.js 18+**
- **Python** + **yt-dlp** (resolver stream — wajib, karena menangani signature & PO token)

```bash
python -m pip install -U yt-dlp
```

## Menjalankan

```bash
npm install
npm start
```

Buka <http://localhost:7788>

Atau di Windows: klik dua kali `start.cmd`.

## Catatan penting

- **URL `googlevideo` itu terikat IP dan cepat kedaluwarsa**, jadi stream harus lewat proxy server (`/api/stream/:id`). Tidak bisa dipakai langsung dari browser atau di-deploy statis.
- **yt-dlp perlu diperbarui berkala** kalau YouTube mengubah signature:
  ```bash
  python -m pip install -U yt-dlp
  ```
- Hasil pencarian YouTube Music berbeda-beda antar request (A/B testing), karena itu ada cache.

## Tes UI

Menjalankan 22 screenshot (desktop, tablet, HP, plus cold start tanpa riwayat) dan menyimpan screenshot:

```bash
npx playwright install chromium   # sekali saja
npm run test:ui
```

## Struktur

```
server.mjs              Express server: /api/search, /api/stream/:id, /api/thumb/:id, /api/version
public/index.html       Struktur UI (dock / 3 view / full player / 2 sheet)
public/tokens.css       Design token — warna & ukuran, diambil dari app Android
public/layout.css       Shell, top app bar, search bar
public/components.css   Chips, section header, quick picks, list row, grid, shelf, empty state
public/dock.css         Mini player + nav bar (menyatu), jadi rail di ≥1024px
public/player.css       Full player (bottom sheet)
public/glass.css        Lapisan glassmorphism: material dock/kartu/sheet, lirik, equalizer
public/app.js           Logika pemutar, antrean, pencarian, likes, lirik, equalizer
ui-test.mjs             Tes Playwright multi-device
start.cmd               Launcher Windows
```

### Kenapa token-nya begitu

Angka di `tokens.css` bukan karangan — diambil langsung dari source APK:

| Token | Nilai | Sumber |
| --- | --- | --- |
| `--primary` | `#ED5564` | `ui/theme/Theme.kt` → `DefaultThemeColor` |
| `--nav-height` | `78px` | `constants/Dimensions.kt` |
| `--nav-max-width` | `420px` | `constants/Dimensions.kt` |
| `--mini-height` | `70px` | `constants/Dimensions.kt` |
| `--radius-standalone` | `32px` | `FloatingBarStandaloneCornerRadius` |
| `--radius-outer` | `28px` | `FloatingBarOuterCornerRadius` |
| `--radius-junction` | `12px` | `FloatingBarJunctionCornerRadius` |
| `--thumb-list` | `56px` / r`10` | `ListThumbnailSize` / `ThumbnailCornerRadius` |
| `--thumb-grid` | `128px` / r`16` | `GridThumbnailHeight` / `GridThumbnailCornerRadius` |
| `--section-gap` | `28px` | `HomeSectionSpacing` |
| `--feed-max` | `1200px` | `HomeFeedMaxWidth` |

Tema ikut Material 3 Expressive: seed rose, netral ikut kehangatan seed, dan ada varian *pure black*.

## Layout

**Mobile (<1024px)** — persis APK: mini player menempel di atas nav bar, sudutnya melebur jadi satu pil (32px atas, 12px sambungan, 28px bawah).

**Desktop (≥1024px)** — dock yang sama dipindah jadi rail kiri 264px; nav di atas, mini player di kaki rail. Warna, komponen, dan ukuran thumbnail tetap identik.

## Lapisan glass (`glass.css`)

Dimuat paling akhir supaya bisa menimpa permukaan Material tanpa mengubah layout. Tiap panel kaca disusun dari lima lapis: `backdrop-filter` (blur + saturasi), wash gradien tipis, garis spekular `inset 0 1px 0`, border 1px semi-transparan, dan drop shadow.

Variabelnya di `:root`:

| Variabel | Fungsi |
| --- | --- |
| `--glass-blur` / `--glass-sat` | Kekuatan blur dan saturasi |
| `--glass-fill` | Kepekatan wash (otomatis naik di tema terang) |
| `--glass-border` | Alpha border |
| `--glass-highlight` | Alpha garis spekular atas |

Latar diberi aurora rose/plum/biru yang bergerak pelan (dimatikan kalau `prefers-reduced-motion`). Kalau browser tidak mendukung `backdrop-filter`, ada blok `@supports not` yang mengembalikan panel ke warna solid supaya teks tetap terbaca.

**Catatan implementasi:** sheet lirik & equalizer pakai `z-index: 300` (di atas `.fp` yang `200`), dan `.sheet-backdrop` yang tertutup wajib `pointer-events: none` — kalau tidak, overlay transparan selebar layar akan menelan semua klik ke UI di belakangnya.

## Shortcut keyboard

| Tombol | Aksi |
| --- | --- |
| `Space` | Play / pause |
| `Shift` + `→` | Lagu berikutnya |
| `Shift` + `←` | Lagu sebelumnya |
| `L` | Suka / batal suka |
| `/` | Buka pencarian |
| `Esc` | Tutup sheet lirik / equalizer / full player |

