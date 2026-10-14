/** The languages the bot's own fixed text comes in; anything else gets English. */
export type Language = "en" | "id";

/** Discord rejects message content over 2000 characters. */
export const MESSAGE_LIMIT = 2000;

const EN = new Set("the a an and or but is are was were be been to of in on at for with from by as it its this that these those when which who not no should must can does do has have will would every each than then so if".split(" "));
const ID = new Set("yang dan atau di ke dari untuk dengan tidak bukan ini itu ada akan pada saat jika kalau bisa dapat harus sudah juga dalam oleh sebagai agar supaya karena masih setiap tetap hanya lebih sama tanpa ketika sehingga perlu sedang belum lalu tolong saya aku kamu kita kami apa gimana bagaimana kenapa nggak gak udah aja dong sih nih".split(" "));

/** English or Indonesian by function words; "unknown" when neither leads or fewer than `least` were found. */
export function languageOf(text: string, least = 3): Language | "unknown" {
  let en = 0, id = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) { if (EN.has(word)) en++; if (ID.has(word)) id++; }
  return en + id < least || en === id ? "unknown" : en > id ? "en" : "id";
}

/** The language for the bot's own text about these messages: Indonesian when they read so, English otherwise. Chat is short, so two function words decide. */
export const replyLanguage = (...texts: (string | null | undefined)[]): Language => (languageOf(texts.filter(Boolean).join("\n"), 2) === "id" ? "id" : "en");

export const DEFAULT_LANGUAGE: Language = "id";
export const isLanguage = (value: unknown): value is Language => value === "id" || value === "en";
/** The language for text the bot writes with no message to detect from (Digest, Reminder framing, provider errors): the guild's override, else the tenant's. */
export const configuredLanguage = (...levels: ({ language?: string | null } | null | undefined)[]): Language => levels.map((l) => l?.language).find(isLanguage) ?? DEFAULT_LANGUAGE;

const MONTHS_EN = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const MONTHS_ID = "Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des".split(" ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (items: string[], and: string) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`);

const en = {
  and: "and",
  // Replies
  cutNote: "-# Cut to stay within 3 messages. Ask for the rest if you need the full version.",
  nothingToAdd: "I have nothing to add here.",
  done: "Done.",
  failed: "Unable to process this request. Check your tenant configuration.",
  // Provider errors
  providerFailed: "I couldn't reach the model provider just now. Try again in a moment.",
  providerNoKey: (provider: string) => `No ${provider} API key is set for this tenant, so I can't answer. An admin has to add the API key first.`,
  providerNoBaseUrl: "No base URL is set for the custom provider, so I can't answer. An admin has to add the base URL first.",
  // Images
  blind: "I can't see images with this profile.",
  describeImage: "Describe the image in words and I'll work from that.",
  rejected: "This profile rejected the image; an admin can turn image input off for it.",
  skipped: (items: string[]) => `Skipped ${items.join(", ")}.`,
  skip: { format: "not a PNG, JPEG, WebP or GIF", tooMany: (n: number) => `over the ${n}-image limit`, tooLarge: "too large to download", download: "could not be downloaded", unreadable: "could not be read as an image", tooBig: "could not be reduced under 5 MB" },
  // Filed documents
  notFiled: { type: "not filed: not a PDF, DOCX, XLSX, CSV, MD or TXT", tooLarge: "not filed: over 10 MB", download: "not filed: could not be downloaded", place: "not filed: no folder for this place" },
  textNotExtracted: "its text could not be extracted",
  folderRefused: (allowed: string[]) => `Only ${allowed.join(", ")} may sit at the top of a channel or DM folder; put it under one of them.`,
  // Memory compaction, written into MEMORY.md as the bot
  memoryCompacted: (from: number, to: number) => `Memory compacted from ${plural(from, "line")} to ${to}; every line from the last 30 days kept.`,
  memoryCut: (dropped: number) => `Memory over its size; the ${plural(dropped, "oldest line")} dropped, every line from the last 30 days kept.`,
  // Brief rounds
  breakdown: (n: number) => `**Breakdown** · ${plural(n, "draft")}`,
  draftPoint: (n: number) => `point ${n}`,
  blockedByDrafts: (ns: number[]) => `blocked by draft ${ns.join(", ")}`,
  round: (n: number) => `**Round ${n}**`,
  point: (n: number, text: string) => `**Point ${n}** · ${text}`,
  wholeBrief: "**Whole brief**",
  askedAgain: (round: number) => `-# Asked again from round ${round}. Left unanswered this time, ➡️ becomes an assumption in the draft.`,
  roundFooter: (author: string) => `Only <@${author}> decides here. Reply "yes" to take every ➡️, or answer by number, e.g. "yes, except Q2: …".`,
  noQuestions: (author: string) => `No questions this round. Only <@${author}> decides here: reply "yes" to accept the breakdown, or say what to change.`,
  describeQuestion: (image: string) => `What does ${image} show? I can't see images with this profile, so describe it in words for the drafts.`,
  describeRecommendation: "Link it in the drafts without a description.",
  authorDecides: (author: string) => `-# <@${author}> decides on this brief; I've noted your message for their next round.`,
  // Creating issues
  createIssues: (n: number) => `Create ${plural(n, "issue")} from this brief:`,
  labels: (names: string[]) => `labels: ${names.join(", ")}`,
  blockedBy: (refs: string[]) => `blocked by ${refs.join(", ")}`,
  draft: (n: number) => `draft ${n}`,
  skippedDrafts: (items: string[]) => `Skipped: ${items.join("; ")}`,
  created: (n: number) => `Created ${plural(n, "issue")} from this brief:`,
  briefDone: "-# This brief is done. Messages here are ordinary chat from now on.",
  stoppedAt: (n: number, title: string, error: string) => `Stopped at draft ${n}, ${title}: ${error}`,
  createdHeading: "**Created**",
  nothingCreated: "Nothing was created.",
  notCreatedHeading: "**Not created**",
  continueRest: `Say "continue the rest" to create the drafts not created yet, under a new confirmation. drafts.md has them to paste by hand.`,
  unlinked: (pairs: string[]) => `-# Could not link ${pairs.join(", ")}, so ${pairs.length > 1 ? "their Blocked by sections say" : "its Blocked by section says"} it in text.`,
  unlinkedPair: (issue: number, blocker: number) => `#${issue} as blocked by #${blocker}`,
  createdLink: (url: string) => `Created: ${url}`,
  batchStopped: (n: number, count: number) => `Stopped at draft ${n} with ${plural(count, "issue")} created. Details are in the thread.`,
  batchDone: (count: number) => `Created ${plural(count, "issue")}. The links are in the thread.`,
  // Playbooks
  skillsOff: (playbook: string, names: string[]) => `The ${playbook} playbook needs the ${list(names, "and")} skill${names.length > 1 ? "s" : ""}, which ${names.length > 1 ? "are" : "is"} off here. An admin can turn ${names.length > 1 ? "them" : "it"} on in the console.`,
  playbookOff: (playbook: string) => `The ${playbook} playbook is off here. An admin can turn it on in the console.`,
  repositoryNone: (playbook: string) => `The ${playbook} playbook needs a repository, and git scope allows none here. An admin can open one in the console under the server's git access.`,
  playbookEnded: (playbook: string) => `-# The ${playbook} playbook is no longer available here, so this thread stops following it. Messages here are ordinary chat from now on.`,
  noThread: "I couldn't open a thread for this message. Check that I can create threads in this channel.",
  alreadyBound: (playbook: string) => `This thread already follows the ${playbook} playbook.`,
  notSaved: "I couldn't save this thread to the Workspace, so the playbook did not start. Try again in a moment.",
  botOff: "This bot is turned off.",
  wrongServer: "Playbooks run only in the servers this bot is set up for.",
  commandGone: "This command is no longer available.",
  following: (playbook: string, thread: string) => `Following the ${playbook} playbook in <#${thread}>.`,
  // Confirmations
  toolOffSinceAsked: "This tool was turned off here after you asked, so I won't run it. An admin can turn it back on in the console.",
  // Posting in another channel
  postNoChannel: "I can't find that channel in this server.",
  postNeedView: "You can't see that channel, so I won't post there.",
  postBotMissing: (names: string, many: boolean) => `I can't post there: I'm missing the ${names} permission${many ? "s" : ""} in that channel. A server admin can grant ${many ? "them" : "it"}.`,
  // Minutes
  minutesOfThread: "Writing minutes of this whole thread.",
  minutesFromHere: "Writing minutes from this message to now.",
  minutesDm: "I write minutes only in server channels and threads, not in DMs.",
  minutesNeedPermission: (names: string) => `You need ${names} here to get minutes of it, so I won't write them.`,
  minutesNotMember: "This is a private thread you are not a member of, so I won't write minutes of it.",
  minutesBotMissing: (names: string, many: boolean) => `I can't write minutes here because I'm missing the ${names} permission${many ? "s" : ""} in this channel. A server admin can grant ${many ? "them" : "it"}.`,
  minutesEmpty: "I found no messages to write minutes of in this range.",
  minutesFailed: "I couldn't write the minutes this time. Try again in a moment.",
  minutesNotPosted: (file: boolean) => `I couldn't post the minutes here. Check that I have Send Messages and Embed Links${file ? ", plus Attach Files for minutes.md" : ""}.`,
  minutesNoCopy: "I can't find the stored copy of these minutes, so I can't change them.",
  minutesNoCopyBrief: "I can't find the stored copy of these minutes, so I can't draft issues from them.",
  minutesCorrectionFailed: "I couldn't apply that correction. Try saying it another way.",
  minutesEditFailed: "I couldn't edit the minutes message.",
  minutesNoActions: "These minutes have no action items to draft issues from.",
  minutesNotActions: (wrong: string[], span: string) => `${wrong.length > 1 ? `Items ${list(wrong, "and")} aren't action items` : `Item ${wrong[0]} isn't an action item`}. In these minutes the action items are ${span}.`,
  minutesSpan: (items: string[], range: boolean) => (items.length === 1 ? `item ${items[0]}` : `items ${range ? `${items[0]} to ${items.at(-1)}` : list(items, "and")}`),
  minutesTooMany: (max: number, count: number, first: number) => `A brief holds at most ${max} points and these minutes have ${count} action items. Mention me on them with the ones to draft, e.g. "turn ${first} to ${first + 9} into issues".`,
  minutesCount: (n: number) => plural(n, "message"),
  minutesCutCount: (n: number, when: string) => `Cut to the latest ${n} messages: everything before ${when} was left out.`,
  minutesCutHours: (n: number, when: string) => `Cut to the last ${n} hours: everything before ${when} was left out.`,
  minutesFooter: "Reply to correct",
  // Reminders
  reminder: (text: string) => `Reminder: ${text}`,
  reminderNotFound: "I can't find an active Reminder with that id.",
  reminderNotYours: "That Reminder belongs to someone else; only its owner or someone with Manage Messages can cancel it.",
  reminderLimitOwner: (n: number) => `You already have ${n} active Reminders, the most one person can keep. Cancel one before setting another.`,
  reminderLimitTenant: (n: number) => `Reminders here are at their limit of ${n} active. Cancel one before setting another.`,
  reminderLate: (day: number, month: number, time: string) => `-# Posted late: this was due ${day} ${MONTHS_EN[month - 1]}, ${time}.`,
  openTasks: "Open tasks (status | due | owner | id | title):",
  // Digest
  digestDueToday: "**Due today**",
  digestLate: "**Late**",
  daysLate: (n: number) => `${plural(n, "day")} late`,
  // Channel history
  historyNoChannel: "I can't find that channel.",
  historyDm: "I read channel history only in server channels and threads, not in DMs.",
  historyNeedPermission: (names: string) => `You need ${names} in that channel to read its history, so I won't read it for you.`,
  historyNotMember: "That is a private thread you are not a member of, so I won't read its history.",
  historyBotMissing: (names: string, many: boolean) => `I can't read that channel because I'm missing the ${names} permission${many ? "s" : ""} there. A server admin can grant ${many ? "them" : "it"}.`,
  // saveAttachment
  saveNoMessage: "I can't find that message in this channel.",
  saveNoFile: "That message has no file attached.",
  saveWhich: (names: string[]) => `That message holds several files: ${names.join(", ")}. Say which one.`,
};

const id: typeof en = {
  and: "dan",
  cutNote: "-# Dipotong agar muat dalam 3 pesan. Minta sisanya kalau perlu versi lengkapnya.",
  nothingToAdd: "Tidak ada yang perlu saya tambahkan di sini.",
  done: "Selesai.",
  failed: "Permintaan ini tidak bisa diproses. Periksa konfigurasi tenant.",
  providerFailed: "Penyedia modelnya tidak bisa saya hubungi saat ini. Coba lagi sebentar lagi.",
  providerNoKey: (provider) => `Belum ada API key ${provider} untuk tenant ini, jadi saya belum bisa menjawab. Admin perlu menambahkan API key-nya dulu.`,
  providerNoBaseUrl: "Belum ada base URL untuk penyedia custom, jadi saya belum bisa menjawab. Admin perlu menambahkan base URL-nya dulu.",
  blind: "Saya tidak bisa melihat gambar dengan profil ini.",
  describeImage: "Jelaskan gambarnya dengan kata-kata, nanti saya kerjakan dari situ.",
  rejected: "Profil ini menolak gambarnya; admin bisa mematikan input gambar untuk profil ini.",
  skipped: (items) => `Dilewati: ${items.join(", ")}.`,
  skip: { format: "bukan PNG, JPEG, WebP, atau GIF", tooMany: (n) => `melebihi batas ${n} gambar`, tooLarge: "terlalu besar untuk diunduh", download: "tidak bisa diunduh", unreadable: "tidak bisa dibaca sebagai gambar", tooBig: "tidak bisa diperkecil di bawah 5 MB" },
  notFiled: { type: "tidak disimpan: bukan PDF, DOCX, XLSX, CSV, MD, atau TXT", tooLarge: "tidak disimpan: lebih dari 10 MB", download: "tidak disimpan: tidak bisa diunduh", place: "tidak disimpan: tidak ada folder untuk tempat ini" },
  textNotExtracted: "teksnya tidak bisa diekstrak",
  folderRefused: (allowed: string[]) => `Di tingkat atas folder channel atau DM hanya boleh ada ${allowed.join(", ")}; letakkan di salah satunya.`,
  memoryCompacted: (from, to) => `Memori dipadatkan dari ${from} baris menjadi ${to}; semua baris 30 hari terakhir dipertahankan.`,
  memoryCut: (dropped) => `Memori melebihi batas; ${dropped} baris tertua dihapus, semua baris 30 hari terakhir dipertahankan.`,
  breakdown: (n) => `**Rincian** · ${n} draf`,
  draftPoint: (n) => `poin ${n}`,
  blockedByDrafts: (ns) => `menunggu draf ${ns.join(", ")}`,
  round: (n) => `**Ronde ${n}**`,
  point: (n, text) => `**Poin ${n}** · ${text}`,
  wholeBrief: "**Seluruh brief**",
  askedAgain: (round) => `-# Ditanyakan lagi dari ronde ${round}. Kalau kali ini tidak dijawab, ➡️ menjadi asumsi di draf.`,
  roundFooter: (author) => `Hanya <@${author}> yang memutuskan di sini. Balas "ya" untuk menerima semua ➡️, atau jawab per nomor, misalnya "ya, kecuali Q2: …".`,
  noQuestions: (author) => `Tidak ada pertanyaan di ronde ini. Hanya <@${author}> yang memutuskan di sini: balas "ya" untuk menerima rinciannya, atau sebutkan yang perlu diubah.`,
  describeQuestion: (image) => `Apa isi ${image}? Saya tidak bisa melihat gambar dengan profil ini, jadi jelaskan dengan kata-kata untuk drafnya.`,
  describeRecommendation: "Tautkan di draf tanpa deskripsi.",
  authorDecides: (author) => `-# <@${author}> yang memutuskan brief ini; pesanmu sudah saya catat untuk ronde berikutnya.`,
  createIssues: (n) => `Buat ${n} issue dari brief ini:`,
  labels: (names) => `label: ${names.join(", ")}`,
  blockedBy: (refs) => `menunggu ${refs.join(", ")}`,
  draft: (n) => `draf ${n}`,
  skippedDrafts: (items) => `Dilewati: ${items.join("; ")}`,
  created: (n) => `${n} issue dibuat dari brief ini:`,
  briefDone: "-# Brief ini selesai. Pesan di sini kini jadi obrolan biasa.",
  stoppedAt: (n, title, error) => `Berhenti di draf ${n}, ${title}: ${error}`,
  createdHeading: "**Dibuat**",
  nothingCreated: "Belum ada yang dibuat.",
  notCreatedHeading: "**Belum dibuat**",
  continueRest: `Bilang "lanjutkan sisanya" untuk membuat draf yang belum dibuat, dengan konfirmasi baru. drafts.md berisi draf itu untuk ditempel manual.`,
  unlinked: (pairs) => `-# Tidak bisa menautkan ${pairs.join(", ")}, jadi bagian Blocked by-nya menyebutkannya sebagai teks.`,
  unlinkedPair: (issue, blocker) => `#${issue} sebagai menunggu #${blocker}`,
  createdLink: (url) => `Dibuat: ${url}`,
  batchStopped: (n, count) => `Berhenti di draf ${n} dengan ${count} issue dibuat. Detailnya ada di thread.`,
  batchDone: (count) => `${count} issue dibuat. Tautannya ada di thread.`,
  skillsOff: (playbook, names) => `Playbook ${playbook} butuh skill ${list(names, "dan")}, yang sedang mati di sini. Admin bisa menyalakannya di konsol.`,
  playbookOff: (playbook) => `Playbook ${playbook} sedang mati di sini. Admin bisa menyalakannya di konsol.`,
  repositoryNone: (playbook) => `Playbook ${playbook} butuh repositori, dan git scope tidak mengizinkan satu pun di sini. Admin bisa membukanya di konsol, di akses git server.`,
  playbookEnded: (playbook) => `-# Playbook ${playbook} tidak lagi tersedia di sini, jadi thread ini berhenti mengikutinya. Pesan di sini kini jadi obrolan biasa.`,
  noThread: "Saya tidak bisa membuka thread untuk pesan ini. Pastikan saya boleh membuat thread di channel ini.",
  alreadyBound: (playbook) => `Thread ini sudah mengikuti playbook ${playbook}.`,
  notSaved: "Thread ini tidak bisa saya simpan ke Workspace, jadi playbook-nya tidak dimulai. Coba lagi sebentar lagi.",
  botOff: "Bot ini sedang dimatikan.",
  wrongServer: "Playbook hanya berjalan di server yang sudah disiapkan untuk bot ini.",
  commandGone: "Perintah ini sudah tidak tersedia.",
  following: (playbook, thread) => `Mengikuti playbook ${playbook} di <#${thread}>.`,
  toolOffSinceAsked: "Tool ini dimatikan di sini setelah kamu memintanya, jadi tidak saya jalankan. Admin bisa menyalakannya lagi di konsol.",
  postNoChannel: "Channel itu tidak saya temukan di server ini.",
  postNeedView: "Kamu tidak bisa melihat channel itu, jadi tidak saya kirim ke sana.",
  postBotMissing: (names) => `Saya tidak bisa mengirim ke sana karena tidak punya izin ${names} di channel itu. Admin server bisa memberikannya.`,
  minutesOfThread: "Menulis notula seluruh thread ini.",
  minutesFromHere: "Menulis notula dari pesan ini sampai sekarang.",
  minutesDm: "Saya hanya menulis notula di channel dan thread server, bukan di DM.",
  minutesNeedPermission: (names) => `Kamu perlu ${names} di sini untuk mendapat notulanya, jadi tidak saya tulis.`,
  minutesNotMember: "Ini thread privat dan kamu bukan anggotanya, jadi notulanya tidak saya tulis.",
  minutesBotMissing: (names) => `Saya tidak bisa menulis notula di sini karena tidak punya izin ${names} di channel ini. Admin server bisa memberikannya.`,
  minutesEmpty: "Tidak ada pesan untuk dibuatkan notula di rentang ini.",
  minutesFailed: "Notulanya gagal saya tulis kali ini. Coba lagi sebentar lagi.",
  minutesNotPosted: (file) => `Notulanya tidak bisa saya kirim di sini. Pastikan saya punya izin Send Messages dan Embed Links${file ? ", juga Attach Files untuk minutes.md" : ""}.`,
  minutesNoCopy: "Salinan tersimpan notula ini tidak ketemu, jadi tidak bisa saya ubah.",
  minutesNoCopyBrief: "Salinan tersimpan notula ini tidak ketemu, jadi tidak bisa saya jadikan draf issue.",
  minutesCorrectionFailed: "Koreksinya tidak bisa saya terapkan. Coba sampaikan dengan cara lain.",
  minutesEditFailed: "Pesan notulanya tidak bisa saya edit.",
  minutesNoActions: "Notula ini tidak punya tindak lanjut untuk dijadikan draf issue.",
  minutesNotActions: (wrong, span) => `${wrong.length > 1 ? `Butir ${list(wrong, "dan")} bukan tindak lanjut` : `Butir ${wrong[0]} bukan tindak lanjut`}. Di notula ini tindak lanjutnya ${span}.`,
  minutesSpan: (items, range) => `butir ${range ? `${items[0]} sampai ${items.at(-1)}` : list(items, "dan")}`,
  minutesTooMany: (max, count, first) => `Satu brief paling banyak ${max} poin dan notula ini punya ${count} tindak lanjut. Mention saya di notulanya dengan butir yang mau dijadikan draf, misalnya "jadikan ${first} sampai ${first + 9} issue".`,
  minutesCount: (n) => `${n} pesan`,
  minutesCutCount: (n, when) => `Dipotong ke ${n} pesan terakhir: semua sebelum ${when} tidak disertakan.`,
  minutesCutHours: (n, when) => `Dipotong ke ${n} jam terakhir: semua sebelum ${when} tidak disertakan.`,
  minutesFooter: "Balas untuk mengoreksi",
  reminder: (text) => `Pengingat: ${text}`,
  reminderNotFound: "Pengingat aktif dengan id itu tidak ketemu.",
  reminderNotYours: "Pengingat itu milik orang lain; hanya pemiliknya atau orang dengan Manage Messages yang bisa membatalkannya.",
  reminderLimitOwner: (n) => `Kamu sudah punya ${n} pengingat aktif, batas untuk satu orang. Batalkan satu dulu sebelum membuat yang baru.`,
  reminderLimitTenant: (n) => `Pengingat di sini sudah mencapai batas ${n} yang aktif. Batalkan satu dulu sebelum membuat yang baru.`,
  reminderLate: (day, month, time) => `-# Terlambat: seharusnya diposting ${day} ${MONTHS_ID[month - 1]} ${time}.`,
  openTasks: "Tugas terbuka (status | due | owner | id | title):",
  digestDueToday: "**Jatuh tempo hari ini**",
  digestLate: "**Terlambat**",
  daysLate: (n) => `terlambat ${n} hari`,
  historyNoChannel: "Channel itu tidak ketemu.",
  historyDm: "Saya hanya membaca riwayat channel di channel dan thread server, bukan di DM.",
  historyNeedPermission: (names) => `Kamu perlu ${names} di channel itu untuk membaca riwayatnya, jadi tidak saya bacakan.`,
  historyNotMember: "Itu thread privat dan kamu bukan anggotanya, jadi riwayatnya tidak saya baca.",
  historyBotMissing: (names) => `Saya tidak bisa membaca channel itu karena tidak punya izin ${names} di sana. Admin server bisa memberikannya.`,
  saveNoMessage: "Pesan itu tidak ketemu di channel ini.",
  saveNoFile: "Pesan itu tidak punya lampiran file.",
  saveWhich: (names) => `Pesan itu punya beberapa file: ${names.join(", ")}. Sebutkan yang mana.`,
};

export type Strings = typeof en;
/** The bot's fixed text in `language`. */
export const textIn = (language: Language = "en"): Strings => (language === "id" ? id : en);
/** "a, b and c" in `language`. */
export const listOf = (items: string[], language?: Language) => list(items, textIn(language).and);
