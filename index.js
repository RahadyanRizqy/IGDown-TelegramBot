require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const PQueue = require('p-queue').default;
const fs = require('fs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const queueMap = new Map();
const ADMIN = process.env.ADMIN;
const API_ENDPOINT = process.env.API_ENDPOINT;
const isValidUrl = (url) => /^https?:\/\/.+/.test(url);

// Log error ke file error.json
function logError(url, message) {
  const path = 'error.json';
  let current = {};

  if (fs.existsSync(path)) {
    try {
      current = JSON.parse(fs.readFileSync(path, 'utf-8'));
    } catch {
      current = {};
    }
  }

  current[url] = message;

  fs.writeFileSync(path, JSON.stringify(current, null, 2));
}

bot.command('start', (ctx) => {
  ctx.reply('Send Instagram URL (reel/post).');
});

bot.on('text', async (ctx) => {
  const url = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (!url.includes('instagram.com')) {
    return ctx.reply('❌ Invalid Instagram URL.');
  }

  if (!queueMap.has(userId)) {
    queueMap.set(userId, new PQueue({ concurrency: 1, interval: 15000, intervalCap: 1 })); // 1 per menit
  }

  const queue = queueMap.get(userId);

  queue.add(async () => {
    await ctx.reply('⏳ Processing...');

    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        const { data } = await axios.get(API_ENDPOINT, {
          params: { url, html: 'no' }
        });

        const rawContents = data.result?.content;
        if (!rawContents || rawContents.length === 0) {
          throw new Error('No content or private account');
        }

        const contents = rawContents.filter(item => isValidUrl(item.mimeUrl));
        if (contents.length === 0) {
          throw new Error('No valid media found');
        }

        const captionText = `\nThanks for using this bot!\n\nAdmin: ${ADMIN}`;
        const chunkSize = 10;

        for (let i = 0; i < contents.length; i += chunkSize) {
          const chunk = contents.slice(i, i + chunkSize);

          if (chunk.length === 1) {
            const item = chunk[0];
            const opts = { caption: captionText, parse_mode: 'Markdown' };

            if (item.mimeType === 'video') {
              await ctx.replyWithVideo(item.mimeUrl, opts);
            } else {
              await ctx.replyWithPhoto(item.mimeUrl, opts);
            }
          } else {
            const mediaGroup = chunk.map((item, index) => {
              const isLast = (i + index === contents.length - 1);
              return {
                type: item.mimeType === 'video' ? 'video' : 'photo',
                media: item.mimeUrl,
                ...(isLast ? { caption: captionText, parse_mode: 'Markdown' } : {})
              };
            });

            try {
              await ctx.replyWithMediaGroup(mediaGroup);
            } catch (err) {
              throw new Error(`MediaGroup failed: ${err.message}`);
            }
          }
        }

        // ✅ sukses kirim
        return;
      } catch (err) {
        attempt++;
        console.error(`Attempt ${attempt}:`, err.message);

        if (attempt >= maxAttempts) {
          ctx.reply('❌ Failed, try again later.');
          logError(url, err.message);
          return;
        }

        await new Promise(res => setTimeout(res, 15000));
      }

    }
  });
});

bot.launch();
console.log('🤖 Bot running...');
