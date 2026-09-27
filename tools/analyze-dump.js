const fs = require('fs');
const { analyzeBuffer } = require('../src/analyze');
const files = process.argv.slice(2);
for (const f of files) {
  const out = analyzeBuffer(fs.readFileSync(f), f);
  console.log('='.repeat(70));
  console.log('FILE:', f);
  console.log(JSON.stringify(out.guess, null, 2));
  console.log('--- details:', JSON.stringify({ ...out.details, controls: out.details.controls.slice(0, 8) }, null, 1));
  console.log('--- warnings:', out.warnings);
}
