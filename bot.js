const { Scenes, session } = require("telegraf");
const { message } = require("telegraf/filters");
const { bot, uploadToChannel } = require("./telegram");
const pool = require("./db");
require("dotenv").config();

const TYPE_LABELS = {
    lecture_note: "Lecture Note",
    past_question: "Past Question",
    assignment: "Assignment",
    textbook: "Textbook",
    general: "General",
};

const TYPE_KEYBOARD = {
    inline_keyboard: [
        [
            { text: "Lecture Note", callback_data: "lecture_note" },
            { text: "Past Question", callback_data: "past_question" },
        ],
        [
            { text: "Assignment", callback_data: "assignment" },
            { text: "Textbook", callback_data: "textbook" },
        ],
        [{ text: "General", callback_data: "general" }],
    ],
};

// Step 1 — receive file, ask for title
const step1 = async (ctx) => {
    const doc = ctx.message.document;
    ctx.wizard.state.doc = doc;

    const defaultTitle = doc.file_name.replace(/\.[^/.]+$/, "");
    ctx.wizard.state.defaultTitle = defaultTitle;

    await ctx.reply(
        `Got it! What should the title be?\n\nSend a title or /skip to use:\n"${defaultTitle}"`,
        { reply_markup: { force_reply: true } }
    );
    return ctx.wizard.next();
};

// Step 2 — receive title, ask for type
const step2 = async (ctx) => {
    if (!ctx.message?.text) return;

    const title = ctx.message.text === "/skip"
        ? ctx.wizard.state.defaultTitle
        : ctx.message.text.trim();

    ctx.wizard.state.title = title;

    await ctx.reply(`"${title}" — what type of document is this?`, {
        reply_markup: TYPE_KEYBOARD,
    });
    return ctx.wizard.next();
};

// Step 3 — type selected, send to channel, save to DB
const step3 = async (ctx) => {
    if (!ctx.callbackQuery) return;

    const type = ctx.callbackQuery.data;
    await ctx.answerCbQuery();
    await ctx.editMessageText(`Type: ${TYPE_LABELS[type]}\n\nUploading to library...`);

    try {
        const { doc, title } = ctx.wizard.state;

        // Download from Telegram then send to private channel
        const fileInfo = await ctx.telegram.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        const channelFileId = await uploadToChannel(buffer, doc.file_name);

        const { rows } = await pool.query(
            `INSERT INTO documents (title, type, telegram_file_id, filename, file_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [title, type, channelFileId, doc.file_name, doc.file_size, ctx.from.first_name || "Telegram"]
        );

        const shareLink = `${process.env.FRONTEND_URL}/documents/${rows[0].id}`;

        await ctx.editMessageText(
            `Done!\n\n*${title}*\n\n${shareLink}`,
            { parse_mode: "Markdown" }
        );
    } catch (err) {
        console.error(err);
        await ctx.editMessageText("Upload failed. Try again.");
    }

    return ctx.scene.leave();
};

const uploadWizard = new Scenes.WizardScene("upload-wizard", step1, step2, step3);
const stage = new Scenes.Stage([uploadWizard]);

bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) =>
    ctx.reply(
        "UI Philosophy Library Bot\n\nSend me any document (PDF, DOCX, etc.) and I'll upload it to the library and give you a share link."
    )
);

bot.on(message("document"), (ctx) => ctx.scene.enter("upload-wizard"));

bot.launch();
console.log("Bot running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
