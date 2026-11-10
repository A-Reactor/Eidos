import ts from 'typescript';
import fs from 'node:fs';

export function runtimeFiles(modules, options) {
  const files = new Map(), seen = new Set(), queue = [...modules.entries];
  while (queue.length) {
    const source = queue.shift();
    if (seen.has(source)) continue;
    seen.add(source);
    if (/\.d\.[cm]?ts$/.test(source)) throw new Error(`Runtime dependency has no implementation: ${source}`);
    const transformer = context => {
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error(`Computed runtime dependency in ${source}`);
          const specifier = node.arguments[0].text;
          queue.push(modules.resolve(specifier, source));
          return context.factory.updateCallExpression(node, node.expression, node.typeArguments, [context.factory.createStringLiteral(modules.reference(specifier, source))]);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    };
    const result = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
      fileName: source, reportDiagnostics: true,
      compilerOptions: { ...options, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
        declaration: false, emitDeclarationOnly: false, isolatedModules: true, importHelpers: false },
      transformers: { after: [transformer] },
    });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    files.set(modules.output(source), result.outputText);
  }
  return files;
}
