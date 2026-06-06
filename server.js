const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Readable } = require("stream");
const { uploadToChannel, getFileUrl } = require("./telegram");
const pool = require("./db");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB — Telegram Bot API limit
});

app.get("/", (req, res) => {
    res.json({ message: "University of Ibadan — Philosophy Department Library API" });
});

// Upload a document
app.post("/documents", upload.single("file"), async (req, res) => {
    try {
        const { title, description, course_code, level, type, uploaded_by } = req.body;

        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        if (!title) return res.status(400).json({ message: "Title is required" });

        const fileId = await uploadToChannel(req.file.buffer, req.file.originalname);

        const { rows } = await pool.query(
            `INSERT INTO documents (title, description, course_code, level, type, telegram_file_id, filename, file_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
                title,
                description || null,
                course_code || null,
                level || null,
                type || "general",
                fileId,
                req.file.originalname,
                req.file.size,
                uploaded_by || null
            ]
        );

        res.status(201).json({ document: rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Upload failed" });
    }
});

// Search documents (trigram — supports partial, mid-word matches)
app.get("/documents/search", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ message: "Query param 'q' is required" });

        const { rows } = await pool.query(
            `SELECT id, title, description, course_code, level, type, uploaded_by, file_size, download_count, view_count, created_at
             FROM documents
             WHERE title % $1 OR title ILIKE $2
                OR course_code % $1 OR course_code ILIKE $2
             ORDER BY similarity(title, $1) DESC
             LIMIT 20`,
            [q, `%${q}%`]
        );

        res.json({ results: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Search failed" });
    }
});

// Recent uploads
app.get("/documents/recent", async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, title, description, course_code, level, type, uploaded_by, file_size, download_count, view_count, created_at
             FROM documents
             ORDER BY created_at DESC
             LIMIT 20`
        );
        res.json({ documents: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not fetch recent documents" });
    }
});

// Get single document (share link profile)
app.get("/documents/:id", async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, title, description, course_code, level, type, uploaded_by, file_size, download_count, view_count, created_at
             FROM documents WHERE id = $1`,
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ message: "Document not found" });

        res.json({ document: rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not fetch document" });
    }
});

// Stream — fetch from Telegram and serve inline
app.get("/documents/:id/stream", async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE documents SET view_count = view_count + 1
             WHERE id = $1 RETURNING telegram_file_id, filename`,
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ message: "Document not found" });

        const fileUrl = await getFileUrl(rows[0].telegram_file_id);
        const upstream = await fetch(fileUrl);

        if (!upstream.ok) return res.status(502).json({ message: "Could not fetch document" });

        const ext = (rows[0].filename || "").split(".").pop().toLowerCase();
        const contentTypes = {
            pdf: "application/pdf",
            doc: "application/msword",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ppt: "application/vnd.ms-powerpoint",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        };
        res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
        res.setHeader("Content-Disposition", "inline");

        Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Stream failed" });
    }
});

// Download — fetch from Telegram and serve as attachment
app.get("/documents/:id/download", async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE documents SET download_count = download_count + 1
             WHERE id = $1 RETURNING telegram_file_id, title, filename`,
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ message: "Document not found" });

        const fileUrl = await getFileUrl(rows[0].telegram_file_id);
        const upstream = await fetch(fileUrl);

        if (!upstream.ok) return res.status(502).json({ message: "Could not fetch document" });

        res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${rows[0].filename || rows[0].title}"`);

        Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Download failed" });
    }
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
