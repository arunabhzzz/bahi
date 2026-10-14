import { backup, restore } from "../packages/db/src/backup";
const [action, source, destination] = process.argv.slice(2);
if (!source || !destination || !["backup", "restore"].includes(action))
  throw Error(
    "Usage: npm run db:backup -- source.sqlite new-backup.sqlite OR npm run db:restore -- backup.sqlite new-target.sqlite",
  );
(action === "backup" ? backup : restore)(source, destination);
console.log(`${action} verified: ${destination}`);
