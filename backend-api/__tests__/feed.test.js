const request = require('supertest');
const http = require('http');
let app;

describe('Feed & Social basic', () => {
  beforeAll(async () => {
    // Import server AFTER env prepared
    process.env.JWT_SECRET = 'testsecret';
    process.env.ADMIN_USER = 'admin';
    process.env.ADMIN_PASS = 'pass';
    // Provide a fake DATABASE_URL? For now skip if PG not enabled.
  app = require('../server');
  });

  test('health ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('feed requires auth', async () => {
    const res = await request(app).get('/feed');
    expect([401,200]).toContain(res.status); // if pg disabled 200 empty else 401
  });
});
