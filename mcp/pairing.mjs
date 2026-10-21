import { loadConfig } from "./config.mjs";

const config = loadConfig();
console.log(JSON.stringify({ url: config.url, token: config.token }, null, 2));
