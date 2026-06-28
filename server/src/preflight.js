export function checkBinaries(names, resolver) {
  return names.map((name) => {
    const resolved = resolver(name);
    const path = resolved || null;
    return { name, found: Boolean(path), path };
  });
}
