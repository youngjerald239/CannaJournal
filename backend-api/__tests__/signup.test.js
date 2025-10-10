const request = require('supertest');
let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'testsecret';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'adminpass';
  jest.resetModules();
  app = require('../server');
});

describe('Signup validation (JSON fallback mode)', () => {
  test('rejects missing fields', async () => {
    const res = await request(app).post('/auth/signup').send({ username:'', email:'x', password:'' });
    expect([400,401,404]).toContain(res.status);
  });
});
