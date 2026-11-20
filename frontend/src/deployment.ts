export const pagesDemo = import.meta.env.VITE_ECOSIM_PAGES === "1";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const localStudyAI = !pagesDemo && loopbackHosts.has(location.hostname);
