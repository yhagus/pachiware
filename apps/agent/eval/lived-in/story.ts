/**
 * The lived-in exam's story (#252): three and a half months of one guild, a small team building Gema, a podcast recording app.
 * Everything a question session asks about is written here by hand, in the words a team and the bot would have used; `corpus.ts`
 * renders it into the Workspace files the bot keeps (Daily logs, Minutes, Decisions, Notes, Documents, Tasks) and the git history
 * its git stub serves, and fills every other working day with routine Daily logs. Names, products and repositories are made up.
 *
 * Threads the sessions lean on, and their traps:
 * - Loudness normalization: discussed and done in audio-core (#88), not yet in the app (#140 open). Distractor: database normalization.
 * - Default export format: AAC 128 kbps (15 July), replaced by Opus 64 kbps (9 September). Distractor: the listener-stats CSV export.
 * - Supabase: only ever an idea in one Daily log; the recorded Decision is staying on Firebase.
 * - Public beta: 1 September (22 July), moved to 20 October (26 August), discussed in Indonesian.
 * - Pricing: Rp 49.000 proposed, Rp 39.000 decided; the student discount still open.
 * - Bluetooth mic latency: an issue, a late Task with Progress notes. Distractors: API latency, monitoring latency.
 * - Noise suppression: RNNoise in English Minutes, a pull request, a Note in Indonesian. Distractor: "noisy" analytics.
 * - Offline sync: a pull request closed without merging, another open, the Task in progress.
 * - The minimum Android version: only in a Document.
 * - Last week's resampler work: five Daily logs and a merged pull request.
 * - A crash on iOS 17 talked about yesterday: a Daily log and an issue, no Task.
 */

export type Channel = "general" | "audio-engine" | "mobile" | "marketing";
export type Lang = "id" | "en";
/** The channel the sessions are asked in: the harness's channel-1, named #general. */
export const HOME: Channel = "general";
export const START = "2026-07-01", END = "2026-10-13";
/** A public holiday: nobody talks, no Daily log. */
export const HOLIDAYS = ["2026-08-17"];
export const ZONE = "Asia/Jakarta";

/** The team besides the harness's Alice (product lead) and Bob (Android). */
export const MEMBERS = [
  { id: "user-rani", name: "Rani" }, // audio engine lead, writes English
  { id: "user-bayu", name: "Bayu" }, // mobile lead
  { id: "user-sekar", name: "Sekar" }, // marketing
  { id: "user-joko", name: "Joko" }, // QA
  { id: "user-mira", name: "Mira" }, // design
  { id: "user-tomi", name: "Tomi" }, // backend
];
export const PEOPLE: Record<string, string> = { Alice: "user-alice", Bob: "user-bob", ...Object.fromEntries(MEMBERS.map((m) => [m.name, m.id])) };

/** Each channel's language (it sets the Daily logs' and Minutes' labels) and who usually talks there. */
export const CHANNELS: Record<Channel, { language: Lang; people: string[] }> = {
  general: { language: "id", people: ["Alice", "Tomi", "Joko", "Sekar", "Bayu", "Mira"] },
  "audio-engine": { language: "en", people: ["Rani", "Joko", "Alice", "Bayu"] },
  mobile: { language: "en", people: ["Bayu", "Bob", "Mira", "Joko", "Alice"] },
  marketing: { language: "id", people: ["Sekar", "Mira", "Alice"] },
};

type Keywords = { topics: string[]; keywords: string[] };
/** [owner, task, due as said] */
export type Action = [string | null, string, string | null];

export interface StoryMinutes {
  channel: Channel; date: string; /** Start, WIB. */ at: string; minutes: number; count: number; title: string; language: Lang;
  participants: string[]; decided: string[]; open: string[]; actions: Action[]; requester?: string; keywords: Keywords;
}
export interface StoryDay {
  channel: Channel; date: string; people: string[]; count: number;
  /** [name, Indonesian keywords, English keywords] */
  topics: [string, string[], string[]][];
  decided?: string[]; open?: string[]; next?: Action[];
}
export interface StoryDecision { channel: Channel; date: string; slug: string; text: string; keywords: Keywords }
export interface StoryNote { channel: Channel; date: string; slug: string; author: string; askedBy: string; text: string; keywords: Keywords }
export interface StoryDocument { channel: Channel; name: string; text: string; keywords?: Keywords }
export type Status = "pending" | "in_progress" | "completed" | "cancelled";
export interface StoryTask {
  channel: Channel; title: string; status: Status; assignee?: string; due?: string; created: string; by: string;
  description?: string; /** [date, who, text] */ notes?: [string, string, string][];
}
export interface StoryPull { repo: string; number: number; title: string; created: string; mergedAt?: string; closedAt?: string; author: string }
export interface StoryIssue { repo: string; number: number; title: string; created: string; closedAt?: string }
export interface StoryCommit { repo: string; date: string; message: string }

export const MINUTES: StoryMinutes[] = [
  {
    channel: "general", date: "2026-07-08", at: "10:00", minutes: 50, count: 41, title: "Rapat arsitektur backend", language: "id",
    participants: ["Alice", "Tomi", "Bayu", "Rani"],
    decided: ["Backend tetap di Firebase (Firestore + Auth) sampai beta selesai", "Upload rekaman langsung ke Cloud Storage, bukan lewat API"],
    open: ["Biaya Firestore kalau pengguna aktif lewat 50 ribu"],
    actions: [["Tomi", "Pasang budget alert di GCP", "minggu depan"], ["Bayu", "Ukur waktu upload rekaman 30 menit lewat 4G", null]],
    keywords: { topics: ["arsitektur backend", "Firebase", "upload rekaman"], keywords: ["arsitektur", "backend", "Firebase", "Firestore", "Auth", "Cloud Storage", "upload", "biaya", "cost", "architecture", "database", "budget alert", "GCP"] },
  },
  {
    channel: "audio-engine", date: "2026-07-14", at: "14:00", minutes: 45, count: 36, title: "Noise suppression", language: "en",
    participants: ["Rani", "Joko", "Alice"],
    decided: ["Use RNNoise as the base for noise suppression, retrained on our own recordings", "Noise suppression runs on the device, never on the server"],
    open: ["CPU budget on low-end phones such as the Redmi 9A"],
    actions: [["Rani", "Prototype RNNoise in audio-core", "Aug 21"], ["Joko", "Collect noisy samples: cafe, motorbike, rain", "next Friday"]],
    keywords: { topics: ["noise suppression", "RNNoise", "on-device processing"], keywords: ["noise suppression", "noise reduction", "peredam bising", "redam noise", "RNNoise", "model", "denoise", "CPU", "low-end", "hp murah", "Redmi 9A", "samples", "sampel suara"] },
  },
  {
    channel: "audio-engine", date: "2026-07-15", at: "10:30", minutes: 40, count: 29, title: "Export formats", language: "en",
    participants: ["Rani", "Bayu", "Alice"],
    decided: ["Default export is AAC-LC 128 kbps stereo", "MP3 192 kbps stays available as an option"],
    open: ["Whether iOS can play Opus files from the share sheet"],
    actions: [["Rani", "Wire the AAC encoder into the export pipeline", "end of July"]],
    keywords: { topics: ["export format", "AAC", "MP3"], keywords: ["export", "ekspor", "format ekspor", "default format", "AAC", "MP3", "Opus", "bitrate", "128 kbps", "encoder", "audio format", "kompatibilitas"] },
  },
  {
    channel: "general", date: "2026-07-20", at: "09:30", minutes: 60, count: 52, title: "Kickoff kuartal tiga", language: "id",
    participants: ["Alice", "Rani", "Bayu", "Bob", "Sekar", "Joko", "Mira", "Tomi"],
    decided: ["Fokus Q3: rekam, edit, ekspor yang rapi, lalu beta publik", "Rilis internal tiap Jumat lewat TestFlight dan Play internal testing"],
    open: ["Siapa yang pegang dokumentasi bantuan"],
    actions: [["Alice", "Tulis PRD Gema v1", "akhir Juli"], ["Sekar", "Susun rencana peluncuran beta", null]],
    keywords: { topics: ["kickoff Q3", "roadmap", "rilis internal"], keywords: ["kickoff", "Q3", "roadmap", "rencana", "prioritas", "beta", "rilis internal", "internal release", "TestFlight", "PRD", "planning"] },
  },
  {
    channel: "marketing", date: "2026-07-22", at: "13:00", minutes: 45, count: 33, title: "Rencana peluncuran beta", language: "id",
    participants: ["Sekar", "Mira", "Alice"],
    decided: ["Beta publik rilis 1 September 2026", "Peluncuran lewat komunitas podcaster dulu, iklan berbayar setelahnya"],
    open: ["Perlu waitlist atau langsung buka"],
    actions: [["Sekar", "Siapkan press kit beta", "25 Agustus"], ["Mira", "Aset visual store listing", "21 Agustus"]],
    keywords: { topics: ["peluncuran beta", "tanggal rilis", "press kit"], keywords: ["peluncuran", "launch", "beta publik", "public beta", "tanggal rilis", "release date", "1 September", "press kit", "store listing", "komunitas podcaster", "waitlist"] },
  },
  {
    channel: "mobile", date: "2026-07-29", at: "15:00", minutes: 35, count: 27, title: "Waveform editor", language: "en",
    participants: ["Bayu", "Mira", "Bob", "Alice"],
    decided: ["Trim and cut ship first; undo comes later", "The waveform is drawn from a precomputed peak file, not live"],
    open: ["How far a pinch zoom may go on long episodes"],
    actions: [["Bayu", "Build trim and cut", "Aug 14"], ["Mira", "Design the trim handles", "Aug 5"]],
    keywords: { topics: ["waveform editor", "trim and cut", "undo"], keywords: ["waveform", "editor", "trim", "cut", "potong", "undo", "zoom", "peak file", "editing", "edit audio"] },
  },
  {
    channel: "general", date: "2026-08-03", at: "10:00", minutes: 25, count: 22, title: "Ritme kerja tim", language: "id",
    participants: ["Alice", "Tomi", "Joko", "Mira"],
    decided: ["Standup jam 10 pagi tiap hari kerja, maksimal 15 menit", "Weekly sync tiap Senin jam 14"],
    open: [],
    actions: [["Alice", "Kirim undangan kalender standup", "hari ini"]],
    keywords: { topics: ["ritme kerja", "standup", "weekly sync"], keywords: ["standup", "rapat harian", "daily meeting", "weekly", "sync", "jadwal", "schedule", "kalender", "ritme kerja"] },
  },
  {
    channel: "marketing", date: "2026-08-05", at: "13:30", minutes: 40, count: 31, title: "Diskusi harga", language: "id",
    participants: ["Sekar", "Alice", "Mira"],
    decided: ["Ada paket gratis dengan batas 3 jam rekaman per bulan"],
    open: ["Usulan paket Pro Rp 49.000 per bulan; Alice minta dibandingkan dulu dengan harga kompetitor"],
    actions: [["Sekar", "Riset harga kompetitor", "12 Agustus"]],
    keywords: { topics: ["harga", "paket gratis", "paket Pro"], keywords: ["harga", "pricing", "price", "paket Pro", "Pro plan", "premium", "langganan", "subscription", "gratis", "free plan", "Rp 49.000", "kompetitor"] },
  },
  {
    channel: "mobile", date: "2026-08-11", at: "11:00", minutes: 30, count: 24, title: "Android release train", language: "en",
    participants: ["Bob", "Bayu", "Joko"],
    decided: ["Android ships on the same weekly train as iOS", "Internal testing track first, closed testing a day later"],
    open: [],
    actions: [["Bob", "Set up the Play Console release tracks", "Friday"]],
    keywords: { topics: ["Android release", "release train", "Play Console"], keywords: ["Android", "release", "rilis", "release train", "Play Console", "internal testing", "closed testing", "weekly", "mingguan"] },
  },
  {
    channel: "audio-engine", date: "2026-08-12", at: "14:00", minutes: 50, count: 44, title: "Loudness normalization", language: "en",
    participants: ["Rani", "Joko", "Bayu", "Alice"],
    decided: ["Normalize every export to -16 LUFS integrated, true peak at -1 dBTP", "Loudness is measured over the whole episode (EBU R128), not per segment"],
    open: ["Music-heavy shows may need -14 LUFS; revisit after the beta"],
    actions: [["Rani", "Implement loudness normalization in the export pipeline", "Aug 28"], ["Joko", "Build a loudness test set of 20 episodes", "Aug 26"]],
    keywords: { topics: ["loudness normalization", "LUFS target", "EBU R128"], keywords: ["loudness", "normalization", "normalisasi", "normalisasi volume", "volume", "LUFS", "-16 LUFS", "true peak", "dBTP", "EBU R128", "export", "ekspor", "volume rata"] },
  },
  {
    channel: "audio-engine", date: "2026-08-19", at: "10:00", minutes: 30, count: 25, title: "Audio spec review", language: "en",
    participants: ["Rani", "Bayu", "Joko"],
    decided: ["The audio spec v2 is the reference for sample rates and buffer sizes", "Recording buffer stays at 10 ms"],
    open: [],
    actions: [["Rani", "Publish audio spec v2 in files", "this week"]],
    keywords: { topics: ["audio spec", "buffer size"], keywords: ["audio spec", "spesifikasi audio", "sample rate", "buffer", "latency", "spec v2", "recording", "rekaman"] },
  },
  {
    channel: "general", date: "2026-08-26", at: "14:00", minutes: 55, count: 47, title: "Go/no-go beta publik", language: "id",
    participants: ["Alice", "Sekar", "Bayu", "Bob", "Rani", "Joko"],
    decided: ["Beta publik mundur ke Selasa 20 Oktober 2026", "Alasannya bug latency mic Bluetooth di Android dan offline sync belum siap"],
    open: ["Apakah tester tertutup boleh tetap pakai build lama"],
    actions: [["Sekar", "Kabari komunitas soal tanggal baru", "Jumat"], ["Bob", "Prioritaskan bug latency Bluetooth", null]],
    keywords: { topics: ["go/no-go beta", "tanggal beta mundur"], keywords: ["go/no-go", "beta publik", "public beta", "mundur", "postpone", "delay", "20 Oktober", "tanggal rilis", "launch date", "Bluetooth", "offline sync"] },
  },
  {
    channel: "marketing", date: "2026-08-31", at: "13:00", minutes: 30, count: 26, title: "Konten countdown beta", language: "id",
    participants: ["Sekar", "Mira"],
    decided: ["Countdown 14 hari di Instagram dan TikTok mulai 6 Oktober"],
    open: [],
    actions: [["Sekar", "Jadwal konten countdown beta", "5 Oktober"]],
    keywords: { topics: ["countdown beta", "konten sosial media"], keywords: ["countdown", "hitung mundur", "Instagram", "TikTok", "konten", "content", "social media", "beta", "jadwal posting"] },
  },
  {
    channel: "mobile", date: "2026-09-01", at: "10:00", minutes: 60, count: 58, title: "Bug bash", language: "en",
    participants: ["Joko", "Bayu", "Bob", "Mira", "Alice"],
    decided: ["Bluetooth mic latency is the top blocker for the beta"],
    open: ["Whether the waveform zoom bug blocks the beta"],
    actions: [["Bob", "Fix Bluetooth mic latency on Android", "Oct 7"], ["Joko", "Write the beta test plan", null]],
    keywords: { topics: ["bug bash", "beta blockers"], keywords: ["bug bash", "bugs", "blocker", "Bluetooth", "latency", "mic", "mikrofon", "waveform", "test plan", "QA"] },
  },
  {
    channel: "audio-engine", date: "2026-09-09", at: "14:00", minutes: 45, count: 39, title: "Export format review", language: "en",
    participants: ["Rani", "Bayu", "Joko", "Alice"],
    decided: ["The default export becomes Opus 64 kbps mono for voice episodes, replacing AAC 128 kbps", "AAC 128 kbps stays as Compatibility mode in the export sheet"],
    open: ["Whether music shows should default to Opus 96 kbps stereo"],
    actions: [["Rani", "Switch the default encoder to Opus 64 kbps", "Sep 18"], ["Bayu", "Add a Compatibility mode toggle to the export sheet", "Sep 25"]],
    keywords: { topics: ["export format review", "Opus default", "Compatibility mode"], keywords: ["export", "ekspor", "format ekspor", "default format", "Opus", "64 kbps", "AAC", "128 kbps", "Compatibility mode", "mode kompatibilitas", "file size", "ukuran file", "encoder"] },
  },
  {
    channel: "marketing", date: "2026-09-16", at: "13:00", minutes: 45, count: 37, title: "Finalisasi harga", language: "id",
    participants: ["Sekar", "Alice", "Mira", "Tomi"],
    decided: ["Paket Pro Rp 39.000 per bulan atau Rp 349.000 per tahun", "Paket gratis tetap 3 jam rekaman per bulan"],
    open: ["Diskon pelajar 50%: belum diputuskan, Alice mau lihat data survei dulu"],
    actions: [["Mira", "Update harga di landing page", "12 Oktober"], ["Tomi", "Pasang harga baru di RevenueCat", null]],
    keywords: { topics: ["finalisasi harga", "paket Pro", "diskon pelajar"], keywords: ["harga", "pricing", "price", "paket Pro", "Pro plan", "premium", "langganan", "subscription", "monthly", "bulanan", "tahunan", "Rp 39.000", "diskon pelajar", "student discount"] },
  },
  {
    channel: "general", date: "2026-09-17", at: "10:30", minutes: 35, count: 28, title: "Migrasi database", language: "id",
    participants: ["Tomi", "Joko", "Alice"],
    decided: ["Tabel shows dipisah dari episodes (normalisasi skema)", "Migrasi jalan Minggu 20 September 02:00 WIB, downtime maksimal 15 menit"],
    open: [],
    actions: [["Tomi", "Tulis script migrasi dan rollback", "Sabtu"], ["Joko", "Tes migrasi di staging", "Jumat"]],
    keywords: { topics: ["migrasi database", "normalisasi skema", "downtime"], keywords: ["migrasi", "migration", "database", "basis data", "schema", "skema", "normalisasi", "normalization", "tabel", "episodes", "shows", "downtime", "maintenance"] },
  },
  {
    channel: "mobile", date: "2026-09-23", at: "15:00", minutes: 40, count: 35, title: "Offline recording sync", language: "en",
    participants: ["Bayu", "Bob", "Joko", "Alice"],
    decided: ["Recordings made offline queue on the phone and upload on Wi-Fi by default", "A user can allow upload over mobile data per recording"],
    open: ["What happens when the same episode is edited on two devices while offline"],
    actions: [["Bayu", "Build the offline upload queue", "Oct 21"]],
    keywords: { topics: ["offline sync", "upload queue"], keywords: ["offline", "sync", "sinkronisasi", "offline mode", "upload", "queue", "antrian", "Wi-Fi", "mobile data", "rekaman offline"] },
  },
  {
    channel: "audio-engine", date: "2026-09-30", at: "14:00", minutes: 30, count: 23, title: "Performance review", language: "en",
    participants: ["Rani", "Joko"],
    decided: ["The whole recording chain must stay under 25% CPU on the Redmi 9A"],
    open: ["The limiter clips on loud intros"],
    actions: [["Rani", "Fix clipping in the limiter on loud intros", "Oct 13"]],
    keywords: { topics: ["performance", "CPU budget", "limiter"], keywords: ["performance", "performa", "CPU", "budget", "Redmi 9A", "limiter", "clipping", "intro"] },
  },
  {
    channel: "general", date: "2026-10-02", at: "10:00", minutes: 40, count: 34, title: "Code freeze dan checklist beta", language: "id",
    participants: ["Alice", "Bayu", "Bob", "Rani", "Joko", "Sekar"],
    decided: ["Code freeze Jumat 16 Oktober", "Build beta dari branch release/0.9"],
    open: ["Siapa yang jaga on-call minggu peluncuran"],
    actions: [["Alice", "Bikin checklist beta", "16 Oktober"], ["Tomi", "Update runbook on-call", "9 Oktober"]],
    keywords: { topics: ["code freeze", "checklist beta"], keywords: ["code freeze", "checklist", "beta", "release branch", "0.9", "on-call", "persiapan rilis", "release prep"] },
  },
  {
    channel: "marketing", date: "2026-10-05", at: "13:00", minutes: 30, count: 25, title: "Kolaborasi kreator podcast", language: "id",
    participants: ["Sekar", "Alice"],
    decided: ["Lima kreator podcast dapat akses Pro gratis tiga bulan"],
    open: ["Kreator boleh pakai kode referal sendiri atau tidak"],
    actions: [["Sekar", "Kirim brief ke kreator podcast", "9 Oktober"]],
    keywords: { topics: ["kreator podcast", "kolaborasi"], keywords: ["kreator", "creator", "podcaster", "kolaborasi", "collaboration", "influencer", "brief", "referal", "Pro gratis"] },
  },
  {
    channel: "mobile", date: "2026-10-07", at: "14:00", minutes: 30, count: 26, title: "Review onboarding", language: "en",
    participants: ["Mira", "Bayu", "Joko"],
    decided: ["Onboarding drops from five screens to three"],
    open: ["Alice has not reviewed the onboarding v2 flow yet"],
    actions: [["Alice", "Review onboarding v2", "Friday"], ["Mira", "Redesign onboarding screens", "Oct 20"]],
    keywords: { topics: ["onboarding review", "onboarding redesign"], keywords: ["onboarding", "redesign", "redesain", "review", "Figma", "screens", "layar", "flow", "first run"] },
  },
  {
    channel: "general", date: "2026-10-12", at: "14:00", minutes: 45, count: 40, title: "Weekly sync", language: "id",
    participants: ["Alice", "Rani", "Bayu", "Bob", "Sekar", "Joko", "Mira", "Tomi"],
    decided: ["Demo build 0.9.3 Jumat ini di weekly"],
    open: ["Bug latency Bluetooth masih terbuka, tenggatnya sudah lewat"],
    actions: [["Joko", "Regression pass build 0.9.3", "Senin"], ["Mira", "Selesaikan harga di landing page", "secepatnya"]],
    keywords: { topics: ["weekly sync", "status beta"], keywords: ["weekly", "sync", "status", "beta", "0.9.3", "demo", "Bluetooth", "landing page", "regression"] },
  },
  {
    channel: "audio-engine", date: "2026-10-12", at: "11:00", minutes: 25, count: 19, title: "Music shows loudness", language: "en",
    participants: ["Rani", "Joko"],
    decided: [],
    open: ["Music shows sound quiet at -16 LUFS; -14 LUFS for them is still undecided"],
    actions: [["Rani", "Decide the loudness target for music shows", "after the beta"]],
    keywords: { topics: ["music shows", "loudness target"], keywords: ["music", "musik", "loudness", "LUFS", "-14 LUFS", "quiet", "pelan", "target"] },
  },
];

export const DAYS: StoryDay[] = [
  {
    channel: "audio-engine", date: "2026-07-21", people: ["Rani", "Joko", "Alice"], count: 31,
    topics: [["Episode volume differences", ["volume beda", "normalisasi"], ["loudness", "volume differences", "normalization"]]],
    open: ["Episodes recorded on different phones differ in loudness by up to 8 LU; target level not chosen yet"],
    next: [["Rani", "Read up on EBU R128 and podcast loudness targets", null]],
  },
  {
    channel: "audio-engine", date: "2026-08-27", people: ["Rani", "Joko"], count: 22,
    topics: [["Loudness normalization review", ["review normalisasi"], ["loudness", "code review", "PR 88"]]],
    next: [["Joko", "Run the loudness test set on the PR build", "tomorrow"]],
  },
  {
    channel: "general", date: "2026-08-20", people: ["Tomi", "Alice", "Joko"], count: 38,
    topics: [["Biaya Firestore", ["biaya Firestore", "tagihan"], ["Firestore cost", "billing", "database cost"]], ["Ide database setelah beta", ["coba Supabase", "pindah database"], ["Supabase", "database migration", "Postgres"]]],
    open: ["Tomi lempar ide coba Supabase setelah beta kalau biaya Firestore terus naik; belum dibahas serius, belum ada keputusan"],
    next: [["Tomi", "Pantau biaya Firestore per minggu", null]],
  },
  {
    channel: "mobile", date: "2026-08-18", people: ["Joko", "Bob", "Bayu"], count: 34,
    topics: [["Bluetooth mic delay", ["delay mic bluetooth", "latency"], ["Bluetooth", "mic latency", "headset"]]],
    open: ["Recording through a Bluetooth mic on Android lags about 300 ms behind; Joko filed issue #112"],
    next: [["Bob", "Reproduce the Bluetooth delay on more phones", null]],
  },
  {
    channel: "audio-engine", date: "2026-09-02", people: ["Rani", "Joko", "Bayu"], count: 41,
    topics: [["Opus listening test", ["tes dengar Opus", "ukuran file"], ["Opus", "listening test", "file size", "AAC comparison"]]],
    open: ["Opus 64 kbps mono sounded the same as AAC 128 kbps on voice in the blind test, at half the size; switching the default needs a decision"],
    next: [["Rani", "Write up the listening test as a Document", "Friday"]],
  },
  {
    channel: "mobile", date: "2026-09-10", people: ["Joko", "Bayu", "Mira"], count: 29,
    topics: [["Trim feedback", ["trim", "undo"], ["trim", "undo", "selection", "waveform editor"]]],
    open: ["Undo after a trim loses the selection; Joko filed issue #145"],
    next: [["Bayu", "Look at undo after trim once the beta is out", null]],
  },
  {
    channel: "general", date: "2026-09-10", people: ["Tomi", "Alice", "Joko"], count: 27,
    topics: [["Tabel episodes dobel data", ["normalisasi tabel", "skema"], ["database normalization", "schema", "duplicate data"]]],
    open: ["Tabel episodes menyimpan data show berulang; Tomi mau menormalisasi skema"],
    next: [["Tomi", "Normalize the episodes and shows tables", "19 September"]],
  },
  {
    channel: "general", date: "2026-09-24", people: ["Sekar", "Tomi", "Alice"], count: 30,
    topics: [["Ekspor statistik pendengar", ["ekspor CSV", "statistik pendengar"], ["CSV export", "listener stats", "analytics"]]],
    open: ["Sekar minta fitur ekspor statistik pendengar ke CSV buat laporan ke kreator; Tomi bilang butuh dua minggu"],
  },
  {
    channel: "audio-engine", date: "2026-10-05", people: ["Rani", "Joko"], count: 33,
    topics: [["Resampler aliasing", ["aliasing", "resampler"], ["resampler", "aliasing", "44.1 kHz to 48 kHz"]]],
    open: ["The linear resampler aliases audibly when converting 44.1 kHz imports to 48 kHz"],
    next: [["Rani", "Try a windowed sinc resampler", "tomorrow"]],
  },
  {
    channel: "audio-engine", date: "2026-10-06", people: ["Rani", "Joko", "Alice"], count: 28,
    topics: [["Resampler choice", ["ganti resampler"], ["resampler", "windowed sinc", "quality"]]],
    decided: ["Replace the linear resampler with a windowed sinc resampler"],
    next: [["Rani", "Replace the linear resampler", "Friday"]],
  },
  {
    channel: "audio-engine", date: "2026-10-07", people: ["Rani", "Joko"], count: 24,
    topics: [["Sinc resampler benchmark", ["benchmark", "CPU"], ["benchmark", "CPU", "Redmi 9A", "resampler"]]],
    open: ["The sinc resampler costs about 3% CPU on the Redmi 9A, within the budget"],
  },
  {
    channel: "audio-engine", date: "2026-10-08", people: ["Rani", "Joko", "Bayu"], count: 21,
    topics: [["Resampler review", ["review PR"], ["code review", "resampler", "PR 97"]]],
    next: [["Joko", "Re-run the import tests on the PR build", "tomorrow"]],
  },
  {
    channel: "audio-engine", date: "2026-10-09", people: ["Rani", "Joko", "Alice"], count: 26,
    topics: [["Resampler merged", ["resampler", "merge"], ["resampler", "merged", "high-quality mode"]]],
    decided: ["PR #97 with the windowed sinc resampler is merged"],
    open: ["Whether to offer a high-quality resampler mode toggle; Rani opened issue #99"],
  },
  {
    channel: "mobile", date: "2026-10-13", people: ["Joko", "Bayu", "Bob"], count: 25,
    topics: [["iOS 17 crash", ["crash iOS 17", "AirPods"], ["crash", "iOS 17", "AirPods", "disconnect"]]],
    open: ["The app crashes on iOS 17.0 when AirPods disconnect during a recording; Joko filed issue #158"],
    next: [["Bayu", "Check the iOS 17 crash logs", null]],
  },
];

export const DECISIONS: StoryDecision[] = [
  {
    channel: "general", date: "2026-07-08", slug: "tetap-firebase",
    text: "# Backend tetap di Firebase\n\nDiputuskan: backend tetap di Firebase (Firestore dan Auth) sampai beta selesai.\nKonteks: rapat arsitektur backend 8 Juli.\nAlasan: tim backend cuma satu orang, tidak ada waktu untuk migrasi sebelum beta.",
    keywords: { topics: ["backend", "Firebase"], keywords: ["backend", "Firebase", "Firestore", "Auth", "database", "basis data", "migrasi", "migration", "keputusan", "decision"] },
  },
  {
    channel: "audio-engine", date: "2026-07-15", slug: "default-export-aac",
    text: "# Default export: AAC 128 kbps\n\nDecided: the default export format is AAC-LC at 128 kbps stereo. MP3 192 kbps stays available as an option.\nContext: the export formats meeting of 15 July.\nReason: AAC plays everywhere, including older iPhones and car stereos.",
    keywords: { topics: ["default export format", "AAC"], keywords: ["export", "ekspor", "format ekspor", "default format", "AAC", "128 kbps", "MP3", "bitrate", "audio format"] },
  },
  {
    channel: "general", date: "2026-08-03", slug: "jam-standup",
    text: "# Jam standup\n\nDiputuskan: standup jam 10 pagi tiap hari kerja, paling lama 15 menit.\nKonteks: rapat ritme kerja tim.\nAlasan: jam 9 bentrok dengan antar anak sekolah.",
    keywords: { topics: ["standup"], keywords: ["standup", "jam", "rapat harian", "daily standup", "schedule", "jadwal"] },
  },
  {
    channel: "mobile", date: "2026-08-10", slug: "native-apps",
    text: "# Native apps, no cross-platform framework\n\nDecided: the iOS app stays in Swift and the Android app in Kotlin; no cross-platform framework before 1.0.\nContext: Bob asked whether a shared UI layer would save time.\nReason: the recorder needs low-level audio APIs on both platforms.",
    keywords: { topics: ["native apps", "Swift", "Kotlin"], keywords: ["native", "Swift", "Kotlin", "cross-platform", "React Native", "framework", "iOS", "Android"] },
  },
  {
    channel: "marketing", date: "2026-08-26", slug: "beta-mundur-ke-20-oktober",
    text: "# Beta publik mundur ke 20 Oktober\n\nDiputuskan: beta publik dirilis Selasa 20 Oktober 2026, menggantikan rencana 1 September (Notulen rencana peluncuran beta, 22 Juli).\nKonteks: rapat go/no-go beta di #general.\nAlasan: bug latency mic Bluetooth di Android dan offline sync belum siap.",
    keywords: { topics: ["beta publik", "tanggal rilis"], keywords: ["beta publik", "public beta", "launch", "peluncuran", "tanggal rilis", "release date", "20 Oktober", "mundur", "postponed"] },
  },
  {
    channel: "audio-engine", date: "2026-09-09", slug: "default-export-opus",
    text: "# Default export: Opus 64 kbps\n\nDecided: the default export for voice episodes is Opus at 64 kbps mono. This replaces the AAC 128 kbps default of 15 July. AAC 128 kbps stays available as Compatibility mode in the export sheet.\nContext: the export format review of 9 September, after the Opus listening test.\nReason: half the file size with the same quality for voice in the blind listening test; our hosting transcodes for platforms that need AAC.",
    keywords: { topics: ["default export format", "Opus", "Compatibility mode"], keywords: ["export", "ekspor", "format ekspor", "default format", "Opus", "64 kbps", "AAC", "Compatibility mode", "mode kompatibilitas", "file size", "ukuran file"] },
  },
  {
    channel: "marketing", date: "2026-09-16", slug: "harga-paket-pro",
    text: "# Harga paket Pro\n\nDiputuskan: paket Pro Rp 39.000 per bulan atau Rp 349.000 per tahun. Paket gratis tetap 3 jam rekaman per bulan.\nKonteks: rapat finalisasi harga 16 September, setelah riset harga kompetitor.\nAlasan: di bawah dua kompetitor terdekat, dan tahunan hemat dua bulan.",
    keywords: { topics: ["harga paket Pro"], keywords: ["harga", "pricing", "price", "paket Pro", "Pro plan", "premium", "langganan", "subscription", "Rp 39.000", "Rp 349.000", "bulanan", "monthly"] },
  },
  {
    channel: "general", date: "2026-09-30", slug: "ekspor-csv-statistik-ditunda",
    text: "# Ekspor CSV statistik pendengar ditunda\n\nDiputuskan: fitur ekspor statistik pendengar ke CSV ditunda sampai setelah beta. Sementara itu Tomi mengirim CSV statistik secara manual setiap Senin.\nKonteks: permintaan Sekar untuk laporan ke kreator.\nAlasan: backend sedang fokus ke migrasi dan persiapan beta.",
    keywords: { topics: ["ekspor CSV", "statistik pendengar"], keywords: ["ekspor", "export", "CSV", "statistik pendengar", "listener stats", "analytics", "laporan", "report", "ditunda", "postponed"] },
  },
  {
    channel: "general", date: "2026-10-02", slug: "code-freeze-16-oktober",
    text: "# Code freeze 16 Oktober\n\nDiputuskan: code freeze Jumat 16 Oktober; setelah itu hanya perbaikan blocker yang masuk ke release/0.9.\nKonteks: rapat checklist beta.\nAlasan: QA butuh empat hari kerja sebelum beta publik.",
    keywords: { topics: ["code freeze"], keywords: ["code freeze", "release", "0.9", "branch", "beta", "QA", "blocker"] },
  },
  {
    channel: "mobile", date: "2026-10-07", slug: "onboarding-tiga-layar",
    text: "# Onboarding in three screens\n\nDecided: onboarding goes from five screens to three: welcome, microphone permission, first recording.\nContext: the onboarding review of 7 October.\nReason: half of the testers dropped off at screen four.",
    keywords: { topics: ["onboarding"], keywords: ["onboarding", "screens", "layar", "redesign", "redesain", "first run", "permission"] },
  },
];

export const NOTES: StoryNote[] = [
  {
    channel: "audio-engine", date: "2026-09-02", slug: "tes-noise-suppression-hp-murah", author: "Joko", askedBy: "Joko",
    text: "tes noise suppression di hp murah:\n- Redmi 9A: cpu ~18% pas rekam, masih aman, ga panas\n- Galaxy A04: ~25%, agak anget dikit stlh 20 menit\nsuara motor lewat ilang, ujan msh kedengeran tipis. overall oke bgt sih",
    keywords: { topics: ["tes noise suppression", "CPU hp murah"], keywords: ["noise suppression", "peredam bising", "CPU", "low-end phone", "hp murah", "Redmi 9A", "Galaxy A04", "performance", "test", "tes"] },
  },
  {
    channel: "audio-engine", date: "2026-09-04", slug: "hasil-loudness-test-set", author: "Joko", askedBy: "Rani",
    text: "loudness test set: 20 episodes, all within ±0.5 LU of -16 after export. true peak never above -1. music shows sound a bit quiet tho, rani says check after beta",
    keywords: { topics: ["loudness test set"], keywords: ["loudness", "LUFS", "test set", "normalization", "normalisasi", "true peak", "music shows"] },
  },
  {
    channel: "general", date: "2026-07-27", slug: "akun-bersama", author: "Tomi", askedBy: "Alice",
    text: "akun bersama: semua password di 1Password vault 'Gema Team'. jgn taro di notion ya gaes. akses GCP minta ke Tomi",
    keywords: { topics: ["akun bersama", "password manager"], keywords: ["akun", "account", "password", "1Password", "akses", "access", "GCP"] },
  },
  {
    channel: "marketing", date: "2026-08-12", slug: "catatan-riset-harga", author: "Sekar", askedBy: "Sekar",
    text: "rangkuman riset harga: rata2 kompetitor 45rb-60rb/bulan. yg paling murah 29rb tp batas rekamannya cuma 1 jam. detail di dokumen riset-harga-kompetitor",
    keywords: { topics: ["riset harga"], keywords: ["harga", "pricing", "kompetitor", "competitor", "riset", "research", "langganan"] },
  },
  {
    channel: "mobile", date: "2026-09-25", slug: "background-fetch-ios", author: "Bayu", askedBy: "Bayu",
    text: "note to self: iOS kills background fetch after ~30s, so the offline sync PR (#138) can't work that way. closing it, going with a foreground upload queue + BGProcessingTask",
    keywords: { topics: ["offline sync", "background fetch"], keywords: ["offline", "sync", "background fetch", "iOS", "upload queue", "BGProcessingTask", "PR 138"] },
  },
  {
    channel: "general", date: "2026-09-20", slug: "laporan-migrasi", author: "Tomi", askedBy: "Alice",
    text: "migrasi db beres jam 02.11, downtime 11 menit. rollback ga kepake. kalo ada data show yg aneh lapor gw ya",
    keywords: { topics: ["migrasi database"], keywords: ["migrasi", "migration", "database", "downtime", "rollback", "normalisasi"] },
  },
  {
    channel: "marketing", date: "2026-09-11", slug: "hasil-survei-singkat", author: "Sekar", askedBy: "Alice",
    text: "survei beta tertutup (n=142): 61% mau bayar kalo harganya di bawah 40rb. 34% mahasiswa/pelajar. fitur paling dicari: ekspor cepat & noise suppression",
    keywords: { topics: ["survei pengguna"], keywords: ["survei", "survey", "harga", "price", "pelajar", "student", "fitur", "features", "noise suppression"] },
  },
  {
    channel: "mobile", date: "2026-10-09", slug: "status-bluetooth", author: "Bob", askedBy: "Alice",
    text: "status bluetooth per hari ini: A2DP fallback works on Pixel 7, Samsung A54 masih delay ~120ms. PR draft #147. butuh 2-3 hari lagi",
    keywords: { topics: ["Bluetooth latency"], keywords: ["Bluetooth", "latency", "delay", "mic", "A2DP", "SCO", "Samsung A54", "Pixel 7", "PR 147"] },
  },
  {
    channel: "audio-engine", date: "2026-08-21", slug: "rnnoise-prototype", author: "Rani", askedBy: "Rani",
    text: "RNNoise prototype notes: retrained on Joko's 400 noisy clips. motorbike and cafe noise gone, rain partly. model is 85 KB. next: make it a real PR",
    keywords: { topics: ["RNNoise prototype"], keywords: ["RNNoise", "noise suppression", "peredam bising", "model", "prototype", "training"] },
  },
  {
    channel: "general", date: "2026-10-12", slug: "demo-jumat", author: "Alice", askedBy: "Alice",
    text: "jumat demo 0.9.3: rekam -> trim -> ekspor opus -> share. tiap orang max 5 menit ya",
    keywords: { topics: ["demo build"], keywords: ["demo", "0.9.3", "weekly", "Jumat", "build"] },
  },
  {
    channel: "marketing", date: "2026-10-01", slug: "ide-konten-countdown", author: "Mira", askedBy: "Sekar",
    text: "ide countdown: H-14 sampe H-1 tiap hari 1 fitur. H-7 behind the scenes tim, H-3 testimoni tester. warna pakai palet baru ya",
    keywords: { topics: ["konten countdown"], keywords: ["countdown", "konten", "content", "Instagram", "TikTok", "fitur", "testimoni"] },
  },
];

export const DOCUMENTS: StoryDocument[] = [
  {
    channel: "general", name: "prd-gema-v1.md",
    text: "# PRD Gema v1\n\nDitulis Alice, 30 Juli 2026.\n\n## Tujuan\nAplikasi rekam podcast di HP: rekam, edit sederhana, ekspor, bagikan.\n\n## Platform\n- Minimum Android 9 (API 28) dan iOS 15.\n- Target ukuran APK di bawah 40 MB.\n- Bahasa antarmuka: Indonesia dan Inggris.\n\n## Fitur v1\n1. Rekam dengan peredam bising.\n2. Trim dan potong di waveform.\n3. Ekspor ke file dan ke hosting.\n4. Paket gratis dan Pro.\n\n## Di luar v1\nTranskripsi, kolaborasi real-time, video.",
    keywords: { topics: ["PRD", "kebutuhan produk"], keywords: ["PRD", "product requirements", "kebutuhan produk", "fitur", "features", "scope", "v1", "Gema"] },
  },
  {
    channel: "audio-engine", name: "audio-spec-v2.md",
    text: "# Audio spec v2\n\nOwner: Rani. 20 August 2026.\n\n- Internal processing: 48 kHz, 32-bit float.\n- Recording buffer: 10 ms.\n- Imports at 44.1 kHz are resampled to 48 kHz.\n- Processing chain: high-pass 80 Hz -> noise suppression -> limiter -> loudness normalization at export.\n- Export: see the export decisions.",
    keywords: { topics: ["audio spec"], keywords: ["audio spec", "spesifikasi audio", "sample rate", "48 kHz", "buffer", "processing chain", "limiter", "resampling"] },
  },
  {
    channel: "audio-engine", name: "listening-test-opus.md",
    text: "# Opus vs AAC listening test\n\n3 September 2026, run by Rani and Joko. 12 listeners, blind ABX on 10 voice clips.\n\n- Opus 64 kbps mono vs AAC 128 kbps stereo: no listener told them apart above chance.\n- File size: 28.8 MB vs 57.6 MB per hour.\n- Music clips: Opus 64 mono was noticeably worse; music needs more bits.",
    keywords: { topics: ["listening test", "Opus vs AAC"], keywords: ["listening test", "tes dengar", "Opus", "AAC", "ABX", "file size", "ukuran file", "quality", "kualitas"] },
  },
  {
    channel: "marketing", name: "riset-harga-kompetitor.md",
    text: "# Riset harga kompetitor\n\nSekar, 12 Agustus 2026.\n\n| Aplikasi | Harga per bulan | Batas rekaman gratis |\n|---|---|---|\n| Rekamin | Rp 59.000 | 2 jam |\n| SuaraKu | Rp 45.000 | 3 jam |\n| PodPocket | Rp 29.000 | 1 jam |\n\nKesimpulan: harga di bawah Rp 45.000 masih masuk akal.",
    keywords: { topics: ["riset harga kompetitor"], keywords: ["harga", "pricing", "kompetitor", "competitor", "riset", "research", "Rekamin", "SuaraKu", "PodPocket"] },
  },
  {
    channel: "marketing", name: "brand-guidelines.md",
    text: "# Brand guidelines Gema\n\nWarna utama: jingga #FF7A1A dan biru tua #1B2A4A. Font: Plus Jakarta Sans. Logo jangan diputar atau diberi bayangan.",
    keywords: { topics: ["brand guidelines"], keywords: ["brand", "logo", "warna", "colors", "font", "guidelines", "panduan merek"] },
  },
  {
    channel: "general", name: "kontrak-hosting-awanbiru.md",
    text: "# Kontrak hosting Awan Biru\n\nMasa berlaku: 1 Februari 2026 sampai 31 Januari 2027. Perpanjangan harus dikonfirmasi paling lambat 15 Januari 2027. Bandwidth 10 TB per bulan.",
    keywords: { topics: ["kontrak hosting"], keywords: ["kontrak", "contract", "hosting", "Awan Biru", "perpanjangan", "renewal", "bandwidth", "CDN"] },
  },
  {
    channel: "mobile", name: "beta-test-plan.md",
    text: "# Beta test plan\n\nJoko, 4 September 2026.\n\nDevices: Redmi 9A, Galaxy A04, Samsung A54, Pixel 7, iPhone 11, iPhone 15. Each build: record 30 min, trim, export, share, offline record and resume. Bluetooth: AirPods, a cheap TWS, a Rode Wireless.",
    keywords: { topics: ["beta test plan"], keywords: ["test plan", "rencana tes", "QA", "devices", "perangkat", "beta", "regression", "Bluetooth"] },
  },
  {
    channel: "mobile", name: "onboarding-copy.md",
    text: "# Onboarding copy v2\n\n1. Selamat datang di Gema / Welcome to Gema\n2. Izinkan mikrofon / Allow the microphone\n3. Rekam episode pertamamu / Record your first episode",
    keywords: { topics: ["onboarding copy"], keywords: ["onboarding", "copy", "teks", "welcome", "microphone", "mikrofon"] },
  },
  {
    channel: "general", name: "runbook-migrasi-db.txt",
    text: "RUNBOOK MIGRASI DB (Tomi)\n1. matikan write di API (maintenance flag)\n2. backup firestore export\n3. jalankan scripts/split-shows.ts\n4. cek jumlah dokumen shows vs episodes\n5. nyalakan write lagi\nrollback: restore export dari langkah 2",
  },
  {
    channel: "marketing", name: "press-kit-draft.md",
    text: "# Press kit Gema (draft)\n\nGema adalah aplikasi rekam podcast dari HP, buatan tim kecil di Jakarta. Beta publik: 20 Oktober 2026. Kontak media: Sekar.",
    keywords: { topics: ["press kit"], keywords: ["press kit", "media", "pers", "beta", "launch", "peluncuran"] },
  },
];

export const TASKS: StoryTask[] = [
  // #general
  { channel: "general", title: "Pasang budget alert GCP", status: "completed", assignee: "Tomi", due: "2026-07-15", created: "2026-07-08", by: "Alice" },
  { channel: "general", title: "Normalize the episodes and shows tables", status: "completed", assignee: "Tomi", due: "2026-09-19", created: "2026-09-10", by: "Tomi",
    notes: [["2026-09-17", "Tomi", "script migrasi siap, Joko tes di staging aman"], ["2026-09-20", "Tomi", "migrasi jalan 11 menit, aman"]] },
  { channel: "general", title: "Siapkan agenda weekly sync", status: "completed", assignee: "Alice", due: "2026-10-12", created: "2026-10-08", by: "Alice" },
  { channel: "general", title: "Kirim CSV statistik pendengar manual tiap Senin", status: "in_progress", assignee: "Tomi", created: "2026-09-30", by: "Alice" },
  { channel: "general", title: "Perpanjang kontrak hosting Awan Biru", status: "pending", assignee: "Alice", due: "2027-01-15", created: "2026-08-04", by: "Alice" },
  { channel: "general", title: "Beli perangkat tes Android murah", status: "completed", assignee: "Joko", due: "2026-08-07", created: "2026-07-20", by: "Alice" },
  { channel: "general", title: "Bikin checklist beta", status: "in_progress", assignee: "Alice", due: "2026-10-16", created: "2026-10-02", by: "Alice" },
  { channel: "general", title: "Rapikan dokumen PRD lama", status: "cancelled", assignee: "Alice", due: "2026-08-14", created: "2026-07-21", by: "Alice",
    notes: [["2026-07-31", "Alice", "dibatalkan: sudah diganti PRD Gema v1"]] },
  { channel: "general", title: "Update runbook on-call", status: "pending", assignee: "Tomi", due: "2026-10-09", created: "2026-10-02", by: "Alice" },
  { channel: "general", title: "Turunkan p95 latency API di bawah 300 ms", status: "in_progress", assignee: "Tomi", due: "2026-10-30", created: "2026-09-28", by: "Tomi",
    notes: [["2026-10-06", "Tomi", "p95 sekarang 480 ms di jam sibuk, cache daftar episode lagi dikerjain"]] },
  // #audio-engine
  { channel: "audio-engine", title: "Noise suppression prototype with RNNoise", status: "completed", assignee: "Rani", due: "2026-08-21", created: "2026-07-14", by: "Alice" },
  { channel: "audio-engine", title: "Collect noisy recording samples", status: "completed", assignee: "Joko", due: "2026-07-24", created: "2026-07-14", by: "Alice" },
  { channel: "audio-engine", title: "Implement loudness normalization in the export pipeline", status: "completed", assignee: "Rani", due: "2026-08-28", created: "2026-08-12", by: "Alice",
    notes: [["2026-08-27", "Rani", "PR #88 is up for review"], ["2026-09-03", "Rani", "merged, every export now lands at -16 LUFS"]] },
  { channel: "audio-engine", title: "Build a loudness test set of 20 episodes", status: "completed", assignee: "Joko", due: "2026-08-26", created: "2026-08-12", by: "Alice" },
  { channel: "audio-engine", title: "Switch the default encoder to Opus 64 kbps", status: "completed", assignee: "Rani", due: "2026-09-18", created: "2026-09-09", by: "Alice" },
  { channel: "audio-engine", title: "Replace the linear resampler", status: "completed", assignee: "Rani", due: "2026-10-09", created: "2026-10-06", by: "Rani" },
  { channel: "audio-engine", title: "Decide the loudness target for music shows", status: "pending", assignee: "Rani", due: "2026-11-02", created: "2026-10-12", by: "Rani" },
  { channel: "audio-engine", title: "Fix clipping in the limiter on loud intros", status: "in_progress", assignee: "Rani", due: "2026-10-13", created: "2026-09-30", by: "Rani",
    notes: [["2026-10-08", "Rani", "softer attack helps, PR #90 open"]] },
  { channel: "audio-engine", title: "Profile mixer allocations", status: "cancelled", assignee: "Rani", created: "2026-08-03", by: "Rani",
    notes: [["2026-08-24", "Rani", "cancelled: the mixer no longer allocates after the ring buffer change"]] },
  { channel: "audio-engine", title: "Fuzz the Opus decoder", status: "pending", assignee: "Joko", created: "2026-09-24", by: "Joko" },
  // #mobile
  { channel: "mobile", title: "Waveform trim and cut", status: "completed", assignee: "Bayu", due: "2026-08-14", created: "2026-07-29", by: "Alice" },
  { channel: "mobile", title: "Fix Bluetooth mic latency on Android", status: "in_progress", assignee: "Bob", due: "2026-10-07", created: "2026-09-01", by: "Alice",
    notes: [["2026-09-22", "Bob", "repro di Samsung A54 dan Pixel 7, delay sekitar 300 ms"], ["2026-10-05", "Bob", "root cause di perpindahan codec SCO, lagi coba fallback ke A2DP"]] },
  { channel: "mobile", title: "Turn on loudness normalization in the app export settings", status: "in_progress", assignee: "Bayu", due: "2026-10-23", created: "2026-09-04", by: "Alice",
    notes: [["2026-10-08", "Bayu", "toggle udah jalan di iOS, Android nunggu Bob"]] },
  { channel: "mobile", title: "Offline recording sync", status: "in_progress", assignee: "Bayu", due: "2026-10-21", created: "2026-09-23", by: "Alice",
    notes: [["2026-09-25", "Bayu", "background fetch dibunuh iOS, PR #138 ditutup, ganti ke upload queue"]] },
  { channel: "mobile", title: "Redesign onboarding screens", status: "in_progress", assignee: "Mira", due: "2026-10-20", created: "2026-09-28", by: "Alice",
    notes: [["2026-10-07", "Mira", "draft v2 udah di Figma, nunggu review Alice"]] },
  { channel: "mobile", title: "Review onboarding v2", status: "pending", assignee: "Alice", due: "2026-10-09", created: "2026-10-07", by: "Mira" },
  { channel: "mobile", title: "Regression pass on the 0.9 beta build", status: "in_progress", assignee: "Joko", due: "2026-10-12", created: "2026-10-05", by: "Alice" },
  { channel: "mobile", title: "Add a Compatibility mode toggle to the export sheet", status: "completed", assignee: "Bayu", due: "2026-09-25", created: "2026-09-09", by: "Alice" },
  { channel: "mobile", title: "Dark mode polish", status: "completed", assignee: "Mira", due: "2026-09-04", created: "2026-08-17", by: "Mira" },
  { channel: "mobile", title: "Upgrade Gradle to 8.10", status: "completed", assignee: "Bob", due: "2026-08-21", created: "2026-08-11", by: "Bob" },
  { channel: "mobile", title: "Undo after trim", status: "pending", assignee: "Bayu", created: "2026-09-10", by: "Joko" },
  { channel: "mobile", title: "Accessibility labels for the recorder", status: "pending", assignee: "Mira", due: "2026-10-30", created: "2026-09-15", by: "Mira" },
  { channel: "mobile", title: "Set up the Play Console release tracks", status: "completed", assignee: "Bob", due: "2026-08-14", created: "2026-08-11", by: "Bob" },
  { channel: "mobile", title: "Review push notification copy", status: "pending", assignee: "Sekar", due: "2026-10-15", created: "2026-10-06", by: "Bayu" },
  // #marketing
  { channel: "marketing", title: "Siapkan press kit beta", status: "in_progress", assignee: "Sekar", due: "2026-10-16", created: "2026-07-22", by: "Alice",
    notes: [["2026-08-27", "Sekar", "tenggat digeser ikut beta 20 Oktober"], ["2026-10-09", "Sekar", "tinggal foto tim sama kutipan Alice"]] },
  { channel: "marketing", title: "Aset visual store listing", status: "completed", assignee: "Mira", due: "2026-08-21", created: "2026-07-22", by: "Alice" },
  { channel: "marketing", title: "Riset harga kompetitor", status: "completed", assignee: "Sekar", due: "2026-08-12", created: "2026-08-05", by: "Alice" },
  { channel: "marketing", title: "Update harga di landing page", status: "pending", assignee: "Mira", due: "2026-10-12", created: "2026-09-16", by: "Alice" },
  { channel: "marketing", title: "Kirim brief ke kreator podcast", status: "pending", assignee: "Sekar", due: "2026-10-09", created: "2026-10-05", by: "Alice" },
  { channel: "marketing", title: "Jadwal konten countdown beta", status: "completed", assignee: "Sekar", due: "2026-10-05", created: "2026-08-31", by: "Sekar" },
  { channel: "marketing", title: "Cetak stiker untuk acara komunitas", status: "cancelled", assignee: "Sekar", due: "2026-09-12", created: "2026-08-20", by: "Sekar",
    notes: [["2026-09-03", "Sekar", "acaranya batal, stiker nggak jadi dicetak"]] },
  { channel: "marketing", title: "Newsletter Oktober", status: "pending", assignee: "Sekar", due: "2026-10-20", created: "2026-10-01", by: "Sekar" },
  { channel: "marketing", title: "Press release bareng partner hosting", status: "pending", assignee: "Alice", due: "2026-10-19", created: "2026-10-02", by: "Sekar" },
  { channel: "marketing", title: "Survei pengguna beta tertutup", status: "completed", assignee: "Sekar", due: "2026-09-11", created: "2026-08-28", by: "Alice" },
];

export const PULLS: StoryPull[] = [
  { repo: "gema/audio-core", number: 71, title: "Add RNNoise-based noise suppression", created: "2026-08-21", mergedAt: "2026-08-28T08:10:00Z", author: "rani" },
  { repo: "gema/audio-core", number: 85, title: "Ring buffer: lock-free reader", created: "2026-08-04", mergedAt: "2026-08-10T04:00:00Z", author: "rani" },
  { repo: "gema/audio-core", number: 88, title: "Loudness normalization to -16 LUFS in the export pipeline", created: "2026-08-27", mergedAt: "2026-09-03T07:30:00Z", author: "rani" },
  { repo: "gema/audio-core", number: 90, title: "Limiter: softer attack on loud intros", created: "2026-10-08", author: "rani" },
  { repo: "gema/audio-core", number: 93, title: "Switch the default encoder to Opus 64 kbps mono", created: "2026-09-11", mergedAt: "2026-09-16T06:00:00Z", author: "rani" },
  { repo: "gema/audio-core", number: 95, title: "Bump libopus to 1.5.2", created: "2026-09-22", mergedAt: "2026-09-24T03:00:00Z", author: "joko" },
  { repo: "gema/audio-core", number: 97, title: "Replace the linear resampler with windowed sinc", created: "2026-10-07", mergedAt: "2026-10-09T09:00:00Z", author: "rani" },
  { repo: "gema/gema-app", number: 118, title: "Fix waveform jump when zooming", created: "2026-08-24", mergedAt: "2026-08-30T05:00:00Z", author: "bayu" },
  { repo: "gema/gema-app", number: 120, title: "Waveform trim and cut", created: "2026-08-06", mergedAt: "2026-08-14T08:00:00Z", author: "bayu" },
  { repo: "gema/gema-app", number: 126, title: "Upgrade Gradle to 8.10", created: "2026-08-18", mergedAt: "2026-08-20T03:00:00Z", author: "bob" },
  { repo: "gema/gema-app", number: 133, title: "Dark mode polish for the recorder", created: "2026-08-31", mergedAt: "2026-09-03T06:00:00Z", author: "mira" },
  { repo: "gema/gema-app", number: 138, title: "Offline sync via background fetch", created: "2026-09-21", closedAt: "2026-09-25T10:00:00Z", author: "bayu" },
  { repo: "gema/gema-app", number: 140, title: "Loudness normalization toggle in the export settings", created: "2026-10-02", author: "bayu" },
  { repo: "gema/gema-app", number: 142, title: "Compatibility mode toggle in the export sheet", created: "2026-09-18", mergedAt: "2026-09-24T07:00:00Z", author: "bayu" },
  { repo: "gema/gema-app", number: 147, title: "Bluetooth mic: A2DP fallback (draft)", created: "2026-10-08", author: "bob" },
  { repo: "gema/gema-app", number: 151, title: "WIP: offline upload queue", created: "2026-10-01", author: "bayu" },
  { repo: "gema/api", number: 29, title: "Firestore budget alert", created: "2026-07-10", mergedAt: "2026-07-14T04:00:00Z", author: "tomi" },
  { repo: "gema/api", number: 34, title: "Normalize the episodes and shows schema", created: "2026-09-14", mergedAt: "2026-09-19T12:00:00Z", author: "tomi" },
  { repo: "gema/api", number: 37, title: "Cache the episode list to cut p95 latency", created: "2026-10-06", author: "tomi" },
  { repo: "gema/site", number: 12, title: "Pricing section: Pro Rp 39.000", created: "2026-10-01", author: "mira" },
];

export const ISSUES: StoryIssue[] = [
  { repo: "gema/audio-core", number: 80, title: "Music shows sound quiet after loudness normalization", created: "2026-09-05" },
  { repo: "gema/audio-core", number: 99, title: "High-quality resampler mode toggle?", created: "2026-10-09" },
  { repo: "gema/gema-app", number: 112, title: "Bluetooth mic latency on Android (~300 ms)", created: "2026-08-18" },
  { repo: "gema/gema-app", number: 116, title: "Waveform jumps when zooming", created: "2026-08-20", closedAt: "2026-08-30T05:00:00Z" },
  { repo: "gema/gema-app", number: 145, title: "Undo after trim loses the selection", created: "2026-09-10" },
  { repo: "gema/gema-app", number: 158, title: "Crash on iOS 17.0 when AirPods disconnect during recording", created: "2026-10-13" },
  { repo: "gema/api", number: 31, title: "Episodes table repeats show data", created: "2026-09-10", closedAt: "2026-09-19T12:00:00Z" },
  { repo: "gema/site", number: 9, title: "Landing page still shows the old price", created: "2026-10-12" },
];

/** Commits on each default branch, any order; the stub serves them newest first. Merge commits name their pull request. */
export const COMMITS: StoryCommit[] = [
  { repo: "gema/audio-core", date: "2026-08-10T04:00:00Z", message: "Merge pull request #85 from gema/ring-buffer\n\nRing buffer: lock-free reader" },
  { repo: "gema/audio-core", date: "2026-08-28T08:10:00Z", message: "Merge pull request #71 from gema/rnnoise\n\nAdd RNNoise-based noise suppression" },
  { repo: "gema/audio-core", date: "2026-09-03T07:30:00Z", message: "Merge pull request #88 from gema/loudness\n\nLoudness normalization to -16 LUFS in the export pipeline" },
  { repo: "gema/audio-core", date: "2026-09-08T03:20:00Z", message: "Loudness: skip silent tails when measuring" },
  { repo: "gema/audio-core", date: "2026-09-16T06:00:00Z", message: "Merge pull request #93 from gema/opus-default\n\nSwitch the default encoder to Opus 64 kbps mono" },
  { repo: "gema/audio-core", date: "2026-09-24T03:00:00Z", message: "Merge pull request #95 from gema/libopus\n\nBump libopus to 1.5.2" },
  { repo: "gema/audio-core", date: "2026-10-01T02:00:00Z", message: "Limiter: add a test for loud intros" },
  { repo: "gema/audio-core", date: "2026-10-09T09:00:00Z", message: "Merge pull request #97 from gema/sinc\n\nReplace the linear resampler with windowed sinc" },
  { repo: "gema/audio-core", date: "2026-10-12T04:00:00Z", message: "Docs: describe the processing chain" },
  { repo: "gema/gema-app", date: "2026-08-14T08:00:00Z", message: "Merge pull request #120 from gema/trim\n\nWaveform trim and cut" },
  { repo: "gema/gema-app", date: "2026-08-20T03:00:00Z", message: "Merge pull request #126 from gema/gradle\n\nUpgrade Gradle to 8.10" },
  { repo: "gema/gema-app", date: "2026-08-30T05:00:00Z", message: "Merge pull request #118 from gema/zoom\n\nFix waveform jump when zooming" },
  { repo: "gema/gema-app", date: "2026-09-03T06:00:00Z", message: "Merge pull request #133 from gema/dark\n\nDark mode polish for the recorder" },
  { repo: "gema/gema-app", date: "2026-09-24T07:00:00Z", message: "Merge pull request #142 from gema/compat\n\nCompatibility mode toggle in the export sheet" },
  { repo: "gema/gema-app", date: "2026-10-05T02:00:00Z", message: "Bump version to 0.9.2" },
  { repo: "gema/gema-app", date: "2026-10-12T03:00:00Z", message: "Bump version to 0.9.3" },
  { repo: "gema/api", date: "2026-07-14T04:00:00Z", message: "Merge pull request #29 from gema/budget\n\nFirestore budget alert" },
  { repo: "gema/api", date: "2026-09-19T11:40:00Z", message: "Split shows out of the episodes table (normalization)" },
  { repo: "gema/api", date: "2026-09-19T12:00:00Z", message: "Merge pull request #34 from gema/schema\n\nNormalize the episodes and shows schema" },
  { repo: "gema/site", date: "2026-08-21T05:00:00Z", message: "Store listing screenshots" },
];

/** Talk in #general on the morning of the clock, not yet in any Daily log; slang and typos as people write. [author, text, WIB time] */
export const MORNING: [string, string, string][] = [
  ["Sekar", "pagii, slide buat weekly jumat siapa yg pegang ya?", "08:05"],
  ["Tomi", "api sempet lemot td subuh, udh normal lg kok", "08:12"],
  ["Joko", "build 0.9.3 udh di testflight ya gaes, tlg dicobain", "08:20"],
  ["Bayu", "oke otw cek. yg android nyusul sore", "08:31"],
  ["Mira", "harga di landing page blm ku update, maap bgt, hari ini kelar", "08:40"],
  ["Alice", "sip makasih mir", "08:45"],
  ["Bob", "bluetooth msh ngadat di A54, lg kucoba lg", "08:52"],
];
