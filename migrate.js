const pool = require("./db");

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title          TEXT NOT NULL,
                description    TEXT,
                course_code    TEXT,
                level          TEXT,
                type           TEXT DEFAULT 'general',
                file_url       TEXT NOT NULL,
                public_id      TEXT NOT NULL,
                file_size      INTEGER,
                uploaded_by    TEXT,
                download_count INTEGER DEFAULT 0,
                view_count     INTEGER DEFAULT 0,
                created_at     TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_documents_trgm_title
            ON documents USING gin (title gin_trgm_ops)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_documents_trgm_course
            ON documents USING gin (course_code gin_trgm_ops)
        `);

        console.log("Migration complete.");
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error("Migration failed:", err.message);
    process.exit(1);
});
