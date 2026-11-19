import { Studio } from "./Studio";
import { SvbReview } from "./SvbReview";
import { svbLesson } from "./svb.ts";

export default function SvbClassroom() {
  return <Studio lesson={svbLesson} review={session => <SvbReview session={session}/>}/>;
}
