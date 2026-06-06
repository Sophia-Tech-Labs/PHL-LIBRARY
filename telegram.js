const { Telegraf } = require("telegraf");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

async function uploadToChannel(fileBuffer, filename) {
    const msg = await bot.telegram.sendDocument(
        process.env.TELEGRAM_CHAT_ID,
        { source: fileBuffer, filename }
    );
    return msg.document.file_id;
}

async function getFileUrl(fileId) {
    const file = await bot.telegram.getFile(fileId);
    return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
}

module.exports = { bot, uploadToChannel, getFileUrl };
