/**
 * The bilingual work vocabulary (#223, ADR 0015): Indonesian and English words common in team work that mean the same thing but
 * share no stem. A search term matches the words of its group as if they were its own. Each group is one Indonesian word first,
 * then its English counterparts; add a form ("released") only when its stem differs from the base form's ("release").
 *
 * To add a pair, append a group below and run the retrieval benchmark (`apps/agent/test/recall-benchmark.test.ts`): it must not
 * lose a hit. Keep to words with one clear work meaning, never a filler word, and never a word that is the same in both languages.
 */
export const WORK_VOCABULARY: readonly (readonly string[])[] = [
  // Planning and meetings
  ["rapat", "meeting"], ["jadwal", "schedule", "scheduled"],["notulen", "minutes"], ["rencana", "plan", "planning"],
  ["keputusan", "decision"], ["tugas", "task"], ["tenggat", "deadline"], ["prioritas", "priority"], ["kemajuan", "progress"],
  ["tujuan", "goal", "objective"], ["strategi", "strategy"], ["hasil", "result", "outcome"], ["ringkasan", "summary"], ["catatan", "note"],
  ["laporan", "report"], ["pengumuman", "announcement"], ["persetujuan", "approval"], ["setuju", "approve", "agree"],
  // Time
  ["mingguan", "weekly"], ["bulanan", "monthly"], ["tahunan", "annual", "yearly"], ["harian", "daily"], ["minggu", "week"],
  ["bulan", "month"], ["tahun", "year"], ["kuartal", "quarter"], ["libur", "holiday"],
  // Releases and change
  ["rilis", "release", "released"], ["luncur", "launch"], ["peluncuran", "launch"], ["tunda", "delay", "postpone"],
  ["undur", "postpone", "delay"], ["batal", "cancel"], ["selesai", "done", "finished", "complete"], ["mulai", "start"],
  ["pindah", "move", "moved"], ["perubahan", "change"], ["ubah", "change"], ["hapus", "delete", "remove"], ["tambah", "add"],
  ["kirim", "send"], ["pembaruan", "update"], ["perbaikan", "fix", "repair"], ["fitur", "feature"],
  // Product and engineering
  ["aplikasi", "application", "app"], ["halaman", "page"], ["tautan", "link"], ["berkas", "file"], ["dokumen", "document"],
  ["desain", "design"], ["pengembangan", "development"], ["pengembang", "developer"], ["pengujian", "testing", "test"], ["uji", "test"],
  ["kesalahan", "error", "mistake"], ["galat", "error"], ["masalah", "problem", "issue"], ["solusi", "solution"], ["gangguan", "outage", "disruption"],
  ["insiden", "incident"], ["peladen", "server"], ["cadangan", "backup"], ["pemulihan", "recovery", "restore"], ["penyimpanan", "storage"],
  ["memori", "memory"], ["jaringan", "network"], ["kinerja", "performance"], ["kecepatan", "speed"], ["kapasitas", "capacity"],
  ["peringatan", "alert", "warning"], ["pemantauan", "monitoring"], ["keamanan", "security"], ["akun", "account"], ["akses", "access"],
  ["izin", "permission"], ["sandi", "password"], ["ekspor", "export", "exported"], ["impor", "import", "imported"],
  ["unggah", "upload"], ["unduh", "download"], ["lokalisasi", "localization", "localisation"], ["terjemahan", "translation"],
  ["bahasa", "language"], ["rekaman", "recording"], ["suara", "sound", "voice"],
  // Money and sales
  ["harga", "price", "pricing"], ["anggaran", "budget"], ["biaya", "cost", "fee"], ["pengeluaran", "expense", "spending", "spend"],
  ["pendapatan", "revenue", "income"], ["keuntungan", "profit"], ["pembayaran", "payment"], ["tagihan", "invoice", "bill", "billing"],
  ["faktur", "invoice"], ["pajak", "tax"], ["keuangan", "finance", "financial"], ["gaji", "salary"], ["diskon", "discount"],
  ["langganan", "subscription"], ["paket", "plan", "package"], ["penawaran", "offer", "quotation"], ["penjualan", "sales"],
  ["pelanggan", "customer", "client"], ["klien", "client"], ["pengguna", "user"], ["pesanan", "order"], ["pengiriman", "shipping", "delivery"],
  ["pemasok", "supplier", "vendor"], ["stok", "stock", "inventory"], ["gudang", "warehouse"], ["kontrak", "contract"], ["lisensi", "license"],
  ["mitra", "partner"], ["dana", "fund", "funding"], ["gratis", "free"], ["batas", "limit"],
  // Marketing
  ["kampanye", "campaign"], ["iklan", "ad", "ads", "advertising"], ["pemasaran", "marketing"], ["promosi", "promotion"], ["merek", "brand"],
  ["konten", "content"], ["artikel", "article"], ["survei", "survey"], ["penelitian", "research"], ["analisis", "analysis"], ["pertumbuhan", "growth"],
  // People and office
  ["anggota", "member"], ["tim", "team"], ["karyawan", "employee"], ["rekrutmen", "recruitment", "hiring"], ["wawancara", "interview"],
  ["pelatihan", "training"], ["kantor", "office"], ["kebijakan", "policy"], ["aturan", "rule"], ["prosedur", "procedure"], ["proyek", "project"],
];
