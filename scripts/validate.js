import { execSync } from 'child_process';
import chalk from 'chalk';

const steps = [
  { name: 'Linting', command: 'npm run lint' },
  { name: 'Building', command: 'npm run build' },
  { name: 'Coverage Check (>75%)', command: 'npm run test:coverage' }
];

console.log(chalk.cyan('\n🚀 Starting Project Validation...\n'));

const results = [];
let allPassed = true;

for (const step of steps) {
  process.stdout.write(chalk.yellow(`⌛ Running ${step.name}... `));
  try {
    execSync(step.command, { stdio: 'pipe' });
    console.log(chalk.green('PASSED ✅'));
    results.push({ step: step.name, status: 'PASSED', color: 'green' });
  } catch (error) {
    console.log(chalk.red('FAILED ❌'));
    results.push({ step: step.name, status: 'FAILED', color: 'red' });
    allPassed = false;
    
    console.log(chalk.red(`\nError in ${step.name}:`));
    console.log(error.stdout?.toString() || error.message);
    console.log(error.stderr?.toString());
    break; // Stop on first error
  }
}

console.log(chalk.cyan('\n📊 Validation Summary:'));
console.log(chalk.gray('-----------------------'));
for (const res of results) {
  const statusText = res.status === 'PASSED' ? chalk.green(res.status) : chalk.red(res.status);
  console.log(`${res.step.padEnd(25)}: ${statusText}`);
}
console.log(chalk.gray('-----------------------'));

if (allPassed) {
  console.log(chalk.green.bold('\n✨ All checks passed! Project is healthy. ✨\n'));
  process.exit(0);
} else {
  console.log(chalk.red.bold('\n❌ Validation failed. Please fix the errors above. ❌\n'));
  process.exit(1);
}
