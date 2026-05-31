const fetch = require('node-fetch');
const examples = require('./golden_examples.json');

const API_URL = 'http://localhost:3000/api/analyze';

async function runEval() {
  console.log('Starting Eval...');
  let passed = 0;
  let failed = 0;

  for (const example of examples) {
    console.log(`\nRunning: ${example.name} (${example.id})`);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: example.input, history: [] })
      });

      if (!res.ok) {
        console.error(`  ❌ Failed: HTTP ${res.status}`);
        failed++;
        continue;
      }

      const text = await res.text();
      // Simple check: look for expected strings in the response stream
      const success = checkExpectations(text, example.expected);
      
      if (success) {
        console.log('  ✅ Passed');
        passed++;
      } else {
        console.error('  ❌ Failed: Expectations not met');
        failed++;
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nEval Complete: ${passed} passed, ${failed} failed`);
}

function checkExpectations(responseText, expected) {
  if (expected.contains) {
    for (const term of expected.contains) {
      if (!responseText.includes(term)) {
        console.log(`    Missing expected term: ${term}`);
        return false;
      }
    }
  }
  if (expected.not_contains) {
    for (const term of expected.not_contains) {
      if (responseText.includes(term)) {
        console.log(`    Found unexpected term: ${term}`);
        return false;
      }
    }
  }
  return true;
}

runEval();
