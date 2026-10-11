import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("an Indonesian brief gets its round headings, footer, screenshot question and image note in Indonesian", async (s) => {
  const { ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { image } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  const shot = await image(s, "login.png", 390, 844);
  s.model.script({ tool: "postBriefRound", args: ROUND_1 }, "ok");
  const brief = await s.discord.send("- login di Safari selalu kembali ke halaman masuk\n- ekspor CSV yang besar terlalu lambat untuk dipakai", { attachments: [shot] });
  await s.discord.contextMenu("Draft issues", brief);
  const round = s.discord.botMessages.filter((m) => m.channelId === brief.thread!.id).map((m) => m.content).join("\n");
  expect(round).toContain("**Rincian** · 2 draf");
  expect(round).toContain("**1. Stop the Safari login loop** · poin 1");
  expect(round).toContain("**2. Stream CSV exports** · poin 2 · menunggu draf 1");
  expect(round).toContain("**Ronde 1**");
  expect(round).toContain("**Seluruh brief**");
  expect(round).toContain(`❓ **Q1** Apa isi [login.png](<${brief.url}>)? Saya tidak bisa melihat gambar dengan profil ini`);
  expect(round).toContain("➡️ Tautkan di draf tanpa deskripsi.");
  expect(round).toContain("**Poin 1** · login loops on Safari");
  expect(round).toContain(`Hanya <@${s.discord.alice.id}> yang memutuskan di sini. Balas "ya"`);
  expect(round.trim().endsWith("Saya tidak bisa melihat gambar dengan profil ini.")).toBe(true);
});

discordScenario("a non-author in an Indonesian brief is told in Indonesian that the author decides", async (s) => {
  const { ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  s.model.script({ tool: "postBriefRound", args: ROUND_1 }, "ok");
  const brief = await s.discord.send("- login di Safari selalu kembali ke halaman masuk\n- ekspor CSV yang besar terlalu lambat untuk dipakai");
  await s.discord.contextMenu("Draft issues", brief);
  s.model.script("Firefox belum masuk brief ini.");
  await s.discord.send(`${s.discord.mention} apakah Firefox juga perlu dicek?`, { channel: brief.thread, author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)!.content).toBe(`Firefox belum masuk brief ini.\n-# <@${s.discord.alice.id}> yang memutuskan brief ini; pesanmu sudah saya catat untuk ronde berikutnya.`);
});

discordScenario("an Indonesian brief's confirmation and creation report are in Indonesian", async (s) => {
  const { ROUND_1, draft, stubRepo } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  await s.git({ repos: ["acme/api"] });
  stubRepo(s, { labels: ["bug", "enhancement", "safari"] });
  s.model.script([{ tool: "briefRepositories" }, { tool: "briefRead", args: { step: "repository", repo: "acme/api" } }], { tool: "postBriefRound", args: ROUND_1 }, "ok");
  const brief = await s.discord.send("- login di Safari selalu kembali ke halaman masuk\n- ekspor CSV yang besar terlalu lambat untuk dipakai");
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread!;
  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }], "ok");
  await s.discord.send("ya", { channel: thread });

  let issue = 100;
  s.http.on("POST api.github.com/repos/acme/api/issues", () => { issue++; return { number: issue, id: 9000 + issue, html_url: `https://github.com/acme/api/issues/${issue}` }; });
  s.http.on("POST api.github.com/repos/acme/api/issues/102/dependencies/blocked_by", () => new Response("", { status: 404 }));
  s.model.script({ tool: "createBriefIssues" }, "ok");
  await s.discord.send("buat semua issue-nya", { channel: thread });
  const confirmation = s.discord.botMessages.at(-1)!;
  expect(confirmation.embeds[0].description).toBe("Buat 2 issue dari brief ini:\n1. Stop the Safari login loop · acme/api · label: bug\n2. Stream CSV exports · acme/api · label: enhancement · menunggu draf 1");
  await s.discord.click(confirmation, "Confirm");
  const report = s.discord.botMessages.at(-1)!.content;
  expect(report).toContain("2 issue dibuat dari brief ini:\n1. Stop the Safari login loop: <https://github.com/acme/api/issues/101>");
  expect(report).toContain("-# Tidak bisa menautkan #102 sebagai menunggu #101, jadi bagian Blocked by-nya menyebutkannya sebagai teks.");
  expect(report).toContain("-# Brief ini selesai.");
  expect(confirmation.content).toBe("2 issue dibuat. Tautannya ada di thread.");
});

discordScenario("an Indonesian chat reply cut to three messages gets the Indonesian cut note and image note", async (s) => {
  const { image } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  const shot = await image(s, "layar.png", 300, 200);
  s.model.script(Array.from({ length: 8 }, (_, i) => `Bagian ${i + 1}. ${"Kalimat yang membuat jawabannya panjang. ".repeat(30)}`).join("\n\n"));
  await s.discord.send(`${s.discord.mention} tolong jelaskan kenapa login di halaman ini gagal`, { attachments: [shot] });
  const sent = s.discord.botMessages.map((m) => m.content).join("\n");
  expect(sent).toContain("-# Dipotong agar muat dalam 3 pesan.");
  expect(sent.endsWith("Saya tidak bisa melihat gambar dengan profil ini.")).toBe(true);
});

discordScenario("an addressed Indonesian message the model stays silent on still gets an Indonesian answer", async (s) => {
  s.model.script("[[silent]]");
  await s.discord.send(`${s.discord.mention} saya cuma mau bilang terima kasih untuk bantuannya`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Tidak ada yang perlu saya tambahkan di sini.");
});

discordScenario("a playbook refusal answers an Indonesian request in Indonesian", async (s) => {
  const { tenantSkills, and, eq } = await import(process.cwd() + "/packages/db/src/index.ts") as any;
  await s.db.update(tenantSkills).set({ isEnabled: false }).where(and(eq(tenantSkills.tenantId, s.tenant.id), eq(tenantSkills.skillId, "workspace")));
  await s.discord.send(`${s.discord.mention} issue: ekspor CSV yang besar terlalu lambat untuk dipakai di halaman laporan`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Playbook issue-draft butuh skill Workspace, yang sedang mati di sini. Admin bisa menyalakannya di konsol.");
});

discordScenario("minutes of an Indonesian discussion get an Indonesian header and footer, and still take corrections", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now();
  const [start] = s.discord.history([
    { content: "Kita rilis hari apa ya?", author: alice, at: now - 30 * 60_000 },
    { content: "Jumat saja, dan Bob yang menulis catatan rilisnya", author: bob, at: now - 20 * 60_000 },
  ]);
  s.model.script(JSON.stringify({ title: "Hari rilis", decided: [{ text: "Rilis hari Jumat", ref: 2 }], open: [], actions: [], labels: { decided: "Diputuskan", open: "Masih terbuka", actions: "Tindak lanjut", participants: "Peserta", noOwner: "belum ada pemilik", due: "tenggat", none: "Tidak ada" } }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages.at(-1)!;
  expect(minutes.embeds[0].description).toContain(" · 2 pesan");
  expect(minutes.embeds[0].footer.text).toMatch(/^Balas untuk mengoreksi · minutes\/.+\.md$/);

  s.model.script(JSON.stringify({ title: "Hari rilis", decided: [{ text: "Rilis hari Kamis", ref: 1 }], open: [], actions: [] }));
  await s.discord.send("ganti jadi Kamis", { replyTo: minutes });
  expect(minutes.edits.at(-1)!.embeds![0].description).toContain("Rilis hari Kamis");
  expect(minutes.edits.at(-1)!.embeds![0].footer.text).toMatch(/^Balas untuk mengoreksi · minutes\//);
});
