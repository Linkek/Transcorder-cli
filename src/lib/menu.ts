import chalk from 'chalk';
import figures from 'figures';
import readline from 'node:readline';

// ─── Prompt for a single line of input ──────────────────────────────────────

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Menu item definition ───────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  description?: string;
  action: () => Promise<void> | void;
}

// ─── Show a numbered menu and wait for selection ────────────────────────────

export async function showMenu(title: string, items: MenuItem[], opts?: { showBack?: boolean; backLabel?: string }): Promise<void> {
  const allItems = [...items];

  if (opts?.showBack) {
    allItems.push({
      label: opts.backLabel ?? 'Back',
      action: () => {},
    });
  }

  console.log();
  console.log(chalk.bold.hex('#7C4DFF')(`  ${title}`));
  console.log(chalk.gray('  ' + '─'.repeat(44)));

  for (let i = 0; i < allItems.length; i++) {
    const num = chalk.hex('#7C4DFF').bold(`  ${i + 1}.`);
    const label = chalk.white(allItems[i].label);
    const desc = allItems[i].description ? chalk.gray(` — ${allItems[i].description}`) : '';
    console.log(`${num} ${label}${desc}`);
  }

  console.log();

  const answer = await prompt(chalk.gray('  ❯ '));
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > allItems.length) {
    console.log(chalk.red(`  ${figures.cross} Invalid choice. Enter a number 1-${allItems.length}.`));
    return showMenu(title, items, opts);
  }

  await allItems[choice - 1].action();
}

// ─── Looping menu (stays open until exit is chosen) ─────────────────────────

export async function showMenuLoop(title: string, items: MenuItem[], opts?: { exitLabel?: string }): Promise<void> {
  const exitLabel = opts?.exitLabel ?? 'Exit';
  let running = true;

  const allItems = [
    ...items,
    {
      label: exitLabel,
      action: () => { running = false; },
    },
  ];

  while (running) {
    console.log();
    console.log(chalk.bold.hex('#7C4DFF')(`  ${title}`));
    console.log(chalk.gray('  ' + '─'.repeat(44)));

    for (let i = 0; i < allItems.length; i++) {
      const num = chalk.hex('#7C4DFF').bold(`  ${i + 1}.`);
      const label = i === allItems.length - 1
        ? chalk.gray(allItems[i].label)
        : chalk.white(allItems[i].label);
      const desc = allItems[i].description ? chalk.gray(` — ${allItems[i].description}`) : '';
      console.log(`${num} ${label}${desc}`);
    }

    console.log();

    const answer = await prompt(chalk.gray('  ❯ '));
    const choice = parseInt(answer, 10);

    if (isNaN(choice) || choice < 1 || choice > allItems.length) {
      console.log(chalk.red(`  ${figures.cross} Invalid choice. Enter a number 1-${allItems.length}.`));
      continue;
    }

    await allItems[choice - 1].action();
  }
}

// ─── Confirm yes/no ─────────────────────────────────────────────────────────

export async function confirm(message: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? chalk.gray('[Y/n]') : chalk.gray('[y/N]');
  const answer = await prompt(`  ${message} ${hint} `);

  if (answer === '') return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

// ─── Pick a file from a list ────────────────────────────────────────────────

export async function pickFromList(title: string, items: string[]): Promise<string | null> {
  if (items.length === 0) {
    console.log(chalk.gray('  No items found.'));
    return null;
  }

  console.log();
  console.log(chalk.bold(`  ${title}`));
  console.log(chalk.gray('  ' + '─'.repeat(44)));

  for (let i = 0; i < items.length; i++) {
    const num = chalk.hex('#7C4DFF').bold(`  ${i + 1}.`);
    console.log(`${num} ${chalk.white(items[i])}`);
  }

  const cancelNum = items.length + 1;
  console.log(`  ${chalk.gray(`${cancelNum}.`)} ${chalk.gray('Cancel')}`);
  console.log();

  const answer = await prompt(chalk.gray('  ❯ '));
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > cancelNum) {
    console.log(chalk.red(`  ${figures.cross} Invalid choice.`));
    return pickFromList(title, items);
  }

  if (choice === cancelNum) return null;
  return items[choice - 1];
}

// ─── Wait for keypress ──────────────────────────────────────────────────────

export async function waitForKey(message = 'Press Enter to continue...'): Promise<void> {
  await prompt(chalk.gray(`  ${message}`));
}
