# DLMM Exit Bot

Standalone bot untuk **monitor dan exit otomatis** posisi **Meteora DLMM** di Solana.

Bot ini **bukan bagian dari Meridian**. Fokusnya hanya satu: **menutup posisi yang sudah dibuka secara manual** ketika sinyal exit terpenuhi.

---

## Overview

Workflow yang ingin dibangun:

1. **Screening manual**
2. **Open posisi manual**
3. **Monitoring otomatis**
4. **Close otomatis**
5. **Swap hasil close ke SOL otomatis**

Artinya, bot ini **tidak** akan:

- mencari pool baru
- memberi rekomendasi entry
- membuka posisi secara otomatis
- melakukan rotation antar pool

Bot ini hanya akan memantau wallet, mendeteksi posisi DLMM yang sedang aktif, lalu mengambil aksi exit saat kondisi teknikal terpenuhi.

---

## Goal

Membuat bot ringan dan deterministic untuk:

- mengecek apakah wallet memiliki posisi DLMM aktif
- membaca chart OHLCV pool dari Meteora
- menghitung indikator teknikal
- menutup posisi full size ketika sinyal exit muncul
- langsung menukar token hasil close menjadi SOL

---

## Strategy

Bot akan melakukan polling setiap **5 menit**.

### Jika tidak ada posisi terbuka

Bot akan:

- tidak melakukan apa-apa
- menunggu 5 menit
- mengecek ulang

### Jika ada posisi terbuka

Bot akan mengevaluasi apakah posisi perlu di-exit.

Posisi akan di-close jika **salah satu** kondisi berikut terpenuhi:

#### Kondisi 1

- candle menyentuh **upper Bollinger Band**
- `RSI(2) >= 90`

#### Kondisi 2

- candle menyentuh **upper Bollinger Band**
- `MACD histogram` membentuk **green bar pertama**

Jika dua kondisi tersebut **tidak** terpenuhi, posisi tetap dibiarkan berjalan.

---

## Technical Definitions

Supaya implementasi tidak ambigu, bot akan memakai definisi berikut sebagai default:

- **Timeframe**: `1H`
- **Sumber candle**: Meteora OHLCV per pool
- **Touch upper band**: `high >= upper band`
- **MACD green bar pertama**: histogram pertama yang berubah dari merah ke hijau
- **Exit size**: close full position
- **Post-exit action**: hasil token langsung swap ke SOL

---

## Core Behavior

Bot akan meniru pola eksekusi `meridian` untuk bagian yang memang sudah terbukti berjalan:

### 1. Cek posisi wallet

Bot akan meniru cara `meridian` mendeteksi open positions pada wallet:

- baca wallet dari private key
- query posisi DLMM aktif
- identifikasi pool dan position address yang masih terbuka

### 2. Close posisi

Bot akan meniru flow `meridian` saat close:

- resolve position address ke pool
- claim fee jika perlu
- remove liquidity 100%
- close position account jika diperlukan
- verifikasi posisi sudah benar-benar tertutup

### 3. Zap out ke SOL

Setelah close berhasil, bot akan meniru pola `meridian` untuk:

- cek token hasil withdraw di wallet
- swap token tersebut ke SOL

---

## Configuration

Semua parameter utama akan disimpan di file `.env`.

Default yang sudah disepakati:

```env
TIMEFRAME=1H
CANDLE_SOURCE=meteora
BB_TOUCH_RULE=high_gte_upper_band
MACD_GREEN_RULE=first_histogram_red_to_green
EXIT_CLOSE_FULL=true
EXIT_SWAP_TO_SOL=true
POLL_INTERVAL_MINUTES=5
```

Selain itu, bot nantinya juga akan membutuhkan konfigurasi seperti:

```env
WALLET_PRIVATE_KEY=
RPC_URL=
HELIUS_API_KEY=
DRY_RUN=true
TIMEZONE=Asia/Jakarta
```

Untuk notifikasi Telegram, isi juga:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_NOTIFY_STARTUP=true
TELEGRAM_NOTIFY_HOLD=false
TELEGRAM_NOTIFY_ERRORS=true
```

---

## Setup Guide

Panduan ini ditulis untuk alur paling sederhana: install bot di mesin baru, isi konfigurasi, lalu jalankan dulu dalam mode `dry run`.

### 1. Siapkan requirement

Pastikan mini PC kamu punya:

- Node.js `18+`
- `npm`
- koneksi internet stabil
- wallet Solana yang memang ingin dipantau
- RPC URL aktif
- API key Helius aktif

Cek versi Node dan npm:

```bash
node -v
npm -v
```

### 2. Pindahkan project ke mesin target

Masuk ke folder project:

```bash
cd standalone-exit-bot
```

Kalau folder ini belum ada di mini PC, pindahkan dulu seluruh folder `standalone-exit-bot` ke mesin tersebut.

### 3. Install dependency

Jalankan:

```bash
npm install
```

Ini akan:

- install dependency Node.js
- install Meteora SDK
- menjalankan patch kompatibilitas SDK setelah install

### Alternatif cepat: one-shot installer

Kalau kamu tidak ingin setup manual satu per satu, gunakan installer Bash:

```bash
chmod +x install.sh
./install.sh
```

Installer ini akan:

- menanyakan input untuk `.env`
- membuat file `.env`
- menjalankan `npm install`
- install `pm2` jika belum ada
- menjalankan bot di background via `pm2`
- menyimpan proses `pm2`

Minimal requirement untuk installer ini:

- `node`
- `npm`

Catatan:

- installer ini belum meng-install Node.js secara otomatis
- jadi paling aman pastikan Node.js `18+` dan `npm` sudah ada di mini PC
- setelah selesai, cek status dengan `pm2 status`

### 4. Buat file `.env`

Copy file contoh:

```bash
cp .env.example .env
```

### 5. Isi konfigurasi `.env`

Minimal isi bagian ini:

```env
WALLET_PRIVATE_KEY=your_base58_private_key
RPC_URL=https://your-solana-rpc
HELIUS_API_KEY=your_helius_api_key
DRY_RUN=true
```

Default strategy yang sudah sesuai desain bot ini:

```env
TIMEFRAME=1H
CANDLE_SOURCE=meteora
BB_TOUCH_RULE=high_gte_upper_band
MACD_GREEN_RULE=first_histogram_red_to_green
EXIT_CLOSE_FULL=true
EXIT_SWAP_TO_SOL=true
POLL_INTERVAL_MINUTES=5
```

Catatan:

- `WALLET_PRIVATE_KEY` harus dalam format base58
- `RPC_URL` dipakai untuk eksekusi transaksi close
- `HELIUS_API_KEY` dipakai untuk cek balance token hasil close
- `DRY_RUN=true` artinya bot hanya simulasi, tidak mengirim transaksi live
- `TIMEZONE=Asia/Jakarta` membuat log tampil sesuai GMT+7
- `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` dipakai untuk notifikasi Telegram

### 5a. Telegram notifications

Jika Telegram diisi, bot akan mengirim notifikasi untuk:

- startup bot
- exit triggered
- close success
- swap success
- error penting

Secara default, status `hold` tidak dikirim agar chat tidak spam.

### 6. Jalankan bot dalam mode dry run

Gunakan:

```bash
npm run dev
```

Bot akan:

- start loop monitoring
- cek open positions dari wallet
- ambil candle OHLCV dari Meteora
- hitung BB, RSI(2), dan MACD
- memutuskan apakah sinyal exit muncul
- hanya simulasi close/swap karena masih dry run

### 7. Cek output log

Bot akan menulis log ke console dan ke folder:

```text
logs/
```

Kalau tidak ada posisi terbuka, perilaku normalnya seperti ini:

- bot mendeteksi tidak ada posisi
- bot tidur 5 menit
- bot cek ulang

Kalau ada posisi terbuka, perilaku normalnya seperti ini:

- bot evaluasi posisi satu per satu
- kalau sinyal belum valid, posisi tetap hold
- kalau sinyal valid dan masih `DRY_RUN=true`, bot hanya melaporkan aksi simulasi

### 8. Pindah ke mode live

Kalau dry run sudah aman, ubah:

```env
DRY_RUN=false
```

Lalu jalankan:

```bash
npm start
```

Dalam mode live, bot bisa:

- close posisi DLMM
- claim fee jika perlu
- remove liquidity 100%
- swap token hasil close ke SOL

### 9. Menjalankan bot di background

Kalau kamu ingin bot tetap hidup setelah terminal ditutup, kamu bisa pakai tool seperti:

- `pm2`

Contoh manual dengan `pm2`:

```bash
npm install -g pm2
pm2 start src/index.js --name dlmm-exit-bot
pm2 save
```

Cek status:

```bash
pm2 status
```

Lihat log:

```bash
pm2 logs dlmm-exit-bot
```

Restart bot:

```bash
pm2 restart dlmm-exit-bot
```

Stop bot:

```bash
pm2 stop dlmm-exit-bot
```

### 10. Checklist sebelum live

Sebelum live, cek ini dulu:

- `.env` terisi benar
- `DRY_RUN=false` hanya setelah dry run lolos
- wallet yang dipakai memang wallet target
- ada saldo SOL cukup untuk fee transaksi
- timeframe sudah sesuai keinginan
- mini PC punya koneksi internet dan RPC yang stabil

---

## Scope

### In Scope

- monitor posisi DLMM aktif
- hitung sinyal exit dari candle chart
- close otomatis saat sinyal valid
- swap otomatis ke SOL setelah close
- loop polling setiap 5 menit
- mode dry run untuk testing

### Out of Scope

- auto entry
- auto screening
- auto deploy
- AI decision making
- portfolio optimization
- multi-strategy rotation

---

## Proposed Architecture

Struktur awal yang kemungkinan akan kita buat:

```text
standalone-exit-bot/
  README.md
  .env.example
  package.json
  src/
    config.js
    logger.js
    chart.js
    indicators.js
    meteora.js
    wallet.js
    monitor.js
    index.js
```

### Module responsibilities

- `config.js`: load dan validasi env
- `chart.js`: ambil candle OHLCV dari Meteora berdasarkan pool
- `indicators.js`: hitung Bollinger Bands, RSI(2), dan MACD
- `meteora.js`: cek posisi DLMM dan close position
- `wallet.js`: cek token balance dan swap ke SOL
- `monitor.js`: loop monitoring + rule evaluation
- `index.js`: entry point bot

---

## Execution Loop

Secara sederhana, loop bot akan seperti ini:

```text
start
  -> check open positions
  -> if none: sleep 5 minutes
  -> if exists:
       -> fetch chart data
       -> compute BB / RSI / MACD
       -> evaluate exit rules
       -> if exit:
            -> close position
            -> swap tokens to SOL
       -> else:
            -> keep position running
  -> repeat
```

---

## Design Principles

Bot ini akan dibuat dengan prinsip:

- **simple**
- **deterministic**
- **focused**
- **easy to audit**
- **safe for dry-run testing**

Tujuannya bukan membuat framework besar, tapi membuat tool yang jelas, sempit, dan bisa diandalkan untuk satu pekerjaan spesifik: **exit posisi DLMM secara otomatis**.

---

## Current Status

Saat ini kita sudah menyepakati:

- bot berdiri sendiri, bukan bagian dari Meridian
- screening tetap manual
- open posisi tetap manual
- close posisi otomatis
- swap hasil close ke SOL otomatis
- parameter default teknikal disimpan di `.env`
- integrasi close dan zap out akan meniru pola `meridian`

Langkah berikutnya adalah mengubah spesifikasi ini menjadi implementasi kode.

---

## Suggested Repository Name

Kalau project ini akan dipublish ke GitHub, nama repo yang disarankan:

`meteora-dlmm-exit-bot`

---

## Scaffold Status

Project scaffold awal sudah disiapkan dengan:

- `package.json`
- `.env.example`
- adapter config dan logger
- module Meteora untuk cek posisi dan close posisi
- module wallet untuk swap hasil close ke SOL
- module indikator untuk Bollinger Bands, RSI(2), dan MACD
- monitor loop polling 5 menit

Catatan penting:

- adapter chart Meteora sudah dipasang
- source candle membaca OHLCV pool langsung dari Meteora
- fetch candle dilakukan dalam window kecil dan digabung agar lebih stabil
- swap hasil close ke SOL tetap memakai Jupiter swap API
