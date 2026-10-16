// Dev launcher: starts the local PGlite server (scripts/local-pg.mjs) when nothing is listening on its port,
// then runs `next dev`. One process to start, and the app never comes up without its database.
import { spawn } from "node:child_process";
import net from "node:net";

const port = Number(process.env.PGLITE_PORT ?? 5434);
const listening = () => new Promise((res) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.end(); res(true); });
  s.once("error", () => res(false));
});

const kids = [];
if (!(await listening())) {
  kids.push(spawn(process.execPath, ["scripts/local-pg.mjs"], { stdio: "inherit" }));
  for (let i = 0; i < 100 && !(await listening()); i++) await new Promise((r) => setTimeout(r, 200));
} else console.log(`Local DB already running on ${port}`);

const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname;
kids.push(spawn(process.execPath, [nextBin, "dev", "-p", process.env.PORT ?? "3100"], { stdio: "inherit" }));

const stop = () => { for (const k of kids) k.kill("SIGINT"); setTimeout(() => process.exit(0), 1500); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
kids.at(-1).on("exit", (code) => { stop(); process.exitCode = code ?? 0; });
