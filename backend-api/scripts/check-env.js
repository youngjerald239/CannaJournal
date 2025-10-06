// Basic environment validation. Exit with non-zero if invalid.
const crypto = require('crypto');

function weak(value) {
  if (!value) return true;
  if (/changeme/i.test(value)) return true;
  if (value.length < 24) return true; // enforce minimal length for secrets
  return false;
}

const required = [ 'JWT_SECRET','ADMIN_USER','ADMIN_PASS','JOURNAL_TOKEN' ];

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// Custom admin password rules: at least 12 chars and at least 3 of 4 classes (lower, upper, digit, symbol)
function weakAdminPass(v) {
  if (!v) return true;
  if (/changeme/i.test(v)) return true;
  if (v.length < 12) return true;
  let cats = 0;
  if (/[a-z]/.test(v)) cats++;
  if (/[A-Z]/.test(v)) cats++;
  if (/[0-9]/.test(v)) cats++;
  if (/[^A-Za-z0-9]/.test(v)) cats++;
  return cats < 3; // require at least 3 categories
}

const weakSecrets = [];
if (weak(process.env.JWT_SECRET)) weakSecrets.push('JWT_SECRET');
if (weak(process.env.JOURNAL_TOKEN)) weakSecrets.push('JOURNAL_TOKEN');
if (weakAdminPass(process.env.ADMIN_PASS)) weakSecrets.push('ADMIN_PASS');
if (weakSecrets.length) {
  console.error('Weak / placeholder secret values detected for:', weakSecrets.join(', '));
  process.exit(1);
}

// Optional warning for default admin username
if (process.env.ADMIN_USER === 'admin') {
  console.warn('[warn] ADMIN_USER is set to default "admin". Consider changing in production.');
}

// Basic entropy heuristic (only for JWT_SECRET) - optional
function estimateEntropy(str) {
  const unique = new Set(str).size;
  return Math.log2(Math.pow(unique, str.length));
}
try {
  const jwt = process.env.JWT_SECRET || '';
  if (jwt && estimateEntropy(jwt) < 128) {
    console.warn('[warn] JWT_SECRET estimated entropy < 128 bits. Consider a longer random value.');
  }
} catch (_) {}

module.exports = true;
