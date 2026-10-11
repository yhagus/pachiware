# Pachiware Agent

[English](README.md) | **Bahasa Indonesia**

Asisten AI self-hosted untuk chat, pengelolaan task, dan otomasi Discord. Dashboard web menyediakan pengaturan model AI, system prompt, skills, task, dan beberapa Discord bot.

Repository ini menggunakan Bun + Hono untuk backend, React + Vite untuk dashboard, Drizzle untuk SQLite/PostgreSQL 18, dan Discord.js untuk bot. Redis bersifat opsional; tanpa Redis, cache menggunakan memori. Data dan konfigurasi dipisahkan per tenant. Aplikasi signup dan billing tidak disertakan.

## Sebelum Instalasi

- Gunakan Linux atau macOS dengan akses terminal dan koneksi internet.
- Bun **1.4.0 atau lebih baru** diperlukan. Installer memasangnya jika belum tersedia. Jika Bun sudah terpasang tetapi lebih lama, jalankan `bun upgrade` terlebih dahulu.
- Docker dengan Compose hanya diperlukan jika memilih PostgreSQL bawaan.
- Siapkan API key provider LLM untuk mulai chat. Token Discord hanya diperlukan jika ingin memakai bot.

## Instalasi

Pilih salah satu metode berikut. Keduanya menjalankan setup yang sama.

### Metode 1: Installer Satu Perintah

```bash
curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | bash
```

Installer menyimpan aplikasi di `~/.pachiware`, memasang dependency, membangun CLI `pachiware`, lalu membuka setup interaktif di terminal.

### Metode 2: Dari Repository

Cocok jika ingin melihat atau mengembangkan source code. Git harus sudah tersedia.

```bash
git clone https://github.com/yhagus/pachiware.git
cd pachiware
bash install.sh
```

Aplikasi menggunakan direktori clone tersebut sebagai direktori instalasi.

### Pilih Database Saat Setup

| Pilihan | Cocok untuk | Yang perlu disiapkan |
| --- | --- | --- |
| **SQLite** | Memulai dengan konfigurasi paling sederhana | Tidak ada layanan tambahan; data disimpan di `data/pachiware.db` |
| **PostgreSQL external** | Menggunakan database yang sudah tersedia | PostgreSQL 18 dan connection URL `postgresql://user:password@host:5432/database` |
| **PostgreSQL 18 Docker** | Menjalankan database dan Redis di mesin sendiri | Docker aktif; setup menyalakan container dan menunggu siap |

Pilih **SQLite** jika belum membutuhkan PostgreSQL. Setup membuat konfigurasi lokal, menjalankan migrasi dan seed, serta menyiapkan tenant default dan akses dashboard otomatis. Pada instalasi baru, kunci platform dan enkripsi dibuat otomatis.

Untuk instalasi otomatis tanpa prompt, contoh berikut memilih SQLite:

```bash
curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | PACHIWARE_DATABASE=sqlite bash
```

Pilihan lain adalah `PACHIWARE_DATABASE=docker`, atau `PACHIWARE_DATABASE=postgres` dengan `PACHIWARE_POSTGRES_URL`. Tanpa terminal interaktif dan tanpa pilihan eksplisit, instalasi baru menggunakan SQLite.

## Jalankan dan Buka Dashboard

Setelah installer selesai:

```bash
pachiware start
```

Jika memakai PostgreSQL Docker, gunakan perintah ini untuk memastikan container ikut dinyalakan:

```bash
pachiware start --docker
```

Buka **http://localhost:3000**. Setelah setup CLI berhasil, dashboard langsung terhubung tanpa mengulang setup wizard atau memasukkan API key operator. Biarkan terminal proses tetap berjalan; `Ctrl+C` menghentikan aplikasi.

Jika perintah `pachiware` belum dikenali, buka terminal baru. Untuk instalasi default, CLI juga bisa dijalankan melalui `~/.pachiware/bin/pachiware`.

Jika instalasi berada di server lain, buat tunnel dari komputer Anda agar dashboard tetap diakses melalui localhost:

```bash
ssh -L 3000:127.0.0.1:3000 user@server
```

Biarkan koneksi SSH terbuka, lalu buka `http://localhost:3000` di komputer Anda. Akses otomatis hanya tersedia melalui localhost; akses langsung lewat alamat IP server memerlukan kredensial operator.

## Selesaikan Konfigurasi dan Mulai Memakai

### 1. Hubungkan Model AI

Di menu **LLM Router**, pilih OpenAI, Anthropic, atau endpoint custom yang kompatibel dengan OpenAI. Masukkan API key, base URL bila diperlukan, dan nama model yang tersedia pada provider Anda. Uji koneksinya lalu simpan konfigurasi.

### 2. Coba Chat dan Task

Buka **Agent Playground** dan kirim pesan untuk memastikan model merespons. Atur perilaku agent lewat **Personality & Prompts**, lalu aktifkan tools yang diperlukan di **Skills & Harnesses**. Coba meminta agent membuat task, lalu periksa hasilnya di **Task Kanban**.

Dashboard bisa dibuka sebelum LLM dikonfigurasi, tetapi chat memerlukan kredensial provider yang valid.

### 3. Hubungkan Discord (Opsional)

1. Buat aplikasi dan bot di [Discord Developer Portal](https://discord.com/developers/applications).
2. Aktifkan **Message Content Intent**, lalu undang bot ke server dengan izin melihat channel, membaca riwayat, dan mengirim pesan. Berikan izin mengelola channel jika ingin memakai tools pengelolaan channel.
3. Di **Discord Bots**, tambahkan nama dan token bot. Isi Application ID dan Guild IDs bila diperlukan, lalu simpan dengan **Enabled** aktif.
4. Periksa status koneksinya, lalu mention bot atau kirim DM untuk mencoba percakapan.

Instalasi siap dipakai ketika dashboard terhubung, chat mendapat respons dari model, dan bot terhubung jika Discord digunakan.

## Perintah Harian

| Perintah | Kegunaan |
| --- | --- |
| `pachiware start` | Menjalankan backend dan dashboard |
| `pachiware start --docker` | Menyalakan PostgreSQL/Redis bawaan dan aplikasi |
| `pachiware status` | Memeriksa status layanan |
| `pachiware doctor` | Memeriksa konfigurasi dan konektivitas |
| `pachiware stop` | Menghentikan aplikasi |
| `pachiware update` | Mengambil pembaruan dan menjalankan migrasi |
| `pachiware --help` | Melihat semua perintah |

Untuk instalasi lama yang belum menyelesaikan setup, jalankan `pachiware init` lalu `pachiware start`. Jika wizard masih muncul, periksa hasil setup dan jalankan `pachiware doctor`; pastikan database yang dipilih dapat diakses.

Sebelum memperbarui aplikasi, cadangkan database dan file konfigurasi di direktori instalasi: `.env`, `runtime-config.json` jika ada, dan `operator-access.json`. Simpan kunci enkripsi bersama backup; kunci tersebut diperlukan untuk membaca kredensial yang tersimpan.

## Isi Repository

```text
apps/agent/       Backend, agent loop, integrasi LLM dan Discord
apps/web/         Dashboard pengelolaan
packages/db/      Schema, migrasi, seed, dan penyimpanan terenkripsi
packages/skills/  Tools bawaan
packages/cli/     Setup dan pengelolaan layanan
PROGRESS.md       Status implementasi dan hasil verifikasi
```

Dokumentasi integrasi tersedia di [API Reference](docs/api.md). Untuk pengembangan, pemeriksaan repository dapat dijalankan dengan `bun test`, `bun run typecheck`, dan `bun run build`.
