import { TongProjectAccess } from "./TongProjectAccess.mjs";

const access = new TongProjectAccess();
const [command, ...args] = process.argv.slice(2);

function usage() {
  throw new Error("Usage: node scripts/TongProjects.mjs list | add --id ID --name NAME --path DIRECTORY --permission metadata|read|write | disable ID | revoke ID");
}
function options(values) {
  const result = {};
  if (values.length % 2) usage();
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i];
    if (!["--id", "--name", "--path", "--permission"].includes(key) || key in result) usage();
    result[key] = values[i + 1];
  }
  if (Object.keys(result).length !== 4) usage();
  return result;
}

try {
  if (command === "list" && args.length === 0) {
    console.log(JSON.stringify(await access.listProjects(), null, 2));
  } else if (command === "add") {
    const value = options(args);
    const created = await access.addProject({ id: value["--id"], name: value["--name"],
      root: value["--path"], permission: value["--permission"] });
    console.log(`Registered ${created.id}. Real project content access remains disabled in this phase.`);
  } else if (command === "disable" && args.length === 1) {
    await access.disableProject(args[0]);
    console.log(`Disabled ${args[0]}.`);
  } else if (command === "revoke" && args.length === 1) {
    await access.revokeProject(args[0]);
    console.log(`Revoked ${args[0]}.`);
  } else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Project operation failed");
  process.exitCode = 1;
}
