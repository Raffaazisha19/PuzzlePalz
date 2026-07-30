# Panduan Deployment PuzzlePals (Multiplayer Jigsaw Game)

Platform game puzzle multiplayer real-time ini terbagi menjadi dua bagian: Backend (FastAPI + WebSocket + SQLite) dan Frontend (HTML5 Canvas + Tailwind CSS).

---

## 1. Tahap 1: Setup Backend menggunakan GitHub Codespaces (100% Gratis Tanpa Kartu Kredit)

GitHub Codespaces menyediakan container cloud gratis (60 jam/bulan) yang bisa melakukan port forwarding secara publik untuk WebSockets.

### Langkah-langkah Deployment:
1. Masuk ke repositori GitHub **PuzzlePals** Anda.
2. Klik tombol **Code** (berwarna hijau) -> pilih tab **Codespaces** -> klik **Create codespace on main**.
3. Setelah terminal VS Code online terbuka, jalankan perintah berikut untuk memulai server:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
4. Masuk ke tab **Ports** di bagian bawah VS Code online.
5. Cari port `8000`. Klik kanan pada port tersebut, pilih **Port Visibility** -> ubah dari **Private** menjadi **Public** (wajib agar koneksi WebSocket dari luar diizinkan).
6. Salin alamat **Forwarded Address** yang diberikan (misal: `https://raffa-puzzle-8000.app.github.dev`).
7. Alamat WebSocket Anda adalah: `wss://raffa-puzzle-8000.app.github.dev/ws/`

*Catatan: Codespaces akan mati otomatis (idle) jika tidak ada aktivitas. Jalankan ulang uvicorn jika ingin memainkannya lagi.*

---

## 2. Tahap 2: Setup Frontend ke Cloudflare Pages

Antarmuka frontend bersifat statis dan dideploy melalui Cloudflare Pages untuk keandalan dan kecepatan tinggi.

### Langkah-langkah Deployment:
1. Masuk ke dashboard **Cloudflare Pages**.
2. Buat proyek baru dan sambungkan ke akun **GitHub**.
3. Konfigurasi build setup:
   - **Framework Preset**: `None`
   - **Build command**: (Biarkan kosong).
   - **Build output directory**: `frontend`
4. Klik **Save and Deploy**.
5. Tunggu proses build selesai. Anda akan mendapatkan URL statis `.pages.dev`.

---

## 3. Tahap 3: Konfigurasi Routing WebSocket pada Frontend

Agar frontend dapat melakukan koneksi multiplayer ke backend Codespaces:

1. Di file `frontend/js/app.js` baris 37-39, sesuaikan konstanta URL backend Anda (gunakan alamat Forwarded Address tanpa `https://`):
   ```javascript
   const host = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                ? "localhost:8000"
                : "raffa-puzzle-8000.app.github.dev"; // Ganti dengan domain Forwarded Address Codespaces Anda
   ```
2. Commit perubahan tersebut ke repositori GitHub Anda agar Cloudflare Pages melakukan auto-deploy ulang.
