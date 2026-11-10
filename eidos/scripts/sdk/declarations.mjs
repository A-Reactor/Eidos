import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

function declarationProgram(entries, options) {
  const texts = new Map(), sourceProgram = ts.createProgram(entries, options);
  const emitted = sourceProgram.emit(undefined, (file, text, _bom, _error, sources) => {
    if (file.endsWith('.d.ts') && sources?.length === 1) texts.set(fs.realpathSync(sources[0].fileName), text);
  }, undefined, true);
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error(emitted.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n') || 'Declaration emit failed');
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => {
    const text = texts.get(file);
    if (text === undefined) return original(file, version, onError, createNew);
    const source = ts.createSourceFile(file, text, version, true);
    source.isDeclarationFile = true;
    return source;
  };
  const program = ts.createProgram(entries, options, host);
  return { program, sources: program.getSourceFiles().filter(s => texts.has(s.fileName)) };
}

function declarationClosure(program, sources, entries) {
  const checker = program.getTypeChecker(), selected = new Set(), imports = new Set(), queue = [];
  const portable = new Set(sources.map(s => s.fileName));
  const unalias = symbol => symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const statement = node => { while (node.parent && !ts.isSourceFile(node.parent)) node = node.parent; return node; };
  const enqueue = symbol => {
    for (const declaration of unalias(symbol)?.declarations ?? []) {
      if (!portable.has(declaration.getSourceFile().fileName)) continue;
      const node = statement(declaration);
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node) && !selected.has(node)) { selected.add(node); queue.push(node); }
    }
  };
  for (const entry of entries) {
    const source = program.getSourceFile(entry), symbol = source && checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`Cannot resolve declaration entry ${entry}`);
    for (const exported of checker.getExportsOfModule(symbol)) enqueue(exported);
  }
  while (queue.length) {
    const visit = node => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol?.flags & ts.SymbolFlags.Alias) imports.add(symbol);
        enqueue(symbol);
      }
      ts.forEachChild(node, visit);
    };
    visit(queue.shift());
  }
  const needed = symbol => (unalias(symbol)?.declarations ?? []).some(d => selected.has(statement(d)));
  return { checker, selected, imports, needed };
}

function keptImport(node, closure) {
  const clause = node.importClause;
  if (!clause) return undefined;
  const used = name => name && closure.imports.has(closure.checker.getSymbolAtLocation(name));
  const name = used(clause.name) ? clause.name : undefined;
  let bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    const elements = bindings.elements.filter(item => used(item.name));
    bindings = elements.length ? ts.factory.updateNamedImports(bindings, elements) : undefined;
  } else if (bindings && !used(bindings.name)) bindings = undefined;
  if (!name && !bindings) return undefined;
  return ts.factory.updateImportDeclaration(node, node.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly, name, bindings), node.moduleSpecifier, node.attributes);
}

function keptExport(node, closure) {
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    const elements = node.exportClause.elements.filter(item => closure.needed(closure.checker.getSymbolAtLocation(item.name)));
    return elements.length ? ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, ts.factory.updateNamedExports(node.exportClause, elements), node.moduleSpecifier, node.attributes) : undefined;
  }
  const symbol = node.moduleSpecifier && closure.checker.getSymbolAtLocation(node.moduleSpecifier);
  return symbol && closure.checker.getExportsOfModule(symbol).some(closure.needed) ? node : undefined;
}

/** Public symbol reachability keeps exact source types, without pulling unrelated store APIs into declarations. */
export function declarationFiles(modules, options) {
  const { program, sources } = declarationProgram(modules.entries, options);
  const closure = declarationClosure(program, sources, modules.entries), result = new Map(), printer = ts.createPrinter();
  for (const source of sources) {
    const statements = source.statements.flatMap(node => {
      const kept = ts.isImportDeclaration(node) ? keptImport(node, closure) : ts.isExportDeclaration(node) ? keptExport(node, closure) : closure.selected.has(node) ? node : undefined;
      return kept ? [kept] : [];
    });
    if (!statements.length && !modules.entries.includes(source.fileName)) continue;
    const transformer = context => {
      const reference = literal => context.factory.createStringLiteral(modules.reference(literal.text, source.fileName));
      const visit = node => {
        if (ts.isImportDeclaration(node)) return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, reference(node.moduleSpecifier), node.attributes);
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) return context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, reference(node.moduleSpecifier), node.attributes);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
          return context.factory.updateImportTypeNode(node, context.factory.createLiteralTypeNode(reference(node.argument.literal)), node.attributes, node.qualifier,
            node.typeArguments?.map(type => ts.visitNode(type, visit)), node.isTypeOf);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    };
    const file = ts.factory.updateSourceFile(source, statements), transformed = ts.transform(file, [transformer]);
    result.set(modules.output(source.fileName, '.d.ts'), printer.printFile(transformed.transformed[0]));
    transformed.dispose();
  }
  return result;
}

/** Check the artifact itself, without the app's paths or automatic front-end type packages. */
export function validateDeclarations(directory, names) {
  const program = ts.createProgram(names.map(name => path.join(directory, `${name}.d.ts`)), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'], types: [], strict: true, skipLibCheck: false, noEmit: true,
  });
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(`Invalid SDK declarations:\n${errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
}
