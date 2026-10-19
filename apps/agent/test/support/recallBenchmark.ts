/**
 * The retrieval benchmark's corpus and questions (#208): Kept material of four Public channels of guild-1, asked about from
 * #general (channel-1). Every question's expected files were picked by hand from the corpus below, never by running a search.
 * Distractors are deliberate: long Daily logs that mention a word once, words hidden inside other words ("log" in "blog",
 * "api" in "rapid"), a decision replaced by a newer one, Indonesian files asked about in English and the other way round,
 * and files kept with and without a topics/keywords header.
 */

import type { Scenario } from "./discordScenario";

/** A channel of the corpus: its id, its name, and the root its files are shown under when asked from #general. */
const CHANNELS = {
  general: { id: "channel-1", shown: "channel" },
  audio: { id: "channel-2", shown: "#audio" },
  marketing: { id: "channel-3", shown: "#marketing" },
  ops: { id: "channel-4", shown: "#ops" },
} as const;
type Channel = keyof typeof CHANNELS;

export const BENCHMARK_CHANNELS = Object.entries(CHANNELS).map(([name, c]) => ({ id: c.id, name }));

/** A Workspace file: its tenant-relative path and content. */
export interface KeptFile { path: string; content: string }
/** One question as a model would search it, with the files a person would accept as answering it, as `searchFiles` shows them. */
export interface Question { id: string; group?: "prefix" | "pair" | "collision" | "sentence"; asked: string; queries: string[]; expected: string[] }

const files: KeptFile[] = [];
const add = (channel: Channel, rel: string, content: string) => files.push({ path: `guilds/guild-1/channels/${CHANNELS[channel].id}/${rel}`, content });
/** The path `searchFiles` shows for a file of a channel, asked from #general. */
const shown = (channel: Channel, rel: string) => `${CHANNELS[channel].shown}/${rel}`;

let messageId = 9000;
const link = (channel: Channel) => `[↗](https://discord.com/channels/guild-1/${CHANNELS[channel].id}/${++messageId})`;
const header = (fields: Record<string, string | string[]>) =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(v)}`).join("\n")}\n---\n`;
/** The topics and keywords lines `addKeywords` writes at the end of a kept file's head. */
type Keywords = { topics: string[]; keywords: string[] };

/** Minutes as the bot posts and keeps them; `keywords` only on Minutes kept after keywords existed. */
function minutes(channel: Channel, date: string, slug: string, title: string, parts: { decided?: string[]; open?: string[]; actions?: string[] }, participants: string, keywords?: Keywords) {
  let n = 0;
  const rows = (items: string[] = []) => (items.length ? items.map((i) => `${++n}. ${i} ${link(channel)}`).join("\n") : "*None*");
  const head = header({ title, guildId: "guild-1", channelId: CHANNELS[channel].id, postedIn: CHANNELS[channel].id, messageId: String(++messageId), requesterId: "user-alice", ...(keywords ?? {}) });
  add(channel, `minutes/${date}-${slug}.md`, `${head}# ${title}\n\n${date} 03:00 – ${date} 04:00 UTC · 30 messages\nParticipants: ${participants}\n\n## Decided\n${rows(parts.decided)}\n\n## Open\n${rows(parts.open)}\n\n## Action items\n${rows(parts.actions)}\n`);
}

/** A Daily log as the nightly writer keeps it: every topic with keywords in Indonesian and English, every item linked. */
function dailyLog(channel: Channel, day: string, people: string, topics: { name: string; id: string[]; en: string[] }[], parts: { decided?: string[]; open?: string[]; next?: string[] }) {
  let n = 0;
  const keywords = [...new Set(topics.flatMap((t) => [...t.id, ...t.en]))];
  const row = (text: string) => `${++n}. ${text} ${link(channel)}`;
  const block = (label: string, items: string[] = []) => `## ${label}\n${items.length ? items.map(row).join("\n") : "*None*"}`;
  const head = header({ kind: "daily-log", guildId: "guild-1", channelId: CHANNELS[channel].id, channel, day, topics: topics.map((t) => t.name), keywords });
  add(channel, `daily-logs/${day}.md`, [
    `${head}# Daily log #${channel}, ${day}\n\nTopics: ${topics.map((t) => t.name).join(", ")}\nKeywords: ${keywords.join(", ")}\n${40 + topics.length * 7} messages from ${people}`,
    block("Topics", topics.map((t) => `${t.name}: ${[...t.id, ...t.en].join(", ")}`)),
    block("Decided", parts.decided), block("Still open", parts.open), block("Who does what next", parts.next),
  ].join("\n\n") + "\n");
}

const note = (channel: Channel, date: string, slug: string, text: string, keywords?: Keywords) =>
  add(channel, `notes/${date}-${slug}.md`, `${keywords ? header(keywords) : ""}${text}\n`);
const decision = (channel: Channel, date: string, slug: string, text: string, keywords?: Keywords) =>
  add(channel, `decisions/${date}-${slug}.md`, `${keywords ? header(keywords) : ""}${text}\n`);
const documentText = (channel: Channel, name: string, text: string) => add(channel, `files/${name}.md`, `${text}\n`);

// #audio: the Podkit app team. Audio normalization was discussed, decided and implemented, always in English.
minutes("audio", "2026-08-05", "kickoff", "Q3 kickoff", {
  decided: ["Q3 themes: noise reduction, waveform editing, faster export", "Android stays on the same release train as iOS"],
  open: ["Whether the free plan keeps MP3 export"],
  actions: ["**Rina**: Draft the Q3 roadmap page", "**Budi**: Collect crash reports from the beta channel"],
}, "Rina, Budi, Sari");
minutes("audio", "2026-08-19", "loudness", "Loudness and audio normalization", {
  decided: ["Audio normalization follows EBU R128: integrated loudness measured over the whole episode", "Podcasts are normalized to -14 LUFS, true peak at -1 dBTP"],
  open: ["Whether music tracks get a different loudness target"],
  actions: ["**Rina**: Implement audio normalization in the export pipeline", "**Sari**: Write the help article on loudness"],
}, "Rina, Sari, Dimas");
minutes("audio", "2026-09-02", "weekly", "Weekly sync", {
  decided: ["Audio normalization is implemented in the export pipeline; it ships behind a setting until QA signs off"],
  open: ["QA still has to check normalization on files longer than two hours"],
  actions: ["**Rina**: Hand the normalization build to QA", "**Budi**: Retest the Android recorder"],
}, "Rina, Budi, Dimas");
minutes("audio", "2026-09-16", "weekly", "Weekly sync", {
  decided: ["The noise reduction model moves to the on-device version", "MP3 export uses 192 kbps by default"],
  open: ["The Android 14 crash while recording long sessions is still not fixed"],
  actions: ["**Dimas**: Profile the noise reduction model on low-end phones", "**Budi**: Reproduce the Android 14 crash"],
}, "Budi, Dimas, Sari");
minutes("audio", "2026-09-30", "release", "Release 2.4 planning", {
  decided: ["Release 2.4 moves to 14 October because of the Android crash", "Waveform editing ships in 2.4; batch export waits for 2.5"],
  open: ["Who writes the store listing text"],
  actions: ["**Sari**: Tell marketing the new release date", "**Budi**: Verify the crash fix on three devices"],
}, "Rina, Budi, Sari, Dimas");

dailyLog("audio", "2026-09-03", "Rina, Budi, Sari", [
  { name: "Server keadaan normal lagi", id: ["server", "pemulihan"], en: ["server", "recovery"] },
  { name: "Review desain editor waveform", id: ["desain", "waveform"], en: ["design review", "waveform"] },
  { name: "Contoh file audio dari Budi", id: ["contoh", "file"], en: ["sample", "file"] },
  { name: "Jadwal makan siang tim", id: ["makan siang"], en: ["team lunch"] },
], {
  decided: ["Server staging sudah normal lagi setelah restart", "Tombol zoom waveform dipindah ke kanan"],
  open: ["Ukuran ikon di layar kecil"],
  next: ["**Budi**: kirim contoh file audio buat QA", "**Sari**: pesan tempat makan siang Jumat"],
});
dailyLog("audio", "2026-09-10", "Rina, Dimas", [
  { name: "UI meter loudness", id: ["meter", "tampilan"], en: ["loudness meter", "UI"] },
  { name: "Catatan versi beta", id: ["catatan versi"], en: ["beta notes"] },
  { name: "Lisensi font", id: ["lisensi", "font"], en: ["license", "font"] },
], {
  decided: ["Meter loudness tampil di pojok kanan bawah editor"],
  open: ["Warna meter saat melewati batas"],
  next: ["**Dimas**: mockup meter versi gelap"],
});
dailyLog("audio", "2026-09-17", "Budi, Dimas, Sari", [
  { name: "Crash Android 14", id: ["crash", "rekam"], en: ["crash", "recording"] },
  { name: "Ukuran aplikasi", id: ["ukuran", "unduhan"], en: ["app size", "download"] },
  { name: "Ulang tahun Sari", id: ["ulang tahun"], en: ["birthday"] },
  { name: "Login dengan Apple", id: ["login", "masuk"], en: ["sign in with Apple", "login"] },
], {
  decided: ["Ukuran aplikasi dibatasi 80 MB"],
  open: ["Crash Android 14 belum bisa direproduksi di emulator"],
  next: ["**Budi**: pinjam HP Android 14 dari tim QA"],
});
dailyLog("audio", "2026-09-24", "Rina, Sari", [
  { name: "Dialog izin mikrofon", id: ["dialog", "izin", "mikrofon"], en: ["permission dialog", "microphone"] },
  { name: "Changelog versi 2.3.1", id: ["changelog"], en: ["changelog"] },
  { name: "Tester beta baru", id: ["tester", "beta"], en: ["beta testers"] },
], {
  decided: ["Teks dialog izin mikrofon diganti supaya lebih jelas"],
  next: ["**Sari**: tulis changelog 2.3.1"],
});
dailyLog("audio", "2026-10-01", "Rina, Budi, Dimas", [
  { name: "Perbaikan crash Android", id: ["perbaikan", "crash"], en: ["crash fix", "Android"] },
  { name: "Ekspor batch", id: ["ekspor batch"], en: ["batch export"] },
  { name: "Katalog efek suara", id: ["katalog", "efek suara"], en: ["sound effects catalog"] },
  { name: "Rapat dengan investor", id: ["investor"], en: ["investor meeting"] },
], {
  decided: ["Katalog efek suara pakai lisensi CC0 saja"],
  open: ["Ekspor batch butuh antrean di server"],
  next: ["**Budi**: uji perbaikan crash di tiga HP"],
});
dailyLog("audio", "2026-10-06", "Rina, Sari", [
  { name: "Persiapan rilis 2.4", id: ["rilis", "persiapan"], en: ["release prep"] },
  { name: "Teks store listing", id: ["store listing", "deskripsi"], en: ["store listing"] },
  { name: "Template ekspor", id: ["template"], en: ["export template"] },
], {
  open: ["Screenshot store listing belum ada versi gelap"],
  next: ["**Sari**: kirim draf teks store listing ke Rina"],
});
dailyLog("audio", "2026-10-08", "Budi, Dimas", [
  { name: "Bug tombol undo", id: ["undo", "bug"], en: ["undo button", "bug"] },
  { name: "Pengujian perangkat murah", id: ["perangkat murah", "performa"], en: ["low-end devices", "performance"] },
  { name: "Noise di rekaman luar ruangan", id: ["noise", "luar ruangan"], en: ["outdoor recording"] },
], {
  decided: ["Undo dibatasi 50 langkah"],
  next: ["**Dimas**: profil performa di HP murah"],
});

decision("audio", "2026-08-20", "loudness-target", "Loudness target: every exported podcast is normalized to -14 LUFS integrated, true peak -1 dBTP, measured with EBU R128. Decided by Rina and Sari after the loudness meeting.");
decision("audio", "2026-10-02", "loudness-target", "Target loudness diubah: semua platform pakai -16 LUFS integrated, true peak -1 dBTP. Menggantikan keputusan 20 Agustus (-14 LUFS) karena keluhan suara terlalu keras di HP.",
  { topics: ["Target loudness -16 LUFS"], keywords: ["target loudness", "loudness target", "LUFS", "normalisasi audio", "audio normalization", "volume"] });
decision("audio", "2026-09-05", "export-formats", "Export supports WAV, MP3 and FLAC. OGG is dropped because almost nobody used it. The free plan keeps MP3.");
note("audio", "2026-09-12", "android-crash", "Budi bilang crash di Android 14 terjadi saat merekam lebih dari 30 menit. Penyebabnya buffer rekaman tidak dikosongkan; perbaikan menunggu HP uji.");
note("audio", "2026-10-09", "agenda", "Agenda rapat Jumat: demo editor waveform, rencana ekspor batch, pembagian tugas Q4.");
note("audio", "2026-09-25", "beta-testers", "Sari said twelve new beta testers joined from the podcast community; three of them use Android 14.");
documentText("audio", "spec-noise-reduction", [
  "# Noise reduction: technical spec",
  "", "## Goal", "Remove steady background noise (fans, traffic, air conditioning) from voice recordings without making speech sound robotic.",
  "", "## Model", "A small on-device noise reduction model, 4 MB, running at 48 kHz in real time on phones from 2021 onwards.",
  "The model estimates a noise profile from the first second of silence and updates it every 500 ms.",
  "", "## Settings", "Strength: low, medium, high. Default medium.",
  "", "## Out of scope", "Echo removal and music separation.",
].join("\n"));
documentText("audio", "user-research-summary", [
  "# User research summary, August 2026",
  "Twelve podcasters interviewed. Most edit on a laptop and record on a phone.",
  "Top requests: easier waveform editing, cloud backup, and fewer export steps.",
  "Several people asked why their episodes sound quieter than others on Spotify.",
].join("\n"));

// #marketing: pricing, launches, the blog. Mostly Indonesian.
minutes("marketing", "2026-08-12", "campaign", "Kampanye Q3", {
  decided: ["Anggaran influencer Q3 Rp45 juta", "Fokus kampanye ke podcaster pemula"],
  open: ["Apakah ikut pameran kreator bulan November"],
  actions: ["**Maya**: daftar 10 influencer podcast", "**Andi**: siapkan materi iklan audio pendek"],
}, "Maya, Andi, Sari");
minutes("marketing", "2026-09-09", "pricing", "Rapat harga", {
  decided: ["Harga paket Pro naik jadi Rp79.000 per bulan mulai Oktober", "Pelanggan lama tetap Rp69.000 sampai Januari"],
  open: ["Harga paket tahunan"],
  actions: ["**Maya**: update halaman harga", "**Andi**: email pelanggan lama soal harga"],
}, "Maya, Andi, Rina");
minutes("marketing", "2026-09-23", "launch", "Rencana peluncuran 2.4", {
  decided: ["Blog post peluncuran versi 2.4 terbit 14 Oktober", "Press kit dikirim ke 15 media sehari sebelumnya"],
  open: ["Video demo editor waveform"],
  actions: ["**Andi**: tulis blog post peluncuran", "**Maya**: susun daftar media"],
}, "Maya, Andi, Sari");
minutes("marketing", "2026-10-07", "weekly", "Mingguan marketing", {
  decided: ["Newsletter Oktober fokus ke fitur waveform"],
  open: ["Jadwal live Instagram"],
  actions: ["**Maya**: kirim draf newsletter"],
}, "Maya, Andi");

dailyLog("marketing", "2026-09-08", "Maya, Andi", [
  { name: "Contoh audio iklan", id: ["iklan", "contoh"], en: ["ad sample"] },
  { name: "Foto produk", id: ["foto", "produk"], en: ["product photos"] },
  { name: "Promo akhir bulan", id: ["promo", "diskon"], en: ["promo", "discount"] },
], {
  decided: ["Promo akhir bulan diskon 20% untuk paket tahunan"],
  next: ["**Andi**: rekam ulang contoh audio iklan"],
});
dailyLog("marketing", "2026-09-15", "Maya, Andi, Sari", [
  { name: "Blog SEO", id: ["blog", "SEO"], en: ["blog", "SEO"] },
  { name: "Program afiliasi", id: ["afiliasi", "komisi"], en: ["affiliate program", "commission"] },
  { name: "Proses approval desain", id: ["approval", "desain"], en: ["design approval"] },
  { name: "Proyek video tutorial", id: ["proyek", "video"], en: ["tutorial videos"] },
], {
  decided: ["Komisi afiliasi 15%"],
  open: ["Siapa yang approve desain iklan"],
  next: ["**Maya**: riset kata kunci SEO untuk blog"],
});
dailyLog("marketing", "2026-09-22", "Maya, Andi", [
  { name: "Katalog merchandise", id: ["katalog", "merchandise"], en: ["merch catalog"] },
  { name: "Login dashboard iklan", id: ["login", "dashboard"], en: ["ads dashboard login"] },
  { name: "Testimoni pengguna", id: ["testimoni"], en: ["testimonials"] },
], {
  next: ["**Andi**: kumpulkan lima testimoni"],
});
dailyLog("marketing", "2026-09-29", "Maya, Sari", [
  { name: "Produk baru kompetitor", id: ["kompetitor", "produk"], en: ["competitor launch"] },
  { name: "Program referral", id: ["referral"], en: ["referral program"] },
  { name: "Proposal sponsor podcast", id: ["proposal", "sponsor"], en: ["sponsorship proposal"] },
], {
  open: ["Hadiah program referral"],
  next: ["**Maya**: kirim proposal sponsor ke dua podcast"],
});
dailyLog("marketing", "2026-10-05", "Maya, Andi", [
  { name: "Jadwal posting media sosial", id: ["media sosial", "jadwal"], en: ["social media schedule"] },
  { name: "Banner peluncuran", id: ["banner"], en: ["launch banner"] },
  { name: "Approval anggaran iklan", id: ["anggaran", "approval"], en: ["ad budget approval"] },
], {
  decided: ["Posting media sosial tiap Selasa dan Kamis"],
  next: ["**Andi**: desain banner peluncuran"],
});

decision("marketing", "2026-08-14", "pro-pricing", "Harga paket Pro Rp69.000 per bulan. Paket gratis tetap ada dengan batas ekspor 3 kali sebulan.");
decision("marketing", "2026-09-10", "pro-pricing", "Harga paket Pro naik jadi Rp79.000 per bulan mulai 1 Oktober; menggantikan harga Rp69.000. Pelanggan lama tetap Rp69.000 sampai Januari.",
  { topics: ["Harga paket Pro Rp79.000"], keywords: ["harga", "price", "pricing", "paket Pro", "Pro plan", "langganan", "subscription"] });
decision("marketing", "2026-09-24", "blog-cadence", "Blog terbit tiap Kamis pagi. Blog post besar (peluncuran, studi kasus) boleh di luar jadwal.");
note("marketing", "2026-09-18", "competitor-notes", "Andi mencatat fitur kompetitor: Descript punya studio sound yang meratakan volume otomatis, Riverside punya rekaman lokal 4K.");
note("marketing", "2026-10-01", "newsletter-ideas", "Maya's newsletter ideas: a behind-the-scenes post on waveform editing, a user story from a beta tester, and a tip on recording outdoors.");
note("marketing", "2026-09-05", "taglines", "Pilihan tagline: \"Rekam, rapikan, rilis\", \"Podcast tanpa ribet\", \"Suara jernih dari HP\".");
documentText("marketing", "brand-guidelines", [
  "# Brand guidelines",
  "Logo: always on a plain background, minimum 24 px tall.",
  "Colors: deep blue #1E3A8A, warm orange #F97316.",
  "Tone: friendly, short sentences, no jargon. Say \"podcast\", not \"audio content\".",
].join("\n"));
documentText("marketing", "press-kit", [
  "# Press kit Podkit",
  "Podkit adalah aplikasi untuk merekam dan mengedit podcast dari HP.",
  "Didirikan 2024 di Jakarta. 40.000 pengguna aktif bulanan.",
  "Kontak media: Maya.",
].join("\n"));

// #ops: infrastructure, on-call, incidents.
minutes("ops", "2026-08-26", "infra", "Infra review", {
  decided: ["API rate limit is 100 requests per minute per key", "Rate limiting moves from memory to Redis"],
  open: ["Whether the Pro plan gets a higher limit"],
  actions: ["**Eko**: Move the rate limiter to Redis", "**Fajar**: Add a dashboard for 429 responses"],
}, "Eko, Fajar");
minutes("ops", "2026-09-15", "oncall", "On-call and incident review", {
  decided: ["On-call rotates weekly, handover on Monday 10:00", "Log rotation is configured on every server after the disk-full incident"],
  open: ["Paging for the staging environment"],
  actions: ["**Fajar**: Write the on-call handbook", "**Eko**: Turn on log rotation on the API servers"],
}, "Eko, Fajar, Rina");
minutes("ops", "2026-10-06", "backup", "Rapat backup", {
  decided: ["Backup database harian jam 02:00 WIB, retensi 30 hari", "Uji restore tiap awal bulan"],
  open: ["Lokasi backup kedua di luar region"],
  actions: ["**Eko**: atur jadwal backup", "**Fajar**: dokumentasikan langkah restore"],
}, "Eko, Fajar");

dailyLog("ops", "2026-09-11", "Eko, Fajar", [
  { name: "Rapid response team untuk insiden", id: ["tim respons", "insiden"], en: ["rapid response", "incident"] },
  { name: "Capital expenditure server baru", id: ["belanja modal", "server"], en: ["capital expenditure", "servers"] },
  { name: "Upgrade Postgres", id: ["upgrade", "Postgres"], en: ["Postgres upgrade"] },
], {
  decided: ["Upgrade Postgres ke versi 17 bulan depan"],
  next: ["**Eko**: hitung capital expenditure server baru"],
});
dailyLog("ops", "2026-09-18", "Eko, Fajar, Rina", [
  { name: "Paket unlimited untuk enterprise", id: ["unlimited", "enterprise"], en: ["unlimited plan", "enterprise"] },
  { name: "Limitation of the CDN", id: ["CDN", "batasan"], en: ["CDN limitation"] },
  { name: "Blog teknik", id: ["blog", "tulisan"], en: ["engineering blog"] },
  { name: "Therapist untuk tim", id: ["kesehatan mental"], en: ["therapist", "wellbeing"] },
], {
  open: ["Harga paket unlimited enterprise"],
  next: ["**Fajar**: tulis blog teknik soal migrasi CDN"],
});
dailyLog("ops", "2026-09-25", "Eko, Fajar", [
  { name: "Alert disk", id: ["disk", "alert"], en: ["disk alerts"] },
  { name: "Sertifikat TLS", id: ["sertifikat", "TLS"], en: ["TLS certificates"] },
  { name: "Katalog layanan internal", id: ["katalog"], en: ["service catalog"] },
], {
  decided: ["Sertifikat TLS diperbarui otomatis lewat cert-manager"],
  next: ["**Eko**: tambah alert disk di 80%"],
});
dailyLog("ops", "2026-10-02", "Eko, Fajar", [
  { name: "Biaya cloud", id: ["biaya", "cloud"], en: ["cloud costs"] },
  { name: "Dialog konfirmasi hapus data", id: ["dialog", "hapus data"], en: ["delete confirmation dialog"] },
  { name: "Login SSO", id: ["login", "SSO"], en: ["SSO login"] },
], {
  open: ["Penghematan biaya cloud 20%"],
  next: ["**Fajar**: bandingkan harga instans reserved"],
});
dailyLog("ops", "2026-10-09", "Eko, Fajar, Rina", [
  { name: "Migrasi DNS", id: ["DNS", "migrasi"], en: ["DNS migration"] },
  { name: "Rapat vendor monitoring", id: ["vendor", "monitoring"], en: ["monitoring vendor"] },
  { name: "Capacity planning Q4", id: ["kapasitas"], en: ["capacity planning"] },
], {
  decided: ["DNS pindah ke Cloudflare minggu depan"],
  next: ["**Eko**: siapkan rencana rollback DNS"],
});

decision("ops", "2026-08-27", "rate-limit", "API rate limit: 100 requests per minute per API key, counted in Redis. Over the limit returns 429 with Retry-After.");
decision("ops", "2026-10-08", "rate-limit", "Rate limit API untuk paket Pro dinaikkan ke 300 request per menit per key; paket gratis tetap 100. Menggantikan keputusan 27 Agustus.");
decision("ops", "2026-09-16", "oncall-rotation", "On-call rotation: one engineer per week, handover Monday 10:00 WIB, Eko then Fajar then Rina.");
note("ops", "2026-09-14", "postmortem-outage", "Postmortem outage 13 September: server API down 40 menit karena disk penuh. Penyebab: log rotation belum dikonfigurasi, jadi file log membesar terus.");
note("ops", "2026-10-03", "vendor-contacts", "Vendor contacts: Cloudflare account manager Tia, Datadog support via the ticket portal, the colocation provider's NOC on WhatsApp.");
note("ops", "2026-09-08", "monitoring", "Fajar wants Grafana with Loki for log aggregation and Prometheus for metrics; Datadog is too expensive for staging.");
documentText("ops", "runbook-deploy", [
  "# Deploy runbook",
  "1. Merge to main; CI builds the image.",
  "2. Deploy to staging and run the smoke tests.",
  "3. Check the error dashboard for 15 minutes.",
  "4. Deploy to production with a 10% canary, then 100%.",
  "5. If errors rise, roll back with the previous image tag. The nightly backup is the last resort.",
].join("\n"));
documentText("ops", "sla", [
  "# Service level agreement",
  "Uptime target 99.5% per month for paid plans.",
  "Support replies within one business day.",
  "Planned maintenance is announced 48 hours ahead.",
].join("\n"));

// #general: company-wide, where people ask.
minutes("general", "2026-09-01", "allhands", "All-hands September", {
  decided: ["Hiring two engineers in Q4", "OKR review moves to the first Friday of each month"],
  open: ["Office snacks budget"],
  actions: ["**Rina**: Post the engineer job ads"],
}, "Rina, Maya, Eko, Budi");
minutes("general", "2026-10-05", "allhands", "All-hands Oktober", {
  decided: ["Kantor pindah ke Kemang mulai November", "Tim kerja dari rumah selama minggu pindahan"],
  open: ["Parkir motor di kantor baru"],
  actions: ["**Maya**: survei kebutuhan meja di kantor baru"],
}, "Rina, Maya, Eko, Budi", { topics: ["Kantor pindah ke Kemang"], keywords: ["kantor", "office", "pindah", "office move", "relocation", "Kemang"] });
dailyLog("general", "2026-09-29", "Rina, Maya", [
  { name: "Ulang tahun perusahaan", id: ["ulang tahun", "perayaan"], en: ["company anniversary"] },
  { name: "Asuransi kesehatan", id: ["asuransi"], en: ["health insurance"] },
], { next: ["**Maya**: pesan kue ulang tahun perusahaan"] });
dailyLog("general", "2026-10-07", "Rina, Eko", [
  { name: "Wifi kantor lambat", id: ["wifi", "internet"], en: ["office wifi"] },
  { name: "Jadwal cuti bersama", id: ["cuti"], en: ["public holidays"] },
], { open: ["Ganti provider internet kantor"] });
decision("general", "2026-09-02", "remote-policy", "Kebijakan kerja: WFH setiap Senin dan Jumat, Selasa sampai Kamis di kantor.");
note("general", "2026-10-10", "team-dinner", "Makan malam tim tanggal 24 Oktober di Senopati; Maya yang pesan tempat.");
note("general", "2026-09-20", "onboarding", "Onboarding checklist for new hires: laptop, Discord and GitHub access, a buddy for the first two weeks, and a walk through the Podkit app.");

// v2 (#222): files for the harder questions. Each answers in one word form or language while the question uses another, and each
// has a distractor that shares the question's other words, or a base word the question's derived word grows from.

// Indonesian prefixed forms: the file has the base word, the question the prefixed one (or the other way round).
note("audio", "2026-10-12", "export-templates", "Implementasi template ekspor selesai: pengguna bisa simpan preset format dan bitrate sendiri.");
decision("audio", "2026-10-10", "release-2-4", "2.4 rilis tanggal 14 Oktober sesuai rencana. Ekspor batch tidak ikut, nanti di 2.5.");
note("marketing", "2026-10-11", "payments", "Pelanggan bisa bayar lewat QRIS, transfer bank, atau kartu kredit mulai November.");
dailyLog("marketing", "2026-10-09", "Maya, Andi, Sari", [
  { name: "Cara menjawab keluhan pelanggan", id: ["cara", "keluhan", "pelanggan"], en: ["customer complaints"] },
  { name: "Template email pelanggan", id: ["template", "email", "pelanggan"], en: ["customer email template"] },
], { next: ["**Sari**: tulis cara menjawab keluhan pelanggan soal harga"] });
note("ops", "2026-10-13", "disk-alert-fix", "Eko perbaiki alert disk yang salah bunyi tiap malam; ambangnya sekarang 85%.");
note("audio", "2026-10-14", "batch-export-delay", "Ekspor batch tunda ke versi 2.5 karena antrean di server belum siap. Yang lain tetap jalan.");

// Indonesian–English pairs that share no stem: the question in one language, the file in the other.
note("general", "2026-10-12", "q4-budget", "Q4 budget: Rp120 juta for hiring, Rp30 juta for laptops, Rp10 juta for the office move.");
documentText("ops", "uptime-report-september", [
  "# Uptime report, September 2026",
  "Uptime 99.7% for the month. One outage on 13 September: 40 minutes, disk full on the API server.",
  "Mean time to recovery 40 minutes. No data lost.",
].join("\n"));
decision("general", "2026-10-01", "weekly-meeting", "The weekly team meeting moves from Monday to Wednesday 13:00, starting in October.");
note("ops", "2026-10-11", "task-board", "Fajar moved every ops task to the Plane board; each task has an owner and a due date.");

// Stem collisions: the question has a derived word, a distractor its base word in a heading and keywords.
dailyLog("ops", "2026-10-13", "Eko, Fajar", [
  { name: "Ukuran instans optimal", id: ["optimal", "instans"], en: ["right-sizing", "instances"] },
  { name: "Akses database staging", id: ["database", "akses"], en: ["staging database access"] },
], { decided: ["Instans staging diturunkan ke ukuran optimal"], next: ["**Fajar**: buka akses database staging untuk QA"] });
note("ops", "2026-10-14", "db-optimization", "Optimasi database: index baru di tabel episodes memangkas waktu respons dari 800 ms ke 120 ms.");
dailyLog("audio", "2026-10-13", "Rina, Sari", [
  { name: "Kualitas standar rekaman", id: ["standar", "kualitas"], en: ["recording quality standard"] },
  { name: "Format file dari tamu", id: ["format", "file", "tamu"], en: ["guest file formats"] },
], { decided: ["Rekaman tamu minimal standar 44,1 kHz"] });
note("audio", "2026-10-14", "file-naming", "File name standardization for exports: date-title-episode.wav, agreed by Rina and Sari.");
dailyLog("marketing", "2026-10-12", "Maya, Andi", [
  { name: "Testimoni real dari pengguna", id: ["real", "testimoni"], en: ["real testimonials"] },
  { name: "Iklan audio baru", id: ["iklan", "audio"], en: ["new audio ads"] },
], { next: ["**Andi**: edit iklan audio versi 15 detik"] });
note("marketing", "2026-10-13", "ad-spend", "Realized ad spend for September: Rp38 juta of the Rp45 juta budget.");
note("audio", "2026-10-15", "localization", "App localization into English and Malay is on Sari for version 2.5.");

export const BENCHMARK_FILES: readonly KeptFile[] = files;

const AUDIO_NORMALIZATION = [shown("audio", "minutes/2026-08-19-loudness.md"), shown("audio", "decisions/2026-08-20-loudness-target.md"), shown("audio", "minutes/2026-09-02-weekly.md")];

const V1_QUESTIONS: Question[] = [
  { id: "normalisasi-id-only", asked: "normalisasi audio sudah pernah dibahas?", queries: ["normalisasi audio"], expected: AUDIO_NORMALIZATION },
  { id: "normalisasi-sentence", asked: "apakah fitur normalisasi audio sudah pernah dibahas dan diimplementasi?", queries: ["apakah fitur normalisasi audio sudah pernah dibahas dan diimplementasi?"], expected: AUDIO_NORMALIZATION },
  { id: "normalisasi-variants", asked: "normalisasi audio sudah dibahas?", queries: ["normalisasi audio", "audio normalization", "loudness"], expected: AUDIO_NORMALIZATION },
  { id: "who-implements-normalization", asked: "siapa yang implementasi normalisasi audio?", queries: ["siapa yang implementasi normalisasi audio"], expected: [shown("audio", "minutes/2026-09-02-weekly.md"), shown("audio", "minutes/2026-08-19-loudness.md")] },
  { id: "loudness-target-now", asked: "berapa target loudness sekarang?", queries: ["target loudness", "LUFS target"], expected: [shown("audio", "decisions/2026-10-02-loudness-target.md")] },
  { id: "release-date-id", asked: "kapan rilis 2.4?", queries: ["rilis 2.4"], expected: [shown("audio", "minutes/2026-09-30-release.md"), shown("marketing", "minutes/2026-09-23-launch.md")] },
  { id: "android-crash", asked: "aplikasi crash di Android sudah dibahas?", queries: ["aplikasi crash di Android"], expected: [shown("audio", "notes/2026-09-12-android-crash.md"), shown("audio", "minutes/2026-09-16-weekly.md"), shown("audio", "daily-logs/2026-09-17.md"), shown("audio", "daily-logs/2026-10-01.md")] },
  { id: "api-rate-limit", asked: "what is the API rate limit?", queries: ["API rate limit"], expected: [shown("ops", "decisions/2026-10-08-rate-limit.md"), shown("ops", "decisions/2026-08-27-rate-limit.md"), shown("ops", "minutes/2026-08-26-infra.md")] },
  { id: "outage-cause", asked: "penyebab server down tanggal 13 september apa?", queries: ["penyebab server down tanggal 13 september"], expected: [shown("ops", "notes/2026-09-14-postmortem-outage.md"), shown("ops", "minutes/2026-09-15-oncall.md")] },
  { id: "log-rotation", asked: "was log rotation set up?", queries: ["log rotation"], expected: [shown("ops", "notes/2026-09-14-postmortem-outage.md"), shown("ops", "minutes/2026-09-15-oncall.md")] },
  { id: "pro-price-id", asked: "harga paket Pro berapa?", queries: ["harga paket Pro"], expected: [shown("marketing", "decisions/2026-09-10-pro-pricing.md"), shown("marketing", "minutes/2026-09-09-pricing.md")] },
  { id: "pro-price-en", asked: "what does the Pro plan cost?", queries: ["Pro plan price"], expected: [shown("marketing", "decisions/2026-09-10-pro-pricing.md"), shown("marketing", "minutes/2026-09-09-pricing.md")] },
  { id: "launch-blog-post", asked: "kapan blog post peluncuran terbit?", queries: ["blog post peluncuran"], expected: [shown("marketing", "minutes/2026-09-23-launch.md")] },
  { id: "wfh-policy", asked: "kebijakan WFH gimana?", queries: ["kebijakan WFH"], expected: [shown("general", "decisions/2026-09-02-remote-policy.md")] },
  { id: "office-move-en", asked: "when is the office move?", queries: ["office move"], expected: [shown("general", "minutes/2026-10-05-allhands.md")] },
  { id: "backup-schedule", asked: "jadwal backup database?", queries: ["jadwal backup database"], expected: [shown("ops", "minutes/2026-10-06-backup.md")] },
  { id: "noise-reduction", asked: "how does the noise reduction model work?", queries: ["noise reduction model"], expected: [shown("audio", "files/spec-noise-reduction.md"), shown("audio", "minutes/2026-09-16-weekly.md")] },
  { id: "oncall-schedule", asked: "jadwal on-call gimana?", queries: ["jadwal on-call"], expected: [shown("ops", "decisions/2026-09-16-oncall-rotation.md"), shown("ops", "minutes/2026-09-15-oncall.md")] },
  { id: "competitor-features", asked: "fitur kompetitor Descript apa saja?", queries: ["fitur kompetitor Descript"], expected: [shown("marketing", "notes/2026-09-18-competitor-notes.md")] },
  { id: "export-formats-id", asked: "format ekspor apa saja yang didukung?", queries: ["format ekspor yang didukung"], expected: [shown("audio", "decisions/2026-09-05-export-formats.md")] },
  { id: "normalize-en", asked: "did we ever normalize the audio?", queries: ["normalize audio"], expected: AUDIO_NORMALIZATION },
  { id: "rate-limiting-sentence", asked: "has the team ever talked about rate limiting for the API?", queries: ["has the team ever talked about rate limiting for the API"], expected: [shown("ops", "decisions/2026-10-08-rate-limit.md"), shown("ops", "decisions/2026-08-27-rate-limit.md"), shown("ops", "minutes/2026-08-26-infra.md")] },
  { id: "pro-price-sentence", asked: "apa keputusan terbaru soal harga paket Pro?", queries: ["apa keputusan terbaru soal harga paket Pro"], expected: [shown("marketing", "decisions/2026-09-10-pro-pricing.md"), shown("marketing", "minutes/2026-09-09-pricing.md")] },
  { id: "oncall-sentence", asked: "siapa yang pegang on-call dan kapan serah terimanya?", queries: ["siapa yang pegang on-call dan kapan serah terimanya"], expected: [shown("ops", "decisions/2026-09-16-oncall-rotation.md"), shown("ops", "minutes/2026-09-15-oncall.md")] },
  { id: "crashes-plural", asked: "were the recording crashes fixed?", queries: ["recording crashes fixed"], expected: [shown("audio", "daily-logs/2026-10-01.md"), shown("audio", "minutes/2026-09-30-release.md"), shown("audio", "notes/2026-09-12-android-crash.md"), shown("audio", "minutes/2026-09-16-weekly.md"), shown("audio", "daily-logs/2026-09-17.md")] },
  { id: "newsletter-ideas", asked: "any newsletter ideas?", queries: ["newsletter ideas"], expected: [shown("marketing", "notes/2026-10-01-newsletter-ideas.md")] },
];

/** The 26 questions of v1 (#208); all of them must stay in the top 3. */
export const V1_QUESTION_COUNT = 26;

const RELEASE_2_4 = [shown("audio", "minutes/2026-09-30-release.md"), shown("audio", "decisions/2026-10-10-release-2-4.md")];
const ANDROID_CRASH = [shown("audio", "notes/2026-09-12-android-crash.md"), shown("audio", "minutes/2026-09-16-weekly.md"), shown("audio", "daily-logs/2026-09-17.md"), shown("audio", "daily-logs/2026-10-01.md"), shown("audio", "minutes/2026-09-30-release.md")];

/** v2 (#222): harder questions in four groups; many miss today, which is what the next matching change is measured by. */
const V2_QUESTIONS: Question[] = [
  // Indonesian prefixed forms against base forms.
  { group: "prefix", id: "diimplementasikan", asked: "template ekspor sudah diimplementasikan?", queries: ["template yang diimplementasikan"], expected: [shown("audio", "notes/2026-10-12-export-templates.md")] },
  { group: "prefix", id: "dirilis", asked: "versi apa yang dirilis 14 Oktober?", queries: ["versi yang dirilis 14 Oktober"], expected: [shown("audio", "decisions/2026-10-10-release-2-4.md")] },
  { group: "prefix", id: "pembayaran", asked: "gimana cara pembayaran pelanggan?", queries: ["cara pembayaran pelanggan"], expected: [shown("marketing", "notes/2026-10-11-payments.md")] },
  { group: "prefix", id: "perbaikan", asked: "perbaikan alert disk sudah?", queries: ["perbaikan alert disk"], expected: [shown("ops", "notes/2026-10-13-disk-alert-fix.md")] },
  { group: "prefix", id: "ditunda", asked: "fitur apa yang ditunda?", queries: ["fitur yang ditunda"], expected: [shown("audio", "notes/2026-10-14-batch-export-delay.md")] },
  // Indonesian–English pairs that share no stem.
  { group: "pair", id: "anggaran-budget", asked: "anggaran Q4 berapa?", queries: ["anggaran Q4"], expected: [shown("general", "notes/2026-10-12-q4-budget.md")] },
  { group: "pair", id: "laporan-report", asked: "ada laporan uptime September?", queries: ["laporan uptime September"], expected: [shown("ops", "files/uptime-report-september.md")] },
  { group: "pair", id: "rapat-meeting", asked: "rapat mingguan pindah ke hari apa?", queries: ["rapat mingguan pindah"], expected: [shown("general", "decisions/2026-10-01-weekly-meeting.md")] },
  { group: "pair", id: "tugas-task", asked: "tugas ops Fajar ditaruh di mana?", queries: ["tugas ops Fajar"], expected: [shown("ops", "notes/2026-10-11-task-board.md")] },
  { group: "pair", id: "schedule-jadwal", asked: "what is the blog publishing schedule?", queries: ["blog publishing schedule"], expected: [shown("marketing", "decisions/2026-09-24-blog-cadence.md")] },
  { group: "pair", id: "export-ekspor", asked: "what is the export limit on the free plan?", queries: ["free plan export limit"], expected: [shown("marketing", "decisions/2026-08-14-pro-pricing.md")] },
  // Stem collisions: a derived word in the question, its base word in a distractor.
  { group: "collision", id: "normalisasi-volume", asked: "normalisasi volume podcast gimana?", queries: ["normalisasi volume podcast"], expected: [...AUDIO_NORMALIZATION, shown("audio", "decisions/2026-10-02-loudness-target.md")] },
  { group: "collision", id: "optimasi-optimal", asked: "optimasi database sudah dilakukan?", queries: ["optimasi database"], expected: [shown("ops", "notes/2026-10-14-db-optimization.md")] },
  { group: "collision", id: "standardisasi-standar", asked: "standardisasi nama file gimana?", queries: ["standardisasi nama file"], expected: [shown("audio", "notes/2026-10-14-file-naming.md")] },
  { group: "collision", id: "realisasi-real", asked: "realisasi anggaran iklan berapa?", queries: ["realisasi anggaran iklan"], expected: [shown("marketing", "notes/2026-10-13-ad-spend.md")] },
  { group: "collision", id: "lokalisasi-lokal", asked: "lokalisasi aplikasi sudah direncanakan?", queries: ["lokalisasi aplikasi"], expected: [shown("audio", "notes/2026-10-15-localization.md")] },
  // Full-sentence questions mixing Indonesian and English.
  { group: "sentence", id: "release-why", asked: "kapan release 2.4 dan kenapa diundur?", queries: ["kapan release 2.4 dan kenapa diundur?"], expected: RELEASE_2_4 },
  { group: "sentence", id: "pro-rate-limit", asked: "berapa rate limit untuk Pro plan sekarang?", queries: ["berapa rate limit untuk Pro plan sekarang?"], expected: [shown("ops", "decisions/2026-10-08-rate-limit.md")] },
  { group: "sentence", id: "restore-test", asked: "apakah backup database sudah di-test restore?", queries: ["apakah backup database sudah di-test restore?"], expected: [shown("ops", "minutes/2026-10-06-backup.md")] },
  { group: "sentence", id: "annual-price", asked: "what did we decide soal harga paket tahunan?", queries: ["what did we decide soal harga paket tahunan?"], expected: [shown("marketing", "minutes/2026-09-09-pricing.md"), shown("marketing", "daily-logs/2026-09-08.md")] },
  { group: "sentence", id: "android-crash-status", asked: "where do we stand dengan crash Android 14?", queries: ["where do we stand dengan crash Android 14?"], expected: ANDROID_CRASH },
  { group: "sentence", id: "influencer-budget", asked: "budget untuk influencer Q3 berapa ya?", queries: ["budget untuk influencer Q3 berapa ya?"], expected: [shown("marketing", "minutes/2026-08-12-campaign.md")] },
];

export const BENCHMARK_QUESTIONS: readonly Question[] = [...V1_QUESTIONS, ...V2_QUESTIONS];

/** The files a `searchFiles` result shows, in the order the model reads them; a cut result still gives the paths before the cut. */
export function shownPaths(result: unknown): string[] {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return [...text.matchAll(/"path":"([^"]+)"/g)].map((m) => m[1]!);
}

/** A Task as the bot keeps it, in a channel of the corpus: one-line JSON frontmatter values, then its description. */
const tasks: KeptFile[] = [];
function task(channel: Channel, title: string, status: string, created: string, description = "") {
  const n = tasks.length + 1, id = `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const head = header({ id, title, status, priority: "medium", createdBy: "user-alice", createdByName: "Alice", createdAt: `${created}T03:00:00.000Z`, updatedAt: `${created}T03:00:00.000Z` });
  tasks.push({ path: `guilds/guild-1/channels/${CHANNELS[channel].id}/tasks/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 8)}.md`, content: `${head}${description}\n` });
}
task("audio", "Waveform trim and cut", "completed", "2026-07-29");
task("audio", "Undo after trim", "pending", "2026-09-10", "Undo after a trim loses the selection.");
task("audio", "Implement audio normalization in the export pipeline", "completed", "2026-08-19", "Target -14 LUFS for every export.");
task("audio", "Fix the recording crash on Android 14", "in_progress", "2026-09-12", "The app closes when recording starts on Android 14 phones.");
task("audio", "Noise reduction model on device", "pending", "2026-09-16");
task("audio", "Export templates", "pending", "2026-10-12", "Saved export settings for each show.");
task("audio", "Batch export", "cancelled", "2026-10-14", "Moved to version 2.6.");
task("audio", "Localize the app into Malay", "pending", "2026-10-15");
task("marketing", "Write the launch blog post", "completed", "2026-09-23");
task("marketing", "Pick a social media scheduling tool", "pending", "2026-09-20", "Compare three tools for scheduling posts.");
task("marketing", "Brief the influencers for Q3", "completed", "2026-08-12");
task("marketing", "Newsletter for October", "pending", "2026-10-01", "Ideas: the new export templates and a user story.");
task("marketing", "Update the Pro plan pricing page", "completed", "2026-09-10");
task("ops", "Set up log rotation", "completed", "2026-09-15");
task("ops", "Test a database restore from backup", "pending", "2026-10-06", "Restore last night's backup to staging and time it.");
task("ops", "Raise the API rate limit for Pro", "completed", "2026-10-08");
task("ops", "Fix the disk usage alert", "completed", "2026-10-13");
task("ops", "On-call handover checklist", "pending", "2026-09-16");
task("general", "Book the new office", "pending", "2026-10-05", "The team moves in November.");
task("general", "Q4 budget sheet", "in_progress", "2026-10-12");

export const BENCHMARK_TASKS: readonly KeptFile[] = tasks;

/** One question about a Task, as a model would recall it, with the titles of the Tasks a person would accept as answering it. */
export interface TaskQuestion { id: string; group: "named" | "other-words"; asked: string; queries: string[]; expected: string[] }

/**
 * #258: Tasks asked about from #general. `named` questions use words the Task holds; `other-words` questions name it in other words, so no
 * wording is held whole (the live exam's "trim tool udah rilis?" against "Waveform trim and cut").
 */
export const TASK_QUESTIONS: readonly TaskQuestion[] = [
  { group: "named", id: "normalization-done", asked: "normalisasi audio udah selesai?", queries: ["normalisasi audio", "audio normalization"], expected: ["Implement audio normalization in the export pipeline"] },
  { group: "named", id: "log-rotation", asked: "log rotation udah diset?", queries: ["log rotation", "rotasi log"], expected: ["Set up log rotation"] },
  { group: "named", id: "launch-blog-post", asked: "blog post peluncuran udah?", queries: ["blog post peluncuran", "launch blog post"], expected: ["Write the launch blog post"] },
  { group: "named", id: "pro-rate-limit", asked: "rate limit Pro udah dinaikkan?", queries: ["rate limit Pro", "raise Pro rate limit"], expected: ["Raise the API rate limit for Pro"] },
  { group: "named", id: "malay", asked: "lokalisasi ke bahasa Melayu siapa yang pegang?", queries: ["lokalisasi bahasa Melayu", "Malay localization"], expected: ["Localize the app into Malay"] },
  { group: "named", id: "influencer-brief", asked: "brief influencer Q3 udah?", queries: ["brief influencer", "influencer brief Q3"], expected: ["Brief the influencers for Q3"] },
  { group: "other-words", id: "trim-tool", asked: "trim tool udah rilis?", queries: ["trim tool rilis", "trim tool released"], expected: ["Waveform trim and cut"] },
  { group: "other-words", id: "android-crash-shipped", asked: "has the Android 14 crash fix shipped?", queries: ["android 14 crash fix shipped", "crash android 14 rilis"], expected: ["Fix the recording crash on Android 14"] },
  { group: "other-words", id: "backup-restore-tried", asked: "restore backup udah dicoba?", queries: ["restore backup dicoba", "backup restore tried"], expected: ["Test a database restore from backup"] },
  { group: "other-words", id: "newsletter-sent", asked: "newsletter bulan ini udah dikirim?", queries: ["newsletter bulan ini dikirim", "newsletter sent this month"], expected: ["Newsletter for October"] },
  { group: "other-words", id: "office-booked", asked: "sewa kantor baru udah beres?", queries: ["sewa kantor baru", "office lease signed"], expected: ["Book the new office"] },
];

/**
 * Asks every question in one turn from #general, over the corpus channels holding `files`: one `tool` call per question, `step` calls
 * per model response, the per-minute tool counters cleared before each (a person may make 30 tool calls a minute). Returns every tool
 * result of the turn, in order.
 */
export async function askAll(s: Scenario, files: readonly KeptFile[], tool: string, questions: readonly { queries: string[] }[], step: number): Promise<any[]> {
  await s.guildSettings({ language: "en", useThreads: false });
  for (const c of BENCHMARK_CHANNELS) s.discord.channel(c.id).name = c.name;
  for (const f of files) await s.workspace.write(f.path, f.content);
  const { resetGuardrailState } = await import(process.cwd() + "/packages/skills/src/guardrails.ts");
  const calls = questions.map((q) => ({ tool, args: { queries: q.queries } }));
  const chunks = Array.from({ length: Math.ceil(calls.length / step) }, (_, i) => calls.slice(i * step, i * step + step));
  let results: any[] = [];
  s.model.script(...chunks.map((chunk) => () => {
    resetGuardrailState();
    return chunk;
  }), (turn) => {
    results = turn.toolResults;
    return "Done.";
  }, "The benchmark ran."); // the turn's tool results move the history window, so the rolling summary asks the model once
  await s.discord.send(`${s.discord.mention} benchmark`);
  return results;
}

/** A question's result: the rank (from 1) of the first item shown that `hits`, 0 when none does, and the first three shown. A question with no group is one of v1. */
export interface Row { id: string; group: string; rank: number; expected: string[]; top3: string[] }
export const rowOf = (q: { id: string; group?: string; expected: string[] }, shown: string[], hits: (item: string) => boolean): Row =>
  ({ id: q.id, group: q.group ?? "v1", rank: shown.findIndex(hits) + 1, expected: q.expected, top3: shown.slice(0, 3) });
export const inTop3 = (r: Row) => r.rank >= 1 && r.rank <= 3;

/** Top-1 hits, top-3 hits and mean reciprocal rank (two places) of the rows; prints every row, then `title` with the totals and `corpus`. */
export function scored(rows: readonly Row[], title: string, corpus: string) {
  const top1 = rows.filter((r) => r.rank === 1).length, top3 = rows.filter(inTop3).length;
  const mrr = Math.round((rows.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / rows.length) * 100) / 100;
  console.log(rows.map((r) => `${inTop3(r) ? "HIT " : "MISS"} ${r.group}/${r.id} (rank ${r.rank || "-"})\n     expected: ${r.expected.join(", ")}\n     top 3:    ${r.top3.join(", ") || "(none)"}`).join("\n"));
  console.log(`${title} top-1: ${top1}/${rows.length}  Top-3: ${top3}/${rows.length}  MRR@10: ${mrr.toFixed(2)}  (${corpus})`);
  return { top1, top3, mrr };
}
