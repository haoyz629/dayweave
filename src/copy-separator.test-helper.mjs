import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";

const source = readFileSync(new URL("./copy-separator.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText;
const context = { React, exports: {}, require: name => {
  if (name !== "react") throw new Error(`Unexpected copy separator dependency: ${name}`);
  return React;
} };
vm.runInNewContext(code, context);
export const { CopySeparator, SeparatedCopy } = context.exports;
