import { SvbFork } from "./SvbFork.tsx";
import { Studio } from "./Studio";
import { SvbLab, SvbRelationships, SvbReview } from "./SvbReview";
import { svbLesson } from "./svb.ts";

export default function SvbClassroom() {
  return <Studio lesson={svbLesson} review={session => <SvbReview session={session}/>}
    actorDetail={(session, select, locate) => <SvbRelationships session={session} select={select} locate={locate}/>}
    forkLab={(session, send) => <SvbFork session={session} send={send}/>}
    afterInvestigation={session => <SvbLab session={session}/>}/>;
}
