// Print portable stdio configuration without reading or exposing pairing secrets.
import {fileURLToPath} from 'node:url';
export function clientConfig(vscode=false) {
 const server={command:process.execPath,args:[fileURLToPath(new URL('server.mjs',import.meta.url))]};
 return vscode?{servers:{openbua:{type:'stdio',...server}}}:{mcpServers:{openbua:server}};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) console.log(JSON.stringify(clientConfig(process.argv.includes('--vscode')),null,2));
