/**
 * Patches @coral-xyz/anchor + @meteora-ag/dlmm for Node 24 ESM compatibility.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const anchorPkgPath = path.join(root, "node_modules/@coral-xyz/anchor/package.json");
const anchorUtils = path.join(root, "node_modules/@coral-xyz/anchor/dist/cjs/utils");

if (fs.existsSync(anchorPkgPath) && fs.existsSync(anchorUtils)) {
  const anchorPkg = JSON.parse(fs.readFileSync(anchorPkgPath, "utf8"));

  if (!anchorPkg.exports) {
    const dirs = fs.readdirSync(anchorUtils, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    anchorPkg.exports = {
      ".": { default: "./dist/cjs/index.js" },
      ...Object.fromEntries(
        dirs.map((dir) => [
          `./dist/cjs/utils/${dir}`,
          `./dist/cjs/utils/${dir}/index.js`,
        ])
      ),
      "./*": "./*",
    };

    fs.writeFileSync(anchorPkgPath, JSON.stringify(anchorPkg, null, 2));
    console.log("Patched: @coral-xyz/anchor/package.json exports");
  }
}

const dlmmMjs = path.join(root, "node_modules/@meteora-ag/dlmm/dist/index.mjs");

if (fs.existsSync(dlmmMjs)) {
  let src = fs.readFileSync(dlmmMjs, "utf8");
  const original = src;

  src = src.replace(
    /from ["'](@coral-xyz\/anchor\/dist\/cjs\/utils\/\w+)["']/g,
    (_, p) => `from "${p}/index.js"`
  );

  src = src.replace(/^import BN from ["']bn\.js["'];\n/gm, "");
  src = src.replace(/^var BN = require\(["']bn\.js["']\);\n/gm, "");
  src = src.replace(/^const BN = require\(["']bn\.js["']\);\n/gm, "");

  if (src.includes("BN")) {
    src = 'import BN from "bn.js";\n' + src;
  }

  function removeBNFromSpecifiers(specifiers) {
    return specifiers
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !/^BN(\s+as\s+\w+)?$/.test(s))
      .join(", ");
  }

  src = src.replace(
    /import \{([^}]*)\bBN as (\w+)\b([^}]*)\} from "@coral-xyz\/anchor";/g,
    (_, before, alias, after) => {
      const remaining = removeBNFromSpecifiers(before + "," + after);
      const anchorImport = remaining ? `import { ${remaining} } from "@coral-xyz/anchor";` : "";
      return `${anchorImport}\nconst ${alias} = BN;`;
    }
  );

  src = src.replace(
    /import \{([^}]*)\bBN\b(?!\s*as\b)([^}]*)\} from "@coral-xyz\/anchor";/g,
    (_, before, after) => {
      const remaining = removeBNFromSpecifiers(before + "," + after);
      return remaining ? `import { ${remaining} } from "@coral-xyz/anchor";` : "";
    }
  );

  if (src !== original) {
    fs.writeFileSync(dlmmMjs, src);
    console.log("Patched: @meteora-ag/dlmm/dist/index.mjs");
  }
}
