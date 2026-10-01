require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const emailDomain = process.env.ACCOUNT_EMAIL_DOMAIN || 'members.codingcouncil.invalid';
const allowedTeams = new Set([
    'Operations',
    'AI/ML',
    'Web Development',
    'Graphics',
    'DSA',
    'Human Resources',
    'Social Media Marketing'
]);

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in .env.local or the environment.');
}
if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(emailDomain)) {
    throw new Error('ACCOUNT_EMAIL_DOMAIN must be a valid domain name.');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.get('/', (request, response) => response.sendFile(path.join(__dirname, 'index.html')));
app.get('/cc_logo.jpeg', (request, response) => response.sendFile(path.join(__dirname, 'cc_logo.jpeg')));

app.post('/api/members', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false
}), async (request, response) => {
    const { fullName, course, year, teams, linkedin, avatarDataUrl } = request.body || {};
    const allowedYears = new Set(['1st Year', '2nd Year', '3rd Year', '4th Year', 'Other']);
    const validPhoto = typeof avatarDataUrl === 'string'
        && avatarDataUrl.length <= 1_000_000
        && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarDataUrl);

    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 100
        || typeof course !== 'string' || !course.trim() || course.trim().length > 100
        || !allowedYears.has(year)
        || !Array.isArray(teams) || teams.length < 1 || teams.length > allowedTeams.size
        || teams.some(team => !allowedTeams.has(team))
        || (linkedin != null && (typeof linkedin !== 'string' || linkedin.length > 2048))
        || !validPhoto) {
        return response.status(400).json({ error: 'Please provide valid member details and a profile photo.' });
    }

    const memberId = crypto.randomUUID();
    const email = `member-${memberId.slice(0, 12)}@${emailDomain}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);

    try {
        const result = await pool.query(
            `INSERT INTO members
                (id, account_email, password_hash, full_name, course, year, teams, linkedin, avatar_data_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, account_email, full_name, course, year, teams, created_at`,
            [memberId, email, passwordHash, fullName.trim(), course.trim(), year, JSON.stringify([...new Set(teams)]), linkedin?.trim() || null, avatarDataUrl]
        );
        const member = result.rows[0];

        response.setHeader('Cache-Control', 'no-store');
        return response.status(201).json({
            member: {
                id: member.id,
                email: member.account_email,
                fullName: member.full_name,
                course: member.course,
                year: member.year,
                teams: member.teams,
                createdAt: member.created_at
            },
            credentials: { email, password }
        });
    } catch (error) {
        if (error.code === '23505') {
            return response.status(409).json({ error: 'An account already exists for this member.' });
        }
        console.error('Member creation failed:', error.message);
        return response.status(500).json({ error: 'Could not save the member profile. Please try again.' });
    }
});

async function startServer() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS members (
            id UUID PRIMARY KEY,
            account_email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            course TEXT NOT NULL,
            year TEXT NOT NULL,
            teams JSONB NOT NULL,
            linkedin TEXT,
            avatar_data_url TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    app.listen(port, () => console.log(`Coding Council ID server listening on http://localhost:${port}`));
}

startServer().catch(error => {
    console.error('Could not start the server:', error.message);
    process.exitCode = 1;
});