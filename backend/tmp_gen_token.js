require('dotenv').config();
const jwt = require('jsonwebtoken');
const id = process.argv[2];
if(!id){ console.error('NO_ID'); process.exit(1); }
console.log(jwt.sign({ id }, process.env.JWT_SECRET||'dev', { expiresIn:'30d' }));
