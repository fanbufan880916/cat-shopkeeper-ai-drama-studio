export function projectRoute(projectId: string, section = "") {
  const base = `/project/${encodeURIComponent(projectId)}`;
  return section ? `${base}/${section}` : base;
}
