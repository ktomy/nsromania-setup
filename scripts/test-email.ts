import { sendWelcomeEmail, sendValidationEmail, sendSignInEmail } from '../src/lib/services/sendemail';

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: ts-node scripts/test-email.ts you@example.com');
    process.exit(1);
  }

  console.log('Testing sendWelcomeEmail...');
  await sendWelcomeEmail(to, 'demo-subdomain', 'demo-secret');

  console.log('Testing sendValidationEmail...');
  await sendValidationEmail(to, 'dummy-token-123');

  console.log('Testing sendSignInEmail...');
  await sendSignInEmail(to, 'https://nsromania.info/auth/callback?token=abc');

  console.log('Done. Check your inbox (and spam).');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});