require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const PQueue = require('p-queue').default;

const bot = new Telegraf(process.env.BOT_TOKEN);
const queueMap = new Map();
const ADMIN = process.env.ADMIN;
const API_ENDPOINT = process.env.API_ENDPOINT;

const isValidUrl = (url) => /^https?:\/\/.+/.test(url);

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
    queueMap.set(userId, new PQueue({ concurrency: 1 }));
  }

  const queue = queueMap.get(userId);

  queue.add(async () => {
    await ctx.reply('⏳ Processing...');

    try {
      const { data } = await axios.get(API_ENDPOINT, {
        params: { url, html: 'no' }
      });

      const rawContents = data._result?.content;

      if (!rawContents || rawContents.length === 0) {
        return ctx.reply('⚠️ Content not found or private account.\nIf private, contact admin: ' + ADMIN);
      }

      // Filter only valid URLs
      const contents = rawContents.filter(item => isValidUrl(item.mimeUrl));
      if (contents.length === 0) {
        return ctx.reply('❌ No valid media found to send.');
      }

      const captionText = `\nThanks for using this bot!\nAdmin: ${ADMIN}`;
      const chunkSize = 10;

      for (let i = 0; i < contents.length; i += chunkSize) {
        const chunk = contents.slice(i, i + chunkSize);

        // Jika hanya satu item di chunk, gunakan method khusus
        if (chunk.length === 1) {
          const item = chunk[0];
          const opts = { caption: captionText, parse_mode: 'Markdown' };

          if (item.mimeType === 'video') {
            await ctx.replyWithVideo(item.mimeUrl, opts);
          } else {
            await ctx.replyWithPhoto(item.mimeUrl, opts);
          }
        } else {
          // Gunakan mediaGroup
          const mediaGroup = chunk.map((item, index) => {
            const isLast = (i + index === contents.length - 1);
            return {
              type: item.mimeType === 'video' ? 'video' : 'photo',
              media: item.mimeUrl,
              ...(isLast ? {
                caption: captionText,
                parse_mode: 'Markdown'
              } : {})
            };
          });

          try {
            await ctx.replyWithMediaGroup(mediaGroup);
          } catch (err) {
            console.error('MediaGroup failed:', err.message);
            await ctx.reply('⚠️ Failed to send album. Some items might be broken.\n\n' + err.message);
          }
        }
      }
    } catch (err) {
      console.error('ERROR:', err.message);
      ctx.reply(`❌ Failed to fetch post. Please check link or report to admin.\n\n*${err.message}*`, {
        parse_mode: 'Markdown'
      });
    }
  });
});

bot.launch();
console.log('🤖 Bot running...');
