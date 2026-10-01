const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const allowedTeams = new Set([
    'Operations',
    'AI/ML',
    'Web Development',
    'Graphics',
    'DSA',
    'Human Resources',
    'Social Media Marketing'
]);
const allowedYears = new Set(['1st Year', '2nd Year', '3rd Year', '4th Year', 'Other']);
let pool;

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false
}));

function getPool() {
    if (!pool && process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
            max: 1,
            connectionTimeoutMillis: 5000
        });
    }
    return pool;
}

app.use(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed.' });
    }
    if (!process.env.DATABASE_URL) {
        return response.status(503).json({ error: 'Member database is not configured.' });
    }

    const emailDomain = process.env.ACCOUNT_EMAIL_DOMAIN || 'members.codingcouncil.invalid';
    if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(emailDomain)) {
        return response.status(503).json({ error: 'Account email domain is not configured correctly.' });
    }

    const { fullName, course, year, teams, linkedin, avatarDataUrl } = request.body || {};
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

    try {
        const memberId = crypto.randomUUID();
        const email = `member-${memberId.slice(0, 12)}@${emailDomain}`;
        const password = crypto.randomBytes(18).toString('base64url');
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await getPool().query(
            `INSERT INTO members
                (id, account_email, password_hash, full_name, course, year, teams, linkedin, avatar_data_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, account_email, full_name, course, year, teams, created_at`,
            [memberId, email, passwordHash, fullName.trim(), course.trim(), year, JSON.stringify([...new Set(teams)]), linkedin?.trim() || null, avatarDataUrl]
        );
        const member = result.rows[0];

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

module.exports = app;