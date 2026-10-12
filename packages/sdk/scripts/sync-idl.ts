// Copies the program's IDL from the Anchor build into this package and rewrites the compact
// interface description the client is built on.
//
//   npm run sync-idl -w @terra-incognita/sdk            # reads ../../target
//   npm run sync-idl -w @terra-incognita/sdk -- <dir>   # reads <dir>/idl and <dir>/types

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface IdlAccountItem {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  accounts?: IdlAccountItem[];
}

interface Idl {
  address: string;
  metadata: { name: string; version: string };
  instructions: { name: string; discriminator: number[]; accounts: IdlAccountItem[] }[];
  accounts?: { name: string; discriminator: number[] }[];
  errors?: { code: number; name: string; msg?: string }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');
const targetDir = resolve(process.argv[2] ?? join(packageDir, '../../target'));
const idlFile = join(targetDir, 'idl/terra_incognita.json');
const typesFile = join(targetDir, 'types/terra_incognita.ts');

const idl = JSON.parse(readFileSync(idlFile, 'utf8')) as Idl;

mkdirSync(join(packageDir, 'idl'), { recursive: true });
copyFileSync(idlFile, join(packageDir, 'idl/terra_incognita.json'));
copyFileSync(typesFile, join(packageDir, 'idl/terra_incognita.ts'));

function flatten(items: IdlAccountItem[]): object[] {
  return items.flatMap((item) =>
    item.accounts
      ? flatten(item.accounts)
      : [
          {
            name: item.name,
            ...(item.writable ? { writable: true } : {}),
            ...(item.signer ? { signer: true } : {}),
            ...(item.optional ? { optional: true } : {}),
            ...(item.address ? { address: item.address } : {}),
          },
        ],
  );
}

const compact = {
  address: idl.address,
  version: idl.metadata.version,
  instructions: Object.fromEntries(
    idl.instructions.map((ix) => [ix.name, { discriminator: ix.discriminator, accounts: flatten(ix.accounts) }]),
  ),
  accounts: Object.fromEntries((idl.accounts ?? []).map((account) => [account.name, account.discriminator])),
  errors: (idl.errors ?? []).map(({ code, name, msg }) => ({ code, name, msg: msg ?? name })),
};

const body = JSON.stringify(compact, null, 2).replace(/\[\s+([\d,\s]+?)\s+\]/g, (_, numbers: string) =>
  `[${numbers.split(/,\s*/).join(', ')}]`,
);
const source = `// Written by scripts/sync-idl.ts from the program's IDL. Change the program and rerun the script.

export const PROGRAM_INTERFACE = ${body} as const;
`;
writeFileSync(join(packageDir, 'src/program-interface.ts'), source);

console.log(
  `synced ${idl.metadata.name} ${idl.metadata.version} (${idl.address}): ` +
    `${idl.instructions.length} instructions, ${idl.accounts?.length ?? 0} accounts, ${idl.errors?.length ?? 0} errors`,
);
