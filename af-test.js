const { autoFormatHelpBody } = require('./index.js');
const sample = `Intro paragraph about feature\n\nScreenshot below\nhttps://example.com/image.png - Dashboard View\n\nMore info at\nhttps://example.com/docs\n`;
console.log('--- OUTPUT START ---');
console.log(autoFormatHelpBody(sample));
console.log('--- OUTPUT END ---');
