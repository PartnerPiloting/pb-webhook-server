/**
 * Test file for boolean search parser
 * Run with: node test-boolean-search.js
 */

const { parseBooleanSearch, extractTerms } = require('./utils/booleanSearchParser');

console.log('=== Boolean Search Parser Tests ===\n');

const tests = [
  // Simple terms
  { query: 'possibility', expected: 'Should search for possibility' },
  { query: 'possibility yes', expected: 'Should AND both terms' },
  
  // OR operator
  { query: 'possibility OR yes', expected: 'Should OR both terms' },
  { query: 'event OR workshop OR resource', expected: 'Should OR all three terms' },
  
  // NOT operator
  { query: 'NOT workshop', expected: 'Should exclude workshop' },
  { query: 'event NOT workshop', expected: 'Should include event but exclude workshop' },
  { query: '-workshop', expected: 'Should exclude workshop (using -prefix)' },
  
  // Exact phrases
  { query: '"mindset mastery"', expected: 'Should search exact phrase' },
  { query: '"ash workshop" AND event', expected: 'Should AND exact phrase with term' },
  
  // Parentheses grouping
  { query: '(possibility OR yes) AND mindset', expected: 'Should group OR then AND' },
  { query: '(event OR workshop) NOT resource', expected: 'Should group OR then exclude' },
  { query: '(event OR (workshop AND mindset))', expected: 'Should handle nested groups' },
  
  // Complex queries
  { query: '(possibility OR yes) AND (mindset OR mastery) NOT workshop', expected: 'Complex multi-operator query' },
  
  // Edge cases
  { query: '', expected: 'Empty query should return empty string' },
  { query: '   ', expected: 'Whitespace-only should return empty string' },
];

tests.forEach(({ query, expected }, index) => {
  console.log(`Test ${index + 1}: ${expected}`);
  console.log(`Query: "${query}"`);
  
  try {
    const formula = parseBooleanSearch(query);
    console.log(`Result: ${formula || '(empty string)'}`);
    console.log('✓ Parsed successfully\n');
  } catch (error) {
    console.log(`✗ Error: ${error.message}\n`);
  }
});

console.log('=== Extract Terms Test ===\n');

const extractTests = [
  'possibility yes',
  'possibility OR yes',
  '(event OR workshop) AND mindset NOT resource',
  '"mindset mastery" AND event'
];

extractTests.forEach(query => {
  const terms = extractTerms(query);
  console.log(`Query: "${query}"`);
  console.log(`Terms: [${terms.join(', ')}]\n`);
});

console.log('=== Sample Airtable Formulas ===\n');

const samples = [
  'possibility yes',
  'possibility OR yes',
  'event NOT workshop',
  '(possibility OR yes) AND mindset'
];

samples.forEach(query => {
  console.log(`Query: "${query}"`);
  const formula = parseBooleanSearch(query);
  console.log(`Airtable Formula:\n${formula}\n`);
});

console.log('=== All tests completed ===');
