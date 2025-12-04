import '@sapphire/plugin-editable-commands/register';
import 'dotenv/config';
import './lib/database/drizzle';

import { runApp } from '@vegapunk/utilities';

import { YoruClient } from './lib/YoruClient';

async function main(): Promise<void> {
  const client = new YoruClient();
  try {
    await client.start();
  } catch (error: unknown) {
    console.trace(error);
    await client.destroy();
  }
}

void runApp(main);
