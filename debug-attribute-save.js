const https = require('https');

const attributeId = 'recD82hb80thkHjcv';
const clientId = 'Sam-Noble';

// Test data matching what the frontend is sending
const testData = {
  heading: 'Interest in Emerging Tech / AI Enthusiasms',  // Note the 's' at the end
  maxPoints: 15,
  bonusPoints: false,
  instructions: `Scoring Range
0–3 pts = minimal or vague interest (e.g. one-off "AI is interesting" comment).
4–7 pts = occasional mentions or passive sharing of AI articles.
8–11 pts = regular AI/ML posts, online courses, or project updates.
12–15 pts = strong advocate: publishes thought-leadership, demos tools, speaks at AI events.
Award points based on the depth, frequency, and recency of demonstrated engagement with emerging tech or AI.`,
  minToQualify: 5,
  signals: 'machine learning, Deep Learning, Generative AI, LLMs, prompt engineering, AI ethics, MLOps, AI Engineer, Machine Learning Engineer, AI Researcher, AI Speaker, AI side project',
  examples: '',
  active: true
};

const postData = JSON.stringify({
  improvedRubric: testData
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: `/api/attributes/${attributeId}/save`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-client-id': clientId,
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\nResponse body:');
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();
