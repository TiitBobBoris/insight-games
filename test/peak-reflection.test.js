const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/peak-reflection');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('rejects requests without a configured API key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const response = responseRecorder();

  await handler({ method: 'POST', headers: {}, body: {} }, response);

  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /seadistatud/);
  if (previous) process.env.OPENAI_API_KEY = previous;
});

test('rejects an empty moment before contacting OpenAI', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const response = responseRecorder();

  await handler({ method: 'POST', headers: {}, body: { need: 'growth', value: 'Kasv' } }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Kirjelda/);
});

test('returns a structured reflection', async t => {
  process.env.OPENAI_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'gpt-6-sol');
    assert.equal(request.reasoning.effort, 'low');
    assert.equal(request.store, false);
    return {
      ok: true,
      async json() {
        return {
          output: [{
            content: [{
              type: 'output_text',
              text: JSON.stringify({
                summary: 'See hetk näib kandvat rahu.',
                observations: ['Sa märkasid kohalolu.', 'Oluline oli ühendus.'],
                questions: ['Mida saad korrata?', 'Mis seda toetab?'],
                nextStep: 'Võta homme viis rahulikku minutit.',
                limitation: 'See on hüpotees, mitte hinnang ega diagnoos.'
              })
            }]
          }]
        };
      }
    };
  };

  const response = responseRecorder();
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.1' },
    body: {
      moment: 'Jalutasin mere ääres.',
      emotion: 'Rahu',
      meaning: 'Mul oli aega märgata.',
      need: 'connection',
      value: 'Kohalolu',
      carry: 'Teen homme uue jalutuskäigu.'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.reflection.observations.length, 2);
});
