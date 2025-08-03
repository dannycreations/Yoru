import '@sapphire/plugin-editable-commands/register';
import 'dotenv/config';
import './lib/database/drizzle';

import { YoruClient } from './lib/YoruClient';

const client = new YoruClient();

async function main() {
  try {
    await client.start();
  } catch (error) {
    console.trace(error);
    await client.destroy();
  }
}

main().catch(console.trace);
