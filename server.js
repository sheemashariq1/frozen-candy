require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const path = require('node:path');
const express = require('express');
const membersApi = require('./api/members');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use('/api/members', membersApi);
app.get('/cc_logo.jpeg', (request, response) => response.sendFile(path.join(__dirname, 'cc_logo.jpeg')));
app.get('/', (request, response) => response.sendFile(path.join(__dirname, 'index.html')));

if (require.main === module) {
    app.listen(port, () => console.log(`Coding Council ID server listening on http://localhost:${port}`));
}

module.exports = app;