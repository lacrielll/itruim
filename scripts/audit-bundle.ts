import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function files(root:string):Promise<string[]>{const out:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);entry.isDirectory()?out.push(...await files(path)):out.push(path);}return out;}

const clientFiles=await files("dist/client");
const text=(await Promise.all(clientFiles.filter(path=>/\.(?:js|html|css|map)$/.test(path)).map(path=>readFile(path,"utf8")))).join("\n");
// Field names used by the authenticated admin editor are not secrets. This audit
// protects actual server-only configuration names/values and source maps.
const forbidden=["ADMIN_PASSWORD_HASH","CSRF_SECRET","RATE_LIMIT_PEPPER","B2_KEY_ID","B2_APPLICATION_KEY","pbkdf2-sha256$"];
const leaked=forbidden.filter(value=>text.includes(value));
if(clientFiles.some(path=>path.endsWith(".map")))throw new Error("Public source maps found in client output");
if(leaked.length)throw new Error(`Forbidden backend/grading markers found in client output: ${leaked.join(", ")}`);
try {
  const localVars=await readFile(".dev.vars","utf8");
  const secretValues=localVars.split(/\r?\n/).map(line=>line.match(/^[A-Z_]+=(.+)$/)?.[1]?.trim()).filter((value):value is string=>!!value&&value.length>=12);
  const deployable=(await Promise.all((await files("dist/quiz_platform")).filter(path=>/\.(?:js|json)$/.test(path)).map(path=>readFile(path,"utf8")))).join("\n");
  if(secretValues.some(value=>deployable.includes(value)))throw new Error("A local secret value was embedded in deployable output");
} catch(error) {
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
}
process.stdout.write(`Bundle audit passed: ${clientFiles.length} client files, no source maps or forbidden markers.\n`);
