declare module "virtual:course-files" {
  const files: {
    catalog: import("./catalog").CatalogCourse[];
    scenes: Record<string, import("./learning/flagship-types").SceneContent>;
  };
  export default files;
}
