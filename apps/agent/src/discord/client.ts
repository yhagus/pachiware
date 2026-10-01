import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
  EmbedBuilder,
} from "discord.js";
import { config } from "../config.js";
import { DiscordJSAdapter } from "./adapter.js";
import { agentReActLoop } from "../loop/react.js";
import { CacheService } from "../cache/redis.js";

export class DiscordBotService {
  private client: Client | null = null;
  private adapter: DiscordJSAdapter | null = null;
  private isConnected = false;

  async start(): Promise<void> {
    const token = config.discord.token;
    if (!token) {
      console.log("ℹ️ Discord bot token not provided. Discord Gateway is running in standby/simulation mode.");
      return;
    }

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      this.adapter = new DiscordJSAdapter(this.client, config.discord.guildId);

      this.client.once(Events.ClientReady, (readyClient) => {
        this.isConnected = true;
        console.log(`🤖 Discord Bot connected as ${readyClient.user.tag}!`);
      });

      this.client.on(Events.MessageCreate, async (msg: Message) => {
        await this.handleMessage(msg);
      });

      await this.client.login(token);
    } catch (err: any) {
      console.warn("⚠️ Failed to initialize Discord client:", err.message);
      this.isConnected = false;
    }
  }

  private async handleMessage(msg: Message): Promise<void> {
    if (!this.client || msg.author.bot) return;

    // Check if the bot was mentioned or if it is a DM
    const botMention = `<@${this.client.user?.id}>`;
    const isMentioned = msg.content.includes(botMention);
    const isDirectMessage = !msg.guild;

    if (!isMentioned && !isDirectMessage) {
      return;
    }

    // Rate-limit check per user
    const rateCheck = await CacheService.checkRateLimit(`discord:user:${msg.author.id}`, 10, 60);
    if (!rateCheck.allowed) {
      await msg.reply("⚠️ You are sending requests too quickly. Please wait a few seconds before trying again.");
      return;
    }

    // Clean message content (remove bot mention)
    const cleanedText = msg.content.replace(new RegExp(`<@!?${this.client.user?.id}>`, "g"), "").trim();
    if (!cleanedText) {
      await msg.reply("Hello! How can I assist you today? Mention me with a question or task.");
      return;
    }

    // Indicate typing while ReAct loop thinks and executes
    try {
      await msg.channel.sendTyping();
    } catch {
      // Channel may lack typing permissions
    }

    const typingInterval = setInterval(async () => {
      try {
        await msg.channel.sendTyping();
      } catch {}
    }, 4000);

    try {
      const output = await agentReActLoop.run({
        message: cleanedText,
        context: {
          platform: "discord",
          guildName: msg.guild?.name,
          guildId: msg.guild?.id,
          channelName: (msg.channel as any).name || "dm",
          channelId: msg.channel.id,
          userName: msg.author.username,
          userId: msg.author.id,
          skillContext: {
            discord: this.adapter || undefined,
          },
        },
      });

      clearInterval(typingInterval);

      // Reply with the final response
      const chunks = this.chunkMessage(output.reply, 1900);
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await msg.reply(chunks[i]);
        } else {
          await msg.channel.send(chunks[i]);
        }
      }

      // If tools were executed, post an informative embed summary
      if (output.toolCallsExecuted.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle("🛠️ Actions Executed")
          .setColor(0x5865f2)
          .setFooter({ text: `ReAct iterations: ${output.iterations}` });

        for (const item of output.toolCallsExecuted.slice(0, 5)) {
          const statusIcon = item.result.success ? "✅" : "⚠️";
          const details =
            item.result.data?.message ||
            item.result.error ||
            JSON.stringify(item.call.arguments);

          embed.addFields({
            name: `${statusIcon} ${item.call.name}`,
            value: details.length > 250 ? details.slice(0, 247) + "..." : details,
          });
        }

        await msg.channel.send({ embeds: [embed] });
      }
    } catch (err: any) {
      clearInterval(typingInterval);
      console.error("Error processing Discord message in ReAct loop:", err);
      await msg.reply(`⚠️ An error occurred while processing your request: ${err.message}`);
    }
  }

  private chunkMessage(text: string, size: number = 1900): string[] {
    const chunks: string[] = [];
    let current = "";

    const lines = text.split("\n");
    for (const line of lines) {
      if ((current + "\n" + line).length > size) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = current ? current + "\n" + line : line;
      }
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
  }

  getStatus() {
    return {
      connected: this.isConnected,
      botTag: this.client?.user?.tag || null,
      botId: this.client?.user?.id || null,
      guildCount: this.client?.guilds.cache.size || 0,
    };
  }

  getAdapter(): DiscordJSAdapter | null {
    return this.adapter;
  }
}

export const discordBotService = new DiscordBotService();
