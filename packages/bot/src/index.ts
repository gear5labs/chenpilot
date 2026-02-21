import dotenv from 'dotenv';
import { TelegramAdapter } from './adapters/telegram';
import { DiscordAdapter } from './adapters/discord';

dotenv.config();

async function bootstrap() {
  console.log('🤖 Starting Chen Pilot Bot Services...');

  const tgBot = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN || '');
  const discordBot = new DiscordAdapter(process.env.DISCORD_BOT_TOKEN || '');

  await Promise.all([
    tgBot.init(),
    discordBot.init()
  ]);

  console.log('🚀 All bots are online!');
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start bots:', err);
  process.exit(1);
});
