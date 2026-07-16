export function projectRoute(projectId: string, section = "") {
  const base = `/project/${encodeURIComponent(projectId)}`;
  return section ? `${base}/${section}` : base;
}

export function globalSettingsRoute(returnTo = "") {
  return returnTo ? `/settings?from=${encodeURIComponent(returnTo)}` : "/settings";
}
