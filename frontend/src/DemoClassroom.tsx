import { Studio } from "./Studio";
import { toolLibrary } from "./tool-library.ts";

export default function DemoClassroom() {
  return <Studio lesson={toolLibrary}/>;
}
