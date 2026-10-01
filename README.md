# Coding Council ID

## Deploy to Vercel

1. Create a Supabase project, or open the existing project.
2. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) once.
3. In Supabase **Connect**, select the **Transaction pooler** and copy its connection string. Use this pooler URL for Vercel's serverless function; don't use the direct database URL for deployments that require IPv4.
4. Connect this repository to the existing `coding-council` Vercel project, then add these environment variables in the Vercel project settings for each deployment environment:
   - `DATABASE_URL`: Supabase Transaction pooler connection string. URL-encode special characters in the database password.
   - `DATABASE_SSL`: `true`.
   - `ACCOUNT_EMAIL_DOMAIN`: a domain you control, for example `members.example.org`.
5. Deploy. Vercel serves `index.html` and `cc_logo.jpeg` as static assets and the member API from `api/members.js`.

The API connects directly to Supabase Postgres using the server-only connection string. Keep it out of frontend code and source control. Generated account addresses are not mailboxes, and this project does not send credential emails. The plaintext password is returned only when the member record is created; only its bcrypt hash is stored.

## Local development

Copy `.env.example` to `.env.local`, replace the pooler URL with your Supabase values, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`.