export const isDemo = () => new URLSearchParams(location.search).get("demo") === "1";
export const isExploration = () => new URLSearchParams(location.search).get("explore") === "1";

export function sceneSearch(scene: string, demo: boolean, explore = false) {
  return `?${new URLSearchParams({ scene, ...(demo ? { demo: "1" } : {}), ...(explore ? { explore: "1" } : {}) })}`;
}
