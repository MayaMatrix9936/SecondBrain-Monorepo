const request = require('supertest');

const BASE = 'http://localhost:4000'; // assumes backend is running

describe('Backend API smoke tests', () => {
  test('health endpoint', async () => {
    const res = await request(BASE).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('query without body returns 400', async () => {
    const res = await request(BASE).post('/query').send({});
    expect(res.statusCode).toBe(400);
  });
});
