// bot/botRunner.ts
import { CONFIG } from './config.js';
import { BotWorker } from './botWorker.js';

async function main() {
  console.log('🚀 Launching trading bots...');

  const bots: BotWorker[] = [];
  for (let i = 1; i <= CONFIG.BOT_COUNT; i++) {
    const bot = new BotWorker(i);
    await bot.initialize();
    bots.push(bot);
    // Start each bot in parallel
    bot.start().catch(err => {
      console.error(`Bot ${i} crashed:`, err);
    });
  }

  console.log(`✅ ${bots.length} bots are running. Press Ctrl+C to stop.`);

  // Keep the main process alive
  process.on('SIGINT', () => {
    console.log('🛑 Stopping bots...');
    bots.forEach(b => b.stop());
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
