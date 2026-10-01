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
app.set('trust proxy', 1); // Vercel sits behind a proxy; use the real client IP for rate limiting
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 100, // many students may share one campus Wi-Fi IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
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

    // Diagnostic: open /api/members in a browser to see if the function, env vars and database are working.
    if (request.method === 'GET') {
        const status = {
            ok: false,
            databaseConfigured: Boolean(process.env.DATABASE_URL),
            emailDomainConfigured: Boolean(process.env.ACCOUNT_EMAIL_DOMAIN)
        };
        if (!status.databaseConfigured) return response.status(503).json({ ...status, database: 'DATABASE_URL is not set' });
        try {
            await getPool().query('select 1 from public.members limit 1');
            return response.json({ ...status, ok: true, database: 'connected' });
        } catch (error) {
            console.error('Health check failed:', error.code || error.name, error.message);
            return response.status(503).json({ ...status, database: 'error', code: error.code || error.name });
        }
    }

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
        const password = crypto.randomBytes(18).toString('base64url');
        const passwordHash = await bcrypt.hash(password, 12);
        const base = fullName.normalize('NFKD').toLowerCase()
            .replace(/[^a-z0-9]+/g, '.').slice(0, 30).replace(/^\.+|\.+$/g, '') || 'member';

        let member, email;
        for (let i = 1; i <= 20 && !member; i++) {
            email = `${base}${i > 1 ? i : ''}@${emailDomain}`;
            try {
                const result = await getPool().query(
                    `INSERT INTO members
                (id, account_email, password_hash, full_name, course, year, teams, linkedin, avatar_data_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, account_email, full_name, course, year, teams, created_at`,
                    [memberId, email, passwordHash, fullName.trim(), course.trim(), year, JSON.stringify([...new Set(teams)]), linkedin?.trim() || null, avatarDataUrl]
                );
                member = result.rows[0];
            } catch (error) {
                if (error.code !== '23505') throw error; // sirf duplicate pe retry
            }
        }
        if (!member) return response.status(409).json({ error: 'Could not create a unique account email. Please try again.' });

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
        console.error('Member creation failed:', error.code || error.name, error.message);
        return response.status(500).json({ error: 'Could not save the member profile. Please try again.' });
    }
});

module.exports = app;