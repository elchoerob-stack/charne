/**
 * One-time setup: run `npm run google:auth`, open the printed URL, approve access,
 * then paste the redirected `code` param back into this script's prompt.
 * Prints a refresh token to put in .env as GOOGLE_REFRESH_TOKEN.
 */
import "dotenv/config";
import readline from "node:readline/promises";
import { GOOGLE_SCOPES, getOAuthClient } from "../src/services/googleAuth.js";

async function main() {
  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });

  console.log("\n1. Open this URL and approve access:\n");
  console.log(url);
  console.log(
    "\n2. You'll land on the redirect URI with a ?code=... in the address bar (it's fine if the page doesn't load)."
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("\n3. Paste the code here: ")).trim();
  rl.close();

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and try again."
    );
    process.exit(1);
  }

  console.log("\nAdd this to server/.env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
