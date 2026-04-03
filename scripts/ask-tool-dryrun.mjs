import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();
const evalsPath = path.join(root, 'evals', 'ask-tool-evals.json');
const outBase = path.join(root, 'evals', 'iteration-1');

async function run() {
  const raw = await fs.readFile(evalsPath, 'utf8');
  const data = JSON.parse(raw);
  await fs.mkdir(outBase, { recursive: true });

  for (const ev of data.evals) {
    const dir = path.join(outBase, `${ev.name}`);
    await fs.mkdir(dir, { recursive: true });
    const outFile = path.join(dir, 'questions.json');

    // For this dry-run we use the expected_questions field as the generated payload.
    const payload = {
      questions: ev.expected_questions
    };

    await fs.writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${outFile}`);
    console.log(JSON.stringify(payload, null, 2));
  }

  console.log('\nDry-run complete. Outputs saved under evals/iteration-1/.');
}

run().catch(err => {
  console.error('Error during dry-run:', err);
  process.exitCode = 1;
});
