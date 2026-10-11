import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.resolve('@angular/build'));
const {build}=require('esbuild');
const result=await build({
  entryPoints:[fileURLToPath(new URL('../src/app/weekly-report.spec.ts',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'esm',
  tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},logLevel:'error'
});
const check=spawnSync(process.execPath,['--input-type=module'],{input:result.outputFiles[0].text,stdio:['pipe','inherit','inherit']});
if(check.error)throw check.error;
process.exitCode=check.status ?? 1;
