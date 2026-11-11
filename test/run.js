const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const only = process.argv.slice(2);
const tests = fs.readdirSync(__dirname)
  .filter((file) => file.endsWith(".test.js"))
  .filter((file) => !only.length || only.some((name) => file.includes(name)))
  .sort();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(file, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: root });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      output += "\nTIMEOUT";
      child.kill();
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function startServer(port) {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, ADMIN_PASSWORD: "testpass", PORT: port, LIVEKIT_URL: "", LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  for (let i = 0; i < 100 && !log.includes("działa"); i++) await wait(100);
  return server;
}

(async () => {
  let failedFiles = 0;
  let checks = 0;
  for (const file of tests) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    const port = (source.match(/localhost:(\d+)/) || [])[1];
    const server = port ? await startServer(port) : null;
    const { code, output } = await run(file, 60000);
    if (server) {
      server.kill();
      await wait(200);
    }
    const passed = (output.match(/^OK/gm) || []).length;
    const failed = code !== 0 || /^FAIL/m.test(output) || /FAILED|TIMEOUT/.test(output);
    checks += passed;
    if (failed) failedFiles += 1;
    console.log(`${failed ? "✖" : "✔"} ${file}${passed ? ` (${passed})` : ""}`);
    if (failed) console.log(output.split("\n").filter((line) => !/^OK/.test(line)).slice(-15).join("\n"));
  }
  console.log(failedFiles ? `\n${failedFiles} plik(ów) z błędami` : `\nWszystko przeszło: ${tests.length} plików, ${checks} sprawdzeń`);
  process.exit(failedFiles ? 1 : 0);
})();
