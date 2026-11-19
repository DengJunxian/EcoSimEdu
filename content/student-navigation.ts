export const studentBrand = "EcoSimEdu";
export const studentRoutes = {
  home: "/",
  explore: "/explore/",
  notes: "/notes",
  review: "/review",
  model: "/#model-api",
} as const;

export function originalLessonHref(caseId: string) {
  return `/learn/${encodeURIComponent(caseId)}`;
}

export function exploreLessonHref(caseId: string) {
  return `${studentRoutes.explore}?${new URLSearchParams({ lesson: caseId })}`;
}
